"""Local text-to-speech engines for the GhostForge voice pipeline.

Engines are tried in order of preference:
  1. Kokoro (via the `kokoro`/`kokoro-tts` python package) — best quality/speed
  2. Piper (`piper-tts`) — small, fast, permissive
  3. macOS `say` — always available, zero dependencies (best offline fallback)
  4. `espeak-ng` on Linux

`synth()` always returns at least a working fallback on macOS/Linux, so the
pipeline is fully offline-capable out of the box.
"""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import wave
from pathlib import Path
from typing import Any, Optional

MODELS_DIR = Path.home() / ".ghforge" / "voice"
_IS_MAC = sys.platform == "darwin"


def _has_module(name: str) -> bool:
    """True when *name* is importable, without importing it."""
    try:
        import importlib.util

        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


# --- engines ---------------------------------------------------------------


class _BaseTtsEngine:
    name = "base"

    def ready(self) -> bool:
        raise NotImplementedError

    def synth(self, text: str, voice: Optional[str]) -> bytes:
        """Return audio bytes (wav or mp3)."""
        raise NotImplementedError


class KokoroEngine(_BaseTtsEngine):
    """Kokoro-82M — Apache-2.0, ~2-3GB VRAM, fast CPU voice quality."""

    name = "kokoro"

    def ready(self) -> bool:
        try:
            import kokoro_tts  # noqa: F401
        except Exception:
            return False
        return True

    def synth(self, text: str, voice: Optional[str]) -> bytes:
        from kokoro_tts import Kokoro  # type: ignore

        kokoro = Kokoro()  # loads the bundled ONNX model
        return kokoro.synth(
            text,
            voice=voice or os.environ.get("GHF_TTS_VOICE", "af_heart"),
            lang="en",
        )


class PiperEngine(_BaseTtsEngine):
    """Piper — `piper-tts` python package or `piper` CLI.

    Models live under ~/.ghforge/voice/piper/*.onnx (with the sibling
    `.onnx.json` config). Prefer en_US-lessac-medium. The Python package is
    optional: without it (or without onnxruntime) the CLI is used.
    """

    name = "piper"

    def __init__(self) -> None:
        self._root = MODELS_DIR / "piper"
        self._bin = shutil.which("piper")
        self._voice: Any = None
        self._voice_model: Optional[Path] = None
        self._lock = threading.Lock()

    def _model(self) -> Optional[Path]:
        candidates = sorted(self._root.glob("*.onnx"))
        if not candidates:
            return None
        # prefer lessac-medium when present
        for c in candidates:
            if "lessac-medium" in c.name:
                return c
        return candidates[0]

    def ready(self) -> bool:
        model = self._model()
        if model is None:
            return False
        if self._bin is not None:
            return True
        return _has_module("piper") and model.with_suffix(".onnx.json").is_file()

    def _python_voice(self, model: Path) -> Any:
        """Load (once per model) a PiperVoice; None when the package is unusable."""
        with self._lock:
            if self._voice is not None and self._voice_model == model:
                return self._voice
            if not model.with_suffix(".onnx.json").is_file():
                return None
            try:
                from piper import PiperVoice  # type: ignore

                self._voice = PiperVoice.load(str(model))
                self._voice_model = model
            except Exception:  # noqa: BLE001 - ImportError, missing onnxruntime, bad model
                self._voice = None
                self._voice_model = None
            return self._voice

    def synth(self, text: str, voice: Optional[str]) -> bytes:
        model = self._model()
        if model is None:
            raise RuntimeError("no piper model found")
        py_voice = self._python_voice(model)
        if py_voice is not None:
            try:
                return _piper_py_wav(py_voice, text)
            except Exception:  # noqa: BLE001 - fall through to the CLI when present
                if self._bin is None:
                    raise
        if self._bin is None:
            raise RuntimeError("piper: no runnable engine (install piper-tts or the piper CLI)")
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            name = tmp.name
        try:
            # Text on stdin works for both the C++ `piper` binary and the
            # piper-tts (>=1.3) `piper` command.
            subprocess.run(
                [self._bin, "-m", str(model), "-f", name],
                input=" ".join(text.split()),
                text=True,
                check=True,
                capture_output=True,
                timeout=120,
            )
            return Path(name).read_bytes()
        finally:
            Path(name).unlink(missing_ok=True)


