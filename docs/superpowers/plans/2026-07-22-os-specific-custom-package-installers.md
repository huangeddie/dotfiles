# OS-Specific Custom Package Installers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declare Linux and macOS custom package installers in `packages.yaml` and render them through one validated, idempotent template after each OS's native package manager.

**Architecture:** Each `packages.<os>.custom` list owns ordered structured installer records. A reusable `.chezmoitemplates/install-custom-packages.sh.tmpl` converts those records to shell, while the existing Linux and Darwin scripts retain package-manager ordering and OS guards.

**Tech Stack:** chezmoi YAML data, Go templates with Sprig functions, Bash, Python 3 assertions

## Global Constraints

- `packages.linux.custom` initially contains television, zoxide, herdr, and Bun in that order.
- `packages.darwin.custom` initially equals `[]`; existing Darwin tools remain Homebrew-managed.
- Every custom entry requires non-empty `name`, `executable`, and `install` strings; `setup` is optional.
- `setup` runs before `command -v`; `install` runs only when `executable` remains unavailable.
- Custom entries run after apt on Linux and after Homebrew on Darwin.
- Generated package scripts use `set -euo pipefail` and stop on installer failure.
- Automated tests must not invoke apt, Homebrew, networks, upstream installers, or the real home directory.
- Because shell tests have no expected-failure mechanism, keep the RED and GREEN commits local and publish only the passing branch tip.

## File Structure

- `.chezmoidata/packages.yaml`: owns OS-specific custom installer declarations.
- `tests/custom-package-installers.test.sh`: verifies the schema, OS wiring, renderer validation, ordering, setup-before-check behavior, and idempotent executable discovery.
- `.chezmoitemplates/install-custom-packages.sh.tmpl`: validates and renders one OS's custom list without knowing which OS supplied it.
- `run_onchange_before_linux-install-packages.sh.tmpl`: invokes the shared renderer after apt synchronization.
- `run_onchange_before_darwin-install-packages.sh.tmpl`: enables `pipefail` and invokes the shared renderer after Homebrew synchronization.

---

### Task 1: Define and verify the custom-installer contract (RED, Track A)

**Files:**
- Modify: `.chezmoidata/packages.yaml`
- Create: `tests/custom-package-installers.test.sh`

**Interfaces:**
- Consumes: Existing `packages.linux` and `packages.darwin` manifest objects.
- Produces: Ordered `packages.<os>.custom` lists whose entries have required string fields `name`, `executable`, and `install`, plus optional string field `setup`.

- [ ] **Step 1: Add the OS-specific declarations to the manifest**

Add `custom: []` immediately below `packages.darwin`. Add this list immediately below `packages.linux`, before `apt`:

```yaml
    custom:
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
      - name: bun
        executable: bun
        setup: |-
          export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
          export PATH="$BUN_INSTALL/bin:$PATH"
        install: |-
          curl -fsSL https://bun.com/install | bash
```

The resulting Darwin opening must be:

```yaml
  darwin:
    custom: []
    taps:
```

- [ ] **Step 2: Create the deterministic contract and renderer test**

Create `tests/custom-package-installers.test.sh`:

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

assert packages["darwin"]["custom"] == []
assert packages["linux"]["custom"] == [
    {
        "name": "television",
        "executable": "tv",
        "install": "curl -fsSL https://alexpasmantier.github.io/television/install.sh | bash",
    },
    {
        "name": "zoxide",
        "executable": "zoxide",
        "install": "curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh",
    },
    {
        "name": "herdr",
        "executable": "herdr",
        "install": "curl -fsSL https://herdr.dev/install.sh | sh",
    },
    {
        "name": "bun",
        "executable": "bun",
        "setup": 'export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"\n'
        'export PATH="$BUN_INSTALL/bin:$PATH"',
        "install": "curl -fsSL https://bun.com/install | bash",
    },
]
PY

shared_template_call='{{ template "install-custom-packages.sh.tmpl" .packages.%s.custom }}'
printf -v linux_template_call "$shared_template_call" linux
printf -v darwin_template_call "$shared_template_call" darwin

