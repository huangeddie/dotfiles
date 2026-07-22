# Strict apt Package Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit apt installation declarations and durable removal tombstones, guard against unexpectedly broad apt transactions, and automatically purge apt-calculated orphan dependencies.

**Architecture:** The chezmoi package data becomes two sets, `packages.linux.apt.install` and `packages.linux.apt.remove`. The existing Linux `run_onchange` template remains the composition root around apt and dpkg effects; focused Bash functions validate the sets and fail closed while parsing apt-get simulations before installation or explicit purge. Verification uses real apt transactions on the Ubuntu host with temporary fixture package declarations and guarded cleanup.

**Tech Stack:** chezmoi Go templates, YAML, Bash, `apt-get`, `apt-cache`, `apt-mark`, `dpkg-query`

## Global Constraints

- `install` is the desired apt package set; `remove` is a durable tombstone set.
- Reject a package present in both sets before changing package state.
- Mark every installed desired package manual, including packages that arrived earlier as automatic dependencies.
- Purge installed and residual-config tombstones; treat fully absent tombstones as successful no-ops.
- Reject install or explicit-purge simulations that remove packages outside the tombstone set.
- Run `apt-get autoremove --purge` automatically after successful synchronization and trust apt's orphan calculation.
- Preserve the existing warning-and-skip behavior for unavailable desired packages.
- Keep the script as `run_onchange`; tombstones are not continuously enforced between script runs.
- Do not add fake package-manager tests. Verification is manual host QA with real apt effects and must not enter hooks or CI.
- Keep non-apt television, zoxide, and herdr installation behavior unchanged.
- Keep the Track A schema commit local until the Track B implementation and host QA are complete.

## File structure

- Modify `.chezmoidata/packages.yaml` — define the normalized apt install/remove schema and retain every existing desired package.
- Modify `run_onchange_before_linux-install-packages.sh.tmpl` — validate declarations, synchronize installations, guard explicit removals, mark desired roots manual, and autoremove apt orphans.
- Reference `docs/superpowers/specs/2026-07-21-strict-apt-package-management-design.md` — approved behavior and host-QA contract; do not modify during implementation.

---

### Task 1: Migrate the apt manifest contract (Track A)

**Files:**
- Modify: `.chezmoidata/packages.yaml:1-73`

**Interfaces:**
- Consumes: existing `.packages.linux.apt` package sequence.
- Produces: `.packages.linux.apt.install []string` and `.packages.linux.apt.remove []string` for the Linux template.

This is a data-schema migration and therefore uses the project's TDD exception. The host QA in Task 2 verifies the schema through the production template.

- [ ] **Step 1: Replace the Linux apt schema and update its authority comment**

Keep the Darwin data unchanged. Replace the top-level Linux comment and `linux` section so the relevant content is exactly:

```yaml
# Declarative package manifest.
#
# On darwin this list is AUTHORITATIVE: `chezmoi apply` runs `brew bundle`
# with --cleanup --force, so any Homebrew package NOT listed here is
# uninstalled. Adding a package here installs it; removing it uninstalls it.
# Dependencies of listed packages are retained automatically.
#
# On linux, apt.install declares desired packages and apt.remove contains
# durable removal tombstones. Move a retired package from install to remove;
# packages absent from both lists are left untouched. Apt-calculated orphan
# dependencies are purged automatically.
#
# Unversioned formulae (python, zig) intentionally track the latest stable
# release rather than pinning a version.
```

```yaml
  linux:
    apt:
      install:
        [
          "neovim",
          "golang-go",
          "fd-find",
          "fzf",
          "git",
          "lazygit",
          "gh",
          "git-delta",
          "curl",
          "nodejs",
          "npm",
          "btop",
          "nvtop",
          "bat",
          "ghostty",
        ]
      remove: []
```

- [ ] **Step 2: Verify the rendered data contract**

Run:

```bash
chezmoi execute-template '{{ .packages.linux.apt | toJson }}'
```

Expected: one JSON object containing an `install` array with all 15 former apt entries and an empty `remove` array. The old flat array must not appear.

Run:

