"""
Mark-L FastAPI Bridge Server
Wraps all Mark-L Python action modules as HTTP endpoints.
Includes AI memory, agents, browser, models, and unified orchestration.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import platform
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

# Mark-LIV (vendored JARVIS engine) provides the `actions`, `core` and `memory`
# packages imported below. MARK_LIV_DIR overrides the vendored copy.
_MARK_LIV_DIR = Path(
    os.environ.get("MARK_LIV_DIR")
    or Path(__file__).resolve().parent.parent / "vendor" / "mark-liv"
)
if _MARK_LIV_DIR.is_dir() and str(_MARK_LIV_DIR) not in sys.path:
    sys.path.insert(0, str(_MARK_LIV_DIR))

# ---------------------------------------------------------------------------
# Graceful module imports — each Mark-L module is optional. If the import
# fails we stub the endpoint so the server still starts and returns a clear
# 503 error when that particular module is actually called.
# ---------------------------------------------------------------------------

_MISSING: set[str] = set()

# ---------- helpers ---------------------------------------------------------


def _stub(name: str, exc: Exception):
    _MISSING.add(name)
    print(f"[bridge] ⚠️  Could not import {name}: {exc}", file=sys.stderr)


# --- web_search -------------------------------------------------------------
try:
    from actions.web_search import web_search as _web_search
except Exception as e:
    _stub("web_search", e)

    def _web_search(params: dict, **kw) -> str:  # type: ignore[misc]
        return "web_search module is not available"


# --- screen_processor -------------------------------------------------------
try:
    from actions.screen_processor import screen_process as _screen_process
except Exception as e:
    _stub("screen_processor", e)

    def _screen_process(params: dict, **kw) -> bool:  # type: ignore[misc]
        raise RuntimeError("screen_processor module is not available")


# --- youtube_video ----------------------------------------------------------
try:
    from actions.youtube_video import youtube_video as _youtube_video
except Exception as e:
    _stub("youtube_video", e)

    def _youtube_video(params: dict, **kw) -> str:  # type: ignore[misc]
        return "youtube_video module is not available"


# --- game_updater -----------------------------------------------------------
try:
    from actions.game_updater import game_updater as _game_updater
except Exception as e:
    _stub("game_updater", e)

    def _game_updater(params: dict, **kw) -> str:  # type: ignore[misc]
        return "game_updater module is not available"


# --- system_monitor ---------------------------------------------------------
try:
    from actions.system_monitor import get_system_status as _get_system_status
except Exception as e:
    _stub("system_monitor", e)

    def _get_system_status() -> dict:  # type: ignore[misc]
        return {"error": "system_monitor module is not available"}


# --- computer_settings ------------------------------------------------------
try:
    from actions.computer_settings import computer_settings as _computer_settings
except Exception as e:
    _stub("computer_settings", e)

    def _computer_settings(params: dict, **kw) -> str:  # type: ignore[misc]
        return "computer_settings module is not available"


# --- computer_control -------------------------------------------------------
try:
    from actions.computer_control import computer_control as _computer_control
except Exception as e:
    _stub("computer_control", e)

    def _computer_control(params: dict, **kw) -> str:  # type: ignore[misc]
        return "computer_control module is not available"


# --- browser_control --------------------------------------------------------
try:
    from actions.browser_control import browser_control as _browser_control
except Exception as e:
    _stub("browser_control", e)

    def _browser_control(params: dict, **kw) -> str:  # type: ignore[misc]
        return "browser_control module is not available"


# --- file_processor ---------------------------------------------------------
try:
    from actions.file_processor import file_processor as _file_processor
except Exception as e:
    _stub("file_processor", e)

    def _file_processor(params: dict, **kw) -> str:  # type: ignore[misc]
        return "file_processor module is not available"


# --- file_controller --------------------------------------------------------
try:
    from actions.file_controller import file_controller as _file_controller
except Exception as e:
    _stub("file_controller", e)

    def _file_controller(params: dict, **kw) -> str:  # type: ignore[misc]
        return "file_controller module is not available"


# --- send_message -----------------------------------------------------------
try:
    from actions.send_message import send_message as _send_message
except Exception as e:
    _stub("send_message", e)

    def _send_message(params: dict, **kw) -> str:  # type: ignore[misc]
        return "send_message module is not available"


# --- weather_report ---------------------------------------------------------
try:
    from actions.weather_report import weather_action as _weather_action
except Exception as e:
    _stub("weather_report", e)

    def _weather_action(params: dict, **kw) -> str:  # type: ignore[misc]
        return "weather_report module is not available"


# --- flight_finder ----------------------------------------------------------
try:
    from actions.flight_finder import flight_finder as _flight_finder
except Exception as e:
    _stub("flight_finder", e)

    def _flight_finder(params: dict, **kw) -> str:  # type: ignore[misc]
        return "flight_finder module is not available"


# --- reminder ---------------------------------------------------------------
try:
    from actions.reminder import reminder as _reminder
except Exception as e:
    _stub("reminder", e)

    def _reminder(params: dict, **kw) -> str:  # type: ignore[misc]
        return "reminder module is not available"


# --- open_app ---------------------------------------------------------------
try:
    from actions.open_app import open_app as _open_app
except Exception as e:
    _stub("open_app", e)

    def _open_app(params: dict, **kw) -> str:  # type: ignore[misc]
        return "open_app module is not available"


# --- desktop ----------------------------------------------------------------
try:
    from actions.desktop import desktop_control as _desktop_control
except Exception as e:
    _stub("desktop", e)

    def _desktop_control(params: dict, **kw) -> str:  # type: ignore[misc]
        return "desktop module is not available"


# --- code_helper ------------------------------------------------------------
try:
    from actions.code_helper import code_helper as _code_helper
except Exception as e:
    _stub("code_helper", e)

    def _code_helper(params: dict, **kw) -> str:  # type: ignore[misc]
        return "code_helper module is not available"


# --- dev_agent --------------------------------------------------------------
try:
    from actions.dev_agent import dev_agent as _dev_agent
except Exception as e:
    _stub("dev_agent", e)

    def _dev_agent(params: dict, **kw) -> str:  # type: ignore[misc]
        return "dev_agent module is not available"


# --- background_monitor -----------------------------------------------------
try:
    from actions.background_monitor import (
        add_monitor as _add_monitor,
        remove_monitor as _remove_monitor,
        list_monitors as _list_monitors,
        check_all as _check_all,
    )
except Exception as e:
    _stub("background_monitor", e)

    def _add_monitor(topic: str) -> str:  # type: ignore[misc]
        return "background_monitor module is not available"

    def _remove_monitor(topic: str) -> str:  # type: ignore[misc]
        return "background_monitor module is not available"

    def _list_monitors() -> list[str]:  # type: ignore[misc]
        return []

    def _check_all() -> list[str]:  # type: ignore[misc]
        return []


# --- proactive --------------------------------------------------------------
try:
    from actions.proactive import ProactiveEngine as _ProactiveEngine
except Exception as e:
    _stub("proactive", e)

    class _ProactiveEngine:  # type: ignore[no-redef]
        pass


# --- clipboard helper (pyperclip) ------------------------------------------
try:
    import pyperclip as _pyperclip

    _HAS_CLIPBOARD = True
except ImportError:
    _HAS_CLIPBOARD = False

# --- OCR (paddleocr) --------------------------------------------------------
try:
    from paddleocr import PaddleOCR as _PaddleOCR

    _HAS_OCR = True
    _ocr_engine: Optional[Any] = None
except Exception as e:
    _stub("ocr", e)
    _HAS_OCR = False
    _ocr_engine = None

# ---------------------------------------------------------------------------
# AI module imports (graceful)
# ---------------------------------------------------------------------------

try:
    from ai_memory import (
        add_memory as _ai_add_memory,
        search_memory as _ai_search_memory,
        list_memories as _ai_list_memories,
        delete_memory as _ai_delete_memory,
        get_memory_stats as _ai_get_memory_stats,
        update_memory as _ai_update_memory,
        export_memories as _ai_export_memories,
        import_memories as _ai_import_memories,
    )

    _HAS_AI_MEMORY = True
except Exception as e:
    _stub("ai_memory", e)
    _HAS_AI_MEMORY = False

try:
    from ai_agents import (
        create_crew as _ai_create_crew,
        run_crew as _ai_run_crew,
        get_crew_status as _ai_get_crew_status,
        list_crews as _ai_list_crews,
        get_templates as _ai_get_templates,
        cancel_crew as _ai_cancel_crew,
    )

    _HAS_AI_AGENTS = True
except Exception as e:
    _stub("ai_agents", e)
    _HAS_AI_AGENTS = False

try:
    from ai_browser import (
        browse as _ai_browse,
        extract as _ai_extract,
        screenshot as _ai_screenshot,
        search as _ai_browser_search,
        fill_form as _ai_fill_form,
        click as _ai_click,
    )

    _HAS_AI_BROWSER = True
except Exception as e:
    _stub("ai_browser", e)
    _HAS_AI_BROWSER = False

try:
    from ai_models import (
        search_models as _ai_search_models,
        get_model_info as _ai_get_model_info,
        download_model as _ai_download_model,
        list_local_models as _ai_list_local_models,
        get_model_recommendations as _ai_get_model_recommendations,
        install_model as _ai_install_model,
        compare_models as _ai_compare_models,
    )

    _HAS_AI_MODELS = True
except Exception as e:
    _stub("ai_models", e)
    _HAS_AI_MODELS = False

try:
    from ai_unified import UnifiedAgent as _UnifiedAgent

    _HAS_AI_UNIFIED = True
except Exception as e:
    _stub("ai_unified", e)
    _HAS_AI_UNIFIED = False

# --- OpenJarvis (opt-in, Apache-2.0) -----------------------------------------
# OpenJarvis (https://github.com/open-jarvis/OpenJarvis) ships as a `jarvis`
# CLI + local agent runtime rather than an importable pip package, so the
# bridge shells out to the CLI when it is present on PATH. Not vendored; see
# marketplace/catalog.json ("openjarvis") for the installer.
_OPENJARVIS_BIN = shutil.which("jarvis")
_HAS_OPENJARVIS = _OPENJARVIS_BIN is not None
if not _HAS_OPENJARVIS:
    _stub("openjarvis", FileNotFoundError("`jarvis` CLI not found on PATH"))

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Release bridge resources (browser sessions, executors) on shutdown."""
    yield
    try:
        import ai_browser as _ai_browser_module

        await _ai_browser_module._cleanup_browser()
    except Exception:
        pass


