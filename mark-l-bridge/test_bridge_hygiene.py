"""Small bridge correctness fixes: token file creation, mark-liv errors, jarvis argv, crew cancel."""
from __future__ import annotations

import os
import stat
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai_agents  # noqa: E402
import server  # noqa: E402


class TokenFileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "bridge" / "token"

    def test_token_file_is_created_0600_with_no_window(self):
        if os.name != "posix":
            self.skipTest("POSIX permissions")
        modes = []
        real_open = os.open

        def spy(path, flags, mode=0o777, *args, **kwargs):
            if str(path) == str(self.path):
                modes.append((flags, mode))
            return real_open(path, flags, mode, *args, **kwargs)

        old_umask = os.umask(0)  # worst case: default-permission writes would be 0666
        try:
            with patch.object(server.os, "open", side_effect=spy):
                token = server._create_or_read_token_file(self.path)
        finally:
            os.umask(old_umask)
        self.assertEqual(len(token), 64)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        self.assertTrue(modes, "token file must be created with os.open")
        flags, mode = modes[0]
        self.assertTrue(flags & os.O_EXCL and flags & os.O_CREAT)
        self.assertEqual(mode, 0o600)

    def test_existing_token_is_read_not_replaced(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text("existing-token\n")
        self.assertEqual(server._create_or_read_token_file(self.path), "existing-token")
        self.assertEqual(self.path.read_text(), "existing-token\n")

    def test_concurrent_creators_agree_on_one_token(self):
        results: list[str] = []
        barrier = threading.Barrier(8)

        def worker():
            barrier.wait()
            results.append(server._create_or_read_token_file(self.path))

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(set(results)), 1)
        self.assertEqual(results[0], self.path.read_text().strip())


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.addCleanup(self.client.close)
        self.headers = {"X-Bridge-Token": server._read_bridge_token()}

    def test_mark_liv_discovery_failure_is_a_generic_error(self):
        with patch.object(server, "_mark_liv_registry", side_effect=ImportError("/secret/path/core missing")):
            response = self.client.post("/api/mark-liv/run", headers=self.headers, json={"name": "weather"})
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("/secret/path", response.text)
        self.assertIn("discovery failed", response.text)

    def test_mark_liv_tool_failure_hides_exception_text(self):
        class Registry:
            def names(self):
                return ["weather"]

            def run(self, name, params):
                raise RuntimeError("token=abc at /home/user/secret.py")

        with patch.object(server, "_mark_liv_registry", return_value=Registry()):
            response = self.client.post("/api/mark-liv/run", headers=self.headers, json={"name": "weather"})
        self.assertEqual(response.status_code, 200)
        body = response.json()["data"]
        self.assertTrue(body["error"])
        self.assertNotIn("secret", body["result"])

    def test_jarvis_ask_refuses_option_like_prompt(self):
        with patch.object(server, "_HAS_OPENJARVIS", True), patch.object(server, "_run_openjarvis_cli") as cli:
            response = self.client.post("/api/openjarvis/ask", headers=self.headers, json={"prompt": "--config=/tmp/x"})
            self.assertEqual(response.status_code, 400)
            cli.assert_not_called()
            cli.return_value = "hi"
            ok = self.client.post("/api/openjarvis/ask", headers=self.headers, json={"prompt": "what is -1?"})
        self.assertEqual(ok.status_code, 200)
        cli.assert_called_once_with("ask", "what is -1?", timeout_s=60)


class CrewCancelTests(unittest.TestCase):
    def test_finished_kickoff_does_not_overwrite_cancelled(self):
        started = threading.Event()
        release = threading.Event()

        class SlowCrew:
            def kickoff(self, inputs):
                started.set()
                release.wait(5)
                return "done"

        crew_id = "cancel-test"
        ai_agents._crews[crew_id] = {
            "id": crew_id, "agents": [], "tasks": [], "process": "sequential",
            "template": None, "status": "created", "result": None, "_crew_obj": SlowCrew(),
        }
        self.addCleanup(ai_agents._crews.pop, crew_id, None)
        with patch.object(ai_agents, "_HAS_CREWAI", True):
            runner = threading.Thread(target=ai_agents.run_crew, args=(crew_id,))
            runner.start()
            self.assertTrue(started.wait(5))
            ai_agents.cancel_crew(crew_id)
            release.set()
            runner.join(5)
        self.assertEqual(ai_agents.get_crew_status(crew_id)["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()
