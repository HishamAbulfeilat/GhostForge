"""
Mark-L FastAPI Bridge Server
Wraps all Mark-L Python action modules as HTTP endpoints.
Includes AI memory, agents, browser, models, and unified orchestration.
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import os
import secrets
import shutil
import subprocess
import sys
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

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
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
