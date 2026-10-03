"""Tests for the read-only command catalog endpoint.

Run with: python -m pytest mark-l-bridge/test_commands_catalog.py
"""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
import commands_catalog as cc  # noqa: E402
import server  # noqa: E402


class CommandsEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.headers = {"X-Bridge-Token": server._read_bridge_token()}

    def tearDown(self):
        self.client.close()

    def test_requires_authentication(self):
        self.assertEqual(self.client.get("/api/commands").status_code, 401)
        bad = {"X-Bridge-Token": "wrong"}
        self.assertEqual(self.client.get("/api/commands", headers=bad).status_code, 401)

    def test_shape_for_real_repo(self):
        r = self.client.get("/api/commands", headers=self.headers)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["count"], len(body["commands"]))
        kinds = {c["kind"] for c in body["commands"]}
        self.assertEqual(kinds, {"command", "script"})
        for c in body["commands"]:
            self.assertEqual(set(c), {"name", "description", "kind", "path"})
            self.assertTrue(c["name"])
            self.assertFalse(c["path"].startswith(("/", "..")))
            self.assertNotIn("..", c["path"])

    def test_only_get_is_allowed(self):
        self.assertEqual(self.client.post("/api/commands", headers=self.headers).status_code, 405)

    def test_never_executes_anything(self):
        with patch.object(subprocess, "run") as run, patch.object(subprocess, "Popen") as popen:
            self.client.get("/api/commands", headers=self.headers)
        run.assert_not_called()
        popen.assert_not_called()


class CatalogHelperTests(unittest.TestCase):
    def make_repo(self, tmp):
        root = Path(tmp)
        (root / "commands").mkdir()
        (root / "scripts").mkdir()
        (root / "commands" / "fix.md").write_text("# /fix\n\nFix the failing build.\n", "utf-8")
        (root / "commands" / "notes.txt").write_text("ignored", "utf-8")
        (root / "scripts" / "deploy.sh").write_text(
            "#!/usr/bin/env bash\nset -e\n# Deploy the app\nrm -rf /\n", "utf-8")
        (root / "scripts" / "tool.js").write_text(
            "#!/usr/bin/env node\n/**\n * Bridge helper\n */\n", "utf-8")
        return root

    def test_names_descriptions_kinds(self):
        with tempfile.TemporaryDirectory() as tmp:
            items = cc.list_commands(self.make_repo(tmp))
        by_path = {i["path"]: i for i in items}
        self.assertEqual(set(by_path), {"commands/fix.md", "scripts/deploy.sh", "scripts/tool.js"})
        self.assertEqual(by_path["commands/fix.md"]["name"], "fix")
        self.assertEqual(by_path["commands/fix.md"]["description"], "Fix the failing build.")
        self.assertEqual(by_path["commands/fix.md"]["kind"], "command")
        self.assertEqual(by_path["scripts/deploy.sh"]["description"], "Deploy the app")
        self.assertEqual(by_path["scripts/tool.js"]["description"], "Bridge helper")
        self.assertEqual(by_path["scripts/tool.js"]["kind"], "script")

    def test_does_not_leak_file_bodies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.make_repo(tmp)
            (root / "commands" / "long.md").write_text("# x\n" + "a" * 5000, "utf-8")
            items = cc.list_commands(root)
        for i in items:
            self.assertLessEqual(len(i["description"]), cc.MAX_DESCRIPTION)

    def test_symlink_escaping_directory_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as outside:
            root = self.make_repo(tmp)
            secret = Path(outside) / "secret.md"
            secret.write_text("# secret\n\ntop secret\n", "utf-8")
            try:
                (root / "commands" / "escape.md").symlink_to(secret)
            except (OSError, NotImplementedError):
                self.skipTest("symlinks unavailable")
            items = cc.list_commands(root)
        self.assertNotIn("escape", {i["name"] for i in items})
        self.assertNotIn("top secret", str(items))

    def test_symlinked_catalog_dir_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as outside:
            root = Path(tmp)
            (root / "scripts").mkdir()
            (Path(outside) / "x.md").write_text("# x\n\nhi\n", "utf-8")
            try:
                (root / "commands").symlink_to(outside, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("symlinks unavailable")
            items = cc.list_commands(root)
        self.assertEqual([i for i in items if i["kind"] == "command"], [])

    def test_missing_directories_are_ok(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(cc.list_commands(Path(tmp)), [])


if __name__ == "__main__":
    unittest.main()
