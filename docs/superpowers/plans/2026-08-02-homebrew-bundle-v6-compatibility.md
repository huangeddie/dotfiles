# Homebrew Bundle v6 Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore strict Darwin package synchronization after the Homebrew 6 update and prevent malformed rendered heredocs from recurring.

**Architecture:** Keep `.chezmoidata/packages.yaml` as the authoritative manifest and continue streaming its rendered Brewfile to Homebrew. Exercise the rendered installer with a fake `brew` executable so the test verifies the process-boundary argument and stdin contracts without modifying installed packages or using the network.

**Tech Stack:** chezmoi Go templates, Bash, Homebrew Bundle 6 CLI

## Global Constraints

- The rendered installer uses `brew bundle install --file=/dev/stdin --force-cleanup`.
- The Brewfile is supplied through a correctly delimited stdin heredoc.
- Tests are deterministic and must not invoke the real Homebrew executable.
- The package manifest schema and authoritative cleanup semantics remain unchanged.

---

## File Structure

- `tests/darwin-install-packages-template.test.sh` owns deterministic contracts for the rendered Darwin installer and its fake Homebrew boundary.
- `run_onchange_before_darwin-install-packages.sh.tmpl` owns Homebrew installation, trust setup, Brewfile rendering, and custom package installer dispatch.

### Task 1: Add the rendered Homebrew invocation contract

**Files:**
- Modify: `tests/darwin-install-packages-template.test.sh`

**Interfaces:**
- Consumes: rendered installer environment variables `PATH`, `HOME`, `XDG_CONFIG_HOME`, `BREW_CALLS`, and `BREWFILE_INPUT`.
- Produces: a regression contract requiring the fake Homebrew process to receive `bundle install --file=/dev/stdin --force-cleanup` and a Brewfile beginning with `tap "modem-dev/tap"`.

- [ ] **Step 1: Add the failing process-boundary test**

After rendering `default_script`, create a fake `brew` executable and execute the real rendered script:

```bash
fake_bin="$test_dir/bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/brew" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$BREW_CALLS"
if [[ ${1-} == bundle ]]; then
  cat >"$BREWFILE_INPUT"
fi
EOF
chmod +x "$fake_bin/brew"

brew_calls="$test_dir/brew-calls"
brewfile_input="$test_dir/Brewfile"
PATH="$fake_bin:$PATH" \
HOME="$test_dir/home" \
XDG_CONFIG_HOME="$test_dir/config" \
BREW_CALLS="$brew_calls" \
BREWFILE_INPUT="$brewfile_input" \
  bash "$default_script"

trust_call_count=$(grep -Fxc 'trust --formula modem-dev/tap/hunk' "$brew_calls" || true)
if [[ $trust_call_count -ne 2 ]]; then
  echo "rendered installer did not close the Brewfile heredoc before restoring tap trust" >&2
  exit 1
fi

if ! grep -Fqx 'bundle install --file=/dev/stdin --force-cleanup' "$brew_calls"; then
  echo "rendered installer did not use the supported strict brew bundle invocation" >&2
  exit 1
fi

if ! grep -Fqx 'tap "modem-dev/tap"' "$brewfile_input"; then
  echo "rendered installer did not pass the declared tap through the Brewfile" >&2
  exit 1
fi
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bash tests/darwin-install-packages-template.test.sh
```

Expected: FAIL with `rendered installer did not close the Brewfile heredoc before restoring tap trust`; only the pre-bundle trust call executes because the malformed heredoc consumes the rest of the script. After fixing that assertion, the captured bundle call must also omit the erroneous positional argument `modem-dev/tap`.

- [ ] **Step 3: Commit the contract**

```bash
git add tests/darwin-install-packages-template.test.sh
git commit -m "test: cover rendered Homebrew bundle invocation"
```

Keep this raw RED commit local until Task 2 is complete because shell tests have no expected-failure mechanism.

### Task 2: Render the supported strict Homebrew command

**Files:**
- Modify: `run_onchange_before_darwin-install-packages.sh.tmpl`
- Test: `tests/darwin-install-packages-template.test.sh`

**Interfaces:**
- Consumes: `.packages.darwin.taps`, `.packages.darwin.brews`, `.packages.darwin.casks`, and top-level `blocked_prefixes`.
- Produces: a rendered installer that invokes `brew bundle install --file=/dev/stdin --force-cleanup` and streams the complete Brewfile on stdin.

- [ ] **Step 1: Correct the command and heredoc boundary**

Replace the legacy command and prevent leading Go-template trimming from consuming the newline after the heredoc opener:

```bash
brew bundle install --file=/dev/stdin --force-cleanup <<EOF
{{ $blocked_prefixes := get . "blocked_prefixes" | default list -}}
```

Preserve the newline before the closing delimiter by changing the final cask loop action to:

```bash
{{- end }}
EOF
```

Replace the associated comments with:

```bash
# Authorize third-party tap formulae. Called twice: before the bundle, which
# cannot load them otherwise, and again after, because
# `brew bundle install --force-cleanup` prunes the allowlist and would leave
# interactive brew commands untrusted.

# packages.yaml is authoritative: --force-cleanup uninstalls anything
# installed that is not declared there.
```

- [ ] **Step 2: Run the focused test and verify GREEN**

Run:

```bash
bash tests/darwin-install-packages-template.test.sh
```

Expected: PASS with the fake Homebrew call and rendered Brewfile assertions satisfied.

- [ ] **Step 3: Run repository shell tests and static checks**

Run:

```bash
for test_file in tests/*.test.sh; do bash "$test_file"; done
chezmoi execute-template -f run_onchange_before_darwin-install-packages.sh.tmpl | bash -n
chezmoi diff --no-pager
```

Expected: all shell tests and syntax validation pass. `chezmoi diff` may still show unrelated local target drift but must report no template rendering error.

- [ ] **Step 4: Commit the implementation**

```bash
git add run_onchange_before_darwin-install-packages.sh.tmpl
git commit -m "fix(darwin): support Homebrew bundle v6"
```

The branch tip is GREEN before either Track A or Track B commit is published.
