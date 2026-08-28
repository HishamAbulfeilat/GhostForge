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

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional

MODELS_DIR = Path.home() / ".ghforge" / "voice"
_IS_MAC = sys.platform == "darwin"


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

    Models live under ~/.ghforge/voice/piper/*.onnx. Prefer en_US-lessac-medium.
    """

    name = "piper"

    def __init__(self) -> None:
        self._root = MODELS_DIR / "piper"
        self._bin = shutil.which("piper")
        self._voice = None

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
        if self._voice is not None:
            return True
        if _load_piper_py(self):
            return True
        return self._bin is not None

    def synth(self, text: str, voice: Optional[str]) -> bytes:
        model = self._model()
        if model is None:
            raise RuntimeError("no piper model found")
        if self._voice is None:
            _load_piper_py(self)
        if self._voice is not None:
            buf = __import__("io").BytesIO()
            self._voice.synthesize(text, buf)
            return buf.getvalue()
        if self._bin is None:
            raise RuntimeError("piper: no runnable engine")
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            name = tmp.name
        try:
            subprocess.run(
                [self._bin, "-m", str(model), "-f", name, "--", text],
                check=True,
                timeout=120,
            )
            data = Path(name).read_bytes()
            return data
        finally:
            Path(name).unlink(missing_ok=True)


def _load_piper_py(engine: "PiperEngine") -> bool:
    """Best-effort load of a piper voice using the modern `piper` package.

    Requires the model's sibling `.onnx.json` config next to the onnx file.
    """
    import json as _json

    import onnxruntime  # noqa: F401
    from piper import PiperVoice, SynthesisConfig  # type: ignore
    from piper.config import PiperConfig  # type: ignore

    model = engine._model()
    if model is None:
        return False
    cfg_path = model.with_suffix(".onnx.json")
    if not cfg_path.exists():
        return False
    try:
        cfg_data = _json.loads(cfg_path.read_text())
        config = PiperConfig(
            num_symbols=cfg_data.get("num_symbols", 0),
            num_speakers=cfg_data.get("num_speakers", 1),
            sample_rate=cfg_data.get("sample_rate", 22050),
            espeak_voice=cfg_data.get("espeak", {}).get("voice", "en"),
            phoneme_id_map=cfg_data.get("phoneme_id_map", {}),
            phoneme_type=cfg_data.get("phoneme_type", 1),
        )
        session = onnxruntime.InferenceSession(
            str(model), providers=["CPUExecutionProvider"]
        )
        engine._voice = PiperVoice(session, config, SynthesisConfig())
        return True
    except Exception:
        return False


class SayEngine(_BaseTtsEngine):
    """macOS built-in `say` — always available, converts to aiff/wav.

    This is the guaranteed last-resort offline TTS on macOS.
    """

    name = "macos-say"

    def ready(self) -> bool:
        return _IS_MAC and shutil.which("say") is not None

    def synth(self, text: str, voice: Optional[str]) -> bytes:
        with tempfile.NamedTemporaryFile(suffix=".aiff", delete=False) as tmp:
            out = tmp.name
        try:
            cmd = ["say", "-o", out]
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


def _engines() -> list[_BaseTtsEngine]:
    return [KokoroEngine(), PiperEngine(), SayEngine(), EspeakEngine()]


def detect() -> dict[str, Any]:
    return {eng.name: eng.ready() for eng in _engines()}


def synth(
    text: str, voice: Optional[str] = None, prefer: Optional[str] = None
) -> dict[str, Any]:
    """Synthesize speech with the best available engine.

    Returns bytes + engine name. The guaranteed fallback is macOS `say`, so
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
                return {"audio": audio, "engine": eng.name}
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{eng.name}: {exc}")
    raise RuntimeError(
        "No local TTS engine produced audio. Errors: " + " | ".join(errors)
    )
