#!/usr/bin/env python3
"""Discretionary live Rex QA: temporarily rename this tab and restore its label.

Never run in CI. Herdr remains covered by offline schema checks and unit fakes.
"""
import json
import os
from pathlib import Path
import runpy
import subprocess


def run(command):
    return subprocess.run(command, check=True, text=True, capture_output=True, timeout=3).stdout


def main():
    if os.environ.get("HERDR_ENV") == "1" or not all(os.environ.get(k) for k in ("REX_SESSION", "REX_BLOCK")):
        raise SystemExit("Run manually from a Rex pane, outside Herdr.")
    script = runpy.run_path(str(Path(__file__).resolve().parents[2] / "dot_local/bin/executable_wt"))
    prefix = ["rex", "--autostart=false", "--timeout", "2s"]
    session, block = os.environ["REX_SESSION"], os.environ["REX_BLOCK"]
    window = json.loads(run([*prefix, "block", "inspect", "-s", session, block, "--json"]))["block"]["window_id"]
    inspect = [*prefix, "window", "inspect", "-s", session, window, "--json"]
    original = json.loads(run(inspect))["label"]
    try:
        script["rename_tab"]("wt-qa", os.environ, run)
        assert json.loads(run(inspect))["label"] == "wt-qa", "Tab was not renamed"
    finally:
        run([*prefix, "window", "rename", "-s", session, "--", window, original])
    assert json.loads(run(inspect))["label"] == original, "Original label was not restored"
    print("PASS: current Rex tab renamed and restored")


if __name__ == "__main__":
    main()
