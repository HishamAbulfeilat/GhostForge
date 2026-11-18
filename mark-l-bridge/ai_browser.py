"""
AI Browser Module — web automation for the Mark-L bridge.

Two engines, both optional:

* **Playwright** (``playwright>=1.40,<2``, same bound as vendor/mark-liv) drives
  the deterministic actions: extract, fill-form, screenshot, search, click,
  scroll, page text, wait-for and login.
* **browser-use** drives the free-form ``browse(url, task)`` action through its
  ``Agent`` (an LLM decides the steps).

Every call owns its browser: it is launched and closed inside the same
coroutine, on the same event loop, so concurrent requests (FastAPI runs the
sync endpoints in a thread pool) never share or close each other's browser and
nothing is left running after a call, even when it times out.

browser-use is not pinned in requirements.txt and its public API has changed
across releases, so the Agent wiring below probes for the names it needs
(``BrowserSession`` vs ``Browser``/``BrowserConfig``, ``browser_session=`` vs
``browser=``, ``kill``/``stop``/``close``) instead of assuming one version.
"""

from __future__ import annotations

import asyncio
import base64
import concurrent.futures
import importlib
import inspect
import ipaddress
import os
import sys
import urllib.parse
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional

# ---------------------------------------------------------------------------
# Graceful imports
# ---------------------------------------------------------------------------

_HAS_PLAYWRIGHT = False
try:
    from playwright.async_api import async_playwright as _async_playwright

    _HAS_PLAYWRIGHT = True
except ImportError:
    _async_playwright = None  # type: ignore[assignment]
    print(
        "[ai_browser] ⚠️  playwright not installed — page actions fall back to plain HTTP where possible",
        file=sys.stderr,
    )

_HAS_BROWSER_USE = False
try:
    import browser_use as _bu

    _HAS_BROWSER_USE = hasattr(_bu, "Agent")
except ImportError:
    _bu = None  # type: ignore[assignment]
    print(
        "[ai_browser] ⚠️  browser-use not installed — AI browse tasks are unavailable",
        file=sys.stderr,
    )

try:
    import httpx as _httpx

    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False

# Hard upper bound for one browser call (navigation + actions + teardown).
_CALL_TIMEOUT_S = 120
# Upper bound for the browser-use agent loop.
_AGENT_MAX_STEPS = int(os.environ.get("GF_BROWSER_MAX_STEPS", "15") or 15)


class BrowserUnavailable(RuntimeError):
    """No browser engine could be started for this call."""


# ---------------------------------------------------------------------------
# Per-call Playwright page (no module-level browser)
# ---------------------------------------------------------------------------


async def _launch_chromium(pw: Any, headless: bool) -> Any:
    """Launch Playwright's Chromium, else an installed Chrome / Edge."""
    errors: list[str] = []
    for extra in ({}, {"channel": "chrome"}, {"channel": "msedge"}):
        try:
            return await pw.chromium.launch(headless=headless, **extra)
        except Exception as exc:  # noqa: BLE001
            first = (str(exc).strip().splitlines() or [type(exc).__name__])[0]
            errors.append(f"{extra.get('channel', 'chromium')}: {first}")
    raise BrowserUnavailable(
        "Could not start a browser. Run `python -m playwright install chromium` "
        "in the bridge environment, or install Google Chrome. ("
        + "; ".join(errors)
        + ")"
    )


@asynccontextmanager
async def _open_page(headless: bool = True) -> AsyncIterator[Any]:
    """Yield a fresh Playwright page; the browser is closed on exit.

    Launch and close happen in this coroutine, so they always run on the same
    event loop, including when the call is cancelled by its timeout.
    """
    if not _HAS_PLAYWRIGHT or _async_playwright is None:
        raise BrowserUnavailable(
            "playwright is not installed. Install with: pip install 'playwright>=1.40,<2' "
            "&& python -m playwright install chromium"
        )
    async with _async_playwright() as pw:
        browser = await _launch_chromium(pw, headless)
        try:
            context = await browser.new_context()
            page = await context.new_page()
            yield page
        finally:
            try:
                await browser.close()
            except Exception:  # noqa: BLE001 - best effort; the driver exits with the context
                pass


