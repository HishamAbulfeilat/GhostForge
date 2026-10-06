"""Tests for the read-only tickets / Azure DevOps / estimate bridge endpoints.

Run with: python -m pytest mark-l-bridge/tests/test_tickets.py -q

These assert the security properties, not just the happy path: the tool and
action come from an allow-list, the caller's argument reaches the child as a
single argv entry with no shell, no caller path and no caller environment, and
a PAT is never returned, logged or echoed back inside script output.
"""

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

# mark-l-bridge/ is the import root for `tickets`, `security_scan` and `server`;
# this file lives one level below it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import security_scan  # noqa: E402
import tickets  # noqa: E402

import server  # noqa: E402

# An obviously fake PAT. Long enough that _redact's minimum-length filter treats
# it as a real credential rather than skipping it as noise.
FAKE_PAT = "gf-fake-pat-0123456789abcdefghijklmnopqrstuvwxyz"

CONFIGURED_ENV = {
    "AZURE_DEVOPS_ORG": "ghostforge-test",
    "AZURE_DEVOPS_PROJECT": "gf-proj",
    "AZURE_DEVOPS_PAT": FAKE_PAT,
}


class _Proc:
    def __init__(self, returncode=0):
        self.returncode = returncode


def _no_env_files():
    """Point credential discovery at a file that does not exist.

    A developer's real .env.local must not decide whether these tests pass.
    """
    return patch.object(tickets, "_CREDENTIAL_FILES", ("__no_such_env_file__",))


class _Base(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.headers = {"X-Bridge-Token": server._read_bridge_token()}

    def tearDown(self):
        self.client.close()

    def get(self, path, headers=None):
        return self.client.get(path, headers=self.headers if headers is None else headers)

    def post(self, path, body, headers=None):
        return self.client.post(path, json=body, headers=self.headers if headers is None else headers)


class AuthTests(_Base):
    """The endpoints inherit the shared bridge token, like every other JARVIS route."""

    def test_requires_a_token(self):
        self.assertEqual(self.client.get("/api/tickets").status_code, 401)
        self.assertEqual(self.client.post("/api/tickets", json={"tool": "ado", "action": "status"}).status_code, 401)

    def test_wrong_token_is_401(self):
        bad = {"X-Bridge-Token": "definitely-not-the-bridge-token"}
        self.assertEqual(self.client.get("/api/tickets", headers=bad).status_code, 401)
        self.assertEqual(self.client.post("/api/tickets", json={"tool": "ado", "action": "status"},
                                         headers=bad).status_code, 401)

    def test_bearer_header_is_accepted_alone(self):
        token = server._read_bridge_token()
        self.assertEqual(
            self.client.get("/api/tickets", headers={"Authorization": f"Bearer {token}"}).status_code, 200)

    def test_unconfigured_token_fails_closed(self):
        with patch.object(server, "_read_bridge_token", return_value=""):
            self.assertEqual(self.client.get("/api/tickets").status_code, 503)
            self.assertEqual(self.client.post("/api/tickets",
                                             json={"tool": "ado", "action": "status"}).status_code, 503)

    def test_route_table_declares_require_token(self):
        """Catch a dropped decorator at the source, not only at request time."""
        by_path = {}
        for route in server.app.routes:
            path = getattr(route, "path", None)
            if path and path.startswith("/api/"):
                by_path.setdefault(path, []).append(route)
        self.assertIn("/api/tickets", by_path)
        for route in by_path["/api/tickets"]:
            deps = getattr(getattr(route, "dependant", None), "dependencies", [])
            self.assertIn("require_token", {getattr(d.call, "__name__", "") for d in deps})


class AllowlistTests(_Base):
    """Callers may only reach the allow-listed tools and, for ado.sh, its read-only actions."""

    def test_status_lists_the_allowlist(self):
        r = self.get("/api/tickets")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["ok"])
        self.assertEqual({t["id"] for t in body["tools"]}, set(tickets.TOOLS))
        for entry in body["tools"]:
            self.assertIn("description", entry)

    def test_unknown_tool_is_400_and_never_runs(self):
        with patch.object(tickets, "run") as run:
            for tool in ("rm", "../scripts/doctor.sh", "/etc/passwd", "ticket.sh", ""):
                r = self.post("/api/tickets", {"tool": tool, "action": "status"})
                self.assertIn(r.status_code, (400, 422), tool)
            run.assert_not_called()

    def test_ado_action_must_be_read_only(self):
        """create/update/delete are not reachable through the bridge."""
        with patch.object(tickets.subprocess, "run") as spawn:
            for action in ("create", "update", "delete", "workitems-create", "--force", "status; rm -rf /"):
                r = self.post("/api/tickets", {"tool": "ado", "action": action})
                self.assertEqual(r.status_code, 400, action)
            spawn.assert_not_called()

    def test_allowlist_contains_no_mutating_action(self):
        """The tripwire: if someone adds a write action to the allow-list, this fails."""
        for tool_id, tool in tickets.TOOLS.items():
            for action in tool.subcommands:
                for forbidden in tickets._FORBIDDEN_ACTIONS:
                    self.assertNotIn(forbidden, action.lower(), f"{tool_id}.{action}")

    def test_no_caller_supplied_body_keys(self):
        """Extra keys would be a second channel for paths, args or env."""
        for extra in ({"path": "/etc"}, {"args": ["--force"]}, {"env": {"A": "B"}}, {"timeout_s": 999}):
            body = {"tool": "ado", "action": "status", **extra}
            r = self.post("/api/tickets", body)
            self.assertIn(r.status_code, (400, 422), extra)

    def test_action_is_validated(self):
        """Control characters and oversized arguments are refused before any spawn."""
        with patch.object(tickets.subprocess, "run") as spawn:
            for action in ("", "   ", "x" * (tickets.MAX_ARG_CHARS + 1), "PROJ\x1b[31m", "a\nb", 42, None, ["a"]):
                r = self.post("/api/tickets", {"tool": "ticket", "action": action})
                self.assertIn(r.status_code, (400, 422), repr(action))
            spawn.assert_not_called()


