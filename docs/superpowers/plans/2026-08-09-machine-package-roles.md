# Machine Package Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision cross-platform `base` and Linux-only `gaming` package roles while allowing a downstream composition root to deny package prefixes safely.

**Architecture:** Machine-local `machineRoles` selects role-owned package lists from the shared manifest. A shared render-time validator enforces the role and package-policy contracts before platform installers flatten their selected lists; apt, Homebrew, and Bun reconcile inactive or denied packages, while custom installers remain install-only. Direct initialization generates valid local data, and an internal work repository can provide the same consumer contract before applying this repository as a submodule.

**Tech Stack:** chezmoi Go templates, YAML and TOML data, Bash, Python 3 `tomllib`/`json`, fake apt/Homebrew/Bun command adapters.

## Global Constraints

- Work directly on `main`; do not create a branch or worktree.
- `machineRoles` is required, non-empty, unique, and must contain `base` exactly once.
- Linux supports `base` and `gaming`; Darwin supports `base` only.
- `base` owns every current package except `steam-installer` and `steam-devices`; `gaming` owns those two apt packages.
- New policy uses `packagePolicy.deniedPrefixes`; deprecated `blocked_prefixes` remains supported, and effective denial is their unique union.
- Denial takes precedence over role selection.
- Apt purges inactive-role, denied, and tombstoned managed packages only after a safe simulation.
- Homebrew and Bun remain authoritative; custom installers do not claim automatic uninstallation.
- Retired Linux apt packages must move to `packages.linux.apt.remove`; never delete them from the complete managed catalog without a tombstone.
- Automated tests must be fast, deterministic, network-free, and use practical fakes rather than mocks.
- Shell tests have no expected-failure mechanism. Keep the Track A RED commit and all subsequent partial GREEN commits local; do not publish or share until the full suite is GREEN.
- Track A contains schemas, template interfaces, and tests. Track B commits contain concrete template and reconciliation implementations.
- README prose must follow the `plain-explain` skill and document the downstream consumer contract without requiring readers to inspect templates.

---

## File Structure

| Path | Responsibility |
|---|---|
| `.chezmoidata/packages.yaml` | Role policy and normalized role-owned package declarations. |
| `.chezmoi.toml.tmpl` | Direct-init composition root that emits `machineRoles` and empty package policy. |
| `.chezmoitemplates/validate-machine-package-data.tmpl` | Shared render-time validation for roles and new/legacy denial fields. |
| `.chezmoitemplates/install-custom-packages.sh.tmpl` | Validate and install selected, non-denied custom installer records. |
| `run_onchange_before_linux-install-packages.sh.tmpl` | Resolve Linux apt/custom role state and safely reconcile apt. |
| `run_onchange_before_darwin-install-packages.sh.tmpl` | Resolve Darwin role state into an authoritative Brewfile and custom installers. |
| `run_onchange_after_install-bun-global-packages.sh.tmpl` | Resolve role-owned Bun globals and reconcile the authoritative global set. |
| `tests/machine-package-roles.test.sh` | Config generation, role validation, and policy-schema contract tests. |
| `tests/linux-install-packages-template.test.sh` | Linux role selection, denial precedence, tombstones, and purge rendering. |
| `tests/darwin-install-packages-template.test.sh` | Darwin role selection, denial precedence, strict cleanup, and trust rendering. |
| `tests/custom-package-installers.test.sh` | Nested custom schema and denied custom installer behavior. |
| `tests/bun-package-management.test.sh` | Role-selected and denied Bun global reconciliation. |
| `README.md` | Human/agent usage, direct-init behavior, role transitions, and work-repository migration. |

---

### Task 1: Define Role and Policy Contracts in RED

**Files:**
- Modify: `.chezmoidata/packages.yaml`
- Create: `.chezmoi.toml.tmpl`
- Create: `.chezmoitemplates/validate-machine-package-data.tmpl`
- Create: `tests/machine-package-roles.test.sh`
- Modify: `tests/linux-install-packages-template.test.sh`
- Modify: `tests/darwin-install-packages-template.test.sh`
- Modify: `tests/custom-package-installers.test.sh`
- Modify: `tests/bun-package-management.test.sh`

**Interfaces:**
- Produces: `.machineRolePolicy.required: list<string>` and `.machineRolePolicy.platforms: map<string, list<string>>`.
- Produces: local `.machineRoles: list<string>`.
- Produces: optional `.packagePolicy.deniedPrefixes: list<string>` plus deprecated `.blocked_prefixes: list<string>`.
- Produces: package lists at `.packages.<manager>.<category>.roles.<role>` and Linux tombstones at `.packages.linux.apt.remove`.
- Produces stub template call `{{ template "validate-machine-package-data.tmpl" . }}`; Task 2 replaces the stub body.

- [ ] **Step 1: Rewrite the manifest into the approved role schema**

Use this complete package layout; preserve comments about authoritative cleanup, tombstones, trust, and unversioned tools next to their new owners:

