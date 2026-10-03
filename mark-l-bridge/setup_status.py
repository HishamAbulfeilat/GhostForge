"""Read-only setup/environment status for the bridge.

Reports only booleans, presence flags and versions. Environment variable
values are never read into the response, only whether they are set.
"""

from __future__ import annotations

import os
import urllib.request
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent

# Names only; values are never returned.
REQUIRED_ENV = ("MARKL_BRIDGE_TOKEN",)
OPTIONAL_ENV = ("GITHUB_TOKEN", "GH_TOKEN", "GEMINI_API_KEY", "GHOSTFORGE_N8N_URL", "MARK_LIV_DIR")

OLLAMA_URL = "http://localhost:11434/api/version"
OLLAMA_TIMEOUT_S = 1.0


def _env_presence(names: tuple[str, ...]) -> dict[str, bool]:
    return {n: bool((os.environ.get(n) or "").strip()) for n in names}


def ollama_reachable(url: str = OLLAMA_URL) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=OLLAMA_TIMEOUT_S) as resp:  # noqa: S310 - fixed localhost URL
            return 200 <= resp.status < 300
    except Exception:
        return False


def vendor_present(mark_liv_dir: Optional[Path] = None) -> bool:
    path = mark_liv_dir or Path(os.environ.get("MARK_LIV_DIR") or REPO_ROOT / "vendor" / "mark-liv")
    return path.is_dir()


def build_status(*, version: str, openjarvis_enabled: bool, token_configured: bool) -> dict:
    required = _env_presence(REQUIRED_ENV)
    if token_configured:  # the bridge also accepts a generated token file
        required["MARKL_BRIDGE_TOKEN"] = True
    return {
        "ok": True,
        "bridge_version": version,
        "required_env": required,
        "required_env_ok": all(required.values()),
        "optional_env": _env_presence(OPTIONAL_ENV),
        "ollama_reachable": ollama_reachable(),
        "openjarvis_enabled": bool(openjarvis_enabled),
        "mark_lv_vendor_present": vendor_present(),
    }
