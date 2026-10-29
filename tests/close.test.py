"""Unit tests: the process environment and exec are replaced by fakes."""
import io
import runpy
import unittest
from contextlib import redirect_stderr
from pathlib import Path

script = runpy.run_path(str(Path(__file__).parents[1] / "dot_local/bin/executable_close"))
close_command, main = script["close_command"], script["main"]

REX = {"REX_SESSION": "session:1", "REX_BLOCK": "block:2"}
HERDR = {"HERDR_ENV": "1", "HERDR_PANE_ID": "pane-3"}


class CloseCommandTest(unittest.TestCase):
    def test_rex_pane_closes_its_own_block(self):
        self.assertEqual(close_command(REX), [
            "rex", "--autostart=false", "--timeout", "2s",
            "block", "close", "-s", "session:1", "--", "block:2"])

    def test_herdr_pane_closes_its_own_pane(self):
        self.assertEqual(close_command(HERDR), ["herdr", "pane", "close", "--", "pane-3"])

    def test_herdr_nested_in_rex_closes_only_herdr_pane(self):
        self.assertEqual(close_command({**REX, **HERDR})[:3], ["herdr", "pane", "close"])

    def test_herdr_without_pane_id_does_not_fall_back_to_rex(self):
        self.assertIsNone(close_command({**REX, "HERDR_ENV": "1"}))

    def test_rex_without_block_returns_none(self):
        self.assertIsNone(close_command({"REX_SESSION": "session:1"}))

    def test_no_multiplexer_returns_none(self):
        self.assertIsNone(close_command({}))


class MainTest(unittest.TestCase):
    def test_main_execs_close_command(self):
        calls = []
        main(REX, lambda file, argv: calls.append((file, argv)))
        self.assertEqual(calls, [("rex", close_command(REX))])

    def test_main_without_multiplexer_fails_without_exec(self):
        calls = []
        with redirect_stderr(io.StringIO()) as stderr:
            status = main({}, lambda file, argv: calls.append(argv))
        self.assertEqual((status, calls), (1, []))
        self.assertIn("not in a", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
