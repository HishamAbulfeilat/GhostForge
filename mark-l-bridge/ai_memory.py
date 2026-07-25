"""
AI Memory Module — mem0 integration for persistent agent memory.

Provides a unified memory layer backed by mem0ai with:
- CRUD operations for memories
- Auto-categorization
- Temporal awareness with decay
- Export / import
"""

from __future__ import annotations

import json
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Graceful import
# ---------------------------------------------------------------------------

_HAS_MEM0 = False
_mem0_instance: Any = None

try:
    from mem0 import Memory as _Mem0Memory

    _HAS_MEM0 = True
except ImportError:
    print("[ai_memory] ⚠️  mem0ai not installed — memory module will use in-memory fallback", file=sys.stderr)

# ---------------------------------------------------------------------------
# In-memory fallback store (used when mem0 is unavailable)
# ---------------------------------------------------------------------------

_fallback_store: dict[str, dict[str, Any]] = {}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MEMORY_CATEGORIES = {"project", "preference", "conversation", "code", "todo"}

_CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "project": ["project", "repo", "repository", "deploy", "build", "pipeline", "docker", "k8s"],
    "preference": ["prefer", "like", "hate", "favorite", "style", "theme", "setting", "config"],
    "conversation": ["said", "told", "asked", "mentioned", "discussed", "talked"],
    "code": ["function", "class", "import", "def ", "const ", "let ", "var ", "type ", "interface "],
    "todo": ["todo", "to-do", "need to", "should", "must", "fix later", "remember to", "action item"],
}

DECAY_HALF_LIFE_DAYS = 90  # memories lose half relevance every 90 days


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _decay_factor(created_at: str) -> float:
    """Return a 0.0–1.0 decay factor based on age."""
    try:
        created = datetime.fromisoformat(created_at)
        age_days = (datetime.now(timezone.utc) - created).total_seconds() / 86400
        return 0.5 ** (age_days / DECAY_HALF_LIFE_DAYS)
    except Exception:
        return 1.0


def _auto_categorize(content: str) -> str:
    """Heuristic category assignment based on keyword matching."""
    lower = content.lower()
    scores: dict[str, int] = {cat: 0 for cat in MEMORY_CATEGORIES}
    for cat, keywords in _CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in lower:
                scores[cat] += 1
    best = max(scores, key=scores.get)  # type: ignore[arg-type]
    return best if scores[best] > 0 else "conversation"


def _ensure_mem0() -> Any:
    """Return the mem0 singleton or raise if unavailable."""
    global _mem0_instance
    if not _HAS_MEM0:
        raise RuntimeError("mem0ai is not installed. Install it with: pip install mem0ai")
    if _mem0_instance is None:
        _mem0_instance = _Mem0Memory()
    return _mem0_instance


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def add_memory(
    content: str,
    user_id: str = "default",
    metadata: Optional[dict[str, Any]] = None,
    category: Optional[str] = None,
) -> dict[str, Any]:
    """Store a new memory with optional metadata and auto-categorization."""
    cat = category or _auto_categorize(content)
    meta = dict(metadata or {})
    meta["category"] = cat
    meta["created_at"] = _now_iso()

    if _HAS_MEM0:
        mem0 = _ensure_mem0()
        result = mem0.add(content, user_id=user_id, metadata=meta)
        memory_id = result.get("id") if isinstance(result, dict) else str(uuid.uuid4())
        return {
            "id": memory_id,
            "content": content,
            "user_id": user_id,
            "metadata": meta,
        }

    # Fallback
    memory_id = str(uuid.uuid4())
    entry = {
        "id": memory_id,
        "content": content,
        "user_id": user_id,
        "metadata": meta,
    }
    _fallback_store[memory_id] = entry
    return entry


def search_memory(
    query: str,
    user_id: str = "default",
    top_k: int = 5,
) -> list[dict[str, Any]]:
    """Retrieve the *top_k* most relevant memories for *query*."""
    if _HAS_MEM0:
        mem0 = _ensure_mem0()
        results = mem0.search(query, user_id=user_id, limit=top_k)
        if isinstance(results, dict) and "results" in results:
            return results["results"]
        if isinstance(results, list):
            return results
        return []

    # Fallback: simple substring search
    query_lower = query.lower()
    scored: list[tuple[float, dict[str, Any]]] = []
    for entry in _fallback_store.values():
        if entry["user_id"] != user_id:
            continue
        content_lower = entry["content"].lower()
        score = sum(1 for word in query_lower.split() if word in content_lower)
        if score > 0:
            decay = _decay_factor(entry["metadata"].get("created_at", _now_iso()))
            scored.append((score * decay, entry))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in scored[:top_k]]


def list_memories(user_id: str = "default") -> list[dict[str, Any]]:
    """Return all memories for *user_id*."""
    if _HAS_MEM0:
        mem0 = _ensure_mem0()
        results = mem0.get_all(user_id=user_id)
        if isinstance(results, dict) and "results" in results:
            return results["results"]
        if isinstance(results, list):
            return results
        return []

    return [
        e for e in _fallback_store.values() if e["user_id"] == user_id
    ]


def delete_memory(memory_id: str) -> dict[str, Any]:
    """Remove a memory by its ID."""
    if _HAS_MEM0:
        mem0 = _ensure_mem0()
        mem0.delete(memory_id)
        return {"deleted": memory_id, "method": "mem0"}

    if memory_id in _fallback_store:
        del _fallback_store[memory_id]
        return {"deleted": memory_id, "method": "fallback"}
    raise KeyError(f"Memory {memory_id} not found")


def update_memory(memory_id: str, content: str) -> dict[str, Any]:
    """Modify an existing memory's content."""
    if _HAS_MEM0:
        mem0 = _ensure_mem0()
        result = mem0.update(memory_id, content)
        return {"id": memory_id, "content": content, "updated": True, "result": result}

    if memory_id in _fallback_store:
        _fallback_store[memory_id]["content"] = content
        _fallback_store[memory_id]["metadata"]["updated_at"] = _now_iso()
        return {"id": memory_id, "content": content, "updated": True, "method": "fallback"}
    raise KeyError(f"Memory {memory_id} not found")


def get_memory_stats(user_id: str = "default") -> dict[str, Any]:
    """Return aggregate stats: count, categories, last updated."""
    memories = list_memories(user_id)
    if not memories:
        return {"count": 0, "categories": {}, "last_updated": None}

    categories: dict[str, int] = {}
    latest: Optional[str] = None
    for m in memories:
        cat = (m.get("metadata") or {}).get("category", "unknown")
        categories[cat] = categories.get(cat, 0) + 1
        created = (m.get("metadata") or {}).get("created_at", "")
        if created and (latest is None or created > latest):
            latest = created

    return {
        "count": len(memories),
        "categories": categories,
        "last_updated": latest,
        "user_id": user_id,
    }


def export_memories(user_id: str = "default") -> str:
    """Export all memories for *user_id* as a JSON string."""
    memories = list_memories(user_id)
    return json.dumps(memories, indent=2, default=str)


def import_memories(memories_json: str, user_id: str = "default") -> dict[str, Any]:
    """Bulk-import memories from a JSON string."""
    try:
        data = json.loads(memories_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}")

    if not isinstance(data, list):
        raise ValueError("Expected a JSON array of memory objects")

    imported = 0
    for item in data:
        content = item.get("content") or item.get("text") or str(item)
        meta = item.get("metadata") or {}
        cat = meta.get("category")
        add_memory(content, user_id=user_id, metadata=meta, category=cat)
        imported += 1

    return {"imported": imported, "user_id": user_id}
