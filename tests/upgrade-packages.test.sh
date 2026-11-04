#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

python3 - "$source_dir" "$test_root" <<'PY'
import json
import os
import pathlib
import shlex
import shutil
import subprocess
import sys

source, temp = map(pathlib.Path, sys.argv[1:])
empty_config = temp / "empty.toml"
empty_config.write_text("")
upgrade_tmpl = source / "run_after_upgrade-packages.sh.tmpl"


def render(source_dir: pathlib.Path, override: dict | None = None, expect_ok: bool = True):
    cmd = ["chezmoi", "--config", str(empty_config), "--source", str(source_dir)]
    if override is not None:
        cmd.extend(["--override-data", json.dumps(override)])
    cmd.extend(["execute-template", "-f", str(source_dir / "run_after_upgrade-packages.sh.tmpl")])
    res = subprocess.run(cmd, text=True, capture_output=True)
    if expect_ok:
        assert res.returncode == 0, (override, res.stderr)
    return res


def make_isolated_source(name: str, catalog: dict) -> pathlib.Path:
    dst = temp / name
    shutil.copytree(source / ".chezmoitemplates", dst / ".chezmoitemplates")
    shutil.copytree(source / ".chezmoidata", dst / ".chezmoidata")
    shutil.copy2(upgrade_tmpl, dst / "run_after_upgrade-packages.sh.tmpl")
    (dst / ".chezmoidata/packages.yaml").write_text(json.dumps(catalog))
    return dst


def make_network_blocked_bin(bin_dir: pathlib.Path) -> None:
    bin_dir.mkdir(parents=True, exist_ok=True)
    for exe in ("curl", "wget"):
        p = bin_dir / exe
        p.write_text('#!/bin/sh\necho "network forbidden in unit tests" >&2\nexit 97\n')
        p.chmod(0o755)


def test_default_and_false_upgrade_packages_render_empty():
    base = {"chezmoi": {"os": "linux"}, "machineRoles": ["base"]}
    assert render(source, base).stdout == ""
    assert render(source, {**base, "upgradePackages": False}).stdout == ""


def test_non_boolean_upgrade_packages_fails_template_rendering():
    base = {"chezmoi": {"os": "linux"}, "machineRoles": ["base"]}
    for bad in ("true", 1, None, [], {}):
        res = render(source, {**base, "upgradePackages": bad}, expect_ok=False)
        assert res.returncode != 0, f"accepted non-boolean {bad!r}"
        assert "upgradePackages must be a boolean" in res.stderr, res.stderr


def test_invalid_catalog_fails_when_upgrade_packages_enabled():
    res = render(
        source,
        {
            "chezmoi": {"os": "linux"},
            "machineRoles": ["base"],
            "upgradePackages": True,
            "packages": {"prettier": {"unexpected": True}},
        },
        expect_ok=False,
    )
    assert res.returncode != 0
    assert "packages.prettier.unexpected" in res.stderr, res.stderr


