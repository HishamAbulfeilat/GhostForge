"""GhostForge Voice Pipeline — local STT / TTS / wake-word service.

A lightweight FastAPI service mirroring the mark-l-bridge conventions:
shared bridge token auth, graceful optional-module stubs, port 8766.

Endpoints:
  GET  /api/voice/health   — engine availability report
  POST /api/voice/stt      — multipart `audio` (wav/mp3) → { text, engine }
  POST /api/voice/tts      — json { text, voice?, engine? } → audio bytes (WAV;
                             Content-Type set from the engine output)
  POST /api/voice/wake     — multipart `audio` (16 kHz mono WAV) → wake scores
  GET  /api/voice/wake     — wake-word status
"""

from __future__ import annotations

import hmac
import logging
import os
import secrets
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

import stt
import tts
import wake

logger = logging.getLogger("ghostforge_voice")

# ---------------------------------------------------------------------------
# Auth — same secret as the mark-l-bridge so the web UI only manages one.
# Resolution order matches mark-l-bridge/server.py and
# web-ui/lib/bridge-token.ts (getMarkLBridgeToken):
#   1. MARKL_BRIDGE_TOKEN env var
#   2. GHOSTFORGE_VOICE_TOKEN env var (legacy, voice only)
#   3. ~/.ghostforge/bridge/token (created if missing)
# ---------------------------------------------------------------------------

_TOKEN_DIR = Path.home() / ".ghostforge" / "bridge"
_TOKEN_FILE = _TOKEN_DIR / "token"

# Uploaded clips above this are refused before they are buffered in full.
MAX_AUDIO_BYTES = 25 * 1024 * 1024


def _read_token() -> str:
    for var in ("MARKL_BRIDGE_TOKEN", "GHOSTFORGE_VOICE_TOKEN"):
        env_token = (os.environ.get(var) or "").strip()
        if env_token:
            return env_token
    try:
        _TOKEN_DIR.mkdir(parents=True, exist_ok=True)
        if not _TOKEN_FILE.exists():
            _TOKEN_FILE.write_text(secrets.token_hex(32))
            try:
                _TOKEN_FILE.chmod(0o600)
            except OSError:
                pass
        return _TOKEN_FILE.read_text().strip()
    except OSError:
        return ""


async def _read_upload_capped(upload: UploadFile, limit: Optional[int] = None) -> bytes:
    """Read an upload in chunks, refusing it with 413 once it exceeds *limit*."""
    limit = MAX_AUDIO_BYTES if limit is None else limit
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(
                status_code=413,
                detail=f"Audio too large (limit {limit // (1024 * 1024)} MB)",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def require_token(
    x_bridge_token: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
) -> None:
    token = _read_token()
    if not token:
        raise HTTPException(status_code=503, detail="Voice token is not configured")
    supplied = x_bridge_token or ""
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    if not supplied or not hmac.compare_digest(supplied, token):
        raise HTTPException(status_code=401, detail="Unauthorized: invalid token")


app = FastAPI(
    title="GhostForge Voice Pipeline",
    version="1.0.0",
    description="Local STT / TTS / wake-word engines for JARVIS.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "app://", "capacitor://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    voice: Optional[str] = None
    engine: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/voice/health", dependencies=[Depends(require_token)])
def health():
    return {
        "ok": True,
        "service": "ghostforge-voice",
        "version": "1.0.0",
        "stt": stt.detect(),
        "tts": tts.detect(),
        "wake": wake.status(),
    }


@app.post("/api/voice/stt", dependencies=[Depends(require_token)])
async def stt_endpoint(
    audio: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
    engine: Optional[str] = Form(default=None),
):
    data = await _read_upload_capped(audio)
    if not data:
        raise HTTPException(status_code=400, detail="No audio provided")
    try:
        # Model load + inference block for seconds: keep them off the event loop.
        result = await run_in_threadpool(
            stt.transcribe, data, language=language, prefer=engine
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception:
        logger.exception("stt failed")
        raise HTTPException(status_code=500, detail="stt failed: internal error")
    return result


@app.post("/api/voice/tts", dependencies=[Depends(require_token)])
def tts_endpoint(req: TtsRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")
    try:
        result = tts.synth(text, voice=req.voice, prefer=req.engine)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception:
        logger.exception("tts failed")
        raise HTTPException(status_code=500, detail="tts failed: internal error")
    return Response(
        content=result["audio"],
        media_type=result.get("mime") or "audio/wav",
        headers={"X-TTS-Engine": result["engine"]},
    )


@app.get("/api/voice/wake", dependencies=[Depends(require_token)])
def wake_status():
    return {"ok": True, **wake.status()}


@app.post("/api/voice/wake", dependencies=[Depends(require_token)])
async def wake_listen(
    audio: UploadFile = File(...),
):
    data = await _read_upload_capped(audio)
    if not data:
        raise HTTPException(status_code=400, detail="No audio provided")
    try:
        scores = await run_in_threadpool(wake.listen_once, data)
        return {"ok": True, **scores}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception:
        logger.exception("wake listen failed")
        raise HTTPException(
            status_code=500, detail="wake listen failed: internal error"
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8766)