grep -Fq "$linux_template_call" \
  "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" || {
  echo "Linux package script does not render packages.linux.custom" >&2
  exit 1
}
grep -Fq "$darwin_template_call" \
  "$source_dir/run_onchange_before_darwin-install-packages.sh.tmpl" || {
  echo "Darwin package script does not render packages.darwin.custom" >&2
  exit 1
}

if grep -Fq 'https://alexpasmantier.github.io/television/install.sh' \
  "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl"; then
  echo "Linux package script still contains inline custom installers" >&2
  exit 1
fi

linux_script="$test_root/linux-install-packages.sh"
chezmoi --source "$source_dir" execute-template \
  -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
  >"$linux_script"
bash -n "$linux_script"
python3 - "$linux_script" <<'PY'
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    script = stream.read()

markers = ["# television", "# zoxide", "# herdr", "# bun"]
positions = [script.index(marker) for marker in markers]
assert positions == sorted(positions)
assert all(script.count(marker) == 1 for marker in markers)
assert script.index('export PATH="$BUN_INSTALL/bin:$PATH"') < script.index(
    'command -v "bun"'
)
PY

synthetic_template="$test_root/synthetic.tmpl"
cat >"$synthetic_template" <<'TMPL'
#!/usr/bin/env bash
set -euo pipefail
{{ template "install-custom-packages.sh.tmpl" (list
  (dict "name" "prepared tool" "executable" "prepared-tool" "setup" "export PATH=\"$SYNTHETIC_BIN:$PATH\"" "install" "echo unexpected >>\"$INSTALL_LOG\"")
  (dict "name" "missing tool" "executable" "chezmoi-test-missing-custom-tool" "install" "echo installed-missing >>\"$INSTALL_LOG\"")
) }}
TMPL

synthetic_script="$test_root/synthetic.sh"
chezmoi --source "$source_dir" execute-template \
  -f "$synthetic_template" >"$synthetic_script"
bash -n "$synthetic_script"

synthetic_bin="$test_root/synthetic-bin"
mkdir -p "$synthetic_bin"
cat >"$synthetic_bin/prepared-tool" <<'SH'
#!/usr/bin/env sh
exit 0
SH
chmod +x "$synthetic_bin/prepared-tool"

install_log="$test_root/install.log"
: >"$install_log"
SYNTHETIC_BIN="$synthetic_bin" \
  INSTALL_LOG="$install_log" \
  PATH="/usr/bin:/bin" \
  bash "$synthetic_script"
printf '%s\n' installed-missing >"$test_root/expected-install.log"
diff -u "$test_root/expected-install.log" "$install_log"

invalid_template="$test_root/invalid.tmpl"
cat >"$invalid_template" <<'TMPL'
{{ template "install-custom-packages.sh.tmpl" (list (dict "name" "invalid" "executable" "invalid")) }}
TMPL
if chezmoi --source "$source_dir" execute-template \
  -f "$invalid_template" >"$test_root/invalid.out" 2>"$test_root/invalid.err"; then
  echo "renderer accepted a custom installer without install" >&2
  exit 1
