"""Read-only code-health and coverage runs for the bridge.

Only the scripts in ``SCRIPTS`` can run, each as ``bash scripts/<name>.sh`` with
a fixed argv built here. Callers pick a script id; they never supply paths,
arguments or environment. Scripts run without a shell, with a minimal
environment, a timeout and a cap on captured output, which is ANSI-stripped and
secret-redacted (shared with ``security_scan``). One run at a time.
"""

from __future__ import annotations

import subprocess
import tempfile
import threading
import time
from typing import Any, Optional

import security_scan

REPO_ROOT = security_scan.REPO_ROOT
TIMEOUT_S = 180
MAX_OUTPUT_BYTES = 20_000

# id -> (script file under scripts/, fixed script args, description). Mirrors the
# web-ui /api/code-health argv; never --fix. coverage reads recorded history only.
SCRIPTS: dict[str, tuple[str, tuple[str, ...], str]] = {
    "perf": ("perf.sh", ("http://localhost:3000", "desktop", "json"),
             "Lighthouse audit of the local web UI (needs the dev server and Lighthouse)"),
    "bundle": ("bundle.sh", ("track", "web-ui"), "Built JavaScript weight of web-ui"),
    "unused": ("unused.sh", (), "Dead code, exports and dependency finder (report only)"),
    "dep-health": ("dep-health.sh", ("full",), "Audit, outdated packages and upgrade drift"),
    "coverage": ("coverage.sh", ("history",), "Recorded test-coverage history"),
}

_run_lock = threading.Lock()


class Busy(Exception):
    """A run is already in progress."""


def find_bash() -> Optional[str]:
    return security_scan.find_binary("bash")


def build_argv(script_id: str, bash_path: str) -> list[str]:
    """Fixed argv for an allowlisted script; raises KeyError for anything else."""
    script, args, _desc = SCRIPTS[script_id]
    return [bash_path, str(REPO_ROOT / "scripts" / script), *args]


def status() -> dict[str, Any]:
    has_bash = find_bash() is not None
    return {
        "ok": True,
        "running": _run_lock.locked(),
        "timeout_s": TIMEOUT_S,
        "scripts": [{"id": i, "available": has_bash and (REPO_ROOT / "scripts" / s).is_file(),
                     "description": d} for i, (s, _a, d) in SCRIPTS.items()],
    }


def _sanitize(raw: bytes, truncated: bool) -> str:
    text = security_scan.sanitize(raw, False)
    if truncated:
        text += f"\n... output truncated at {MAX_OUTPUT_BYTES} bytes"
    return text


def _run_one(script_id: str) -> dict[str, Any]:
    bash = find_bash()
    script = REPO_ROOT / "scripts" / SCRIPTS[script_id][0]
    if not bash or not script.is_file():
        return {"id": script_id, "status": "unavailable", "available": False,
                "reason": "bash or the script is not available"}
    started = time.monotonic()
    # Capture to a temp file so a noisy script cannot grow bridge memory unbounded.
    with tempfile.TemporaryFile() as out:
        try:
            proc = subprocess.run(
                build_argv(script_id, bash), cwd=str(REPO_ROOT), env=security_scan.scan_env(),
                stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT,
                timeout=TIMEOUT_S, check=False, shell=False,
            )
            exit_code = proc.returncode
            state = "ok" if exit_code == 0 else "error"
        except subprocess.TimeoutExpired:
            state, exit_code = "timeout", None
        except OSError as exc:
            state, exit_code = "error", None
            out.write(f"Could not start bash: {type(exc).__name__}".encode())
        out.seek(0)
        raw = out.read(MAX_OUTPUT_BYTES + 1)
    truncated = len(raw) > MAX_OUTPUT_BYTES
    return {
        "id": script_id, "status": state, "available": True, "exit_code": exit_code,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "output": _sanitize(raw[:MAX_OUTPUT_BYTES], truncated), "truncated": truncated,
    }


def run(script_id: str) -> dict[str, Any]:
    """Run one allowlisted script; one run at a time."""
    if script_id not in SCRIPTS:
        raise KeyError(script_id)
    if not _run_lock.acquire(blocking=False):
        raise Busy()
    try:
        result = _run_one(script_id)
    finally:
        _run_lock.release()
    return {"ok": True, "root": REPO_ROOT.name, "result": result}