async def _cleanup_browser() -> None:
    """Kept for callers (bridge shutdown): there is no shared browser to close.

    Each call closes its own browser before returning.
    """
    return None


# ---------------------------------------------------------------------------
# URL validation (SSRF protection)
# ---------------------------------------------------------------------------

# Private / link-local / ULA ranges that must never be fetched by the bridge.
# Loopback (127.0.0.0/8, ::1, localhost) is intentionally ALLOWED: the whole
# bridge binds to 127.0.0.1 and every request requires the shared bridge
# token, so localhost is a trusted local target rather than an SSRF vector.
_PRIVATE_NETS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("fc00::/7"),
]


def _validate_url(url: str) -> str:
    """Validate *url* for SSRF safety and return it unchanged.

    Only http/https schemes are accepted (file:// and other schemes are
    rejected) and literal hostnames in private/link-local address ranges
    are blocked; loopback is allowed per the note above.
    """
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Only http/https URLs are allowed")
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        raise ValueError("URL must include a host")
    if host == "localhost" or host.endswith(".localhost"):
        return url
    if host.endswith(".local"):
        raise ValueError("mDNS (.local) hosts are not allowed")
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return url  # hostname — range check applies to IP literals
    if addr.is_loopback:
        return url
    if any(addr in net for net in _PRIVATE_NETS):
        raise ValueError("Private/local network addresses are not allowed")
    return url


# ---------------------------------------------------------------------------
# Sync wrappers
# ---------------------------------------------------------------------------


def _run_async(coro):  # type: ignore[no-untyped-def]
    """Run *coro* to completion from sync code, bounded to ``_CALL_TIMEOUT_S``.

    The browser is created and closed inside *coro* itself, so a single event
    loop owns it from start to finish. When called from a thread that already
    runs a loop, the coroutine runs on a fresh loop in a helper thread.
    """
    bounded = asyncio.wait_for(coro, timeout=_CALL_TIMEOUT_S)
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(bounded)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, bounded).result()


# ---------------------------------------------------------------------------
# Simple HTTP fetch fallback (when no browser engine is available)
# ---------------------------------------------------------------------------


async def _http_fetch(url: str) -> str:
    """Fetch a URL via httpx (fallback)."""
    if not _HAS_HTTPX:
        raise RuntimeError("Neither playwright nor httpx is installed.")
    _validate_url(url)
    async with _httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.text


# ---------------------------------------------------------------------------
# browser-use Agent (version-tolerant wiring)
# ---------------------------------------------------------------------------


def _first_attr(module_names: tuple[str, ...], attr: str) -> Any:
    for mod_name in module_names:
        try:
            mod = importlib.import_module(mod_name)
        except Exception:  # noqa: BLE001
            continue
        obj = getattr(mod, attr, None)
        if obj is not None:
            return obj
    return None


def _build_llm() -> Any:
    """Build the chat model the browser-use Agent runs on.

    Local Ollama by default (nothing leaves the machine). A hosted model is
    used only when GF_BROWSER_LLM is explicitly set to ``openai`` or
    ``anthropic``. browser-use >= 0.5 ships its own chat classes; older
    releases take LangChain chat models, so both are probed.
    """
    provider = (os.environ.get("GF_BROWSER_LLM") or "ollama").strip().lower()
    model = (os.environ.get("GF_BROWSER_MODEL") or "").strip()
    if provider == "openai":
        cls = _first_attr(("browser_use", "browser_use.llm", "langchain_openai"), "ChatOpenAI")
        kwargs = {"model": model or "gpt-4o-mini"}
    elif provider == "anthropic":
        cls = _first_attr(("browser_use", "browser_use.llm", "langchain_anthropic"), "ChatAnthropic")
        kwargs = {"model": model or "claude-sonnet-4-5"}
    elif provider == "ollama":
        cls = _first_attr(("browser_use", "browser_use.llm", "langchain_ollama"), "ChatOllama")
        kwargs = {"model": model or "llama3.1"}
    else:
        raise BrowserUnavailable(
            f"GF_BROWSER_LLM={provider!r} is not supported (use ollama, openai or anthropic)"
        )
    if cls is None:
        raise BrowserUnavailable(
            f"No {provider} chat model class found for browser-use. Upgrade browser-use "
            f"(it ships Chat* classes) or install the matching langchain-{provider} package."
        )
    return cls(**kwargs)


