"""Workflow runs: production deploys are never runnable, failures persist, output is redacted."""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server  # noqa: E402


class WorkflowDeployTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.original_data_dir = server._BRIDGE_DATA_DIR
        server._BRIDGE_DATA_DIR = Path(self.tmp.name)
        self.client = TestClient(server.app)
        self.headers = {"X-Bridge-Token": server._read_bridge_token()}

    def tearDown(self):
        self.client.close()
        server._BRIDGE_DATA_DIR = self.original_data_dir
        self.tmp.cleanup()

    def _create(self, steps):
        created = self.client.post(
            "/api/workflows",
            headers=self.headers,
            json={"user_id": "wf-test", "name": "Deploy", "steps": steps},
        )
        self.assertEqual(created.status_code, 200)
        return created.json()["workflow"]["id"]

    def _run(self, workflow_id):
        return self.client.post(
            "/api/workflows",
            headers=self.headers,
            json={"user_id": "wf-test", "action": "run", "id": workflow_id},
        )

    def _load(self, workflow_id):
        return self.client.get(
            f"/api/workflows?user_id=wf-test&id={workflow_id}", headers=self.headers
        ).json()["workflow"]

    def test_production_deploy_is_refused_before_any_step_runs(self):
        workflow_id = self._create([
            {"id": "stage", "title": "Staging", "kind": "command", "ref": "bridge:deploy:staging"},
            {"id": "prod", "title": "Prod", "kind": "command", "ref": "bridge:deploy:production:app-service",
             "deps": ["stage"]},
        ])
        with patch.object(server, "_deploy_azure") as deploy_mock:
            response = self._run(workflow_id)
        self.assertEqual(response.status_code, 422)
        self.assertIn("deploy from the CLI", response.json()["detail"])
        deploy_mock.assert_not_called()
        loaded = self._load(workflow_id)
        self.assertEqual(loaded["status"], "failed")
        self.assertEqual({s["id"]: s["status"] for s in loaded["steps"]}["prod"], "failed")

    def test_parse_refuses_production_and_unknown_deploy_refs(self):
        for ref in (
            "bridge:deploy:production",
            "bridge:deploy:PRODUCTION:static",
            "bridge:deploy:qa",
            "bridge:deploy:staging:docker",
            "bridge:deploy:staging:static:extra",
            "bridge:deployx",
            "bridge:shell",
        ):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                server._parse_workflow_command(ref)
        self.assertEqual(server._parse_workflow_command("bridge:deploy"), ("bridge:deploy", ("staging", "static")))
        self.assertEqual(
            server._parse_workflow_command("bridge:deploy:dev:app"), ("bridge:deploy", ("dev", "app-service"))
        )

    def test_staging_deploy_runs_with_parsed_environment(self):
        workflow_id = self._create([
            {"id": "dev", "title": "Dev", "kind": "command", "ref": "bridge:deploy:dev:app-service"},
        ])
        with patch.object(server, "_deploy_azure", return_value={"output": "ok"}) as deploy_mock:
            response = self._run(workflow_id)
        self.assertEqual(response.status_code, 200)
        deploy_mock.assert_called_once_with(environment="dev", target="app-service")
        self.assertEqual(response.json()["workflow"]["status"], "done")

    def test_failing_deploy_persists_failed_state_and_returns_502(self):
        workflow_id = self._create([
            {"id": "stage", "title": "Staging", "kind": "command", "ref": "bridge:deploy:staging"},
        ])
        with patch.object(server, "_deploy_azure", side_effect=RuntimeError("Azure deployment failed: boom")):
            response = self._run(workflow_id)
        self.assertEqual(response.status_code, 502)
        self.assertIn("boom", response.json()["detail"])
        loaded = self._load(workflow_id)
        self.assertEqual(loaded["status"], "failed")
        self.assertEqual(loaded["steps"][0]["status"], "failed")
        self.assertTrue(any("boom" in entry["msg"] for entry in loaded["log"]))

    def test_deploy_output_is_redacted(self):
        secret = "ghp_" + "a" * 30
        fake = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=f"\x1b[32mdeployed\x1b[0m token={secret}\n", stderr=""
        )
        with patch.object(server.subprocess, "run", return_value=fake):
            result = server._deploy_azure("staging", "static")
        self.assertNotIn(secret, result["output"])
        self.assertNotIn("\x1b[", result["output"])
        self.assertIn("deployed", result["output"])

        failed = subprocess.CompletedProcess(args=[], returncode=1, stdout="", stderr=f"auth {secret} failed")
        with patch.object(server.subprocess, "run", return_value=failed):
            with self.assertRaises(RuntimeError) as ctx:
                server._deploy_azure("staging", "static")
        self.assertNotIn(secret, str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
