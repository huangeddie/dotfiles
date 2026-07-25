# Pi Subagent Model Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace eight backend-prefixed Pi subagents with four generic roles whose model assignment determines their rendered backend, model identifier, and tools.

**Architecture:** Chezmoi data owns per-role stable model aliases, an explicit alias-to-backend catalog, and role/backend tool policies. A shared chezmoi template validates and renders YAML front matter, while four role templates own backend-neutral prompt bodies; the existing subagent extension remains unchanged and routes the rendered definitions.

**Tech Stack:** chezmoi YAML data, Go text templates with Sprig functions, Markdown agent definitions, Bun tests, Pi and Claude CLI backend adapters.

## Global Constraints

- Edit only chezmoi source state under `/Users/eddiehuang/.local/share/chezmoi`; never edit deployed `~/.pi/agent` files except the temporary invalid-definition step explicitly documented in manual QA.
- Commit directly to `main`; do not create a worktree or feature branch.
- The only deployed agent names are `scout`, `planner`, `reviewer`, and `worker`; do not retain `gpt-*` or `claude-*` compatibility aliases.
- `assignments` is the only routinely edited configuration; backend and backend-native model identifiers come from the explicit model catalog.
- Use versioned aliases `claude-haiku-5` and `claude-sonnet-5`; map them to Claude CLI selectors `haiku` and `sonnet`.
- Do not infer a backend from alias text and do not add runtime backend/model parameters to the `subagent` tool.
- Derive tools from the role/backend policy. For Pi only, an explicit YAML `null` means omit `tools` and use Pi defaults; Claude requires a non-empty allowlist.
- Missing assignments, unknown aliases, missing backend/model fields, unsupported backends, and missing tool policies must fail template rendering without fallback.
- Do not change `dot_pi/agent/exact_extensions/subagent/`; its parsed front-matter and backend-routing contracts already support the design.
- Keep automated tests free of production Pi/Claude model calls, network calls, terminal UI, clocks, and sampling.
- Keep manual production QA out of hooks and CI.
- Treat the data schema and QA procedure as Track A commits and rendering/workflow changes as a separate Track B commit.

## File Structure

| File | Responsibility |
| --- | --- |
| `.chezmoidata/pi/subagents.yaml` | Per-role assignments, stable model catalog, and role/backend tool policies. |
| `.chezmoitemplates/pi-subagent-frontmatter.tmpl` | Validate the data contract and render backend-specific front matter. |
| `dot_pi/agent/exact_agents/scout.md.tmpl` | Scout front-matter invocation and backend-neutral scout body. |
| `dot_pi/agent/exact_agents/planner.md.tmpl` | Planner front-matter invocation and backend-neutral planner body. |
| `dot_pi/agent/exact_agents/reviewer.md.tmpl` | Reviewer front-matter invocation and backend-neutral reviewer body. |
| `dot_pi/agent/exact_agents/worker.md.tmpl` | Worker front-matter invocation and backend-neutral worker body. |
| `dot_pi/agent/prompts/implement.md` | Generic scout → planner → worker workflow. |
| `dot_pi/agent/prompts/scout-and-plan.md` | Generic scout → planner workflow. |
| `dot_pi/agent/prompts/implement-and-review.md` | Generic worker → reviewer → worker workflow. |
| `docs/qa/pi-subagent-backends.md` | Manual verification across rendered Pi and Claude assignments. |

---

### Task 1: Model Assignment Data Contract

**Files:**
- Create: `.chezmoidata/pi/subagents.yaml`

**Interfaces:**
- Produces: `.subagents.assignments: map<role, modelAlias>` for the role templates.
- Produces: `.subagents.models: map<modelAlias, { backend, model }>` for backend routing.
- Produces: `.subagents.tools: map<role, map<backend, string | null>>` for backend-native permissions.
- Consumed by: `.chezmoitemplates/pi-subagent-frontmatter.tmpl` in Task 3.

This is a configuration-schema migration, so it uses the project's TDD exception rather than adding a test for chezmoi's YAML loader.