def _new_bu_browser(headless: bool) -> tuple[Any, str]:
    """Create a browser-use browser and return it with the Agent kwarg name."""
    session_cls = getattr(_bu, "BrowserSession", None)
    if session_cls is not None:  # browser-use >= 0.2: BrowserSession(headless=...)
        try:
            return session_cls(headless=headless), "browser_session"
        except TypeError:
            profile_cls = getattr(_bu, "BrowserProfile", None)
            if profile_cls is not None:
                return session_cls(browser_profile=profile_cls(headless=headless)), "browser_session"
            raise
    config_cls = getattr(_bu, "BrowserConfig", None)
    browser_cls = getattr(_bu, "Browser", None)
    if browser_cls is not None and config_cls is not None:  # browser-use 0.1.x
        return browser_cls(config=config_cls(headless=headless)), "browser"
    raise BrowserUnavailable("This browser-use version exposes no BrowserSession or Browser class")


def _agent_browser_kwarg(preferred: str) -> str:
    """Pick the Agent keyword that accepts our browser for this version."""
    try:
        params = inspect.signature(_bu.Agent.__init__).parameters
    except (TypeError, ValueError):
        return preferred
    if preferred in params:
        return preferred
    for name in ("browser_session", "browser"):
        if name in params:
            return name
    return preferred


async def _close_bu_browser(browser: Any) -> None:
    for method in ("kill", "stop", "close"):
        fn = getattr(browser, method, None)
        if fn is None:
            continue
        try:
            result = fn()
            if inspect.isawaitable(result):
                await result
        except Exception:  # noqa: BLE001 - best effort teardown
            pass
        return


def _history_text(history: Any) -> str:
    final = getattr(history, "final_result", None)
    if callable(final):
        try:
            value = final()
            if value:
                return str(value)
        except Exception:  # noqa: BLE001
            pass
    return str(history)


async def _run_agent(url: str, task: str, headless: bool = True) -> str:
    """Run one browser-use Agent task; its browser lives only for this call."""
    llm = _build_llm()
    browser, kwarg = _new_bu_browser(headless)
    try:
        agent = _bu.Agent(
            task=f"Open {url} and then: {task}",
            llm=llm,
            **{_agent_browser_kwarg(kwarg): browser},
        )
        history = await agent.run(max_steps=_AGENT_MAX_STEPS)
        return _history_text(history)
    finally:
        await _close_bu_browser(browser)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def browse_async(url: str, task: str) -> dict[str, Any]:
    """Open *url* and let the browser-use Agent perform *task*."""
    _validate_url(url)
    if _HAS_BROWSER_USE:
        try:
            result = await _run_agent(url, task)
        except BrowserUnavailable as exc:
            return {"url": url, "task": task, "error": str(exc)}
        return {"url": url, "task": task, "result": result}

    # Fallback
    html = await _http_fetch(url)
    return {
        "url": url,
        "task": task,
        "result": f"[fallback] Page fetched ({len(html)} chars). Task execution requires browser-use.",
    }


def browse(url: str, task: str) -> dict[str, Any]:
    """Synchronous wrapper for browse_async."""
    return _run_async(browse_async(url, task))


async def extract_async(url: str, selectors: dict[str, str]) -> dict[str, Any]:
    """Extract data from a page using CSS selectors.

    *selectors* maps a friendly name → CSS selector.
    """
    _validate_url(url)
    if _HAS_PLAYWRIGHT:
        try:
            async with _open_page() as page:
                await page.goto(url)
                results: dict[str, Any] = {}
                for name, sel in selectors.items():
                    try:
                        el = await page.query_selector(sel)
                        results[name] = await el.text_content() if el else None
                    except Exception as exc:  # noqa: BLE001
                        results[name] = f"error: {exc}"
                return {"url": url, "extracted": results}
        except BrowserUnavailable as exc:
            return {"url": url, "error": str(exc)}

    html = await _http_fetch(url)
    return {
        "url": url,
        "extracted": {
            "_fallback": f"[fallback] Fetched {len(html)} chars. Install playwright for selector extraction."
        },
    }


