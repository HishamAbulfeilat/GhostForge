"""Cross-cutting tests for the read-only bridge endpoints.

The per-module suites (test_snippets_docs, test_setup_status, test_code_health,
test_resource_catalogs, test_commands_catalog) already cover each endpoint in
depth. This file covers what none of them can see from inside a single module:

* the **auth boundary** for every read-only route at once, including a check
  that the route table itself declares the dependency — so dropping
  ``dependencies=[Depends(require_token)]`` from a handler fails here even if
  some other test only exercises the authenticated path;
* the **shared success contract** (status 200, ``ok: True``, a ``count`` that
  agrees with the list it counts, JSON-serialisable) across all of them, which
  is what the web UI's single fetch layer relies on;
* the **structured-unavailable path** for the endpoints that have one, so a
  missing local dependency degrades to a documented body instead of a 500 or a
  hang;
* that the read-only surface **executes nothing** — no subprocess, no shell. The
  two POSTs that do run an allow-listed script (``/api/code-health``,
  ``/api/tickets``) are asserted separately and explicitly.

Run with: python -m pytest mark-l-bridge/test_readonly_endpoints.py
(also works with python -m unittest).
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
import code_health as ch  # noqa: E402
import resource_catalogs as rc  # noqa: E402
import server  # noqa: E402
import setup_status as ss  # noqa: E402
import snippets_docs as sd  # noqa: E402
import tickets as tk  # noqa: E402

# Every read-only route this file owns, as (method, path). The auth test below
# asserts against this tuple, so a route that gains or loses its token
# dependency is caught without touching a single handler.
READONLY_ROUTES = (
    ("GET", "/api/snippets"),
    ("GET", "/api/snippets/{name}"),
    ("GET", "/api/docs/{name}"),
    ("GET", "/api/setup/status"),
    ("GET", "/api/code-health"),
    ("POST", "/api/code-health"),
    ("GET", "/api/tickets"),
    ("POST", "/api/tickets"),
    ("GET", "/api/commands"),
    ("GET", "/api/free-apis"),
    ("GET", "/api/design-resources"),
)

# A concrete path per template route, since {name} must be substituted to be
# routable at all — a 404 there would be the router, not the auth check.
CONCRETE_PATHS = (
    ("/api/snippets", None),
    ("/api/snippets/README.md", None),
    ("/api/docs/CHANGELOG.md", None),
    ("/api/setup/status", None),
    ("/api/code-health", None),
    ("/api/code-health", {"script": "unused"}),
    ("/api/tickets", None),
    ("/api/tickets", {"tool": "ado", "action": "config"}),
    ("/api/commands", None),
    ("/api/free-apis", None),
    ("/api/design-resources", None),
)


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


class AuthBoundaryTests(_Base):
    """Every read-only route must reject a missing or wrong bridge token.

    The per-module suites assert this one endpoint at a time. Asserting it for
    the whole set here is what makes removing the dependency from any single
    handler a test failure rather than a silent hole.
    """

    def test_no_token_is_401_on_every_readonly_route(self):
        for path, body in CONCRETE_PATHS:
            r = (self.client.get(path) if body is None
                 else self.client.post(path, json=body))
            self.assertEqual(r.status_code, 401, f"{path} accepted a request with no token")

    def test_wrong_token_is_401_on_every_readonly_route(self):
        bad = {"X-Bridge-Token": "definitely-not-the-bridge-token"}
        for path, body in CONCRETE_PATHS:
            r = (self.client.get(path, headers=bad) if body is None
                 else self.client.post(path, json=body, headers=bad))
            self.assertEqual(r.status_code, 401, path)

    def test_bearer_header_is_accepted_alone(self):
        """The documented alternate auth path; if it breaks, callers using
        Authorization: Bearer silently start getting 401s."""
        token = server._read_bridge_token()
        r = self.client.get("/api/snippets", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(r.status_code, 200)

    def test_route_table_declares_require_token(self):
        """Catch a dropped decorator at the source, not just at request time.

        require_token runs before the handler, so the 401 tests above still pass
        for some handler-local rejections; asserting on the route table proves
        the dependency itself is declared.
        """
        by_path = {}
        for route in server.app.routes:
            path = getattr(route, "path", None)
            if path and path.startswith("/api/"):
                by_path.setdefault(path, []).append(route)
        for method, template in READONLY_ROUTES:
            self.assertIn(template, by_path, f"{template} is not in the route table")
            declared = False
            for route in by_path[template]:
                if method not in (getattr(route, "methods", None) or set()):
                    continue
                deps = getattr(getattr(route, "dependant", None), "dependencies", [])
                names = {getattr(d.call, "__name__", "") for d in deps}
                if "require_token" in names:
                    declared = True
                    break
            self.assertTrue(declared, f"{method} {template} does not declare require_token")

    def test_unconfigured_token_is_503_not_a_bypass(self):
        """With no token configured the bridge must fail closed (503), never open."""
        with patch.object(server, "_read_bridge_token", return_value=""):
            for path, body in CONCRETE_PATHS:
                r = (self.client.get(path) if body is None
                     else self.client.post(path, json=body))
                self.assertEqual(r.status_code, 503, path)
                self.assertIn("token", r.json()["detail"].lower())


class SuccessShapeTests(_Base):
    """The shared contract the web UI's fetch layer depends on."""

    def assert_ok_envelope(self, body, path, count_key, list_key):
        self.assertIs(body["ok"], True, path)
        for key in (count_key, list_key):
            self.assertIn(key, body, f"{path} is missing {key}")
        self.assertEqual(body[count_key], len(body[list_key]), path)
        self.assertIsInstance(body[list_key], list, path)
        json.dumps(body)  # must be JSON-serialisable, not a stray Path/bytes

    def test_every_readonly_get_returns_the_ok_envelope(self):
        """{count, list} endpoints agree on their count; the rest carry ok: True."""
        counted = {
            "/api/snippets": ("count", "snippets"),
            "/api/commands": ("count", "commands"),
            "/api/free-apis": ("count", "providers"),
        }
        for path, (count_key, list_key) in counted.items():
            self.assert_ok_envelope(self.get(path).json(), path, count_key, list_key)
        # These carry `ok` without a counted list.
        for path in ("/api/setup/status", "/api/design-resources"):
            self.assertIs(self.get(path).json()["ok"], True, path)

    def test_every_readonly_get_is_200_and_json(self):
        for path, _ in CONCRETE_PATHS:
            r = self.get(path)
            self.assertEqual(r.status_code, 200, path)
            json.loads(r.text)

    def test_setup_status_shape_is_stable(self):
        body = self.get("/api/setup/status").json()
        self.assertEqual(set(body), {
            "ok", "bridge_version", "required_env", "required_env_ok",
            "optional_env", "ollama_reachable", "openjarvis_enabled",
            "mark_lv_vendor_present",
        })
        self.assertEqual(body["bridge_version"], server.app.version)
        for flag in ("required_env_ok", "ollama_reachable", "openjarvis_enabled",
                     "mark_lv_vendor_present"):
            self.assertIsInstance(body[flag], bool, flag)
        # Env is reported by name as a presence flag; values are never returned.
        self.assertTrue(body["required_env"])
        self.assertTrue(all(isinstance(v, bool) for v in body["required_env"].values()))
        self.assertTrue(all(isinstance(v, bool) for v in body["optional_env"].values()))

    def test_code_health_status_lists_only_allowlisted_scripts(self):
        body = self.get("/api/code-health").json()
        self.assertIs(body["ok"], True)
        self.assertEqual(body["timeout_s"], ch.TIMEOUT_S)
        # Spelled out literally, not `set(ch.SCRIPTS)`: comparing the response to
        # the same constant it is supposed to police would pass on any edit to
        # the allowlist, including one that widens it to run arbitrary scripts.
        self.assertEqual({s["id"] for s in body["scripts"]},
                         {"perf", "bundle", "unused", "dep-health", "coverage"})
        for script in body["scripts"]:
            self.assertEqual(set(script), {"id", "available", "description"})
            self.assertIsInstance(script["available"], bool)

    def test_snippets_list_and_docs_are_allowlisted(self):
        body = self.get("/api/snippets").json()
        # Literal, for the same reason as the code-health allowlist above.
        self.assertEqual(body["docs"], ["CHANGELOG.md", "README.md"])
        for name in body["snippets"]:
            self.assertRegex(name, sd.SNIPPET_NAME.pattern)
            self.assertNotIn("..", name)

    def test_free_apis_reports_key_presence_never_key_values(self):
        body = self.get("/api/free-apis").json()
        self.assertTrue(body["providers"])
        for provider in body["providers"]:
            self.assertEqual(set(provider), {
                "id", "name", "paid", "key_env", "key_set", "key_url", "default_model"})
            # key_set is None when no key is needed, else a strict bool.
            self.assertIn(provider["key_set"], (True, False, None), provider["id"])
            if provider["key_url"] is not None:
                self.assertRegex(provider["key_url"], r"^https?://")

    def test_design_resource_urls_are_http_only(self):
        """Asserted on a synthetic catalog, not on the live repo's own pages.

        Checked against the real repo this can only ever pass, because the
        committed pages contain no non-http URL to reject. The filter is the
        thing under test, so it needs a source that violates it.
        """
        import tempfile
        page = "  { name: 'Bad', url: 'javascript:alert(1)', description: 'x', meta: 'm' },\n"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel in (rc.DESIGN_PAGE, rc.OSS_PAGE):
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_text(page, encoding="utf-8")
            design = rc.build_design_catalog(root)["design_resources"]
            tools = rc.build_design_catalog(root)["open_source_tools"]
        self.assertEqual(design, [])
        self.assertEqual(tools, [])
        # Control: the same parser must keep an http(s) entry, so an empty
        # result above means "rejected", not "parsed nothing".
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel in (rc.DESIGN_PAGE, rc.OSS_PAGE):
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_text(
                    "  { name: 'Good', url: 'https://ok.example', description: 'd', meta: 'm' },\n",
                    encoding="utf-8")
            kept = rc.build_design_catalog(root)["design_resources"]
        self.assertEqual([i["name"] for i in kept], ["Good"])

    def test_live_design_resource_urls_are_http_only(self):
        body = self.get("/api/design-resources").json()
        items = body["design_resources"] + body["open_source_tools"]
        self.assertTrue(items)
        for item in items:
            self.assertRegex(item["url"], r"^https?://")


