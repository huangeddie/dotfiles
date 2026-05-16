# Fast package: pi-powered implementer subagents

**Date:** 2026-05-16
**Status:** Design

## Purpose

Extend `superpowers:subagent-driven-development` so the implementer subagent can
be dispatched via the `pi` CLI (`pi -p '<prompt>'`) instead of the host
harness's built-in Task tool. Pi is fast and runs cheap open-source models under
the hood, which fits the mechanical implementer role well.

Reviewer subagents (spec compliance, code quality) continue to use the host
harness's Task tool — their job benefits from stronger reasoning.

## Non-goals

- Replacing the upstream `superpowers:subagent-driven-development` skill. The
  upstream skill remains the default; this is an opt-in alternative.
- Changing the orchestration logic (TDD, two-stage review, four-status
  reporting). Only the implementer dispatch mechanism changes.
- Pi-dispatch for reviewer subagents.
- Modifying any upstream files. The new package owns its own copy of the three
  prompt templates.

## Architecture

A new chezmoi-managed package named `fast` ships one skill,
`fast:subagent-driven-development`. The skill is a standalone full skill — it
contains its own `SKILL.md` and prompt templates, rather than delegating to or
extending the upstream skill.

**Role split:**

| Role           | Model                  | Transport                         |
|----------------|------------------------|-----------------------------------|
| Orchestrator   | Host harness (strong)  | Native (runs the skill)           |
| Implementer    | Pi (fast/cheap)        | Bash → `pi -p "$(cat tmpfile)"`   |
| Spec reviewer  | Host harness (strong)  | Native Task tool                  |
| Quality reviewer | Host harness (strong) | Native Task tool                  |