def _piper_py_wav(py_voice: Any, text: str) -> bytes:
    """Synthesize to an in-memory WAV with the piper-tts Python API.

    piper-tts >= 1.3 has ``synthesize_wav(text, wave_write)``; 1.2 has
    ``synthesize(text, wave_write)``. Both need a ``wave.Wave_write``, not a
    raw byte buffer.
    """
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        if hasattr(py_voice, "synthesize_wav"):
            py_voice.synthesize_wav(text, wav_file)
        else:
            py_voice.synthesize(text, wav_file)
    return buf.getvalue()


class SayEngine(_BaseTtsEngine):
    """macOS built-in `say` — always available, writes WAV.

    This is the guaranteed last-resort offline TTS on macOS.
    """

    name = "macos-say"

    def ready(self) -> bool:
        return _IS_MAC and shutil.which("say") is not None

    def synth(self, text: str, voice: Optional[str]) -> bytes:
        # Chromium/Electron cannot decode AIFF (say's default), so ask for a
        # 16-bit little-endian PCM WAV that every browser plays.
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            out = tmp.name
        try:
            cmd = ["say", "--file-format=WAVE", "--data-format=LEI16@22050", "-o", out]
            if voice:
                cmd += ["-v", voice]
            cmd.append(text)
            subprocess.run(cmd, check=True, timeout=120)
            return Path(out).read_bytes()
        finally:
            Path(out).unlink(missing_ok=True)


class EspeakEngine(_BaseTtsEngine):
    """Linux fallback via espeak-ng."""

    name = "espeak-ng"

    def ready(self) -> bool:
        return not _IS_MAC and shutil.which("espeak-ng") is not None

    def synth(self, text: str, voice: Optional[str]) -> bytes:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            out = tmp.name
        try:
            subprocess.run(["espeak-ng", "-w", out, text], check=True, timeout=120)
            return Path(out).read_bytes()
        finally:
            Path(out).unlink(missing_ok=True)


# --- registry ---------------------------------------------------------------


_ENGINES: Optional[list[_BaseTtsEngine]] = None
_ENGINES_LOCK = threading.Lock()


def _engines() -> list[_BaseTtsEngine]:
    """The process-wide engine singletons (built once, so loaded voices are reused)."""
    global _ENGINES
    with _ENGINES_LOCK:
        if _ENGINES is None:
            _ENGINES = [KokoroEngine(), PiperEngine(), SayEngine(), EspeakEngine()]
        return list(_ENGINES)


def detect() -> dict[str, Any]:
    """Availability per engine; one broken engine never fails the report."""
    status: dict[str, Any] = {}
    for eng in _engines():
        try:
            status[eng.name] = bool(eng.ready())
        except Exception:  # noqa: BLE001
            status[eng.name] = False
    return status


def audio_mime(audio: bytes) -> str:
    """Content type from the audio container magic (defaults to WAV)."""
    head = audio[:12]
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "audio/wav"
    if head[:4] == b"FORM" and head[8:12] in (b"AIFF", b"AIFC"):
        return "audio/aiff"
    if head[:4] == b"OggS":
        return "audio/ogg"
    if head[:4] == b"fLaC":
        return "audio/flac"
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0):
        return "audio/mpeg"
    return "audio/wav"


def synth(
    text: str, voice: Optional[str] = None, prefer: Optional[str] = None
) -> dict[str, Any]:
    """Synthesize speech with the best available engine.

    Returns ``{"audio": bytes, "engine": name, "mime": content type}``.
    The guaranteed fallback is macOS `say`, so
    this should only raise on non-macOS machines without espeak-ng.
    """
    engines = _engines()
    if prefer:
        engines.sort(key=lambda e: e.name == prefer, reverse=True)
    errors: list[str] = []
    for eng in engines:
        try:
            if not eng.ready():
                continue
            audio = eng.synth(text, voice)
            if audio:
                return {"audio": audio, "engine": eng.name, "mime": audio_mime(audio)}
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{eng.name}: {exc}")
    raise RuntimeError(
        "No local TTS engine produced audio. Errors: " + " | ".join(errors)
    )