class StructuredUnavailableTests(_Base):
    """A missing local dependency must degrade to a documented body, not a 500.

    These are the paths that run on machines without bash, without Ollama, or
    without the vendored Mark-LV tree — i.e. most contributors' boxes and the
    CI runner. If one of them raises instead, the web UI shows a stack trace.
    """

    def test_code_health_run_is_unavailable_without_bash(self):
        with patch.object(ch, "find_bash", return_value=None):
            r = self.post("/api/code-health", {"script": "dep-health"})
        self.assertEqual(r.status_code, 200)
        result = r.json()["result"]
        self.assertEqual(result["status"], "unavailable")
        self.assertIs(result["available"], False)
        self.assertTrue(result["reason"])
        # Nothing was executed, so there is no output and no exit code to report.
        self.assertNotIn("exit_code", result)
        self.assertNotIn("output", result)

    def test_code_health_run_is_unavailable_when_the_script_is_missing(self):
        with patch.object(ch, "find_bash", return_value="/usr/bin/bash"), \
                patch.object(ch, "REPO_ROOT", Path(ch.__file__).parent / "does-not-exist"):
            r = self.post("/api/code-health", {"script": "coverage"})
        self.assertEqual(r.json()["result"]["status"], "unavailable")

    def test_code_health_unknown_script_is_400_and_runs_nothing(self):
        with patch.object(ch, "run") as run:
            r = self.post("/api/code-health", {"script": "../../etc/passwd"})
        self.assertEqual(r.status_code, 400)
        run.assert_not_called()

    def test_code_health_rejects_extra_body_keys(self):
        """Extra keys are how a caller would smuggle in args, paths or env."""
        with patch.object(ch, "run") as run:
            for body in ({"script": "unused", "args": ["--fix"]},
                         {"script": "unused", "env": {"PATH": "/tmp"}},
                         {"script": "unused", "path": "../../etc"}):
                r = self.post("/api/code-health", body)
                self.assertIn(r.status_code, (400, 422), body)
        run.assert_not_called()

    def test_code_health_busy_is_409(self):
        with patch.object(ch, "run", side_effect=ch.Busy()):
            r = self.post("/api/code-health", {"script": "unused"})
        self.assertEqual(r.status_code, 409)
        self.assertIn("in progress", r.json()["detail"].lower())

    def test_setup_status_degrades_without_ollama_or_vendor(self):
        with patch.object(ss, "ollama_reachable", return_value=False), \
                patch.object(ss, "vendor_present", return_value=False):
            body = self.get("/api/setup/status").json()
        self.assertIs(body["ok"], True)
        self.assertIs(body["ollama_reachable"], False)
        self.assertIs(body["mark_lv_vendor_present"], False)

    def test_setup_status_ollama_probe_failure_is_false_not_an_error(self):
        """The probe has a 1 s timeout and must swallow every failure mode."""
        for boom in (OSError("refused"), TimeoutError("slow"), ValueError("bad json")):
            with patch.object(ss.urllib.request, "urlopen", side_effect=boom):
                self.assertIs(ss.ollama_reachable(), False, repr(boom))

    def test_resource_catalogs_are_empty_not_broken_when_sources_are_missing(self):
        root = Path(__file__).parent / "does-not-exist"
        self.assertEqual(rc.list_free_providers(root), [])
        design = rc.build_design_catalog(root)
        self.assertIs(design["ok"], True)
        for key in ("design_resources", "design_marketplace", "vigolium", "open_source_tools"):
            self.assertEqual(design[key], [], key)
        free = rc.build_free_catalog(root)
        self.assertEqual(free["count"], 0)
        self.assertEqual(free["providers"], [])

    def test_resource_catalogs_survive_unparseable_catalog_json(self):
        """A malformed marketplace/catalog.json must not 500 the endpoint."""
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / rc.CATALOG_JSON.parent).mkdir(parents=True, exist_ok=True)
            (root / rc.CATALOG_JSON).write_text("{not json", encoding="utf-8")
            self.assertEqual(rc.build_free_catalog(root)["providers"], [])
            self.assertEqual(rc.build_design_catalog(root)["design_marketplace"], [])


