"""Wake-word detection status + optional listener for the voice pipeline.

JARVIS exposes an always-listening "Hey JARVIS" layer. This module reports
whether OpenWakeWord is installed and a model is available, and can run a
short detection pass over an uploaded audio clip (used for a mic self-test
or a lightweight client-side listener).

Real continuous listening runs client-side (Web Audio → chunks) because the
browser owns the microphone; this service provides the model runtime.
"""

from __future__ import annotations

import io
import os
import threading
import wave
from pathlib import Path
from typing import Any, Optional

MODELS_DIR = Path.home() / ".ghforge" / "voice" / "wake"
# OpenWakeWord default model names (bundled via `openwakeword` package)
_DEFAULT_MODEL = os.environ.get("GHF_WAKE_MODEL", "hey_jarvis_v0.1")

# openWakeWord scores 80 ms frames: 1280 samples of 16 kHz, 16-bit mono PCM.
SAMPLE_RATE = 16000
FRAME_SAMPLES = 1280

_has_openwakeword = False
try:  # optional dependency — degraded gracefully when missing
    import openwakeword  # noqa: F401

    _has_openwakeword = True
except Exception:
    _has_openwakeword = False

_model: Any = None
_model_lock = threading.Lock()


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
    """True when openWakeWord's pre-trained model *name* is downloaded."""
    if not _has_openwakeword:
        return False
    try:
        import openwakeword as _oww  # type: ignore

        for key, info in (getattr(_oww, "MODELS", None) or {}).items():
            path = Path(str((info or {}).get("model_path", "")))
            if name in (key, path.stem) and path.is_file():
                return True
    except Exception:
        return False
    return False


def _get_model() -> Any:
    """Build the openWakeWord model once and reuse it."""
    global _model
    with _model_lock:
        if _model is not None:
            return _model
        import openwakeword as oww  # type: ignore

        model_cls = getattr(oww, "Model", None)
        if model_cls is None:
            from openwakeword.model import Model as model_cls  # type: ignore

        custom = MODELS_DIR / f"{_DEFAULT_MODEL}.onnx"
        wanted = str(custom) if custom.is_file() else _DEFAULT_MODEL
        attempts: list[dict[str, Any]] = [{"wakeword_models": [wanted]}]
        if custom.is_file():
            attempts.append({"wakeword_models": [wanted], "inference_framework": "onnx"})
            attempts.append({"wakeword_model_paths": [wanted]})  # openWakeWord < 0.5
        attempts.append({})  # all bundled models
        last: Optional[Exception] = None
        for kwargs in attempts:
            try:
                _model = model_cls(**kwargs)
                return _model
            except Exception as exc:  # noqa: BLE001
                last = exc
        raise RuntimeError(f"could not load wake model {_DEFAULT_MODEL}: {last}")


def _pcm16_mono(audio_bytes: bytes):  # -> numpy.ndarray[int16]
    """Decode a 16 kHz, 16-bit mono WAV into an int16 NumPy array."""
    import numpy as np  # openwakeword depends on numpy

    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
            rate = wf.getframerate()
            channels = wf.getnchannels()
            width = wf.getsampwidth()
            frames = wf.readframes(wf.getnframes())
    except (wave.Error, EOFError) as exc:
        raise RuntimeError(f"wake detection needs a WAV file: {exc}") from exc
    if rate != SAMPLE_RATE or channels != 1 or width != 2:
        raise RuntimeError(
            "wake detection requires 16kHz mono 16-bit WAV audio, "
            f"got {rate}Hz, {channels} channel(s), {width * 8}-bit"
        )
    return np.frombuffer(frames, dtype=np.int16)


def listen_once(audio_bytes: bytes) -> dict[str, Any]:
    """Run a single detection pass over an uploaded 16 kHz mono WAV clip.

    The clip is fed to openWakeWord in 80 ms frames and the highest score per
    model is returned; >0.5 typically means a trigger.
    """
    if not _has_openwakeword:
        raise RuntimeError("openwakeword is not installed")
    import numpy as np

    samples = _pcm16_mono(audio_bytes)
    if samples.size == 0:
        raise RuntimeError("audio clip is empty")
    model = _get_model()
    best: dict[str, float] = {}
    with _model_lock:  # the model keeps streaming state between frames
        if hasattr(model, "reset"):
            model.reset()
        for start in range(0, samples.size, FRAME_SAMPLES):
            frame = samples[start : start + FRAME_SAMPLES]
            if frame.size < FRAME_SAMPLES:
                frame = np.pad(frame, (0, FRAME_SAMPLES - frame.size))
            for name, score in (model.predict(frame) or {}).items():
                value = float(score)
                if value > best.get(name, float("-inf")):
                    best[name] = value
        if hasattr(model, "reset"):
            model.reset()
    return {k: round(v, 4) for k, v in best.items()}
