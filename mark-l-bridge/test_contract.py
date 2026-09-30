"""Focused contract checks for the web-only bridge handlers.

Run with: python -m unittest mark-l-bridge/test_contract.py
"""

import tempfile
import unittest
from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
import server  # noqa: E402


class BridgeContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        server._BRIDGE_DATA_DIR = Path(self.tmp.name)
        server._COLLAB_SESSIONS.clear()
        self.client = TestClient(server.app)
        self.headers = {"X-Bridge-Token": server._read_bridge_token()}

    def tearDown(self):
        self.tmp.cleanup()

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


if __name__ == "__main__":
    unittest.main()