fi
grep -Fq 'custom installer 0: install must not be empty' \
  "$test_root/invalid.err"
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
bash tests/custom-package-installers.test.sh
```

Expected: FAIL with `Linux package script does not render packages.linux.custom`. This is a raw RED because Bash has no expected-failure facility; do not publish this commit alone.

- [ ] **Step 4: Commit the Track A schema and verification contract**

```bash
git add .chezmoidata/packages.yaml tests/custom-package-installers.test.sh
git commit -m "test: define OS-specific custom installer contract"
```

### Task 2: Render custom installers after native packages (GREEN, Track B)

**Files:**
- Create: `.chezmoitemplates/install-custom-packages.sh.tmpl`
- Modify: `run_onchange_before_linux-install-packages.sh.tmpl`
- Modify: `run_onchange_before_darwin-install-packages.sh.tmpl`

**Interfaces:**
- Consumes: An ordered list of maps with required `name`, `executable`, and `install` strings and optional `setup` string.
- Produces: A shell block that validates each map during rendering, runs `setup`, checks `executable` with `command -v`, and conditionally executes `install`.

- [ ] **Step 1: Add the shared validated renderer**

Create `.chezmoitemplates/install-custom-packages.sh.tmpl`:

```gotemplate
{{- range $index, $installer := . }}
{{- $name := get $installer "name" | default "" -}}
{{- $executable := get $installer "executable" | default "" -}}
{{- $setup := get $installer "setup" | default "" -}}
{{- $install := get $installer "install" | default "" -}}
{{- if empty ($name | trim) }}{{ fail (printf "custom installer %d: name must not be empty" $index) }}{{ end -}}
{{- if empty ($executable | trim) }}{{ fail (printf "custom installer %d: executable must not be empty" $index) }}{{ end -}}
{{- if empty ($install | trim) }}{{ fail (printf "custom installer %d: install must not be empty" $index) }}{{ end }}
# {{ $name }}
{{ with $setup -}}
{{ . }}
{{ end -}}
if ! command -v {{ $executable | quote }} >/dev/null 2>&1; then
  printf '🚀 Installing %s...\n' {{ $name | quote }}
{{ $install | indent 2 }}
fi

{{- end }}
```

`get` is required because chezmoi treats a missing map key as a rendering error; it permits `setup` to be genuinely optional and lets required fields fail with the contract's descriptive messages.

- [ ] **Step 2: Wire the Linux script and remove its inline declarations**

Replace the complete inline block from `# television` through the Bun `fi` with:

```gotemplate
{{ template "install-custom-packages.sh.tmpl" .packages.linux.custom }}
```

Leave this call after the apt synchronization block and before the outer Linux `{{- end }}`.

- [ ] **Step 3: Wire the Darwin script after Homebrew synchronization**

Change its strict-mode line from:

```bash
set -eu
```

to:

```bash
set -euo pipefail
```

Then add this call after the final `grant_tap_trust` and before the outer Darwin `{{- end }}`:

```gotemplate
{{ template "install-custom-packages.sh.tmpl" .packages.darwin.custom }}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
bash tests/custom-package-installers.test.sh
```

Expected: PASS. The only runtime output is `🚀 Installing missing tool...` from the synthetic installer.

- [ ] **Step 5: Run all deterministic shell tests**

Run:

```bash
for test_file in tests/*.test.sh; do
  printf '==> %s\n' "$test_file"
  bash "$test_file"
done
```

Expected: all three shell tests pass: `bun-package-management`, `custom-package-installers`, and `linux-install-packages-template`. No apt, Homebrew, or network commands run because effects are replaced by synthetic commands or fake executables.

- [ ] **Step 6: Validate templates and repository state**

Run:

```bash
linux_script=$(mktemp)
darwin_script=$(mktemp)
trap 'rm -f "$linux_script" "$darwin_script"' EXIT
chezmoi --source "$PWD" execute-template \
  -f run_onchange_before_linux-install-packages.sh.tmpl >"$linux_script"
chezmoi --source "$PWD" execute-template \
  -f run_onchange_before_darwin-install-packages.sh.tmpl >"$darwin_script"
bash -n "$linux_script"
bash -n "$darwin_script"
git diff --check
git status --short
```

Expected: both `bash -n` commands and `git diff --check` exit 0. Status lists only the shared template and two OS script modifications. Do not run `chezmoi apply` automatically because these onchange scripts perform real package-manager and network effects; leave real installation as manual QA on the target OS.

- [ ] **Step 7: Commit the Track B implementation**

```bash
git add \
  .chezmoitemplates/install-custom-packages.sh.tmpl \
  run_onchange_before_linux-install-packages.sh.tmpl \
  run_onchange_before_darwin-install-packages.sh.tmpl
git commit -m "feat: render OS-specific custom installers"
```

- [ ] **Step 8: Confirm the local RED/GREEN pair ends at a passing tip**

Run:

```bash
git log -2 --oneline
bash tests/custom-package-installers.test.sh
```

Expected: the Track B `feat:` commit is immediately above the Track A `test:` commit, and the focused test passes. The branch is now safe to publish.
