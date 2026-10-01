#!/usr/bin/env bash
# Contracts for Voxtype configuration, cross-platform packaging, and systemd user units.
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

python3 - "$source_dir" "$test_root" <<'PY'
import configparser
import hashlib
import pathlib
import shutil
import subprocess
import sys
import tomllib

source, temp = map(pathlib.Path, sys.argv[1:])
config_file = source / "dot_config/voxtype/config.toml"
dotoold_unit = source / "dot_config/systemd/user/dotoold.service"
voxtype_unit = source / "dot_config/systemd/user/voxtype.service"
sync_tmpl = source / "run_onchange_after_voxtype-sync.sh.tmpl"
packages_file = source / ".chezmoidata/packages.yaml"
ignore_file = source / ".chezmoiignore"

empty_config = temp / "empty.toml"
empty_config.write_text("")


def chezmoi(*args, source_dir=source):
    result = subprocess.run(
        ["chezmoi", "--config", str(empty_config), "--source", str(source_dir), *args],
        text=True, capture_output=True)
    assert result.returncode == 0, (args, result.stderr)
    return result.stdout


def test_voxtype_config_valid_toml_and_parakeet_int8_schema():
    assert config_file.is_file(), f"Missing {config_file}"
    cfg = tomllib.loads(config_file.read_text())

    assert cfg.get("engine") == "parakeet", cfg.get("engine")
    assert cfg.get("state_file") == "auto", cfg.get("state_file")

    parakeet = cfg.get("parakeet", {})
    assert parakeet.get("model") == "parakeet-tdt-0.6b-v3-int8", parakeet
    assert parakeet.get("model_type") == "tdt", parakeet

    hotkey = cfg.get("hotkey", {})
    assert hotkey.get("enabled") is True, hotkey
    assert hotkey.get("key") == "SPACE", hotkey
    assert hotkey.get("modifiers") == ["LEFTSHIFT"], hotkey
    assert hotkey.get("cancel_key") == "ESC", hotkey
    assert hotkey.get("mode") == "push_to_talk", hotkey

    feedback = cfg.get("audio", {}).get("feedback", {})
    assert feedback.get("enabled") is True, feedback
    assert feedback.get("theme") == "subtle", feedback
    assert feedback.get("volume") == 0.7, feedback

    output = cfg.get("output", {})
    assert output.get("mode") == "type", output
    assert output.get("driver_order") == ["dotool", "clipboard"], output

    osd = cfg.get("osd", {})
    assert osd.get("enabled") is False, osd


def test_voxtype_darwin_and_linux_packages_declared():
    assert packages_file.is_file(), f"Missing {packages_file}"
    import yaml
    with open(packages_file, "r") as f:
        data = yaml.safe_load(f)

    pkgs = data.get("packages", {})
    assert "voxtype" in pkgs, "voxtype missing from packages"
    voxtype = pkgs["voxtype"]
    assert voxtype.get("role") == "base"
    assert voxtype["install"]["darwin"]["cask"] == "voxtype"
    assert voxtype["install"]["darwin"]["tap"] == "peteonrails/voxtype"
    assert voxtype["install"]["linux"]["custom"]["executable"] == "voxtype"
    assert voxtype["install"]["linux"]["order"] == 90

    assert "dotool" in pkgs, "dotool missing from packages"
    dotool = pkgs["dotool"]
    assert dotool.get("role") == "base"
    assert dotool["install"]["linux"]["custom"]["executable"] == "dotool"
    assert dotool["install"]["linux"]["order"] == 80

    assert "voxtype-deps" in pkgs, "voxtype-deps missing from packages"
    deps = pkgs["voxtype-deps"]
    assert deps.get("role") == "base"
    assert sorted(deps["install"]["linux"]["apt"]) == ["libxkbcommon-dev", "pipewire-alsa", "wl-clipboard"]


def test_voxtype_systemd_ignored_on_darwin():
    assert ignore_file.is_file(), f"Missing {ignore_file}"
    wrapper = temp / "ignore_darwin.tmpl"
    wrapper.write_text(
        '{{- $root := deepCopy . -}}'
        '{{- $_ := set $root.chezmoi "os" "darwin" -}}'
        '{{ includeTemplate (print "' + str(ignore_file) + '") $root }}'
    )
    rendered = chezmoi("execute-template", "-f", str(wrapper))
    lines = [line.strip() for line in rendered.splitlines() if line.strip()]
    assert any(".config/systemd" in line for line in lines), f".config/systemd must be ignored on darwin: {lines}"


def test_voxtype_systemd_units_wire_dotoold_and_local_bin_interfaces():
    assert dotoold_unit.is_file(), f"Missing {dotoold_unit}"
    assert voxtype_unit.is_file(), f"Missing {voxtype_unit}"

    dotoold_parser = configparser.ConfigParser(interpolation=None)
    dotoold_parser.read_string(dotoold_unit.read_text())
    assert dotoold_parser.get("Service", "ExecStart") == "%h/.local/bin/dotoold"
    assert "%h/.local/bin" in dotoold_parser.get("Service", "Environment")
    assert "/tmp/dotool-pipe" in dotoold_parser.get("Service", "ExecStartPre", fallback="")

    voxtype_parser = configparser.ConfigParser(interpolation=None)
    voxtype_parser.read_string(voxtype_unit.read_text())
    assert "dotoold.service" in voxtype_parser.get("Unit", "Requires")
    assert "dotoold.service" in voxtype_parser.get("Unit", "After")
    assert voxtype_parser.get("Service", "ExecStart") == "%h/.local/bin/voxtype daemon"
    assert "%h/.local/bin" in voxtype_parser.get("Service", "Environment")


def test_voxtype_sync_script_tracks_config_and_service_hashes():
    assert sync_tmpl.is_file(), f"Missing {sync_tmpl}"
    rendered = chezmoi("execute-template", "-f", str(sync_tmpl))
    rendered_script = temp / "voxtype-sync.sh"
    rendered_script.write_text(rendered)
    subprocess.run(["bash", "-n", str(rendered_script)], check=True)

    assert "setup --download --model" in rendered, rendered
    assert "systemctl --user daemon-reload" in rendered, rendered
    assert "systemctl --user restart voxtype.service" in rendered, rendered


tests = [value for name, value in list(globals().items()) if name.startswith("test_")]
failures = 0
for test in tests:
    try:
        test()
        print(f"PASS {test.__name__}")
    except Exception as error:  # noqa: BLE001
        failures += 1
        print(f"FAIL {test.__name__}: {error!r}")
sys.exit(1 if failures else 0)
PY