- [ ] **Step 1: Create the nested chezmoi data file**

Create `.chezmoidata/pi/subagents.yaml` with exactly:

```yaml
subagents:
  assignments:
    scout: gpt-5.6-luna
    planner: gpt-5.6-terra
    reviewer: gpt-5.6-terra
    worker: gpt-5.6-terra

  models:
    gpt-5.6-luna:
      backend: pi
      model: openai-codex/gpt-5.6-luna
    gpt-5.6-terra:
      backend: pi
      model: openai-codex/gpt-5.6-terra
    claude-haiku-5:
      backend: claude
      model: haiku
    claude-sonnet-5:
      backend: claude
      model: sonnet

  tools:
    scout:
      pi: read, grep, find, ls, bash
      claude: Read, Grep, Glob, Bash, WebSearch, WebFetch
    planner:
      pi: read, grep, find, ls
      claude: Read, Grep, Glob, WebSearch, WebFetch
    reviewer:
      pi: read, grep, find, ls, bash
      claude: Read, Grep, Glob, Bash, WebSearch, WebFetch
    worker:
      pi: null
      claude: Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch
```

- [ ] **Step 2: Verify chezmoi loads the nested file into the intended namespace**

Run:

```bash
chezmoi data --format json | jq '.subagents'
```

Expected: an object with exactly the top-level keys `assignments`, `models`, and `tools`; the data must appear under `.subagents`, not `.pi.subagents`.

- [ ] **Step 3: Check formatting and commit the Track A schema**

Run:

```bash
git diff --check
git add .chezmoidata/pi/subagents.yaml
git commit -m "feat(pi): define subagent model assignments"
```

Expected: commit succeeds and only `.chezmoidata/pi/subagents.yaml` is included.

---

### Task 2: Generic-Agent Manual QA Contract

**Files:**
- Modify: `docs/qa/pi-subagent-backends.md`

**Interfaces:**
- Consumes: aliases and roles from `.chezmoidata/pi/subagents.yaml`.
- Produces: a manual-only QA procedure for generic names, per-role assignment changes, mixed backends, cancellation, strict invalid-definition rejection, and rendering.
- Does not run in: pre-commit, pre-push, or CI.

- [ ] **Step 1: Update setup and cleanup around model assignments**

In `docs/qa/pi-subagent-backends.md`, retain the title and manual-only warning. Replace the prerequisites with these exact requirements:

````markdown
## Prerequisites

- Authenticate both production CLIs: `pi` and `claude`.
- Use a trusted, disposable repository. These checks invoke production models and may read or modify files according to the selected agent tools.
- Back up `.chezmoidata/pi/subagents.yaml`, then temporarily use this assignment matrix:

  ```yaml
  assignments:
    scout: claude-haiku-5
    planner: gpt-5.6-terra
    reviewer: claude-sonnet-5
    worker: gpt-5.6-terra
  ```

- Apply the managed source state: `chezmoi apply ~/.pi/agent/agents ~/.pi/agent/prompts`.
- Start Pi from the disposable repository and run `/reload` after applying configuration changes.

Restore the original assignment data and every temporary deployed-file edit before considering this procedure complete.
````

- [ ] **Step 2: Replace backend-prefixed QA invocations with generic roles**

Make these exact semantic replacements throughout the seven checks:

| Existing reference | Replacement |
| --- | --- |
| GPT scout success / `gpt-scout` | Pi planner success / `planner` |
| Claude scout / `claude-scout` | Claude scout / `scout` |
| Parallel `gpt-scout` + `claude-scout` | Parallel `planner` + `scout` |
| Chain `claude-scout` → `gpt-planner` | Chain `scout` → `planner` |
| Claude cancellation via `claude-scout` | Claude cancellation via `scout` |
| Invalid deployed `claude-scout.md` | Invalid deployed `scout.md` |
| Header `gpt-scout (user, pi)` | Header `planner (user, pi)` |
| Header `claude-scout (user, claude)` | Header `scout (user, claude)` |

