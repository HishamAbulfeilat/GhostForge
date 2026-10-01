"""Focused contract checks for the web-only bridge handlers.

Run with: python -m unittest mark-l-bridge/test_contract.py
"""

import tempfile
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
import server  # noqa: E402


class BridgeContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.original_data_dir = server._BRIDGE_DATA_DIR
        self.original_collab_sessions = server._COLLAB_SESSIONS.copy()
        server._BRIDGE_DATA_DIR = Path(self.tmp.name)
        server._COLLAB_SESSIONS.clear()
        self.client = TestClient(server.app)
        self.headers = {"X-Bridge-Token": server._read_bridge_token()}

    def tearDown(self):
        self.client.close()
        server._BRIDGE_DATA_DIR = self.original_data_dir
        server._COLLAB_SESSIONS.clear()
        server._COLLAB_SESSIONS.update(self.original_collab_sessions)
        self.tmp.cleanup()

    def test_feature_routes_require_authentication(self):
        paths = (
            "/api/jarvis/collab",
            "/api/jobs",
            "/api/workflows",
            "/api/webhook",
            "/api/devices",
            "/api/release",
        )
        for path in paths:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 401)

    def test_collaboration_get_creates_and_post_persists_message(self):
        created = self.client.get("/api/jarvis/collab", headers=self.headers)
        self.assertEqual(created.status_code, 200)
        payload = created.json()
        self.assertIn("id", payload)
        self.assertIn("shareUrl", payload)

        posted = self.client.post(
            "/api/jarvis/collab",
            headers=self.headers,
            json={"id": payload["id"], "role": "user", "content": "hello"},
        )
        self.assertEqual(posted.status_code, 200)
        loaded = self.client.get(f"/api/jarvis/collab?id={payload['id']}", headers=self.headers)
        self.assertEqual(loaded.json()["messages"][0]["content"], "hello")
        self.assertEqual(loaded.json()["participants"], 2)

        invalid_role = self.client.post(
            "/api/jarvis/collab",
            headers=self.headers,
            json={"id": payload["id"], "role": "system", "content": "not allowed"},
        )
        missing_session = self.client.get(
            "/api/jarvis/collab?id=missing-session", headers=self.headers
        )
        self.assertEqual(invalid_role.status_code, 400)
        self.assertEqual(missing_session.status_code, 404)

    def test_jobs_actions_validate_and_persist_status(self):
        server._write_store(
            "jobs",
            "contract-test",
            [{"id": "job-1", "title": "Bridge engineer", "status": "pending"}],
        )
        prepared = self.client.post(
            "/api/jobs",
            headers=self.headers,
            json={"user_id": "contract-test", "action": "prepare", "id": "job-1"},
        )
        self.assertEqual(prepared.status_code, 200)
        self.assertEqual(prepared.json()["job"]["status"], "ready")

        loaded = self.client.get(
            "/api/jobs?user_id=contract-test", headers=self.headers
        )
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.json()["jobs"][0]["status"], "ready")

        invalid_action = self.client.post(
            "/api/jobs",
            headers=self.headers,
            json={"user_id": "contract-test", "action": "launch"},
        )
        missing_job = self.client.post(
            "/api/jobs",
            headers=self.headers,
            json={"user_id": "contract-test", "action": "dismiss", "id": "missing"},
        )
        invalid_user = self.client.get(
            "/api/jobs?user_id=../outside", headers=self.headers
        )
        invalid_request = self.client.post(
            "/api/jobs",
            headers=self.headers,
            json={"action": "search", "auto_prepare": 6},
        )
        self.assertEqual(invalid_action.status_code, 400)
        self.assertEqual(missing_job.status_code, 404)
        self.assertEqual(invalid_user.status_code, 400)
        self.assertEqual(invalid_request.status_code, 422)

    def test_workflow_update_without_status_preserves_status(self):
        created = self.client.post(
            "/api/workflows",
            headers=self.headers,
            json={"user_id": "contract-test", "name": "Build", "steps": [{"title": "Compile"}]},
        )
        workflow = created.json()["workflow"]
        running = self.client.put(
            "/api/workflows",
            headers=self.headers,
            json={"user_id": "contract-test", "id": workflow["id"], "status": "running"},
        ).json()["workflow"]
        updated = self.client.put(
            "/api/workflows",
            headers=self.headers,
            json={"user_id": "contract-test", "id": workflow["id"], "goal": "Ship it"},
        ).json()["workflow"]
        self.assertEqual(running["status"], "running")
        self.assertEqual(updated["status"], "running")
        self.assertEqual(updated["goal"], "Ship it")

        loaded = self.client.get(
            f"/api/workflows?user_id=contract-test&id={workflow['id']}",
            headers=self.headers,
        )
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.json()["workflow"]["status"], "running")
        self.assertEqual(loaded.json()["workflow"]["goal"], "Ship it")

        blank_name = self.client.post(
            "/api/workflows",
            headers=self.headers,
            json={"user_id": "contract-test", "name": "   "},
        )
        missing_id = self.client.put(
            "/api/workflows", headers=self.headers, json={"user_id": "contract-test"}
        )
        invalid_user = self.client.post(
            "/api/workflows",
            headers=self.headers,
            json={"user_id": "../outside", "name": "Unsafe"},
        )
        self.assertEqual(blank_name.status_code, 400)
        self.assertEqual(missing_id.status_code, 400)
        self.assertEqual(invalid_user.status_code, 400)

    def test_workflow_run_executes_allowlisted_steps_and_persists_progress(self):
        created = self.client.post(
            "/api/workflows",
            headers=self.headers,
            json={
                "user_id": "contract-test",
                "name": "Safe run",
                "steps": [
                    {"id": "health", "title": "Health", "kind": "command", "ref": "bridge:health"},
                    {"id": "human", "title": "Human review", "kind": "manual", "deps": ["health"]},
                ],
            },
        )
        self.assertEqual(created.status_code, 200)
        workflow_id = created.json()["workflow"]["id"]
        run = self.client.post(
            "/api/workflows",
            headers=self.headers,
            json={"user_id": "contract-test", "action": "run", "id": workflow_id},
        )
        self.assertEqual(run.status_code, 200)
        self.assertEqual(run.json()["workflow"]["status"], "done")
        self.assertEqual(run.json()["progress"], {"done": 2, "total": 2, "pct": 100})
        self.assertEqual(run.json()["workflow"]["steps"][0]["status"], "done")
        self.assertEqual(run.json()["workflow"]["steps"][1]["status"], "skipped")

        loaded = self.client.get(
            f"/api/workflows?user_id=contract-test&id={workflow_id}",
            headers=self.headers,
        )
        self.assertEqual(loaded.json()["workflow"]["status"], "done")

    def test_workflow_run_rejects_unsupported_and_unbounded_steps(self):
        created = self.client.post(
            "/api/workflows",
            headers=self.headers,
            json={
                "user_id": "contract-test",
                "name": "Unsafe run",
                "steps": [{"id": "shell", "title": "Shell", "kind": "command", "ref": "npm test"}],
            },
        )
        workflow_id = created.json()["workflow"]["id"]
        rejected = self.client.post(
            "/api/workflows",
            headers=self.headers,
            json={"user_id": "contract-test", "action": "run", "id": workflow_id},
        )
        self.assertEqual(rejected.status_code, 422)
        self.assertIn("Unsupported workflow step", rejected.json()["detail"])
        self.assertEqual(
            self.client.get(
                f"/api/workflows?user_id=contract-test&id={workflow_id}",
                headers=self.headers,
            ).json()["workflow"]["status"],
            "failed",
        )

        too_many = self.client.post(
            "/api/workflows",
            headers=self.headers,
            json={
                "user_id": "contract-test",
                "name": "Bounded run",
                "steps": [{"title": f"Step {i}"} for i in range(2)],
            },
        )
        limited = self.client.post(
            "/api/workflows",
            headers=self.headers,
            json={
                "user_id": "contract-test",
                "action": "run",
                "id": too_many.json()["workflow"]["id"],
                "max_steps": 1,
            },
        )
        self.assertEqual(limited.status_code, 422)
        self.assertIn("maximum is 1", limited.json()["detail"])

    def test_webhook_config_events_and_log_deletion_persist(self):
        config = [{"id": "build", "url": "https://example.invalid/hook"}]
        saved_config = self.client.post(
            "/api/webhook", headers=self.headers, json={"config": config}
        )
        self.assertEqual(saved_config.status_code, 200)
        self.assertEqual(
            self.client.get("/api/webhook", headers=self.headers).json(), config
        )

        received = self.client.post(
            "/api/webhook",
            headers=self.headers,
            json={
                "source": "ci",
                "event": "build.complete",
                "body": {"buildId": "build-1"},
            },
        )
        self.assertEqual(received.status_code, 200)
        self.assertEqual(received.json()["event"], "build.complete")
        log = self.client.get("/api/webhook?log=1", headers=self.headers)
        self.assertEqual(log.status_code, 200)
        self.assertEqual(log.json()[0]["source"], "ci")
        self.assertEqual(log.json()[0]["body"], {"buildId": "build-1"})

        invalid_payload = self.client.post(
            "/api/webhook", headers=self.headers, json={"body": []}
        )
        cleared = self.client.delete("/api/webhook", headers=self.headers)
        self.assertEqual(invalid_payload.status_code, 422)
        self.assertEqual(cleared.status_code, 200)
        self.assertEqual(
            self.client.get("/api/webhook?log=1", headers=self.headers).json(), []
        )

    def test_devices_upsert_validate_and_delete_persist(self):
        first = self.client.post(
            "/api/devices",
            headers=self.headers,
            json={
                "user_id": "contract-test",
                "id": "device-1",
                "name": "Laptop",
                "platform": "windows",
            },
        )
        self.assertEqual(first.status_code, 200)
        updated = self.client.post(
            "/api/devices",
            headers=self.headers,
            json={
                "user_id": "contract-test",
                "id": "device-1",
                "name": "Work laptop",
                "details": {"trusted": True},
            },
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(len(updated.json()["devices"]), 1)

        loaded = self.client.get(
            "/api/devices?user_id=contract-test", headers=self.headers
        )
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.json()["devices"][0]["name"], "Work laptop")
        self.assertEqual(loaded.json()["devices"][0]["details"], {"trusted": True})

        invalid_device = self.client.post(
            "/api/devices",
            headers=self.headers,
            json={"user_id": "contract-test", "id": ""},
        )
        invalid_user = self.client.get(
            "/api/devices?user_id=../outside", headers=self.headers
        )
        self.assertEqual(invalid_device.status_code, 422)
        self.assertEqual(invalid_user.status_code, 400)

        deleted = self.client.delete(
            "/api/devices?user_id=contract-test&id=device-1", headers=self.headers
        )
        missing = self.client.delete(
            "/api/devices?user_id=contract-test&id=missing", headers=self.headers
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(
            self.client.get(
                "/api/devices?user_id=contract-test", headers=self.headers
            ).json()["devices"],
            [],
        )

    def test_release_actions_validate(self):
        status = self.client.get("/api/release", headers=self.headers)
        self.assertEqual(status.status_code, 200)
        self.assertIn("version", status.json())
        self.assertIn("lastTag", status.json())

        prepared = self.client.post(
            "/api/release",
            headers=self.headers,
            json={"action": "prepare", "kind": "minor"},
        )
        notes = self.client.post(
            "/api/release", headers=self.headers, json={"action": "notes"}
        )
        invalid_action = self.client.post(
            "/api/release", headers=self.headers, json={"action": "publish"}
        )
        invalid_kind = self.client.post(
            "/api/release",
            headers=self.headers,
            json={"action": "prepare", "kind": "nightly"},
        )
        self.assertEqual(prepared.status_code, 200)
        self.assertEqual(prepared.json()["kind"], "minor")
        self.assertEqual(notes.status_code, 200)
        self.assertEqual(notes.json()["action"], "notes")
        self.assertEqual(invalid_action.status_code, 400)
        self.assertEqual(invalid_kind.status_code, 400)

    def test_release_deploy_requires_validated_environment_and_target(self):
        with patch.object(
            server,
            "_deploy_azure",
            return_value={"environment": "production", "target": "app-service", "output": "ok"},
        ) as deploy_mock:
            response = self.client.post(
                "/api/release",
                headers=self.headers,
                json={"action": "deploy", "environment": "production", "target": "app-service"},
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["environment"], "production")
            self.assertEqual(response.json()["target"], "app-service")
            deploy_mock.assert_called_once_with(environment="production", target="app-service")

        invalid_environment = self.client.post(
            "/api/release",
            headers=self.headers,
            json={"action": "deploy", "environment": "qa", "target": "static"},
        )
        invalid_target = self.client.post(
            "/api/release",
            headers=self.headers,
            json={"action": "deploy", "environment": "staging", "target": "docker"},
        )
        self.assertEqual(invalid_environment.status_code, 400)
        self.assertEqual(invalid_target.status_code, 400)


if __name__ == "__main__":
    unittest.main()