app = FastAPI(
    title="Mark-L Bridge",
    version="2.0.0",
    description="HTTP bridge wrapping Mark-L Python action modules + AI memory, agents, browser, and models.",
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    # Only local consumers (web UI / Electron / Capacitor). A wildcard
    # origin combined with credentials is invalid per the CORS spec, so
    # restrict origins to the known local clients.
    allow_origins=["http://localhost:3001", "app://", "capacitor://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Auth — shared-secret token required on every endpoint.
#
# Token source: MARKL_BRIDGE_TOKEN env var, else ~/.ghostforge/bridge/token
# (created with `secrets.token_hex(32)` if missing). Read fresh per request
# so the file can be rotated without restarting the bridge.
# ---------------------------------------------------------------------------

_TOKEN_DIR = Path.home() / ".ghostforge" / "bridge"
_TOKEN_FILE = _TOKEN_DIR / "token"


def _read_bridge_token() -> str:
    """Return the shared bridge secret (env var first, then the token file)."""
    env_token = os.environ.get("MARKL_BRIDGE_TOKEN")
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
    """FastAPI dependency: reject requests without a valid bridge token.

    The token is accepted via the `X-Bridge-Token` header or an
    `Authorization: Bearer <token>` header and compared in constant time.
    """
    token = _read_bridge_token()
    if not token:
        raise HTTPException(status_code=503, detail="Bridge token is not configured")
    supplied = x_bridge_token or ""
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    if not supplied or not hmac.compare_digest(supplied, token):
        raise HTTPException(
            status_code=401, detail="Unauthorized: invalid bridge token"
        )


# ---------------------------------------------------------------------------
# Pydantic request models — original
# ---------------------------------------------------------------------------


class WebSearchRequest(BaseModel):
    query: str = ""
    mode: str = "search"
    items: list[str] = Field(default_factory=list)
    aspect: str = "general"


class ScreenCaptureRequest(BaseModel):
    angle: str = "screen"
    text: str = "What do you see?"


class YoutubeRequest(BaseModel):
    action: str = "play"
    query: str = ""
    url: str = ""
    region: str = "TR"


class GameUpdaterRequest(BaseModel):
    action: str = "update"
    game_name: str = ""


class ComputerSettingsRequest(BaseModel):
    action: str = ""
    description: str = ""
    value: Any = None
    confirmed: Optional[str] = None


class ComputerControlRequest(BaseModel):
    action: str = ""
    description: str = ""
    value: Any = None
    text: str = ""
    x: Optional[int] = None
    y: Optional[int] = None
    keys: str = ""
    key: str = ""
    direction: str = "down"
    amount: int = 3
    seconds: float = 1.0
    title: str = ""


class BrowserControlRequest(BaseModel):
    action: str = "go_to"
    url: str = ""
    text: str = ""
    value: Any = None
    query: str = ""
    selector: str = ""
    description: str = ""
    engine: str = "google"
    browser: str = ""


class FileProcessRequest(BaseModel):
    action: str = ""
    file_path: str = ""
    question: str = ""
    instruction: str = ""


class FileControlRequest(BaseModel):
    action: str = "list"
    path: str = "desktop"
    new_path: str = ""
    content: str = ""
    name: str = ""
    new_name: str = ""
    destination: str = ""
    extension: str = ""
    append: bool = False


class SendMessageRequest(BaseModel):
    receiver: str = ""
    message_text: str = ""
    platform: str = "whatsapp"


class WeatherRequest(BaseModel):
    city: str = ""


class FlightFinderRequest(BaseModel):
    from_city: str = ""
    to_city: str = ""
    date: str = ""
    return_date: str = ""
    passengers: int = 1
    cabin: str = "economy"


class ReminderRequest(BaseModel):
    date: str = ""
    time: str = ""
    message: str = ""


class OpenAppRequest(BaseModel):
    app_name: str = ""


class DesktopRequest(BaseModel):
    action: str = ""
    description: str = ""
    task: str = ""
    path: str = ""
    url: str = ""
    mode: str = "by_type"


class CodeHelperRequest(BaseModel):
    action: str = "auto"
    code: str = ""
    language: str = "python"
    description: str = ""
    file_path: str = ""
    output_path: str = ""
    timeout: int = 30


class DevAgentRequest(BaseModel):
    task: str = ""
    language: str = "python"
    project_name: str = ""


class ClipboardRequest(BaseModel):
    action: str = "get"
    text: str = ""


# ---------------------------------------------------------------------------
# Pydantic request models — AI memory
# ---------------------------------------------------------------------------


class MemoryAddRequest(BaseModel):
    content: str
    user_id: str = "default"
    metadata: Optional[dict[str, Any]] = None
    category: Optional[str] = None


class MemorySearchRequest(BaseModel):
    query: str
    user_id: str = "default"
    top_k: int = 5


class MemoryUpdateRequest(BaseModel):
    content: str


class MemoryExportRequest(BaseModel):
    user_id: str = "default"


class MemoryImportRequest(BaseModel):
    memories_json: str
    user_id: str = "default"


# ---------------------------------------------------------------------------
# Pydantic request models — AI agents
# ---------------------------------------------------------------------------


class CrewCreateRequest(BaseModel):
    agents_config: list[dict[str, Any]] = Field(default_factory=list)
    tasks_config: list[dict[str, Any]] = Field(default_factory=list)
    crew_id: Optional[str] = None
    template_name: Optional[str] = None
    process: str = "sequential"


class CrewRunRequest(BaseModel):
    inputs: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Pydantic request models — AI browser
# ---------------------------------------------------------------------------


class BrowserBrowseRequest(BaseModel):
    url: str
    task: str


class BrowserExtractRequest(BaseModel):
    url: str
    selectors: dict[str, str]


class BrowserScreenshotRequest(BaseModel):
    url: str


class BrowserSearchRequest(BaseModel):
    query: str


class BrowserFillFormRequest(BaseModel):
    url: str
    form_data: dict[str, str]


class BrowserClickRequest(BaseModel):
    url: str
    selector: str


# ---------------------------------------------------------------------------
# Pydantic request models — AI models
# ---------------------------------------------------------------------------


class ModelDownloadRequest(BaseModel):
    model_id: str
    local_dir: Optional[str] = None


class ModelInstallRequest(BaseModel):
    model_id: str


# ---------------------------------------------------------------------------
# Pydantic request models — unified
# ---------------------------------------------------------------------------


class UnifiedChatRequest(BaseModel):
    message: str
    user_id: str = "default"
    context: Optional[dict[str, Any]] = None


class UnifiedChainStep(BaseModel):
    action: str
    message: str
    context: Optional[dict[str, Any]] = None


class UnifiedChainRequest(BaseModel):
    steps: list[UnifiedChainStep]
    user_id: str = "default"


# ---------------------------------------------------------------------------
# Pydantic request models — web-only contracts exposed to JARVIS
# ---------------------------------------------------------------------------


class CollabMessageRequest(BaseModel):
    id: str = Field(..., min_length=8, max_length=64)
    role: str = Field(..., min_length=1, max_length=32)
    content: str = Field(..., min_length=1, max_length=10_000)


class JobActionRequest(BaseModel):
    action: str = Field(..., min_length=1, max_length=32)
    user_id: str = "default"
    id: Optional[str] = None
    terms: list[str] = Field(default_factory=list)
    auto_prepare: int = Field(default=3, ge=0, le=5)


class WorkflowStepRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    id: Optional[str] = None
    kind: str = "manual"
    ref: str = ""
    deps: list[str] = Field(default_factory=list)
    status: str = "pending"
    notes: str = ""


class WorkflowRequest(BaseModel):
    user_id: str = "default"
    id: Optional[str] = None
    action: Optional[str] = None
    max_steps: int = Field(default=100, ge=1, le=100)
    name: Optional[str] = None
    goal: Optional[str] = None
    status: Optional[str] = None
    steps: Optional[list[WorkflowStepRequest]] = None
    step_id: Optional[str] = None
    step: Optional[dict[str, Any]] = None
    log: Optional[str] = None


class WebhookRequest(BaseModel):
    source: str = "generic"
    event: str = "unknown"
    body: dict[str, Any] = Field(default_factory=dict)
    config: Optional[list[dict[str, Any]]] = None


class DeviceRequest(BaseModel):
    user_id: str = "default"
    id: str = Field(..., min_length=1, max_length=128)
    name: str = ""
    platform: str = ""
    browser: str = ""
    model: str = ""
    details: dict[str, Any] = Field(default_factory=dict)


class RemoteSetupRequest(BaseModel):
    action: str = Field(..., min_length=1, max_length=32)


class ReleaseRequest(BaseModel):
    action: str = "status"
    kind: str = "patch"
    environment: str = "staging"
    target: str = "static"
    notes: str = ""


# ---------------------------------------------------------------------------
# Response helpers
# ---------------------------------------------------------------------------


def _ok(data: Any = None, **extra) -> dict:
    body: dict[str, Any] = {"ok": True}
    if data is not None:
        body["data"] = data
    body.update(extra)
    return body


logger = logging.getLogger("mark_l_bridge")


def _err(message: str, status: int = 500) -> HTTPException:
    return HTTPException(status_code=status, detail={"ok": False, "error": message})


def _safe_call(fn, *args, **kwargs):
    """Call *fn*, catch exceptions, return a serialisable dict.

    The full traceback is logged server-side; clients only receive a
    generic message so internal paths and exception details are not
    disclosed.
    """
    try:
        result = fn(*args, **kwargs)
        return _ok(result)
    except Exception:
        logger.exception(f"{fn.__name__} failed")
        raise _err(f"{fn.__name__} failed: internal error")


def _require_module(name: str, available: bool):
    """Raise 503 if the module is not available."""
    if not available:
        raise _err(f"{name} is not installed or available", status=503)


def _run_openjarvis_cli(*args: str, timeout_s: int = 60) -> str:
    """Run the `jarvis` CLI with a fixed argv (never shell=True) and return
    its stdout. Raises on a non-zero exit or missing binary."""
    if not _OPENJARVIS_BIN:
        raise RuntimeError("openjarvis CLI is not installed")
    proc = subprocess.run(
        [_OPENJARVIS_BIN, *args],
        capture_output=True,
        text=True,
        timeout=timeout_s,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"jarvis {' '.join(args)} exited {proc.returncode}: {proc.stderr.strip()}"
        )
    return proc.stdout.strip()


# ---------------------------------------------------------------------------
# Web-only feature contracts
#
# These deliberately use the same small JSON stores as the web application,
# but remain independent of Next.js so JARVIS and the desktop bridge can use
# them when the web UI is not running.
# ---------------------------------------------------------------------------

_BRIDGE_DATA_DIR = Path.home() / ".ghostforge" / "bridge"
_GHOSTFORGE_USERS_FILE = Path.home() / ".ghostforge" / "users.json"
_COLLAB_SESSIONS: dict[str, dict[str, Any]] = {}


_ACCESS_PROFILES: list[dict[str, Any]] = [
    {
        "id": "devops",
        "label": "DevOps / IT & Infrastructure",
        "description": "Full engineering toolkit plus remote access, system control and automation.",
        "permissions": [
            "chat",
            "conversation_history",
            "web_search",
            "weather",
            "voice",
            "semantic_memory",
            "reminders",
            "calendar",
            "contacts",
            "clipboard",
            "career",
            "job_hunter",
            "file_read",
            "file_write",
            "file_process",
            "documents",
            "terminal",
            "github",
            "copilot",
            "code_helper",
            "ai_models",
            "mcp",
            "browser",
            "system_info",
            "remote",
            "mac_control",
            "native_desktop",
            "screenshots",
            "admin_tools",
            "n8n",
        ],
    },
    {
        "id": "data",
        "label": "Data & AI",
        "description": "Files, code helper, AI models and AI Studio for analysis work.",
        "permissions": [
            "chat",
            "conversation_history",
            "web_search",
            "weather",
            "voice",
            "semantic_memory",
            "reminders",
            "calendar",
            "contacts",
            "clipboard",
            "career",
            "job_hunter",
            "file_read",
            "file_write",
            "file_process",
            "documents",
            "code_helper",
            "ai_models",
            "ai_studio",
            "mcp",
            "github",
            "browser",
            "terminal",
        ],
    },
    {
        "id": "designer",
        "label": "Design & Creative",
        "description": "Files, browser, screenshots and AI Studio for design work.",
        "permissions": [
            "chat",
            "conversation_history",
            "web_search",
            "weather",
            "voice",
            "semantic_memory",
            "reminders",
            "calendar",
            "contacts",
            "clipboard",
            "career",
            "job_hunter",
            "file_read",
            "file_write",
            "file_process",
            "documents",
            "browser",
            "screenshots",
            "youtube",
            "ai_studio",
        ],
    },
    {
        "id": "manager",
        "label": "Management & Leadership",
        "description": "Documents, messaging, workflows and GitHub visibility.",
        "permissions": [
            "chat",
            "conversation_history",
            "web_search",
            "weather",
            "voice",
            "semantic_memory",
            "reminders",
            "calendar",
            "contacts",
            "clipboard",
            "career",
            "job_hunter",
            "file_read",
            "file_write",
            "file_process",
            "documents",
            "email",
            "send_message",
            "user_message",
            "n8n",
            "browser",
            "github",
            "system_info",
        ],
    },
    {
        "id": "general",
        "label": "General",
        "description": "Chat, search, reminders, career tools and the Job Hunter.",
        "permissions": [
            "chat",
            "conversation_history",
            "web_search",
            "weather",
            "voice",
            "semantic_memory",
            "reminders",
            "calendar",
            "contacts",
            "clipboard",
            "career",
            "job_hunter",
        ],
    },
]


def _safe_user(value: str) -> str:
    user = str(value or "default").strip().lower()
    if not user or len(user) > 64 or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789._-" for c in user):
        raise HTTPException(status_code=400, detail="Invalid user_id")
    return user


def _store_path(name: str, user_id: str = "default") -> Path:
    return _BRIDGE_DATA_DIR / name / f"{_safe_user(user_id)}.json"


def _read_store(name: str, user_id: str = "default", default: Any = None) -> Any:
    path = _store_path(name, user_id)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _write_store(name: str, user_id: str, value: Any) -> None:
    path = _store_path(name, user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{secrets.token_hex(4)}.tmp")
    tmp.write_text(json.dumps(value, indent=2), encoding="utf-8")
    tmp.replace(path)


def _new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:12]}"


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _probe_loopback_port(port: int, timeout: float = 0.25) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


def _find_novnc_root() -> Optional[Path]:
    candidates = (
        Path("/opt/homebrew/share/novnc"),
        Path("/usr/local/share/novnc"),
        Path("/opt/homebrew/opt/novnc/share/novnc"),
        Path("/usr/local/opt/novnc/share/novnc"),
        Path("/usr/share/novnc"),
        Path("/usr/share/noVNC"),
    )
    return next((path for path in candidates if (path / "vnc.html").is_file()), None)


def _remote_setup_status() -> dict[str, Any]:
    websockify = _probe_loopback_port(6080)
    return {
        "screenSharing": _probe_loopback_port(5900),
        "websockify": websockify,
        "noVncUrl": "http://127.0.0.1:6080/vnc.html" if websockify else None,
    }


def _workflow_progress(workflow: dict[str, Any]) -> dict[str, int]:
    steps = workflow.get("steps") or []
    done = sum(1 for step in steps if step.get("status") in ("done", "skipped"))
    return {"done": done, "total": len(steps), "pct": round(done / len(steps) * 100) if steps else 0}


def _fail_workflow(workflow: dict[str, Any], message: str) -> None:
    workflow["status"] = "failed"
    workflow["updatedAt"] = _iso_now()
    workflow.setdefault("log", []).append({"at": workflow["updatedAt"], "msg": message})


def _run_workflow(workflow: dict[str, Any], max_steps: int) -> dict[str, Any]:
    steps = workflow.get("steps") or []
    if len(steps) > max_steps:
        raise ValueError(f"Workflow contains {len(steps)} steps; maximum is {max_steps}")
    by_id = {step.get("id"): step for step in steps}
    if len(by_id) != len(steps) or None in by_id:
        raise ValueError("Workflow contains duplicate or missing step ids")
    for step in steps:
        unknown = [dep for dep in step.get("deps", []) if dep not in by_id]
        if unknown:
            raise ValueError(f"Step {step['id']} references missing dependency {unknown[0]}")
    completed: set[str] = set()
    for _ in steps:
        progressed = False
        for step in steps:
            if step["id"] in completed or step.get("status") in ("done", "skipped"):
                completed.add(step["id"])
                continue
            if any(dep not in completed for dep in step.get("deps", [])):
                continue
            kind = step.get("kind", "manual")
            ref = step.get("ref", "")
            if kind == "manual":
                step["status"] = "skipped"
                message = "Skipped: manual steps require a human"
            elif kind == "command" and ref in (
                "bridge:health",
                "bridge:release-status",
                "bridge:deploy",
                "bridge:deploy-azure",
                "bridge:azure-deploy",
            ):
                step["status"] = "running"
                if ref == "bridge:health":
                    result = health()
                elif ref == "bridge:release-status":
                    result = _release_status()
                else:
                    result = _deploy_azure()
                step["status"] = "done"
                message = f"Completed {ref}" if result is None else f"Completed {ref}: {str(result)[:500]}"
            elif kind == "command" and ref.startswith("bridge:deploy"):
                step["status"] = "running"
                ref_parts = ref.split(":")
                environment = "staging"
                target = "static"
                if len(ref_parts) > 2:
                    environment = ref_parts[2]
                if len(ref_parts) > 3:
                    target = ref_parts[3]
                result = _deploy_azure(environment=environment, target=target)
                step["status"] = "done"
                message = f"Completed {ref}: {str(result)[:500]}"
            else:
                step["status"] = "failed"
                message = f"Unsupported workflow step: kind={kind!r}, ref={ref!r}"
                step.setdefault("log", []).append({"at": _iso_now(), "msg": message})
                raise ValueError(message)
            step.setdefault("log", []).append({"at": _iso_now(), "msg": message})
            completed.add(step["id"])
            progressed = True
        if len(completed) == len(steps):
            break
        if not progressed:
            raise ValueError("Workflow dependencies contain a cycle or blocked step")
    workflow["status"] = "done"
    workflow["updatedAt"] = _iso_now()
    return workflow


def _workflow_step(value: WorkflowStepRequest | dict[str, Any]) -> dict[str, Any]:
    data = value.model_dump() if isinstance(value, WorkflowStepRequest) else value
    return {
        "id": str(data.get("id") or _new_id("step-")),
        "title": str(data.get("title") or "Untitled step")[:200],
        "kind": data.get("kind") if data.get("kind") in ("agent", "skill", "command", "manual") else "manual",
        "ref": str(data.get("ref") or "")[:2000],
        "deps": [str(item) for item in data.get("deps", [])][:100],
        "status": data.get("status") if data.get("status") in ("pending", "running", "done", "failed", "blocked", "skipped") else "pending",
        "notes": str(data.get("notes") or "")[:4000],
        "log": list(data.get("log") or [])[-50:],
    }


_DEPLOY_ENVIRONMENTS = {"staging", "production", "dev"}
_DEPLOY_TARGET_ALIASES = {
    "static": "static",
    "azure-static": "static",
    "static-web-apps": "static",
    "swa": "static",
    "app": "app-service",
    "app-service": "app-service",
    "appservice": "app-service",
    "node": "app-service",
    "service": "app-service",
    "eas": "eas",
    "eas-build": "eas",
    "expo": "eas",
    "mobile": "eas",
}


def _normalize_deploy_environment(value: str) -> str:
    environment = (value or "staging").strip().lower()
    if environment not in _DEPLOY_ENVIRONMENTS:
        raise ValueError("Unsupported deployment environment; allowed: staging, production, dev")
    return environment


def _normalize_deploy_target(value: str) -> str:
    target = (value or "static").strip().lower().replace("_", "-")
    target = _DEPLOY_TARGET_ALIASES.get(target, target)
    allowed = {"static", "app-service", "eas"}
    if target not in allowed:
        raise ValueError("Unsupported deployment target; allowed: static, app-service, eas")
    return target


def _deploy_azure(environment: str = "staging", target: str = "static") -> dict[str, Any]:
    normalized_environment = _normalize_deploy_environment(environment)
    normalized_target = _normalize_deploy_target(target)
    script = Path(__file__).resolve().parent.parent / "scripts" / "deploy-azure.sh"
    if not script.exists():
        raise RuntimeError("Azure deployment script is not available")
    deploy_type_map = {"static": "1", "app-service": "2", "eas": "3"}
    command = [
        "bash",
        str(script),
        "--env",
        normalized_environment,
        "--type",
        deploy_type_map[normalized_target],
    ]
    try:
        proc = subprocess.run(
            command,
            cwd=str(script.parent.parent),
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
            env={**os.environ, "GF_NON_INTERACTIVE": "1"},
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"Azure deployment is unavailable: {exc}") from exc
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "deployment command failed").strip()
        raise RuntimeError(f"Azure deployment failed: {detail[:1000]}")
    out = (proc.stdout or proc.stderr or "Deployment started").strip()
    return {
        "environment": normalized_environment,
        "target": normalized_target,
        "output": out[:4000],
        "script": str(script),
    }