```yaml
machineRolePolicy:
  required: ["base"]
  platforms:
    linux: ["base", "gaming"]
    darwin: ["base"]

packages:
  bun:
    global:
      roles:
        base:
          [
            "prettier",
            "@earendil-works/pi-coding-agent",
            "hunkdiff",
          ]
  darwin:
    custom:
      roles:
        base: []
    taps:
      roles:
        base: ["modem-dev/tap"]
    trusted_formulae:
      roles:
        base: ["modem-dev/tap/hunk"]
    brews:
      roles:
        base:
          [
            "gmp",
            "libyaml",
            "openssl@3",
            "bat",
            "bun",
            "chezmoi",
            "cloudflared",
            "fd",
            "ffmpeg",
            "fzf",
            "gh",
            "git-delta",
            "herdr",
            "jj",
            "jjui",
            "lazygit",
            "mise",
            "modem-dev/tap/hunk",
            "neovim",
            "python",
            "rust-analyzer",
            "stylua",
            "swiftformat",
            "television",
            "universal-ctags",
            "zig",
            "zoxide",
          ]
    casks:
      roles:
        base:
          [
            "codex",
            "font-jetbrains-mono-nerd-font",
            "gcloud-cli",
            "ghostty",
          ]
  linux:
    custom:
      roles:
        base:
          - name: television
            executable: tv
            install: |-
              curl -fsSL https://alexpasmantier.github.io/television/install.sh | bash
          - name: zoxide
            executable: zoxide
            install: |-
              curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh
          - name: herdr
            executable: herdr
            install: |-
              curl -fsSL https://herdr.dev/install.sh | sh
          - name: tailscale
            executable: tailscale
            install: |-
              curl -fsSL https://tailscale.com/install.sh | sh
          - name: bun
            executable: bun
            setup: |-
              export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
              export PATH="$BUN_INSTALL/bin:$PATH"
            install: |-
              curl -fsSL https://bun.com/install | bash
    apt:
      roles:
        base:
          [
            "neovim",
            "ripgrep",
            "golang-go",
            "fd-find",
            "fzf",
            "git",
            "lazygit",
            "gh",
            "git-delta",
            "curl",
            "openssh-server",
            "ffmpeg",
            "nodejs",
            "npm",
            "btop",
            "nvtop",
            "bat",
            "ghostty",
          ]
        gaming:
          [
            "steam-installer",
            "steam-devices",
          ]
      remove: []
```

- [ ] **Step 2: Add compiling interface stubs**

Create `.chezmoi.toml.tmpl` containing only:

```gotemplate
{{ fail "machine role config generation is not implemented" }}
```

Create `.chezmoitemplates/validate-machine-package-data.tmpl` containing only:

```gotemplate
{{ fail "machine package data validation is not implemented" }}
```

These are contract stubs, not implementation logic.

- [ ] **Step 3: Add the machine role contract test**

Create `tests/machine-package-roles.test.sh` with a temporary directory and these reusable render helpers:

```bash
#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

render_validator() {
  local case_name=$1
  local override=$2
  local wrapper="$test_root/$case_name.tmpl"
  printf '%s\n' '{{ template "validate-machine-package-data.tmpl" . }}' >"$wrapper"
  chezmoi --source "$source_dir" --override-data "$override" \
    execute-template -f "$wrapper"
}

assert_validation_failure() {
  local case_name=$1
  local override=$2
  local diagnostic=$3
  if render_validator "$case_name" "$override" \
    >"$test_root/$case_name.out" 2>"$test_root/$case_name.err"; then
    echo "accepted invalid machine package data: $case_name" >&2
    exit 1
  fi
  grep -Fq "$diagnostic" "$test_root/$case_name.err"
}
```

Exercise the complete role and policy matrix with these calls:

```bash
render_validator linux-base \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"]}' >/dev/null
render_validator linux-gaming \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base","gaming"]}' >/dev/null
render_validator darwin-base \
  '{"chezmoi":{"os":"darwin"},"machineRoles":["base"]}' >/dev/null

assert_validation_failure missing-roles \
  '{"chezmoi":{"os":"linux"}}' \
  'machineRoles must be a non-empty list of roles'
assert_validation_failure empty-roles \
  '{"chezmoi":{"os":"linux"},"machineRoles":[]}' \
  'machineRoles must be a non-empty list of roles'
assert_validation_failure duplicate-role \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base","base"]}' \
  'machineRoles contains duplicate role "base"'
assert_validation_failure unknown-role \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base","work"]}' \
  'machine role "work" is not supported on linux'
assert_validation_failure missing-base \
  '{"chezmoi":{"os":"linux"},"machineRoles":["gaming"]}' \
  'machineRoles must include required role "base"'
assert_validation_failure darwin-gaming \
  '{"chezmoi":{"os":"darwin"},"machineRoles":["base","gaming"]}' \
  'machine role "gaming" is not supported on darwin'
assert_validation_failure scalar-policy \
  '{"machineRoles":["base"],"packagePolicy":"deny"}' \
  'packagePolicy must be a map'
assert_validation_failure empty-new-prefix \
  '{"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":[""]}}' \
  'packagePolicy.deniedPrefixes[0] must be a non-empty string'
assert_validation_failure duplicate-new-prefix \
  '{"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["steam","steam"]}}' \
  'packagePolicy.deniedPrefixes contains duplicate prefix "steam"'
assert_validation_failure scalar-legacy-policy \
  '{"machineRoles":["base"],"blocked_prefixes":"steam"}' \
  'blocked_prefixes must be a list'
assert_validation_failure empty-legacy-prefix \
  '{"machineRoles":["base"],"blocked_prefixes":[""]}' \
  'blocked_prefixes[0] must be a non-empty string'
```

