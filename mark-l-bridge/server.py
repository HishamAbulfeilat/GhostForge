"""
Mark-L FastAPI Bridge Server
Wraps all Mark-L Python action modules as HTTP endpoints.
Includes AI memory, agents, browser, models, and unified orchestration.
"""

from __future__ import annotations

import asyncio
import sys
import traceback
from contextlib import contextmanager
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

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

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Mark-L Bridge",
    version="2.0.0",
    description="HTTP bridge wrapping Mark-L Python action modules + AI memory, agents, browser, and models.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


def _err(message: str, status: int = 500) -> HTTPException:
    return HTTPException(status_code=status, detail={"ok": False, "error": message})


def _safe_call(fn, *args, **kwargs):
    """Call *fn*, catch exceptions, return a serialisable dict."""
    try:
        result = fn(*args, **kwargs)
        return _ok(result)
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[bridge] ❌ {fn.__name__}: {exc}\n{tb}", file=sys.stderr)
        raise _err(f"{fn.__name__} failed: {exc}")


def _require_module(name: str, available: bool):
    """Raise 503 if the module is not available."""
    if not available:
        raise _err(f"{name} is not installed or available", status=503)


# ---------------------------------------------------------------------------
# Original Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/mark-l/health")
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
        },
    }


@app.post("/api/mark-l/web-search")
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


@app.post("/api/mark-l/screen-capture")
def screen_capture_endpoint(req: ScreenCaptureRequest):
    params: dict[str, Any] = {"angle": req.angle, "text": req.text}
    try:
        _screen_process(params)
        return _ok("Screen capture sent to vision session.")
    except Exception as exc:
        raise _err(f"screen_process failed: {exc}")


@app.post("/api/mark-l/youtube")
def youtube_endpoint(req: YoutubeRequest):
    params: dict[str, Any] = {"action": req.action}
    if req.query:
        params["query"] = req.query
    if req.url:
        params["url"] = req.url
    if req.region:
        params["region"] = req.region
    return _safe_call(_youtube_video, params)


@app.post("/api/mark-l/game-updater")
def game_updater_endpoint(req: GameUpdaterRequest):
    params: dict[str, Any] = {"action": req.action}
    if req.game_name:
        params["game_name"] = req.game_name
    return _safe_call(_game_updater, params)


@app.post("/api/mark-l/system-status")
def system_status_endpoint():
    return _safe_call(_get_system_status)


@app.post("/api/mark-l/computer-settings")
def computer_settings_endpoint(req: ComputerSettingsRequest):
    params: dict[str, Any] = {}
    if req.action:
        params["action"] = req.action
    if req.description:
        params["description"] = req.description
    if req.value is not None:
        params["value"] = req.value
    return _safe_call(_computer_settings, params)


@app.post("/api/mark-l/computer-control")
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


@app.post("/api/mark-l/browser-control")
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


@app.post("/api/mark-l/file-process")
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


@app.post("/api/mark-l/file-control")
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


@app.post("/api/mark-l/send-message")
def send_message_endpoint(req: SendMessageRequest):
    params: dict[str, Any] = {
        "receiver": req.receiver,
        "message_text": req.message_text,
        "platform": req.platform,
    }
    return _safe_call(_send_message, params)


@app.post("/api/mark-l/weather")
def weather_endpoint(req: WeatherRequest):
    params: dict[str, Any] = {"city": req.city}
    return _safe_call(_weather_action, params)


@app.post("/api/mark-l/flight-finder")
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


@app.post("/api/mark-l/reminder")
def reminder_endpoint(req: ReminderRequest):
    params: dict[str, Any] = {
        "date": req.date,
        "time": req.time,
        "message": req.message,
    }
    return _safe_call(_reminder, params)


@app.post("/api/mark-l/open-app")
def open_app_endpoint(req: OpenAppRequest):
    params: dict[str, Any] = {"app_name": req.app_name}
    return _safe_call(_open_app, params)


@app.post("/api/mark-l/desktop")
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