def _release_status() -> dict[str, Any]:
    package = Path(__file__).resolve().parent.parent / "package.json"
    version = "0.0.0"
    try:
        version = str(json.loads(package.read_text(encoding="utf-8")).get("version", version))
    except (OSError, ValueError):
        pass
    try:
        tag = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0"],
            cwd=package.parent, capture_output=True, text=True, timeout=10, check=False,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        tag = ""
    return {"version": version, "lastTag": tag or None}


# ---------------------------------------------------------------------------
# Original Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/mark-l/health", dependencies=[Depends(require_token)])
def health():
    unavailable = sorted(_MISSING)
    return {
        "ok": True,
        "service": "mark-l-bridge",
        "version": "2.0.0",
        "unavailable_modules": unavailable,
        "total_modules_checked": len(unavailable) + 24,
        "ai_modules": {
            "memory": _HAS_AI_MEMORY,
            "agents": _HAS_AI_AGENTS,
            "browser": _HAS_AI_BROWSER,
            "models": _HAS_AI_MODELS,
            "unified": _HAS_AI_UNIFIED,
            "openjarvis": _HAS_OPENJARVIS,
        },
    }


@app.post("/api/mark-l/web-search", dependencies=[Depends(require_token)])
def web_search_endpoint(req: WebSearchRequest):
    params: dict[str, Any] = {}
    if req.query:
        params["query"] = req.query
    if req.mode:
        params["mode"] = req.mode
    if req.items:
        params["items"] = req.items
    if req.aspect:
        params["aspect"] = req.aspect
    return _safe_call(_web_search, params)


