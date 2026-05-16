# Fast package: pi-orchestrated subagent-driven development

**Date:** 2026-05-16
**Status:** Design (revised after first implementation)

## Purpose

Add a sibling of `superpowers:subagent-driven-development` in which the
**entire per-task implementation+review loop is delegated to a single `pi -p`
call**. The host caller's job collapses to: compose one prompt, dispatch once,
run a final strong-model code review.

This pushes the inner orchestration onto pi (where it can use cheap/fast
models for the hot loop) while preserving a strong-model quality gate at the
caller's level.

## Non-goals

- Replacing `superpowers:subagent-driven-development`. The upstream skill
  remains the default; this is an opt-in alternative.
- Prescribing how pi dispatches its own child subagents. The skill is
  transport-agnostic about pi's internal mechanism.
- Modifying any upstream files.

## Architecture

A chezmoi-managed package named `fast` ships one skill,
`fast:subagent-driven-development`, that is a thin host-side wrapper around a
single pi call.

**Role split:**

| Role                    | Where it runs            | What it does                              |
|-------------------------|--------------------------|-------------------------------------------|
| Host caller             | The user's harness       | Compose pi prompt, dispatch once, parse summary, run final code review |
| Pi orchestrator         | One `pi -p` subprocess   | Read plan + spec, loop tasks, dispatch per-task children, emit summary |
| Per-task implementer    | Pi's child subagent      | Implement, test, commit one task          |
| Per-task spec reviewer  | Pi's child subagent      | Verify implementation matches spec        |
| Per-task quality reviewer | Pi's child subagent    | Cheap-model padding review                |
| Final code reviewer     | Host's Task tool         | Strong-model gate on the full branch diff |

The host caller knows nothing about pi's internal dispatch mechanism — it just
gives pi a prompt and waits. Pi may dispatch children via `pi -p` recursion,
its own native subagent primitive, or anything else. The skill stays silent on
this so it doesn't break if pi's API evolves.

## Package layout

```
dot_agents/exact_packages/fast/
├── exact_skills/
│   └── subagent-driven-development/
│       ├── SKILL.md                       # host-facing, ~80 lines
│       └── pi-orchestrator-prompt.md      # pi-facing template
├── dot_claude-plugin/plugin.json
├── dot_codex-plugin/plugin.json
├── gemini-extension.json
└── package.json
```

Two skill files (down from four). The per-task implementer / spec-reviewer /
code-quality-reviewer prompts have collapsed into embedded sub-templates inside
`pi-orchestrator-prompt.md`, since pi uses them internally and the host never
touches them.

## Marketplace and manifest wiring

The `fast` package is registered in both marketplace catalogs alongside the
existing packages (`assistant`, `coding`, `devops`, `superpowers`):

- `dot_agents/exact_plugins/marketplace.json` — Codex marketplace catalog
  (deploys to `~/.agents/plugins/marketplace.json`)
- `dot_agents/dot_claude-plugin/marketplace.json` — Claude Code marketplace
  catalog (deploys to `~/.claude-plugin/marketplace.json`)

Package-level manifests mirror the structure already used by `superpowers/`:
`package.json`, `dot_claude-plugin/plugin.json`, `dot_codex-plugin/plugin.json`,
`gemini-extension.json`.

## SKILL.md contract (host-facing)

The host caller's workflow has three steps:

1. **Compose** — gather plan path, spec path, and working directory. Write
   `pi-orchestrator-prompt.md`'s contents (with placeholders substituted) to
   `$TMPDIR/fast-sdd-<plan-slug>.md`. The plan body is **not** inlined — pi
   reads it from disk.
2. **Dispatch** — `pi -p "$(cat $TMPDIR/fast-sdd-<plan-slug>.md)"`. One call.
   Capture stdout. Parse the `=== PI SDD SUMMARY ===` block at the end.
