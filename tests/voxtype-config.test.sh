#!/usr/bin/env bash
# Contracts for Voxtype configuration, cross-platform packaging, and systemd user units.
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

python3 - "$source_dir" "$test_root" <<'PY'
import configparser
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import tomllib

source, temp = map(pathlib.Path, sys.argv[1:])
config_file = source / "dot_config/voxtype/config.toml.tmpl"
dotoold_unit = source / "dot_config/systemd/user/dotoold.service"
ydotoold_unit = source / "dot_config/systemd/user/ydotoold.service"
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


def render_for_os(path, platform):
    return chezmoi("--override-data", json.dumps({"chezmoi": {"os": platform}}),
                   "execute-template", "-f", str(path))


def test_voxtype_darwin_uses_clipboard_and_preserves_shared_settings():
    linux = tomllib.loads(render_for_os(config_file, "linux"))
    darwin = tomllib.loads(render_for_os(config_file, "darwin"))
    assert darwin["output"]["mode"] == "clipboard", darwin["output"]
    assert "paste_keys" not in darwin["output"], darwin["output"]
    assert "driver_order" not in darwin["output"], darwin["output"]
    linux["output"]["mode"] = "clipboard"
    del linux["output"]["paste_keys"]
    del linux["output"]["driver_order"]
    assert darwin == linux, "Only platform-specific output settings should differ"


def test_voxtype_config_selects_whisper_small_en():
    assert config_file.is_file(), f"Missing {config_file}"
    cfg = tomllib.loads(render_for_os(config_file, "linux"))

    assert cfg.get("engine") == "whisper", cfg.get("engine")
    assert cfg.get("whisper", {}).get("model") == "small.en"
    assert cfg.get("whisper", {}).get("language") == "en"
    assert cfg.get("state_file") == "auto", cfg.get("state_file")

    parakeet = cfg.get("parakeet", {})
    assert parakeet.get("model") == "parakeet-tdt-0.6b-v3-int8", parakeet
    assert parakeet.get("model_type") == "tdt", parakeet

    hotkey = cfg.get("hotkey", {})
    assert hotkey.get("enabled") is True, hotkey
    assert hotkey.get("key") == "RIGHTALT", hotkey
    assert hotkey.get("modifiers") == [], hotkey
    assert hotkey.get("cancel_key") == "ESC", hotkey
    assert hotkey.get("mode") == "push_to_talk", hotkey

    feedback = cfg.get("audio", {}).get("feedback", {})
    assert feedback.get("enabled") is True, feedback
    assert feedback.get("theme") == "subtle", feedback
    assert feedback.get("volume") == 0.7, feedback

    output = cfg.get("output", {})
    assert output.get("mode") == "paste", output
    assert output.get("paste_keys") == "shift+insert", output
    assert output.get("driver_order") == ["dotool", "clipboard"], output

    osd = cfg.get("osd", {})
    assert osd.get("enabled") is False, osd


def test_voxtype_darwin_and_linux_packages_declared():
    assert packages_file.is_file(), f"Missing {packages_file}"
    data = json.loads(chezmoi("execute-template",
        '{{ include ".chezmoidata/packages.yaml" | fromYaml | toJson }}'))

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
    assert sorted(deps["install"]["linux"]["apt"]) == ["libxkbcommon-dev", "pipewire-alsa", "wl-clipboard", "ydotool"]


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
    rendered = render_for_os(sync_tmpl, "linux")
    rendered_script = temp / "voxtype-sync.sh"
    rendered_script.write_text(rendered)
    subprocess.run(["bash", "-n", str(rendered_script)], check=True)

    assert "setup --download --model" in rendered, rendered
    assert "systemctl --user daemon-reload" in rendered, rendered
    assert "systemctl --user restart voxtype.service" in rendered, rendered


def test_voxtype_paste_mode_depends_on_user_ydotoold_socket():
    assert ydotoold_unit.is_file(), f"Missing {ydotoold_unit}"

    ydotoold_parser = configparser.ConfigParser(interpolation=None)
    ydotoold_parser.read_string(ydotoold_unit.read_text())
    assert ydotoold_parser.get("Service", "ExecStart") == "/usr/bin/ydotoold --socket-path=%t/.ydotool_socket"

    voxtype_parser = configparser.ConfigParser(interpolation=None)
    voxtype_parser.read_string(voxtype_unit.read_text())
    assert "ydotoold.service" in voxtype_parser.get("Unit", "Requires")
    assert "ydotoold.service" in voxtype_parser.get("Unit", "After")


def test_voxtype_sync_script_enables_ydotoold_and_tracks_its_hash():
    rendered = render_for_os(sync_tmpl, "linux")
    assert "ydotoold.service:" in rendered, rendered
    assert "enable --now dotoold.service ydotoold.service voxtype.service" in rendered, rendered


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