@app.post("/api/mark-l/screen-capture", dependencies=[Depends(require_token)])
def screen_capture_endpoint(req: ScreenCaptureRequest):
    params: dict[str, Any] = {"angle": req.angle, "text": req.text}
    try:
        _screen_process(params)
        return _ok("Screen capture sent to vision session.")
    except Exception:
        logger.exception("screen_process failed")
        raise _err("screen_process failed: internal error")


@app.post("/api/mark-l/youtube", dependencies=[Depends(require_token)])
def youtube_endpoint(req: YoutubeRequest):
    params: dict[str, Any] = {"action": req.action}
    if req.query:
        params["query"] = req.query
    if req.url:
        params["url"] = req.url
    if req.region:
        params["region"] = req.region
    return _safe_call(_youtube_video, params)


@app.post("/api/mark-l/game-updater", dependencies=[Depends(require_token)])
def game_updater_endpoint(req: GameUpdaterRequest):
    params: dict[str, Any] = {"action": req.action}
    if req.game_name:
        params["game_name"] = req.game_name
    return _safe_call(_game_updater, params)


@app.post("/api/mark-l/system-status", dependencies=[Depends(require_token)])
def system_status_endpoint():
    return _safe_call(_get_system_status)


@app.post("/api/mark-l/computer-settings", dependencies=[Depends(require_token)])
def computer_settings_endpoint(req: ComputerSettingsRequest):
    params: dict[str, Any] = {}
    if req.action:
        params["action"] = req.action
    if req.description:
        params["description"] = req.description
    if req.value is not None:
        params["value"] = req.value
    if req.confirmed is not None:
        params["confirmed"] = req.confirmed
    return _safe_call(_computer_settings, params)


@app.post("/api/mark-l/computer-control", dependencies=[Depends(require_token)])
def computer_control_endpoint(req: ComputerControlRequest):
    params: dict[str, Any] = {}
    if req.action:
        params["action"] = req.action
    if req.description:
        params["description"] = req.description
    if req.value is not None:
        params["value"] = req.value
    if req.text:
        params["text"] = req.text
    if req.x is not None:
        params["x"] = req.x
    if req.y is not None:
        params["y"] = req.y
    if req.keys:
        params["keys"] = req.keys
    if req.key:
        params["key"] = req.key
    if req.direction:
        params["direction"] = req.direction
    if req.amount != 3:
        params["amount"] = req.amount
    if req.seconds != 1.0:
        params["seconds"] = req.seconds
    if req.title:
        params["title"] = req.title
    return _safe_call(_computer_control, params)


@app.post("/api/mark-l/browser-control", dependencies=[Depends(require_token)])
def browser_control_endpoint(req: BrowserControlRequest):
    params: dict[str, Any] = {}
    if req.action:
        params["action"] = req.action
    if req.url:
        params["url"] = req.url
    if req.text:
        params["text"] = req.text
    if req.value is not None:
        params["value"] = req.value
    if req.query:
        params["query"] = req.query
    if req.selector:
        params["selector"] = req.selector
    if req.description:
        params["description"] = req.description
    if req.engine:
        params["engine"] = req.engine
    if req.browser:
        params["browser"] = req.browser
    return _safe_call(_browser_control, params)


@app.post("/api/mark-l/file-process", dependencies=[Depends(require_token)])
def file_process_endpoint(req: FileProcessRequest):
    params: dict[str, Any] = {}
    if req.action:
        params["action"] = req.action
    if req.file_path:
        params["file_path"] = req.file_path
    if req.question:
        params["instruction"] = req.question
    if req.instruction:
        params["instruction"] = req.instruction
    return _safe_call(_file_processor, params)


@app.post("/api/mark-l/file-control", dependencies=[Depends(require_token)])
def file_control_endpoint(req: FileControlRequest):
    params: dict[str, Any] = {"action": req.action, "path": req.path}
    if req.new_path:
        params["destination"] = req.new_path
    if req.content:
        params["content"] = req.content
    if req.name:
        params["name"] = req.name
    if req.new_name:
        params["new_name"] = req.new_name
    if req.destination:
        params["destination"] = req.destination
    if req.extension:
        params["extension"] = req.extension
    if req.append:
        params["append"] = True
    return _safe_call(_file_controller, params)


@app.post("/api/mark-l/send-message", dependencies=[Depends(require_token)])
def send_message_endpoint(req: SendMessageRequest):
    params: dict[str, Any] = {
        "receiver": req.receiver,
        "message_text": req.message_text,
        "platform": req.platform,
    }
    return _safe_call(_send_message, params)


@app.post("/api/mark-l/weather", dependencies=[Depends(require_token)])
def weather_endpoint(req: WeatherRequest):
    params: dict[str, Any] = {"city": req.city}
    return _safe_call(_weather_action, params)


@app.post("/api/mark-l/flight-finder", dependencies=[Depends(require_token)])
def flight_finder_endpoint(req: FlightFinderRequest):
    params: dict[str, Any] = {
        "origin": req.from_city,
        "destination": req.to_city,
        "date": req.date,
    }
    if req.return_date:
        params["return_date"] = req.return_date
    if req.passengers:
        params["passengers"] = req.passengers
    if req.cabin:
        params["cabin"] = req.cabin
    return _safe_call(_flight_finder, params)


@app.post("/api/mark-l/reminder", dependencies=[Depends(require_token)])
def reminder_endpoint(req: ReminderRequest):
    params: dict[str, Any] = {
        "date": req.date,
        "time": req.time,
        "message": req.message,
    }
    return _safe_call(_reminder, params)


@app.post("/api/mark-l/open-app", dependencies=[Depends(require_token)])
def open_app_endpoint(req: OpenAppRequest):
    params: dict[str, Any] = {"app_name": req.app_name}
    return _safe_call(_open_app, params)


@app.post("/api/mark-l/desktop", dependencies=[Depends(require_token)])
def desktop_endpoint(req: DesktopRequest):
    params: dict[str, Any] = {}
    if req.action:
        params["action"] = req.action
    if req.description:
        params["description"] = req.description
    if req.task:
        params["task"] = req.task
    if req.path:
        params["path"] = req.path
    if req.url:
        params["url"] = req.url
    if req.mode:
        params["mode"] = req.mode
    return _safe_call(_desktop_control, params)


@app.post("/api/mark-l/code-helper", dependencies=[Depends(require_token)])
def code_helper_endpoint(req: CodeHelperRequest):
    params: dict[str, Any] = {"action": req.action}
    if req.code:
        params["code"] = req.code
    if req.language:
        params["language"] = req.language
    if req.description:
        params["description"] = req.description
    if req.file_path:
        params["file_path"] = req.file_path
    if req.output_path:
        params["output_path"] = req.output_path
    if req.timeout:
        params["timeout"] = req.timeout
    return _safe_call(_code_helper, params)


@app.post("/api/mark-l/dev-agent", dependencies=[Depends(require_token)])
def dev_agent_endpoint(req: DevAgentRequest):
    params: dict[str, Any] = {}
    if req.task:
        params["description"] = req.task
    if req.language:
        params["language"] = req.language
    if req.project_name:
        params["project_name"] = req.project_name
    return _safe_call(_dev_agent, params)


@app.post("/api/mark-l/clipboard", dependencies=[Depends(require_token)])
def clipboard_endpoint(req: ClipboardRequest):
    action = req.action.lower().strip()

    if not _HAS_CLIPBOARD:
        raise _err("pyperclip is not installed on the server.", status=503)

    try:
        if action == "get" or action == "read" or action == "paste":
            content = _pyperclip.paste()
            return _ok({"clipboard": content})
        elif action == "set" or action == "write" or action == "copy":
            _pyperclip.copy(req.text)
            return _ok("Clipboard set.")
        else:
            raise _err(
                f"Unknown clipboard action: '{action}'. Use 'get' or 'set'.", status=400
            )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Clipboard error")
        raise _err("Clipboard error: internal error")


def _get_ocr_engine():
    """Lazily initialize the shared PaddleOCR engine."""
    global _ocr_engine
    if not _HAS_OCR:
        raise _err("paddleocr is not installed on the server.", status=503)
    if _ocr_engine is None:
        _ocr_engine = _PaddleOCR(use_angle_cls=True, lang="en")  # type: ignore[attr-defined]
    return _ocr_engine


