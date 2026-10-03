"""Read-only GitHub dashboard data for the bridge: open issues, open PRs and
recent workflow runs for one repo.

Uses the ``gh`` CLI when available, otherwise ``GITHUB_TOKEN``/``GH_TOKEN``
from the environment over the REST API. The token is never logged or returned.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.request
from typing import Any, Optional

TIMEOUT_S = 20
LIMIT = 20
_REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_REMOTE_RE = re.compile(r"github\.com[:/]([^/\s]+/[^/\s]+?)(?:\.git)?/?$")


class Unavailable(Exception):
    """gh/token missing, repo unknown, or the upstream call failed."""


def _unavailable(reason: str, repo: Optional[str] = None) -> dict[str, Any]:
    return {"ok": False, "available": False, "reason": reason, "repo": repo,
            "issues": [], "pull_requests": [], "workflow_runs": []}


def resolve_repo() -> Optional[str]:
    for var in ("GHOSTFORGE_GITHUB_REPO", "GITHUB_REPOSITORY"):
        value = os.environ.get(var, "").strip()
        if _REPO_RE.match(value):
            return value
    try:
        url = subprocess.run(
            ["git", "remote", "get-url", "origin"], capture_output=True,
            text=True, timeout=5, check=False,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    match = _REMOTE_RE.search(url)
    return match.group(1) if match and _REPO_RE.match(match.group(1)) else None


def _token() -> str:
    return (os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or "").strip()


def _gh_json(args: list[str]) -> Any:
    try:
        proc = subprocess.run(
            ["gh", *args], capture_output=True, text=True,
            timeout=TIMEOUT_S, check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise Unavailable(f"gh CLI failed: {type(exc).__name__}") from exc
    if proc.returncode != 0:
        raise Unavailable("gh CLI returned an error (is it authenticated?)")
    try:
        return json.loads(proc.stdout or "null")
    except ValueError as exc:
        raise Unavailable("gh CLI returned invalid JSON") from exc


def _rest_json(path: str, token: str) -> Any:
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "ghostforge-bridge",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:  # noqa: S310
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise Unavailable(f"GitHub API returned HTTP {exc.code}") from exc
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise Unavailable("GitHub API request failed") from exc


def _via_gh(repo: str) -> dict[str, Any]:
    common = ["--repo", repo, "--limit", str(LIMIT)]
    issues = _gh_json(["issue", "list", "--state", "open", *common,
                       "--json", "number,title,url,author,labels,updatedAt"])
    prs = _gh_json(["pr", "list", "--state", "open", *common,
                    "--json", "number,title,url,author,isDraft,updatedAt"])
    runs = _gh_json(["run", "list", *common, "--json",
                     "databaseId,displayTitle,workflowName,status,conclusion,headBranch,url,createdAt"])
    return {
        "issues": [{
            "number": i.get("number"), "title": i.get("title"), "url": i.get("url"),
            "author": (i.get("author") or {}).get("login"),
            "labels": [lb.get("name") for lb in i.get("labels") or []],
            "updated_at": i.get("updatedAt"),
        } for i in issues or []],
        "pull_requests": [{
            "number": p.get("number"), "title": p.get("title"), "url": p.get("url"),
            "author": (p.get("author") or {}).get("login"),
            "draft": bool(p.get("isDraft")), "updated_at": p.get("updatedAt"),
        } for p in prs or []],
        "workflow_runs": [{
            "id": r.get("databaseId"), "title": r.get("displayTitle"),
            "workflow": r.get("workflowName"), "status": r.get("status"),
            "conclusion": r.get("conclusion"), "branch": r.get("headBranch"),
            "url": r.get("url"), "created_at": r.get("createdAt"),
        } for r in runs or []],
    }


def _via_token(repo: str, token: str) -> dict[str, Any]:
    base = f"/repos/{repo}"
    issues = _rest_json(f"{base}/issues?state=open&per_page={LIMIT}", token)
    prs = _rest_json(f"{base}/pulls?state=open&per_page={LIMIT}", token)
    runs = _rest_json(f"{base}/actions/runs?per_page={LIMIT}", token)
    return {
        "issues": [{
            "number": i.get("number"), "title": i.get("title"), "url": i.get("html_url"),
            "author": (i.get("user") or {}).get("login"),
            "labels": [lb.get("name") for lb in i.get("labels") or []],
            "updated_at": i.get("updated_at"),
        } for i in issues or [] if "pull_request" not in i],
        "pull_requests": [{
            "number": p.get("number"), "title": p.get("title"), "url": p.get("html_url"),
            "author": (p.get("user") or {}).get("login"),
            "draft": bool(p.get("draft")), "updated_at": p.get("updated_at"),
        } for p in prs or []],
        "workflow_runs": [{
            "id": r.get("id"), "title": r.get("display_title"), "workflow": r.get("name"),
            "status": r.get("status"), "conclusion": r.get("conclusion"),
            "branch": r.get("head_branch"), "url": r.get("html_url"),
            "created_at": r.get("created_at"),
        } for r in (runs or {}).get("workflow_runs", [])],
    }


def dashboard() -> dict[str, Any]:
    repo = resolve_repo()
    if not repo:
        return _unavailable("No GitHub repo configured (set GHOSTFORGE_GITHUB_REPO=owner/name)")
    token = _token()
    use_gh = shutil.which("gh") is not None
    if not use_gh and not token:
        return _unavailable("Neither the gh CLI nor GITHUB_TOKEN is available", repo)
    try:
        try:
            data = _via_gh(repo) if use_gh else _via_token(repo, token)
        except Unavailable:
            if not (use_gh and token):
                raise
            data = _via_token(repo, token)
    except Unavailable as exc:
        return _unavailable(str(exc), repo)
    return {"ok": True, "available": True, "repo": repo,
            "source": "gh" if use_gh else "token", **data}