def extract(url: str, selectors: dict[str, str]) -> dict[str, Any]:
    """Synchronous wrapper for extract_async."""
    return _run_async(extract_async(url, selectors))


async def fill_form_async(url: str, form_data: dict[str, str]) -> dict[str, Any]:
    """Fill a form on *url* with *form_data* and submit.

    *form_data* maps input name/selector → value.
    """
    _validate_url(url)
    if not _HAS_PLAYWRIGHT:
        return {"url": url, "error": "playwright is required for form filling"}
    try:
        async with _open_page() as page:
            await page.goto(url)
            for field, value in form_data.items():
                try:
                    await page.fill(field, value)
                except Exception:  # noqa: BLE001
                    try:
                        await page.fill(f'input[name="{field}"]', value)
                    except Exception as exc:  # noqa: BLE001
                        return {"url": url, "error": f"Could not fill '{field}': {exc}"}
            try:
                await page.keyboard.press("Enter")
            except Exception:  # noqa: BLE001
                pass
            return {"url": url, "filled": list(form_data.keys()), "status": "submitted"}
    except BrowserUnavailable as exc:
        return {"url": url, "error": str(exc)}


def fill_form(url: str, form_data: dict[str, str]) -> dict[str, Any]:
    """Synchronous wrapper for fill_form_async."""
    return _run_async(fill_form_async(url, form_data))


async def screenshot_async(url: str) -> dict[str, Any]:
    """Capture a screenshot of *url* and return as base64."""
    _validate_url(url)
    if not _HAS_PLAYWRIGHT:
        return {"url": url, "error": "playwright is required for screenshots"}
    try:
        async with _open_page() as page:
            await page.goto(url)
            screenshot_bytes = await page.screenshot(full_page=True)
    except BrowserUnavailable as exc:
        return {"url": url, "error": str(exc)}
    b64 = base64.b64encode(screenshot_bytes).decode()
    return {"url": url, "screenshot": b64, "format": "png"}


def screenshot(url: str) -> dict[str, Any]:
    """Synchronous wrapper for screenshot_async."""
    return _run_async(screenshot_async(url))


async def search_async(query: str) -> dict[str, Any]:
    """Web-search for *query* and return results."""
    if not _HAS_PLAYWRIGHT:
        return {
            "query": query,
            "results": [],
            "error": "playwright is required for web search",
        }
    search_url = "https://www.google.com/search?q=" + urllib.parse.quote_plus(query)
    try:
        async with _open_page() as page:
            await page.goto(search_url)
            results_elements = await page.query_selector_all("div.g")
            results: list[dict[str, str]] = []
            for el in results_elements[:10]:
                title_el = await el.query_selector("h3")
                link_el = await el.query_selector("a")
                snippet_el = await el.query_selector("div.VwiC3b")
                title = await title_el.text_content() if title_el else ""
                href = await link_el.get_attribute("href") if link_el else ""
                snippet = await snippet_el.text_content() if snippet_el else ""
                results.append({"title": title or "", "url": href or "", "snippet": snippet or ""})
            return {"query": query, "results": results}
    except BrowserUnavailable as exc:
        return {"query": query, "results": [], "error": str(exc)}


def search(query: str) -> dict[str, Any]:
    """Synchronous wrapper for search_async."""
    return _run_async(search_async(query))


async def click_async(url: str, selector: str) -> dict[str, Any]:
    """Click an element matching *selector* on *url*."""
    _validate_url(url)
    if not _HAS_PLAYWRIGHT:
        return {"url": url, "error": "playwright is required for click"}
    try:
        async with _open_page() as page:
            await page.goto(url)
            await page.click(selector)
            return {"url": url, "selector": selector, "clicked": True}
    except BrowserUnavailable as exc:
        return {"url": url, "error": str(exc)}


def click(url: str, selector: str) -> dict[str, Any]:
    """Synchronous wrapper for click_async."""
    return _run_async(click_async(url, selector))