@app.post("/api/mark-l/code-helper")
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


@app.post("/api/mark-l/dev-agent")
def dev_agent_endpoint(req: DevAgentRequest):
    params: dict[str, Any] = {}
    if req.task:
        params["description"] = req.task
    if req.language:
        params["language"] = req.language
    if req.project_name:
        params["project_name"] = req.project_name
    return _safe_call(_dev_agent, params)


@app.post("/api/mark-l/clipboard")
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
            raise _err(f"Unknown clipboard action: '{action}'. Use 'get' or 'set'.", status=400)
    except HTTPException:
        raise
    except Exception as exc:
        raise _err(f"Clipboard error: {exc}")


# ---------------------------------------------------------------------------
# AI Memory Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/mark-l/memory/add")
def memory_add_endpoint(req: MemoryAddRequest):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_add_memory, req.content, req.user_id, req.metadata, req.category)


@app.post("/api/mark-l/memory/search")
def memory_search_endpoint(req: MemorySearchRequest):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_search_memory, req.query, req.user_id, req.top_k)


@app.get("/api/mark-l/memory/list/{user_id}")
def memory_list_endpoint(user_id: str):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_list_memories, user_id)


@app.delete("/api/mark-l/memory/{memory_id}")
def memory_delete_endpoint(memory_id: str):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_delete_memory, memory_id)


@app.put("/api/mark-l/memory/{memory_id}")
def memory_update_endpoint(memory_id: str, req: MemoryUpdateRequest):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_update_memory, memory_id, req.content)


@app.get("/api/mark-l/memory/stats/{user_id}")
def memory_stats_endpoint(user_id: str):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_get_memory_stats, user_id)


@app.post("/api/mark-l/memory/export")
def memory_export_endpoint(req: MemoryExportRequest):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_export_memories, req.user_id)


@app.post("/api/mark-l/memory/import")
def memory_import_endpoint(req: MemoryImportRequest):
    _require_module("ai_memory", _HAS_AI_MEMORY)
    return _safe_call(_ai_import_memories, req.memories_json, req.user_id)


# ---------------------------------------------------------------------------
# AI Agent Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/mark-l/agents/crew/create")
def crew_create_endpoint(req: CrewCreateRequest):
    _require_module("ai_agents", _HAS_AI_AGENTS)
    return _safe_call(_ai_create_crew, req.agents_config, req.tasks_config, req.crew_id, req.template_name, req.process)


@app.post("/api/mark-l/agents/crew/{crew_id}/run")
def crew_run_endpoint(crew_id: str, req: CrewRunRequest):
    _require_module("ai_agents", _HAS_AI_AGENTS)
    return _safe_call(_ai_run_crew, crew_id, req.inputs)


@app.get("/api/mark-l/agents/crew/{crew_id}/status")
def crew_status_endpoint(crew_id: str):
    _require_module("ai_agents", _HAS_AI_AGENTS)
    return _safe_call(_ai_get_crew_status, crew_id)


@app.get("/api/mark-l/agents/crews/list")
def crew_list_endpoint():
    _require_module("ai_agents", _HAS_AI_AGENTS)
    return _safe_call(_ai_list_crews)


@app.get("/api/mark-l/agents/templates")
def crew_templates_endpoint():
    _require_module("ai_agents", _HAS_AI_AGENTS)
    return _safe_call(_ai_get_templates)


@app.post("/api/mark-l/agents/crew/{crew_id}/cancel")
def crew_cancel_endpoint(crew_id: str):
    _require_module("ai_agents", _HAS_AI_AGENTS)
    return _safe_call(_ai_cancel_crew, crew_id)


# ---------------------------------------------------------------------------
# AI Browser Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/mark-l/browser/browse")
def browser_browse_endpoint(req: BrowserBrowseRequest):
    _require_module("ai_browser", _HAS_AI_BROWSER)
    return _safe_call(_ai_browse, req.url, req.task)


