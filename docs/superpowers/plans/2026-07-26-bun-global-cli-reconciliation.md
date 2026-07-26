# Bun Global CLI Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile authoritative Bun globals through Bun's public global CLI so declared package executables are available from Bun's global bin directory.

**Architecture:** Keep `packages.bun.global` as the package-name contract. Render it into a Bash 3-compatible desired array, read current direct dependencies through Bun's JavaScript runtime, add desired packages first with `bun add --global`, and remove undeclared packages afterward with `bun remove --global`. Automated tests isolate the Bun process behind a practical executable fake; manual QA exercises real Bun and the npm registry.

**Tech Stack:** chezmoi Go templates, Bash 3-compatible shell, Bun 1.3 CLI, shell tests, YAML.

## Global Constraints

- `packages.bun.global` is a required, OS-independent, strictly authoritative list of direct global npm package names.
- Every declared package is synchronized using the `latest` selector.
- An empty declaration removes all direct global Bun packages.
- Bun owns its manifests, lockfiles, package contents, executable links, scoped names, and link cleanup.
- The production script must not write Bun's global `package.json` or create executable links itself.
- Add desired packages before removing undeclared packages.
- Automated tests must not access the network or real home directory.
- Real-Bun QA remains manual and excluded from automated hooks and CI.
- Keep the script compatible with macOS Bash 3.2; do not use associative arrays or `mapfile`.
- Do not publish the local RED commit without the immediately following GREEN commit.

## File Structure

| File | Responsibility |
| --- | --- |
| `tests/bun-package-management.test.sh` | Deterministic schema, rendering, command-selection, PATH, executable, strict-removal, and empty-list contracts using fake Bun. |
| `docs/qa/bun-global-package-sync.md` | Manual production-Bun verification of inventory and executable availability. |
| `run_onchange_after_install-bun-global-packages.sh.tmpl` | Cross-platform composition root and authoritative Bun global reconciliation. |

---

### Task 1: Define the global CLI and executable contracts

**Files:**
- Modify: `tests/bun-package-management.test.sh`
- Modify: `docs/qa/bun-global-package-sync.md`

**Interfaces:**
- Consumes: `packages.bun.global: list<string>` and rendered `run_onchange_after_install-bun-global-packages.sh.tmpl`.
- Produces: Required CLI calls `bun add --global <name>@latest` and `bun remove --global <name>`; required runtime environment `BUN_INSTALL=<root>` with `<root>/bin` on `PATH`.

- [ ] **Step 1: Replace the old fake-Bun synchronization assertion with a failing public-CLI contract**

Keep the existing schema and Linux provisioning assertions. Replace the synchronization test from `fake_bin=...` onward with two isolated cases. The fake must validate PATH, supply current dependency names for `bun -e`, record public global operations, and expose Prettier only when the add operation occurs:

```bash
fake_bin="$test_root/fake-bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/bun" <<'FAKE_BUN'
#!/usr/bin/env bash
set -euo pipefail

case ":$PATH:" in
  *":$BUN_INSTALL/bin:"*) ;;
  *)
    echo "Bun global bin directory is missing from PATH" >&2
    exit 1
    ;;
esac

case "${1:-}" in
  -e)
    printf '%s\n' is-number prettier
    ;;
  add)
    printf 'add' >>"$BUN_INVOCATION_LOG"
    shift
    printf '\t%s' "$@" >>"$BUN_INVOCATION_LOG"
    printf '\n' >>"$BUN_INVOCATION_LOG"
    mkdir -p "$BUN_INSTALL/bin"
    cat >"$BUN_INSTALL/bin/prettier" <<'PRETTIER'
#!/usr/bin/env bash
printf '%s\n' 3.9.6
PRETTIER
    chmod +x "$BUN_INSTALL/bin/prettier"
    ;;
  remove)
    printf 'remove' >>"$BUN_INVOCATION_LOG"
    shift
    printf '\t%s' "$@" >>"$BUN_INVOCATION_LOG"
    printf '\n' >>"$BUN_INVOCATION_LOG"
    ;;
  *)
    printf 'unexpected bun command: %s\n' "$*" >&2
    exit 1
    ;;
esac
FAKE_BUN
chmod +x "$fake_bin/bun"

run_reconciliation_case() {
  local rendered_script=$1
  local case_root=$2
  export BUN_INSTALL="$case_root/bun-home"
  export BUN_INVOCATION_LOG="$case_root/bun-invocation.log"
  mkdir -p "$BUN_INSTALL/install/global"
  cat >"$BUN_INSTALL/install/global/package.json" <<'JSON'
{"dependencies":{"is-number":"latest","prettier":"latest"}}
JSON
  PATH="$fake_bin:/usr/bin:/bin" HOME="$case_root/home" bash "$rendered_script"
}

run_reconciliation_case "$sync_script" "$test_root/declared-case"
cat >"$test_root/expected-declared-invocations.log" <<'EOF'
add	--global	prettier@latest
remove	--global	is-number
EOF
diff -u \
  "$test_root/expected-declared-invocations.log" \
  "$test_root/declared-case/bun-invocation.log"
test -x "$test_root/declared-case/bun-home/bin/prettier"
PATH="$test_root/declared-case/bun-home/bin:$PATH" prettier --version >/dev/null

empty_sync_script="$test_root/empty-sync-bun-global-packages.sh"
chezmoi --source "$source_dir" --override-data '{"packages":{"bun":{"global":[]}}}' \
  execute-template \
  -f "$source_dir/run_onchange_after_install-bun-global-packages.sh.tmpl" \
  >"$empty_sync_script"
bash -n "$empty_sync_script"
run_reconciliation_case "$empty_sync_script" "$test_root/empty-case"
cat >"$test_root/expected-empty-invocations.log" <<'EOF'
remove	--global	is-number	prettier
EOF
diff -u \
  "$test_root/expected-empty-invocations.log" \
  "$test_root/empty-case/bun-invocation.log"
test ! -e "$test_root/empty-case/bun-home/bin/prettier"
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bash tests/bun-package-management.test.sh
```

