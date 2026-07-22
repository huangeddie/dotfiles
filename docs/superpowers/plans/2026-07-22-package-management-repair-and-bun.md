# Package Management Repair and Bun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair Linux apt template rendering, provision Bun on Linux and macOS, and strictly synchronize one shared global Bun package list beginning with Prettier.

**Architecture:** Package declarations remain centralized in `.chezmoidata/packages.yaml`. OS-specific before scripts provision apt/Homebrew packages and Bun itself; a focused cross-platform onchange-after script atomically replaces Bun's global direct-dependency manifest and delegates reconciliation to `bun install`.

**Tech Stack:** Chezmoi v2 templates, YAML, Bash 5, Bun package manager, Python 3 test assertions

## Global Constraints

- `packages.linux.apt.install`, `packages.linux.apt.remove`, and `packages.linux.apt.blocked_prefixes` are required list-valued fields.
- The checked-in `packages.linux.apt.blocked_prefixes` list is empty.
- `packages.bun.global` is a required OS-independent list of npm package names and initially contains only `prettier`.
- The Bun global list is strictly authoritative, including over manually installed global packages.
- Linux installs Bun through `curl -fsSL https://bun.com/install | bash`; macOS installs Bun as a Homebrew formula.
- Automated tests must not access the network, apt, Homebrew, Bun's production global directory, or the real home directory.
- Real Bun strict-removal verification is manual QA only and must not be added to pre-commit, pre-push, or CI.
- Raw RED commits remain local until their GREEN implementation commits exist and all focused verification passes.
- This plan supersedes `docs/superpowers/plans/2026-07-22-linux-apt-blocked-prefixes-schema.md`.

---

### Task 1: Define the Linux apt schema and regression contract

**Files:**
- Modify: `.chezmoidata/packages.yaml:65-90`
- Create: `tests/linux-install-packages-template.test.sh`

**Interfaces:**
- Consumes: Chezmoi source data and `run_onchange_before_linux-install-packages.sh.tmpl`.
- Produces: Required `packages.linux.apt.blocked_prefixes: []`; regression command `bash tests/linux-install-packages-template.test.sh`.

- [ ] **Step 1: Write the rendering regression test**

Create `tests/linux-install-packages-template.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
rendered_script=$(mktemp)
trap 'rm -f "$rendered_script"' EXIT

chezmoi --source "$source_dir" execute-template \
  -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
  >"$rendered_script"

if ! grep -Fqx '  "steam-installer"' "$rendered_script"; then
  echo "rendered apt install list omitted declared package steam-installer" >&2
  exit 1
fi
```

- [ ] **Step 2: Verify RED against the reported failure**

Run:

```bash
bash tests/linux-install-packages-template.test.sh
```

Expected: exit `1` with `map has no entry for key "blocked_prefixes"` at template line 6.

- [ ] **Step 3: Add the explicit apt schema field**

Under `packages.linux.apt`, add:

```yaml
      blocked_prefixes: []
```

Keep `install` and `remove` unchanged.

- [ ] **Step 4: Confirm the consumer still violates the new contract**

Run:

```bash
bash tests/linux-install-packages-template.test.sh
```

Expected: exit `1` with the same missing top-level `blocked_prefixes` error.

- [ ] **Step 5: Commit Track A locally**

```bash
git add .chezmoidata/packages.yaml tests/linux-install-packages-template.test.sh
git commit -m "test: define linux apt prefix-filter schema"
```

Do not publish this RED commit independently.

### Task 2: Consume the Linux apt schema

**Files:**
- Modify: `run_onchange_before_linux-install-packages.sh.tmpl:6`
- Test: `tests/linux-install-packages-template.test.sh`

**Interfaces:**
- Consumes: `packages.linux.apt.blocked_prefixes` from Task 1.
- Produces: A renderable Linux package script with unchanged prefix-filter semantics.

- [ ] **Step 1: Point the template at the nested schema**

Replace:

```gotemplate
{{- $blocked_prefixes := .blocked_prefixes -}}
```

with:

```gotemplate
{{- $blocked_prefixes := .packages.linux.apt.blocked_prefixes -}}
```

- [ ] **Step 2: Verify GREEN and generated shell syntax**

Run:

```bash
bash tests/linux-install-packages-template.test.sh
rendered_script=$(mktemp)
trap 'rm -f "$rendered_script"' EXIT
chezmoi --source "$PWD" execute-template \
  -f "$PWD/run_onchange_before_linux-install-packages.sh.tmpl" \
  >"$rendered_script"
bash -n "$rendered_script"
```

Expected: all commands exit `0` with no output.

- [ ] **Step 3: Commit Track B**

```bash
git add run_onchange_before_linux-install-packages.sh.tmpl
git commit -m "fix: consume linux apt prefix-filter schema"
```