class ReadOnlyGuaranteeTests(_Base):
    """These endpoints read; they never execute or write anything."""

    def test_no_subprocess_is_spawned_by_any_readonly_route(self):
        """Every GET here is a pure read; the two POSTs that run scripts are the
        sole exceptions and are bounded separately below."""
        with patch.object(subprocess, "run") as run, \
                patch.object(subprocess, "Popen") as popen, \
                patch.object(subprocess, "check_output") as check_output:
            for path, _body in CONCRETE_PATHS:
                if path in ("/api/code-health", "/api/tickets"):
                    continue  # POST forms are excluded; their GETs are plain status reads
                self.get(path)
        run.assert_not_called()
        popen.assert_not_called()
        check_output.assert_not_called()

    def test_code_health_post_is_the_only_route_that_may_spawn(self):
        """POST /api/code-health does run a script — bound the blast radius."""
        calls = []

        def fake_run(argv, **kw):
            calls.append(argv)
            kw["stdout"].write(b"ok")
            return type("P", (), {"returncode": 0})()

        with patch.object(ch, "find_bash", return_value="/usr/bin/bash"), \
                patch.object(ch.subprocess, "run", side_effect=fake_run):
            r = self.post("/api/code-health", {"script": "unused"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(calls), 1)
        argv = calls[0]
        self.assertEqual(argv[0], "/usr/bin/bash")
        self.assertEqual(argv[1:], [str(ch.REPO_ROOT / "scripts" / "unused.sh")])
        self.assertNotIn("--fix", argv)

    def test_tickets_post_never_shells_out(self):
        """POST /api/tickets runs a read-only script — bound the blast radius the
        same way: one allow-listed script, one fixed argv, no shell.

        `config` needs no Azure DevOps credentials, so it runs on any machine.
        """
        calls = []

        def fake_run(argv, **kw):
            calls.append((argv, kw))
            kw["stdout"].write(b"ok")
            return type("P", (), {"returncode": 0})()

        with patch.object(tk, "find_bash", return_value="/usr/bin/bash"), \
                patch.object(tk.subprocess, "run", side_effect=fake_run), \
                patch.object(tk, "_CREDENTIAL_FILES", ()):
            r = self.post("/api/tickets", {"tool": "ado", "action": "config"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(calls), 1)
        argv, kw = calls[0]
        self.assertEqual(argv, ["/usr/bin/bash", str(tk.REPO_ROOT / "scripts" / "ado.sh"), "config"])
        self.assertIs(kw["shell"], False)

    def test_readonly_routes_reject_the_unsafe_methods(self):
        for path in ("/api/snippets", "/api/setup/status", "/api/commands",
                     "/api/free-apis", "/api/design-resources"):
            for method in ("post", "put", "delete"):
                response = getattr(self.client, method)(path, headers=self.headers)
                self.assertEqual(response.status_code, 405, f"{method.upper()} {path}")

    def test_unknown_and_traversing_names_are_404(self):
        for path in ("/api/snippets/.env", "/api/docs/server.py",
                     "/api/docs/.env.example", "/api/snippets/nope.md"):
            r = self.get(path)
            self.assertEqual(r.status_code, 404, path)
            self.assertNotIn("server.py", r.text)

    def test_traversal_rejection_holds_at_the_helper_the_handler_calls(self):
        """The %2F probes above are answered by the router before any handler
        runs, so they cannot regress the check. Assert the helper's own refusal
        for the names a caller could actually smuggle through.

        Every name here resolves to a file that genuinely exists, so removing
        the guard would return real content — otherwise the assertion would pass
        on a broken guard too.
        """
        for name in ("../README.md", "..\\README.md", "../marketplace/catalog.json"):
            self.assertIsNone(sd.read_snippet(name), name)
        # Not in DOCS, but a real path inside the repo: this is the read that
        # would hand out the bridge's own source without the allowlist.
        self.assertIsNone(sd.read_doc("mark-l-bridge/server.py"))
        self.assertIsNone(sd.read_doc("server.py"))
        self.assertIsNone(sd.read_doc("../marketplace/catalog.json"))

        # Controls: the allowlisted reads still return real content, so the
        # Nones above mean "refused", not "always refuses". Compared against the
        # raw bytes the helper reads — text-mode read_text() rewrites CRLF.
        raw_readme = (sd.REPO_ROOT / "README.md").read_bytes().decode("utf-8")
        self.assertEqual(sd.read_doc("README.md"), raw_readme)
        self.assertEqual(
            sd.read_snippet("README.md"),
            (sd.REPO_ROOT / "snippets" / "README.md").read_bytes().decode("utf-8"))


if __name__ == "__main__":
    unittest.main()