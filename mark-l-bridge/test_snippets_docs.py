"""Tests for the read-only snippets / changelog / README endpoints.

Run with: python -m pytest mark-l-bridge/test_snippets_docs.py
"""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
import snippets_docs as sd  # noqa: E402
import server  # noqa: E402


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.headers = {"X-Bridge-Token": server._read_bridge_token()}

    def tearDown(self):
        self.client.close()

    def test_requires_authentication(self):
        for path in ("/api/snippets", "/api/snippets/README.md", "/api/docs/CHANGELOG.md"):
            self.assertEqual(self.client.get(path).status_code, 401, path)
            r = self.client.get(path, headers={"X-Bridge-Token": "wrong"})
            self.assertEqual(r.status_code, 401, path)

    def test_list_shape_for_real_repo(self):
        r = self.client.get("/api/snippets", headers=self.headers)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["count"], len(body["snippets"]))
        self.assertEqual(body["docs"], ["CHANGELOG.md", "README.md"])
        self.assertIn("README.md", body["snippets"])

    def test_read_snippet_and_docs(self):
        r = self.client.get("/api/snippets/README.md", headers=self.headers)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["name"], "README.md")
        self.assertTrue(r.json()["content"])
        for doc in sd.DOCS:
            r = self.client.get(f"/api/docs/{doc}", headers=self.headers)
            self.assertEqual(r.status_code, 200, doc)
            self.assertTrue(r.json()["content"])

    def test_unknown_and_traversal_names_are_404(self):
        for path in ("/api/snippets/nope.md", "/api/snippets/..%2Fserver.py",
                     "/api/snippets/.env", "/api/docs/server.py", "/api/docs/..%2FLICENSE"):
            r = self.client.get(path, headers=self.headers)
            self.assertEqual(r.status_code, 404, path)

    def test_only_get_is_allowed(self):
        self.assertEqual(self.client.post("/api/snippets", headers=self.headers).status_code, 405)
        self.assertEqual(
            self.client.put("/api/docs/README.md", headers=self.headers).status_code, 405)

    def test_never_executes_anything(self):
        with patch.object(subprocess, "run") as run, patch.object(subprocess, "Popen") as popen:
            self.client.get("/api/snippets", headers=self.headers)
            self.client.get("/api/snippets/README.md", headers=self.headers)
        run.assert_not_called()
        popen.assert_not_called()


class HelperTests(unittest.TestCase):
    def make_repo(self, tmp):
        root = Path(tmp)
        (root / "snippets").mkdir()
        (root / "snippets" / "b.md").write_text("bee", "utf-8")
        (root / "snippets" / "a.ts").write_text("ay", "utf-8")
        (root / "snippets" / ".hidden").write_text("x", "utf-8")
        (root / "snippets" / "sub").mkdir()
        (root / "CHANGELOG.md").write_text("# log", "utf-8")
        return root

    def test_list_sorted_and_filtered(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(sd.list_snippets(self.make_repo(tmp)), ["a.ts", "b.md"])

    def test_read_and_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.make_repo(tmp)
            self.assertEqual(sd.read_snippet("b.md", root), "bee")
            self.assertIsNone(sd.read_snippet(".hidden", root))
            self.assertIsNone(sd.read_snippet("sub", root))
            self.assertEqual(sd.read_doc("CHANGELOG.md", root), "# log")
            self.assertIsNone(sd.read_doc("README.md", root))  # absent in temp repo
            self.assertIsNone(sd.read_doc("LICENSE", root))

    def test_oversize_file_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.make_repo(tmp)
            (root / "snippets" / "big.txt").write_text("a" * (sd.MAX_FILE_BYTES + 1), "utf-8")
            self.assertIsNone(sd.read_snippet("big.txt", root))

    def test_symlink_snippet_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as outside:
            root = self.make_repo(tmp)
            secret = Path(outside) / "secret.txt"
            secret.write_text("top secret", "utf-8")
            try:
                (root / "snippets" / "link.txt").symlink_to(secret)
            except (OSError, NotImplementedError):
                self.skipTest("symlinks unavailable")
            self.assertNotIn("link.txt", sd.list_snippets(root))
            self.assertIsNone(sd.read_snippet("link.txt", root))

    def test_missing_snippets_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(sd.list_snippets(Path(tmp)), [])


if __name__ == "__main__":
    unittest.main()
