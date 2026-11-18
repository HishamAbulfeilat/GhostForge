"""ai_browser: per-call browser lifecycle and version-tolerant browser-use wiring.

Neither playwright nor browser-use is installed in CI, so both are replaced by
small fakes that record which event loop launched and closed each browser.
"""

import asyncio
import sys
import threading
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import ai_browser  # noqa: E402


class _FakePage:
    def __init__(self, browser, goto_delay=0.0):
        self.browser = browser
        self.goto_delay = goto_delay

    async def goto(self, url):
        self.browser.visited.append(url)
        if self.goto_delay:
            await asyncio.sleep(self.goto_delay)

    async def query_selector(self, sel):
        page = self

        class _El:
            async def text_content(self_inner):
                return f"{sel}@{page.browser.id}"

        return _El()

    async def screenshot(self, full_page=True):
        return b"PNG"


class _FakeBrowser:
    def __init__(self, registry, goto_delay):
        self.id = len(registry)
        self.visited = []
        self.launch_loop = asyncio.get_running_loop()
        self.close_loops = []
        self.goto_delay = goto_delay
        registry.append(self)

    async def new_context(self):
        browser = self

        class _Ctx:
            async def new_page(self_inner):
                return _FakePage(browser, browser.goto_delay)

        return _Ctx()

    async def close(self):
        self.close_loops.append(asyncio.get_running_loop())


def _fake_playwright(registry, goto_delay=0.0, fail_channels=()):
    class _Chromium:
        async def launch(self, headless=True, channel=None):
            if (channel or "chromium") in fail_channels:
                raise RuntimeError(f"Executable doesn't exist for {channel or 'chromium'}\nmore")
            return _FakeBrowser(registry, goto_delay)

    class _PW:
        chromium = _Chromium()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

    return lambda: _PW()


