"""Tests for the read-only free APIs/models and design resources endpoints.

Run with: python -m unittest test_resource_catalogs (from mark-l-bridge/)
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
import resource_catalogs as rc  # noqa: E402
import server  # noqa: E402

SECRET = "s3cr3t-value-must-not-leak-4d2c1b"
PATHS = ("/api/free-apis", "/api/design-resources")


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.headers = {"X-Bridge-Token": server._read_bridge_token()}

    def tearDown(self):
        self.client.close()

    def test_requires_authentication(self):
        for path in PATHS:
            self.assertEqual(self.client.get(path).status_code, 401, path)
            r = self.client.get(path, headers={"X-Bridge-Token": "wrong"})
            self.assertEqual(r.status_code, 401, path)

    def test_post_not_allowed(self):
        for path in PATHS:
            self.assertEqual(self.client.post(path, headers=self.headers).status_code, 405, path)

    def test_free_apis_shape_and_no_secret_leak(self):
        with patch.dict(os.environ, {"GROQ_API_KEY": SECRET, "OPENROUTER_API_KEY": ""}):
            r = self.client.get("/api/free-apis", headers=self.headers)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["count"], len(body["providers"]))
        by_id = {p["id"]: p for p in body["providers"]}
        self.assertIs(by_id["groq"]["key_set"], True)
        self.assertIs(by_id["openrouter"]["key_set"], False)
        self.assertIsNone(by_id["pollinations"]["key_set"])
        self.assertNotIn(SECRET, r.text)
        keys = {"id", "name", "paid", "key_env", "key_set", "key_url", "default_model"}
        for p in body["providers"]:
            self.assertEqual(set(p), keys)

    def test_design_resources_shape(self):
        r = self.client.get("/api/design-resources", headers=self.headers)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["ok"])
        self.assertTrue(body["design_resources"])
        self.assertTrue(body["open_source_tools"])
        self.assertTrue(any(v["id"] == "vigolium-scanner" for v in body["vigolium"]))
        for item in body["design_resources"] + body["open_source_tools"]:
            self.assertRegex(item["url"], r"^https?://")


class ParserTests(unittest.TestCase):
    def test_missing_sources_yield_empty(self):
        root = Path(__file__).parent / "does-not-exist"
        self.assertEqual(rc.list_free_providers(root), [])
        body = rc.build_design_catalog(root)
        self.assertEqual(body["design_resources"], [])
        self.assertEqual(body["vigolium"], [])

    def test_non_http_urls_dropped(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            page = root / rc.DESIGN_PAGE
            page.parent.mkdir(parents=True)
            page.write_text(
                "  { name: 'Bad', url: 'javascript:alert(1)', description: 'x', meta: 'm' },\n"
                "  { name: 'Good', url: 'https://ok.example', description: 'it\\'s fine', meta: 'm' },\n",
                encoding="utf-8",
            )
            items = rc.build_design_catalog(root)["design_resources"]
        self.assertEqual([i["name"] for i in items], ["Good"])
        self.assertEqual(items[0]["description"], "it's fine")


if __name__ == "__main__":
    unittest.main()
