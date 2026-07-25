"""
Unified AI Orchestrator — combines memory, agents, browser, and models.

Receives a user message, determines intent, routes to the appropriate
handler, stores context in memory, and returns a unified response.
"""

from __future__ import annotations

import re
import sys
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Imports from sibling modules
# ---------------------------------------------------------------------------

try:
    from ai_memory import add_memory, search_memory, get_memory_stats
except ImportError:
    add_memory = None  # type: ignore[assignment]
    search_memory = None  # type: ignore[assignment]
    get_memory_stats = None  # type: ignore[assignment]

try:
    from ai_agents import create_crew, run_crew, get_templates
except ImportError:
    create_crew = None  # type: ignore[assignment]
    run_crew = None  # type: ignore[assignment]
    get_templates = None  # type: ignore[assignment]

try:
    from ai_browser import browse, extract, search as browser_search, screenshot
except ImportError:
    browse = None  # type: ignore[assignment]
    extract = None  # type: ignore[assignment]
    browser_search = None  # type: ignore[assignment]
    screenshot = None  # type: ignore[assignment]

try:
    from ai_models import search_models, get_model_info, get_model_recommendations
except ImportError:
    search_models = None  # type: ignore[assignment]
    get_model_info = None  # type: ignore[assignment]
    get_model_recommendations = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Intent classification
# ---------------------------------------------------------------------------

class Intent(str, Enum):
    CODE = "code"
    RESEARCH = "research"
    BROWSE = "browse"
    MODEL = "model"
    MEMORY = "memory"
    GENERAL = "general"


_INTENT_PATTERNS: dict[Intent, list[str]] = {
    Intent.CODE: [
        r"\b(review|refactor|fix\s+bug|write\s+test|code|implement|debug)\b",
        r"\b(function|class|component|endpoint|api|hook)\b",
        r"\b(typescript|python|javascript|react|next\.?js|css|html)\b",
    ],
    Intent.RESEARCH: [
        r"\b(research|investigate|compare|analyze|survey|study)\b",
        r"\b(what\s+is|how\s+does|explain|tell\s+me\s+about)\b",
        r"\b(report|summary|overview|deep\s+dive)\b",
    ],
    Intent.BROWSE: [
        r"\b(browse|open|visit|navigate|go\s+to|scrape|extract\s+from)\b",
        r"\b(website|page|site|url|link)\b",
        r"\b(screenshot|fill\s+form|login|click)\b",
    ],
    Intent.MODEL: [
        r"\b(model|download|hugging\s*face|hf|ollama|llm|inference)\b",
        r"\b(search\s+model|find\s+model|install\s+model)\b",
        r"\b(gguf|ggml|quantiz|fine.?tune|transformers?)\b",
    ],
    Intent.MEMORY: [
        r"\b(remember|recall|what\s+did\s+(we|i)|my\s+notes|my\s+preferences?)\b",
        r"\b(memory|memorize|store|save\s+this|note\s+that)\b",
    ],
}


def classify_intent(message: str) -> Intent:
    """Determine the most likely intent from a user message."""
    lower = message.lower()
    scores: dict[Intent, int] = {i: 0 for i in Intent}

    for intent, patterns in _INTENT_PATTERNS.items():
        for pat in patterns:
            if re.search(pat, lower, re.IGNORECASE):
                scores[intent] += 1

    best = max(scores, key=scores.get)  # type: ignore[arg-type]
    if scores[best] == 0:
        return Intent.GENERAL
    return best


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def _handle_code(message: str, user_id: str, context: dict[str, Any]) -> dict[str, Any]:
    """Route code-related tasks to crewAI."""
    if create_crew is None or run_crew is None:
        return {"handler": "code", "error": "crewAI is not installed", "fallback_response": _fallback_response(message)}

    # Pick template based on keywords
    lower = message.lower()
    if "review" in lower:
        template = "code_review"
    elif "test" in lower:
        template = "test_writer"
    elif "fix" in lower or "bug" in lower:
        template = "bug_fixer"
    elif "refactor" in lower:
        template = "refactoring"
    elif "doc" in lower:
        template = "doc_writer"
    else:
        template = "full_stack"

    crew_info = create_crew([], [], template_name=template)
    result = run_crew(crew_info["id"], inputs={"message": message, "user_id": user_id})
    return {"handler": "code", "template": template, "crew_id": result.get("id"), "result": result.get("result"), "status": result.get("status")}


