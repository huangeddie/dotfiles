# Linux Apt Blocked-Prefix Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `chezmoi apply` by defining and consuming an explicit Linux apt blocked-prefix list.

**Architecture:** Keep all Linux apt declarations under the existing `packages.linux.apt` template-data object. A deterministic shell regression test renders the production template through chezmoi; the implementation changes only the template's data path, preserving the existing filtering algorithm.

**Tech Stack:** Chezmoi v2 templates, YAML, Bash 5

## Global Constraints

- `packages.linux.apt.install`, `packages.linux.apt.remove`, and `packages.linux.apt.blocked_prefixes` are list-valued fields.
- The checked-in `blocked_prefixes` list is empty, meaning no desired apt package is filtered.
- A missing `blocked_prefixes` field remains a template-rendering error; do not add a default in the template.
- Do not change apt synchronization, package declarations, or removal safety behavior.
- Keep the raw RED commit local until the GREEN implementation commit exists and all verification passes.

---

### Task 1: Define the schema and regression contract

**Files:**
- Modify: `.chezmoidata/packages.yaml:65-91`
- Create: `tests/linux-install-packages-template.test.sh`

**Interfaces:**
- Consumes: Chezmoi data loaded from `.chezmoidata/packages.yaml` and the production `run_onchange_before_linux-install-packages.sh.tmpl` template.
- Produces: `packages.linux.apt.blocked_prefixes`, a required YAML list; a regression command invoked as `bash tests/linux-install-packages-template.test.sh`.

- [ ] **Step 1: Write the rendering regression test**

Create `tests/linux-install-packages-template.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
rendered_script=$(mktemp)
trap 'rm -f "$rendered_script"' EXIT

(
  cd "$source_dir"
  chezmoi execute-template \
    -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
    >"$rendered_script"
)

if ! grep -Fqx '  "steam-installer"' "$rendered_script"; then
  echo "rendered apt install list omitted declared package steam-installer" >&2
  exit 1
fi
```

- [ ] **Step 2: Run the regression test to verify RED**

Run:

```bash
bash tests/linux-install-packages-template.test.sh
```

Expected: exit status `1` with chezmoi reporting `map has no entry for key "blocked_prefixes"` at template line 6. This proves the test reproduces the reported failure.

- [ ] **Step 3: Add the explicit schema field without changing the template**

In `.chezmoidata/packages.yaml`, add the empty list alongside `install` and `remove`:

```yaml
  linux:
    apt:
      blocked_prefixes: []
      install:
        [
```

Do not move or alter any package names.

- [ ] **Step 4: Re-run the regression test and confirm it remains RED for the intended contract mismatch**

Run:

```bash
bash tests/linux-install-packages-template.test.sh
```

Expected: exit status `1` with the same missing top-level `blocked_prefixes` error. The manifest now defines the intended nested contract, while the consumer still uses the old path.

- [ ] **Step 5: Commit Track A locally**

```bash
git add .chezmoidata/packages.yaml tests/linux-install-packages-template.test.sh
git commit -m "test: define linux apt prefix-filter schema"
```

Expected: a local RED commit containing only the data contract and regression test. Do not push or otherwise publish this commit by itself.

### Task 2: Consume the schema and verify the workflow

**Files:**
- Modify: `run_onchange_before_linux-install-packages.sh.tmpl:6`
- Test: `tests/linux-install-packages-template.test.sh`

**Interfaces:**
- Consumes: Required `packages.linux.apt.blocked_prefixes` list from Task 1.
- Produces: A renderable Linux apt script whose existing prefix filter iterates over that list.

- [ ] **Step 1: Change the template to consume the nested field**

Replace:

```gotemplate
{{- $blocked_prefixes := .blocked_prefixes -}}
```

with:

```gotemplate
{{- $blocked_prefixes := .packages.linux.apt.blocked_prefixes -}}
```

Do not change the prefix matching loop.

- [ ] **Step 2: Run the regression test to verify GREEN**

Run:

```bash
bash tests/linux-install-packages-template.test.sh
```

Expected: exit status `0` with no output.

- [ ] **Step 3: Validate the rendered Bash script**

Run:

```bash
rendered_script=$(mktemp)
trap 'rm -f "$rendered_script"' EXIT
chezmoi execute-template \
  -f "$PWD/run_onchange_before_linux-install-packages.sh.tmpl" \
  >"$rendered_script"
bash -n "$rendered_script"
```

Expected: both commands exit `0` with no output.

- [ ] **Step 4: Inspect the complete chezmoi change set before applying**

Run:

```bash
chezmoi status
chezmoi diff
```

Expected: both commands render without a missing-key error. Review any reported target changes before continuing; the source-only schema and ignored test file must not appear as deployed home-directory files.

- [ ] **Step 5: Apply the repaired source state**

Run:

```bash
chezmoi apply
```

Expected: no template error. Because the rendered `run_onchange` script changed, chezmoi may run apt package synchronization and request sudo privileges; allow that declared behavior to complete.

- [ ] **Step 6: Re-run verification after apply**

Run:

```bash
bash tests/linux-install-packages-template.test.sh
git diff --check
git status --short
```

Expected: the regression test and `git diff --check` exit `0`. `git status --short` lists only the template modification relative to the Track A commit.

- [ ] **Step 7: Commit Track B**

```bash
git add run_onchange_before_linux-install-packages.sh.tmpl
git commit -m "fix: consume linux apt prefix-filter schema"
```

Expected: a GREEN implementation commit following the local Track A commit.

- [ ] **Step 8: Verify the committed branch tip**

Run:

```bash
bash tests/linux-install-packages-template.test.sh
git diff --check HEAD^ HEAD
git status --short
git log -2 --oneline
```

Expected: both checks exit `0`, status is empty, and the two newest commits are the GREEN `fix:` commit followed by the RED `test:` contract commit.