Render `.chezmoi.toml.tmpl` with these commands and parse each result with
Python `tomllib`:

```bash
chezmoi --source "$source_dir" \
  --override-data '{"chezmoi":{"os":"linux"}}' \
  execute-template --init \
  --promptBool 'Install gaming packages=true' \
  -f "$source_dir/.chezmoi.toml.tmpl" >"$test_root/linux-gaming.toml"

chezmoi --source "$source_dir" \
  --override-data '{"chezmoi":{"os":"linux"}}' \
  execute-template --init \
  --promptBool 'Install gaming packages=false' \
  -f "$source_dir/.chezmoi.toml.tmpl" >"$test_root/linux-base.toml"

chezmoi --source "$source_dir" \
  --override-data '{"chezmoi":{"os":"darwin"}}' \
  execute-template --init \
  -f "$source_dir/.chezmoi.toml.tmpl" >"$test_root/darwin-base.toml"
```

Assert exact data values:

```python
assert linux_gaming["data"]["machineRoles"] == ["base", "gaming"]
assert linux_base["data"]["machineRoles"] == ["base"]
assert darwin_base["data"]["machineRoles"] == ["base"]
for config in (linux_gaming, linux_base, darwin_base):
    assert config["data"]["packagePolicy"]["deniedPrefixes"] == []
```

Also render with existing `machineRoles`, new denials, and legacy denials in
override data. Assert initialization preserves the existing roles and emits the
unique deny-union under only `data.packagePolicy.deniedPrefixes`.

- [ ] **Step 4: Rewrite package tests against the role contract**

Every package-template render must pass explicit machine data. Use these
canonical overrides:

```bash
base_linux='{"machineRoles":["base"]}'
gaming_linux='{"machineRoles":["base","gaming"]}'
base_darwin='{"chezmoi":{"os":"darwin"},"machineRoles":["base"]}'
```

Update schema assertions to read nested role paths, including:

```python
assert packages["linux"]["apt"]["roles"]["gaming"] == [
    "steam-installer",
    "steam-devices",
]
assert "nvtop" in packages["linux"]["apt"]["roles"]["base"]
assert packages["bun"]["global"]["roles"]["base"] == [
    "prettier",
    "@earendil-works/pi-coding-agent",
    "hunkdiff",
]
```

Add assertions that:

- base-only Linux renders Steam in the apt purge array, not the install array;
- base-plus-gaming Linux renders Steam in the install array, not the purge array;
- new denial, legacy denial, and both fields together suppress installs and put
  managed apt packages in the purge array;
- Darwin base renders all current Brewfile declarations and Darwin gaming fails;
- new and legacy Darwin denials omit matching formulae/casks;
- custom schema lives under `packages.<os>.custom.roles.base` and both policy
  fields suppress matching installers;
- Bun base declares all three globals and policy denial removes a currently
  installed denied global.

Retain the existing practical fake package-manager tests and shell syntax
checks. Do not add network calls.

- [ ] **Step 5: Run the contract suite and verify RED**

Run:

```bash
for test_file in tests/*.test.sh; do
  echo "==> $test_file"
  bash "$test_file"
done
```

Expected: failures include `machine role config generation is not implemented`,
`machine package data validation is not implemented`, and old package templates
referencing paths removed by the new schema. The Bun test's former stale
`hunkdiff` assertion is now correct, but reconciliation remains RED.

- [ ] **Step 6: Commit Track A locally**

```bash
git add \
  .chezmoidata/packages.yaml \
  .chezmoi.toml.tmpl \
  .chezmoitemplates/validate-machine-package-data.tmpl \
  tests/machine-package-roles.test.sh \
  tests/linux-install-packages-template.test.sh \
  tests/darwin-install-packages-template.test.sh \
  tests/custom-package-installers.test.sh \
  tests/bun-package-management.test.sh
git commit -m "test: define machine package role contracts"
```

Do not push or share this RED commit.

---

### Task 2: Validate Roles and Generate Direct Configuration

**Files:**
- Modify: `.chezmoi.toml.tmpl`
- Modify: `.chezmoitemplates/validate-machine-package-data.tmpl`
- Test: `tests/machine-package-roles.test.sh`