def _handle_research(message: str, user_id: str, context: dict[str, Any]) -> dict[str, Any]:
    """Combine browser research with crewAI report writing."""
    results: dict[str, Any] = {"handler": "research", "steps": []}

    # Step 1: Browser search
    if browser_search is not None:
        try:
            search_results = browser_search(message)
            results["steps"].append({"step": "web_search", "data": search_results})
        except Exception as exc:
            results["steps"].append({"step": "web_search", "error": str(exc)})
    else:
        results["steps"].append({"step": "web_search", "error": "browser-use not installed"})

    # Step 2: CrewAI research report
    if create_crew is not None and run_crew is not None:
        try:
            crew_info = create_crew([], [], template_name="research")
            result = run_crew(crew_info["id"], inputs={"topic": message})
            results["steps"].append({"step": "report", "data": result.get("result")})
        except Exception as exc:
            results["steps"].append({"step": "report", "error": str(exc)})

    return results


def _handle_browse(message: str, user_id: str, context: dict[str, Any]) -> dict[str, Any]:
    """Handle browser automation requests."""
    url = context.get("url") or _extract_url(message)
    if not url:
        return {"handler": "browse", "error": "No URL specified in the message or context"}

    task = context.get("task") or message
    if browse is None:
        return {"handler": "browse", "error": "browser-use is not installed"}

    result = browse(url, task)
    return {"handler": "browse", "result": result}


def _handle_model(message: str, user_id: str, context: dict[str, Any]) -> dict[str, Any]:
    """Handle model search, info, and recommendation requests."""
    lower = message.lower()

    if search_models is None:
        return {"handler": "model", "error": "huggingface_hub is not installed"}

    # Determine sub-action
    if any(kw in lower for kw in ["recommend", "best", "good for", "suggestion"]):
        task = context.get("task") or "text-generation"
        recs = get_model_recommendations(task) if get_model_recommendations else []
        return {"handler": "model", "action": "recommendations", "task": task, "results": recs}

    if any(kw in lower for kw in ["info", "details", "about"]):
        model_id = context.get("model_id") or _extract_model_id(message)
        if model_id and get_model_info:
            info = get_model_info(model_id)
            return {"handler": "model", "action": "info", "model_id": model_id, "result": info}
        return {"handler": "model", "action": "info", "error": "Could not determine model ID"}

    # Default: search
    query = context.get("query") or message
    results = search_models(query, limit=5)
    return {"handler": "model", "action": "search", "query": query, "results": results}


def _handle_memory(message: str, user_id: str, context: dict[str, Any]) -> dict[str, Any]:
    """Handle memory-related requests."""
    if search_memory is None or add_memory is None:
        return {"handler": "memory", "error": "ai_memory module is not available"}

    lower = message.lower()

    if any(kw in lower for kw in ["recall", "remember", "what did", "search"]):
        results = search_memory(message, user_id=user_id, top_k=5)
        return {"handler": "memory", "action": "search", "query": message, "results": results}

    # Store the message as a memory
    mem = add_memory(message, user_id=user_id)
    return {"handler": "memory", "action": "stored", "memory": mem}


