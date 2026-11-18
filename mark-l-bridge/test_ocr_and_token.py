"""Bridge token resolution order and non-blocking OCR.

Run with: python3 -m pytest -q mark-l-bridge/test_ocr_and_token.py
"""

import asyncio
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
import server  # noqa: E402


class TokenResolutionTests(unittest.TestCase):
    """Contract shared with web-ui/lib/bridge-token.ts and voice-pipeline."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.token_dir = Path(self.tmp.name) / "bridge"
        self.patches = [
            patch.object(server, "_TOKEN_DIR", self.token_dir),
            patch.object(server, "_TOKEN_FILE", self.token_dir / "token"),
        ]
        for p in self.patches:
            p.start()
        self.token_dir.mkdir(parents=True)
        (self.token_dir / "token").write_text("file-token\n")
        self.client = TestClient(server.app)

    def tearDown(self):
        self.client.close()
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def _health(self, token):
        return self.client.get(
            "/api/mark-l/health", headers={"Authorization": f"Bearer {token}"}
        ).status_code

    def test_env_token_wins_over_file(self):
        with patch.dict(os.environ, {"MARKL_BRIDGE_TOKEN": " env-token "}):
            self.assertEqual(self._health("env-token"), 200)
            self.assertEqual(self._health("file-token"), 401)

    def test_file_token_used_when_env_unset_or_blank(self):
        for value in (None, "", "   "):
            env = dict(os.environ)
            env.pop("MARKL_BRIDGE_TOKEN", None)
            if value is not None:
                env["MARKL_BRIDGE_TOKEN"] = value
            with patch.dict(os.environ, env, clear=True):
                self.assertEqual(self._health("file-token"), 200, value)


class _SlowOcr:
    instances = 0
    seen_paths: list = []

    def __init__(self, **kwargs):
        type(self).instances += 1
        time.sleep(0.2)  # model init

    def ocr(self, path, cls=True):
        type(self).seen_paths.append(path)
        assert Path(path).read_bytes() == b"img"
        time.sleep(0.6)
        return [[[None, ("hello", 0.99)], [None, ("world", 0.98)]]]


class OcrTests(unittest.TestCase):
    def setUp(self):
        _SlowOcr.instances = 0
        _SlowOcr.seen_paths = []
        self.patches = [
            patch.object(server, "_HAS_OCR", True),
            patch.object(server, "_PaddleOCR", _SlowOcr, create=True),
            patch.object(server, "_ocr_engine", None),
            patch.object(server, "_MISSING", set(server._MISSING) - {"ocr"}),
        ]
        for p in self.patches:
            p.start()
        self.headers = {"X-Bridge-Token": server._read_bridge_token()}

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_ocr_does_not_block_other_requests(self):
        async def scenario():
            transport = httpx.ASGITransport(app=server.app)
            order = []
            async with httpx.AsyncClient(transport=transport, base_url="http://bridge") as client:
                async def ocr():
                    r = await client.post(
                        "/api/mark-l/ocr",
                        headers=self.headers,
                        files={"image": ("screen.png", b"img", "image/png")},
                    )
                    order.append("ocr")
                    return r

                async def health():
                    await asyncio.sleep(0.05)
                    r = await client.get("/api/mark-l/health", headers=self.headers)
                    order.append("health")
                    return r

                ocr_res, health_res = await asyncio.gather(ocr(), health())
            return order, ocr_res, health_res

        order, ocr_res, health_res = asyncio.run(scenario())
        self.assertEqual(health_res.status_code, 200)
        self.assertEqual(ocr_res.status_code, 200, ocr_res.text)
        self.assertEqual(ocr_res.json()["data"], {"text": "hello\nworld", "lines": 2})
        self.assertEqual(order, ["health", "ocr"])

    def test_engine_built_once_under_concurrency(self):
        client = TestClient(server.app)
        results = []

        def call():
            results.append(
                client.post(
                    "/api/mark-l/ocr",
                    headers=self.headers,
                    files={"image": ("a.png", b"img", "image/png")},
                ).status_code
            )

        threads = [threading.Thread(target=call) for _ in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        client.close()
        self.assertEqual(results, [200, 200, 200])
        self.assertEqual(_SlowOcr.instances, 1)

    def test_upload_cap_and_safe_temp_name(self):
        client = TestClient(server.app)
        with patch.object(server, "_OCR_MAX_BYTES", 2):
            r = client.post(
                "/api/mark-l/ocr",
                headers=self.headers,
                files={"image": ("a.png", b"img", "image/png")},
            )
        self.assertEqual(r.status_code, 413)
        self.assertEqual(_SlowOcr.seen_paths, [])

        r = client.post(
            "/api/mark-l/ocr",
            headers=self.headers,
            files={"image": ("x.png/../../evil\\..\\boot.ini", b"img", "image/png")},
        )
        client.close()
        self.assertEqual(r.status_code, 200)
        (path,) = _SlowOcr.seen_paths
        self.assertEqual(Path(path).parent, Path(tempfile.gettempdir()))
        self.assertTrue(Path(path).name.startswith("gfai-ocr-"))
        self.assertTrue(path.endswith(".png"))
        self.assertFalse(Path(path).exists())


if __name__ == "__main__":
    unittest.main()
