"""Read-only catalog of the repo's slash commands (commands/) and scripts (scripts/).

Only lists file names and a one-line description read from the first bytes of each
file. Nothing is ever executed, imported or served in full, and every entry must
resolve inside its catalog directory (symlinks pointing elsewhere are skipped).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent

# kind -> (directory, file suffixes)
SOURCES = {
    "command": ("commands", {".md"}),
    "script": ("scripts", {".sh", ".mjs", ".js", ".cmd", ".ps1", ".py"}),
}
HEAD_BYTES = 2048
MAX_DESCRIPTION = 200
_SCRIPT_SKIP = re.compile(r"^(#!|set\s|@echo|'use strict'|\"use strict\"|import\s|from\s)")


def _contained(path: Path, base: Path) -> bool:
    try:
        return path.resolve().is_relative_to(base)
    except OSError:
        return False


def _head(path: Path) -> list[str]:
    try:
        with path.open("rb") as fh:
            raw = fh.read(HEAD_BYTES)
    except OSError:
        return []
    return raw.decode("utf-8", errors="replace").splitlines()


def _clip(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text[:MAX_DESCRIPTION]


def _command_description(lines: list[str]) -> str:
    for line in lines:
        line = line.strip()
        if line and not line.startswith(("#", "```", "---")):
            return _clip(line)
    return ""


def _script_description(lines: list[str]) -> str:
    for line in lines[:12]:
        line = line.strip()
        if not line or _SCRIPT_SKIP.match(line):
            continue
        m = re.match(r"^(?:#|//|REM\s|::|/\*\*?|\*)\s*(.*?)(?:\*/)?$", line, re.IGNORECASE)
        if m and m.group(1).strip("-=* ") and not m.group(1).startswith("!"):
            return _clip(m.group(1))
        if not m:
            break
    return ""


def list_commands(root: Optional[Path] = None) -> list[dict]:
    """Return [{name, description, kind, path}] sorted by kind then name."""
    base_root = (root or REPO_ROOT).resolve()
    items: list[dict] = []
    for kind, (dirname, suffixes) in SOURCES.items():
        base = (base_root / dirname).resolve()
        if not base.is_dir() or not base.is_relative_to(base_root):
            continue
        for path in sorted(base.iterdir(), key=lambda p: p.name.lower()):
            if path.suffix.lower() not in suffixes or not path.is_file():
                continue
            if not _contained(path, base):
                continue
            lines = _head(path)
            describe = _command_description if kind == "command" else _script_description
            items.append({
                "name": path.stem if kind == "command" else path.name,
                "description": describe(lines),
                "kind": kind,
                "path": f"{dirname}/{path.name}",
            })
    return items
