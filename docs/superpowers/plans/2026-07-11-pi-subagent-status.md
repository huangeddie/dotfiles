# Pi Subagent Status Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `pi-subagent --status` to print the persisted model selector without invoking Pi, `fzf`, or an agent.

**Architecture:** The existing `read_selection` function remains the sole state-file boundary: it validates and returns the persisted selector. The CLI dispatcher gets a `--status` branch that prints that value directly, avoiding the live-catalog effect used only by selection and prompt execution. Bun tests retain fake command binaries and temporary state directories to prove status has no Pi dependency.

**Tech Stack:** Bash, Bun test runner, chezmoi-managed files.

## Global Constraints

- Edit chezmoi source state only; `dot_local/bin/executable_pi-subagent` deploys as `~/.local/bin/pi-subagent`.
- The persisted schema is exactly one non-empty `provider/model` selector followed by a newline at `${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model`.
- `--status` must not invoke Pi, `fzf`, or an agent, including when Pi cannot load a catalog.
- Unit tests use the existing fake executables and temporary filesystem; QA remains manual and excluded from hooks and CI.
- Keep contract/tests and implementation in separate Conventional Commit commits.

---

### Task 1: Status command contract, tests, and QA procedure

**Files:**
- Modify: `tests/pi-subagent.test.ts: describe("pi-subagent")`
- Modify: `docs/qa/pi-subagent-model-selection.md: Procedure`

**Interfaces:**
- Consumes: wrapper invocation `pi-subagent --status` and the persisted state-file schema.
- Produces: a skipped contract test that asserts `stdout === "anthropic/claude-sonnet-5\\n"`, plus QA instructions for the command.

- [ ] **Step 1: Add the status command contract tests**

Insert these tests immediately after `uses a valid persisted selection for a prompt` in `tests/pi-subagent.test.ts`:

```ts
  test.skip("prints the persisted model without invoking Pi", async () => {
    await mkdir(join(stateHome, "pi"), { recursive: true });
    await writeFile(join(stateHome, "pi", "subagent-model"), "anthropic/claude-sonnet-5\\n");

    const result = await run(["--status"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("anthropic/claude-sonnet-5\\n");
    await expect(readFile(callPath, "utf8")).rejects.toThrow();
  });

  test.skip("rejects status when no model is selected without invoking Pi", async () => {
    const result = await run(["--status"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("no model is selected");
    await expect(readFile(callPath, "utf8")).rejects.toThrow();
  });

  test.skip("rejects status when the persisted selection is malformed", async () => {
    await mkdir(join(stateHome, "pi"), { recursive: true });
    await writeFile(join(stateHome, "pi", "subagent-model"), "openai-codex/gpt-5.6-luna\\nanthropic/claude-sonnet-5\\n");

    const result = await run(["--status"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("model selection is invalid");
    await expect(readFile(callPath, "utf8")).rejects.toThrow();
  });
```

- [ ] **Step 2: Update the manual QA procedure**

Insert a new step after existing step 3 in `docs/qa/pi-subagent-model-selection.md`:

```markdown
4. Verify the persisted model can be displayed without starting Pi:

   ```bash
   pi-subagent --status
   ```

   Expected: it prints exactly the selected `provider/model` selector and exits successfully; no model request is made.
```

Renumber the remaining QA steps from 4 and 5 to 5 and 6.

- [ ] **Step 3: Run the focused test file and verify the contract tests are skipped**

Run:

```bash
bun test tests/pi-subagent.test.ts
```

Expected: PASS with three skipped `--status` tests; all pre-existing tests pass.

- [ ] **Step 4: Commit Track A contracts and verification**

```bash
git add tests/pi-subagent.test.ts docs/qa/pi-subagent-model-selection.md
git commit -m "test: specify pi subagent status command"
```

### Task 2: Status command implementation

**Files:**
- Modify: `dot_local/bin/executable_pi-subagent: usage() and one-argument dispatcher`
- Modify: `tests/pi-subagent.test.ts: three status tests`

**Interfaces:**
- Consumes: `--status` and `read_selection`, which writes the valid persisted selector to standard output or exits with its existing diagnostic.
- Produces: `pi-subagent --status`, which writes exactly `<provider>/<model>\n` to standard output and has no Pi or `fzf` invocation.

- [ ] **Step 1: Run the focused test file and verify the skipped contracts describe the missing behavior**

Run:

```bash
bun test tests/pi-subagent.test.ts
```

Expected: PASS with three skipped `--status` tests because the wrapper does not yet recognize the option.

- [ ] **Step 2: Document the new CLI invocation**

In the `usage()` heredoc in `dot_local/bin/executable_pi-subagent`, add this line after the no-argument selection line:

```bash
  ${0##*/} --status               Display the persisted Pi model
```

- [ ] **Step 3: Route the command directly to the state boundary**

In the one-argument `case "$1" in` dispatcher in `dot_local/bin/executable_pi-subagent`, insert this branch before `--list-models`:

```bash
  --status)
    read_selection
    ;;
```

Do not call `load_catalog`, `pi`, or `fzf` in this branch. `read_selection` already provides the exact stdout schema and error behavior.

- [ ] **Step 4: Activate the contract tests**

Change only the three tests added in Task 1 from `test.skip(` to `test(`. Preserve their assertions exactly.

- [ ] **Step 5: Run the focused unit tests**

Run:

```bash
bun test tests/pi-subagent.test.ts
```

Expected: PASS with all tests active and no skips.

- [ ] **Step 6: Inspect the deployable chezmoi change**

Run:

```bash
chezmoi diff ~/.local/bin/pi-subagent
```

Expected: the diff contains `~/.local/bin/pi-subagent` changes only for the usage text and `--status` branch.

- [ ] **Step 7: Commit Track B implementation**

```bash
git add dot_local/bin/executable_pi-subagent tests/pi-subagent.test.ts
git commit -m "feat: add pi subagent status command"
```