def test_darwin_upgrade_runs_brew_bundle_without_no_upgrade_and_preserves_qualified_trust():
    catalog = {
        "machineRolePolicy": {
            "required": ["base"],
            "platforms": {"linux": ["base", "gaming"], "darwin": ["base"]},
        },
        "packages": {
            "hunk": {"role": "base", "install": {"darwin": {"brew": "modem-dev/tap/hunk", "trusted": True}}},
            "ghostty": {"role": "base", "install": {"darwin": {"cask": "ghostty"}}},
            "voxtype": {
                "role": "base",
                "install": {"darwin": {"cask": "voxtype", "tap": "peteonrails/voxtype", "trusted": True}},
            },
            "cargo": {
                "role": "base",
                "install": {"darwin": {"custom": {"executable": "cargo", "install": "curl https://sh.rustup.rs | sh"}}},
            },
        },
        "packageRemovals": {"linux": {"apt": []}},
    }
    iso = make_isolated_source("darwin-src", catalog)
    script_text = render(
        iso, {"chezmoi": {"os": "darwin"}, "machineRoles": ["base"], "upgradePackages": True}
    ).stdout
    assert script_text.strip() != "", "expected non-empty darwin upgrade script"
    assert "declare -A" not in script_text, "darwin script must remain Bash 3.2 compatible"
    assert "sh.rustup.rs" not in script_text, "custom installers must not run during upgrade"

    script = temp / "darwin-upgrade.sh"
    script.write_text(script_text)
    subprocess.run(["/bin/bash", "-n", str(script)], check=True)

    fake_bin = temp / "darwin-bin"
    make_network_blocked_bin(fake_bin)
    brew_calls = temp / "brew-calls.log"
    brewfile_copy = temp / "captured-Brewfile"
    brew_bin = fake_bin / "brew"
    brew_bin.write_text(
        '#!/usr/bin/env bash\n'
        'set -euo pipefail\n'
        'printf "%s\\n" "$*" >>"$BREW_CALLS"\n'
        'for arg in "$@"; do\n'
        '  if [[ "$arg" == --file=* ]]; then\n'
        '    cp "${arg#--file=}" "$BREWFILE_COPY"\n'
        '    printf "%s" "${arg#--file=}" >"$BREWFILE_PATH"\n'
        '  fi\n'
        'done\n'
        'if [[ "${BREW_FAIL:-0}" == "1" ]]; then exit 42; fi\n'
    )
    brew_bin.chmod(0o755)

    brewfile_path_record = temp / "brewfile-path.txt"
    env = {
        **os.environ,
        "PATH": f"{fake_bin}:/usr/bin:/bin",
        "HOME": str(temp / "darwin-home"),
        "BREW_CALLS": str(brew_calls),
        "BREWFILE_COPY": str(brewfile_copy),
        "BREWFILE_PATH": str(brewfile_path_record),
    }
    (temp / "darwin-home").mkdir(parents=True, exist_ok=True)
    subprocess.run(["/bin/bash", str(script)], env=env, check=True)

    calls = [shlex.split(line) for line in brew_calls.read_text().splitlines()]
    assert len(calls) == 1, calls
    assert calls[0][:2] == ["bundle", "install"], calls
    assert "--verbose" in calls[0] and "--no-upgrade" not in calls[0], calls
    assert not pathlib.Path(brewfile_path_record.read_text()).exists(), "temp Brewfile leaked on success"
    assert sorted(brewfile_copy.read_text().splitlines()) == sorted([
        'tap "peteonrails/voxtype"',
        'brew "modem-dev/tap/hunk", trusted: true',
        'cask "ghostty"',
        'cask "peteonrails/voxtype/voxtype", trusted: true',
    ]), brewfile_copy.read_text()

    # Denied prefix filtering + temp file cleanup on failure
    denied_script = temp / "darwin-denied.sh"
    denied_script.write_text(
        render(
            iso,
            {
                "chezmoi": {"os": "darwin"},
                "machineRoles": ["base"],
                "upgradePackages": True,
                "packagePolicy": {"deniedPrefixes": ["modem-dev/tap", "voxtype"]},
            },
        ).stdout
    )
    fail_res = subprocess.run(
        ["/bin/bash", str(denied_script)],
        env={**env, "BREW_FAIL": "1"},
        text=True,
        capture_output=True,
    )
    assert fail_res.returncode == 42, fail_res.returncode
    assert not pathlib.Path(brewfile_path_record.read_text()).exists(), "temp Brewfile leaked on failure"
    assert brewfile_copy.read_text().splitlines() == ['cask "ghostty"']

    # Missing brew fails clearly
    empty_bin = temp / "no-brew-bin"
    make_network_blocked_bin(empty_bin)
    missing_brew = subprocess.run(
        ["/bin/bash", str(script)],
        env={**env, "PATH": str(empty_bin)},
        text=True,
        capture_output=True,
    )
    assert missing_brew.returncode != 0
    assert "brew not found" in missing_brew.stderr, missing_brew.stderr


