#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

python3 - "$source_dir" "$test_root" <<'PY'
import json
import pathlib
import subprocess
import sys
import re

source, temp = map(pathlib.Path, sys.argv[1:])
empty_config = temp / "empty.toml"
empty_config.write_text("")

def fail(msg):
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)

def execute_template(path):
    result = subprocess.run(
        ["chezmoi", "--config", str(empty_config), "--source", str(source),
         "execute-template", "-f", str(path)],
        text=True, capture_output=True)
    if result.returncode != 0:
        fail(f"rendering {path} failed: {result.stderr}")
    return result.stdout

# Check mods
expected_configs = {
    "vcs": {"argv": ["vcsui"], "target": "space", "machineEnv": None},
    "diff": {"argv": ["hunk", "show"], "target": "space", "machineEnv": None},
    "todoist": {"argv": ["tv", "todoist"], "target": "space", "machineEnv": None}
}
expected_mod_json = { "place": "none", "overlay": { "kind": "dialog", "width": 1, "height": 1 } }

for mod_name, expected_config in expected_configs.items():
    # 1. Check mod.json
    mod_json_path = source / f"dot_config/herdr-app/mods/{mod_name}/mod.json"
    if not mod_json_path.exists():
        fail(f"{mod_json_path} does not exist")
    try:
        mod_json = json.loads(mod_json_path.read_text())
        if mod_json != expected_mod_json:
            fail(f"{mod_name}/mod.json should be {expected_mod_json}, got {mod_json}")
    except json.JSONDecodeError as error:
        fail(f"Invalid JSON in {mod_name}/mod.json: {error}")

    # 2. Check main.js.tmpl
    main_js_path = source / f"dot_config/herdr-app/mods/{mod_name}/main.js.tmpl"
    if not main_js_path.exists():
        fail(f"{main_js_path} does not exist")
    
    rendered_js = execute_template(main_js_path)
    match = re.search(r'^const POPUP = (\{.*?\});$', rendered_js, re.MULTILINE)
    if not match:
        fail(f"{mod_name}/main.js.tmpl does not contain 'const POPUP = ...;' line")
    
    try:
        popup_config = json.loads(match.group(1))
        if popup_config != expected_config:
            fail(f"{mod_name} config should be {expected_config}, got {popup_config}")
    except json.JSONDecodeError as error:
        fail(f"Invalid JSON in {mod_name} POPUP config: {error}")

# Check keys
keys_template = source / "dot_config/herdr-app/keys.json.tmpl"
def render_keys(os_name):
    override = json.dumps({"chezmoi": {"os": os_name}})
    result = subprocess.run(
        ["chezmoi", "--config", str(empty_config), "--source", str(source),
         "--override-data", override, "execute-template", "-f", str(keys_template)],
        text=True, capture_output=True)
    if result.returncode != 0:
        fail(f"rendering keys for {os_name} failed: {result.stderr}")
    return json.loads(result.stdout)

expected_keys = {
    "ctrl-alt-v": "mod.open:vcs",
    "ctrl-alt-d": "mod.open:diff",
    "ctrl-alt-t": "mod.open:todoist"
}

for os_name in ["darwin", "linux"]:
    keys = render_keys(os_name)
    global_keys = keys.get("global", {})
    
    for k, v in expected_keys.items():
        if global_keys.get(k) != v:
            fail(f"In {os_name} keys, {k} should be {v}, got {global_keys.get(k)}")
    
    for k, v in global_keys.items():
        if isinstance(v, dict) and v.get("command") == "terminal.open":
            fail(f"In {os_name} keys, found terminal.open action: {k} -> {v}")
        if v == "terminal.open":
            fail(f"In {os_name} keys, found terminal.open action: {k} -> {v}")

print("herdr-app popups verified successfully!")
PY