The orchestrator (a strong reasoning model in the user's current harness) keeps
its current responsibilities: extracting tasks from the plan, curating per-task
context, judging implementer reports, and deciding when to re-dispatch. Only
the implementer's transport changes from in-process Task to a `pi` subprocess.

## Package layout

```
dot_agents/exact_packages/fast/
├── exact_skills/
│   └── subagent-driven-development/
│       ├── SKILL.md
│       ├── implementer-prompt.md            # pi-based dispatch (NEW)
│       ├── spec-reviewer-prompt.md          # copy of upstream
│       └── code-quality-reviewer-prompt.md  # copy of upstream
├── dot_claude-plugin/plugin.json
├── dot_codex-plugin/plugin.json
├── gemini-extension.json
└── package.json
```

The two reviewer prompts are duplicated (not symlinked or referenced) from
upstream. This costs ~3 KB of duplication for a clean self-contained skill that
keeps working if upstream relocates or renames its files.

## Marketplace and manifest wiring

The new `fast` package is registered in both marketplace catalogs alongside
existing packages (`assistant`, `coding`, `devops`, `superpowers`):

- `dot_agents/exact_plugins/marketplace.json` — Codex marketplace catalog
  (deploys to `~/.agents/plugins/marketplace.json`)
- `dot_agents/dot_claude-plugin/marketplace.json` — Claude Code marketplace
  catalog (deploys to `~/.claude-plugin/marketplace.json`)

Each entry follows the format already used by the four existing packages in
the respective file.

Package-level manifests:

- `package.json` — pi package manifest: `{"pi": {"skills": ["./skills"]}}`
- `dot_claude-plugin/plugin.json` — Claude Code plugin manifest
- `dot_codex-plugin/plugin.json` — Codex plugin manifest
- `gemini-extension.json` — Gemini extension manifest

All four mirror the structure already used by `superpowers/`.

## SKILL.md contract

**Frontmatter:**

```yaml
---
name: subagent-driven-development
description: Use when executing implementation plans with independent tasks and you want fast pi-powered implementer subagents. Orchestrator runs in your current harness; implementer subagents are dispatched via `pi -p` for speed/cost.
---
```

The skill name `subagent-driven-development` matches upstream, but is
disambiguated by package namespace (`fast:` vs `superpowers:`). The description
is the trigger — orchestrators select this variant only when speed/cost is the
deciding factor.

**Body — three deliberate diffs from upstream `superpowers:subagent-driven-development`:**

1. **Opening blurb** — add one sentence: "Implementer subagents are dispatched
   via `pi -p` (fast, mechanical); spec and code-quality reviewers continue to
   use the orchestrator's native Task tool (stronger reasoning)."

2. **Model Selection section** — replace the "least powerful model that can
   handle each role" triage with: "Implementer model is fixed (whatever `pi` is
   configured to use). Reviewers continue to follow the orchestrator's native
   model-selection guidance." The complexity-signal triage is irrelevant once
   the implementer transport is fixed.

3. **Red Flags / Integration** — one new red flag: "Never pipe untrusted task
   text directly into `pi -p` as a quoted argument — always write the prompt
   body to a tempfile under `$TMPDIR` and pass via `"$(cat <tmpfile>)"` to
   avoid shell-escaping bugs." Integration section adds: "Implementer
   subagents are dispatched via the `pi` CLI (see
   `./implementer-prompt.md`); reviewers run via the orchestrator's Task tool."

Everything else (process graph, four implementer statuses, two-stage review
loop, example workflow, advantages, integration with other skills) is copied
verbatim from upstream.

## Implementer prompt template

The new `implementer-prompt.md` documents the dispatch pattern, not just the
prompt body. Its contract:

**Dispatch pattern:**

```
1. Write the prompt body to:
     $TMPDIR/pi-task-<N>-<slug>.md

   The body is the same prose used in the upstream implementer-prompt.md
   (task description, context, TDD instructions, self-review checklist,
   report format), with the two pi-specific adjustments listed below.

2. Dispatch via the Bash tool:
     pi -p "$(cat $TMPDIR/pi-task-<N>-<slug>.md)"

3. Capture stdout. The implementer's final structured report (status +
   files changed + concerns) is printed as the LAST thing on stdout.
   Parse it for the four-status contract.
```

**Why tempfile + command substitution:**

- Implementer prompts are 3–5 KB and contain backticks, code fences, and
  quotes. Inline `pi -p '<body>'` is a shell-escaping footgun.
- `$TMPDIR` is sandbox-writable and auto-cleaned by the host OS.
- A persisted tempfile is inspectable post-hoc for debugging ("what did we
  actually send to pi?").

**Prompt body — two adaptations from upstream:**

1. Drop the line `Work from: [directory]`. Pi inherits the orchestrator's
   shell working directory, so the orchestrator is responsible for running
   from the correct repo root.
2. Add: "Print your final report as the LAST thing on stdout. The orchestrator
   captures your stdout to parse your status." Bash returns the full stdout
   blob; the orchestrator needs a reliable end-of-output marker.

The rest of the prompt body — preamble, TDD instructions, self-review
checklist, four-status contract (`DONE | DONE_WITH_CONCERNS | BLOCKED |
NEEDS_CONTEXT`) — is copied verbatim from upstream.

## Reviewer prompts

`spec-reviewer-prompt.md` and `code-quality-reviewer-prompt.md` are byte-for-byte
copies of the upstream files. They continue to dispatch via the host harness's
Task tool. No changes.

## Drift management

The skill duplicates upstream orchestration prose and two prompt templates.
This is the explicit cost of standalone packaging. Mitigations:

- A header comment in `fast/exact_skills/subagent-driven-development/SKILL.md`:
  `<!-- Kept in sync with superpowers:subagent-driven-development as of 2026-05-16 -->`.
- When the upstream skill changes meaningfully (new orchestration step, new
  status, new red flag), manually port the diff. The implementer-prompt is
  ours; the other files track upstream.

## Open questions resolved during brainstorming

| Question                                        | Decision                                            |
|-------------------------------------------------|-----------------------------------------------------|
| Replace or coexist?                             | Coexist (opt-in via skill description).             |
| AGENTS.md memory rule vs. new skill?            | New skill — memory rules are always-on, which contradicts coexist intent; AGENTS.md is harness-agnostic and shouldn't encode Claude-Code-Task-tool-specific swaps. |
| Which roles get pi-dispatch?                    | Implementer only. Reviewers stay on Task tool.      |
| Skill naming?                                   | `fast:subagent-driven-development` (same name as upstream, different package). |
| Pi input method?                                | `pi -p "$(cat $TMPDIR/<file>)"`. Tempfile avoids shell-escaping. |

## Acceptance criteria

- `chezmoi apply` deploys the `fast` package to `~/.agents/packages/fast/` with
  the four manifests and the three skill files present.
- Both marketplace catalogs list the `fast` package.
- The `Skill` tool can invoke `fast:subagent-driven-development` and the
  orchestrator follows the pi-dispatch pattern for implementer tasks.
- Spec reviewer and code-quality reviewer subagents continue to dispatch via
  the host harness's Task tool.
- The implementer subprocess inherits cwd, reads/edits/commits in the repo,
  and emits its final four-status report as the last lines of stdout.

## Out of scope (future work)

- A `fast:executing-plans` parallel-session variant.
- Pi-dispatch for reviewers (would require benchmarking whether pi's models
  catch spec/quality issues reliably).
- A `fast`-wide red-flag skill that documents pi-specific failure modes (rate
  limits, model degradation, output truncation).