def _handle_general(message: str, user_id: str, context: dict[str, Any]) -> dict[str, Any]:
    """Handle general queries — try Ollama or return fallback."""
    # Try Ollama
    try:
        import httpx  # type: ignore
        resp = httpx.post(
            "http://localhost:11434/api/generate",
            json={"model": "llama3", "prompt": message, "stream": False},
            timeout=60,
        )
        if resp.status_code == 200:
            data = resp.json()
            return {"handler": "general", "source": "ollama", "response": data.get("response", "")}
    except Exception:
        pass

    return {"handler": "general", "source": "fallback", "response": _fallback_response(message)}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fallback_response(message: str) -> str:
    return (
        f"I received your message but could not route it to a specific handler. "
        f"Try being more specific — for example: 'review this code', "
        f"'research topic X', 'browse https://example.com', or 'search for models'. "
        f"Original message: {message[:200]}"
    )


def _extract_url(text: str) -> Optional[str]:
    match = re.search(r"https?://[^\s]+", text)
    return match.group(0) if match else None


def _extract_model_id(text: str) -> Optional[str]:
    match = re.search(r"[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+", text)
    return match.group(0) if match else None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class UnifiedAgent:
    """Single entry point that routes user messages to the right subsystem."""

    def __init__(self, user_id: str = "default") -> None:
        self.user_id = user_id

    def process(self, message: str, context: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        """Process a user message end-to-end.

        1. Search memory for relevant context.
        2. Classify intent.
        3. Route to appropriate handler.
        4. Store interaction in memory.
        5. Return unified response.
        """
        ctx = context or {}
        timestamp = datetime.now(timezone.utc).isoformat()

        # Step 1: Memory recall
        memory_context: list[dict[str, Any]] = []
        if search_memory is not None:
            try:
                memory_context = search_memory(message, user_id=self.user_id, top_k=3)
            except Exception:
                pass

        # Step 2: Intent classification
        intent = classify_intent(message)

        # Step 3: Route
        handlers = {
            Intent.CODE: _handle_code,
            Intent.RESEARCH: _handle_research,
            Intent.BROWSE: _handle_browse,
            Intent.MODEL: _handle_model,
            Intent.MEMORY: _handle_memory,
            Intent.GENERAL: _handle_general,
        }
        handler = handlers[intent]
        result = handler(message, self.user_id, ctx)

        # Step 4: Store interaction in memory
        if add_memory is not None:
            try:
                add_memory(
                    f"[{intent.value}] {message}",
                    user_id=self.user_id,
                    metadata={"intent": intent.value, "timestamp": timestamp},
                    category="conversation" if intent == Intent.GENERAL else intent.value,
                )
            except Exception:
                pass

        # Step 5: Unified response
        return {
            "ok": True,
            "message": message,
            "intent": intent.value,
            "memory_context": memory_context,
            "response": result,
            "timestamp": timestamp,
        }

    def chain(self, steps: list[dict[str, Any]]) -> dict[str, Any]:
        """Execute a chain of actions sequentially.

        Each step is a dict with:
          - ``action``: one of "code", "research", "browse", "model", "memory"
          - ``message``: the prompt / instruction
          - ``context``: optional extra context
        """
        results: list[dict[str, Any]] = []
        accumulated_context: dict[str, Any] = {}

        for i, step in enumerate(steps):
            action = step.get("action", "general")
            msg = step.get("message", "")
            step_ctx = {**accumulated_context, **(step.get("context") or {})}

            intent_map: dict[str, Intent] = {
                "code": Intent.CODE,
                "research": Intent.RESEARCH,
                "browse": Intent.BROWSE,
                "model": Intent.MODEL,
                "memory": Intent.MEMORY,
            }
            intent = intent_map.get(action, Intent.GENERAL)
            handlers = {
                Intent.CODE: _handle_code,
                Intent.RESEARCH: _handle_research,
                Intent.BROWSE: _handle_browse,
                Intent.MODEL: _handle_model,
                Intent.MEMORY: _handle_memory,
                Intent.GENERAL: _handle_general,
            }
            handler = handlers[intent]
            step_result = handler(msg, self.user_id, step_ctx)

            # Feed result into next step's context
            accumulated_context[f"step_{i}_result"] = step_result
            results.append({"step": i, "action": action, "result": step_result})

        return {"ok": True, "chain_length": len(steps), "results": results}