**Interfaces:**
- Consumes: `.machineRolePolicy`, `.machineRoles`, optional `.packagePolicy.deniedPrefixes`, and optional `.blocked_prefixes`.
- Produces: render-time validation template `{{ template "validate-machine-package-data.tmpl" . }}` with no output on success and `fail` diagnostics on invalid data.
- Produces: generated TOML with `data.machineRoles: list<string>` and `data.packagePolicy.deniedPrefixes: list<string>`.

- [ ] **Step 1: Confirm the focused test is RED**

Run:

```bash
bash tests/machine-package-roles.test.sh
```

Expected: non-zero exit caused by one of the two interface stub diagnostics.

- [ ] **Step 2: Implement render-time validation**

Replace the validation stub with Go-template checks following this structure:

```gotemplate
{{- $root := . -}}
{{- $rolePolicy := get $root "machineRolePolicy" -}}
{{- if not (kindIs "map" $rolePolicy) -}}
  {{- fail "machineRolePolicy must be a map" -}}
{{- end -}}
{{- $requiredRoles := get $rolePolicy "required" -}}
{{- $platforms := get $rolePolicy "platforms" -}}
{{- if not (kindIs "slice" $requiredRoles) -}}
  {{- fail "machineRolePolicy.required must be a list" -}}
{{- end -}}
{{- if not (kindIs "map" $platforms) -}}
  {{- fail "machineRolePolicy.platforms must be a map" -}}
{{- end -}}
{{- $machineRoles := get $root "machineRoles" -}}
{{- if not (kindIs "slice" $machineRoles) -}}
  {{- fail "machineRoles must be a non-empty list of roles" -}}
{{- end -}}
{{- if eq (len $machineRoles) 0 -}}
  {{- fail "machineRoles must be a non-empty list of roles" -}}
{{- end -}}
{{- $platformRoles := get $platforms $root.chezmoi.os -}}
{{- if not (kindIs "slice" $platformRoles) -}}
  {{- fail (printf "package roles do not support operating system %q" $root.chezmoi.os) -}}
{{- end -}}
{{- $seenPlatformRoles := dict -}}
{{- range $index, $role := $platformRoles -}}
  {{- if or (not (kindIs "string" $role)) (empty ($role | trim)) -}}
    {{- fail (printf "machineRolePolicy.platforms.%s[%d] must be a non-empty string" $root.chezmoi.os $index) -}}
  {{- end -}}
  {{- if hasKey $seenPlatformRoles $role -}}
    {{- fail (printf "machineRolePolicy.platforms.%s contains duplicate role %q" $root.chezmoi.os $role) -}}
  {{- end -}}
  {{- $_ := set $seenPlatformRoles $role -}}
{{- end -}}
{{- $seenRoles := dict -}}
{{- range $index, $role := $machineRoles -}}
  {{- if or (not (kindIs "string" $role)) (empty ($role | trim)) -}}
    {{- fail (printf "machineRoles[%d] must be a non-empty string" $index) -}}
  {{- end -}}
  {{- if hasKey $seenRoles $role -}}
    {{- fail (printf "machineRoles contains duplicate role %q" $role) -}}
  {{- end -}}
  {{- $_ := set $seenRoles $role -}}
  {{- if not (has $role $platformRoles) -}}
    {{- fail (printf "machine role %q is not supported on %s; valid roles: %s" $role $root.chezmoi.os ($platformRoles | join ", ")) -}}
  {{- end -}}
{{- end -}}
{{- $seenRequiredRoles := dict -}}
{{- range $index, $requiredRole := $requiredRoles -}}
  {{- if or (not (kindIs "string" $requiredRole)) (empty ($requiredRole | trim)) -}}
    {{- fail (printf "machineRolePolicy.required[%d] must be a non-empty string" $index) -}}
  {{- end -}}
  {{- if hasKey $seenRequiredRoles $requiredRole -}}
    {{- fail (printf "machineRolePolicy.required contains duplicate role %q" $requiredRole) -}}
  {{- end -}}
  {{- $_ := set $seenRequiredRoles $requiredRole -}}
  {{- if not (has $requiredRole $platformRoles) -}}
    {{- fail (printf "required machine role %q is not supported on %s" $requiredRole $root.chezmoi.os) -}}
  {{- end -}}
  {{- if not (has $requiredRole $machineRoles) -}}
    {{- fail (printf "machineRoles must include required role %q" $requiredRole) -}}
  {{- end -}}
{{- end -}}

{{- $packagePolicy := get $root "packagePolicy" | default dict -}}
{{- if not (kindIs "map" $packagePolicy) -}}
  {{- fail "packagePolicy must be a map" -}}
{{- end -}}
{{- $newDenied := get $packagePolicy "deniedPrefixes" | default list -}}
{{- if not (kindIs "slice" $newDenied) -}}
  {{- fail "packagePolicy.deniedPrefixes must be a list" -}}
{{- end -}}
{{- $seenNewDenied := dict -}}
{{- range $index, $prefix := $newDenied -}}
  {{- if or (not (kindIs "string" $prefix)) (empty ($prefix | trim)) -}}
    {{- fail (printf "packagePolicy.deniedPrefixes[%d] must be a non-empty string" $index) -}}
  {{- end -}}
  {{- if hasKey $seenNewDenied $prefix -}}
    {{- fail (printf "packagePolicy.deniedPrefixes contains duplicate prefix %q" $prefix) -}}
  {{- end -}}
  {{- $_ := set $seenNewDenied $prefix -}}
{{- end -}}

{{- $legacyDenied := get $root "blocked_prefixes" | default list -}}
{{- if not (kindIs "slice" $legacyDenied) -}}
  {{- fail "blocked_prefixes must be a list" -}}
{{- end -}}
{{- $seenLegacyDenied := dict -}}
{{- range $index, $prefix := $legacyDenied -}}
  {{- if or (not (kindIs "string" $prefix)) (empty ($prefix | trim)) -}}
    {{- fail (printf "blocked_prefixes[%d] must be a non-empty string" $index) -}}
  {{- end -}}
  {{- if hasKey $seenLegacyDenied $prefix -}}
    {{- fail (printf "blocked_prefixes contains duplicate prefix %q" $prefix) -}}
  {{- end -}}
  {{- $_ := set $seenLegacyDenied $prefix -}}
{{- end -}}
```