class PlaywrightLifecycleTests(unittest.TestCase):
    def test_each_call_gets_its_own_browser_closed_on_the_launching_loop(self):
        registry = []
        results = {}
        with patch.object(ai_browser, "_HAS_PLAYWRIGHT", True), patch.object(
            ai_browser, "_async_playwright", _fake_playwright(registry, goto_delay=0.05)
        ):
            def worker(n):
                results[n] = ai_browser.extract(f"https://example.com/{n}", {"h": "h1"})

            threads = [threading.Thread(target=worker, args=(n,)) for n in range(4)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

        self.assertEqual(len(registry), 4)
        for browser in registry:
            # closed exactly once, on the loop that launched it
            self.assertEqual(browser.close_loops, [browser.launch_loop])
            self.assertEqual(len(browser.visited), 1)
        # every request read from its own browser, none was closed under it
        for n, res in results.items():
            owner = next(b for b in registry if b.visited == [f"https://example.com/{n}"])
            self.assertEqual(res["extracted"], {"h": f"h1@{owner.id}"})

    def test_timeout_still_closes_the_browser(self):
        registry = []
        with patch.object(ai_browser, "_HAS_PLAYWRIGHT", True), patch.object(
            ai_browser, "_async_playwright", _fake_playwright(registry, goto_delay=5)
        ), patch.object(ai_browser, "_CALL_TIMEOUT_S", 0.2):
            start = time.monotonic()
            with self.assertRaises((asyncio.TimeoutError, TimeoutError)):
                ai_browser.screenshot("https://example.com")
            self.assertLess(time.monotonic() - start, 3)
        self.assertEqual(len(registry), 1)
        self.assertEqual(registry[0].close_loops, [registry[0].launch_loop])

    def test_falls_back_to_installed_chrome_then_reports_how_to_fix(self):
        registry = []
        with patch.object(ai_browser, "_HAS_PLAYWRIGHT", True), patch.object(
            ai_browser, "_async_playwright", _fake_playwright(registry, fail_channels=("chromium",))
        ):
            res = ai_browser.screenshot("https://example.com")
        self.assertEqual(res["screenshot"], "UE5H")
        with patch.object(ai_browser, "_HAS_PLAYWRIGHT", True), patch.object(
            ai_browser,
            "_async_playwright",
            _fake_playwright([], fail_channels=("chromium", "chrome", "msedge")),
        ):
            res = ai_browser.click("https://example.com", "#go")
        self.assertIn("playwright install chromium", res["error"])

    def test_cleanup_hook_is_a_safe_noop(self):
        asyncio.run(ai_browser._cleanup_browser())

    def test_private_urls_still_rejected(self):
        with self.assertRaises(ValueError):
            ai_browser.extract("http://192.168.1.1/", {})


def _fake_browser_use(new_api=True):
    events = {"closed": [], "agent_kwargs": None, "max_steps": None}
    mod = types.ModuleType("browser_use")

    class ChatOllama:
        def __init__(self, model):
            self.model = model

    mod.ChatOllama = ChatOllama

    class _History:
        def final_result(self):
            return "done: 42"

    if new_api:
        class BrowserSession:
            def __init__(self, headless=True):
                self.headless = headless

            async def kill(self):
                events["closed"].append("kill")

        mod.BrowserSession = BrowserSession

        class Agent:
            def __init__(self, task, llm, browser_session=None):
                events["agent_kwargs"] = {"task": task, "llm": llm, "browser_session": browser_session}

            async def run(self, max_steps=100):
                events["max_steps"] = max_steps
                return _History()
    else:
        class BrowserConfig:
            def __init__(self, headless=False):
                self.headless = headless

        class Browser:
            def __init__(self, config=None):
                self.config = config

            async def close(self):
                events["closed"].append("close")

        mod.BrowserConfig = BrowserConfig
        mod.Browser = Browser

        class Agent:
            def __init__(self, task, llm, browser=None):
                events["agent_kwargs"] = {"task": task, "llm": llm, "browser": browser}

            async def run(self, max_steps=100):
                events["max_steps"] = max_steps
                raise RuntimeError("agent exploded")

    mod.Agent = Agent
    return mod, events


class BrowserUseAgentTests(unittest.TestCase):
    def test_browse_runs_agent_with_session_and_kills_it(self):
        mod, events = _fake_browser_use(new_api=True)
        with patch.object(ai_browser, "_bu", mod), patch.object(
            ai_browser, "_HAS_BROWSER_USE", True
        ), patch.dict(sys.modules, {"browser_use": mod}), patch.dict(
            "os.environ", {"GF_BROWSER_LLM": "", "GF_BROWSER_MODEL": ""}
        ):
            res = ai_browser.browse("https://example.com", "find the answer")
        self.assertEqual(res["result"], "done: 42")
        kwargs = events["agent_kwargs"]
        self.assertTrue(kwargs["browser_session"].headless)
        self.assertEqual(kwargs["llm"].model, "llama3.1")  # local Ollama by default
        self.assertIn("https://example.com", kwargs["task"])
        self.assertEqual(events["max_steps"], ai_browser._AGENT_MAX_STEPS)
        self.assertEqual(events["closed"], ["kill"])

    def test_legacy_browser_config_api_and_close_on_failure(self):
        mod, events = _fake_browser_use(new_api=False)
        with patch.object(ai_browser, "_bu", mod), patch.object(
            ai_browser, "_HAS_BROWSER_USE", True
        ), patch.dict(sys.modules, {"browser_use": mod}):
            with self.assertRaises(RuntimeError):
                ai_browser.browse("https://example.com", "x")
        self.assertTrue(events["agent_kwargs"]["browser"].config.headless)
        self.assertEqual(events["closed"], ["close"])

    def test_missing_llm_class_is_reported_not_crashing(self):
        mod, events = _fake_browser_use(new_api=True)
        del mod.ChatOllama
        with patch.object(ai_browser, "_bu", mod), patch.object(
            ai_browser, "_HAS_BROWSER_USE", True
        ), patch.dict(sys.modules, {"browser_use": mod, "browser_use.llm": None, "langchain_ollama": None}):
            res = ai_browser.browse("https://example.com", "x")
        self.assertIn("No ollama chat model class", res["error"])
        self.assertIsNone(events["agent_kwargs"])


if __name__ == "__main__":
    unittest.main()