def test_bun_upgrade_installs_latest_for_all_allowed_packages_and_skips_when_empty():
    catalog = {
        "machineRolePolicy": {
            "required": ["base"],
            "platforms": {"linux": ["base", "gaming"], "darwin": ["base"]},
        },
        "packages": {
            "prettier": {"role": "base", "install": {"darwin": {"bun": "prettier"}, "linux": {"bun": "prettier"}}},
            "hunkdiff": {"role": "base", "install": {"darwin": {"bun": "hunkdiff"}, "linux": {"bun": "hunkdiff"}}},
        },
        "packageRemovals": {"linux": {"apt": []}},
    }
    iso = make_isolated_source("bun-src", catalog)
    script = temp / "bun-upgrade.sh"
    script.write_text(
        render(iso, {"chezmoi": {"os": "darwin"}, "machineRoles": ["base"], "upgradePackages": True}).stdout
    )
    assert "declare -A" not in script.read_text()
    subprocess.run(["/bin/bash", "-n", str(script)], check=True)

    bun_home = temp / "bun-home"
    (bun_home / "bin").mkdir(parents=True)
    bun_log = temp / "bun.log"
    fake_bun = bun_home / "bin/bun"
    fake_bun.write_text(
        '#!/usr/bin/env bash\n'
        'set -euo pipefail\n'
        'printf "%s\\n" "$*" >>"$BUN_LOG"\n'
    )
    fake_bun.chmod(0o755)
    fake_bin = temp / "bun-net-block"
    make_network_blocked_bin(fake_bin)

    subprocess.run(
        ["/bin/bash", str(script)],
        env={
            **os.environ,
            "BUN_INSTALL": str(bun_home),
            "BUN_LOG": str(bun_log),
            "PATH": f"{fake_bin}:/usr/bin:/bin",
            "HOME": str(temp / "bun-user-home"),
        },
        check=True,
    )
    assert bun_log.read_text().splitlines() == ["add --global hunkdiff@latest prettier@latest"]

    # Empty bun plan does not require bun on PATH
    empty_bun_script = temp / "bun-empty.sh"
    empty_bun_script.write_text(
        render(
            iso,
            {
                "chezmoi": {"os": "darwin"},
                "machineRoles": ["base"],
                "upgradePackages": True,
                "packagePolicy": {"deniedPrefixes": ["prettier", "hunkdiff"]},
            },
        ).stdout
    )
    subprocess.run(
        ["/bin/bash", str(empty_bun_script)],
        env={**os.environ, "BUN_INSTALL": str(temp / "nonexistent-bun"), "PATH": f"{fake_bin}:/usr/bin:/bin"},
        check=True,
    )


def test_linux_upgrade_upgrades_only_installed_declared_apt_packages():
    catalog = {
        "machineRolePolicy": {
            "required": ["base"],
            "platforms": {"linux": ["base", "gaming"], "darwin": ["base"]},
        },
        "packages": {
            "editor": {"role": "base", "install": {"linux": {"apt": ["neovim"]}}},
            "search": {"role": "base", "install": {"linux": {"apt": ["ripgrep"]}}},
        },
        "packageRemovals": {"linux": {"apt": ["lazygit"]}},
    }
    iso = make_isolated_source("linux-src", catalog)
    script = temp / "linux-upgrade.sh"
    script.write_text(
        render(iso, {"chezmoi": {"os": "linux"}, "machineRoles": ["base"], "upgradePackages": True}).stdout
    )
    subprocess.run(["/bin/bash", "-n", str(script)], check=True)

    fake_bin = temp / "linux-bin"
    make_network_blocked_bin(fake_bin)
    dpkg_state = temp / "dpkg-state"
    apt_effects = temp / "apt-effects"

    (fake_bin / "dpkg-query").write_text(
        '#!/usr/bin/env bash\n'
        'set -euo pipefail\n'
        'pkg=${!#}\n'
        'state=$(awk -v p="$pkg" \'$1 == p { print $2 }\' "$APT_DPKG_STATE")\n'
        'printf "install ok %s\\n" "${state:-not-installed}"\n'
    )
    (fake_bin / "apt-get").write_text(
        '#!/usr/bin/env bash\n'
        'set -euo pipefail\n'
        'printf "apt-get %s\\n" "$*" >>"$APT_EFFECTS"\n'
        'if [[ "${1:-}" == "--simulate" ]]; then\n'
        '  printf "%s\\n" "${APT_SIM_OUTPUT:-0 to remove}"\n'
        'fi\n'
    )
    (fake_bin / "sudo").write_text(
        '#!/usr/bin/env bash\n'
        'set -euo pipefail\n'
        'printf "sudo %s\\n" "$*" >>"$APT_EFFECTS"\n'
        '"$@"\n'
    )
    for tool in ("dpkg-query", "apt-get", "sudo"):
        (fake_bin / tool).chmod(0o755)

    # Case 1: neovim installed, ripgrep not-installed -> only neovim upgraded
    dpkg_state.write_text("neovim installed\nripgrep not-installed\n")
    apt_effects.write_text("")
    base_env = {
        **os.environ,
        "PATH": f"{fake_bin}:/usr/bin:/bin",
        "APT_DPKG_STATE": str(dpkg_state),
        "APT_EFFECTS": str(apt_effects),
    }
    subprocess.run(["/bin/bash", str(script)], env=base_env, check=True)
    assert apt_effects.read_text().splitlines() == [
        "sudo apt-get update",
        "apt-get update",
        "apt-get --simulate install --only-upgrade -- neovim",
        "sudo apt-get install --only-upgrade -y -- neovim",
        "apt-get install --only-upgrade -y -- neovim",
    ], apt_effects.read_text()

    # Case 2: zero installed packages -> zero sudo/apt-get calls
    dpkg_state.write_text("neovim not-installed\nripgrep not-installed\n")
    apt_effects.write_text("")
    subprocess.run(["/bin/bash", str(script)], env=base_env, check=True)
    assert apt_effects.read_text() == "", apt_effects.read_text()


