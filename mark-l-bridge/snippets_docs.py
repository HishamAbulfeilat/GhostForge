"""Read-only access to snippets/ and the repo-root CHANGELOG.md / README.md.

Only fixed documents and regular files directly inside snippets/ are readable.
Names are validated against a strict pattern, files are opened without
following symlinks, and size is capped. Nothing is written or executed.
"""

from __future__ import annotations

import os
import re
import stat
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent

DOCS = ("CHANGELOG.md", "README.md")
SNIPPETS_DIR = "snippets"
SNIPPET_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
MAX_FILE_BYTES = 256 * 1024


def _read_regular_file(path: Path) -> Optional[str]:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    try:
        fd = os.open(path, flags)
    except OSError:
        return None
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_FILE_BYTES:
            return None
        with os.fdopen(fd, "rb", closefd=False) as fh:
            return fh.read(MAX_FILE_BYTES + 1).decode("utf-8", errors="replace")
    except OSError:
        return None
    finally:
        os.close(fd)


def list_snippets(root: Optional[Path] = None) -> list[str]:
    base = (root or REPO_ROOT) / SNIPPETS_DIR
    try:
        entries = list(base.iterdir())
    except OSError:
        return []
    return sorted(
        p.name for p in entries
        if SNIPPET_NAME.match(p.name) and p.is_file() and not p.is_symlink()
    )


def read_snippet(name: str, root: Optional[Path] = None) -> Optional[str]:
    if not SNIPPET_NAME.match(name) or name not in list_snippets(root):
        return None
    return _read_regular_file((root or REPO_ROOT) / SNIPPETS_DIR / name)


def read_doc(name: str, root: Optional[Path] = None) -> Optional[str]:
    if name not in DOCS:
        return None
    return _read_regular_file((root or REPO_ROOT) / name)
