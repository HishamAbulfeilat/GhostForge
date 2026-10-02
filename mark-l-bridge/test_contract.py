"""Focused contract checks for the web-only bridge handlers.

Run with: python -m unittest mark-l-bridge/test_contract.py
"""

import json
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
        self.original_users_file = server._GHOSTFORGE_USERS_FILE
        self.original_job_hunter_dir = server._JOB_HUNTER_DIR
        self.original_missing = set(server._MISSING)
        self.original_collab_sessions = server._COLLAB_SESSIONS.copy()
        server._BRIDGE_DATA_DIR = Path(self.tmp.name)
        server._GHOSTFORGE_USERS_FILE = Path(self.tmp.name) / "users.json"
        server._JOB_HUNTER_DIR = Path(self.tmp.name) / "jobs"
        server._MISSING.discard("system_monitor")
        server._COLLAB_SESSIONS.clear()
        self.client = TestClient(server.app)
        self.headers = {"X-Bridge-Token": server._read_bridge_token()}

    def tearDown(self):
        self.client.close()
        server._BRIDGE_DATA_DIR = self.original_data_dir
        server._GHOSTFORGE_USERS_FILE = self.original_users_file
        server._JOB_HUNTER_DIR = self.original_job_hunter_dir
        server._MISSING.clear()
        server._MISSING.update(self.original_missing)
        server._COLLAB_SESSIONS.clear()
        server._COLLAB_SESSIONS.update(self.original_collab_sessions)
        self.tmp.cleanup()

    def test_feature_routes_require_authentication(self):
        paths = (
            "/api/jarvis/collab",
            "/api/jarvis/users",
            "/api/jarvis/access-profiles",
            "/api/jobs",
            "/api/workflows",
            "/api/webhook",
            "/api/devices",
            "/api/devices/status",
            "/api/remote/setup",
            "/api/release",
            "/api/marketplace",
            "/api/n8n/workflows",
        )
        for path in paths:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 401)
        for path, payload in (
            ("/api/devices", {"user_id": "contract-test", "id": "device-1"}),
            ("/api/remote/setup", {"action": "start-websockify"}),
        ):
            with self.subTest(path=path, method="POST"):
                response = self.client.post(path, json=payload)
                self.assertEqual(response.status_code, 401)

    def _write_marketplace(self, catalog=None, registry=None):
        mdir = Path(self.tmp.name) / "marketplace"
        mdir.mkdir(exist_ok=True)
        if catalog is not None:
            (mdir / "catalog.json").write_text(
                catalog if isinstance(catalog, str) else json.dumps(catalog), encoding="utf-8"
            )
        if registry is not None:
            (mdir / "registry.json").write_text(
                registry if isinstance(registry, str) else json.dumps(registry), encoding="utf-8"
            )
        return mdir

    def _marketplace_get(self, mdir, **params):
        with patch.object(server, "_MARKETPLACE_DIR", mdir):
            return self.client.get("/api/marketplace", params=params, headers=self.headers)

    def test_marketplace_installed_union_and_removal_rule(self):
        catalog = {"items": [
            {"id": "seeded", "type": "tool", "category": "Quality", "installed": True},
            {"id": "user-installed", "type": "agent", "category": "Quality"},
            {"id": "seeded-removed", "type": "tool", "category": "Security", "installed": True},
            {"id": "installed-and-removed", "type": "skill", "category": "Security"},
            {"id": "plain", "type": "skill", "category": "Quality"},
        ]}
        registry = {"installed": ["user-installed", "installed-and-removed"],
                    "removed": ["seeded-removed", "installed-and-removed"]}
        mdir = self._write_marketplace(catalog, registry)
        before = {p.name: p.read_bytes() for p in mdir.iterdir()}
        response = self._marketplace_get(mdir)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        state = {i["id"]: i["installed"] for i in body["items"]}
        self.assertEqual(state, {
            "seeded": True, "user-installed": True, "seeded-removed": False,
            "installed-and-removed": False, "plain": False,
        })
        self.assertEqual(body["count"], 5)
        self.assertEqual(before, {p.name: p.read_bytes() for p in mdir.iterdir()})

    def test_marketplace_filters(self):
        catalog = {"items": [
            {"id": "a", "type": "tool", "category": "Quality", "installed": True},
            {"id": "b", "type": "tool", "category": "Security"},
            {"id": "c", "type": "agent", "category": "Quality"},
        ]}
        mdir = self._write_marketplace(catalog, {"installed": ["c"], "removed": []})
        ids = lambda r: sorted(i["id"] for i in r.json()["items"])  # noqa: E731
        self.assertEqual(ids(self._marketplace_get(mdir, type="tool")), ["a", "b"])
        self.assertEqual(ids(self._marketplace_get(mdir, category="Quality")), ["a", "c"])
        self.assertEqual(ids(self._marketplace_get(mdir, installed="true")), ["a", "c"])
        self.assertEqual(ids(self._marketplace_get(mdir, installed="false")), ["b"])
        self.assertEqual(ids(self._marketplace_get(mdir, type="tool", installed="true")), ["a"])

    def test_marketplace_missing_registry_is_empty_and_bad_json_is_clear(self):
        mdir = self._write_marketplace({"items": [{"id": "a", "installed": True}, {"id": "b"}]})
        response = self._marketplace_get(mdir)
        self.assertEqual(response.status_code, 200)
        self.assertEqual({i["id"]: i["installed"] for i in response.json()["items"]},
                         {"a": True, "b": False})
        self._write_marketplace(registry="{not json")
        response = self._marketplace_get(mdir)
        self.assertEqual(response.status_code, 503)
        self.assertIn("registry.json", response.json()["detail"])
        (mdir / "catalog.json").unlink()
        response = self._marketplace_get(mdir)
        self.assertEqual(response.status_code, 503)
        self.assertIn("catalog.json not found", response.json()["detail"])
        self._write_marketplace(catalog={"items": "nope"}, registry={})
        self.assertEqual(self._marketplace_get(mdir).status_code, 503)

    def test_jarvis_users_and_access_profiles_are_read_only_and_safe(self):
        server._GHOSTFORGE_USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        server._GHOSTFORGE_USERS_FILE.write_text(
            json.dumps(
                {
                    "users": [
                        {
                            "username": "hisham",
                            "role": "admin",
                            "permissions": ["*", "terminal", "n8n"],
                            "passwordHash": "secret_hash",
                            "token": "secret_token",
                        },
                        {
                            "username": "maya",
                            "role": "user",
                            "permissions": ["chat", "documents"],
                            "passwordHash": "other_hash",
                            "apiKey": "api-key",
                        },
                    ]
                },
                indent=2,
            ),
            encoding="utf-8",
        )

        response = self.client.get("/api/jarvis/users", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual([user["username"] for user in payload["users"]], ["hisham", "maya"])
        self.assertIn("role", payload["users"][0])
        self.assertIn("permissions", payload["users"][0])
        for user in payload["users"]:
            self.assertNotIn("passwordHash", user)
            self.assertNotIn("password", user)
            self.assertNotIn("token", user)
            self.assertNotIn("apiKey", user)
        self.assertGreater(len(payload["profiles"]), 0)
        for profile in payload["profiles"]:
            self.assertIn("id", profile)
            self.assertIn("label", profile)
            self.assertIn("permissions", profile)
            self.assertNotIn("keywords", profile)

        profile_response = self.client.get("/api/jarvis/access-profiles", headers=self.headers)
        self.assertEqual(profile_response.status_code, 200)
        self.assertIn("profiles", profile_response.json())

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

    def test_jobs_search_and_autopilot_read_job_hunter_profile_and_no_submit(self):
        user = "contract-search"
        profile_dir = server._JOB_HUNTER_DIR / user
        profile_dir.mkdir(parents=True, exist_ok=True)
        profile_dir.joinpath("profile.json").write_text(
            __import__("json").dumps(
                {
                    "cv": {"fileName": "cv.txt"},
                    "applicant": {"firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com", "phone": "123"},
                    "preferences": {"titles": ["Backend Engineer", "Platform Engineer"], "locations": ["Remote"], "remote": "any"},
                    "autopilot": {"enabled": True, "dailyLimit": 3},
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        profile_dir.joinpath("jobs.json").write_text(
            __import__("json").dumps(
                [
                    {"id": "job-1", "title": "Backend Engineer", "company": "GhostForge", "description": "Build APIs and platform services", "location": "Remote", "status": "found"},
                    {"id": "job-2", "title": "Designer", "company": "Acme", "description": "Design marketing pages", "location": "Remote", "status": "found"},
                ],
                indent=2,
            ),
            encoding="utf-8",
        )

        searched = self.client.post(
            "/api/jobs",
            headers=self.headers,
            json={"user_id": user, "action": "search", "terms": ["Backend Engineer"], "auto_prepare": 2},
        )
        self.assertEqual(searched.status_code, 200)
        self.assertEqual(searched.json()["result"]["matched"], 1)
        self.assertEqual(searched.json()["result"]["prepared"], 1)

        autopilot = self.client.post(
            "/api/jobs",
            headers=self.headers,
            json={"user_id": user, "action": "autopilot"},
        )
        self.assertEqual(autopilot.status_code, 200)
        self.assertEqual(autopilot.json()["report"]["submitted"], 0)
        self.assertGreaterEqual(autopilot.json()["report"]["prepared"], 0)

        loaded = self.client.get(f"/api/jobs?user_id={user}", headers=self.headers)
        self.assertTrue(loaded.json()["ready"]["hasCv"])
        self.assertTrue(loaded.json()["autopilot"]["enabled"])

    def test_jobs_search_missing_cv_returns_clear_failure(self):
        user = "contract-no-cv"
        profile_dir = server._JOB_HUNTER_DIR / user
        profile_dir.mkdir(parents=True, exist_ok=True)
        profile_dir.joinpath("profile.json").write_text(
            __import__("json").dumps(
                {"applicant": {"firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com", "phone": "123"}},
                indent=2,
            ),
            encoding="utf-8",
        )
        response = self.client.post(
            "/api/jobs",
            headers=self.headers,
            json={"user_id": user, "action": "search", "terms": ["Backend Engineer"]},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Upload your CV first", response.json()["detail"])

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
        self.assertEqual(first.json()["device"]["id"], "device-1")
        self.assertIn("updatedAt", first.json()["device"])
        self.assertNotIn("user_id", first.json()["device"])
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

    def test_device_live_status_returns_host_metrics_and_validates_user(self):
        metrics = {"cpu_percent": 12.5, "ram_percent": 40.0}
        with patch.object(server, "_get_system_status", return_value=metrics):
            response = self.client.get(
                "/api/devices/status?user_id=contract-test", headers=self.headers
            )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "online")
        self.assertEqual(payload["user"], "contract-test")
        self.assertEqual(payload["metrics"], metrics)
        self.assertEqual(payload["device"]["platform"], server.platform.system().lower())
        self.assertEqual(payload["device"]["hostname"], server.socket.gethostname())
        self.assertIn("updatedAt", payload)

        invalid_user = self.client.get(
            "/api/devices/status?user_id=../outside", headers=self.headers
        )
        self.assertEqual(invalid_user.status_code, 400)

    def test_device_live_status_fails_clearly_when_monitor_is_unavailable(self):
        server._MISSING.add("system_monitor")
        response = self.client.get("/api/devices/status", headers=self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertIn("system_monitor", response.json()["detail"]["error"])

    def test_remote_setup_status_and_start_keep_websocket_listener_loopback_only(self):
        with patch.object(server, "_probe_loopback_port", return_value=False):
            status = self.client.get("/api/remote/setup", headers=self.headers)
        self.assertEqual(status.status_code, 200)
        self.assertFalse(status.json()["websockify"])
        self.assertIsNone(status.json()["noVncUrl"])

        with (
            patch.object(server.shutil, "which", return_value="/usr/bin/websockify"),
            patch.object(server, "_find_novnc_root", return_value=Path(self.tmp.name)),
            patch.object(server, "_probe_loopback_port", return_value=False),
            patch.object(server.subprocess, "Popen") as popen,
        ):
            started = self.client.post(
                "/api/remote/setup",
                headers=self.headers,
                json={"action": "start-websockify"},
            )

        self.assertEqual(started.status_code, 200)
        self.assertTrue(started.json()["ok"])
        self.assertTrue(started.json()["started"])
        self.assertEqual(started.json()["listenerHost"], "127.0.0.1")
        argv = popen.call_args.args[0]
        self.assertEqual(argv[1], "127.0.0.1:6080")
        self.assertEqual(argv[2], "127.0.0.1:5900")
        self.assertIn("--web", argv)
        self.assertTrue(popen.call_args.kwargs["close_fds"])

        invalid_action = self.client.post(
            "/api/remote/setup",
            headers=self.headers,
            json={"action": "run-command"},
        )
        invalid_request = self.client.post(
            "/api/remote/setup", headers=self.headers, json={"action": ""}
        )
        self.assertEqual(invalid_action.status_code, 400)
        self.assertEqual(invalid_request.status_code, 422)

    def test_remote_setup_refuses_to_reuse_an_unverified_listener(self):
        with (
            patch.object(server.shutil, "which", return_value="/usr/bin/websockify"),
            patch.object(server, "_find_novnc_root", return_value=Path(self.tmp.name)),
            patch.object(server, "_probe_loopback_port", return_value=True),
            patch.object(server.subprocess, "Popen") as popen,
        ):
            response = self.client.post(
                "/api/remote/setup",
                headers=self.headers,
                json={"action": "start-websockify"},
            )
        self.assertEqual(response.status_code, 409)
        self.assertIn("unverified listener", response.json()["detail"])
        popen.assert_not_called()

    def test_remote_setup_fails_safely_when_websockify_is_unavailable(self):
        for websockify, novnc in (
            (None, Path(self.tmp.name)),
            ("/usr/bin/websockify", None),
        ):
            with (
                patch.object(server.shutil, "which", return_value=websockify),
                patch.object(server, "_find_novnc_root", return_value=novnc),
                patch.object(server.subprocess, "Popen") as popen,
            ):
                response = self.client.post(
                    "/api/remote/setup",
                    headers=self.headers,
                    json={"action": "start-websockify"},
                )
            self.assertEqual(response.status_code, 503)
            self.assertIn("websockify and noVNC", response.json()["detail"]["error"])
            popen.assert_not_called()

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


    def test_n8n_list_exposes_only_declared_workflows(self):
        response = self.client.get("/api/n8n/workflows", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        by_id = {item["id"]: item for item in response.json()["workflows"]}
        self.assertTrue(by_id["ghostforge-notify"]["triggerable"])
        self.assertEqual(by_id["ghostforge-notify"]["webhookPath"], "ghostforge-notify")
        self.assertFalse(by_id["ghostforge-agent-monitor"]["triggerable"])
        self.assertIsNone(by_id["ghostforge-agent-monitor"]["webhookPath"])

    def test_n8n_trigger_requires_auth_and_valid_known_id(self):
        body = {"id": "ghostforge-notify", "payload": {}}
        self.assertEqual(self.client.post("/api/n8n/trigger", json=body).status_code, 401)
        with patch.object(server, "_n8n_post") as post_mock:
            for bad in ("../etc/passwd", "http://evil.test/x", "Bad Id", "", "a" * 65):
                with self.subTest(id=bad):
                    r = self.client.post(
                        "/api/n8n/trigger", headers=self.headers, json={"id": bad}
                    )
                    self.assertIn(r.status_code, (400, 422))
            unknown = self.client.post(
                "/api/n8n/trigger", headers=self.headers, json={"id": "nope"}
            )
            inactive = self.client.post(
                "/api/n8n/trigger", headers=self.headers, json={"id": "ghostforge-agent-monitor"}
            )
            self.assertEqual(unknown.status_code, 404)
            self.assertEqual(inactive.status_code, 409)
            post_mock.assert_not_called()

    def test_n8n_trigger_posts_to_declared_loopback_webhook_only(self):
        with patch.dict("os.environ", {"GHOSTFORGE_N8N_URL": "http://127.0.0.1:5678"}), patch.object(
            server, "_n8n_post", return_value=(200, b'{"done": true}')
        ) as post_mock:
            response = self.client.post(
                "/api/n8n/trigger",
                headers=self.headers,
                json={"id": "ghostforge-notify", "payload": {"message": "hi"}},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["result"], {"done": True})
        url, body = post_mock.call_args.args
        self.assertEqual(url, "http://127.0.0.1:5678/webhook/ghostforge-notify")
        self.assertEqual(json.loads(body), {"message": "hi"})

    def test_n8n_trigger_rejects_urls_commands_and_oversized_payloads(self):
        with patch.object(server, "_n8n_post") as post_mock:
            for payload in ({"webhookUrl": "http://evil.test"}, {"a": {"Command": "rm -rf /"}}):
                r = self.client.post(
                    "/api/n8n/trigger",
                    headers=self.headers,
                    json={"id": "ghostforge-notify", "payload": payload},
                )
                self.assertEqual(r.status_code, 400)
            big = self.client.post(
                "/api/n8n/trigger",
                headers=self.headers,
                json={"id": "ghostforge-notify", "payload": {"m": "x" * 20000}},
            )
            self.assertEqual(big.status_code, 413)
            post_mock.assert_not_called()

    def test_n8n_trigger_refuses_non_loopback_endpoint_and_maps_failures(self):
        request = {"id": "ghostforge-notify", "payload": {}}
        for url in ("http://evil.test:5678", "http://user:pw@localhost:5678", "ftp://localhost", "http://localhost/x"):
            with self.subTest(url=url), patch.dict("os.environ", {"GHOSTFORGE_N8N_URL": url}), patch.object(
                server, "_n8n_post"
            ) as post_mock:
                r = self.client.post("/api/n8n/trigger", headers=self.headers, json=request)
                self.assertEqual(r.status_code, 503)
                post_mock.assert_not_called()
        with patch.object(server, "_n8n_post", side_effect=OSError("down")):
            self.assertEqual(
                self.client.post("/api/n8n/trigger", headers=self.headers, json=request).status_code, 502
            )
        with patch.object(server, "_n8n_post", return_value=(500, b"boom")):
            self.assertEqual(
                self.client.post("/api/n8n/trigger", headers=self.headers, json=request).status_code, 502
            )


if __name__ == "__main__":
    unittest.main()