```bash
git diff --check
git diff -- .chezmoidata/packages.yaml
```

Expected: no whitespace errors; the diff moves every former apt entry under `install`, adds `remove: []`, and does not alter Darwin package values.

- [ ] **Step 3: Commit the Track A schema separately**

```bash
git add .chezmoidata/packages.yaml
git commit -m "feat(packages): define apt install and remove sets"
```

Expected: a Conventional Commit containing only `.chezmoidata/packages.yaml`. Do not publish or share this intermediate commit before Task 2 is green.

---

### Task 2: Implement guarded apt synchronization and verify it on the host (Track B)

**Files:**
- Modify: `run_onchange_before_linux-install-packages.sh.tmpl:1-58`

**Interfaces:**
- Consumes: `.packages.linux.apt.install []string`, `.packages.linux.apt.remove []string`, `apt-get`, `apt-cache`, `apt-mark`, `dpkg-query`, and `sudo`.
- Produces:
  - `validate_package_sets() -> exit status` — rejects empty names and install/remove overlap.
  - `query_dpkg_state(package) -> stdout/status` — emits dpkg's three-word state for a known package.
  - `is_installed(package) -> exit status` — true only for dpkg state `installed`.
  - `is_purgeable(package) -> exit status` — true for dpkg states `installed` or `config-files`.
  - `simulate_apt(result_variable, operation, apt arguments...) -> exit status` — captures a successful `LC_ALL=C apt-get --simulate` plan or reports the failed plan.
  - `assert_safe_removal_plan(operation, simulation_output, allowed_removals...) -> exit status` — validates apt's summary/action format and rejects removals outside the allowed set.
  - `sync_apt_packages() -> exit status` — performs the approved synchronization flow.

This shell/config change follows the project's TDD exception and the user's explicit decision to avoid fake apt tests. Complete the real host QA before committing Track B.

- [ ] **Step 1: Replace the Linux package template with the guarded implementation**

Replace `run_onchange_before_linux-install-packages.sh.tmpl` with:

```bash
{{- if eq .chezmoi.os "linux" -}}
#!/bin/bash
set -euo pipefail

apt_install_packages=(
{{- range .packages.linux.apt.install }}
  {{ . | quote }}
{{- end }}
)

apt_remove_packages=(
{{- range .packages.linux.apt.remove }}
  {{ . | quote }}
{{- end }}
)

validate_package_sets() {
  local package
  local -a overlap=()
  declare -A install_set=()

  for package in "${apt_install_packages[@]}" "${apt_remove_packages[@]}"; do
    if [[ -z "$package" ]]; then
      echo "apt package declarations must not be empty" >&2
      return 1
    fi
  done

  for package in "${apt_install_packages[@]}"; do
    install_set["$package"]=1
  done

  for package in "${apt_remove_packages[@]}"; do
    if [[ -n "${install_set[$package]+present}" ]]; then
      overlap+=("$package")
    fi
  done

  if (( ${#overlap[@]} > 0 )); then
    echo "apt package manifest conflict; packages cannot be installed and removed:" >&2
    printf '  %s\n' "${overlap[@]}" >&2
    return 1
  fi
}

query_dpkg_state() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null
}

is_installed() {
  local raw_state want error state
  raw_state=$(query_dpkg_state "$1") || return 1
  read -r want error state <<<"$raw_state"
  [[ "$state" == "installed" ]]
}

is_purgeable() {
  local raw_state want error state
  raw_state=$(query_dpkg_state "$1") || return 1
  read -r want error state <<<"$raw_state"
  [[ "$state" == "installed" || "$state" == "config-files" ]]
}

simulate_apt() {
  local result_variable=$1
  local operation=$2
  local output
  shift 2

  if ! output=$(LC_ALL=C apt-get --simulate "$@" 2>&1); then
    echo "apt $operation simulation failed:" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi

  printf -v "$result_variable" '%s' "$output"
}

assert_safe_removal_plan() {
  local operation=$1
  local output=$2
  local package summary removal_count
  local -a planned=()
  local -a unexpected=()
  shift 2
  declare -A allowed=()

  for package in "$@"; do
    allowed["$package"]=1
  done

  summary=$(grep -Eo '[0-9]+ to remove' <<<"$output" | tail -n 1 || true)
  if [[ -z "$summary" ]]; then
    echo "cannot validate apt $operation simulation; removal summary not recognized:" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi
  removal_count=${summary%% *}

  mapfile -t planned < <(
    awk '$1 == "Remv" || $1 == "Purg" { print $2 }' <<<"$output"
  )

  if (( ${#planned[@]} != removal_count )); then
    echo "cannot validate apt $operation simulation; expected $removal_count removal actions but parsed ${#planned[@]}:" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi

  for package in "${planned[@]}"; do
    if [[ -z "${allowed[$package]+present}" ]]; then
      unexpected+=("$package")
    fi
  done

  if (( ${#unexpected[@]} > 0 )); then
    echo "apt $operation simulation proposed removals outside apt.remove" >&2
    echo "allowed removals: ${*:-<none>}" >&2
    echo "planned removals: ${planned[*]}" >&2
    echo "unexpected removals: ${unexpected[*]}" >&2
    return 1
  fi
}

sync_apt_packages() {
  local package apt_install_plan apt_purge_plan
  local -a missing_packages=()
  local -a available_packages=()
  local -a installed_desired_packages=()
  local -a purge_packages=()

  validate_package_sets

  for package in "${apt_install_packages[@]}"; do
    if ! is_installed "$package"; then
      missing_packages+=("$package")
    fi
  done

  if (( ${#missing_packages[@]} > 0 )); then
    sudo apt-get update

    for package in "${missing_packages[@]}"; do
      if apt-cache show "$package" >/dev/null 2>&1; then
        available_packages+=("$package")
      else
        echo "⚠️ Warning: Package '$package' is not available in apt cache. Skipping." >&2
      fi
    done
  fi

  if (( ${#available_packages[@]} > 0 )); then
    echo "==> Simulating apt package installation: ${available_packages[*]}"
    simulate_apt apt_install_plan "install" install -- "${available_packages[@]}"
    assert_safe_removal_plan "install" "$apt_install_plan" "${apt_remove_packages[@]}"

    echo "==> Installing apt packages: ${available_packages[*]}"
    sudo apt-get install -y -- "${available_packages[@]}"
  fi

  for package in "${apt_install_packages[@]}"; do
    if is_installed "$package"; then
      installed_desired_packages+=("$package")
    fi
  done

  if (( ${#installed_desired_packages[@]} > 0 )); then
    echo "==> Marking desired apt packages manual: ${installed_desired_packages[*]}"
    sudo apt-mark manual "${installed_desired_packages[@]}"
  fi

  for package in "${apt_remove_packages[@]}"; do
    if is_purgeable "$package"; then
      purge_packages+=("$package")
    fi
  done

  if (( ${#purge_packages[@]} > 0 )); then
    echo "==> Simulating apt package purge: ${purge_packages[*]}"
    simulate_apt apt_purge_plan "purge" purge -- "${purge_packages[@]}"
    assert_safe_removal_plan "purge" "$apt_purge_plan" "${apt_remove_packages[@]}"

    echo "==> Purging apt packages: ${purge_packages[*]}"
    sudo apt-get purge -y -- "${purge_packages[@]}"
  fi

  echo "==> Purging automatically installed orphan packages"
  sudo apt-get autoremove --purge -y
}

if ! command -v apt-get >/dev/null 2>&1; then
  if (( ${#apt_install_packages[@]} > 0 || ${#apt_remove_packages[@]} > 0 )); then
    echo "apt-get not found; skipping apt package synchronization" >&2
  fi
else
  sync_apt_packages
fi

# television
if ! command -v tv >/dev/null 2>&1; then
  echo "🚀 Installing television..."
  curl -fsSL https://alexpasmantier.github.io/television/install.sh | bash
fi

# zoxide
if ! command -v zoxide >/dev/null 2>&1; then
  echo "🚀 Installing zoxide..."
  curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh
fi

# herdr
if ! command -v herdr >/dev/null 2>&1; then
  echo "🚀 Installing herdr..."
  curl -fsSL https://herdr.dev/install.sh | sh
fi

{{- end }}
```

