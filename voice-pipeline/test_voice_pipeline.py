"""Voice pipeline tests. Heavy engines (faster-whisper, openai-whisper,
whisper.cpp, piper, openwakeword) are replaced by fakes.

Run from this folder with: python3 -m pytest -q
"""

import asyncio
import importlib.machinery
import io
import os
import stat
import sys
import tempfile
import textwrap
import threading
import time
import types
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

try:  # wake tests need numpy (an openwakeword dependency); import it up front
    import numpy  # noqa: F401  so patch.dict(sys.modules) never unloads it

    _HAS_NUMPY = True
except ImportError:
    _HAS_NUMPY = False

sys.path.insert(0, str(Path(__file__).parent))
import server  # noqa: E402
import stt  # noqa: E402
import tts  # noqa: E402
import wake  # noqa: E402


def _fake_module(name, **attrs):
    mod = types.ModuleType(name)
    mod.__spec__ = importlib.machinery.ModuleSpec(name, None)
    for k, v in attrs.items():
        setattr(mod, k, v)
    return mod


def _wav(seconds=0.5, rate=16000, channels=1, value=1000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        n = int(seconds * rate)
        wf.writeframes((value).to_bytes(2, "little", signed=True) * n * channels)
    return buf.getvalue()


class _Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        token_dir = Path(self.tmp.name) / "bridge"
        self.patches = [
            patch.object(server, "_TOKEN_DIR", token_dir),
            patch.object(server, "_TOKEN_FILE", token_dir / "token"),
            patch.object(stt, "_ENGINES", None, create=True),
            patch.object(tts, "_ENGINES", None, create=True),
            patch.object(wake, "_model", None, create=True),
        ]
        for p in self.patches:
            p.start()
        env = {k: v for k, v in os.environ.items() if k not in ("MARKL_BRIDGE_TOKEN", "GHOSTFORGE_VOICE_TOKEN")}
        self.env_patch = patch.dict(os.environ, env, clear=True)
        self.env_patch.start()
        token_dir.mkdir(parents=True)
        (token_dir / "token").write_text("file-token")
        self.headers = {"X-Bridge-Token": "file-token"}

    def tearDown(self):
        self.env_patch.stop()
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()


class TokenTests(_Base):
    def _status(self, token):
        with TestClient(server.app) as client:
            return client.get("/api/voice/wake", headers={"X-Bridge-Token": token}).status_code

    def test_resolution_order_matches_bridge(self):
        self.assertEqual(self._status("file-token"), 200)
        os.environ["GHOSTFORGE_VOICE_TOKEN"] = "voice-token"
        self.assertEqual(self._status("voice-token"), 200)
        self.assertEqual(self._status("file-token"), 401)
        os.environ["MARKL_BRIDGE_TOKEN"] = " bridge-token "
        self.assertEqual(self._status("bridge-token"), 200)
        self.assertEqual(self._status("voice-token"), 401)
        os.environ["MARKL_BRIDGE_TOKEN"] = "  "
        self.assertEqual(self._status("voice-token"), 200)


class SttModelCacheTests(_Base):
    def test_health_never_loads_a_model_and_model_is_reused(self):
        loads = []

        class WhisperModel:
            def __init__(self, size, **kw):
                loads.append(size)

            def transcribe(self, path, **kw):
                return ([types.SimpleNamespace(text=" hello ")], None)

        fw = _fake_module("faster_whisper", WhisperModel=WhisperModel)
        with patch.dict(sys.modules, {"faster_whisper": fw}):
            with TestClient(server.app) as client:
                for _ in range(3):
                    r = client.get("/api/voice/health", headers=self.headers)
                    self.assertEqual(r.status_code, 200)
                    self.assertTrue(r.json()["stt"]["faster-whisper"])
                self.assertEqual(loads, [])
                for _ in range(2):
                    r = client.post(
                        "/api/voice/stt",
                        headers=self.headers,
                        files={"audio": ("a.webm", b"\x1aE\xdf\xa3data", "audio/webm")},
                    )
                    self.assertEqual(r.json(), {"text": "hello", "engine": "faster-whisper"})
        self.assertEqual(loads, ["small"])

    def test_openai_whisper_model_is_cached(self):
        loads = []

        class _Model:
            def transcribe(self, path, language=None):
                return {"text": " hi "}

        def load_model(size):
            loads.append(size)
            return _Model()

        wh = _fake_module("whisper", load_model=load_model)
        with patch.dict(sys.modules, {"whisper": wh, "faster_whisper": None}):
            eng = stt.WhisperEngine()
            self.assertTrue(eng.ready())
            self.assertEqual(eng.transcribe(Path("x.wav")), "hi")
            self.assertEqual(eng.transcribe(Path("x.wav")), "hi")
        self.assertEqual(loads, ["small"])


class NonBlockingTests(_Base):
    def test_stt_and_wake_do_not_block_health(self):
        class _Slow(stt._BaseEngine):
            name = "slow"

            def ready(self):
                return True

            def transcribe(self, audio_path, language=None):
                time.sleep(0.6)
                return "done"

        def slow_listen(data):
            time.sleep(0.6)
            return {"hey_jarvis": 0.9}

        with patch.object(stt, "_ENGINES", [_Slow()]), patch.object(wake, "listen_once", slow_listen):
            async def scenario(path, field):
                order = []
                transport = httpx.ASGITransport(app=server.app)
                async with httpx.AsyncClient(transport=transport, base_url="http://voice") as c:
                    async def heavy():
                        r = await c.post(path, headers=self.headers, files={"audio": (field, b"RIFFxxxxWAVE", "audio/wav")})
                        order.append("heavy")
                        return r

                    async def health():
                        await asyncio.sleep(0.05)
                        r = await c.get("/api/voice/wake", headers=self.headers)
                        order.append("health")
                        return r

                    heavy_res, health_res = await asyncio.gather(heavy(), health())
                return order, heavy_res, health_res

            for path in ("/api/voice/stt", "/api/voice/wake"):
                order, heavy_res, health_res = asyncio.run(scenario(path, "a.wav"))
                self.assertEqual(heavy_res.status_code, 200, heavy_res.text)
                self.assertEqual(health_res.status_code, 200)
                self.assertEqual(order, ["health", "heavy"], path)

    def test_upload_cap(self):
        with patch.object(server, "MAX_AUDIO_BYTES", 4), TestClient(server.app) as client:
            r = client.post("/api/voice/stt", headers=self.headers, files={"audio": ("a.wav", b"123456", "audio/wav")})
        self.assertEqual(r.status_code, 413)


def _script(path: Path, body: str) -> Path:
    path.write_text("#!" + sys.executable + "\n" + textwrap.dedent(body))
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return path


class WhisperCppTests(_Base):
    def setUp(self):
        super().setUp()
        self.root = Path(self.tmp.name) / "voice"
        (self.root / "whisper.cpp" / "models").mkdir(parents=True)
        (self.root / "whisper.cpp" / "models" / "ggml-small.bin").write_bytes(b"ggml")
        self.p_models = patch.object(stt, "MODELS_DIR", self.root)
        self.p_models.start()

    def tearDown(self):
        self.p_models.stop()
        super().tearDown()

    def test_missing_binary_is_not_ready(self):
        with patch.object(stt.shutil, "which", lambda name: None):
            eng = stt.WhisperCppEngine()
        self.assertFalse(eng.ready())

    def test_runs_without_timestamps_or_json_and_checks_exit_code(self):
        bindir = self.root / "whisper.cpp" / "build" / "bin"
        bindir.mkdir(parents=True)
        log = Path(self.tmp.name) / "argv.txt"
        _script(
            bindir / "whisper-cli",
            f"""
            import sys
            open({str(log)!r}, "w").write("\\n".join(sys.argv[1:]))
            if "-nt" not in sys.argv:
                print("[00:00:00.000 --> 00:00:01.000]   hello there")
            else:
                print(" hello there")
                print(" general kenobi")
            sys.exit(0)
            """,
        )
        eng = stt.WhisperCppEngine()
        self.assertTrue(eng.ready())
        wav_path = Path(self.tmp.name) / "in.wav"
        wav_path.write_bytes(_wav())
        with patch.object(stt.shutil, "which", lambda name: None):  # no ffmpeg: WAV passes through
            self.assertEqual(eng.transcribe(wav_path, "en"), "hello there general kenobi")
        argv = log.read_text().splitlines()
        self.assertIn("-nt", argv)
        self.assertIn("-np", argv)
        self.assertNotIn("-oj", argv)
        self.assertEqual(sorted(p.name for p in Path(self.tmp.name).iterdir() if p.suffix == ".json"), [])

        webm = Path(self.tmp.name) / "in.webm"
        webm.write_bytes(b"\x1aE\xdf\xa3")
        with patch.object(stt.shutil, "which", lambda name: None):
            with self.assertRaisesRegex(RuntimeError, "ffmpeg"):
                eng.transcribe(webm)

        _script(bindir / "whisper-cli", "import sys\nprint('partial')\nsys.exit(3)\n")
        with patch.object(stt.shutil, "which", lambda name: None):
            with self.assertRaisesRegex(RuntimeError, "code 3"):
                eng.transcribe(wav_path)

    def test_non_wav_is_converted_with_ffmpeg(self):
        bindir = self.root / "whisper.cpp" / "build" / "bin"
        bindir.mkdir(parents=True)
        _script(
            bindir / "whisper-cli",
            """
            import sys
            f = sys.argv[sys.argv.index("-f") + 1]
            print(" ok" if open(f, "rb").read(4) == b"RIFF" else " not-wav")
            """,
        )
        ffmpeg = _script(
            Path(self.tmp.name) / "ffmpeg",
            f"""
            import sys, wave
            out = sys.argv[-1]
            assert sys.argv[sys.argv.index("-ar") + 1] == "16000"
            assert sys.argv[sys.argv.index("-ac") + 1] == "1"
            open(out, "wb").write({_wav(0.1)!r})
            """,
        )
        eng = stt.WhisperCppEngine()
        webm = Path(self.tmp.name) / "in.webm"
        webm.write_bytes(b"\x1aE\xdf\xa3")
        with patch.object(stt.shutil, "which", lambda name: str(ffmpeg) if name == "ffmpeg" else None):
            self.assertEqual(eng.transcribe(webm), "ok")


class TtsTests(_Base):
    def test_say_writes_wav_and_is_served_as_wav(self):
        calls = []

        def fake_run(cmd, **kw):
            calls.append(cmd)
            out = cmd[cmd.index("-o") + 1]
            Path(out).write_bytes(_wav(0.05, rate=22050))

        with patch.object(tts, "_IS_MAC", True), patch.object(
            tts.shutil, "which", lambda name: "/usr/bin/say" if name == "say" else None
        ), patch.object(tts.subprocess, "run", fake_run):
            with TestClient(server.app) as client:
                r = client.post("/api/voice/tts", headers=self.headers, json={"text": "hi", "engine": "macos-say"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.headers["content-type"], "audio/wav")
        self.assertEqual(r.headers["x-tts-engine"], "macos-say")
        self.assertIn("--file-format=WAVE", calls[0])
        self.assertTrue(calls[0][calls[0].index("-o") + 1].endswith(".wav"))

    def test_media_type_follows_actual_audio(self):
        self.assertEqual(tts.audio_mime(b"FORM\x00\x00\x00\x00AIFF"), "audio/aiff")
        self.assertEqual(tts.audio_mime(_wav(0.01)), "audio/wav")
        self.assertEqual(tts.audio_mime(b"ID3\x04"), "audio/mpeg")


class PiperTests(_Base):
    def setUp(self):
        super().setUp()
        self.root = Path(self.tmp.name) / "voice"
        (self.root / "piper").mkdir(parents=True)
        self.model = self.root / "piper" / "en_US-lessac-medium.onnx"
        self.model.write_bytes(b"onnx")
        self.model.with_suffix(".onnx.json").write_text("{}")
        self.p_models = patch.object(tts, "MODELS_DIR", self.root)
        self.p_models.start()

    def tearDown(self):
        self.p_models.stop()
        super().tearDown()

    def _only(self, engine):
        return patch.object(tts, "_ENGINES", [engine])

    def test_health_ok_when_piper_package_import_fails(self):
        with patch.dict(sys.modules, {"piper": None, "onnxruntime": None}), patch.object(
            tts.shutil, "which", lambda name: None
        ):
            eng = tts.PiperEngine()
            with self._only(eng), TestClient(server.app) as client:
                r = client.get("/api/voice/health", headers=self.headers)
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()["tts"]["piper"])

    def test_cli_used_when_python_package_missing(self):
        log = Path(self.tmp.name) / "stdin.txt"
        cli = _script(
            Path(self.tmp.name) / "piper",
            f"""
            import sys
            text = sys.stdin.read()
            open({str(log)!r}, "w").write(text)
            out = sys.argv[sys.argv.index("-f") + 1]
            open(out, "wb").write({_wav(0.05, rate=22050)!r})
            """,
        )
        with patch.dict(sys.modules, {"piper": None}), patch.object(
            tts.shutil, "which", lambda name: str(cli) if name == "piper" else None
        ):
            eng = tts.PiperEngine()
            with self._only(eng), TestClient(server.app) as client:
                self.assertTrue(client.get("/api/voice/health", headers=self.headers).json()["tts"]["piper"])
                r = client.post("/api/voice/tts", headers=self.headers, json={"text": "hello\nworld"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.headers["x-tts-engine"], "piper")
        self.assertEqual(r.headers["content-type"], "audio/wav")
        self.assertEqual(log.read_text(), "hello world")

    def test_python_api_writes_through_wave_writer(self):
        loads = []

        class PiperVoice:
            @classmethod
            def load(cls, path):
                loads.append(path)
                return cls()

            def synthesize_wav(self, text, wav_file):
                assert isinstance(wav_file, wave.Wave_write)
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(22050)
                wav_file.writeframes(b"\x00\x00" * 100)

        with patch.dict(sys.modules, {"piper": _fake_module("piper", PiperVoice=PiperVoice)}), patch.object(
            tts.shutil, "which", lambda name: None
        ):
            eng = tts.PiperEngine()
            self.assertTrue(eng.ready())
            out1 = eng.synth("hi", None)
            eng.synth("again", None)
        with wave.open(io.BytesIO(out1)) as wf:
            self.assertEqual(wf.getnframes(), 100)
        self.assertEqual(loads, [str(self.model)])

    def test_legacy_synthesize_signature(self):
        class PiperVoice:
            @classmethod
            def load(cls, path):
                return cls()

            def synthesize(self, text, wav_file):
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(16000)
                wav_file.writeframes(b"\x01\x00" * 10)

        with patch.dict(sys.modules, {"piper": _fake_module("piper", PiperVoice=PiperVoice)}), patch.object(
            tts.shutil, "which", lambda name: None
        ):
            out = tts.PiperEngine().synth("hi", None)
        self.assertEqual(tts.audio_mime(out), "audio/wav")


@unittest.skipUnless(_HAS_NUMPY, "numpy is not installed")
class WakeTests(_Base):
    def _fake_oww(self, seen):
        import numpy as np

        class Model:
            def __init__(self, **kwargs):
                seen["kwargs"] = kwargs
                seen["inits"] = seen.get("inits", 0) + 1

            def reset(self):
                pass

            def predict(self, frame):
                assert isinstance(frame, np.ndarray) and frame.dtype == np.int16
                assert frame.shape == (wake.FRAME_SAMPLES,)
                seen["frames"] = seen.get("frames", 0) + 1
                return {"hey_jarvis": 0.9 if seen["frames"] == 3 else 0.1}

        return _fake_module("openwakeword", Model=Model)

    def test_feeds_int16_frames_and_returns_max_score(self):
        seen = {}
        with patch.dict(sys.modules, {"openwakeword": self._fake_oww(seen)}), patch.object(
            wake, "_has_openwakeword", True
        ):
            res = wake.listen_once(_wav(0.5))
            wake.listen_once(_wav(0.1))
        self.assertEqual(res, {"hey_jarvis": 0.9})
        self.assertEqual(seen["inits"], 1)
        self.assertEqual(seen["kwargs"], {"wakeword_models": ["hey_jarvis_v0.1"]})

    def test_rejects_stereo_or_wrong_rate(self):
        seen = {}
        with patch.dict(sys.modules, {"openwakeword": self._fake_oww(seen)}), patch.object(
            wake, "_has_openwakeword", True
        ), TestClient(server.app) as client:
            for clip in (_wav(0.1, channels=2), _wav(0.1, rate=44100), b"not a wav"):
                r = client.post("/api/voice/wake", headers=self.headers, files={"audio": ("a.wav", clip, "audio/wav")})
                self.assertEqual(r.status_code, 503, r.text)
        self.assertNotIn("frames", seen)


if __name__ == "__main__":
    unittest.main()
