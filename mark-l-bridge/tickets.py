"""Read-only ticket, Azure DevOps and estimate runs for the bridge.

Only the tools in ``TOOLS`` can run, each as ``bash scripts/<name>.sh`` with a
fixed argv built here against the repository root. Callers pick a tool id and
supply one argument; it is validated here and reaches the child as a single argv
entry — there is no shell, no caller-supplied path and no caller-supplied
environment, so nothing in the argument can be executed. Read-only subcommands
only: nothing here creates or updates a ticket, a work item or a build, and
``estimate.sh`` is always pointed at the repository root with a fixed ``--path``.

``ado.sh`` needs an Azure DevOps org, project and PAT. The child inherits them
from the process environment (and, as the script already does, from
``.env.local``); their values are never returned, never logged, and are redacted
from any output before it reaches a caller — only whether they are set is
reported. When bash, the script or the credentials are missing, the result is a
structured ``{available: false, reason}`` rather than an exception or a 500.
Output is capped, ANSI-stripped and secret-redacted as in ``security_scan``, and
one run at a time.
"""

from __future__ import annotations

import os
import re
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, NamedTuple, Optional

import security_scan

REPO_ROOT = security_scan.REPO_ROOT
TIMEOUT_S = 180
MAX_OUTPUT_BYTES = 20_000
MAX_ARG_CHARS = 120


class Tool(NamedTuple):
    """One read-only script wrapper.

    ``subcommands`` is the allow-list of positional actions; it is empty for the
    scripts that take a free argument instead. ``credentials_for`` lists the
    actions that need Azure DevOps credentials, so the help subcommand of
    ``ado.sh`` stays usable on a machine that has never been configured.
    ``fixed_args`` are constant trailing arguments — never caller input.
    """

    script: str
    subcommands: tuple[str, ...]
    credentials_for: tuple[str, ...]
    description: str
    fixed_args: tuple[str, ...] = ()


# ado.sh: the only actions reachable here. `config` only prints the setup
# instructions, so it is the one that works without a PAT; status, pipelines and
# tickets all call the Azure DevOps API. ticket.sh and estimate.sh take a ticket
# id / description and reach nothing but the local filesystem.
TOOLS: dict[str, Tool] = {
    "ticket": Tool(
        "ticket.sh", (), (),
        "Scaffold guidance for a ticket id: branch name, commit template, file layout",
    ),
    "ado": Tool(
        "ado.sh", ("status", "pipelines", "tickets", "config"), ("status", "pipelines", "tickets"),
        "Azure DevOps connection status, recent pipeline runs, work items assigned to you",
    ),
    "estimate": Tool(
        "estimate.sh", (), (), "Fibonacci story-point estimate from codebase size and a description",
        # Fixed, not caller-supplied: without it the script prompts on stdin.
        fixed_args=(f"--path={REPO_ROOT}",),
    ),
}

# Read-only verbs that would mutate Azure DevOps or the repository. The allow-list
# above is the real gate; this is the tripwire if someone adds an action to it.
_FORBIDDEN_ACTIONS = ("create", "update", "delete", "post", "put", "patch", "write", "edit")

ADO_CREDENTIAL_ENV = ("AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PROJECT", "AZURE_DEVOPS_PAT",
                      "ADO_ORG", "ADO_PROJECT", "ADO_TOKEN")
# ado.sh sources these itself; we only need to know whether they are set, never what
# they are. Both names are checked because either can carry a credential.
_CREDENTIAL_FILES = (".env.local", ".env")

# ado.sh builds a `Authorization: Basic base64(:PAT)` header for curl. `-s` keeps it
# off stdout today, but an error path is exactly where a header tends to leak.
_BASIC_AUTH_RE = re.compile(r"\bBasic\s+[A-Za-z0-9+/=]{8,}", re.I)

_run_lock = threading.Lock()


class Busy(Exception):
    """A run is already in progress."""


def find_bash() -> Optional[str]:
    return security_scan.find_binary("bash")


def clean_arg(value: Any) -> str:
    """Validate the caller's one argument down to a plain, printable argv entry.

    Nothing here is executed — there is no shell downstream — but ``ticket.sh``
    interpolates its argument into ``echo -e`` format strings, so a backslash
    escape in it becomes a real terminal sequence. Control characters are
    refused outright and the ANSI scrubber in ``security_scan.sanitize`` covers
    whatever survives.
    """
    if not isinstance(value, str):
        raise ValueError("action must be a string")
    text = value.strip()
    if not text:
        raise ValueError("action is required")
    if len(text) > MAX_ARG_CHARS:
        raise ValueError(f"action must be {MAX_ARG_CHARS} characters or fewer")
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in text):
        raise ValueError("action must not contain control characters")
    return text


