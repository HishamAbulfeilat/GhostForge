"""Token file is created atomically with 0600 and shared with the bridge on a race."""
from __future__ import annotations

import os
import stat
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server  # noqa: E402


class VoiceTokenFileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        token_dir = Path(self.tmp.name) / "bridge"
        self.path = token_dir / "token"
        for p in (
            patch.object(server, "_TOKEN_DIR", token_dir),
            patch.object(server, "_TOKEN_FILE", self.path),
            patch.dict(os.environ, {k: v for k, v in os.environ.items()
                                    if k not in ("MARKL_BRIDGE_TOKEN", "GHOSTFORGE_VOICE_TOKEN")}, clear=True),
        ):
            p.start()
            self.addCleanup(p.stop)

    def test_created_with_0600_even_under_a_permissive_umask(self):
        if os.name != "posix":
            self.skipTest("POSIX permissions")
        flags_seen = []
        real_open = os.open

        def spy(path, flags, mode=0o777, *args, **kwargs):
            if str(path) == str(self.path):
                flags_seen.append((flags, mode))
            return real_open(path, flags, mode, *args, **kwargs)

        old = os.umask(0)
        try:
            with patch.object(server.os, "open", side_effect=spy):
                token = server._read_token()
        finally:
            os.umask(old)
        self.assertEqual(len(token), 64)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        self.assertTrue(flags_seen and flags_seen[0][0] & os.O_EXCL and flags_seen[0][1] == 0o600)

    def test_existing_file_wins_the_race(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text("bridge-made\n")
        self.assertEqual(server._read_token(), "bridge-made")

    def test_concurrent_creators_agree(self):
        results: list[str] = []
        barrier = threading.Barrier(6)

        def worker():
            barrier.wait()
            results.append(server._read_token())

        threads = [threading.Thread(target=worker) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(set(results)), 1)


if __name__ == "__main__":
    unittest.main()
