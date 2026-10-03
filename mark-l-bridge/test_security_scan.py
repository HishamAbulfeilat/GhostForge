"""Tests for the defensive security-scan endpoint (scanners and subprocess mocked).

Run with: python -m pytest mark-l-bridge/test_security_scan.py
(also works with python -m unittest).
"""

import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
import security_scan as ss  # noqa: E402
import server  # noqa: E402

SECRET = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2"
ROOT = str(ss.REPO_ROOT)


def fake_which(binary):
    return f"/usr/bin/{binary}"


class SecurityScanTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.headers = {"X-Bridge-Token": server._read_bridge_token()}
        self.calls = []

    def tearDown(self):
        self.client.close()

    def fake_run(self, argv, **kwargs):
        self.calls.append((argv, kwargs))
        kwargs["stdout"].write(f"\x1b[31mleak\x1b[0m token={SECRET}\n".encode())
        return subprocess.CompletedProcess(argv, 0)

    def post(self, json=None):
        return self.client.post("/api/security-scan", headers=self.headers, json=json)

    def test_requires_authentication(self):
        self.assertEqual(self.client.get("/api/security-scan").status_code, 401)
        self.assertEqual(self.client.post("/api/security-scan").status_code, 401)
        bad = {"X-Bridge-Token": "wrong"}
        self.assertEqual(self.client.post("/api/security-scan", headers=bad).status_code, 401)

    def test_unauthenticated_run_never_spawns(self):
        with patch.object(ss.shutil, "which", side_effect=fake_which), \
                patch.object(ss.subprocess, "run", side_effect=self.fake_run):
            self.client.post("/api/security-scan", json={"scanner": "gitleaks"})
        self.assertEqual(self.calls, [])

    def test_status_reports_availability(self):
        with patch.object(ss.shutil, "which",
                          side_effect=lambda b: fake_which(b) if b == "gitleaks" else None):
            body = self.client.get("/api/security-scan", headers=self.headers).json()
        avail = {s["id"]: s["available"] for s in body["scanners"]}
        self.assertEqual(avail, {"gitleaks": True, "osv-scanner": False, "semgrep": False})
        self.assertFalse(body["running"])

    def test_missing_scanner_is_unavailable(self):
        with patch.object(ss.shutil, "which", return_value=None), \
                patch.object(ss.subprocess, "run", side_effect=self.fake_run):
            r = self.post()
        self.assertEqual(r.status_code, 200)
        results = r.json()["results"]
        self.assertEqual([x["id"] for x in results], ["gitleaks", "osv-scanner", "semgrep"])
        for result in results:
            self.assertEqual(result["status"], "unavailable")
            self.assertFalse(result["available"])
            self.assertIn("install_hint", result)
        self.assertEqual(self.calls, [])

    def test_fixed_argv_against_repo_root(self):
        with patch.object(ss.shutil, "which", side_effect=fake_which), \
                patch.object(ss.subprocess, "run", side_effect=self.fake_run):
            r = self.post()
        self.assertEqual(r.status_code, 200)
        argvs = {argv[0]: argv[1:] for argv, _ in self.calls}
        self.assertEqual(argvs, {
            "/usr/bin/gitleaks": ["detect", "--source", ROOT, "--no-banner", "--redact",
                                  "--exit-code", "0"],
            "/usr/bin/osv-scanner": ["--recursive", ROOT],
            "/usr/bin/semgrep": ["scan", "--config", "p/default", "--metrics", "off",
                                 "--quiet", ROOT],
        })
        for _, kwargs in self.calls:
            self.assertFalse(kwargs["shell"])
            # Never run inside the repo: stray relative writes must not land there.
            self.assertFalse(Path(kwargs["cwd"]).resolve().is_relative_to(ss.REPO_ROOT))
            self.assertEqual(kwargs["timeout"], ss.TIMEOUT_S)

    def test_rejects_user_supplied_args_paths_and_unknown_scanners(self):
        with patch.object(ss.shutil, "which", side_effect=fake_which), \
                patch.object(ss.subprocess, "run", side_effect=self.fake_run):
            for body in ({"scanner": "gitleaks", "args": ["--source", "/etc"]},
                         {"scanner": "gitleaks", "path": "/"},
                         {"scanner": "gitleaks", "cwd": "/"},
                         {"scanner": "gitleaks", "env": {"PATH": "/tmp"}},
                         {"scanner": "nmap"},
                         {"scanner": "/bin/sh"},
                         {"scanner": "gitleaks --source /"}):
                self.assertIn(self.post(body).status_code, (400, 422), body)
        self.assertEqual(self.calls, [])

    def test_single_scanner_output_is_sanitized(self):
        with patch.object(ss.shutil, "which", side_effect=fake_which), \
                patch.object(ss.subprocess, "run", side_effect=self.fake_run):
            r = self.post({"scanner": "gitleaks"})
        result = r.json()["results"][0]
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(result["status"], "ok")
        self.assertNotIn(SECRET, r.text)
        self.assertNotIn("\x1b", result["output"])
        self.assertIn("[REDACTED]", result["output"])

    def test_output_is_capped(self):
        def noisy(argv, **kwargs):
            kwargs["stdout"].write(b"x" * (ss.MAX_OUTPUT_BYTES * 3))
            return subprocess.CompletedProcess(argv, 1)

        with patch.object(ss.shutil, "which", side_effect=fake_which), \
                patch.object(ss.subprocess, "run", side_effect=noisy):
            result = self.post({"scanner": "semgrep"}).json()["results"][0]
        self.assertTrue(result["truncated"])
        self.assertEqual(result["status"], "findings")
        self.assertLess(len(result["output"]), ss.MAX_OUTPUT_BYTES + 100)

    def test_timeout_is_reported(self):
        def slow(argv, **kwargs):
            raise subprocess.TimeoutExpired(argv, kwargs["timeout"])

        with patch.object(ss.shutil, "which", side_effect=fake_which), \
                patch.object(ss.subprocess, "run", side_effect=slow):
            result = self.post({"scanner": "osv-scanner"}).json()["results"][0]
        self.assertEqual(result["status"], "timeout")
        self.assertIsNone(result["exit_code"])

    def test_scanner_env_drops_secrets(self):
        with patch.dict(ss.os.environ, {"GITHUB_TOKEN": SECRET, "MARKL_BRIDGE_TOKEN": "x"}):
            env = ss.scan_env()
        self.assertNotIn("GITHUB_TOKEN", env)
        self.assertNotIn("MARKL_BRIDGE_TOKEN", env)
        self.assertEqual(env["SEMGREP_SEND_METRICS"], "off")

    def test_scanner_env_keeps_windows_system_locations(self):
        # Dropping these made Windows write "%SystemDrive%/ProgramData/..." caches
        # relative to the working directory.
        system = {"SystemDrive": "C:", "SystemRoot": r"C:\Windows", "ProgramData": r"C:\ProgramData",
                  "WINDIR": r"C:\Windows", "ALLUSERSPROFILE": r"C:\ProgramData"}
        with patch.dict(ss.os.environ, system):
            env = ss.scan_env()
        upper = {k.upper(): v for k, v in env.items()}
        self.assertEqual(len(upper), len(env), "case-variant duplicates")
        for key, value in system.items():
            self.assertEqual(upper.get(key.upper()), value, key)

    def test_concurrent_scan_is_rejected(self):
        self.assertTrue(ss._scan_lock.acquire(blocking=False))
        try:
            self.assertEqual(self.post({"scanner": "gitleaks"}).status_code, 409)
        finally:
            ss._scan_lock.release()

    def test_build_argv_rejects_unknown(self):
        with self.assertRaises(KeyError):
            ss.build_argv("hackingtool", "/usr/bin/x")


if __name__ == "__main__":
    unittest.main()
