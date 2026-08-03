"""GhostForge Voice Pipeline — local STT / TTS / wake-word service.

A lightweight FastAPI service mirroring the mark-l-bridge conventions:
shared bridge token auth, graceful optional-module stubs, port 8766.

Endpoints:
  GET  /api/voice/health   — engine availability report
  POST /api/voice/stt      — multipart `audio` (wav/mp3) → { text, engine }
  POST /api/voice/tts      — json { text, voice?, engine? } → audio/wav bytes
  POST /api/voice/wake     — json/audio clip → wake probabilities
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
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

import stt
import tts
import wake

logger = logging.getLogger("ghostforge_voice")

# ---------------------------------------------------------------------------
# Auth — same token file as the mark-l-bridge so the web UI only manages one
# secret. Falls back to GHOSTFORGE_VOICE_TOKEN env var.
# ---------------------------------------------------------------------------

_TOKEN_DIR = Path.home() / ".ghostforge" / "bridge"
_TOKEN_FILE = _TOKEN_DIR / "token"


def _read_token() -> str:
    env_token = os.environ.get("GHOSTFORGE_VOICE_TOKEN")
    if env_token:
        return env_token.strip()
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
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="No audio provided")
    try:
        result = stt.transcribe(data, language=language, prefer=engine)
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
        media_type="audio/wav",
        headers={"X-TTS-Engine": result["engine"]},
    )


@app.get("/api/voice/wake", dependencies=[Depends(require_token)])
def wake_status():
    return {"ok": True, **wake.status()}


@app.post("/api/voice/wake", dependencies=[Depends(require_token)])
async def wake_listen(
    audio: UploadFile = File(...),
):
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="No audio provided")
    try:
        return {"ok": True, **wake.listen_once(data)}
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
