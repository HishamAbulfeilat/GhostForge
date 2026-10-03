"""Read-only catalogs: free APIs/models and design/open-source resources.

Reuses existing data sources instead of duplicating them: the provider
registry (web-ui/lib/providers.ts), the web resource pages
(web-ui/app/design-resources, web-ui/app/open-source-tools) and
marketplace/catalog.json. Provider entries report only whether the API key
environment variable is set; values are never read into the response.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
MAX_SOURCE_BYTES = 512 * 1024

PROVIDERS_TS = Path("web-ui") / "lib" / "providers.ts"
DESIGN_PAGE = Path("web-ui") / "app" / "design-resources" / "page.tsx"
OSS_PAGE = Path("web-ui") / "app" / "open-source-tools" / "page.tsx"
CATALOG_JSON = Path("marketplace") / "catalog.json"

_PROVIDER_LINE = re.compile(r"^\s*\w+:\s*\{\s*id:\s*'([\w-]+)'(.*)\},?\s*$")
_FIELD = re.compile(r"(\w+):\s*(?:'((?:[^'\\]|\\.)*)'|(true|false|null))")
_RESOURCE_LINE = re.compile(r"^\s*\{\s*name:\s*'((?:[^'\\]|\\.)*)'(.*)\},?\s*$")
_URL_SCHEME = re.compile(r"^https?://", re.I)


def _read_text(rel: Path, root: Optional[Path] = None) -> str:
    path = (root or REPO_ROOT) / rel
    try:
        if path.stat().st_size > MAX_SOURCE_BYTES:
            return ""
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _fields(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, s, lit in _FIELD.findall(text):
        out[key] = {"true": True, "false": False, "null": None}[lit] if lit else s.replace("\\'", "'")
    return out


def _key_set(env_name: Optional[str]) -> Optional[bool]:
    if not env_name:
        return None
    return bool((os.environ.get(env_name) or "").strip())


def list_free_providers(root: Optional[Path] = None) -> list[dict[str, Any]]:
    """Providers from providers.ts; key_set is a presence flag only (None = no key needed)."""
    providers = []
    for line in _read_text(PROVIDERS_TS, root).splitlines():
        m = _PROVIDER_LINE.match(line)
        if not m:
            continue
        f = _fields("id: '%s'%s" % (m.group(1), m.group(2)))
        key_env = f.get("keyEnv")
        url = f.get("keyUrl", "")
        providers.append({
            "id": f["id"],
            "name": f.get("name", f["id"]),
            "paid": bool(f.get("paid")),
            "key_env": key_env,
            "key_set": _key_set(key_env),
            "key_url": url if _URL_SCHEME.match(url) else None,
            "default_model": f.get("defaultModel"),
        })
    return providers


def _page_resources(rel: Path, root: Optional[Path]) -> list[dict[str, str]]:
    items = []
    for line in _read_text(rel, root).splitlines():
        m = _RESOURCE_LINE.match(line)
        if not m:
            continue
        f = _fields("name: '%s'%s" % (m.group(1), m.group(2)))
        url = f.get("url", "")
        if not _URL_SCHEME.match(url):
            continue
        items.append({
            "name": f["name"],
            "url": url,
            "description": f.get("description", ""),
            "meta": f.get("meta", ""),
        })
    return items


def _catalog_items(root: Optional[Path]) -> list[dict[str, Any]]:
    try:
        data = json.loads(_read_text(CATALOG_JSON, root) or "{}")
    except ValueError:
        return []
    items = data.get("items") if isinstance(data, dict) else None
    return [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []


def _marketplace_entry(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "name": item.get("name"),
        "category": item.get("category"),
        "description": item.get("description", ""),
        "source": item.get("source"),
    }


def build_design_catalog(root: Optional[Path] = None) -> dict[str, Any]:
    items = _catalog_items(root)
    return {
        "ok": True,
        "design_resources": _page_resources(DESIGN_PAGE, root),
        "design_marketplace": [_marketplace_entry(i) for i in items if i.get("category") == "Design"],
        "vigolium": [_marketplace_entry(i) for i in items if "vigolium" in str(i.get("id", ""))],
        "open_source_tools": _page_resources(OSS_PAGE, root),
    }


def build_free_catalog(root: Optional[Path] = None) -> dict[str, Any]:
    providers = list_free_providers(root)
    return {
        "ok": True,
        "count": len(providers),
        "providers": providers,
        "free_api_resources": [
            _marketplace_entry(i) for i in _catalog_items(root) if i.get("id") == "free-llm-apis"
        ],
    }