Do not reject the same denied prefix appearing once in each policy field; the
resolver intentionally de-duplicates their union.

- [ ] **Step 3: Implement direct config generation**

Replace the config stub with logic that preserves existing roles, otherwise
starts with `base` and prompts only on Linux:

```gotemplate
{{- $roles := get . "machineRoles" | default list -}}
{{- if eq (len $roles) 0 -}}
  {{- $roles = list "base" -}}
  {{- if eq .chezmoi.os "linux" -}}
    {{- if promptBool "Install gaming packages" -}}
      {{- $roles = append $roles "gaming" -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
{{- $packagePolicy := get . "packagePolicy" | default dict -}}
{{- $newDenied := get $packagePolicy "deniedPrefixes" | default list -}}
{{- $legacyDenied := get . "blocked_prefixes" | default list -}}
{{- $denied := concat $newDenied $legacyDenied | uniq -}}

[data]
machineRoles = [
{{- range $roles }}
  {{ . | quote }},
{{- end }}
]

[data.packagePolicy]
deniedPrefixes = [
{{- range $denied }}
  {{ . | quote }},
{{- end }}
]
```

Use whitespace controls that still leave valid TOML newlines. Verify the actual
`promptBool` signature against the installed chezmoi with the test's simulated
`--promptBool` input rather than adding a second stored boolean.

- [ ] **Step 4: Run the focused test GREEN**

Run:

```bash
bash tests/machine-package-roles.test.sh
```

Expected: exit 0; all generated TOML parses and all invalid override cases fail
with their asserted diagnostics.

- [ ] **Step 5: Commit the shared implementation**

```bash
git add .chezmoi.toml.tmpl .chezmoitemplates/validate-machine-package-data.tmpl
git commit -m "feat: validate machine package roles"
```

The complete suite remains local and may remain RED until Tasks 3–5 finish.

---

### Task 3: Reconcile Linux Apt and Custom Packages

**Files:**
- Modify: `run_onchange_before_linux-install-packages.sh.tmpl`
- Modify: `.chezmoitemplates/install-custom-packages.sh.tmpl`
- Test: `tests/linux-install-packages-template.test.sh`
- Test: `tests/custom-package-installers.test.sh`

**Interfaces:**
- Consumes: `.packages.linux.apt.roles`, `.packages.linux.apt.remove`, `.packages.linux.custom.roles`, validated `.machineRoles`, and the new/legacy denial union.
- Produces: disjoint shell arrays `apt_install_packages` and `apt_remove_packages`.
- Produces: custom installer input `dict("custom" list "denied_prefixes" list)`; a plain list remains supported for isolated custom-template tests.

- [ ] **Step 1: Confirm Linux and custom tests are RED**

Run:

```bash
bash tests/linux-install-packages-template.test.sh
bash tests/custom-package-installers.test.sh
```

Expected: non-zero exits because the templates still consume the pre-role
manifest paths and `blocked_prefixes` call contract.

- [ ] **Step 2: Resolve Linux desired and purge sets at render time**

At the top of the Linux OS branch, validate and resolve policy:

```gotemplate
{{ template "validate-machine-package-data.tmpl" . }}
{{- $root := . -}}
{{- $aptRoles := $root.packages.linux.apt.roles -}}
{{- $packagePolicy := get $root "packagePolicy" | default dict -}}
{{- $newDenied := get $packagePolicy "deniedPrefixes" | default list -}}
{{- $legacyDenied := get $root "blocked_prefixes" | default list -}}
{{- $deniedPrefixes := concat $newDenied $legacyDenied | uniq -}}
```