class ArgvTests(_Base):
    """The argv is fixed except for one validated entry, and there is no shell."""

    def _spawn(self, tool_id, action, body=b"out", returncode=0):
        """Run one tool against a fake spawn and return its result plus the argv/env used.

        Azure DevOps credentials are stubbed in for every tool so this helper does
        not depend on whether the machine running the suite is configured.
        """
        calls = []

        def fake_run(argv, **kw):
            calls.append((argv, kw))
            kw["stdout"].write(body)
            return _Proc(returncode)

        with patch.object(tickets, "find_bash", return_value="/usr/bin/bash"), \
                patch.object(tickets.subprocess, "run", side_effect=fake_run), \
                patch.dict(os.environ, CONFIGURED_ENV, clear=True), _no_env_files():
            r = self.post("/api/tickets", {"tool": tool_id, "action": action})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["result"]["status"], "ok" if returncode == 0 else "error")
        return r.json()["result"], calls[0]

    def test_argv_is_fixed_with_the_action_as_one_entry(self):
        result, (argv, kw) = self._spawn("ticket", "PROJ-123")
        self.assertEqual(argv, ["/usr/bin/bash", str(tickets.REPO_ROOT / "scripts" / "ticket.sh"), "PROJ-123"])
        self.assertIs(kw["shell"], False)
        self.assertEqual(kw["timeout"], tickets.TIMEOUT_S)
        self.assertEqual((result["id"], result["status"], result["output"]), ("ticket", "ok", "out"))

    def test_shell_metacharacters_stay_a_single_argv_entry(self):
        """The injection property: a command in the action cannot become a command."""
        hostile = "; rm -rf /tmp/x && echo $(whoami) `id` | tee /tmp/y"
        result, (argv, kw) = self._spawn("ticket", hostile)
        self.assertEqual(len(argv), 3, argv)
        self.assertEqual(argv[2], hostile)
        self.assertIs(kw["shell"], False)
        self.assertEqual(result["status"], "ok")

    def test_estimate_always_targets_the_repository_root(self):
        """estimate.sh defaults to the process cwd and prompts without --path."""
        result, (argv, kw) = self._spawn("estimate", "add a login form")
        self.assertEqual(argv[:3], ["/usr/bin/bash", str(tickets.REPO_ROOT / "scripts" / "estimate.sh"),
                                    "add a login form"])
        self.assertEqual(argv[3], f"--path={tickets.REPO_ROOT}")
        self.assertEqual(len(argv), 4)
        self.assertIs(kw["shell"], False)

    def test_ado_action_reaches_the_script_verbatim(self):
        _, (argv, kw) = self._spawn("ado", "pipelines")
        self.assertEqual(argv[2], "pipelines")
        self.assertEqual(kw["shell"], False)

    def test_child_runs_with_a_minimal_environment(self):
        _, (_, kw) = self._spawn("ticket", "PROJ-1")
        env = kw["env"]
        self.assertEqual(set(env) & {"AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN"}, set())
        self.assertNotIn(FAKE_PAT, env.values())

    def test_nonzero_exit_is_an_error_not_an_exception(self):
        result, _ = self._spawn("ticket", "PROJ-1", body=b"boom", returncode=2)
        self.assertEqual((result["status"], result["exit_code"], result["available"]), ("error", 2, True))

    def test_output_is_capped(self):
        """Both the read bound and the truncated flag, not just one of them.

        A child that writes far more than the cap must not be able to hand the
        bridge — or the caller — an unbounded string.
        """
        result, _ = self._spawn("ticket", "PROJ-1", body=b"x" * (tickets.MAX_OUTPUT_BYTES * 20), returncode=1)
        self.assertTrue(result["truncated"])
        self.assertIn("truncated at", result["output"])
        # The cap, plus the trailing truncation notice.
        self.assertLessEqual(len(result["output"]), tickets.MAX_OUTPUT_BYTES + 80)

    def test_the_cap_bounds_the_read_not_only_the_returned_slice(self):
        """The child writes to a file, not a pipe, so the cap must bound the read.

        Trimming after an unbounded read would still have let a noisy script grow
        bridge memory, which is the thing the temp file exists to prevent.
        """
        reads = []

        class _RecordingFile:
            def __init__(self, real):
                self._real = real

            def write(self, data):
                return self._real.write(data)

            def seek(self, *a):
                return self._real.seek(*a)

            def read(self, size=-1):
                reads.append(size)
                return self._real.read(size)

            def __enter__(self):
                self._real.__enter__()
                return self

            def __exit__(self, *exc):
                return self._real.__exit__(*exc)

        real_tmp = tickets.tempfile.TemporaryFile
        with patch.object(tickets, "find_bash", return_value="/usr/bin/bash"), \
                patch.object(tickets.subprocess, "run", side_effect=lambda argv, **kw: (kw["stdout"].write(b"y"), _Proc())[1]), \
                patch.object(tickets.tempfile, "TemporaryFile", side_effect=lambda: _RecordingFile(real_tmp())):
            r = self.post("/api/tickets", {"tool": "ticket", "action": "PROJ-1"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(reads, [tickets.MAX_OUTPUT_BYTES + 1])

    def test_timeout_is_reported_not_raised(self):
        import subprocess

        def fake_run(argv, **kw):
            raise subprocess.TimeoutExpired(argv, tickets.TIMEOUT_S)

        with patch.object(tickets, "find_bash", return_value="/usr/bin/bash"), \
                patch.object(tickets.subprocess, "run", side_effect=fake_run):
            r = self.post("/api/tickets", {"tool": "ticket", "action": "PROJ-1"})
        self.assertEqual(r.status_code, 200)
        result = r.json()["result"]
        self.assertEqual((result["status"], result["exit_code"]), ("timeout", None))

    def test_busy_returns_409(self):
        with patch.object(tickets, "run", side_effect=tickets.Busy()):
            r = self.post("/api/tickets", {"tool": "ado", "action": "status"})
        self.assertEqual(r.status_code, 409)


class UnavailableTests(_Base):
    """A missing CLI or missing credentials is a documented body, not a 500."""

    def test_missing_bash_is_structured_unavailable(self):
        with patch.object(tickets, "find_bash", return_value=None):
            r = self.post("/api/tickets", {"tool": "ticket", "action": "PROJ-1"})
        self.assertEqual(r.status_code, 200)
        result = r.json()["result"]
        self.assertFalse(result["available"])
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("reason", result)
        self.assertNotIn("output", result)

    def test_missing_script_is_structured_unavailable(self):
        with patch.object(tickets, "find_bash", return_value="/usr/bin/bash"), \
                patch.object(tickets.subprocess, "run") as spawn:
            with patch.object(Path, "is_file", return_value=False):
                r = self.post("/api/tickets", {"tool": "ticket", "action": "PROJ-1"})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()["result"]["available"])
        spawn.assert_not_called()

    def test_ado_without_credentials_is_structured_unavailable(self):
        with patch.object(tickets, "find_bash", return_value="/usr/bin/bash"), \
                patch.object(tickets.subprocess, "run") as spawn, \
                patch.dict(os.environ, {}, clear=True), _no_env_files():
            r = self.post("/api/tickets", {"tool": "ado", "action": "status"})
        self.assertEqual(r.status_code, 200)
        result = r.json()["result"]
        self.assertFalse(result["available"])
        self.assertEqual(result["status"], "unavailable")
        self.assertIn("AZURE_DEVOPS_ORG", result["reason"])
        spawn.assert_not_called()

    def test_ado_config_action_works_without_credentials(self):
        """`config` only prints setup instructions, so it must not be gated on a PAT."""
        def fake_run(argv, **kw):
            kw["stdout"].write(b"AZURE_DEVOPS_ORG=your-org-name")
            return _Proc(0)

        with patch.object(tickets, "find_bash", return_value="/usr/bin/bash"), \
                patch.object(tickets.subprocess, "run", side_effect=fake_run), \
                patch.dict(os.environ, {}, clear=True), _no_env_files():
            r = self.post("/api/tickets", {"tool": "ado", "action": "config"})
        self.assertEqual(r.status_code, 200)
        result = r.json()["result"]
        self.assertTrue(result["available"])
        self.assertEqual(result["status"], "ok")

    def test_status_reports_credential_presence_but_not_values(self):
        with patch.dict(os.environ, CONFIGURED_ENV, clear=True), _no_env_files():
            configured = self.get("/api/tickets").json()
        with patch.dict(os.environ, {}, clear=True), _no_env_files():
            unconfigured = self.get("/api/tickets").json()

        ado = next(t for t in configured["tools"] if t["id"] == "ado")
        ado_off = next(t for t in unconfigured["tools"] if t["id"] == "ado")
        self.assertIs(ado["credentials_configured"], True)
        self.assertIs(ado_off["credentials_configured"], False)
        for body in (configured, unconfigured):
            self.assertNotIn(FAKE_PAT, str(body))
            self.assertNotIn("ghostforge-test", str(body))
        # ticket/estimate need no credentials, so they must not carry the flag.
        for body in (configured, unconfigured):
            for entry in body["tools"]:
                if entry["id"] != "ado":
                    self.assertNotIn("credentials_configured", entry)


class SecretTests(_Base):
    """A PAT must not come back to a caller, however the script behaves."""

    def _run_ado_with_leaky_output(self, output):
        def fake_run(argv, **kw):
            kw["stdout"].write(output)
            return _Proc(0)

        with patch.object(tickets, "find_bash", return_value="/usr/bin/bash"), \
                patch.object(tickets.subprocess, "run", side_effect=fake_run), \
                patch.dict(os.environ, CONFIGURED_ENV, clear=True), _no_env_files():
            r = self.post("/api/tickets", {"tool": "ado", "action": "status"})
        self.assertEqual(r.status_code, 200)
        return r.json()

    def test_pat_is_redacted_from_script_output(self):
        body = self._run_ado_with_leaky_output(
            f"curl -H 'Authorization: Basic {FAKE_PAT}' failed for {FAKE_PAT}".encode())
        self.assertNotIn(FAKE_PAT, str(body))
        self.assertIn("[REDACTED]", body["result"]["output"])

    def test_basic_auth_header_is_redacted(self):
        import base64

        encoded = base64.b64encode(f":{FAKE_PAT}".encode()).decode()
        body = self._run_ado_with_leaky_output(f"curl: header was Authorization: Basic {encoded}".encode())
        self.assertNotIn(encoded, str(body))
        self.assertIn("Basic [REDACTED]", body["result"]["output"])

    def test_echoed_credential_environment_is_redacted(self):
        body = self._run_ado_with_leaky_output(
            f"AZURE_DEVOPS_PAT={FAKE_PAT}\nAZURE_DEVOPS_ORG=ghostforge-test\n".encode())
        self.assertNotIn(FAKE_PAT, str(body))
        self.assertNotIn("ghostforge-test", str(body))

    def test_ansi_escapes_are_stripped(self):
        body = self._run_ado_with_leaky_output(b"\x1b[31mred\x1b[0m done")
        self.assertNotIn("\x1b", body["result"]["output"])

    def test_credentials_reach_the_child_without_being_returned(self):
        """ado.sh needs them to work; the caller must not get them back."""
        seen = {}

        def fake_run(argv, **kw):
            seen.update(kw["env"])
            kw["stdout"].write(b"ok")
            return _Proc(0)

        with patch.object(tickets, "find_bash", return_value="/usr/bin/bash"), \
                patch.object(tickets.subprocess, "run", side_effect=fake_run), \
                patch.dict(os.environ, CONFIGURED_ENV, clear=True), _no_env_files():
            r = self.post("/api/tickets", {"tool": "ado", "action": "status"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["result"]["status"], "ok")
        self.assertEqual(seen.get("AZURE_DEVOPS_PAT"), FAKE_PAT)
        self.assertNotIn(FAKE_PAT, str(r.json()))

    def test_other_tools_do_not_receive_the_pat(self):
        seen = {}

        def fake_run(argv, **kw):
            seen.update(kw["env"])
            kw["stdout"].write(b"ok")
            return _Proc(0)

        with patch.object(tickets, "find_bash", return_value="/usr/bin/bash"), \
                patch.object(tickets.subprocess, "run", side_effect=fake_run), \
                patch.dict(os.environ, CONFIGURED_ENV, clear=True), _no_env_files():
            self.post("/api/tickets", {"tool": "ticket", "action": "PROJ-1"})
        self.assertNotIn(FAKE_PAT, seen.values())
        self.assertNotIn("AZURE_DEVOPS_PAT", seen)


class CredentialResolutionTests(unittest.TestCase):
    """`_credentials` mirrors ado.sh's own order: environment, then the env files.

    Asserted directly because the endpoint tests exercise it through a patched
    seam — without this, a resolver that only read the environment would pass.
    """

    def test_reads_environment(self):
        with patch.dict(os.environ, CONFIGURED_ENV, clear=True), _no_env_files():
            self.assertEqual(tickets._credentials(), {
                "azure_devops_org": "ghostforge-test",
                "azure_devops_project": "gf-proj",
                "azure_devops_pat": FAKE_PAT,
            })
            self.assertTrue(tickets.credentials_configured())

    def test_reads_env_file_and_strips_quotes(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / ".env.local").write_text(
                "# comment\n"
                "AZURE_DEVOPS_ORG='file-org'\n"
                "OTHER_VAR=ignored\n"
                "AZURE_DEVOPS_PROJECT=file-proj\n"
                "AZURE_DEVOPS_PAT=file-pat-value\n", encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True), \
                    patch.object(tickets, "REPO_ROOT", Path(tmp)):
                found = tickets._credentials()
                self.assertEqual(found["azure_devops_org"], "file-org")
                self.assertEqual(found["azure_devops_pat"], "file-pat-value")
                self.assertTrue(tickets.credentials_configured())

    def test_environment_wins_over_the_env_file(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / ".env.local").write_text("AZURE_DEVOPS_ORG=file-org\n", encoding="utf-8")
            with patch.dict(os.environ, CONFIGURED_ENV, clear=True), \
                    patch.object(tickets, "REPO_ROOT", Path(tmp)):
                self.assertEqual(tickets._credentials()["azure_devops_org"], "ghostforge-test")

    def test_partial_credentials_are_not_configured(self):
        for missing in CONFIGURED_ENV:
            partial = {k: v for k, v in CONFIGURED_ENV.items() if k != missing}
            with patch.dict(os.environ, partial, clear=True), _no_env_files():
                self.assertFalse(tickets.credentials_configured(), f"configured without {missing}")

    def test_nothing_configured_on_a_clean_machine(self):
        with patch.dict(os.environ, {}, clear=True), _no_env_files():
            self.assertEqual(tickets._credentials(), {})
            self.assertFalse(tickets.credentials_configured())

    def test_sanitize_still_applies_the_shared_redactor(self):
        """Dropping security_scan.sanitize would leak keys the module-agnostic patterns catch."""
        self.assertEqual(tickets._sanitize(b"token = ghp_" + b"a" * 30, False).count("[REDACTED]"), 1)


class AllowlistIntegrityTests(unittest.TestCase):
    """Structural checks on the allow-list itself."""

    def test_scripts_exist(self):
        for tool_id, tool in tickets.TOOLS.items():
            self.assertTrue((tickets.REPO_ROOT / "scripts" / tool.script).is_file(), tool_id)

    def test_build_argv_only_accepts_known_ids(self):
        with self.assertRaises(KeyError):
            tickets.build_argv("nope", "status", "/usr/bin/bash")

    def test_run_only_accepts_known_ids(self):
        """`run` refuses an unknown id itself, so a future in-process caller is safe.

        The endpoint checks membership before it calls run(), so nothing above
        exercises the lookup. `patch.dict(TOOLS, {})` empties the allow-list for
        every reader, so the lookup is the only thing left that can refuse — if
        `run` stopped consulting TOOLS, this would return normally.
        """
        with patch.object(tickets, "TOOLS", {}):
            with self.assertRaises(KeyError):
                tickets.run("doctor.sh", "status")

    def test_run_validates_the_action_itself(self):
        """Same reason: the endpoint's 400 path would pass even if run() did not."""
        with patch.object(tickets.subprocess, "run") as spawn:
            for tool_id, action in (("ticket", ""), ("ticket", "x" * 500), ("ado", "create")):
                with self.assertRaises(ValueError, msg=f"{tool_id}/{action!r}"):
                    tickets.run(tool_id, action)
            spawn.assert_not_called()

    def test_fixed_args_are_repo_relative_or_constants(self):
        """The fixed tail must not be able to carry a caller-supplied path."""
        for tool_id, tool in tickets.TOOLS.items():
            for arg in tool.fixed_args:
                self.assertTrue(arg.startswith("--"), f"{tool_id}: {arg}")

    def test_reuses_the_shared_budget_and_sanitizer(self):
        self.assertIs(tickets.REPO_ROOT, security_scan.REPO_ROOT)
        self.assertLessEqual(tickets.MAX_OUTPUT_BYTES, security_scan.MAX_OUTPUT_BYTES)
        self.assertIsNotNone(tickets.find_bash())


if __name__ == "__main__":
    unittest.main()
