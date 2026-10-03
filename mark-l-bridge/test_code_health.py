"""Tests for the allowlisted code-health/coverage endpoints.

Run with: python -m unittest test_code_health (from mark-l-bridge/)
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
import code_health as ch  # noqa: E402
import server  # noqa: E402


class _Proc:
    def __init__(self, returncode=0):
        self.returncode = returncode


class CodeHealthEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.headers = {"X-Bridge-Token": server._read_bridge_token()}

    def tearDown(self):
        self.client.close()

    def test_requires_authentication(self):
        self.assertEqual(self.client.get("/api/code-health").status_code, 401)
        self.assertEqual(self.client.post("/api/code-health", json={"script": "unused"}).status_code, 401)
        bad = {"X-Bridge-Token": "wrong"}
        self.assertEqual(self.client.post("/api/code-health", json={"script": "unused"}, headers=bad).status_code, 401)

    def test_unknown_script_rejected(self):
        with patch.object(ch, "run") as run:
            for body in ({"script": "rm"}, {"script": "../scripts/doctor.sh"},
                         {"script": "unused", "args": ["--fix"]}, {}):
                r = self.client.post("/api/code-health", json=body, headers=self.headers)
                self.assertIn(r.status_code, (400, 422), body)
            run.assert_not_called()

    def test_status_lists_allowlist(self):
        r = self.client.get("/api/code-health", headers=self.headers)
        self.assertEqual(r.status_code, 200)
        self.assertEqual({s["id"] for s in r.json()["scripts"]}, set(ch.SCRIPTS))

    def test_happy_path_runs_fixed_argv_without_shell(self):
        calls = []

        def fake_run(argv, **kw):
            calls.append((argv, kw))
            kw["stdout"].write(b"report ok")
            return _Proc(0)

        with patch.object(ch, "find_bash", return_value="/usr/bin/bash"), \
                patch.object(ch.subprocess, "run", side_effect=fake_run):
            r = self.client.post("/api/code-health", json={"script": "dep-health"}, headers=self.headers)
        self.assertEqual(r.status_code, 200)
        result = r.json()["result"]
        self.assertEqual((result["id"], result["status"], result["output"]), ("dep-health", "ok", "report ok"))
        argv, kw = calls[0]
        self.assertEqual(argv[0], "/usr/bin/bash")
        self.assertTrue(argv[1].endswith("dep-health.sh"))
        self.assertEqual(argv[2:], ["full"])
        self.assertIs(kw["shell"], False)
        self.assertEqual(kw["timeout"], ch.TIMEOUT_S)

    def test_output_capped(self):
        def fake_run(argv, **kw):
            kw["stdout"].write(b"x" * (ch.MAX_OUTPUT_BYTES + 500))
            return _Proc(1)

        with patch.object(ch, "find_bash", return_value="/usr/bin/bash"), \
                patch.object(ch.subprocess, "run", side_effect=fake_run):
            r = self.client.post("/api/code-health", json={"script": "coverage"}, headers=self.headers)
        result = r.json()["result"]
        self.assertTrue(result["truncated"])
        self.assertEqual(result["status"], "error")
        self.assertLess(len(result["output"]), ch.MAX_OUTPUT_BYTES + 100)

    def test_busy_returns_409(self):
        with patch.object(ch, "run", side_effect=ch.Busy()):
            r = self.client.post("/api/code-health", json={"script": "unused"}, headers=self.headers)
        self.assertEqual(r.status_code, 409)

    def test_allowlisted_scripts_exist_and_never_fix(self):
        for script, args, _d in ch.SCRIPTS.values():
            self.assertTrue((ch.REPO_ROOT / "scripts" / script).is_file(), script)
            self.assertNotIn("--fix", args)


if __name__ == "__main__":
    unittest.main()
