"""Defensive security scans for the bridge: gitleaks, osv-scanner and semgrep.

Only the scanners in ``SCANNERS`` can run, each with a fixed argv built here
against the repository root. Callers may pick a scanner id; they never supply
paths, arguments or environment. Scanners run without a shell, with a minimal
environment, a timeout and a cap on captured output, which is ANSI-stripped and
secret-redacted before it is returned. No pentest or offensive tooling.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
TIMEOUT_S = 120
MAX_OUTPUT_BYTES = 20_000

# id -> (binary, fixed argv builder, install hint)
SCANNERS: dict[str, tuple[str, Callable[[str], list[str]], str]] = {
    "gitleaks": (
        "gitleaks",
        lambda root: ["detect", "--source", root, "--no-banner", "--redact", "--exit-code", "0"],
        "Install Gitleaks from the Marketplace or https://github.com/gitleaks/gitleaks",
    ),
    "osv-scanner": (
        "osv-scanner",
        lambda root: ["--recursive", root],
        "Install OSV-Scanner from the Marketplace or https://github.com/google/osv-scanner",
    ),
    "semgrep": (
        "semgrep",
        lambda root: ["scan", "--config", "p/default", "--metrics", "off", "--quiet", root],
        "Install Semgrep from the Marketplace or `pip install semgrep`",
    ),
}

_ENV_KEEP = ("PATH", "Path", "PATHEXT", "HOME", "USERPROFILE", "SYSTEMROOT", "SystemRoot",
             "TEMP", "TMP", "TMPDIR", "LANG", "APPDATA", "LOCALAPPDATA")
_ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)")
_SECRET_PATTERNS = [
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)"),
     "[REDACTED PRIVATE KEY]"),
    (re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), "[REDACTED]"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"), "[REDACTED]"),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"), "[REDACTED]"),
    (re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b"), "[REDACTED]"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"), "[REDACTED]"),
    (re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}\b"), "[REDACTED]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"), "[REDACTED]"),
    (re.compile(r"\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}", re.I), r"\1 [REDACTED]"),
    (re.compile(r"\b([A-Za-z0-9_]*(?:secret|token|password|passwd|api[_-]?key|private[_-]?key)"
                r"[A-Za-z0-9_]*)(\s*[:=]\s*)([\"']?)[^\s\"']{6,}\3", re.I), r"\1\2\3[REDACTED]\3"),
]

_scan_lock = threading.Lock()


class Busy(Exception):
    """A scan is already running."""


def build_argv(scanner_id: str, binary_path: str) -> list[str]:
    """Fixed argv for an allowlisted scanner; raises KeyError for anything else."""
    _binary, args, _hint = SCANNERS[scanner_id]
    return [binary_path, *args(str(REPO_ROOT))]


def find_binary(binary: str) -> Optional[str]:
    path = shutil.which(binary)
    # Batch shims re-parse their arguments through cmd.exe; only run real executables.
    if path and sys.platform == "win32" and path.lower().endswith((".bat", ".cmd")):
        return None
    return path


def scan_env() -> dict[str, str]:
    """Minimal environment: no API keys or bridge secrets reach scanners."""
    env = {k: os.environ[k] for k in _ENV_KEEP if os.environ.get(k)}
    env.update(NO_COLOR="1", SEMGREP_SEND_METRICS="off")
    return env


def sanitize(raw: bytes, truncated: bool) -> str:
    text = _ANSI_RE.sub("", raw.decode("utf-8", errors="replace")).replace("\r\n", "\n")
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    if truncated:
        text += f"\n... output truncated at {MAX_OUTPUT_BYTES} bytes"
    return text


def status() -> dict[str, Any]:
    return {
        "ok": True,
        "running": _scan_lock.locked(),
        "timeout_s": TIMEOUT_S,
        "scanners": [{
            "id": scanner_id,
            "available": find_binary(binary) is not None,
            "install_hint": hint,
        } for scanner_id, (binary, _args, hint) in SCANNERS.items()],
    }


def _run_one(scanner_id: str) -> dict[str, Any]:
    binary, _args, hint = SCANNERS[scanner_id]
    binary_path = find_binary(binary)
    if not binary_path:
        return {"id": scanner_id, "status": "unavailable", "available": False,
                "reason": f"{binary} is not installed or not on PATH", "install_hint": hint}
    started = time.monotonic()
    # Capture to a temp file so a noisy scanner cannot grow bridge memory unbounded.
    with tempfile.TemporaryFile() as out:
        try:
            proc = subprocess.run(
                build_argv(scanner_id, binary_path), cwd=str(REPO_ROOT), env=scan_env(),
                stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT,
                timeout=TIMEOUT_S, check=False, shell=False,
            )
            exit_code = proc.returncode
            state = {0: "ok", 1: "findings"}.get(exit_code, "error")
        except subprocess.TimeoutExpired:
            state, exit_code = "timeout", None
        except OSError as exc:
            state, exit_code = "error", None
            out.write(f"Could not start {binary}: {type(exc).__name__}".encode())
        out.seek(0)
        raw = out.read(MAX_OUTPUT_BYTES + 1)
    truncated = len(raw) > MAX_OUTPUT_BYTES
    return {
        "id": scanner_id, "status": state, "available": True, "exit_code": exit_code,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "output": sanitize(raw[:MAX_OUTPUT_BYTES], truncated), "truncated": truncated,
    }


def run(scanner_id: Optional[str] = None) -> dict[str, Any]:
    """Run one allowlisted scanner, or all of them; one scan at a time."""
    ids = [scanner_id] if scanner_id else list(SCANNERS)
    if any(i not in SCANNERS for i in ids):
        raise KeyError(scanner_id)
    if not _scan_lock.acquire(blocking=False):
        raise Busy()
    try:
        results = [_run_one(i) for i in ids]
    finally:
        _scan_lock.release()
    return {"ok": True, "root": REPO_ROOT.name, "results": results}
