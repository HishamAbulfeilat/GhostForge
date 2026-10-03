"""Tests for the read-only GitHub dashboard endpoint (gh and network mocked).

Run with: python -m pytest mark-l-bridge/test_github_dashboard.py
(also works with python -m unittest).
"""

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
import github_dashboard as gd  # noqa: E402
import server  # noqa: E402

SECRET = "ghp_supersecrettoken123"
ISSUES = [{"number": 1, "title": "bug", "url": "u1", "author": {"login": "a"},
           "labels": [{"name": "bug"}], "updatedAt": "t"}]
PRS = [{"number": 2, "title": "pr", "url": "u2", "author": {"login": "b"},
        "isDraft": True, "updatedAt": "t"}]
RUNS = [{"databaseId": 3, "displayTitle": "ci", "workflowName": "CI", "status": "completed",
         "conclusion": "success", "headBranch": "main", "url": "u3", "createdAt": "t"}]


def fake_run(args, **kwargs):
    if args[0] == "git":
        return subprocess.CompletedProcess(args, 0, stdout="https://github.com/o/r.git\n")
    data = {"issue": ISSUES, "pr": PRS, "run": RUNS}[args[1]]
    return subprocess.CompletedProcess(args, 0, stdout=json.dumps(data))


class GithubDashboardTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.headers = {"X-Bridge-Token": server._read_bridge_token()}
        drop = ("GITHUB_TOKEN", "GH_TOKEN", "GHOSTFORGE_GITHUB_REPO", "GITHUB_REPOSITORY")
        patcher = patch.dict(os.environ, {k: v for k, v in os.environ.items() if k not in drop}, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.client.close()

    def get(self):
        return self.client.get("/api/github/dashboard", headers=self.headers)

    def test_requires_authentication(self):
        self.assertEqual(self.client.get("/api/github/dashboard").status_code, 401)

    def test_gh_cli_success(self):
        with patch.object(gd.shutil, "which", return_value="gh"), \
                patch.object(gd.subprocess, "run", side_effect=fake_run):
            r = self.get()
        body = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["repo"], "o/r")
        self.assertEqual(body["source"], "gh")
        self.assertEqual(body["issues"][0]["labels"], ["bug"])
        self.assertTrue(body["pull_requests"][0]["draft"])
        self.assertEqual(body["workflow_runs"][0]["conclusion"], "success")

    def test_unavailable_without_gh_or_token(self):
        with patch.object(gd.shutil, "which", return_value=None), \
                patch.object(gd.subprocess, "run", side_effect=fake_run):
            r = self.get()
        body = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertFalse(body["ok"])
        self.assertFalse(body["available"])
        self.assertIn("GITHUB_TOKEN", body["reason"])
        self.assertEqual(body["issues"], [])

    def test_unavailable_without_repo(self):
        with patch.object(gd.subprocess, "run", side_effect=OSError("no git")):
            body = self.get().json()
        self.assertFalse(body["available"])
        self.assertIn("repo", body["reason"].lower())

    def test_gh_failure_is_unavailable(self):
        def failing(args, **kwargs):
            if args[0] == "git":
                return fake_run(args)
            return subprocess.CompletedProcess(args, 1, stdout="", stderr=f"auth {SECRET}")

        with patch.object(gd.shutil, "which", return_value="gh"), \
                patch.object(gd.subprocess, "run", side_effect=failing):
            r = self.get()
        self.assertFalse(r.json()["available"])
        self.assertNotIn(SECRET, r.text)

    def test_token_path_never_leaks_token(self):
        seen = {}

        def fake_rest(path, token):
            seen["token"] = token
            if "/issues" in path:
                return [{"number": 1, "title": "i", "html_url": "u", "user": {"login": "a"},
                         "labels": [], "updated_at": "t"},
                        {"number": 2, "title": "pr-as-issue", "pull_request": {}}]
            if "/pulls" in path:
                return [{"number": 3, "title": "p", "html_url": "u", "user": {"login": "b"},
                         "draft": False, "updated_at": "t"}]
            return {"workflow_runs": [{"id": 4, "display_title": "ci", "name": "CI",
                                       "status": "completed", "conclusion": "failure",
                                       "head_branch": "main", "html_url": "u", "created_at": "t"}]}

        with patch.dict(os.environ, {"GITHUB_TOKEN": SECRET, "GHOSTFORGE_GITHUB_REPO": "o/r"}), \
                patch.object(gd.shutil, "which", return_value=None), \
                patch.object(gd, "_rest_json", side_effect=fake_rest):
            r = self.get()
        body = r.json()
        self.assertEqual(seen["token"], SECRET)
        self.assertEqual(body["source"], "token")
        self.assertEqual([i["number"] for i in body["issues"]], [1])
        self.assertEqual(body["workflow_runs"][0]["conclusion"], "failure")
        self.assertNotIn(SECRET, r.text)

    def test_token_http_error_is_unavailable_without_token(self):
        err = gd.urllib.error.HTTPError("x", 401, "no", {}, None)
        with patch.dict(os.environ, {"GITHUB_TOKEN": SECRET, "GHOSTFORGE_GITHUB_REPO": "o/r"}), \
                patch.object(gd.shutil, "which", return_value=None), \
                patch.object(gd.urllib.request, "urlopen", side_effect=err):
            r = self.get()
        self.assertFalse(r.json()["available"])
        self.assertNotIn(SECRET, r.text)

    def test_invalid_repo_env_is_ignored(self):
        with patch.dict(os.environ, {"GHOSTFORGE_GITHUB_REPO": "bad repo; rm -rf"}), \
                patch.object(gd.subprocess, "run", side_effect=fake_run):
            self.assertEqual(gd.resolve_repo(), "o/r")


if __name__ == "__main__":
    unittest.main()
