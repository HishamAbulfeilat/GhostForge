"""Wake-word detection status + optional listener for the voice pipeline.

JARVIS exposes an always-listening "Hey JARVIS" layer. This module reports
whether OpenWakeWord is installed and a model is available, and can run a
short detection pass over an uploaded audio clip (used for a mic self-test
or a lightweight client-side listener).

Real continuous listening runs client-side (Web Audio → chunks) because the
browser owns the microphone; this service provides the model runtime.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any, Optional

MODELS_DIR = Path.home() / ".ghforge" / "voice" / "wake"
# OpenWakeWord default model names (bundled via `openwakeword` package)
_DEFAULT_MODEL = os.environ.get("GHF_WAKE_MODEL", "hey_jarvis_v0.1")

_has_openwakeword = False
try:  # optional dependency — degraded gracefully when missing
    import openwakeword  # noqa: F401

    _has_openwakeword = True
except Exception:
    _has_openwakeword = False


def status() -> dict[str, Any]:
    model_path = MODELS_DIR / f"{_DEFAULT_MODEL}.onnx"
    bundled = _has_openwakeword and _model_exists_bundled(_DEFAULT_MODEL)
    return {
        "installed": _has_openwakeword,
        "model": _DEFAULT_MODEL,
        "model_ready": model_path.exists() or bundled,
        "model_path": str(model_path),
    }


def _model_exists_bundled(name: str) -> bool:
    if not _has_openwakeword:
        return False
    try:
        import openwakeword.model as _oww_model  # type: ignore

        return getattr(_oww_model, name, None) is not None
    except Exception:
        return False


def listen_once(audio_bytes: bytes) -> dict[str, Any]:
    """Run a single detection pass over uploaded PCM/WAV audio.

    Returns per-model wake probabilities; >0.5 typically means a trigger.
    """
    if not _has_openwakeword:
        raise RuntimeError("openwakeword is not installed")
    import openwakeword as oww  # type: ignore

    try:
        model = oww.Model()
    except Exception:
        # models bundled with the package are loaded lazily via the CLI
        from openwakeword.model import Model as _OwwModel  # type: ignore

        model = _OwwModel()
    model.reset()
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio_bytes)
        path = tmp.name
    try:
        import wave

        with wave.open(path, "rb") as wf:
            rate = wf.getframerate()
            frames = wf.readframes(wf.getnframes())
        if rate != 16000:
            raise RuntimeError(
                f"wake detection requires 16kHz mono audio, got {rate}Hz"
            )
        preds = model.predict(frames)
        return {k: round(float(v), 4) for k, v in (preds or {}).items()}
    finally:
        Path(path).unlink(missing_ok=True)