@app.post("/api/mark-l/ocr", dependencies=[Depends(require_token)])
async def ocr_endpoint(image: UploadFile = File(...)):
    """Extract all text from an uploaded image using PaddleOCR."""
    data = await image.read()
    if not data:
        raise _err("No image provided", status=400)
    _require_module("ocr", _HAS_OCR)
    try:
        ext = (image.filename or "img.png").rsplit(".", 1)[-1].lower()
        tmp = str(tmp_path(f"gfai-ocr-{secrets.token_hex(4)}.{ext}"))
        with open(tmp, "wb") as fh:
            fh.write(data)
        engine = _get_ocr_engine()
        result = engine.ocr(tmp, cls=True)
        lines: list[str] = []
        for page in result or []:
            for item in page or []:
                text = item[1][0]
                if text and text.strip():
                    lines.append(text.strip())
        return _ok({"text": "\n".join(lines), "lines": len(lines)})
    except HTTPException:
        raise
    except Exception:
        logger.exception("OCR failed")
        raise _err("OCR failed: internal error")
    finally:
        try:
            os.remove(tmp)
        except (OSError, NameError, UnboundLocalError):
            pass


def tmp_path(suffix: str) -> str:
    """Return a temp filename under the system temp dir."""
    import tempfile as _tf

    return os.path.join(_tf.gettempdir(), suffix)


# ---------------------------------------------------------------------------
# AI Memory Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/mark-l/memory/add", dependencies=[Depends(require_token)])
def memory_add_endpoint(req: MemoryAddRequest):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(
        _ai_add_memory, req.content, req.user_id, req.metadata, req.category
    )


@app.post("/api/mark-l/memory/search", dependencies=[Depends(require_token)])
def memory_search_endpoint(req: MemorySearchRequest):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_search_memory, req.query, req.user_id, req.top_k)


@app.get("/api/mark-l/memory/list/{user_id}", dependencies=[Depends(require_token)])
def memory_list_endpoint(user_id: str):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_list_memories, user_id)


@app.delete("/api/mark-l/memory/{memory_id}", dependencies=[Depends(require_token)])
def memory_delete_endpoint(memory_id: str):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_delete_memory, memory_id)


@app.put("/api/mark-l/memory/{memory_id}", dependencies=[Depends(require_token)])
def memory_update_endpoint(memory_id: str, req: MemoryUpdateRequest):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_update_memory, memory_id, req.content)


@app.get("/api/mark-l/memory/stats/{user_id}", dependencies=[Depends(require_token)])
def memory_stats_endpoint(user_id: str):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_get_memory_stats, user_id)


@app.post("/api/mark-l/memory/export", dependencies=[Depends(require_token)])
def memory_export_endpoint(req: MemoryExportRequest):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_export_memories, req.user_id)


@app.post("/api/mark-l/memory/import", dependencies=[Depends(require_token)])
def memory_import_endpoint(req: MemoryImportRequest):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_import_memories, req.memories_json, req.user_id)


# ---------------------------------------------------------------------------
# AI Agent Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/mark-l/agents/crew/create", dependencies=[Depends(require_token)])
def crew_create_endpoint(req: CrewCreateRequest):
    _require_module("ai_agents", _HAS_AI_AGENTS)
    return _safe_call(
        _ai_create_crew,
        req.agents_config,
        req.tasks_config,
        req.crew_id,
        req.template_name,
        req.process,
    )


@app.post(
    "/api/mark-l/agents/crew/{crew_id}/run", dependencies=[Depends(require_token)]
)
def crew_run_endpoint(crew_id: str, req: CrewRunRequest):
    _require_module("ai_agents", _HAS_AI_AGENTS)
    return _safe_call(_ai_run_crew, crew_id, req.inputs)


@app.get(
    "/api/mark-l/agents/crew/{crew_id}/status", dependencies=[Depends(require_token)]
)
def crew_status_endpoint(crew_id: str):
    _require_module("ai_agents", _HAS_AI_AGENTS)
    return _safe_call(_ai_get_crew_status, crew_id)


@app.get("/api/mark-l/agents/crews/list", dependencies=[Depends(require_token)])
def crew_list_endpoint():
    _require_module("ai_agents", _HAS_AI_AGENTS)
    return _safe_call(_ai_list_crews)


@app.get("/api/mark-l/agents/templates", dependencies=[Depends(require_token)])
def crew_templates_endpoint():
    _require_module("ai_agents", _HAS_AI_AGENTS)
    return _safe_call(_ai_get_templates)


@app.post(
    "/api/mark-l/agents/crew/{crew_id}/cancel", dependencies=[Depends(require_token)]
)
def crew_cancel_endpoint(crew_id: str):
    _require_module("ai_agents", _HAS_AI_AGENTS)
    return _safe_call(_ai_cancel_crew, crew_id)


# ---------------------------------------------------------------------------
# AI Browser Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/mark-l/browser/browse", dependencies=[Depends(require_token)])
def browser_browse_endpoint(req: BrowserBrowseRequest):
    _require_module("ai_browser", _HAS_AI_BROWSER)
    return _safe_call(_ai_browse, req.url, req.task)


@app.post("/api/mark-l/browser/extract", dependencies=[Depends(require_token)])
def browser_extract_endpoint(req: BrowserExtractRequest):
    _require_module("ai_browser", _HAS_AI_BROWSER)
    return _safe_call(_ai_extract, req.url, req.selectors)


@app.post("/api/mark-l/browser/screenshot", dependencies=[Depends(require_token)])
def browser_screenshot_endpoint(req: BrowserScreenshotRequest):
    _require_module("ai_browser", _HAS_AI_BROWSER)
    return _safe_call(_ai_screenshot, req.url)


@app.post("/api/mark-l/browser/search", dependencies=[Depends(require_token)])
def browser_search_endpoint(req: BrowserSearchRequest):
    _require_module("ai_browser", _HAS_AI_BROWSER)
    return _safe_call(_ai_browser_search, req.query)


@app.post("/api/mark-l/browser/fill-form", dependencies=[Depends(require_token)])
def browser_fill_form_endpoint(req: BrowserFillFormRequest):
    _require_module("ai_browser", _HAS_AI_BROWSER)
    return _safe_call(_ai_fill_form, req.url, req.form_data)


@app.post("/api/mark-l/browser/click", dependencies=[Depends(require_token)])
def browser_click_endpoint(req: BrowserClickRequest):
    _require_module("ai_browser", _HAS_AI_BROWSER)
    return _safe_call(_ai_click, req.url, req.selector)


# ---------------------------------------------------------------------------
# AI Model Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/mark-l/models/search", dependencies=[Depends(require_token)])
def model_search_endpoint(q: str = "", limit: int = 10, sort: str = "downloads"):
    _require_module("ai_models", _HAS_AI_MODELS)
    return _safe_call(_ai_search_models, q, limit, sort)


# NOTE: the more specific /models/* routes MUST be registered before the
# /models/{model_id:path} catch-all below, otherwise they would be
# shadowed and never match.
@app.get("/api/mark-l/models/local", dependencies=[Depends(require_token)])
def model_local_endpoint():
    _require_module("ai_models", _HAS_AI_MODELS)
    return _safe_call(_ai_list_local_models)


@app.get("/api/mark-l/models/recommendations", dependencies=[Depends(require_token)])
def model_recommendations_endpoint(task: str = "text-generation"):
    _require_module("ai_models", _HAS_AI_MODELS)
    return _safe_call(_ai_get_model_recommendations, task)


@app.get("/api/mark-l/models/compare", dependencies=[Depends(require_token)])
def model_compare_endpoint(ids: str = ""):
    _require_module("ai_models", _HAS_AI_MODELS)
    model_ids = [mid.strip() for mid in ids.split(",") if mid.strip()]
    return _safe_call(_ai_compare_models, model_ids)


@app.get("/api/mark-l/models/{model_id:path}", dependencies=[Depends(require_token)])
def model_info_endpoint(model_id: str):
    _require_module("ai_models", _HAS_AI_MODELS)
    return _safe_call(_ai_get_model_info, model_id)


@app.post("/api/mark-l/models/download", dependencies=[Depends(require_token)])
def model_download_endpoint(req: ModelDownloadRequest):
    _require_module("ai_models", _HAS_AI_MODELS)
    return _safe_call(_ai_download_model, req.model_id, req.local_dir)


@app.post("/api/mark-l/models/install", dependencies=[Depends(require_token)])
def model_install_endpoint(req: ModelInstallRequest):
    _require_module("ai_models", _HAS_AI_MODELS)
    return _safe_call(_ai_install_model, req.model_id)


# ---------------------------------------------------------------------------
# Unified Chat Endpoint
# ---------------------------------------------------------------------------


@app.post("/api/mark-l/chat/unified", dependencies=[Depends(require_token)])
def unified_chat_endpoint(req: UnifiedChatRequest):
    _require_module("ai_unified", _HAS_AI_UNIFIED)
    try:
        agent = _UnifiedAgent(user_id=req.user_id)
        result = agent.process(req.message, req.context)
        return _ok(result)
    except Exception:
        logger.exception("unified_chat failed")
        raise _err("unified_chat failed: internal error")


@app.post("/api/mark-l/chat/chain", dependencies=[Depends(require_token)])
def unified_chain_endpoint(req: UnifiedChainRequest):
    _require_module("ai_unified", _HAS_AI_UNIFIED)
    try:
        agent = _UnifiedAgent(user_id=req.user_id)
        steps = [s.model_dump() for s in req.steps]
        result = agent.chain(steps)
        return _ok(result)
    except Exception:
        logger.exception("unified_chain failed")
        raise _err("unified_chain failed: internal error")


# ---------------------------------------------------------------------------
# Mark-LIV tool registry — every actions/*.py TOOL, discovered like Mark-LIV's
# own desktop app does, so JARVIS gets the full action set with no per-tool
# wiring here.
# ---------------------------------------------------------------------------

_registry = None


def _mark_liv_registry():
    global _registry
    if _registry is None:
        from core.action_loader import discover_actions

        _registry = discover_actions(
            _MARK_LIV_DIR / "actions",
            logger=lambda msg: logger.info("[mark-liv] %s", msg),
        )
    return _registry


class MarkLivRunRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    parameters: dict[str, Any] = Field(default_factory=dict)


@app.get("/api/mark-liv/tools", dependencies=[Depends(require_token)])
def mark_liv_tools():
    try:
        return _ok({"dir": str(_MARK_LIV_DIR), "tools": _mark_liv_registry().get_tool_declarations()})
    except Exception:
        logger.exception("mark-liv tool discovery failed")
        raise _err("Mark-LIV tool discovery failed")