Expected: the branch tip is GREEN and the preceding local commit is the Track A contract.

### Task 3: Define Bun schemas and deterministic verification contracts

**Files:**
- Modify: `.chezmoidata/packages.yaml:10-90`
- Create: `tests/bun-package-management.test.sh`
- Create: `docs/qa/bun-global-package-sync.md`

**Interfaces:**
- Consumes: Chezmoi data and future rendered Bun synchronization script.
- Produces: `packages.bun.global: ["prettier"]`; Homebrew formula declaration `bun`; a deterministic fake-Bun test; manual real-Bun QA instructions.

- [ ] **Step 1: Write the deterministic Bun package-management test**

Create `tests/bun-package-management.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

schema_json="$test_root/schema.json"
chezmoi --source "$source_dir" data --format json >"$schema_json"
python3 - "$schema_json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    packages = json.load(stream)["packages"]

assert packages["bun"]["global"] == ["prettier"]
assert "bun" in packages["darwin"]["brews"]
PY

linux_script="$test_root/linux-install-packages.sh"
chezmoi --source "$source_dir" execute-template \
  -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
  >"$linux_script"
grep -Fqx '  curl -fsSL https://bun.com/install | bash' "$linux_script"
grep -Fqx 'export PATH="$BUN_INSTALL/bin:$PATH"' "$linux_script"

sync_script="$test_root/sync-bun-global-packages.sh"
chezmoi --source "$source_dir" execute-template \
  -f "$source_dir/run_onchange_after_install-bun-global-packages.sh.tmpl" \
  >"$sync_script"
bash -n "$sync_script"

fake_bin="$test_root/fake-bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/bun" <<'FAKE_BUN'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" >"$BUN_INVOCATION_LOG"
FAKE_BUN
chmod +x "$fake_bin/bun"

export BUN_INSTALL="$test_root/bun-home"
export BUN_INVOCATION_LOG="$test_root/bun-invocation.log"
PATH="$fake_bin:$PATH" HOME="$test_root/home" bash "$sync_script"

cat >"$test_root/expected-package.json" <<'JSON'
{
  "dependencies": {
    "prettier": "latest"
  }
}
JSON

diff -u \
  "$test_root/expected-package.json" \
  "$BUN_INSTALL/install/global/package.json"

cat >"$test_root/expected-invocation.log" <<EOF
install
--cwd
$BUN_INSTALL/install/global
EOF

diff -u "$test_root/expected-invocation.log" "$BUN_INVOCATION_LOG"
```

- [ ] **Step 2: Verify the test is RED before adding contracts**

Run:

```bash
bash tests/bun-package-management.test.sh
```

Expected: nonzero exit because `.packages.bun` does not exist.

- [ ] **Step 3: Add the shared Bun list and macOS Bun formula**

Add this directly under `packages:`:

```yaml
  bun:
    global:
      [
        "prettier",
      ]
```

Add `"bun",` to `packages.darwin.brews` in alphabetical order among CLI applications, immediately after `"bat",`.

- [ ] **Step 4: Confirm RED now identifies missing Linux/synchronization implementation**

Run:

```bash
bash tests/bun-package-management.test.sh
```

Expected: nonzero exit because the rendered Linux script does not contain the Bun installer. If the grep diagnostic is silent, run `bash -x tests/bun-package-management.test.sh` once and confirm the failing command is that installer assertion.

- [ ] **Step 5: Write the manual strict-removal QA procedure**

Create `docs/qa/bun-global-package-sync.md`:

````markdown
# Bun global package strict-sync QA

Run manually after rendering the synchronization script. Do not add this QA to
pre-commit, pre-push, or CI because it accesses the npm registry and executes
the production Bun package manager.

```bash
set -euo pipefail
source_dir=$(git rev-parse --show-toplevel)
qa_root=$(mktemp -d)
trap 'rm -rf "$qa_root"' EXIT

chezmoi --source "$source_dir" execute-template \
  -f "$source_dir/run_onchange_after_install-bun-global-packages.sh.tmpl" \
  >"$qa_root/sync.sh"

BUN_INSTALL="$qa_root/bun-home" bun add --global prettier is-number
BUN_INSTALL="$qa_root/bun-home" bash "$qa_root/sync.sh"
BUN_INSTALL="$qa_root/bun-home" bun pm ls --global >"$qa_root/installed.txt"

grep -F 'prettier@' "$qa_root/installed.txt"
if grep -F 'is-number@' "$qa_root/installed.txt"; then
  echo "undeclared Bun package was not removed" >&2
  exit 1
fi
```

Passing QA lists Prettier and does not list `is-number`.
````

- [ ] **Step 6: Commit Track A locally**

