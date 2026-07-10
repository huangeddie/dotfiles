# Pi Subagent Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `pi-subagent` select and persist any model currently listed by Pi, and use that selection for future prompt runs.

**Architecture:** The Bash wrapper is the composition root. It queries Pi's live `--list-models` catalog, stores one canonical `provider/model` selection in XDG state, and invokes the child Pi process with that selector. Bun tests exercise the wrapper as a process while faking its Pi, picker, and filesystem boundaries.

**Tech Stack:** Bash, Pi CLI, `fzf`, Bun test, Node filesystem APIs.

## Global Constraints

- Pi's current `--list-models` output is the sole model catalog authority; do not add a wrapper model config.
- Selection state is exactly `${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model`, is untracked by chezmoi, and has one newline-terminated `provider/model` value.
- `pi-subagent` with no arguments opens selection; it never selects a default model.
- Prompt runs must reject missing or stale selections before launching a child Pi agent.
- Automated tests must fake `pi`, `fzf`, and state storage; real integration checks belong only in manual QA documentation.
- Bun has no general expected-failure facility. Keep the raw RED test commit local until the implementation commit makes the branch tip green.
- The deployed wrapper uses `/bin/bash`; its source is mode `0644` because chezmoi derives executable mode from the `executable_` filename. Tests must invoke the source via `/bin/bash`, and the implementation must support macOS Bash 3.2.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `dot_local/bin/executable_pi-subagent` | Parse wrapper arguments; obtain and validate Pi catalog rows; select, read, and atomically write state; launch child Pi. |
| `tests/pi-subagent.test.ts` | Deterministic process-level unit tests with fake executables and temporary XDG state. |
| `docs/qa/pi-subagent-model-selection.md` | Manually invoked real-Pi and real-`fzf` validation procedure; excluded from automated hooks. |

### Task 1: Define the wrapper contract with deterministic fakes (RED / Track A)

**Files:**
- Create: `tests/pi-subagent.test.ts`

**Interfaces:**
- Consumes: `dot_local/bin/executable_pi-subagent` executable, `PATH`, and `XDG_STATE_HOME`.
- Produces: a process-level contract for no-argument selection, stored-state prompt runs, stale-state rejection, and one-call overrides.
- Fakes: a `pi` executable accepting `--list-models` or recording child arguments, and an `fzf` executable returning a controlled picker row.

- [ ] **Step 1: Write the failing test fixture and behavioral tests**

Create `tests/pi-subagent.test.ts` with the following content. The fake `pi` emits an existing Pi table shape, while the fake `fzf` emits only state supplied by each test. No network, interactive terminal, clock, or production state is used.

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const wrapper = new URL("../dot_local/bin/executable_pi-subagent", import.meta.url).pathname;
const catalog = [
  "provider      model             context  max-out  thinking  images",
  "openai-codex  gpt-5.6-luna      272K     128K     yes       no",
  "anthropic     claude-sonnet-5   1M       128K     yes       yes",
].join("\n");

let sandbox = "";
let bin = "";
let stateHome = "";
let catalogPath = "";
let callPath = "";

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content);
  await chmod(path, 0o755);
}