Before emitting shell, validate that every apt role key is in
`machineRolePolicy.platforms.linux`, every role value is a list of unique,
non-empty strings, no apt identifier belongs to two roles, tombstones are
unique non-empty strings, and no tombstone appears in any role.

Render `apt_install_packages` by iterating `machineRoles` in configured order
and including only packages not matched by `hasPrefix $prefix $package`.
Render `apt_remove_packages` as tombstones followed by every managed package
whose owner role is inactive or whose identifier matches a denied prefix.
Because schema validation forbids duplicate ownership and tombstone overlap,
these arrays are disjoint and deterministic.

Keep `validate_package_sets`, dpkg state parsing, apt simulation, removal-plan
allowlisting, marking desired packages manual, and autoremove behavior intact.
Update wording from `apt.remove` to `calculated purge set` where the allowed set
now also contains inactive and denied managed packages.

- [ ] **Step 3: Resolve selected custom installers and denial policy**

Flatten selected custom role lists before calling the existing installer:

```gotemplate
{{- $selectedCustom := list -}}
{{- range $role := $root.machineRoles -}}
  {{- $roleCustom := get $root.packages.linux.custom.roles $role | default list -}}
  {{- $selectedCustom = concat $selectedCustom $roleCustom -}}
{{- end -}}
{{ template "install-custom-packages.sh.tmpl" (dict "custom" $selectedCustom "denied_prefixes" $deniedPrefixes) }}
```

In `install-custom-packages.sh.tmpl`, rename internal policy variables from
blocked to denied and read `denied_prefixes` from map input. Preserve plain-list
input compatibility and all record validation. A denied custom installer emits
a non-effecting skip line and never renders its install command. It does not
render or claim an uninstall action.

- [ ] **Step 4: Run focused Linux tests GREEN**

Run:

```bash
bash tests/linux-install-packages-template.test.sh
bash tests/custom-package-installers.test.sh
```

Expected: exit 0. Base excludes Steam from installs and includes it in purge;
base-plus-gaming installs Steam; new and legacy denial cases purge apt packages
and suppress custom installers; fake apt/custom effects remain isolated.

- [ ] **Step 5: Commit Linux implementation**

```bash
git add \
  run_onchange_before_linux-install-packages.sh.tmpl \
  .chezmoitemplates/install-custom-packages.sh.tmpl
git commit -m "feat: reconcile linux packages by machine role"
```

Do not publish while Darwin or Bun tests remain RED.

---

### Task 4: Reconcile Darwin Packages

**Files:**
- Modify: `run_onchange_before_darwin-install-packages.sh.tmpl`
- Test: `tests/darwin-install-packages-template.test.sh`

**Interfaces:**
- Consumes: role maps under `.packages.darwin.{custom,taps,trusted_formulae,brews,casks}.roles`, validated `machineRoles`, and the denial union.
- Produces: an authoritative Brewfile containing only selected, non-denied declarations and selected custom installer records.

- [ ] **Step 1: Confirm the Darwin test is RED**

Run:

```bash
bash tests/darwin-install-packages-template.test.sh
```

Expected: non-zero exit because the template still consumes flat Darwin lists.

- [ ] **Step 2: Validate and flatten Darwin package categories**

Call the shared validator and calculate the same new/legacy denial union as the
Linux template. For each Darwin category, validate role keys against
`machineRolePolicy.platforms.darwin`, require list values, reject empty or
duplicate identifiers, and reject identifiers owned by more than one role in
the category.

Flatten categories in active-role order. Apply denied prefixes to canonical tap,
trusted-formula, formula, and cask identifiers. Render selected taps, formulae,
and casks into the strict Brewfile. Render only selected, non-denied trusted
formulae in both `grant_tap_trust` calls. Pass selected custom records plus the
deny union to `install-custom-packages.sh.tmpl`.

Retain Homebrew bootstrap, explicit `XDG_CONFIG_HOME`, both trust calls, and:

```bash
brew bundle install --file=/dev/stdin --force-cleanup
```

The strict Brewfile omission is the removal mechanism for denied packages.

- [ ] **Step 3: Run the Darwin test GREEN**

Run:

```bash
bash tests/darwin-install-packages-template.test.sh
```

Expected: exit 0. Base renders the existing authoritative catalog; gaming is
rejected on Darwin; new and legacy denials omit matching declarations; the fake
Homebrew adapter confirms strict cleanup and exactly two applicable trust calls.

- [ ] **Step 4: Commit Darwin implementation**

```bash
git add run_onchange_before_darwin-install-packages.sh.tmpl
git commit -m "feat: reconcile darwin packages by machine role"
```

Do not publish while Bun tests remain RED.

---

### Task 5: Reconcile Bun Global Packages and Reach GREEN

**Files:**
- Modify: `run_onchange_after_install-bun-global-packages.sh.tmpl`
- Test: `tests/bun-package-management.test.sh`