@app.post("/api/mark-liv/run", dependencies=[Depends(require_token)])
def mark_liv_run(req: MarkLivRunRequest):
    registry = _mark_liv_registry()
    if req.name not in registry.names():
        raise HTTPException(status_code=404, detail=f"Unknown Mark-LIV tool: {req.name}")
    try:
        result = registry.run(req.name, req.parameters)
        return _ok({"tool": req.name, "result": str(result) if result is not None else "Done"})
    except Exception as exc:
        logger.exception("mark-liv %s failed", req.name)
        return _ok({"tool": req.name, "result": f"{req.name} failed: {exc}", "error": True})


# ---------------------------------------------------------------------------
# OpenJarvis (opt-in local-first agent framework, Apache-2.0)
#
# Not vendored and not pip-importable — it ships as the `jarvis` CLI (see
# marketplace/catalog.json "openjarvis" for the installer). The bridge shells
# out to that CLI with a fixed argv list (never shell=True) so there is no
# command-injection surface, and returns a clear 503 stub when it isn't
# installed.
# ---------------------------------------------------------------------------


class OpenJarvisAskRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    timeout_s: int = Field(default=60, ge=1, le=300)


@app.get("/api/openjarvis/health", dependencies=[Depends(require_token)])
def openjarvis_health():
    return _ok(
        {
            "installed": _HAS_OPENJARVIS,
            "binary": _OPENJARVIS_BIN,
        }
    )


@app.get("/api/openjarvis/doctor", dependencies=[Depends(require_token)])
def openjarvis_doctor():
    _require_module("openjarvis", _HAS_OPENJARVIS)
    return _safe_call(_run_openjarvis_cli, "doctor", timeout_s=30)


@app.post("/api/openjarvis/ask", dependencies=[Depends(require_token)])
def openjarvis_ask(req: OpenJarvisAskRequest):
    _require_module("openjarvis", _HAS_OPENJARVIS)
    try:
        response = _run_openjarvis_cli("ask", req.prompt, timeout_s=req.timeout_s)
        return _ok({"response": response})
    except subprocess.TimeoutExpired:
        raise _err("openjarvis ask timed out", status=504)
    except Exception:
        logger.exception("openjarvis ask failed")
        raise _err("openjarvis ask failed: internal error")


# ---------------------------------------------------------------------------
# Collaboration
# ---------------------------------------------------------------------------


@app.get("/api/jarvis/collab", dependencies=[Depends(require_token)])
def collab_get(id: Optional[str] = None):
    """Create a session when no id is supplied, matching the web contract."""
    if not id:
        session_id = _new_id()
        _COLLAB_SESSIONS[session_id] = {"messages": [], "createdAt": time.time(), "participants": 1}
        return {"id": session_id, "shareUrl": f"/jarvis?session={session_id}"}
    if id not in _COLLAB_SESSIONS:
        raise HTTPException(status_code=404, detail="Session not found")
    session = _COLLAB_SESSIONS[id]
    session["participants"] += 1
    return {"id": id, "messages": session["messages"], "participants": session["participants"]}


@app.post("/api/jarvis/collab", dependencies=[Depends(require_token)])
def collab_post(req: CollabMessageRequest):
    if req.role not in ("user", "assistant"):
        raise HTTPException(status_code=400, detail="Invalid role")
    session = _COLLAB_SESSIONS.get(req.id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session["messages"].append({"role": req.role, "content": req.content, "ts": int(time.time() * 1000)})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Job Hunter bridge-safe adapter
# ---------------------------------------------------------------------------

_JOB_HUNTER_DIR = Path.home() / ".ghostforge" / "jobs"


def _ghostforge_users() -> list[dict[str, Any]]:
    try:
        users = json.loads(_GHOSTFORGE_USERS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if isinstance(users, dict):
        users = users.get("users", [])
    if not isinstance(users, list):
        return []

    public: list[dict[str, Any]] = []
    for user in users:
        if not isinstance(user, dict):
            continue
        username = str(user.get("username") or "").strip()
        if not username:
            continue
        role = user.get("role")
        if role not in ("admin", "user"):
            role = "user"
        permissions = user.get("permissions")
        if not isinstance(permissions, list):
            permissions = []
        public.append(
            {
                "username": username,
                "role": role,
                "permissions": [str(p).strip() for p in permissions if isinstance(p, str) and str(p).strip()],
            }
        )
    public.sort(key=lambda item: item["username"].lower())
    return public


def _jarvis_user_snapshot() -> dict[str, Any]:
    return {
        "users": _ghostforge_users(),
        "profiles": [
            {
                "id": profile["id"],
                "label": profile["label"],
                "description": profile["description"],
                "permissions": profile["permissions"],
            }
            for profile in _ACCESS_PROFILES
        ],
    }


@app.get("/api/jarvis/users", dependencies=[Depends(require_token)])
def jarvis_users_get():
    return _jarvis_user_snapshot()


@app.get("/api/jarvis/access-profiles", dependencies=[Depends(require_token)])
def jarvis_access_profiles_get():
    return {"profiles": _jarvis_user_snapshot()["profiles"]}


def _job_hunter_user_dir(user_id: str) -> Path:
    safe = _safe_user(user_id)
    return _JOB_HUNTER_DIR / safe


def _job_hunter_read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _job_hunter_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{secrets.token_hex(4)}.tmp")
    tmp.write_text(json.dumps(value, indent=2), encoding="utf-8")
    tmp.replace(path)


def _job_hunter_profile(user_id: str) -> dict[str, Any]:
    path = _job_hunter_user_dir(user_id) / "profile.json"
    data = _job_hunter_read_json(path, {})
    return data if isinstance(data, dict) else {}


def _job_hunter_jobs(user_id: str) -> list[dict[str, Any]]:
    path = _job_hunter_user_dir(user_id) / "jobs.json"
    jobs = _job_hunter_read_json(path, [])
    return jobs if isinstance(jobs, list) else []


def _bridge_jobs(user_id: str) -> list[dict[str, Any]]:
    jobs = _read_store("jobs", user_id, None)
    return jobs if isinstance(jobs, list) else _job_hunter_jobs(user_id)


def _persist_jobs(user_id: str, jobs: list[dict[str, Any]]) -> None:
    _write_store("jobs", user_id, jobs)
    _job_hunter_write_json(_job_hunter_user_dir(user_id) / "jobs.json", jobs)


def _job_hunter_missing_fields(profile: dict[str, Any]) -> list[str]:
    applicant = profile.get("applicant") or {}
    missing: list[str] = []
    if not profile.get("cv"):
        missing.append("CV")
    if not applicant.get("firstName"):
        missing.append("First name")
    if not applicant.get("lastName"):
        missing.append("Last name")
    if not applicant.get("email"):
        missing.append("Email")
    if not applicant.get("phone"):
        missing.append("Phone")
    return missing


def _job_hunter_terms(profile: dict[str, Any], requested: list[str]) -> list[str]:
    base = requested if requested else ((profile.get("preferences") or {}).get("titles") or [])
    cleaned: list[str] = []
    seen: set[str] = set()
    for term in base[:5]:
        value = str(term or "").strip()
        key = value.lower()
        if value and key not in seen:
            cleaned.append(value)
            seen.add(key)
    return cleaned


def _job_hunter_matches(job: dict[str, Any], terms: list[str]) -> bool:
    haystack = " ".join(
        [
            str(job.get("title") or ""),
            str(job.get("company") or ""),
            str(job.get("description") or ""),
            str(job.get("location") or ""),
        ]
    ).lower()
    return any(term.lower() in haystack for term in terms)


def _job_hunter_prepare_matches(user_id: str, jobs: list[dict[str, Any]], terms: list[str], limit: int) -> tuple[int, int]:
    matched = [job for job in jobs if not job.get("status") == "dismissed" and _job_hunter_matches(job, terms)]
    prepared = 0
    for job in matched:
        if prepared >= limit:
            break
        if job.get("status") not in {"found", "ready", "failed", "needs_user"}:
            continue
        job["status"] = "ready"
        job.setdefault("log", [])
        job["log"].append({"at": _iso_now(), "msg": "Bridge autopilot prepared for review"})
        job["updatedAt"] = _iso_now()
        prepared += 1
    if prepared:
        _persist_jobs(user_id, jobs)
    return len(matched), prepared


@app.get("/api/jobs", dependencies=[Depends(require_token)])
def jobs_get(user_id: str = "default"):
    user = _safe_user(user_id)
    profile = _job_hunter_profile(user)
    jobs = _bridge_jobs(user)
    autopilot = (profile.get("autopilot") or {})
    submitted_by_day = autopilot.get("submittedByDay") or {}
    submitted_today = sum(int(v) for v in submitted_by_day.values() if isinstance(v, (int, float)))
    return {
        "jobs": jobs,
        "ready": {
            "hasCv": bool(profile.get("cv")),
            "missing": _job_hunter_missing_fields(profile),
            "titles": (profile.get("preferences") or {}).get("titles", []),
        },
        "autopilot": {
            "enabled": bool(autopilot.get("enabled")),
            "submittedToday": submitted_today,
            "dailyLimit": autopilot.get("dailyLimit", 5),
            "minScore": autopilot.get("minScore", 75),
        },
    }


@app.post("/api/jobs", dependencies=[Depends(require_token)])
def jobs_post(req: JobActionRequest):
    user_id = _safe_user(req.user_id)
    if req.action == "search":
        profile = _job_hunter_profile(user_id)
        if not profile.get("cv"):
            raise HTTPException(status_code=400, detail="Upload your CV first")
        terms = _job_hunter_terms(profile, [str(term) for term in req.terms])
        if not terms:
            raise HTTPException(status_code=400, detail="Add at least one target role")
        jobs = _bridge_jobs(user_id)
        matched = [job for job in jobs if job.get("status") != "dismissed" and _job_hunter_matches(job, terms)]
        prepared = 0
        queue = [job for job in matched if job.get("status") in {"found", "ready", "failed", "needs_user"}][: max(0, min(req.auto_prepare, 5))]
        for job in queue:
            if job.get("status") != "ready":
                job["status"] = "ready"
                job["updatedAt"] = _iso_now()
                job.setdefault("log", []).append({"at": _iso_now(), "msg": "Bridge search prepared for approval"})
                prepared += 1
        if queue:
            _persist_jobs(user_id, jobs)
        result = {"terms": terms, "found": len(jobs), "matched": len(matched), "added": len(matched), "prepared": prepared}
        return {"result": result}
    if req.action in ("prepare", "approve", "dismiss"):
        jobs = _bridge_jobs(user_id)
        job = next((item for item in jobs if item.get("id") == req.id), None)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        job["status"] = {"prepare": "ready", "approve": "submitted", "dismiss": "dismissed"}[req.action]
        _persist_jobs(user_id, jobs)
        return {"job": job}
    if req.action == "autopilot":
        profile = _job_hunter_profile(user_id)
        autopilot = profile.get("autopilot") or {}
        if isinstance(autopilot, dict) and autopilot.get("enabled") is False:
            return {"report": {"found": 0, "prepared": 0, "submitted": 0, "needsUser": 0, "failed": 0, "reason": "Autopilot is off"}}
        terms = _job_hunter_terms(profile, [])
        if not profile.get("cv"):
            raise HTTPException(status_code=400, detail="Upload your CV first")
        if not terms:
            raise HTTPException(status_code=400, detail="Add at least one target role")
        jobs = _bridge_jobs(user_id)
        matched = [job for job in jobs if job.get("status") != "dismissed" and _job_hunter_matches(job, terms)]
        prepared_limit = max(0, int(autopilot.get("dailyLimit", 3) or 3))
        found_count, prepared = _job_hunter_prepare_matches(user_id, jobs, terms, prepared_limit)
        report = {
            "found": found_count,
            "prepared": prepared,
            "submitted": 0,
            "needsUser": max(0, found_count - prepared),
            "failed": 0,
            "reason": "Bridge-safe autopilot is in review-only mode; no external submit is allowed",
        }
        return {"report": report}
    raise HTTPException(status_code=400, detail="Unknown action")


# ---------------------------------------------------------------------------
# Workflows
# ---------------------------------------------------------------------------


@app.get("/api/workflows", dependencies=[Depends(require_token)])
def workflows_get(user_id: str = "default", id: Optional[str] = None):
    workflows = _read_store("workflows", user_id, [])
    if id:
        workflow = next((item for item in workflows if item.get("id") == id), None)
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return {"workflow": workflow, "progress": _workflow_progress(workflow), "ready": []}
    return {"workflows": [{**item, "progress": _workflow_progress(item)} for item in workflows]}


@app.post("/api/workflows", dependencies=[Depends(require_token)])
def workflows_create(req: WorkflowRequest):
    if req.action is not None:
        if req.action != "run":
            raise HTTPException(status_code=400, detail="Unknown workflow action")
        if not req.id:
            raise HTTPException(status_code=400, detail="Workflow id required")
        user_id = _safe_user(req.user_id)
        workflows = _read_store("workflows", user_id, [])
        workflow = next((item for item in workflows if item.get("id") == req.id), None)
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")
        workflow["status"] = "running"
        workflow["updatedAt"] = _iso_now()
        try:
            _run_workflow(workflow, req.max_steps)
        except ValueError as exc:
            _fail_workflow(workflow, str(exc))
            _write_store("workflows", user_id, workflows)
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        _write_store("workflows", user_id, workflows)
        return {"workflow": workflow, "progress": _workflow_progress(workflow)}
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="A workflow name is required")
    user_id = _safe_user(req.user_id)
    now = _iso_now()
    workflow = {
        "id": _new_id("wf-"), "name": req.name[:200], "goal": (req.goal or "")[:4000],
        "status": "draft", "steps": [_workflow_step(step) for step in (req.steps or [])[:100]],
        "createdAt": now, "updatedAt": now,
    }
    workflows = _read_store("workflows", user_id, [])
    workflows.append(workflow)
    _write_store("workflows", user_id, workflows)
    return {"workflow": workflow}


@app.put("/api/workflows", dependencies=[Depends(require_token)])
def workflows_update(req: WorkflowRequest):
    if not req.id:
        raise HTTPException(status_code=400, detail="Workflow id required")
    user_id = _safe_user(req.user_id)
    workflows = _read_store("workflows", user_id, [])
    workflow = next((item for item in workflows if item.get("id") == req.id), None)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if req.step_id and req.step is not None:
        step = next((item for item in workflow["steps"] if item.get("id") == req.step_id), None)
        if not step:
            raise HTTPException(status_code=404, detail="Workflow or step not found")
        step.update({key: value for key, value in req.step.items() if key in ("status", "notes", "title", "ref")})
        if req.log:
            step.setdefault("log", []).append({"msg": req.log})
    else:
        if req.name is not None:
            workflow["name"] = req.name[:200]
        if req.goal is not None:
            workflow["goal"] = req.goal[:4000]
        # Omitted status means preserve the current status, never reset to draft.
        if req.status is not None:
            workflow["status"] = req.status
        if req.steps is not None:
            workflow["steps"] = [_workflow_step(step) for step in req.steps[:100]]
    workflow["updatedAt"] = _iso_now()
    _write_store("workflows", user_id, workflows)
    return {"workflow": workflow, "progress": _workflow_progress(workflow)}


@app.delete("/api/workflows", dependencies=[Depends(require_token)])
def workflows_delete(user_id: str = "default", id: Optional[str] = None):
    if not id:
        raise HTTPException(status_code=400, detail="Workflow id required")
    workflows = _read_store("workflows", user_id, [])
    next_workflows = [item for item in workflows if item.get("id") != id]
    _write_store("workflows", user_id, next_workflows)
    return {"ok": len(next_workflows) != len(workflows)}


# ---------------------------------------------------------------------------
# n8n automation (bounded list/trigger over the shipped workflow definitions)
# ---------------------------------------------------------------------------

_N8N_WORKFLOW_DIR = Path(__file__).resolve().parent.parent / "electron-app" / "n8n-workflows"
_N8N_DEFAULT_URL = "http://localhost:5678"
_N8N_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_N8N_PATH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
_N8N_MAX_PAYLOAD_BYTES = 16 * 1024
_N8N_MAX_RESPONSE_BYTES = 64 * 1024
_N8N_TIMEOUT_SECONDS = 10
_N8N_FORBIDDEN_PAYLOAD_KEYS = {"url", "webhookurl", "command", "cmd", "script", "shell"}


class N8nTriggerRequest(BaseModel):
    id: str = Field(max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)


def _n8n_load_workflows() -> dict[str, dict[str, Any]]:
    """Discover workflows from the shipped definitions, keyed by file-stem id."""
    found: dict[str, dict[str, Any]] = {}
    if not _N8N_WORKFLOW_DIR.is_dir():
        return found
    for path in sorted(_N8N_WORKFLOW_DIR.glob("*.json")):
        workflow_id = path.stem.lower()
        if not _N8N_ID_RE.match(workflow_id):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict):
            continue
        webhook = next(
            (
                node.get("parameters") or {}
                for node in data.get("nodes") or []
                if isinstance(node, dict) and node.get("type") == "n8n-nodes-base.webhook"
            ),
            None,
        )
        method = str((webhook or {}).get("httpMethod") or "").upper()
        hook_path = str((webhook or {}).get("path") or "")
        triggerable = (
            webhook is not None
            and method == "POST"
            and bool(_N8N_PATH_RE.match(hook_path))
            and data.get("active") is not False
        )
        found[workflow_id] = {
            "id": workflow_id,
            "name": str(data.get("name") or workflow_id)[:200],
            "active": data.get("active") is not False,
            "triggerable": triggerable,
            "webhookMethod": method or None,
            "webhookPath": hook_path if triggerable else None,
        }
    return found