async def scroll_async(url: str, direction: str = "down") -> dict[str, Any]:
    """Scroll the page on *url* in *direction*."""
    _validate_url(url)
    if not _HAS_PLAYWRIGHT:
        return {"url": url, "error": "playwright is required for scroll"}
    try:
        async with _open_page() as page:
            await page.goto(url)
            delta = 500 if direction == "down" else -500
            await page.mouse.wheel(0, delta)
            return {"url": url, "direction": direction, "scrolled": True}
    except BrowserUnavailable as exc:
        return {"url": url, "error": str(exc)}


def scroll(url: str, direction: str = "down") -> dict[str, Any]:
    """Synchronous wrapper for scroll_async."""
    return _run_async(scroll_async(url, direction))


async def get_page_text_async(url: str) -> dict[str, Any]:
    """Return the full visible text of *url*."""
    _validate_url(url)
    if _HAS_PLAYWRIGHT:
        try:
            async with _open_page() as page:
                await page.goto(url)
                text = await page.text_content("body") or ""
                return {"url": url, "text": text, "length": len(text)}
        except BrowserUnavailable as exc:
            return {"url": url, "error": str(exc)}

    html = await _http_fetch(url)
    return {
        "url": url,
        "text": html[:10000],
        "length": len(html),
        "note": "Raw HTML returned (install playwright for visible text)",
    }


def get_page_text(url: str) -> dict[str, Any]:
    """Synchronous wrapper for get_page_text_async."""
    return _run_async(get_page_text_async(url))


async def wait_for_async(url: str, selector: str, timeout: int = 10) -> dict[str, Any]:
    """Navigate to *url* and wait for *selector* to appear."""
    _validate_url(url)
    if not _HAS_PLAYWRIGHT:
        return {"url": url, "error": "playwright is required for wait_for"}
    try:
        async with _open_page() as page:
            await page.goto(url)
            try:
                await page.wait_for_selector(selector, timeout=timeout * 1000)
                return {"url": url, "selector": selector, "found": True}
            except Exception:  # noqa: BLE001
                return {
                    "url": url,
                    "selector": selector,
                    "found": False,
                    "timeout": timeout,
                }
    except BrowserUnavailable as exc:
        return {"url": url, "error": str(exc)}


def wait_for(url: str, selector: str, timeout: int = 10) -> dict[str, Any]:
    """Synchronous wrapper for wait_for_async."""
    return _run_async(wait_for_async(url, selector, timeout))


async def login_async(url: str, credentials: dict[str, str]) -> dict[str, Any]:
    """Navigate to *url* and fill login form with *credentials*.

    *credentials* should contain keys like ``username``, ``password``
    (or ``email``, ``pass`` — the function tries common selectors).
    """
    _validate_url(url)
    if not _HAS_PLAYWRIGHT:
        return {"url": url, "error": "playwright is required for login"}

    username_selectors = [
        'input[name="username"]',
        'input[name="email"]',
        'input[type="email"]',
        "#username",
        "#email",
        'input[name="user"]',
    ]
    password_selectors = [
        'input[name="password"]',
        'input[type="password"]',
        "#password",
        "#pass",
    ]

    username = credentials.get("username") or credentials.get("email", "")
    password = credentials.get("password") or credentials.get("pass", "")

    try:
        async with _open_page() as page:
            await page.goto(url)

            filled_user = False
            for sel in username_selectors:
                try:
                    await page.fill(sel, username)
                    filled_user = True
                    break
                except Exception:  # noqa: BLE001
                    continue

            filled_pass = False
            for sel in password_selectors:
                try:
                    await page.fill(sel, password)
                    filled_pass = True
                    break
                except Exception:  # noqa: BLE001
                    continue

            if filled_user and filled_pass:
                try:
                    await page.keyboard.press("Enter")
                except Exception:  # noqa: BLE001
                    pass
                return {
                    "url": url,
                    "status": "credentials_submitted",
                    "filled_user": filled_user,
                    "filled_pass": filled_pass,
                }

            return {
                "url": url,
                "error": "Could not locate login form fields",
                "filled_user": filled_user,
                "filled_pass": filled_pass,
            }
    except BrowserUnavailable as exc:
        return {"url": url, "error": str(exc)}


def login(url: str, credentials: dict[str, str]) -> dict[str, Any]:
    """Synchronous wrapper for login_async."""
    return _run_async(login_async(url, credentials))