Keep the existing assertions for input order, backend labels, `{previous}` substitution, cancellation, no fallback, expanded events, and usage. In the Pi planner check, ask it to read and summarize `README.md` without modifications; do not require Bash because the planner policy does not include it.

- [ ] **Step 3: Replace cleanup with source-state restoration**

Use this cleanup section:

````markdown
## Cleanup

Restore the backed-up `.chezmoidata/pi/subagents.yaml`, remove or revert all disposable-repository changes, and discard any temporary deployed-agent edit. Then restore managed state:

```bash
chezmoi apply ~/.pi/agent/agents ~/.pi/agent/prompts
```

Run `/reload` in an existing Pi session, or start a fresh session.
````

- [ ] **Step 4: Review and commit the Track A QA contract**

Run:

```bash
rg -n '(gpt|claude)-(scout|planner|reviewer|worker)' docs/qa/pi-subagent-backends.md
git diff --check
git add docs/qa/pi-subagent-backends.md
git commit -m "test(pi): define model-driven subagent QA"
```

Expected: `rg` returns no backend-prefixed agent names; versioned model aliases such as `gpt-5.6-terra` and `claude-haiku-5` remain allowed. The commit contains only the QA document.

---

### Task 3: Shared Front Matter and Four Canonical Agents

**Files:**
- Create: `.chezmoitemplates/pi-subagent-frontmatter.tmpl`
- Delete: `dot_pi/agent/exact_agents/claude-planner.md`
- Delete: `dot_pi/agent/exact_agents/claude-reviewer.md`
- Delete: `dot_pi/agent/exact_agents/claude-scout.md`
- Delete: `dot_pi/agent/exact_agents/claude-worker.md`
- Delete: `dot_pi/agent/exact_agents/gpt-planner.md`
- Delete: `dot_pi/agent/exact_agents/gpt-reviewer.md`
- Delete: `dot_pi/agent/exact_agents/gpt-scout.md`
- Delete: `dot_pi/agent/exact_agents/gpt-worker.md`
- Create: `dot_pi/agent/exact_agents/scout.md.tmpl`
- Create: `dot_pi/agent/exact_agents/planner.md.tmpl`
- Create: `dot_pi/agent/exact_agents/reviewer.md.tmpl`
- Create: `dot_pi/agent/exact_agents/worker.md.tmpl`
- Modify: `dot_pi/agent/prompts/implement.md`
- Modify: `dot_pi/agent/prompts/scout-and-plan.md`
- Modify: `dot_pi/agent/prompts/implement-and-review.md`

**Interfaces:**
- Consumes: `.subagents.assignments`, `.subagents.models`, and `.subagents.tools` from Task 1.
- Produces: template `pi-subagent-frontmatter.tmpl`, called with `dict("root", ., "role", string, "description", string)`.
- Produces: rendered definitions accepted by `parseAgentDefinition(content, filePath, source)`.
- Produces: generic workflow references consumed by the `subagent` tool.

This task changes managed configuration and prompt content, so it uses the project's configuration-change TDD exception. Existing Bun tests provide regression coverage for the parser and routing contracts.

- [ ] **Step 1: Create the validating shared front-matter template**

Create `.chezmoitemplates/pi-subagent-frontmatter.tmpl` with exactly:

```gotemplate
{{- $root := .root -}}
{{- $role := .role -}}
{{- $description := .description -}}
{{- if not (hasKey $root.subagents.assignments $role) -}}
  {{- fail (printf "pi subagent role %q has no model assignment" $role) -}}
{{- end -}}
{{- $alias := index $root.subagents.assignments $role -}}
{{- if or (not (kindIs "string" $alias)) (empty (trim $alias)) -}}
  {{- fail (printf "pi subagent role %q requires a non-empty model alias" $role) -}}
{{- end -}}
{{- if not (hasKey $root.subagents.models $alias) -}}
  {{- fail (printf "pi subagent role %q references unknown model alias %q" $role $alias) -}}
{{- end -}}
{{- $modelConfig := index $root.subagents.models $alias -}}
{{- if not (kindIs "map" $modelConfig) -}}
  {{- fail (printf "pi subagent model alias %q must be a mapping" $alias) -}}
{{- end -}}
{{- if not (hasKey $modelConfig "backend") -}}
  {{- fail (printf "pi subagent model alias %q requires backend" $alias) -}}
{{- end -}}
{{- if not (hasKey $modelConfig "model") -}}
  {{- fail (printf "pi subagent model alias %q requires model" $alias) -}}
{{- end -}}
{{- $backend := index $modelConfig "backend" -}}
{{- $model := index $modelConfig "model" -}}
{{- if or (not (kindIs "string" $backend)) (empty (trim $backend)) -}}
  {{- fail (printf "pi subagent model alias %q requires a non-empty backend" $alias) -}}
{{- end -}}
{{- if not (or (eq $backend "pi") (eq $backend "claude")) -}}
  {{- fail (printf "pi subagent model alias %q has unsupported backend %q" $alias $backend) -}}
{{- end -}}
{{- if or (not (kindIs "string" $model)) (empty (trim $model)) -}}
  {{- fail (printf "pi subagent model alias %q requires a non-empty model" $alias) -}}
{{- end -}}
{{- if not (hasKey $root.subagents.tools $role) -}}
  {{- fail (printf "pi subagent role %q has no tool policies" $role) -}}
{{- end -}}
{{- $roleTools := index $root.subagents.tools $role -}}
{{- if not (kindIs "map" $roleTools) -}}
  {{- fail (printf "pi subagent role %q tool policies must be a mapping" $role) -}}
{{- end -}}
{{- if not (hasKey $roleTools $backend) -}}
  {{- fail (printf "pi subagent role %q has no tool policy for backend %q" $role $backend) -}}
{{- end -}}
{{- $tools := index $roleTools $backend -}}
{{- if and (eq $backend "claude") (eq $tools nil) -}}
  {{- fail (printf "pi subagent role %q requires non-empty tools for backend %q" $role $backend) -}}
{{- end -}}
{{- if and (ne $tools nil) (or (not (kindIs "string" $tools)) (empty (trim $tools))) -}}
  {{- fail (printf "pi subagent role %q requires non-empty tools for backend %q or explicit null" $role $backend) -}}
{{- end -}}
---
name: {{ $role | quote }}
description: {{ $description | quote }}
backend: {{ $backend | quote }}
model: {{ $model | quote }}
{{ if ne $tools nil -}}
tools: {{ $tools | quote }}
{{ end -}}
---
```

- [ ] **Step 2: Replace scout variants with one canonical scout**

Delete `gpt-scout.md` and `claude-scout.md`. Create `scout.md.tmpl` with:

````markdown
{{ template "pi-subagent-frontmatter.tmpl" (dict "root" . "role" "scout" "description" "Fast codebase reconnaissance that returns compressed context for handoff") }}

You are a scout. Quickly investigate a codebase and return structured findings that another agent can use without re-reading everything.

Your output will be passed to an agent who has NOT seen the files you explored.

Thoroughness (infer from task, default medium):
- Quick: Targeted lookups, key files only
- Medium: Follow imports, read critical sections
- Thorough: Trace all dependencies, check tests/types

Strategy:
1. grep/find to locate relevant code
2. Read key sections (not entire files)
3. Identify types, interfaces, key functions
4. Note dependencies between files

Output format:

## Files Retrieved
List with exact line ranges:
1. `path/to/file.ts` (lines 10-50) - Description of what's here
2. `path/to/other.ts` (lines 100-150) - Description
3. ...

## Key Code
Critical types, interfaces, or functions:

```typescript
interface Example {
  // actual code from the files
}
```

```typescript
function keyFunction() {
  // actual implementation
}
```

## Architecture
Brief explanation of how the pieces connect.

## Start Here
Which file to look at first and why.
````

- [ ] **Step 3: Replace planner variants with one canonical planner**

Delete `gpt-planner.md` and `claude-planner.md`. Create `planner.md.tmpl` with:

```markdown
{{ template "pi-subagent-frontmatter.tmpl" (dict "root" . "role" "planner" "description" "Creates implementation plans from context and requirements") }}

You are a planning specialist. You receive context (from a scout) and requirements, then produce a clear implementation plan.

You must NOT make any changes. Only read, analyze, and plan.

Input format you'll receive:
- Context/findings from a scout agent
- Original query or requirements

Output format:

## Goal
One sentence summary of what needs to be done.

## Plan
Numbered steps, each small and actionable:
1. Step one - specific file/function to modify
2. Step two - what to add/change
3. ...

## Files to Modify
- `path/to/file.ts` - what changes
- `path/to/other.ts` - what changes

## New Files (if any)
- `path/to/new.ts` - purpose

## Risks
Anything to watch out for.

Keep the plan concrete. The worker agent will execute it verbatim.
```

- [ ] **Step 4: Replace reviewer variants with one canonical reviewer**

Delete `gpt-reviewer.md` and `claude-reviewer.md`. Create `reviewer.md.tmpl` with:

```markdown
{{ template "pi-subagent-frontmatter.tmpl" (dict "root" . "role" "reviewer" "description" "Reviews code for quality, security, and maintainability") }}

You are a senior code reviewer. Analyze code for quality, security, and maintainability.

Bash is for read-only commands only: `git diff`, `git log`, `git show`. Do NOT modify files or run builds.
Assume tool permissions are not perfectly enforceable; keep all bash usage strictly read-only.

Strategy:
1. Run `git diff` to see recent changes (if applicable)
2. Read the modified files
3. Check for bugs, security issues, code smells

Output format:

## Files Reviewed
- `path/to/file.ts` (lines X-Y)

## Critical (must fix)
- `file.ts:42` - Issue description

## Warnings (should fix)
- `file.ts:100` - Issue description

## Suggestions (consider)
- `file.ts:150` - Improvement idea

## Summary
Overall assessment in 2-3 sentences.

Be specific with file paths and line numbers.
```

- [ ] **Step 5: Replace worker variants with one canonical worker**

Delete `gpt-worker.md` and `claude-worker.md`. Create `worker.md.tmpl` with:

```markdown
{{ template "pi-subagent-frontmatter.tmpl" (dict "root" . "role" "worker" "description" "General-purpose worker with isolated context") }}

You are a worker agent with full capabilities. You operate in an isolated context window to handle delegated tasks without polluting the main conversation.

Work autonomously to complete the assigned task. Use all available tools as needed.

Output format when finished:

## Completed
What was done.

## Files Changed
- `path/to/file.ts` - what changed

## Notes (if any)
Anything the main agent should know.

If handing off to another agent (e.g. reviewer), include:
- Exact file paths changed
- Key functions/types touched (short list)
```

- [ ] **Step 6: Update all workflows to generic names**

In `dot_pi/agent/prompts/implement.md`, replace `gpt-scout`, `gpt-planner`, and `gpt-worker` with `scout`, `planner`, and `worker` respectively.

In `dot_pi/agent/prompts/scout-and-plan.md`, replace `gpt-scout` and `gpt-planner` with `scout` and `planner`.

In `dot_pi/agent/prompts/implement-and-review.md`, replace `gpt-worker` and `gpt-reviewer` with `worker` and `reviewer`.

Do not change workflow ordering, `$@`, or `{previous}` behavior.

- [ ] **Step 7: Render and parse every canonical definition**

Run:

```bash
for role in scout planner reviewer worker; do
  rendered="$(chezmoi cat "$HOME/.pi/agent/agents/$role.md")" || exit 1
  printf '%s' "$rendered" | ROLE="$role" bun -e '
    import { parseAgentDefinition } from "./dot_pi/agent/exact_extensions/subagent/agents.ts";
    const content = await Bun.stdin.text();
    const role = process.env.ROLE!;
    const parsed = parseAgentDefinition(content, `/rendered/${role}.md`, "user");
    if (!parsed.agent) {
      console.error(parsed.diagnostic.message);
      process.exit(1);
    }
    console.log(`${parsed.agent.name}: ${parsed.agent.backend}/${parsed.agent.model ?? "default"}`);
  '
done
```

