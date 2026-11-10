#!/usr/bin/env bash
# Contracts for the personal herdr-app keymap: macOS additionally gets the
# native Cmd shortcuts on top of the bindings every other OS gets.
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

python3 - "$source_dir" "$test_root" <<'PY'
import json
import pathlib
import subprocess
import sys

source, temp = map(pathlib.Path, sys.argv[1:])
empty_config = temp / "empty.toml"
empty_config.write_text("")
template = source / "dot_config/herdr-app/keys.json.tmpl"

CMD_BINDINGS = {
    "global": {"cmd-t": "tab.new", "cmd-w": "tab.close"},
    "terminal": {
        "cmd-c": "terminal.copy",
        "cmd-v": "terminal.paste",
        "cmd-f": "terminal.search",
    },
}


def fail(msg):
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def render(os_name):
    if not template.is_file():
        fail(f"{template} does not exist")
    override = json.dumps({"chezmoi": {"os": os_name}})
    result = subprocess.run(
        ["chezmoi", "--config", str(empty_config), "--source", str(source),
         "--override-data", override, "execute-template", "-f", str(template)],
        text=True, capture_output=True)
    if result.returncode != 0:
        fail(f"rendering {template} for {os_name} failed: {result.stderr}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        fail(f"{os_name} render is not valid JSON ({error}):\n{result.stdout}")


def cmd_bindings(keys):
    return {section: {k: v for k, v in bindings.items() if k.startswith("cmd-")}
            for section, bindings in keys.items()
            if any(k.startswith("cmd-") for k in bindings)}


darwin = render("darwin")
linux = render("linux")

# Test 1: macOS gets exactly the five Cmd bindings, each in its own section.
if cmd_bindings(darwin) != CMD_BINDINGS:
    fail(f"darwin Cmd bindings should be {CMD_BINDINGS}, got {cmd_bindings(darwin)}")

# Test 2: non-macOS renders contain no cmd-* key in any section.
if cmd_bindings(linux):
    fail(f"linux render must not bind Cmd keys, got {cmd_bindings(linux)}")

# Test 3: macOS only adds the Cmd bindings; every other binding matches linux.
darwin_without_cmd = {
    section: {k: v for k, v in bindings.items() if not k.startswith("cmd-")}
    for section, bindings in darwin.items()
}
if darwin_without_cmd != linux:
    fail("darwin render changed or dropped bindings shared with linux")

print("herdr-app keys verified successfully!")
PY
