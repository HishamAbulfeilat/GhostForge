"""Model download/install: bounded destination and honest Ollama status."""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai_models  # noqa: E402


class ModelInstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.models = base / "models"
        patches = [
            patch.object(ai_models, "DEFAULT_MODEL_DIR", self.models),
            patch.object(ai_models, "MODEL_REGISTRY_FILE", base / "registry.json"),
            patch.object(ai_models, "_snapshot_download", create=True, return_value=None),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_local_dir_must_stay_under_the_model_dir(self):
        outside = Path(self.tmp.name) / "elsewhere"
        for bad in (str(outside), "../escape", "/etc", ".", "sub/../../x"):
            with self.subTest(local_dir=bad), self.assertRaises(ValueError):
                ai_models.download_model("org/model", bad)
        self.assertFalse(outside.exists())
        with self.assertRaises(ValueError):
            ai_models.download_model("..")

        ok = ai_models.download_model("org/model", "custom/dir")
        self.assertEqual(Path(ok["local_path"]), (self.models / "custom" / "dir").resolve())
        default = ai_models.download_model("org/model")
        self.assertEqual(Path(default["local_path"]), (self.models / "org_model").resolve())

    def test_failed_ollama_create_is_not_reported_as_registered(self):
        failed = subprocess.CompletedProcess(args=[], returncode=1, stdout="", stderr="Error: unsupported model format")
        with patch.object(ai_models.subprocess, "run", return_value=failed):
            result = ai_models.install_model("org/model")
        self.assertFalse(result["ollama_registered"])
        self.assertNotIn("ollama_name", result)
        self.assertIn("unsupported model format", result["note"])

        ok = subprocess.CompletedProcess(args=[], returncode=0, stdout="success", stderr="")
        with patch.object(ai_models.subprocess, "run", return_value=ok):
            result = ai_models.install_model("org/model")
        self.assertTrue(result["ollama_registered"])
        self.assertEqual(result["ollama_name"], "org-model")

    def test_download_endpoint_rejects_outside_dir_with_400(self):
        import server
        from fastapi.testclient import TestClient

        if not server._HAS_AI_MODELS:
            self.skipTest("ai_models not importable by the bridge")
        with TestClient(server.app) as client, patch.object(server, "_ai_download_model") as download:
            response = client.post(
                "/api/mark-l/models/download",
                headers={"X-Bridge-Token": server._read_bridge_token()},
                json={"model_id": "org/model", "local_dir": "/etc"},
            )
        self.assertEqual(response.status_code, 400)
        download.assert_not_called()


if __name__ == "__main__":
    unittest.main()
