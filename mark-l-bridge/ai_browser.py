"""
AI Browser Module — browser-use integration for web automation.

Provides browser automation capabilities:
navigation, data extraction, form filling, screenshots, and search.
"""

from __future__ import annotations

import asyncio
import base64
import sys
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Graceful imports
# ---------------------------------------------------------------------------

_HAS_BROWSER_USE = False

try:
    from browser_use import Browser as _BuBrowser
    from browser_use import BrowserConfig as _BuBrowserConfig
    from browser_use import Controller as _BuController

    _HAS_BROWSER_USE = True
except ImportError:
    print("[ai_browser] ⚠️  browser-use not installed — browser module will use stub responses", file=sys.stderr)

try:
    import httpx as _httpx
    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False

# ---------------------------------------------------------------------------
# Browser singleton (lazy)
# ---------------------------------------------------------------------------

_browser: Any = None
_controller: Any = None


async def _ensure_browser(headless: bool = True) -> tuple[Any, Any]:
    """Return (browser, controller), creating them if necessary."""
    global _browser, _controller
    if not _HAS_BROWSER_USE:
        raise RuntimeError("browser-use is not installed. Install with: pip install browser-use")

    if _browser is None:
        config = _BuBrowserConfig(headless=headless)
        _browser = _BuBrowser(config=config)
        await _browser.start()
        _controller = _BuController()
    return _browser, _controller


async def _cleanup_browser() -> None:
    """Stop and reset the browser singleton."""
    global _browser, _controller
    if _browser is not None:
        try:
            await _browser.close()
        except Exception:
            pass
        _browser = None
        _controller = None


# ---------------------------------------------------------------------------
# Sync wrappers
# ---------------------------------------------------------------------------