@app.post("/api/mark-l/browser/extract")
def browser_extract_endpoint(req: BrowserExtractRequest):
    _require_module("ai_browser", _HAS_AI_BROWSER)
    return _safe_call(_ai_extract, req.url, req.selectors)


@app.post("/api/mark-l/browser/screenshot")
def browser_screenshot_endpoint(req: BrowserScreenshotRequest):
    _require_module("ai_browser", _HAS_AI_BROWSER)
    return _safe_call(_ai_screenshot, req.url)


@app.post("/api/mark-l/browser/search")
def browser_search_endpoint(req: BrowserSearchRequest):
    _require_module("ai_browser", _HAS_AI_BROWSER)
    return _safe_call(_ai_browser_search, req.query)


@app.post("/api/mark-l/browser/fill-form")
def browser_fill_form_endpoint(req: BrowserFillFormRequest):
    _require_module("ai_browser", _HAS_AI_BROWSER)
    return _safe_call(_ai_fill_form, req.url, req.form_data)


@app.post("/api/mark-l/browser/click")
def browser_click_endpoint(req: BrowserClickRequest):
    _require_module("ai_browser", _HAS_AI_BROWSER)
    return _safe_call(_ai_click, req.url, req.selector)


# ---------------------------------------------------------------------------
# AI Model Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/mark-l/models/search")
def model_search_endpoint(q: str = "", limit: int = 10, sort: str = "downloads"):
    _require_module("ai_models", _HAS_AI_MODELS)
    return _safe_call(_ai_search_models, q, limit, sort)


@app.get("/api/mark-l/models/{model_id:path}")
def model_info_endpoint(model_id: str):
    _require_module("ai_models", _HAS_AI_MODELS)
    return _safe_call(_ai_get_model_info, model_id)


@app.post("/api/mark-l/models/download")
def model_download_endpoint(req: ModelDownloadRequest):
    _require_module("ai_models", _HAS_AI_MODELS)
    return _safe_call(_ai_download_model, req.model_id, req.local_dir)


@app.get("/api/mark-l/models/local")
def model_local_endpoint():
    _require_module("ai_models", _HAS_AI_MODELS)
    return _safe_call(_ai_list_local_models)


@app.get("/api/mark-l/models/recommendations")
def model_recommendations_endpoint(task: str = "text-generation"):
    _require_module("ai_models", _HAS_AI_MODELS)
    return _safe_call(_ai_get_model_recommendations, task)


@app.post("/api/mark-l/models/install")
def model_install_endpoint(req: ModelInstallRequest):
    _require_module("ai_models", _HAS_AI_MODELS)
    return _safe_call(_ai_install_model, req.model_id)


@app.get("/api/mark-l/models/compare")
def model_compare_endpoint(ids: str = ""):
    _require_module("ai_models", _HAS_AI_MODELS)
    model_ids = [mid.strip() for mid in ids.split(",") if mid.strip()]
    return _safe_call(_ai_compare_models, model_ids)


# ---------------------------------------------------------------------------
# Unified Chat Endpoint
# ---------------------------------------------------------------------------

@app.post("/api/mark-l/chat/unified")
def unified_chat_endpoint(req: UnifiedChatRequest):
    _require_module("ai_unified", _HAS_AI_UNIFIED)
    try:
        agent = _UnifiedAgent(user_id=req.user_id)
        result = agent.process(req.message, req.context)
        return _ok(result)
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[bridge] ❌ unified_chat: {exc}\n{tb}", file=sys.stderr)
        raise _err(f"unified_chat failed: {exc}")


@app.post("/api/mark-l/chat/chain")
def unified_chain_endpoint(req: UnifiedChainRequest):
    _require_module("ai_unified", _HAS_AI_UNIFIED)
    try:
        agent = _UnifiedAgent(user_id=req.user_id)
        steps = [s.model_dump() for s in req.steps]
        result = agent.chain(steps)
        return _ok(result)
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[bridge] ❌ unified_chain: {exc}\n{tb}", file=sys.stderr)
        raise _err(f"unified_chain failed: {exc}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