Expected:

```text
scout: pi/openai-codex/gpt-5.6-luna
planner: pi/openai-codex/gpt-5.6-terra
reviewer: pi/openai-codex/gpt-5.6-terra
worker: pi/openai-codex/gpt-5.6-terra
```

Also run:

```bash
rg -n 'name: (gpt|claude)-|"(gpt|claude)-(scout|planner|reviewer|worker)"' \
  dot_pi/agent/exact_agents dot_pi/agent/prompts
```

Expected: no matches.

- [ ] **Step 8: Run automated regression tests**

Run:

```bash
bun test
```

Expected: all tests pass. No test may invoke a production Pi or Claude model process.

- [ ] **Step 9: Inspect and commit the Track B implementation**

Run:

```bash
git diff --check
chezmoi diff ~/.pi/agent/agents ~/.pi/agent/prompts
git status --short
```

Expected: the source diff shows one shared template, four canonical agent templates, removal of eight backend-prefixed files, and generic prompt references. The target diff removes backend-prefixed deployed agents and adds exactly four generic agents.

Commit:

```bash
git add .chezmoitemplates/pi-subagent-frontmatter.tmpl \
  dot_pi/agent/exact_agents \
  dot_pi/agent/prompts/implement.md \
  dot_pi/agent/prompts/scout-and-plan.md \
  dot_pi/agent/prompts/implement-and-review.md
git commit -m "refactor(pi): render generic model-driven subagents"
```

---

### Task 4: Apply and Final Verification

**Files:**
- Apply source state to: `~/.pi/agent/agents/`
- Apply source state to: `~/.pi/agent/prompts/`

**Interfaces:**
- Consumes: committed model assignments and templates from Tasks 1–3.
- Produces: four deployed generic definitions and generic workflow prompts.
- Leaves: repository source state clean and automated tests green.

- [ ] **Step 1: Apply only the affected managed targets**

Run:

```bash
chezmoi apply ~/.pi/agent/agents ~/.pi/agent/prompts
```

Expected: success with no template diagnostic.

- [ ] **Step 2: Confirm exact deployed-agent membership**

Run:

```bash
find ~/.pi/agent/agents -maxdepth 1 -type f -print | sort
```

Expected exactly:

```text
/Users/eddiehuang/.pi/agent/agents/planner.md
/Users/eddiehuang/.pi/agent/agents/reviewer.md
/Users/eddiehuang/.pi/agent/agents/scout.md
/Users/eddiehuang/.pi/agent/agents/worker.md
```

- [ ] **Step 3: Confirm deployed front matter matches assignments**

Run:

```bash
for role in scout planner reviewer worker; do
  printf '\n===== %s =====\n' "$role"
  awk 'NR == 1 { print; next } /^---$/ { print; exit } { print }' "$HOME/.pi/agent/agents/$role.md"
done
```

Expected: generic names; `scout` resolves to `pi`/`openai-codex/gpt-5.6-luna`; the other roles resolve to `pi`/`openai-codex/gpt-5.6-terra`; tool policies match `.chezmoidata/pi/subagents.yaml`; worker omits `tools`.

- [ ] **Step 4: Run fresh final verification**

Run:

```bash
bun test
git diff --check
git status --short
chezmoi status ~/.pi/agent/agents ~/.pi/agent/prompts
```

Expected: all Bun tests pass, `git diff --check` is silent, repository status is clean, and the scoped chezmoi status is empty.

- [ ] **Step 5: Reload Pi and defer production QA unless credentials and a disposable repository are available**

Run `/reload` in an existing Pi session, or start a new Pi session. If both production CLIs are authenticated and a trusted disposable repository is available, follow `docs/qa/pi-subagent-backends.md`; otherwise report that manual production QA was not run and why. Do not add the QA procedure to automation.