def _run_async(coro):  # type: ignore[no-untyped-def]
    """Run an async coroutine from sync code, handling event loop."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return pool.submit(asyncio.run, coro).result()
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Simple HTTP fetch fallback (when browser-use unavailable)
# ---------------------------------------------------------------------------

async def _http_fetch(url: str) -> str:
    """Fetch a URL via httpx (fallback)."""
    if not _HAS_HTTPX:
        raise RuntimeError("Neither browser-use nor httpx is installed.")
    async with _httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.text


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def browse_async(url: str, task: str) -> dict[str, Any]:
    """Navigate to *url* and perform *task* using browser-use."""
    if _HAS_BROWSER_USE:
        browser, controller = await _ensure_browser()
        result = await controller.run_task(task, browser=browser)
        return {"url": url, "task": task, "result": str(result)}

    # Fallback
    html = await _http_fetch(url)
    return {"url": url, "task": task, "result": f"[fallback] Page fetched ({len(html)} chars). Task execution requires browser-use."}


def browse(url: str, task: str) -> dict[str, Any]:
    """Synchronous wrapper for browse_async."""
    return _run_async(browse_async(url, task))


async def extract_async(url: str, selectors: dict[str, str]) -> dict[str, Any]:
    """Extract data from a page using CSS selectors.

    *selectors* maps a friendly name → CSS selector.
    """
    if _HAS_BROWSER_USE:
        browser, controller = await _ensure_browser()
        await browser.goto(url)
        page = browser.get_current_page()
        results: dict[str, Any] = {}
        for name, sel in selectors.items():
            try:
                el = await page.query_selector(sel)
                results[name] = await el.text_content() if el else None
            except Exception as exc:
                results[name] = f"error: {exc}"
        return {"url": url, "extracted": results}

    html = await _http_fetch(url)
    return {"url": url, "extracted": {"_fallback": f"[fallback] Fetched {len(html)} chars. Install browser-use for selector extraction."}}


def extract(url: str, selectors: dict[str, str]) -> dict[str, Any]:
    """Synchronous wrapper for extract_async."""
    return _run_async(extract_async(url, selectors))


async def fill_form_async(url: str, form_data: dict[str, str]) -> dict[str, Any]:
    """Fill a form on *url* with *form_data* and submit.

    *form_data* maps input name/selector → value.
    """
    if _HAS_BROWSER_USE:
        browser, _ = await _ensure_browser()
        await browser.goto(url)
        page = browser.get_current_page()
        for field, value in form_data.items():
            try:
                await page.fill(field, value)
            except Exception:
                try:
                    await page.fill(f'input[name="{field}"]', value)
                except Exception as exc:
                    return {"url": url, "error": f"Could not fill '{field}': {exc}"}
        try:
            await page.keyboard.press("Enter")
        except Exception:
            pass
        return {"url": url, "filled": list(form_data.keys()), "status": "submitted"}

    return {"url": url, "error": "browser-use is required for form filling"}


def fill_form(url: str, form_data: dict[str, str]) -> dict[str, Any]:
    """Synchronous wrapper for fill_form_async."""
    return _run_async(fill_form_async(url, form_data))


async def screenshot_async(url: str) -> dict[str, Any]:
    """Capture a screenshot of *url* and return as base64."""
    if _HAS_BROWSER_USE:
        browser, _ = await _ensure_browser()
        await browser.goto(url)
        page = browser.get_current_page()
        screenshot_bytes = await page.screenshot(full_page=True)
        b64 = base64.b64encode(screenshot_bytes).decode()
        return {"url": url, "screenshot": b64, "format": "png"}

    return {"url": url, "error": "browser-use is required for screenshots"}


def screenshot(url: str) -> dict[str, Any]:
    """Synchronous wrapper for screenshot_async."""
    return _run_async(screenshot_async(url))


async def search_async(query: str) -> dict[str, Any]:
    """Web-search for *query* and return results."""
    if _HAS_BROWSER_USE:
        browser, _ = await _ensure_browser()
        search_url = f"https://www.google.com/search?q={query.replace(' ', '+')}"
        await browser.goto(search_url)
        page = browser.get_current_page()
        results_elements = await page.query_selector_all("div.g")
        results: list[dict[str, str]] = []
        for el in results_elements[:10]:
            title_el = await el.query_selector("h3")
            link_el = await el.query_selector("a")
            snippet_el = await el.query_selector("div.VwiC3b")
            title = await title_el.text_content() if title_el else ""
            href = await link_el.get_attribute("href") if link_el else ""
            snippet = await snippet_el.text_content() if snippet_el else ""
            results.append({"title": title, "url": href, "snippet": snippet})
        return {"query": query, "results": results}

    return {"query": query, "results": [], "error": "browser-use is required for web search"}


def search(query: str) -> dict[str, Any]:
    """Synchronous wrapper for search_async."""
    return _run_async(search_async(query))


async def click_async(url: str, selector: str) -> dict[str, Any]:
    """Click an element matching *selector* on *url*."""
    if _HAS_BROWSER_USE:
        browser, _ = await _ensure_browser()
        await browser.goto(url)
        page = browser.get_current_page()
        await page.click(selector)
        return {"url": url, "selector": selector, "clicked": True}

    return {"url": url, "error": "browser-use is required for click"}


def click(url: str, selector: str) -> dict[str, Any]:
    """Synchronous wrapper for click_async."""
    return _run_async(click_async(url, selector))


async def scroll_async(url: str, direction: str = "down") -> dict[str, Any]:
    """Scroll the page on *url* in *direction*."""
    if _HAS_BROWSER_USE:
        browser, _ = await _ensure_browser()
        await browser.goto(url)
        page = browser.get_current_page()
        delta = 500 if direction == "down" else -500
        await page.mouse.wheel(0, delta)
        return {"url": url, "direction": direction, "scrolled": True}

    return {"url": url, "error": "browser-use is required for scroll"}


def scroll(url: str, direction: str = "down") -> dict[str, Any]:
    """Synchronous wrapper for scroll_async."""
    return _run_async(scroll_async(url, direction))


async def get_page_text_async(url: str) -> dict[str, Any]:
    """Return the full visible text of *url*."""
    if _HAS_BROWSER_USE:
        browser, _ = await _ensure_browser()
        await browser.goto(url)
        page = browser.get_current_page()
        text = await page.text_content("body") or ""
        return {"url": url, "text": text, "length": len(text)}

    html = await _http_fetch(url)
    return {"url": url, "text": html[:10000], "length": len(html), "note": "Raw HTML returned (install browser-use for visible text)"}


def get_page_text(url: str) -> dict[str, Any]:
    """Synchronous wrapper for get_page_text_async."""
    return _run_async(get_page_text_async(url))


async def wait_for_async(url: str, selector: str, timeout: int = 10) -> dict[str, Any]:
    """Navigate to *url* and wait for *selector* to appear."""
    if _HAS_BROWSER_USE:
        browser, _ = await _ensure_browser()
        await browser.goto(url)
        page = browser.get_current_page()
        try:
            await page.wait_for_selector(selector, timeout=timeout * 1000)
            return {"url": url, "selector": selector, "found": True}
        except Exception:
            return {"url": url, "selector": selector, "found": False, "timeout": timeout}

    return {"url": url, "error": "browser-use is required for wait_for"}


def wait_for(url: str, selector: str, timeout: int = 10) -> dict[str, Any]:
    """Synchronous wrapper for wait_for_async."""
    return _run_async(wait_for_async(url, selector, timeout))


async def login_async(url: str, credentials: dict[str, str]) -> dict[str, Any]:
    """Navigate to *url* and fill login form with *credentials*.

    *credentials* should contain keys like ``username``, ``password``
    (or ``email``, ``pass`` — the function tries common selectors).
    """
    if _HAS_BROWSER_USE:
        browser, _ = await _ensure_browser()
        await browser.goto(url)
        page = browser.get_current_page()

        username_selectors = [
            'input[name="username"]', 'input[name="email"]',
            'input[type="email"]', '#username', '#email',
            'input[name="user"]',
        ]
        password_selectors = [
            'input[name="password"]', 'input[type="password"]',
            '#password', '#pass',
        ]

        username = credentials.get("username") or credentials.get("email", "")
        password = credentials.get("password") or credentials.get("pass", "")

        filled_user = False
        for sel in username_selectors:
            try:
                await page.fill(sel, username)
                filled_user = True
                break
            except Exception:
                continue

        filled_pass = False
        for sel in password_selectors:
            try:
                await page.fill(sel, password)
                filled_pass = True
                break
            except Exception:
                continue

        if filled_user and filled_pass:
            try:
                await page.keyboard.press("Enter")
            except Exception:
                pass
            return {"url": url, "status": "credentials_submitted", "filled_user": filled_user, "filled_pass": filled_pass}

        return {"url": url, "error": "Could not locate login form fields", "filled_user": filled_user, "filled_pass": filled_pass}

    return {"url": url, "error": "browser-use is required for login"}


def login(url: str, credentials: dict[str, str]) -> dict[str, Any]:
    """Synchronous wrapper for login_async."""
    return _run_async(login_async(url, credentials))
