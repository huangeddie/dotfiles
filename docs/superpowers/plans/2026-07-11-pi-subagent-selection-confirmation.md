# Pi Subagent Selection Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print the canonical model selector after `pi-subagent` successfully persists an interactive `fzf` selection.

**Architecture:** The existing `select_and_save_model` function owns the interactive flow and is the correct output boundary. It will print the already validated `model` only after `write_selection` completes, preserving the state schema and matching `--status` output. Bun process tests use the existing fake Pi and `fzf` executables; the manual QA procedure covers real interactive use.

**Tech Stack:** Bash 3.2, Bun test runner, chezmoi-managed files.

## Global Constraints

- Edit only chezmoi source state: `dot_local/bin/executable_pi-subagent` deploys as `~/.local/bin/pi-subagent`.
- A persisted selection remains exactly one newline-terminated `<provider>/<model>` string at `${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model`.
- A successful no-argument selection must print exactly that newly persisted selector followed by one newline.
- Cancellation and failed persistence must not print a selection confirmation or alter their current exit behavior.
- Unit tests must use fake `pi`, `fzf`, and temporary state; real Pi and terminal interactions remain in manual QA and outside automated hooks and CI.
- Bun has no general expected-failure semantics. Keep the raw RED Track A commit local until the Track B implementation makes the branch tip green.
- Keep Track A contract/verification and Track B implementation in separate Conventional Commit commits.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `tests/pi-subagent.test.ts` | Deterministic process-level contract for interactive selection output, state persistence, and cancellation. |
| `docs/qa/pi-subagent-model-selection.md` | Manually invoked real-Pi and real-`fzf` verification procedure. |
| `dot_local/bin/executable_pi-subagent` | Bash composition root that validates, atomically persists, then confirms an interactive selection. |

### Task 1: Selection confirmation contract and QA (RED / Track A)

**Files:**
- Modify: `tests/pi-subagent.test.ts: selects a live Pi model with no arguments and persists only its selector; fails when the picker is cancelled and writes no selection`
- Modify: `docs/qa/pi-subagent-model-selection.md: Procedure, step 3`

**Interfaces:**
- Consumes: no-argument wrapper invocation, fake `fzf` output, and the XDG state directory supplied by the test fixture.
- Produces: a contract requiring stdout to equal `<provider>/<model>\n` after a successful selection and to be empty after picker cancellation.
- Fakes: the existing `pi` and `fzf` commands in the test fixture; no real process, terminal, network, or production state.

- [ ] **Step 1: Add the failing successful-selection output assertion**

In `tests/pi-subagent.test.ts`, in `selects a live Pi model with no arguments and persists only its selector`, insert this assertion immediately after `expect(result.exitCode).toBe(0);`:

```ts
    expect(result.stdout).toBe("anthropic/claude-sonnet-5\\n");
```

This is the exact public stdout schema. Do not change the existing persisted-file assertion.

- [ ] **Step 2: Specify cancellation stdout**

In `fails when the picker is cancelled and writes no selection`, insert this assertion immediately after `expect(result.exitCode).toBe(130);`:

```ts
    expect(result.stdout).toBe("");
```

- [ ] **Step 3: Update manual QA output expectations**

Replace the expected paragraph in step 3 of `docs/qa/pi-subagent-model-selection.md` with:

```markdown
   Expected: the picker closes successfully, prints exactly the selected `provider/model` selector plus newline, and `${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model` contains that same selector plus newline.
```

- [ ] **Step 4: Run the focused test and confirm RED**

Run:

```bash
bun test tests/pi-subagent.test.ts
```

Expected: FAIL only at the new successful-selection stdout assertion, because the wrapper persists the model but has not yet printed it. The cancellation assertion and all unrelated tests pass.

- [ ] **Step 5: Commit Track A locally**

```bash
git add tests/pi-subagent.test.ts docs/qa/pi-subagent-model-selection.md
git commit -m "test: specify pi subagent selection confirmation"
```

Do not publish the raw RED commit. Bun does not offer general expected-failure semantics; keep it local until Task 2 is green.

### Task 2: Persist-then-confirm implementation (GREEN / Track B)

**Files:**
- Modify: `dot_local/bin/executable_pi-subagent: select_and_save_model()`
- Modify: `tests/pi-subagent.test.ts: successful-selection and cancellation confirmation contracts`

**Interfaces:**
- Consumes: validated `model` and `write_selection "$model"` in `select_and_save_model`.
- Produces: standard output containing exactly `<provider>/<model>\n` only after `write_selection` returns successfully.
- Invariants: `write_selection` remains the sole persistence boundary; the command does not invoke Pi as an agent; picker cancellation returns `130` without confirmation.

- [ ] **Step 1: Run the focused test to establish the pending RED contract**

Run:

```bash
bun test tests/pi-subagent.test.ts
```

Expected: FAIL only at `result.stdout` in the successful-selection test.

- [ ] **Step 2: Print only after successful atomic persistence**

In `select_and_save_model` in `dot_local/bin/executable_pi-subagent`, append this line immediately after the existing `write_selection "$model"` line:

```bash
  printf '%s\n' "$model"
```

Do not print before `write_selection`, and do not change the `fzf` failure branch. This ensures stdout confirms persisted state rather than merely a picker result.

- [ ] **Step 3: Run the focused deterministic unit tests**

Run:

```bash
bun test tests/pi-subagent.test.ts
```

Expected: PASS with all tests active. The successful selection prints `anthropic/claude-sonnet-5\n`; the cancellation result has empty stdout.

- [ ] **Step 4: Validate source syntax and the complete automated suite**

Run:

```bash
bash -n dot_local/bin/executable_pi-subagent
bun test
```

Expected: both commands exit zero.

- [ ] **Step 5: Inspect and deploy the chezmoi source change**

Run:

```bash
chezmoi diff ~/.local/bin/pi-subagent
chezmoi apply ~/.local/bin/pi-subagent
```

Expected: the diff adds only the post-persistence `printf` in the deployed wrapper; apply exits zero and updates `~/.local/bin/pi-subagent` from source state.

- [ ] **Step 6: Commit Track B implementation**

```bash
git add dot_local/bin/executable_pi-subagent
git commit -m "feat: confirm pi subagent model selection"
```

The local branch tip is now green and may be shared.

## Plan Self-Review

- **Spec coverage:** Task 1 defines and manually documents exact successful output and cancellation silence. Task 2 prints the selector after atomic persistence, preserving failure behavior and the existing state schema.
- **Placeholder scan:** Every modified file, exact assertion, implementation statement, command, and expected result is specified; no deferred work remains.
- **Type consistency:** The same canonical `<provider>/<model>` selector is used in stdout, fake picker output, and persisted state throughout.