def _n8n_base_url() -> str:
    """Return the configured n8n origin; only credential-free loopback http(s) is allowed."""
    raw = (os.environ.get("GHOSTFORGE_N8N_URL") or _N8N_DEFAULT_URL).strip()
    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError:
        raise _err("n8n endpoint is not configured correctly", status=503)
    if (
        parsed.scheme not in ("http", "https")
        or parsed.hostname not in ("localhost", "127.0.0.1", "::1")
        or parsed.username
        or parsed.password
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise _err("n8n endpoint must be a loopback http(s) origin", status=503)
    host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
    return f"{parsed.scheme}://{host}" + (f":{port}" if port else "")


def _n8n_check_payload(value: Any, depth: int = 0) -> None:
    if depth > 6:
        raise HTTPException(status_code=400, detail="Payload is nested too deeply")
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).lower() in _N8N_FORBIDDEN_PAYLOAD_KEYS:
                raise HTTPException(status_code=400, detail=f"Payload key {str(key)[:40]!r} is not allowed")
            _n8n_check_payload(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            _n8n_check_payload(item, depth + 1)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: D401 - never follow redirects
        return None


def _n8n_post(url: str, body: bytes) -> tuple[int, bytes]:
    """POST *body* to *url* without redirects; returns (status, bounded response)."""
    request = urllib.request.Request(
        url, data=body, method="POST", headers={"Content-Type": "application/json"}
    )
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=_N8N_TIMEOUT_SECONDS) as response:
            return response.status, response.read(_N8N_MAX_RESPONSE_BYTES)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(_N8N_MAX_RESPONSE_BYTES)


@app.get("/api/n8n/workflows", dependencies=[Depends(require_token)])
def n8n_workflows_get():
    workflows = list(_n8n_load_workflows().values())
    return {"workflows": workflows, "count": len(workflows)}


