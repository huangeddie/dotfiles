"""Unit tests: the process environment and exec are replaced by fakes."""
import io
import runpy
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

script = runpy.run_path(str(Path(__file__).parents[1] / "dot_local/bin/executable_close"))
close_command, main = script["close_command"], script["main"]

REX = {"REX_SESSION": "session:1"}
HERDR_APP = {"HC_TERMINAL_ID": "t3d"}
HERDR = {"HERDR_ENV": "1", "HERDR_PANE_ID": "pane-3"}


class CloseCommandTest(unittest.TestCase):
    def test_rex_session_kills_entire_session_without_requiring_rex_block(self):
        self.assertEqual(
            close_command(REX),
            ["rex", "--autostart=false", "--timeout", "2s", "kill", "--", "session:1"],
        )

    def test_herdr_app_terminal_kills_its_own_hc_terminal(self):
        self.assertEqual(close_command(HERDR_APP), ["hc", "kill", "--", "t3d"])

    def test_herdr_pane_closes_its_own_pane(self):
        self.assertEqual(close_command(HERDR), ["herdr", "pane", "close", "--", "pane-3"])

    def test_rex_takes_precedence_over_herdr_app_and_herdr(self):
        self.assertEqual(
            close_command({**REX, **HERDR_APP, **HERDR}),
            ["rex", "--autostart=false", "--timeout", "2s", "kill", "--", "session:1"],
        )

    def test_herdr_app_takes_precedence_over_legacy_herdr(self):
        self.assertEqual(
            close_command({**HERDR_APP, **HERDR}),
            ["hc", "kill", "--", "t3d"],
        )

    def test_empty_outer_markers_fall_through_to_active_backend(self):
        self.assertEqual(
            close_command({"REX_SESSION": "", "REX_BLOCK": "", **HERDR_APP}),
            ["hc", "kill", "--", "t3d"],
        )
        self.assertEqual(
            close_command(
                {"HC_TERMINAL_ID": "", "HC_TERMINAL_SOCKET": "", "HC_SCOPE": "", **HERDR}
            ),
            ["herdr", "pane", "close", "--", "pane-3"],
        )

    def test_rex_block_without_session_fails_closed_above_herdr_app(self):
        self.assertIsNone(close_command({"REX_BLOCK": "block:2", **HERDR_APP}))

    def test_herdr_app_socket_or_scope_without_terminal_id_fails_closed_above_herdr(self):
        self.assertIsNone(
            close_command({"HC_TERMINAL_SOCKET": "/tmp/hc.sock", **HERDR})
        )
        self.assertIsNone(close_command({"HC_SCOPE": "scope-1", **HERDR}))

    def test_herdr_without_pane_id_returns_none(self):
        self.assertIsNone(close_command({"HERDR_ENV": "1"}))

    def test_non_active_herdr_env_value_with_pane_id_returns_none(self):
        self.assertIsNone(close_command({"HERDR_ENV": "0", "HERDR_PANE_ID": "pane-3"}))

    def test_option_like_target_ids_stay_after_double_dash(self):
        rex = close_command({"REX_SESSION": "-s"})
        herdr_app = close_command({"HC_TERMINAL_ID": "-h"})
        herdr = close_command({"HERDR_ENV": "1", "HERDR_PANE_ID": "--pane"})
        self.assertEqual(rex[-2:], ["--", "-s"])
        self.assertEqual(herdr_app[-2:], ["--", "-h"])
        self.assertEqual(herdr[-2:], ["--", "--pane"])

    def test_no_multiplexer_returns_none(self):
        self.assertIsNone(close_command({}))


class MainTest(unittest.TestCase):
    def test_main_execs_resolved_command(self):
        calls = []
        main(HERDR_APP, lambda file, argv: calls.append((file, argv)))
        self.assertEqual(calls, [("hc", ["hc", "kill", "--", "t3d"])])

    def test_main_without_multiplexer_prints_error_and_exits_nonzero_without_exec(self):
        calls = []
        with redirect_stderr(io.StringIO()) as stderr:
            status = main({}, lambda file, argv: calls.append(argv))
        self.assertEqual((status, calls), (1, []))
        self.assertIn(
            "Rex session, Herdr App terminal, or Herdr pane", stderr.getvalue()
        )

    def test_main_help_prints_usage_and_exits_zero_without_exec(self):
        calls = []
        with redirect_stdout(io.StringIO()) as stdout:
            status = main(REX, lambda file, argv: calls.append(argv), ["--help"])
        self.assertEqual((status, calls), (0, []))
        self.assertIn("Usage: close", stdout.getvalue())

    def test_main_unexpected_arguments_fail_closed_without_exec(self):
        calls = []
        with redirect_stderr(io.StringIO()) as stderr:
            status = main(REX, lambda file, argv: calls.append(argv), ["pane-3"])
        self.assertEqual((status, calls), (2, []))
        self.assertIn("takes no arguments", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