**Interfaces:**
- Consumes: `.packages.bun.global.roles`, validated `.machineRoles`, and the denial union.
- Produces: authoritative `desired_packages` used by the existing Bun add/remove reconciliation.

- [ ] **Step 1: Confirm the Bun test is RED**

Run:

```bash
bash tests/bun-package-management.test.sh
```

Expected: non-zero exit because the template still ranges the pre-role
`.packages.bun.global` list.

- [ ] **Step 2: Render role-selected, non-denied Bun globals**

Call the shared validator before shell content, resolve the new/legacy denial
union, and validate `.packages.bun.global.roles`: every key must be a globally
known role, every value must be a list of unique non-empty package names, and a
package must not belong to multiple roles.

Render `desired_packages` by iterating active roles and omitting identifiers
matched by any denied prefix:

```gotemplate
{{- range $role := .machineRoles -}}
  {{- range $package := get $.packages.bun.global.roles $role | default list -}}
    {{- $denied := false -}}
    {{- range $prefix := $deniedPrefixes -}}
      {{- if hasPrefix $prefix $package }}{{ $denied = true }}{{ end -}}
    {{- end -}}
    {{- if not $denied }}
  {{ $package | quote }}
    {{- end -}}
  {{- end -}}
{{- end }}
```

Keep Bun discovery, global manifest parsing, `@latest` installation, and removal
of every current global outside `desired_packages` unchanged. This naturally
removes denied Bun globals.

- [ ] **Step 3: Run the Bun test GREEN**

Run:

```bash
bash tests/bun-package-management.test.sh
```

Expected: exit 0. The fake sees all three declared globals for base, removes its
undeclared fixture, and removes a denied declared fixture in the policy case.

- [ ] **Step 4: Run the complete shell suite GREEN**

Run:

```bash
for test_file in tests/*.test.sh; do
  echo "==> $test_file"
  bash "$test_file"
done
```

Expected: every shell test exits 0 with no network access and no host package
changes.

- [ ] **Step 5: Commit Bun implementation**

```bash
git add run_onchange_after_install-bun-global-packages.sh.tmpl
git commit -m "feat: reconcile bun packages by machine role"
```

The local RED/GREEN sequence is now GREEN, but do not publish until README and
final verification are complete.

---

### Task 6: Document Direct and Downstream Composition

**Files:**
- Modify: `README.md`
- Reference: `docs/superpowers/specs/2026-08-09-machine-package-roles-design.md`

**Interfaces:**
- Consumes: the final `machineRoles` and `packagePolicy.deniedPrefixes` contracts.
- Produces: a plain-language consumer guide for direct users and the internal work composition root.

- [ ] **Step 1: Invoke and follow the plain-explain skill**

Read `/home/eddie/.agents/packages/coding/skills/plain-explain/SKILL.md` and keep
the package-management section direct, concrete, and free of unexplained
implementation jargon.

- [ ] **Step 2: Replace the current package-management paragraph with the full contract**

Add these subsections and examples:

```markdown
## Package Management

### Machine roles

Every machine must select `base`. Linux machines may also select `gaming`.

| Machine | `machineRoles` |
|---|---|
| Ubuntu web host | `["base"]` |
| Ubuntu development and gaming machine | `["base", "gaming"]` |
| macOS machine | `["base"]` |

New direct installations ask about gaming during `chezmoi init`. To change an
existing machine, run `chezmoi edit-config`, then inspect `chezmoi diff` before
running `chezmoi apply`. Removing `gaming` purges the managed Steam packages.

### Package policy

A repository that composes this one can deny package-name prefixes:

```toml
[data]
machineRoles = ["base"]

[data.packagePolicy]
deniedPrefixes = ["unauthorized-prefix"]
```

Denied packages are never installed. Managed apt, Homebrew, and Bun packages
that become denied are removed. Custom script installers are skipped but cannot
be automatically uninstalled.
```

Follow it with the durable tombstone rule already present in `README.md`.
Explain that legacy `blocked_prefixes` remains accepted but new configs must use
`packagePolicy.deniedPrefixes`.

- [ ] **Step 3: Document the internal work migration sequence**

State that the work repository owns `.chezmoi.toml.tmpl`, applies `_personal/`
first, and then applies work state. Include this exact safe order:

1. Add `machineRoles = ["base"]` while retaining `blocked_prefixes`.
2. Update the `_personal/` submodule.
3. Move the deny list to `[data.packagePolicy] deniedPrefixes`.
4. Preview and apply normally.

Explain that steps may be committed atomically. Also explain why the personal
`.chezmoi.toml.tmpl` does not interfere: the work script uses `chezmoi apply`,
and config templates run during `chezmoi init`.

- [ ] **Step 4: Add verification commands**

Include:

```bash
for test_file in tests/*.test.sh; do bash "$test_file"; done
chezmoi data | jq '{machineRoles, packagePolicy}'
chezmoi diff
```