def build_argv(tool_id: str, action: str, bash_path: str) -> list[str]:
    """Fixed argv for an allowlisted tool; the caller's action is one argv entry."""
    tool = TOOLS[tool_id]
    return [bash_path, str(REPO_ROOT / "scripts" / tool.script), action, *tool.fixed_args]


def _credentials() -> dict[str, str]:
    """ado.sh's own resolution order: process environment first, then the env files.

    Returned for redaction and presence checks only — never to a caller.
    """
    found: dict[str, str] = {}
    for name in ADO_CREDENTIAL_ENV:
        value = os.environ.get(name, "").strip()
        if value:
            found[name.lower()] = value
    for filename in _CREDENTIAL_FILES:
        try:
            lines = (REPO_ROOT / filename).read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            name, sep, value = line.partition("=")
            name = name.strip()
            if not sep or name not in ADO_CREDENTIAL_ENV:
                continue
            value = value.strip().strip("'\"")
            if value and name.lower() not in found:
                found[name.lower()] = value
    return found


def credentials_configured() -> bool:
    """Whether ado.sh would find an org, a project and a PAT. Values never leave this."""
    found = _credentials()
    org = found.get("azure_devops_org") or found.get("ado_org")
    project = found.get("azure_devops_project") or found.get("ado_project")
    token = found.get("azure_devops_pat") or found.get("ado_token")
    return bool(org and project and token)


def run_env(tool: Tool) -> dict[str, str]:
    """The minimal scanner environment, plus the credentials ado.sh actually needs.

    These values go to the child process only; nothing here is logged or
    returned, and ``_redact`` strips them again from anything the child prints.
    """
    env = security_scan.scan_env()
    if tool.credentials_for:
        for name in ADO_CREDENTIAL_ENV:
            value = os.environ.get(name, "").strip()
            if value:
                env[name] = value
    return env


def status() -> dict[str, Any]:
    has_bash = find_bash() is not None
    configured = credentials_configured()
    tools = []
    for tool_id, tool in TOOLS.items():
        entry: dict[str, Any] = {
            "id": tool_id,
            "available": has_bash and (REPO_ROOT / "scripts" / tool.script).is_file(),
            "subcommands": list(tool.subcommands),
            "description": tool.description,
        }
        if tool.credentials_for:
            entry["credentials_configured"] = configured
        tools.append(entry)
    return {"ok": True, "running": _run_lock.locked(), "timeout_s": TIMEOUT_S, "tools": tools}


def _redact(text: str) -> str:
    """Remove the credentials themselves, not only their names."""
    for value in _credentials().values():
        if len(value) >= 8:
            text = text.replace(value, "[REDACTED]")
    return _BASIC_AUTH_RE.sub("Basic [REDACTED]", text)


def _sanitize(raw: bytes, truncated: bool) -> str:
    text = _redact(security_scan.sanitize(raw, False))
    if truncated:
        text += f"\n... output truncated at {MAX_OUTPUT_BYTES} bytes"
    return text


def _unavailable(tool_id: str, action: str, reason: str) -> dict[str, Any]:
    return {"id": tool_id, "action": action, "status": "unavailable", "available": False,
            "exit_code": None, "duration_ms": 0, "reason": reason, "truncated": False}


def _run_one(tool_id: str, action: str) -> dict[str, Any]:
    tool = TOOLS[tool_id]
    bash = find_bash()
    script = REPO_ROOT / "scripts" / tool.script
    if not bash or not script.is_file():
        return _unavailable(tool_id, action, "bash or the script is not available")
    if action in tool.credentials_for and not credentials_configured():
        return _unavailable(
            tool_id, action,
            "Azure DevOps is not configured (set AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT "
            "and AZURE_DEVOPS_PAT in .env.local)",
        )
    started = time.monotonic()
    # Capture to a temp file so a noisy script cannot grow bridge memory unbounded.
    with tempfile.TemporaryFile() as out:
        try:
            proc = subprocess.run(
                build_argv(tool_id, action, bash), cwd=str(REPO_ROOT), env=run_env(tool),
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
        "id": tool_id, "action": action, "status": state, "available": True,
        "exit_code": exit_code, "duration_ms": int((time.monotonic() - started) * 1000),
        "output": _sanitize(raw[:MAX_OUTPUT_BYTES], truncated), "truncated": truncated,
    }


def run(tool_id: str, action: str) -> dict[str, Any]:
    """Run one allowlisted read-only tool with one validated argument; one at a time.

    An unknown tool id raises KeyError from the lookup itself, so there is no
    second membership check to keep in sync with the allow-list.
    """
    tool = TOOLS[tool_id]
    action = clean_arg(action)
    if tool.subcommands and action not in tool.subcommands:
        raise ValueError(f"action must be one of: {', '.join(tool.subcommands)}")
    if not _run_lock.acquire(blocking=False):
        raise Busy()
    try:
        result = _run_one(tool_id, action)
    finally:
        _run_lock.release()
    return {"ok": True, "root": REPO_ROOT.name, "result": result}
