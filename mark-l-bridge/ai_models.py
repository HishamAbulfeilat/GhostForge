"""
AI Models Module — huggingface_hub integration for model management.

Provides model search, download, comparison, and inference-provider discovery.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Graceful imports
# ---------------------------------------------------------------------------

_HAS_HFH = False

try:
    from huggingface_hub import HfApi as _HfApi
    from huggingface_hub import hf_hub_download as _hf_hub_download
    from huggingface_hub import snapshot_download as _snapshot_download

    _HAS_HFH = True
except ImportError:
    print("[ai_models] ⚠️  huggingface_hub not installed — model module will use stub responses", file=sys.stderr)

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_MODEL_DIR = Path.home() / ".cache" / "ghostforge" / "models"
MODEL_REGISTRY_FILE = Path.home() / ".cache" / "ghostforge" / "model_registry.json"

# Task → recommended pipeline tags
_TASK_RECOMMENDATIONS: dict[str, list[str]] = {
    "text-generation": ["text-generation", "text2text-generation"],
    "chat": ["conversational", "text-generation"],
    "code": ["text-generation"],
    "summarization": ["summarization"],
    "translation": ["translation", "text2text-generation"],
    "question-answering": ["question-answering"],
    "image-classification": ["image-classification"],
    "text-classification": ["text-classification", "sentiment-analysis"],
    "embedding": ["feature-extraction", "sentence-similarity"],
    "audio": ["automatic-speech-recognition", "audio-classification"],
    "object-detection": ["object-detection"],
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _api() -> Any:
    if not _HAS_HFH:
        raise RuntimeError("huggingface_hub is not installed. Install with: pip install huggingface_hub")
    return _HfApi()


def _load_registry() -> dict[str, Any]:
    if MODEL_REGISTRY_FILE.exists():
        try:
            return json.loads(MODEL_REGISTRY_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_registry(reg: dict[str, Any]) -> None:
    MODEL_REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)
    MODEL_REGISTRY_FILE.write_text(json.dumps(reg, indent=2, default=str))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def search_models(query: str, limit: int = 10, sort: str = "downloads") -> list[dict[str, Any]]:
    """Search Hugging Face Hub for models matching *query*."""
    api = _api()
    models = api.list_models(search=query, limit=limit, sort=sort, direction=-1)
    results: list[dict[str, Any]] = []
    for m in models:
        results.append({
            "id": m.id,
            "author": getattr(m, "author", None),
            "downloads": getattr(m, "downloads", 0),
            "likes": getattr(m, "likes", 0),
            "tags": getattr(m, "tags", []),
            "pipeline_tag": getattr(m, "pipeline_tag", None),
            "created_at": str(getattr(m, "created_at", "")),
        })
    return results


def get_model_info(model_id: str) -> dict[str, Any]:
    """Return detailed info for a specific model."""
    api = _api()
    info = api.model_info(model_id)
    return {
        "id": getattr(info, "modelId", model_id),
        "author": getattr(info, "author", None),
        "downloads": getattr(info, "downloads", 0),
        "likes": getattr(info, "likes", 0),
        "tags": getattr(info, "tags", []),
        "pipeline_tag": getattr(info, "pipeline_tag", None),
        "library_name": getattr(info, "library_name", None),
        "license": getattr(info, "license", None),
        "siblings": [
            {"filename": s.rfilename, "size": getattr(s, "size", None)}
            for s in (getattr(info, "siblings", []) or [])
        ],
        "card_data": getattr(info, "card_data", None),
        "created_at": str(getattr(info, "created_at", "")),
        "last_modified": str(getattr(info, "lastModified", "")),
    }


def download_model(model_id: str, local_dir: Optional[str] = None) -> dict[str, Any]:
    """Download a model snapshot to a local directory."""
    dest = Path(local_dir) if local_dir else DEFAULT_MODEL_DIR / model_id.replace("/", "_")
    dest.mkdir(parents=True, exist_ok=True)

    _snapshot_download(repo_id=model_id, local_dir=str(dest))

    # Update registry
    reg = _load_registry()
    reg[model_id] = {
        "local_path": str(dest),
        "downloaded_at": str(__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()),
    }
    _save_registry(reg)

    return {"model_id": model_id, "local_path": str(dest), "status": "downloaded"}


def list_local_models() -> list[dict[str, Any]]:
    """List models that have been downloaded locally."""
    reg = _load_registry()
    results: list[dict[str, Any]] = []
    for model_id, info in reg.items():
        local_path = info.get("local_path", "")
        exists = Path(local_path).exists() if local_path else False
        results.append({
            "model_id": model_id,
            "local_path": local_path,
            "exists": exists,
            "downloaded_at": info.get("downloaded_at"),
        })

    # Also scan the default dir for models not in registry
    if DEFAULT_MODEL_DIR.exists():
        for entry in DEFAULT_MODEL_DIR.iterdir():
            if entry.is_dir() and entry.name not in [r["model_id"].replace("/", "_") for r in results]:
                results.append({
                    "model_id": entry.name,
                    "local_path": str(entry),
                    "exists": True,
                    "downloaded_at": None,
                })

    return results


def get_model_recommendations(task: str) -> list[dict[str, Any]]:
    """Return recommended models for a given task."""
    tags = _TASK_RECOMMENDATIONS.get(task, [task])
    api = _api()
    all_models: list[dict[str, Any]] = []
    for tag in tags:
        models = api.list_models(pipeline_tag=tag, limit=5, sort="downloads", direction=-1)
        for m in models:
            all_models.append({
                "id": m.id,
                "downloads": getattr(m, "downloads", 0),
                "likes": getattr(m, "likes", 0),
                "pipeline_tag": getattr(m, "pipeline_tag", tag),
                "tags": getattr(m, "tags", []),
            })

    # Deduplicate by id
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for m in all_models:
        if m["id"] not in seen:
            seen.add(m["id"])
            unique.append(m)
    return unique[:15]


def get_model_metrics(model_id: str) -> dict[str, Any]:
    """Return download counts, likes, and other metrics for a model."""
    info = get_model_info(model_id)
    return {
        "model_id": model_id,
        "downloads": info.get("downloads", 0),
        "likes": info.get("likes", 0),
        "tags": info.get("tags", []),
        "pipeline_tag": info.get("pipeline_tag"),
        "library_name": info.get("library_name"),
    }


def check_model_license(model_id: str) -> dict[str, Any]:
    """Check the license type and restrictions for a model."""
    info = get_model_info(model_id)
    license_type = info.get("license") or "unknown"
    card_data = info.get("card_data") or {}

    restrictions: list[str] = []
    lower_license = str(license_type).lower()
    if "apache" in lower_license:
        restrictions.append("Permissive — commercial use allowed")
    elif "mit" in lower_license:
        restrictions.append("Permissive — commercial use allowed")
    elif "gpl" in lower_license:
        restrictions.append("Copyleft — derivative works must be GPL")
    elif "cc-by" in lower_license:
        restrictions.append("Attribution required")
    elif "cc-by-nc" in lower_license:
        restrictions.append("Non-commercial use only")
    elif "restricted" in lower_license or "proprietary" in lower_license:
        restrictions.append("Restricted use — check model card for details")
    else:
        restrictions.append("License unclear — review model card manually")

    return {
        "model_id": model_id,
        "license": license_type,
        "restrictions": restrictions,
        "card_data": card_data,
    }


def install_model(model_id: str) -> dict[str, Any]:
    """Download a model and register it with Ollama (if available)."""
    download_result = download_model(model_id)
    local_path = download_result["local_path"]

    # Attempt Ollama registration
    ollama_result = {"ollama_registered": False}
    try:
        modelfile_path = Path(local_path) / "Modelfile"
        if not modelfile_path.exists():
            # Create a basic Modelfile
            modelfile_path.write_text(f"FROM {Path(local_path)}\n")

        subprocess.run(
            ["ollama", "create", model_id.replace("/", "-"), "-f", str(modelfile_path)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        ollama_result["ollama_registered"] = True
        ollama_result["ollama_name"] = model_id.replace("/", "-")
    except FileNotFoundError:
        ollama_result["note"] = "Ollama is not installed — model downloaded but not registered"
    except subprocess.TimeoutExpired:
        ollama_result["note"] = "Ollama create timed out"
    except Exception as exc:
        ollama_result["note"] = f"Ollama registration failed: {exc}"

    return {**download_result, **ollama_result}


def compare_models(model_ids: list[str]) -> dict[str, Any]:
    """Side-by-side comparison of multiple models."""
    comparisons: list[dict[str, Any]] = []
    for mid in model_ids:
        try:
            info = get_model_info(mid)
            comparisons.append({
                "model_id": mid,
                "downloads": info.get("downloads", 0),
                "likes": info.get("likes", 0),
                "license": info.get("license", "unknown"),
                "pipeline_tag": info.get("pipeline_tag"),
                "library_name": info.get("library_name"),
                "num_parameters": _estimate_params(info.get("tags", [])),
            })
        except Exception as exc:
            comparisons.append({"model_id": mid, "error": str(exc)})

    return {"models": comparisons, "count": len(comparisons)}


def get_inference_providers(model_id: str) -> list[dict[str, Any]]:
    """Return available inference providers for a model."""
    api = _api()
    try:
        info = api.model_info(model_id)
        siblings = getattr(info, "siblings", []) or []
        tags = getattr(info, "tags", []) or []

        providers: list[dict[str, Any]] = []

        # Check for inference API support
        if "inference" in tags or any("inference" in str(s.rfilename) for s in siblings):
            providers.append({"name": "Hugging Face Inference API", "type": "hosted"})

        # Check for text-generation-inference compatibility
        if any(kw in tags for kw in ["text-generation", "tgi"]):
            providers.append({"name": "Text Generation Inference (TGI)", "type": "self-hosted"})

        # Check for vLLM compatibility
        if "vllm" in tags or "text-generation" in tags:
            providers.append({"name": "vLLM", "type": "self-hosted"})

        # Check for Ollama
        providers.append({"name": "Ollama", "type": "local"})

        # Check for llama.cpp
        if any(kw in tags for kw in ["gguf", "llama", "ggml"]):
            providers.append({"name": "llama.cpp", "type": "local"})

        # Check for ExLlamaV2
        if "exl2" in tags or "exllamav2" in tags:
            providers.append({"name": "ExLlamaV2", "type": "local"})

        return providers
    except Exception as exc:
        return [{"name": "unknown", "error": str(exc)}]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _estimate_params(tags: list[str]) -> str:
    """Best-effort parameter count from model tags."""
    for tag in reversed(tags):
        lower = str(tag).lower()
        for size in ["70b", "65b", "40b", "30b", "13b", "7b", "3b", "1b", "500m", "350m", "125m"]:
            if size in lower:
                return size
    return "unknown"