- [ ] **Step 2: Verify template rendering and Bash syntax without package mutation**

Run:

```bash
rendered_script=$(mktemp)
chezmoi execute-template -f "$PWD/run_onchange_before_linux-install-packages.sh.tmpl" >"$rendered_script"
bash -n "$rendered_script"
rg -n 'apt_install_packages|apt_remove_packages|autoremove --purge' "$rendered_script"
rm -f "$rendered_script"
git diff --check
```

Expected: `bash -n` exits 0; the rendered script contains both arrays and `sudo apt-get autoremove --purge -y`; `git diff --check` prints nothing.

- [ ] **Step 3: Run the real host QA preflight and transaction sequence**

The following QA intentionally performs real root package operations. Run it manually from the repository root when no other apt/dpkg process is active. It aborts before mutation if the known fixture packages are present, non-apt installers are missing, or apt already has unrelated orphans.

Create and run the temporary QA harness:

```bash
qa_script=$(mktemp)
cat >"$qa_script" <<'QA'
#!/bin/bash
set -euo pipefail

repository=$1
fixtures=(fortune-mod fortunes-min librecode3)
qa_root=$(mktemp -d)
qa_source="$qa_root/source"
rendered="$qa_root/linux-packages.sh"
cp -a "$repository/." "$qa_source"

package_known() {
  dpkg-query -W -f='${Status}' "$1" >/dev/null 2>&1
}

assert_installed() {
  local status want error state
  status=$(dpkg-query -W -f='${Status}' "$1")
  read -r want error state <<<"$status"
  [[ "$state" == "installed" ]]
}

assert_absent() {
  ! package_known "$1"
}

assert_no_apt_orphans() {
  local output
  output=$(LC_ALL=C apt-get --simulate autoremove --purge 2>&1)
  grep -Eq '[0-9]+ to remove' <<<"$output"
  if grep -Eq '^(Remv|Purg) ' <<<"$output"; then
    echo "QA requires zero pre-existing apt orphans:" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi
}

write_manifest() {
  local install_package=$1
  local remove_package=$2
  local install_yaml='[]'
  local remove_yaml='[]'

  if [[ -n "$install_package" ]]; then
    install_yaml="[\"$install_package\"]"
  fi
  if [[ -n "$remove_package" ]]; then
    remove_yaml="[\"$remove_package\"]"
  fi

  cat >"$qa_source/.chezmoidata/packages.yaml" <<YAML
packages:
  linux:
    apt:
      install: $install_yaml
      remove: $remove_yaml
YAML
}

render_sync() {
  chezmoi -S "$qa_source" execute-template -f \
    "$qa_source/run_onchange_before_linux-install-packages.sh.tmpl" >"$rendered"
  bash -n "$rendered"
}

safe_fixture_cleanup() {
  local output package
  local -a unexpected=()
  declare -A allowed=(
    [fortune-mod]=1
    [fortunes-min]=1
    [librecode3]=1
  )

  if ! output=$(LC_ALL=C apt-get --simulate purge -- "${fixtures[@]}" 2>&1); then
    echo "QA cleanup simulation failed; inspect fixture packages manually:" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi

  while read -r package; do
    if [[ -z "${allowed[$package]+present}" ]]; then
      unexpected+=("$package")
    fi
  done < <(awk '$1 == "Remv" || $1 == "Purg" { print $2 }' <<<"$output")

  if (( ${#unexpected[@]} > 0 )); then
    echo "QA cleanup refused unexpected removals: ${unexpected[*]}" >&2
    return 1
  fi

  sudo apt-get purge -y -- "${fixtures[@]}"
}

cleanup() {
  local status=$?
  trap - EXIT
  set +e

  if package_known fortune-mod || package_known fortunes-min || package_known librecode3; then
    safe_fixture_cleanup
    if (( $? != 0 )); then
      echo "QA left fixture state for manual inspection" >&2
      status=1
    fi
  fi

  rm -rf "$qa_root"
  exit "$status"
}
trap cleanup EXIT

for command in tv zoxide herdr; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "QA refuses to trigger unrelated installer for missing command: $command" >&2
    exit 1
  }
done

for package in "${fixtures[@]}"; do
  if package_known "$package"; then
    echo "QA fixture package already has dpkg state: $package" >&2
    exit 1
  fi
  apt-cache show "$package" >/dev/null 2>&1 || {
    echo "QA fixture package is unavailable: $package" >&2
    exit 1
  }
done
assert_no_apt_orphans

echo "==> QA phase 1: install fortune-mod and automatic dependencies"
write_manifest fortune-mod ""
render_sync
bash "$rendered"
assert_installed fortune-mod
assert_installed fortunes-min
assert_installed librecode3
apt-mark showmanual | grep -Fx fortune-mod >/dev/null
apt-mark showauto | grep -Fx fortunes-min >/dev/null
apt-mark showauto | grep -Fx librecode3 >/dev/null

echo "==> QA phase 2: reject purging a required shared dependency"
write_manifest fortune-mod librecode3
render_sync
set +e
unsafe_output=$(bash "$rendered" 2>&1)
unsafe_status=$?
set -e
printf '%s\n' "$unsafe_output"
if (( unsafe_status == 0 )); then
  echo "unsafe purge unexpectedly succeeded" >&2
  exit 1
fi
grep -Eq 'simulation failed|unexpected removals' <<<"$unsafe_output"
assert_installed fortune-mod
assert_installed librecode3

echo "==> QA phase 3: tombstone fortune-mod and autoremove its dependencies"
write_manifest "" fortune-mod
render_sync
bash "$rendered"
for package in "${fixtures[@]}"; do
  assert_absent "$package"
done
assert_no_apt_orphans

echo "Host apt QA passed"
QA
chmod +x "$qa_script"
"$qa_script" "$PWD"
qa_status=$?
rm -f "$qa_script"
exit "$qa_status"
```