def test_linux_upgrade_allows_multiarch_planned_removals_and_aborts_on_unexpected_removal():
    catalog = {
        "machineRolePolicy": {
            "required": ["base"],
            "platforms": {"linux": ["base", "gaming"], "darwin": ["base"]},
        },
        "packages": {"editor": {"role": "base", "install": {"linux": {"apt": ["neovim"]}}}},
        "packageRemovals": {"linux": {"apt": ["lazygit"]}},
    }
    iso = make_isolated_source("linux-removal-src", catalog)
    script = temp / "linux-removal-upgrade.sh"
    script.write_text(
        render(iso, {"chezmoi": {"os": "linux"}, "machineRoles": ["base"], "upgradePackages": True}).stdout
    )

    fake_bin = temp / "linux-bin"
    dpkg_state = temp / "dpkg-state"
    apt_effects = temp / "apt-effects"
    dpkg_state.write_text("neovim installed\n")
    base_env = {
        **os.environ,
        "PATH": f"{fake_bin}:/usr/bin:/bin",
        "APT_DPKG_STATE": str(dpkg_state),
        "APT_EFFECTS": str(apt_effects),
    }

    # Allowed multiarch removal (lazygit:amd64 matches lazygit in packageRemovals)
    apt_effects.write_text("")
    subprocess.run(
        ["/bin/bash", str(script)],
        env={**base_env, "APT_SIM_OUTPUT": "Remv lazygit:amd64 [1.0]\n1 to remove"},
        check=True,
    )
    assert "sudo apt-get install --only-upgrade -y -- neovim" in apt_effects.read_text().splitlines()

    # Unexpected multiarch removal aborts before sudo apt-get install
    apt_effects.write_text("")
    res = subprocess.run(
        ["/bin/bash", str(script)],
        env={**base_env, "APT_SIM_OUTPUT": "Remv critical-pkg:amd64 [1.0]\n1 to remove"},
        text=True,
        capture_output=True,
    )
    assert res.returncode != 0
    assert "sudo apt-get install --only-upgrade -y -- neovim" not in apt_effects.read_text().splitlines()
    assert "unexpected removals: critical-pkg:amd64" in res.stderr, res.stderr


def _alias(name):
    res = subprocess.run(
        ["/bin/bash", "-c", f'shopt -s expand_aliases; . "$1"; alias {name}', "--", str(source / "dot_bash_aliases")],
        text=True,
        capture_output=True,
    )
    assert res.returncode == 0, res.stderr
    return res.stdout.strip()


def test_bash_aliases_cza_keeps_applying_configs_after_script_failure():
    assert _alias("cza") == "alias cza='chezmoi apply --force --keep-going'", _alias("cza")


def test_bash_aliases_czau_upgrades_and_keeps_applying_configs_after_script_failure():
    assert _alias("czau") == (
        """alias czau='chezmoi apply --force --keep-going --override-data '\\''{"upgradePackages":true}'\\'''"""
    ), _alias("czau")


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
