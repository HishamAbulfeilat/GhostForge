"""Local speech-to-text engines for the GhostForge voice pipeline.

Engines are tried in order of preference:
  1. faster-whisper (CTranslate2) — fastest, CPU/Metal friendly
  2. openai `whisper` python package — portable fallback
  3. whisper.cpp CLI — tiny native binary, no python deps

Engines are module-level singletons. `ready()` is a cheap availability check
(package importable / files present) and never loads a model, so the health
endpoint stays fast; the model is loaded once, lazily, on the first
`transcribe()` and reused afterwards. `transcribe()` returns a dict with
`text` plus engine metadata so callers can degrade gracefully.

All of this is blocking work: the HTTP layer runs it in a worker thread.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Any, Optional

# Models are cached under ~/.ghforge/voice so they can be pre-seeded or
# symlinked from a shared drive.
MODELS_DIR = Path.home() / ".ghforge" / "voice"


def _has_module(name: str) -> bool:
    """True when *name* is importable, without importing it (fast)."""
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


# --- engines ---------------------------------------------------------------


class _BaseEngine:
    name = "base"

    def __init__(self) -> None:
        # Serialises model load and inference for this engine.
        self._lock = threading.RLock()

    def ready(self) -> bool:
        raise NotImplementedError

    def transcribe(self, audio_path: Path, language: Optional[str] = None) -> str:
        raise NotImplementedError


class FasterWhisperEngine(_BaseEngine):
    """faster-whisper via CTranslate2 — the model is loaded once and reused."""

    name = "faster-whisper"

    def __init__(self) -> None:
        super().__init__()
        self._model: Any = None
        self._size = os.environ.get("GHF_WHISPER_MODEL", "small")

    def ready(self) -> bool:
        return self._model is not None or _has_module("faster_whisper")

    def _load(self) -> Any:
        with self._lock:
            if self._model is None:
                from faster_whisper import WhisperModel  # type: ignore

                self._model = WhisperModel(self._size, device="auto", compute_type="int8")
            return self._model

    def transcribe(self, audio_path: Path, language: Optional[str] = None) -> str:
        if not self.ready():
            raise RuntimeError("faster-whisper is not available")
        model = self._load()
        with self._lock:
            segments, _info = model.transcribe(
                str(audio_path), language=language or None, beam_size=5
            )
            return " ".join(seg.text.strip() for seg in segments).strip()


class WhisperEngine(_BaseEngine):
    """OpenAI `whisper` python package (torch) — model cached after first use."""

    name = "openai-whisper"

    def __init__(self) -> None:
        super().__init__()
        self._model: Any = None

    def ready(self) -> bool:
        return self._model is not None or _has_module("whisper")

    def _load(self) -> Any:
        with self._lock:
            if self._model is None:
                import whisper  # type: ignore

                size = os.environ.get("WHF_WHISPER_SIZE", "small").lower()
                self._model = whisper.load_model(size)
            return self._model

    def transcribe(self, audio_path: Path, language: Optional[str] = None) -> str:
        model = self._load()
        with self._lock:
            result = model.transcribe(str(audio_path), language=language or None)
        return (result.get("text") or "").strip()


def _is_wav(path: Path) -> bool:
    try:
        with open(path, "rb") as fh:
            head = fh.read(12)
    except OSError:
        return False
    return head[:4] == b"RIFF" and head[8:12] == b"WAVE"


class WhisperCppEngine(_BaseEngine):
    """whisper.cpp CLI — rocks on Apple Silicon, zero python deps for STT.

    Looks for a whisper.cpp checkout under ~/.ghforge/voice/whisper.cpp/
    (`build/bin/whisper-cli` for current builds, `main` for old ones) and a
    GGML model (small / small.en suggested), else `whisper-cli` /
    `whisper-cpp` on PATH. whisper.cpp only reads 16 kHz WAV, so other input
    (browser WebM/Opus, mp3, ...) is converted with ffmpeg first.
    """

    name = "whisper.cpp"

    def __init__(self) -> None:
        super().__init__()
        root = MODELS_DIR / "whisper.cpp"
        self._bin: Optional[Path] = None
        for cand in (root / "build" / "bin" / "whisper-cli", root / "whisper-cli", root / "main"):
            if cand.is_file():
                self._bin = cand
                break
        if self._bin is None:
            found = shutil.which("whisper-cli") or shutil.which("whisper-cpp")
            self._bin = Path(found) if found else None
        self._model = root / os.environ.get("WHF_CPP_MODEL", "models/ggml-small.bin")
        if not self._model.is_file():
            # mirror the original whisper.cpp layout
            self._model = root / "models" / "ggml-small.bin"

    def ready(self) -> bool:
        return self._bin is not None and self._bin.is_file() and self._model.is_file()

    def _as_wav16k(self, audio_path: Path, workdir: Path) -> Path:
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg is None:
            if _is_wav(audio_path):
                return audio_path  # best effort: whisper.cpp wants 16 kHz
            raise RuntimeError("whisper.cpp needs ffmpeg to decode non-WAV audio")
        out = workdir / "input-16k.wav"
        proc = subprocess.run(
            [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
             "-i", str(audio_path), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(out)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if proc.returncode != 0 or not out.is_file():
            raise RuntimeError("ffmpeg could not decode the audio for whisper.cpp")
        return out

    def transcribe(self, audio_path: Path, language: Optional[str] = None) -> str:
        if not self.ready():
            raise RuntimeError("whisper.cpp is not available")
        assert self._bin is not None
        with tempfile.TemporaryDirectory(prefix="gf-whispercpp-") as tmp:
            wav = self._as_wav16k(audio_path, Path(tmp))
            # -nt: no timestamps, -np: no progress/info prints; text goes to
            # stdout. No -oj/-otxt, so nothing is written next to the input.
            cmd = [str(self._bin), "-m", str(self._model), "-f", str(wav), "-nt", "-np"]
            if language and language.lower() != "auto":
                cmd += ["-l", language.lower()]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise RuntimeError(f"whisper.cpp exited with code {proc.returncode}")
        return _clean_cpp_output(proc.stdout)


def _clean_cpp_output(stdout: str) -> str:
    """Join whisper.cpp transcript lines; strip any `[.. --> ..]` prefixes."""
    lines: list[str] = []
    for line in stdout.splitlines():
        line = line.strip()
        if line.startswith("[") and "-->" in line and "]" in line:
            line = line.split("]", 1)[1].strip()
        if line:
            lines.append(line)
    return " ".join(lines).strip()


# --- registry ---------------------------------------------------------------

_ENGINES: Optional[list[_BaseEngine]] = None
_ENGINES_LOCK = threading.Lock()


def _engines() -> list[_BaseEngine]:
    """The process-wide engine singletons (built once)."""
    global _ENGINES
    with _ENGINES_LOCK:
        if _ENGINES is None:
            _ENGINES = [FasterWhisperEngine(), WhisperEngine(), WhisperCppEngine()]
        return list(_ENGINES)


def detect() -> dict[str, Any]:
    """Cheap availability report; never loads a model."""
    status: dict[str, Any] = {}
    for eng in _engines():
        try:
            status[eng.name] = bool(eng.ready())
        except Exception:  # noqa: BLE001 - health must not fail because of one engine
            status[eng.name] = False
    return status


def _suffix_for(audio_bytes: bytes) -> str:
    """Pick a file suffix from the container magic (decoders sniff content too)."""
    head = audio_bytes[:12]
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return ".wav"
    if head[:4] == b"\x1aE\xdf\xa3":
        return ".webm"
    if head[:4] == b"OggS":
        return ".ogg"
    if head[:4] == b"fLaC":
        return ".flac"
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0):
        return ".mp3"
    if head[4:8] == b"ftyp":
        return ".m4a"
    return ".audio"


def transcribe(
    audio_bytes: bytes,
    language: Optional[str] = None,
    prefer: Optional[str] = None,
) -> dict[str, Any]:
    """Transcribe raw audio bytes using the best available engine."""
    engines = _engines()
    if prefer:
        engines.sort(key=lambda e: e.name == prefer, reverse=True)
    with tempfile.NamedTemporaryFile(suffix=_suffix_for(audio_bytes), delete=False) as tmp:
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
            "No local STT engine produced text. Errors: " + " | ".join(errors)
        )
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