3. **Final review** — dispatch a code reviewer via the host's native Task tool
   against the branch diff (BASE_SHA before pi ran, HEAD_SHA at current).
   Use the `superpowers:requesting-code-review` template.

On `BLOCKED` (pi-level or any task-level), the host **escalates to the human**.
No automatic fallback to `superpowers:subagent-driven-development`.

## Pi orchestrator prompt contract (pi-facing)

`pi-orchestrator-prompt.md` contains:

- **Placeholders** the host substitutes: `{{PLAN_PATH}}`, `{{SPEC_PATH}}`,
  `{{WORKDIR}}`.
- **Workflow prose** instructing pi to: read plan + spec, verify clean tree,
  loop tasks, dispatch per-task children using "whatever subagent dispatch
  mechanism your harness provides," and emit a structured summary at the end.
- **Embedded sub-templates** for the three child subagent prompts (implementer,
  spec reviewer, code-quality reviewer). These are the bodies pi feeds into
  its own dispatch mechanism. They specify TDD discipline, four-status
  reporting, and quality-review delimiters.
- **Final summary block** — the only structured output the host parses:

  ```
  === PI SDD SUMMARY ===
  status: ALL_DONE | PARTIAL | BLOCKED
  tasks:
    - id: <n>
      title: <task title>
      status: DONE | DONE_WITH_CONCERNS | BLOCKED
      commits: [<sha>, ...]
      files: [<path>, ...]
      concerns: <text or empty>
  notes: <free-form orchestrator notes>
  === END PI SDD SUMMARY ===
  ```

  Anything pi prints after `=== END PI SDD SUMMARY ===` is discarded.

## Open questions resolved during brainstorming

| Question                                        | Decision                                            |
|-------------------------------------------------|-----------------------------------------------------|
| Replace or coexist?                             | Coexist (opt-in via skill description).             |
| AGENTS.md memory rule vs. new skill?            | New skill — memory rules are always-on, which contradicts coexist intent; AGENTS.md is harness-agnostic and shouldn't encode Claude-Code-Task-tool-specific swaps. |
| Granularity?                                    | One `pi -p` call per plan. Pi orchestrates the entire inner loop. |
| How does pi dispatch its own children?          | Skill is silent — pi uses its own mechanism. No assumption about `pi -p` recursion. |
| Final review at end?                            | Yes — host caller runs a strong-model code review via Task tool on the full branch. Pi's internal per-task quality reviews are cheap-model "padding." |
| File structure?                                 | Two files: `SKILL.md` (host-facing) + `pi-orchestrator-prompt.md` (pi-facing with embedded child sub-templates). |
| Summary format?                                 | `=== PI SDD SUMMARY ===` / `=== END PI SDD SUMMARY ===` delimited YAML-ish block. |
| Recovery on pi-BLOCKED?                         | Escalate to human. No automatic fallback to upstream skill. |

## Acceptance criteria

- `chezmoi apply` deploys the `fast` package to `~/.agents/packages/fast/` with
  the four manifests and two skill files present.
- Both marketplace catalogs list the `fast` package.
- The host caller invoking `fast:subagent-driven-development` performs exactly
  three actions: compose tempfile, run `pi -p`, run a final Task-tool code
  review.
- The pi orchestrator does not assume a specific child-dispatch mechanism.
- The host parses the `=== PI SDD SUMMARY ===` block and escalates to the
  human on any `BLOCKED` status.

## Out of scope (future work)

- A `fast:executing-plans` parallel-session variant.
- Programmatic schema for the summary block (JSON instead of YAML-ish).
- Mid-plan progress streaming back to the host.
- Auto-fallback to `superpowers:subagent-driven-development` on pi-BLOCKED.

## Revision history

- **2026-05-16 v1** — first design: pi-dispatched implementer only; host
  orchestrated each task and dispatched both reviewers via Task tool.
  Implemented but immediately revised.
- **2026-05-16 v2 (this doc)** — pi orchestrates the entire inner loop; host
  caller is thin and runs a single final strong-model code review.