@app.post("/api/n8n/trigger", dependencies=[Depends(require_token)])
def n8n_trigger(req: N8nTriggerRequest):
    workflow_id = req.id.strip().lower()
    if not _N8N_ID_RE.match(workflow_id):
        raise HTTPException(status_code=400, detail="Invalid workflow id")
    workflow = _n8n_load_workflows().get(workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if not workflow["triggerable"]:
        raise HTTPException(status_code=409, detail="Workflow has no active POST webhook")
    _n8n_check_payload(req.payload)
    body = json.dumps(req.payload).encode("utf-8")
    if len(body) > _N8N_MAX_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Payload is too large")
    url = f"{_n8n_base_url()}/webhook/{workflow['webhookPath']}"
    try:
        status, raw = _n8n_post(url, body)
    except (urllib.error.URLError, OSError, TimeoutError):
        logger.warning("n8n trigger for %s failed to connect", workflow_id)
        raise _err("n8n is unreachable", status=502)
    if status >= 400:
        raise _err(f"n8n rejected the trigger (HTTP {status})", status=502)
    text = raw.decode("utf-8", errors="replace")
    try:
        result: Any = json.loads(text)
    except ValueError:
        result = text[:2000]
    return {"ok": True, "id": workflow_id, "status": status, "result": result}


# ---------------------------------------------------------------------------
# Webhooks, devices, and release status/actions
# ---------------------------------------------------------------------------


@app.get("/api/webhook", dependencies=[Depends(require_token)])
def webhook_get(log: int = 0):
    if log == 1:
        return _read_store("webhook-log", "default", [])
    return _read_store("webhooks", "default", [])


@app.post("/api/webhook", dependencies=[Depends(require_token)])
def webhook_post(req: WebhookRequest):
    if req.config is not None:
        _write_store("webhooks", "default", req.config)
        return {"ok": True}
    log = _read_store("webhook-log", "default", [])
    log.insert(0, {"source": req.source[:80], "event": req.event[:80], "body": req.body, "receivedAt": _iso_now()})
    _write_store("webhook-log", "default", log[:200])
    return {"ok": True, "event": req.event, "prompted": True}


@app.delete("/api/webhook", dependencies=[Depends(require_token)])
def webhook_delete():
    _write_store("webhook-log", "default", [])
    return {"ok": True}


@app.get("/api/devices", dependencies=[Depends(require_token)])
def devices_get(user_id: str = "default"):
    return {"devices": _read_store("devices", user_id, []), "user": _safe_user(user_id)}


@app.post("/api/devices", dependencies=[Depends(require_token)])
def devices_post(req: DeviceRequest):
    user_id = _safe_user(req.user_id)
    devices = _read_store("devices", user_id, [])
    device = req.model_dump()
    device.pop("user_id", None)
    device["updatedAt"] = _iso_now()
    devices = [item for item in devices if item.get("id") != req.id] + [device]
    _write_store("devices", user_id, devices)
    return {"device": device, "devices": devices}


@app.delete("/api/devices", dependencies=[Depends(require_token)])
def devices_delete(user_id: str = "default", id: Optional[str] = None):
    if not id:
        raise HTTPException(status_code=400, detail="Missing device id")
    devices = _read_store("devices", user_id, [])
    next_devices = [item for item in devices if item.get("id") != id]
    _write_store("devices", user_id, next_devices)
    if len(next_devices) == len(devices):
        raise HTTPException(status_code=404, detail="Device not found")
    return {"ok": True}


@app.get("/api/devices/status", dependencies=[Depends(require_token)])
def devices_status(user_id: str = "default"):
    safe_user = _safe_user(user_id)
    _require_module("system_monitor", "system_monitor" not in _MISSING)
    try:
        metrics = _get_system_status()
    except Exception:
        logger.exception("system_monitor status failed")
        raise _err("Live device status is unavailable", status=503)
    if not isinstance(metrics, dict) or metrics.get("error"):
        raise _err("Live device status is unavailable", status=503)
    return {
        "status": "online",
        "user": safe_user,
        "device": {
            "hostname": socket.gethostname(),
            "platform": platform.system().lower(),
            "platformLabel": platform.system(),
            "arch": platform.machine(),
        },
        "metrics": metrics,
        "updatedAt": _iso_now(),
    }


@app.get("/api/remote/setup", dependencies=[Depends(require_token)])
def remote_setup_get():
    return _remote_setup_status()


@app.post("/api/remote/setup", dependencies=[Depends(require_token)])
def remote_setup_post(req: RemoteSetupRequest):
    if req.action != "start-websockify":
        raise HTTPException(status_code=400, detail="Unsupported remote setup action")

    websockify = shutil.which("websockify")
    novnc_root = _find_novnc_root()
    if not websockify or novnc_root is None:
        raise _err(
            "websockify and noVNC must be installed to start the local viewer",
            status=503,
        )

    if _probe_loopback_port(6080):
        raise HTTPException(
            status_code=409,
            detail="Port 6080 is already in use; refusing to reuse an unverified listener",
        )

    try:
        subprocess.Popen(
            [
                websockify,
                "127.0.0.1:6080",
                "127.0.0.1:5900",
                "--web",
                str(novnc_root),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            start_new_session=(os.name != "nt"),
        )
    except OSError:
        logger.exception("Could not start local websockify")
        raise _err("Could not start the local WebSocket bridge", status=503)
    return {
        "ok": True,
        "started": True,
        "listenerHost": "127.0.0.1",
        **_remote_setup_status(),
    }


@app.get("/api/release", dependencies=[Depends(require_token)])
def release_get():
    return _release_status()


@app.get("/api/github/dashboard", dependencies=[Depends(require_token)])
def github_dashboard_get():
    """Read-only open issues, open PRs and recent workflow runs."""
    import github_dashboard

    return github_dashboard.dashboard()


class SecurityScanRequest(BaseModel):
    """Optional allowlisted scanner id; paths, args and env are never accepted."""

    model_config = ConfigDict(extra="forbid")
    scanner: Optional[str] = None


@app.get("/api/security-scan", dependencies=[Depends(require_token)])
def security_scan_status():
    """Which defensive scanners (gitleaks, osv-scanner, semgrep) are installed."""
    import security_scan

    return security_scan.status()


@app.post("/api/security-scan", dependencies=[Depends(require_token)])
def security_scan_run(req: Optional[SecurityScanRequest] = None):
    """Run one allowlisted scanner (or all) against the repo root with a fixed argv."""
    import security_scan

    scanner = req.scanner if req else None
    if scanner is not None and scanner not in security_scan.SCANNERS:
        raise HTTPException(status_code=400, detail="Unknown scanner")
    try:
        return security_scan.run(scanner)
    except security_scan.Busy:
        raise HTTPException(status_code=409, detail="A security scan is already running") from None


class CodeHealthRequest(BaseModel):
    """Allowlisted script id only; paths, args and env are never accepted."""

    model_config = ConfigDict(extra="forbid")
    script: str


@app.get("/api/code-health", dependencies=[Depends(require_token)])
def code_health_status():
    """Which allowlisted code-health/coverage scripts can run."""
    import code_health

    return code_health.status()


@app.post("/api/code-health", dependencies=[Depends(require_token)])
def code_health_run(req: CodeHealthRequest):
    """Run one allowlisted script (perf, bundle, unused, dep-health, coverage) with a fixed argv."""
    import code_health

    if req.script not in code_health.SCRIPTS:
        raise HTTPException(status_code=400, detail="Unknown script")
    try:
        return code_health.run(req.script)
    except code_health.Busy:
        raise HTTPException(status_code=409, detail="A code-health run is already in progress") from None


@app.get("/api/commands", dependencies=[Depends(require_token)])
def commands_catalog():
    """Read-only catalog of commands/ and scripts/ entries (name/description/kind)."""
    import commands_catalog as cc

    items = cc.list_commands()
    return {"ok": True, "count": len(items), "commands": items}


@app.get("/api/setup/status", dependencies=[Depends(require_token)])
def setup_status_endpoint():
    """Read-only setup/environment status: presence flags and versions, never values."""
    import setup_status as ss

    return ss.build_status(
        version=app.version,
        openjarvis_enabled=_HAS_OPENJARVIS,
        token_configured=bool(_read_bridge_token()),
    )


@app.get("/api/snippets", dependencies=[Depends(require_token)])
def snippets_list():
    """Read-only list of snippets/ files plus the readable root documents."""
    import snippets_docs as sd

    snippets = sd.list_snippets()
    return {"ok": True, "count": len(snippets), "snippets": snippets, "docs": list(sd.DOCS)}


@app.get("/api/snippets/{name}", dependencies=[Depends(require_token)])
def snippet_read(name: str):
    """Read one snippet file by name (strictly validated, no path traversal)."""
    import snippets_docs as sd

    content = sd.read_snippet(name)
    if content is None:
        raise HTTPException(status_code=404, detail="Unknown snippet")
    return {"ok": True, "name": name, "content": content}


@app.get("/api/docs/{name}", dependencies=[Depends(require_token)])
def doc_read(name: str):
    """Read CHANGELOG.md or README.md from the repo root (fixed allowlist)."""
    import snippets_docs as sd

    content = sd.read_doc(name)
    if content is None:
        raise HTTPException(status_code=404, detail="Unknown document")
    return {"ok": True, "name": name, "content": content}


_MARKETPLACE_DIR = Path(__file__).resolve().parent.parent / "marketplace"


def _read_marketplace_json(name: str, required: bool) -> dict[str, Any]:
    path = _MARKETPLACE_DIR / name
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        if required:
            raise HTTPException(status_code=503, detail=f"marketplace/{name} not found") from None
        return {}
    except OSError as exc:
        raise HTTPException(status_code=503, detail=f"marketplace/{name} unreadable: {exc}") from exc
    try:
        data = json.loads(text)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=f"marketplace/{name} is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=503, detail=f"marketplace/{name} must be a JSON object")
    return data


def _marketplace_items() -> list[dict[str, Any]]:
    """Catalog items with `installed` = (registry.installed ∪ catalog installed:true) − registry.removed."""
    catalog = _read_marketplace_json("catalog.json", required=True)
    registry = _read_marketplace_json("registry.json", required=False)
    items = catalog.get("items")
    if not isinstance(items, list):
        raise HTTPException(status_code=503, detail="marketplace/catalog.json has no items array")
    installed_ids = registry.get("installed") or []
    removed_ids = registry.get("removed") or []
    if not isinstance(installed_ids, list) or not isinstance(removed_ids, list):
        raise HTTPException(
            status_code=503, detail="marketplace/registry.json installed/removed must be arrays"
        )
    installed = {i for i in installed_ids if isinstance(i, str)}
    removed = {i for i in removed_ids if isinstance(i, str)}
    out: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            continue
        effective = (item["id"] in installed or item.get("installed") is True) and item["id"] not in removed
        out.append({**item, "installed": effective})
    return out


@app.get("/api/marketplace", dependencies=[Depends(require_token)])
def marketplace_get(
    type: Optional[str] = None,
    category: Optional[str] = None,
    installed: Optional[bool] = None,
):
    """Read-only catalog + effective install state; never writes or installs."""
    items = _marketplace_items()
    if type is not None:
        items = [i for i in items if i.get("type") == type]
    if category is not None:
        items = [i for i in items if i.get("category") == category]
    if installed is not None:
        items = [i for i in items if i["installed"] is installed]
    return {"items": items, "count": len(items)}


@app.post("/api/release", dependencies=[Depends(require_token)])
def release_post(req: ReleaseRequest):
    if req.action not in ("status", "prepare", "notes", "deploy"):
        raise HTTPException(status_code=400, detail="Unknown release action")
    if req.action == "prepare" and req.kind not in ("patch", "minor", "major"):
        raise HTTPException(status_code=400, detail="Invalid release kind")
    if req.action == "deploy":
        try:
            deployment = _deploy_azure(environment=req.environment, target=req.target)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return {"action": "deploy", "kind": req.kind, "environment": deployment["environment"], "target": deployment["target"], "result": deployment["output"]}
    return {"action": req.action, **_release_status(), "kind": req.kind}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