Expected: non-zero exit with `Bun global bin directory is missing from PATH`; this proves the existing script does not establish the required global executable environment. After that defect is corrected, the same fake rejects the old `install --cwd ...` call, so the test also gates the public global CLI contract.

- [ ] **Step 3: Extend manual QA with the executable contract**

After the existing inventory checks in `docs/qa/bun-global-package-sync.md`, add:

```bash
global_bin=$(BUN_INSTALL="$qa_root/bun-home" bun pm bin --global)
test "$global_bin" = "$qa_root/bun-home/bin"
PATH="$global_bin:$PATH" prettier --version
```

Change the passing description to state that Prettier is listed and executable and `is-number` is not listed.

- [ ] **Step 4: Commit the RED contract locally**

```bash
git add tests/bun-package-management.test.sh docs/qa/bun-global-package-sync.md
git diff --cached --check
git commit -m "test: define Bun global CLI reconciliation contract"
```

Expected: commit succeeds. Do not push or otherwise publish this RED commit before Task 2 is complete.

---

### Task 2: Reconcile packages through Bun's public global CLI

**Files:**
- Modify: `run_onchange_after_install-bun-global-packages.sh.tmpl`

**Interfaces:**
- Consumes: `packages.bun.global: list<string>`, `BUN_INSTALL` optional environment variable, Bun global manifest dependencies, and Bun CLI.
- Produces: Strictly reconciled direct globals and package executables under the directory reported by `bun pm bin --global`.

- [ ] **Step 1: Replace direct manifest mutation with Bash 3-compatible public CLI reconciliation**

Replace the template body with:

```bash
#!/bin/bash
set -euo pipefail

bun_install=${BUN_INSTALL:-$HOME/.bun}
export BUN_INSTALL="$bun_install"
export PATH="$BUN_INSTALL/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found after OS package provisioning" >&2
  exit 1
fi

desired_packages=(
{{- range .packages.bun.global }}
  {{ . | quote }}
{{- end }}
)

is_desired_package() {
  local candidate=$1
  local package

  if (( ${#desired_packages[@]} == 0 )); then
    return 1
  fi

  for package in "${desired_packages[@]}"; do
    if [[ "$candidate" == "$package" ]]; then
      return 0
    fi
  done

  return 1
}

global_manifest=$BUN_INSTALL/install/global/package.json
current_packages=()
if [[ -f "$global_manifest" ]]; then
  current_package_output=$(bun -e '
    const { readFileSync } = require("node:fs");
    const manifest = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const dependencies = manifest.dependencies ?? {};
    if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      throw new Error("global package.json dependencies must be an object");
    }
    for (const name of Object.keys(dependencies).sort()) {
      console.log(name);
    }
  ' "$global_manifest")

  while IFS= read -r package; do
    if [[ -n "$package" ]]; then
      current_packages+=("$package")
    fi
  done <<<"$current_package_output"
fi

desired_specs=()
if (( ${#desired_packages[@]} > 0 )); then
  for package in "${desired_packages[@]}"; do
    desired_specs+=("$package@latest")
  done
  bun add --global "${desired_specs[@]}"
fi

packages_to_remove=()
if (( ${#current_packages[@]} > 0 )); then
  for package in "${current_packages[@]}"; do
    if ! is_desired_package "$package"; then
      packages_to_remove+=("$package")
    fi
  done
fi

if (( ${#packages_to_remove[@]} > 0 )); then
  bun remove --global "${packages_to_remove[@]}"
fi
```

- [ ] **Step 2: Run the focused test and verify GREEN**

Run:

```bash
bash tests/bun-package-management.test.sh
```

Expected: exit 0 with no diff or assertion output.

- [ ] **Step 3: Run all deterministic shell tests**

Run:

```bash
for test_file in tests/*.test.sh; do
  bash "$test_file"
done
```

Expected: exit 0; every shell test passes without network or real-home changes.

- [ ] **Step 4: Run isolated production-Bun QA**

Run the complete command block from `docs/qa/bun-global-package-sync.md`.

Expected: output lists `prettier@`, does not list `is-number@`, and prints a Prettier version through `$qa_root/bun-home/bin/prettier`.

- [ ] **Step 5: Commit the GREEN implementation**

```bash
git add run_onchange_after_install-bun-global-packages.sh.tmpl
git diff --cached --check
git commit -m "fix(packages): reconcile Bun globals through public CLI"
```

Expected: commit succeeds, leaving the branch tip GREEN.

- [ ] **Step 6: Apply source state and verify the original Ubuntu symptom**

Run:

```bash
chezmoi apply
bun_global_bin=$(bun pm bin --global)
test -x "$bun_global_bin/prettier"
PATH="$bun_global_bin:$PATH" prettier --version
chezmoi status
```

Expected: chezmoi invokes the changed onchange script; the executable test succeeds; Prettier prints its version; `chezmoi status` prints no pending changes.

- [ ] **Step 7: Run final repository verification**

Run:

```bash
for test_file in tests/*.test.sh; do
  bash "$test_file"
done
git diff --check
git status --short
```

Expected: all tests exit 0, `git diff --check` has no output, and `git status --short` has no output.