Expected output includes all three QA phase headings and ends with:

```text
Host apt QA passed
```

Expected final host state:

```bash
for package in fortune-mod fortunes-min librecode3; do
  ! dpkg-query -W "$package" >/dev/null 2>&1
done
LC_ALL=C apt-get --simulate autoremove --purge 2>&1 | grep '0 to remove'
```

Both commands exit 0. If QA fails and cleanup reports retained fixture state, stop and show the user the simulation output before making any manual package changes.

- [ ] **Step 4: Apply the source state and verify the production manifest**

Run:

```bash
chezmoi apply
chezmoi status
git diff --check
git status --short
```

Expected:

- `chezmoi apply` completes the production apt synchronization, marks desired packages manual, and reports no orphan removals beyond apt's approved plan.
- `chezmoi status` prints no target drift.
- `git diff --check` prints nothing.
- `git status --short` lists only `run_onchange_before_linux-install-packages.sh.tmpl` as modified relative to the Track A commit.

If sudo requires an interactive credential, obtain it from the user rather than bypassing or weakening package operations.

- [ ] **Step 5: Commit the Track B implementation separately**

```bash
git add run_onchange_before_linux-install-packages.sh.tmpl
git commit -m "feat(packages): synchronize apt removals safely"
```

Expected: a Conventional Commit containing only the Linux package template.

- [ ] **Step 6: Verify the complete local RED-GREEN pair**

Run:

```bash
git show --stat --oneline HEAD~1
git show --stat --oneline HEAD
git status --short --branch
chezmoi execute-template '{{ .packages.linux.apt | toJson }}'
rendered_script=$(mktemp)
chezmoi execute-template -f "$PWD/run_onchange_before_linux-install-packages.sh.tmpl" >"$rendered_script"
bash -n "$rendered_script"
rm -f "$rendered_script"
```

Expected:

- `HEAD~1` is `feat(packages): define apt install and remove sets` and changes only `.chezmoidata/packages.yaml`.
- `HEAD` is `feat(packages): synchronize apt removals safely` and changes only the Linux template.
- The branch is clean.
- The data renders with `install` and `remove` arrays.
- The final Linux package script passes Bash syntax validation.

Do not publish the Track A commit without the succeeding green Track B commit.
