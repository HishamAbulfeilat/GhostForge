"""Local speech-to-text engines for the GhostForge voice pipeline.

Engines are tried in order of preference:
  1. faster-whisper (CTranslate2) — fastest, CPU/Metal friendly
  2. openai `whisper` python package — portable fallback
  3. whisper.cpp CLI — tiny native binary, no python deps

Each engine advertises readiness via `ready()`. `transcribe()` returns a dict
with `text` plus engine/health metadata so callers can degrade gracefully.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional

# Models are cached under ~/.ghforge/voice so they can be pre-seeded or
# symlinked from a shared drive.
MODELS_DIR = Path.home() / ".ghforge" / "voice"


# --- engines ---------------------------------------------------------------


class _BaseEngine:
    name = "base"

    def ready(self) -> bool:
        raise NotImplementedError

    def transcribe(self, audio_path: Path, language: Optional[str] = None) -> str:
        raise NotImplementedError


class FasterWhisperEngine(_BaseEngine):
    """faster-whisper via CTranslate2 — Model instances are cached in-process."""

    name = "faster-whisper"

    def __init__(self) -> None:
        self._model = None
        self._size = os.environ.get("GHF_WHISPER_MODEL", "small")

    def ready(self) -> bool:
        if self._model is not None:
            return True
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except Exception:
            return False
        try:
            self._model = WhisperModel(self._size, device="auto", compute_type="int8")
            return True
        except Exception:
            return False

    def transcribe(self, audio_path: Path, language: Optional[str] = None) -> str:
        if not self.ready():
            raise RuntimeError("faster-whisper is not available")
        assert self._model is not None
        segments, _info = self._model.transcribe(
            str(audio_path), language=language or None, beam_size=5
        )
        return " ".join(seg.text.strip() for seg in segments).strip()


class WhisperEngine(_BaseEngine):
    """OpenAI `whisper` python package (torch)."""

    name = "openai-whisper"

    def ready(self) -> bool:
        try:
            import whisper  # type: ignore
        except Exception:
            return False
        return True

    def transcribe(self, audio_path: Path, language: Optional[str] = None) -> str:
        import whisper  # type: ignore

        model = whisper.load_model(os.environ.get("WHF_WHISPER_SIZE", "small").lower())
        result = model.transcribe(str(audio_path), language=language or None)
        return (result.get("text") or "").strip()


class WhisperCppEngine(_BaseEngine):
    """whisper.cpp CLI — rocks on Apple Silicon, zero python deps for STT.

    Expects a `whisper.cpp` layout under ~/.ghforge/whisper.cpp/ with the
    compiled `main` binary and a GGML model (small / small.en suggested).
    Falls back to a plain `main`/`whisper-cli` on PATH if present.
    """

    name = "whisper.cpp"

    def __init__(self) -> None:
        root = MODELS_DIR / "whisper.cpp"
        self._bin = root / "main"
        self._model = root / (os.environ.get("WHF_CPP_MODEL", "models/ggml-small.bin"))
        if not self._bin.exists():
            self._bin = Path(shutil.which("whisper-cli") or shutil.which("main") or "")
        if not self._model.exists():
            # mirror the original whisper.cpp layout
            self._model = root / "models" / "ggml-small.bin"

    def ready(self) -> bool:
        return self._bin.exists() and self._model.exists()

    def transcribe(self, audio_path: Path, language: Optional[str] = None) -> str:
        cmd = [
            str(self._bin),
            "-m",
            str(self._model),
            "-f",
            str(audio_path),
            "-oj",
            "-np",
        ]
        if language and language.lower() != "auto":
            cmd += ["-l", language.lower()]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        return _first_status_line(proc) or proc.stdout.strip()


def _first_status_line(proc: subprocess.CompletedProcess) -> str:
    """whisper.cpp writes progress to stderr but transcript JSON to stdout."""
    for line in proc.stderr.splitlines():
        # progress lines look like:  [00:00.000 --> 00:01.500]   hello world
        if "-->" in line:
            return line.split("]", 1)[-1].strip()
    return ""


# --- registry ---------------------------------------------------------------


def _engines() -> list[_BaseEngine]:
    return [
        FasterWhisperEngine(),
        WhisperEngine(),
        WhisperCppEngine(),
    ]


def detect() -> dict[str, Any]:
    status: dict[str, Any] = {}
    for eng in _engines():
        status[eng.name] = eng.ready()
    return status


def transcribe(
    audio_bytes: bytes,
    language: Optional[str] = None,
    prefer: Optional[str] = None,
) -> dict[str, Any]:
    """Transcribe raw audio bytes using the best available engine."""
    engines = _engines()
    if prefer:
        engines.sort(key=lambda e: e.name == prefer, reverse=True)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = Path(tmp.name)
    try:
        errors: list[str] = []
        for eng in engines:
            try:
                if not eng.ready():
                    continue
                text = eng.transcribe(tmp_path, language=language)
                if text:
                    return {"text": text, "engine": eng.name}
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{eng.name}: {exc}")
        raise RuntimeError(
            "No local STT engine produced audio. Errors: " + " | ".join(errors)
        )
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