```bash
git add \
  .chezmoidata/packages.yaml \
  tests/bun-package-management.test.sh \
  docs/qa/bun-global-package-sync.md
git commit -m "test: define cross-platform bun package contract"
```

Do not publish this RED commit independently.

### Task 4: Provision Bun and strictly synchronize global packages

**Files:**
- Modify: `run_onchange_before_linux-install-packages.sh.tmpl:221-227`
- Create: `run_onchange_after_install-bun-global-packages.sh.tmpl`
- Test: `tests/bun-package-management.test.sh`

**Interfaces:**
- Consumes: `packages.bun.global`; `BUN_INSTALL` with default `$HOME/.bun`; Bun executable provided by the Linux installer or Homebrew.
- Produces: Atomic `${BUN_INSTALL}/install/global/package.json`; invocation `bun install --cwd <global-dir>`.

- [ ] **Step 1: Provision Bun in the Linux script**

Before the final `{{- end }}` in `run_onchange_before_linux-install-packages.sh.tmpl`, add:

```bash
# bun
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  echo "🚀 Installing bun..."
  curl -fsSL https://bun.com/install | bash
fi
```

- [ ] **Step 2: Create the strict cross-platform synchronization script**

Create `run_onchange_after_install-bun-global-packages.sh.tmpl`:

```gotemplate
#!/bin/bash
set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found after OS package provisioning" >&2
  exit 1
fi

bun_install=${BUN_INSTALL:-$HOME/.bun}
global_dir=$bun_install/install/global
mkdir -p "$global_dir"

manifest_tmp=$(mktemp "$global_dir/package.json.XXXXXX")
trap 'rm -f "$manifest_tmp"' EXIT
cat >"$manifest_tmp" <<'JSON'
{
  "dependencies": {
{{- range $index, $package := .packages.bun.global }}
{{- if $index }},
{{- end }}
    {{ $package | quote }}: "latest"
{{- end }}
  }
}
JSON
mv "$manifest_tmp" "$global_dir/package.json"
trap - EXIT

bun install --cwd "$global_dir"
```

- [ ] **Step 3: Verify GREEN with the fake and generated shell**

Run:

```bash
bash tests/bun-package-management.test.sh
bash tests/linux-install-packages-template.test.sh
git diff --check
```

Expected: all commands exit `0` with no output.

- [ ] **Step 4: Inspect chezmoi behavior without applying effects**

Run:

```bash
chezmoi --source "$PWD" status
chezmoi --source "$PWD" diff
```

Expected: no template error. Review all reported target changes before apply; `tests/` and `docs/` remain ignored deployment paths.

- [ ] **Step 5: Commit Track B before effectful QA/apply**

```bash
git add \
  run_onchange_before_linux-install-packages.sh.tmpl \
  run_onchange_after_install-bun-global-packages.sh.tmpl
git commit -m "feat: synchronize global bun packages"
```

Expected: the branch tip is GREEN and the immediately preceding commit is the Bun Track A contract.

### Task 5: Verify external integrations and repaired apply

**Files:**
- Test: `docs/qa/bun-global-package-sync.md`
- Test: `tests/bun-package-management.test.sh`
- Test: `tests/linux-install-packages-template.test.sh`

**Interfaces:**
- Consumes: Production Bun, npm registry, Homebrew or Linux installer, and chezmoi apply effects.
- Produces: Evidence that strict package removal and the originally failing apply workflow succeed.

- [ ] **Step 1: Run focused deterministic verification from a clean commit**

Run:

```bash
bash tests/linux-install-packages-template.test.sh
bash tests/bun-package-management.test.sh
git diff --check HEAD~4 HEAD
git status --short
```

Expected: tests and diff check exit `0`; status is empty.

- [ ] **Step 2: Apply the repaired source state**

Run:

```bash
chezmoi apply
```

Expected: no missing `blocked_prefixes` template error. On Linux, the onchange script may synchronize apt packages, request sudo, install Bun through the official network installer, and then install Prettier globally.

- [ ] **Step 3: Run manual strict-removal QA**

Run the command block in `docs/qa/bun-global-package-sync.md`.

Expected: exit `0`, output contains `prettier@`, and output does not contain `is-number@`.

- [ ] **Step 4: Run the now-available Bun test suite**

Run:

```bash
bun test
```

Expected: all repository Bun tests pass with zero failures.

- [ ] **Step 5: Verify final repository and deployment state**

Run:

```bash
bash tests/linux-install-packages-template.test.sh
bash tests/bun-package-management.test.sh
chezmoi status
git status --short
git log -8 --oneline
```

Expected: both focused tests exit `0`; chezmoi and git statuses are empty; history contains separate apt Track A/Track B and Bun Track A/Track B commits.
