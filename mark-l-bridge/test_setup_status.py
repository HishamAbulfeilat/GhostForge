"""Tests for the read-only setup status endpoint.

Run with: python -m unittest test_setup_status (from mark-l-bridge/)
"""

import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
import server  # noqa: E402
import setup_status as ss  # noqa: E402

SECRET = "s3cr3t-value-must-not-leak-9f8e7d"
KEYS = {
    "ok", "bridge_version", "required_env", "required_env_ok", "optional_env",
    "ollama_reachable", "openjarvis_enabled", "mark_lv_vendor_present",
}


class SetupStatusEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.headers = {"X-Bridge-Token": server._read_bridge_token()}

    def tearDown(self):
        self.client.close()

    def test_requires_authentication(self):
        self.assertEqual(self.client.get("/api/setup/status").status_code, 401)
        bad = {"X-Bridge-Token": "wrong"}
        self.assertEqual(self.client.get("/api/setup/status", headers=bad).status_code, 401)

    def test_response_shape(self):
        with patch.object(ss, "ollama_reachable", return_value=False):
            r = self.client.get("/api/setup/status", headers=self.headers)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(set(body), KEYS)
        self.assertTrue(body["ok"])
        self.assertEqual(body["bridge_version"], server.app.version)
        for flag in ("required_env_ok", "ollama_reachable", "openjarvis_enabled", "mark_lv_vendor_present"):
            self.assertIsInstance(body[flag], bool)
        for group in ("required_env", "optional_env"):
            self.assertTrue(body[group])
            self.assertTrue(all(isinstance(v, bool) for v in body[group].values()))
        self.assertIn("MARKL_BRIDGE_TOKEN", body["required_env"])

    def test_no_secret_value_leaks(self):
        env = {n: SECRET for n in ss.REQUIRED_ENV + ss.OPTIONAL_ENV}
        env["MARKL_BRIDGE_TOKEN"] = SECRET
        with patch.dict(os.environ, env), patch.object(ss, "ollama_reachable", return_value=False):
            headers = {"X-Bridge-Token": SECRET}
            r = self.client.get("/api/setup/status", headers=headers)
        self.assertEqual(r.status_code, 200)
        self.assertNotIn(SECRET, r.text)
        body = r.json()
        self.assertTrue(all(body["required_env"].values()))
        self.assertTrue(all(body["optional_env"].values()))
        self.assertTrue(body["required_env_ok"])
        json.dumps(body)

    def test_missing_env_reported_false(self):
        env = {n: "" for n in ss.OPTIONAL_ENV}
        with patch.dict(os.environ, env), patch.object(ss, "ollama_reachable", return_value=False):
            r = self.client.get("/api/setup/status", headers=self.headers)
        self.assertFalse(any(r.json()["optional_env"].values()))

    def test_only_get_is_allowed(self):
        self.assertEqual(self.client.post("/api/setup/status", headers=self.headers).status_code, 405)

    def test_ollama_flag_follows_probe(self):
        with patch.object(ss, "ollama_reachable", return_value=True):
            r = self.client.get("/api/setup/status", headers=self.headers)
        self.assertTrue(r.json()["ollama_reachable"])


class HelperTests(unittest.TestCase):
    def test_ollama_unreachable_is_false(self):
        self.assertFalse(ss.ollama_reachable("http://127.0.0.1:1/api/version"))

    def test_vendor_present(self):
        self.assertTrue(ss.vendor_present(Path(__file__).parent))
        self.assertFalse(ss.vendor_present(Path(__file__).parent / "does-not-exist"))


if __name__ == "__main__":
    unittest.main()