Warn readers to inspect removals before applying. Do not instruct automated CI
to run network or production package QA.

- [ ] **Step 5: Verify README examples against rendered data**

Run:

```bash
chezmoi --source . \
  --override-data '{"machineRoles":["base"]}' \
  execute-template \
  -f run_onchange_before_linux-install-packages.sh.tmpl \
  >/tmp/chezmoi-base-packages.sh
bash -n /tmp/chezmoi-base-packages.sh

grep -Fq 'machineRoles = ["base"]' README.md
grep -Fq '[data.packagePolicy]' README.md
grep -Fq 'deniedPrefixes' README.md
```

Expected: template rendering and shell syntax checks exit 0; all three README
contract checks match.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain machine package role composition"
```

---

### Task 7: Final Verification and Consumer Review

**Files:**
- Verify: all files listed in the File Structure table
- Verify: `docs/superpowers/specs/2026-08-09-machine-package-roles-design.md`

**Interfaces:**
- Consumes: the complete local RED/GREEN commit range.
- Produces: fresh evidence that contracts, implementations, and documentation agree before any success claim or publication.

- [ ] **Step 1: Run every shell test from a clean command**

Run:

```bash
for test_file in tests/*.test.sh; do
  echo "==> $test_file"
  bash "$test_file"
done
bun test tests/*.test.ts
```

Expected: every shell test exits 0 and Bun reports zero failing TypeScript tests.

- [ ] **Step 2: Render all role/platform combinations**

Run:

```bash
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

chezmoi --source . --override-data '{"machineRoles":["base"]}' \
  execute-template -f run_onchange_before_linux-install-packages.sh.tmpl \
  >"$tmp_dir/linux-base.sh"
chezmoi --source . --override-data '{"machineRoles":["base","gaming"]}' \
  execute-template -f run_onchange_before_linux-install-packages.sh.tmpl \
  >"$tmp_dir/linux-gaming.sh"
chezmoi --source . \
  --override-data '{"chezmoi":{"os":"darwin"},"machineRoles":["base"]}' \
  execute-template -f run_onchange_before_darwin-install-packages.sh.tmpl \
  >"$tmp_dir/darwin-base.sh"
chezmoi --source . --override-data '{"machineRoles":["base"]}' \
  execute-template -f run_onchange_after_install-bun-global-packages.sh.tmpl \
  >"$tmp_dir/bun-base.sh"

bash -n "$tmp_dir"/*.sh
```

Expected: all four templates render and all generated scripts pass `bash -n`.
Do not execute generated production installers.

- [ ] **Step 3: Verify fail-closed and denial behavior manually at the template boundary**

Run:

```bash
if chezmoi --source . --override-data '{"machineRoles":["gaming"]}' \
  execute-template -f run_onchange_before_linux-install-packages.sh.tmpl \
  >"$tmp_dir/invalid.sh" 2>"$tmp_dir/invalid.err"; then
  echo "base-less roles unexpectedly rendered" >&2
  exit 1
fi
grep -Fq 'must include required role "base"' "$tmp_dir/invalid.err"

chezmoi --source . \
  --override-data '{"machineRoles":["base","gaming"],"packagePolicy":{"deniedPrefixes":["steam"]}}' \
  execute-template -f run_onchange_before_linux-install-packages.sh.tmpl \
  >"$tmp_dir/denied-gaming.sh"
awk '
  /^apt_install_packages=\(/ { in_install=1; next }
  in_install && /^\)/ { in_install=0 }
  in_install { print }
' "$tmp_dir/denied-gaming.sh" >"$tmp_dir/denied-install-array"
! grep -Fq 'steam-installer' "$tmp_dir/denied-install-array"
grep -Fq 'steam-installer' "$tmp_dir/denied-gaming.sh"
```

Expected: base-less rendering fails with the required-role diagnostic, and the
denied gaming render contains no Steam install-array entry.

- [ ] **Step 4: Review the downstream consumer contract line by line**

Compare README and implementation for these exact names and semantics:

```text
machineRoles
base
gaming
packagePolicy.deniedPrefixes
blocked_prefixes
packages.linux.apt.remove
```

Confirm README states that `base` is mandatory, Darwin rejects gaming, apt/
Homebrew/Bun remove denied managed packages, custom installers do not uninstall,
and the work template must add roles before updating `_personal/`.

- [ ] **Step 5: Inspect repository state and commit history**

Run:

```bash
git diff --check
git status --short
git log --oneline -8
```

Expected: no uncommitted implementation changes; the RED contract commit is
followed by all GREEN implementation commits and the documentation commit.
The pre-existing failing Bun assertion is covered by the now-passing complete
suite.

- [ ] **Step 6: Do not apply package changes automatically**

Production `chezmoi apply`, apt, Homebrew, Bun network installation, and custom
installer execution are manual QA effects. Leave them to the operator after the
work composition root has supplied `machineRoles` and after `chezmoi diff` has
been reviewed.