async function run(args: string[], extraEnv: Record<string, string> = {}) {
  const result = Bun.spawnSync(["/bin/bash", wrapper, ...args], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      XDG_STATE_HOME: stateHome,
      PI_SUBAGENT_TEST_CATALOG: catalogPath,
      PI_SUBAGENT_TEST_CALL: callPath,
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "pi-subagent-test-"));
  bin = join(sandbox, "bin");
  stateHome = join(sandbox, "state");
  catalogPath = join(sandbox, "catalog.txt");
  callPath = join(sandbox, "pi-call.bin");
  await mkdir(bin);
  await writeFile(catalogPath, catalog);

  await writeExecutable(
    join(bin, "pi"),
    `#!/bin/bash
set -euo pipefail
if [[ "${1:-}" == "--list-models" ]]; then
  cat "$PI_SUBAGENT_TEST_CATALOG"
  exit 0
fi
printf '%s\\0' "$@" > "$PI_SUBAGENT_TEST_CALL"
`,
  );
  await writeExecutable(
    join(bin, "fzf"),
    `#!/bin/bash
set -euo pipefail
if [[ "${PI_SUBAGENT_TEST_FZF_STATUS:-0}" != 0 ]]; then
  exit "$PI_SUBAGENT_TEST_FZF_STATUS"
fi
printf '%s\\n' "$PI_SUBAGENT_TEST_FZF_OUTPUT"
`,
  );
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("pi-subagent", () => {
  test("selects a live Pi model with no arguments and persists only its selector", async () => {
    const result = await run([], {
      PI_SUBAGENT_TEST_FZF_OUTPUT:
        "anthropic/claude-sonnet-5\\tanthropic     claude-sonnet-5   1M       128K     yes       yes",
    });

    expect(result.exitCode).toBe(0);
    await expect(readFile(join(stateHome, "pi", "subagent-model"), "utf8")).resolves.toBe(
      "anthropic/claude-sonnet-5\\n",
    );
    await expect(readFile(callPath, "utf8")).rejects.toThrow();
  });

  test("uses a valid persisted selection for a prompt", async () => {
    await mkdir(join(stateHome, "pi"), { recursive: true });
    await writeFile(join(stateHome, "pi", "subagent-model"), "anthropic/claude-sonnet-5\\n");

    const result = await run(["inspect this repository"]);

    expect(result.exitCode).toBe(0);
    await expect(readFile(callPath)).resolves.toEqual(
      Buffer.from("--model\\0anthropic/claude-sonnet-5\\0-p\\0inspect this repository\\0"),
    );
  });

  test("rejects a missing selection instead of launching a default model", async () => {
    const result = await run(["inspect this repository"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("pi-subagent");
    await expect(readFile(callPath, "utf8")).rejects.toThrow();
  });

  test("rejects a stale persisted selection instead of replacing it", async () => {
    await mkdir(join(stateHome, "pi"), { recursive: true });
    await writeFile(join(stateHome, "pi", "subagent-model"), "openai-codex/removed-model\\n");

    const result = await run(["inspect this repository"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("no longer available");
    await expect(readFile(callPath, "utf8")).rejects.toThrow();
  });

  test("uses a valid --model override without changing persisted state", async () => {
    const result = await run(["--model", "openai-codex/gpt-5.6-luna", "inspect this repository"]);

    expect(result.exitCode).toBe(0);
    await expect(readFile(callPath)).resolves.toEqual(
      Buffer.from("--model\\0openai-codex/gpt-5.6-luna\\0-p\\0inspect this repository\\0"),
    );
    await expect(readFile(join(stateHome, "pi", "subagent-model"), "utf8")).rejects.toThrow();
  });

  test("fails when the picker is cancelled and writes no selection", async () => {
    const result = await run([], {
      PI_SUBAGENT_TEST_FZF_OUTPUT: "",
      PI_SUBAGENT_TEST_FZF_STATUS: "130",
    });

    expect(result.exitCode).toBe(130);
    await expect(readFile(join(stateHome, "pi", "subagent-model"), "utf8")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the focused test file and confirm RED**

Run:

```bash
bun test tests/pi-subagent.test.ts
```

Expected: FAIL. The current wrapper rejects no arguments, ignores persisted state, has no `--model` interface, and hardcodes `openai-codex/gpt-5.6-luna`.

- [ ] **Step 3: Commit the test contract locally**

```bash
git add tests/pi-subagent.test.ts
git commit -m "test: define pi subagent model selection contract"
```

Do not publish this raw RED commit. Bun does not provide the required general expected-failure semantics, so it remains local until Task 2 makes the branch green.

### Task 2: Implement live selection, validated state, and manual QA (GREEN / Track B)

**Files:**
- Modify: `dot_local/bin/executable_pi-subagent`
- Create: `docs/qa/pi-subagent-model-selection.md`

**Interfaces:**
- Consumes: Pi table output from `pi --list-models`; `fzf` on `PATH`; `XDG_STATE_HOME`; command forms defined in Task 1.
- Produces: a persisted state file containing one validated selector; child invocation `pi --model <selector> -p <prompt>`.
- Invariants: no silent default; state and explicit selectors must be present in a freshly loaded Pi catalog; only selection writes state.

- [ ] **Step 1: Replace the hardcoded wrapper with the complete implementation**

Replace `dot_local/bin/executable_pi-subagent` with:

```bash
#!/bin/bash
set -euo pipefail
umask 077

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/pi"
STATE_FILE="$STATE_DIR/subagent-model"
MODEL_IDS=()
MODEL_ROWS=()

usage() {
  cat >&2 <<EOF
usage:
  ${0##*/}                         Select and persist a Pi model
  ${0##*/} <prompt>                Run with the persisted model
  ${0##*/} --model <provider/model> <prompt>
                                   Run once with a live Pi model
  ${0##*/} --list-models           List models currently available in Pi
EOF
}

die() {
  echo "${0##*/}: $*" >&2
  exit 2
}

load_catalog() {
  local output line provider model ignored
  local -i line_number=0

  if ! output="$(pi --list-models)"; then
    die "could not list Pi models"
  fi

  MODEL_IDS=()
  MODEL_ROWS=()
  while IFS= read -r line; do
    ((line_number += 1))
    if ((line_number == 1)); then
      continue
    fi
    if [[ -z "$line" ]]; then
      continue
    fi

    read -r provider model ignored <<<"$line"
    if [[ -z "$provider" || -z "$model" ]]; then
      die "Pi returned a malformed model row: $line"
    fi

    MODEL_IDS+=("$provider/$model")
    MODEL_ROWS+=("$provider/$model"$'\t'"$line")
  done <<<"$output"

  if ((${#MODEL_IDS[@]} == 0)); then
    die "Pi has no selectable models"
  fi
}

model_is_available() {
  local wanted="$1"
  local model
  for model in "${MODEL_IDS[@]}"; do
    if [[ "$model" == "$wanted" ]]; then
      return 0
    fi
  done
  return 1
}

read_selection() {
  local selection extra

  if [[ ! -r "$STATE_FILE" ]]; then
    die "no model is selected; run ${0##*/} to choose one"
  fi

  exec 3<"$STATE_FILE" || die "could not read model selection"
  if ! IFS= read -r selection <&3; then
    exec 3<&-
    die "model selection is invalid; run ${0##*/} to choose one"
  fi
  if IFS= read -r extra <&3; then
    exec 3<&-
    die "model selection is invalid; run ${0##*/} to choose one"
  fi
  exec 3<&-

  if [[ -z "$selection" ]]; then
    die "model selection is invalid; run ${0##*/} to choose one"
  fi

  printf '%s\n' "$selection"
}

write_selection() {
  local model="$1"
  local temporary_file

  mkdir -p "$STATE_DIR" || die "could not create model state directory"
  temporary_file="$(mktemp "$STATE_DIR/.subagent-model.XXXXXX")" || die "could not create temporary selection"
  chmod 600 "$temporary_file" || die "could not secure temporary selection"
  printf '%s\n' "$model" >"$temporary_file" || die "could not write model selection"
  mv "$temporary_file" "$STATE_FILE" || die "could not save model selection"
}

select_and_save_model() {
  local picked model

  if ! command -v fzf >/dev/null 2>&1; then
    die "fzf is required to select a model"
  fi

  if ! picked="$(printf '%s\n' "${MODEL_ROWS[@]}" | fzf --prompt='Pi subagent model> ')"; then
    return 130
  fi

  model="${picked%%$'\t'*}"
  if ! model_is_available "$model"; then
    die "picker returned an invalid model selection"
  fi

  write_selection "$model"
}

run_prompt() {
  local model="$1"
  local prompt="$2"

  load_catalog
  if ! model_is_available "$model"; then
    die "selected model '$model' is no longer available; run ${0##*/} to choose one"
  fi

  exec pi --model "$model" -p "$prompt"
}

case "$#" in
0)
  load_catalog
  select_and_save_model
  ;;
1)
  case "$1" in
  -h | --help)
    usage
    ;;
  --list-models)
    pi --list-models
    ;;
  *)
    run_prompt "$(read_selection)" "$1"
    ;;
  esac
  ;;
3)
  if [[ "$1" != "--model" ]]; then
    usage
    exit 2
  fi
  run_prompt "$2" "$3"
  ;;
*)
  usage
  exit 2
  ;;
esac
```

- [ ] **Step 2: Add the manual QA procedure**

Create `docs/qa/pi-subagent-model-selection.md`:

```markdown
# Pi Subagent Model Selection QA

Run this procedure manually after applying the chezmoi source changes. It is not part of CI, pre-commit, or pre-push.

## Preconditions

- `pi --list-models` prints at least one selectable model.
- `fzf` is installed and can render in the current terminal.
- Run `chezmoi apply` so `~/.local/bin/pi-subagent` uses the updated source.

## Procedure

1. Remove only the wrapper's local state:

   ```bash
   rm -f "${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model"
   ```

2. Verify a prompt is rejected before selection:

   ```bash
   pi-subagent "Reply with exactly: should not run"
   ```

   Expected: a nonzero exit and a diagnostic telling you to run `pi-subagent`; no model request is made.

3. Run `pi-subagent` with no arguments, select a visible model in `fzf`, and accept it.

   Expected: the picker closes successfully and `${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model` contains exactly the selected `provider/model` plus newline.

4. Verify the saved model is usable:

   ```bash
   pi-subagent "Reply with exactly: selected model works"
   ```

   Expected: Pi runs with the selected model and prints `selected model works`.

5. Verify the one-call override leaves persisted state unchanged:

   ```bash
   before="$(cat "${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model")"
   pi-subagent --model "$before" "Reply with exactly: override works"
   test "$before" = "$(cat "${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model")"
   ```

   Expected: Pi prints `override works`; the final `test` exits zero.
```

- [ ] **Step 3: Run the focused test file and confirm GREEN**

Run:

```bash
bun test tests/pi-subagent.test.ts
```

Expected: PASS for all six tests.

- [ ] **Step 4: Run static syntax validation and the existing automated suite**

Run:

```bash
bash -n dot_local/bin/executable_pi-subagent
bun test
chezmoi diff
```

Expected: Bash syntax succeeds; Bun tests pass; chezmoi diff shows only the changed deployed wrapper and the test/QA source files remain source-only.

- [ ] **Step 5: Commit the implementation after GREEN**

```bash
git add dot_local/bin/executable_pi-subagent docs/qa/pi-subagent-model-selection.md
git commit -m "feat: select pi subagent model"
```

The local branch may now be shared because its tip is GREEN. Keep the Track A test commit and Track B implementation commit separate.

## Plan Self-Review

- **Spec coverage:** Task 1 covers the persisted-state and argument contracts. Task 2 implements live Pi catalog discovery, `fzf` selection, atomic XDG state, prompt/override validation, child construction, and manual QA. No wrapper catalog is introduced.
- **Placeholder scan:** No task uses deferred work or generic testing instructions; every file, command, test behavior, and implementation body is specified.
- **Type consistency:** The selector is consistently `provider/model`; the state path, `--model` argument, fake Pi catalog, and Pi child invocation all use that form.
