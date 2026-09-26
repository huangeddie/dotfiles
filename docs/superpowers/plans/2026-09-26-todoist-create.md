# Todoist Task Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create Todoist tasks in a compact OpenTUI form, launched by `todoist-add` or Television Ctrl+A.

**Architecture:** A headless form model owns validation and workflow, depending on a narrow Todoist port. A CLI adapter handles authenticated `td` calls; OpenTUI observes the model. The composition root owns subprocess and renderer lifecycles.

**Tech Stack:** Bun >=1.3.0, TypeScript, OpenTUI Core 0.5.12, installed Todoist CLI, Television >=0.15.9, chezmoi.

**Spec:** `docs/superpowers/specs/2026-09-26-todoist-create-design.md`

## Global Constraints

- Edit source state only; apply reviewed files through chezmoi.
- Work directly on main; no worktrees or new branches.
- No delegation unless the operator chooses it.
- Pin `@opentui/core` to `0.5.12`; commit a Bun lockfile.
- Runtime is Bun >=1.3.0, with native platform packages for macOS/Linux x64/arm64.
- Use OpenTUI Core directly with Bun; no React/Solid dependency.
- Due presets are literal phrases passed unchanged to `td --due`: `today`, `tomorrow`, `next week`, and `next weekend`.
- No date omits `--due`; never calculate or preview resolved dates locally.
- The launcher never silently downloads packages at runtime.
- Unit tests use fakes and controlled promises, not network/filesystem/process/UI effects.
- QA is discretionary and never part of CI/hooks.
- Use separate Conventional Commits for Track A contracts/tests and Track B implementation; expected-failure RED tests are supported by Bun.
- UI code and shallow configuration changes are exempt from red-green unit tests.

## File map

| File | Responsibility |
| --- | --- |
| `dot_config/todoist/model.ts` | Contracts, draft validation, observable form workflow |
| `dot_config/todoist/client.ts` | CLI argv and JSON adapter, concrete subprocess runner |
| `dot_config/todoist/ui.ts` | OpenTUI controls, focus, search and keyboard handling |
| `dot_config/todoist/create.ts` | App composition, terminal restoration, exit result |
| `dot_config/todoist/package.json`, `bun.lock` | Private app dependencies |
| `dot_local/bin/executable_todoist-add` | Stable shell entry point |
| `run_onchange_after_install-todoist-dependencies.sh.tmpl` | Frozen dependency installation, deny-policy checks |
| `dot_config/television/cable/todoist.toml` | Forked Ctrl+A creation action and reload |
| `.gitignore`, `.chezmoiignore` | Exclude app node_modules |
| `tests/todoist-create.test.ts` | Pure draft/workflow tests |
| `tests/todoist-client.test.ts` | Adapter tests with fake runner |
| `docs/qa/todoist-create.md` | Offline and human-driven verification |
| `docs/qa/todoist-create.sh` | Discretionary launcher/installation boundary QA |

## Task 1: Task draft and headless form workflow

**Files:** Create `dot_config/todoist/model.ts` and `tests/todoist-create.test.ts`.

**Interfaces:** Define `Project`, `Section`, `DueChoice`, `Draft`, `TaskInput`, and
`Todoist` exactly as in the spec. Export the following additional interface:

```ts
export interface FormState {
  phase: "loading" | "load-error" | "ready" | "submitting" | "created";
  projects: Project[];
  sections: Section[];
  sectionsStatus: "idle" | "loading" | "ready" | "error";
  draft: Draft;
  error: string | null;
  createdId: string | null;
}
export function taskInput(draft: Draft, projects: Project[], sections: Section[]): TaskInput;
export class TaskForm {
  constructor(todoist: Todoist);
  get state(): FormState;
  subscribe(listener: (state: FormState) => void): () => void;
  load(): Promise<void>;
  edit(patch: Partial<Pick<Draft, "title" | "description" | "due">>): void;
  selectProject(projectId: string | null): Promise<void>;
  selectSection(sectionId: string | null): void;
  submit(): Promise<void>;
}
```

`state` is a snapshot: updates replace arrays/draft/state rather than mutating
objects already delivered to listeners. `load` retries failed project loading;
calling `selectProject` again retries section loading. Editing and project/
section changes are ignored while submitting or after creation. `submit` is
ignored while already submitting/created, and reports validation errors without
calling the adapter. Initial project load chooses `Project.inbox`, or leaves the
project null when absent. A null project has no available sections.

- [ ] **1. Add contracts, minimal stubs, and failing tests.** Read the TDD skill and its good-tests reference. Use a practical fake Todoist holding project/section data and a `created` array. The following tests catch wrong due mapping and section reset:

```ts
test("next weekend is passed unchanged rather than computed locally", () => {
  expect(taskInput({
    title: "  Ship release  ", description: "", projectId: "work",
    sectionId: "release", due: { kind: "preset", value: "next weekend" },
  }, [{ id: "work", name: "Work", inbox: false }], [
    { id: "release", projectId: "work", name: "Release" },
  ])).toEqual({ title: "Ship release", projectId: "work", sectionId: "release", due: "next weekend" });
});

test("changing project clears the selected section before loading finishes", async () => {
  const gate = Promise.withResolvers<Section[]>();
  const fake: Todoist = {
    projects: async () => [
      { id: "a", name: "Inbox", inbox: true },
      { id: "b", name: "Work", inbox: false },
    ],
    sections: async id => id === "a"
      ? [{ id: "sa", projectId: "a", name: "First" }]
      : gate.promise,
    create: async () => ({ id: "created" }),
  };
  const form = new TaskForm(fake);
  await form.load();
  form.selectSection("sa");
  const changing = form.selectProject("b");
  expect(form.state.draft.sectionId).toBeNull();
  expect(form.state.sections).toEqual([]);
  gate.resolve([{ id: "sb", projectId: "b", name: "Second" }]);
  await changing;
  expect(form.state.sections.map(section => section.id)).toEqual(["sb"]);
});
```

Add focused cases with literal expected values:

| Input/scenario | Expected outcome |
| --- | --- |
| Blank or newline-containing title | Validation error, zero creates |
| Description `first\nsecond` | Exact multiline string in TaskInput |
| Empty description and no date | Neither description nor due property |
| Each of today/tomorrow/next week/next weekend | Identical due phrase |
| Custom `  every Monday  ` | Due `every Monday` |
| Blank custom date | Validation error |
| Unknown project ID | Validation error |
| Section `s` belonging to project `a`, draft project `b` | Validation error |
| Section ID absent from current sections | Validation error |
| Project `a` result resolves after project `b` result | State remains on `b` and its sections |
| Project `a` request rejects after project `b` succeeds | No stale error is shown |
| Project/section load fails, then retry succeeds | Error clears; correct list becomes available |
| Two submit calls while fake create is deferred | Exactly one TaskInput reaches fake |
| Create rejects | Draft unchanged, phase ready, visible error, no automatic retry |
| Create succeeds | Phase created, returned ID retained, further submits ignored |
| Listener unsubscribed | Receives no further state snapshots |

Control races with `Promise.withResolvers`, not timers. Observe adapter inputs
and public model state rather than private request counters.

- [ ] **2. Run RED, then mark expected failures and commit Track A.**

```sh
bun test tests/todoist-create.test.ts
# Confirm behavioral failures against stubs, then use test.failing on new tests.
bun test tests/todoist-create.test.ts
git add dot_config/todoist/model.ts tests/todoist-create.test.ts
git commit -m "test(todoist): specify task draft and creation workflow"
```

- [ ] **3. Implement validation and workflow; remove expected-failure markers.** Use a request generation number for section loads, checked on both resolution and rejection. Set submission state synchronously before awaiting create. Build only present optional fields:

```ts
const input: TaskInput = { title: draft.title.trim() };
if (draft.description.trim()) input.description = draft.description;
if (draft.projectId !== null) input.projectId = draft.projectId;
if (draft.sectionId !== null) input.sectionId = draft.sectionId;
if (draft.due.kind === "preset") input.due = draft.due.value;
if (draft.due.kind === "custom") input.due = draft.due.value.trim();
```

Validate membership and field constraints before returning this result. Keep
exception-to-status conversion in the model's async methods, so UI callbacks do
not generate unhandled promise rejections.

- [ ] **4. Verify and commit Track B.**

```sh
bun test tests/todoist-create.test.ts
git diff --check
git add dot_config/todoist/model.ts tests/todoist-create.test.ts
git commit -m "feat(todoist): implement task creation workflow"
```

## Task 2: Authenticated Todoist CLI adapter

**Files:** Create `dot_config/todoist/client.ts` and `tests/todoist-client.test.ts`.

**Consumes:** `Todoist`, `Project`, `Section`, `TaskInput` from `model.ts`.
**Produces:** `Run`, `createTodoist(run: Run): Todoist`, `runTd: Run`.

```ts
export type Run = (args: string[]) => Promise<string>;
```

- [ ] **1. Add the factory stub and argument/response tests.** Fake Run returns JSON according to exact argv and records calls. Test the consumer boundary, not shell source text:

```ts
test("task fields remain literal arguments including leading dashes and shell syntax", async () => {
  const calls: string[][] = [];
  const api = createTodoist(async args => {
    calls.push(args);
    return '{"id":"new"}';
  });
  expect(await api.create({
    title: "--title $(false)", description: "first\nsecond",
    projectId: "p", sectionId: "s", due: "next week",
  })).toEqual({ id: "new" });
  expect(calls).toEqual([[
    "--no-spinner", "task", "add", "--content", "--title $(false)",
    "--description", "first\nsecond", "--project", "id:p",
    "--section", "id:s", "--due", "next week", "--json",
  ]]);
});
```

Additional literal cases: minimal title emits no optional flags; projects fetch
all/full and normalize `{id:"inbox",name:"Inbox",inboxProject:true}`; sections
fetch `--project id:p --all --json` and retain projectId; duplicate names retain
distinct IDs; empty results are valid; absent results, invalid IDs/names,
wrong-project sections, and missing created ID reject. A fake runner rejection
propagates rather than returning an empty list or fabricated success.

- [ ] **2. Observe RED, mark `test.failing`, verify, commit Track A.**

```sh
bun test tests/todoist-client.test.ts
git add dot_config/todoist/client.ts tests/todoist-client.test.ts
git commit -m "test(todoist): specify task creation CLI boundary"
```

- [ ] **3. Implement factory and concrete runner; remove markers.** The runner uses Bun.spawn argv and collects stdout, stderr, and exit status concurrently:

```ts
export const runTd: Run = async args => {
  const child = Bun.spawn(["td", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || `td exited with status ${code}`);
  return stdout;
};
```

Use one create command, not add followed by update. No automatic retries.
Validate only the fields consumed by this application; tolerate unrelated fields
and absent inboxProject on non-personal project variants. Inspect installed td
output definitions before finalizing fixtures; do not invent API field names.

- [ ] **4. Verify both suites and commit Track B.**

```sh
bun test tests/todoist-create.test.ts tests/todoist-client.test.ts
git diff --check
git add dot_config/todoist/client.ts tests/todoist-client.test.ts
git commit -m "feat(todoist): add task creation CLI adapter"
```

## Task 3: OpenTUI form and app lifecycle

**Files:** Create app `package.json`, `bun.lock`, `ui.ts`, and `create.ts`. Modify
`.gitignore` and `.chezmoiignore` only to exclude app node_modules. Do not edit
launcher, installer, cable, or QA files; Task 4 owns integration.

**Consumes:** `TaskForm`, `FormState`, `createTodoist`, and `runTd` from prior tasks.
**Produces:** `mountForm(renderer: CliRenderer, form: TaskForm): () => void`, where
the return value removes listeners; a runnable `bun create.ts` application with
pinned local dependencies. The composition root may inject a cancel callback
into mountForm rather than importing process lifecycle ownership into the UI;
keep that additional callback typed explicitly in ui.ts and create.ts.

- [ ] **1. Pin dependencies and exclude generated files.**

```json
{
  "name": "todoist-form",
  "private": true,
  "type": "module",
  "engines": { "bun": ">=1.3.0" },
  "dependencies": { "@opentui/core": "0.5.12" }
}
```

Add `dot_config/todoist/node_modules/` to Git ignores and
`.config/todoist/node_modules/` to chezmoi ignores. Generate the app lockfile:

```sh
bun install --cwd dot_config/todoist
```

Before implementation, read the installed 0.5.12 renderable declarations for
InputRenderable, TextareaRenderable, SelectRenderable, ScrollBoxRenderable,
CliRenderer, and KeyEvent. Use those version-pinned APIs; main-branch examples
are only guides. Do not add React, a calendar library, or a separate date parser.

- [ ] **2. Build the flat keyboard-driven form.** Use InputRenderable for title/filter/custom due, TextareaRenderable for description, and SelectRenderable for lists. Wire model snapshots to display labels, selected IDs, loading/error status, and disabled controls. Keep picker filter/highlight state in the UI; only Enter commits a project/section. Use `.value` for input and the installed textarea text accessor. Subscribe once, and unregister listeners on cleanup. Bootstrap with the documented imperative APIs:

```ts
import { BoxRenderable, InputRenderable, SelectRenderable, TextareaRenderable } from "@opentui/core";

const body = new BoxRenderable(renderer, { id: "form", flexDirection: "column", width: "100%", height: "100%" });
const title = new InputRenderable(renderer, { id: "title", placeholder: "Title", width: "100%" });
body.add(title);
renderer.root.add(body);
title.focus();
```

Keep selector lists compact and put the body in a scrollable viewport when
needed; do not reproduce the heavily boxed upstream demo. Enter in description
inserts a newline; it never submits. Handle Tab/Shift+Tab before controls consume
them. Ctrl+S invokes `form.submit()` only. Custom due input participates in the
focus order only while visible. On section loading/error, clear displayed stale
options and show retry affordance. Disable submission while project/section
reads needed for valid selection are unresolved.

- [ ] **3. Wire the composition root and exit lifecycle.** Create the renderer only for an interactive terminal, with application-owned Ctrl+C handling so pending submissions cannot look cancelled. On Esc/Ctrl+C before submission, restore terminal and exit without a task ID. On phase created, restore terminal and print `createdId`. Ensure renderer.destroy runs exactly once on normal cancellation, success, and fatal errors; ignore late model notifications after destruction. Build the app with:

```ts
const form = new TaskForm(createTodoist(runTd));
const cleanup = mountForm(renderer, form);
await form.load();
// The composition root owns cleanup() and renderer.destroy() on all exits.
```

Do not call process.exit before cleanup. Preserve in-form failures instead of
crashing. Error text for create failure must mention checking Todoist before a
manual retry because the remote mutation might have succeeded.

- [ ] **4. Verify the app boundary and commit.** Run the two new unit suites;
perform a discretionary native module import without creating a renderer, and
confirm the noninteractive entry point exits with an actionable error. Read the
final diff to verify focus/lifecycle event handling against the installed
OpenTUI declarations. Human UI QA remains Task 4's documented handoff.

```sh
bun test tests/todoist-create.test.ts tests/todoist-client.test.ts
bun --cwd dot_config/todoist -e 'await import("@opentui/core"); console.log("OpenTUI import OK")'
git diff --check
git add dot_config/todoist .gitignore .chezmoiignore
git commit -m "feat(todoist): implement OpenTUI task creation form"
```

## Task 4: Launcher, dependency installation, and Television integration

**Files:** Create `dot_local/bin/executable_todoist-add`,
`run_onchange_after_install-todoist-dependencies.sh.tmpl`,
`docs/qa/todoist-create.md`, and `docs/qa/todoist-create.sh`. Modify
`dot_config/television/cable/todoist.toml`. Do not rewrite model/client/UI files;
report any cross-component defect to the supervisor for a scoped fix.

**Consumes:** `dot_config/todoist/create.ts`, `package.json`, and `bun.lock` from
Task 3, plus the existing Television actions and package-policy settings.
**Produces:** `todoist-add`, Ctrl+A, and reproducible dependency installation.

- [ ] **1. Add a no-download launcher and policy-aware dependency installer.** The launcher resolves the app under XDG_CONFIG_HOME, checks Bun, td, and installed OpenTUI, then uses `exec bun --no-install`:

```sh
#!/bin/sh
set -eu
app="${XDG_CONFIG_HOME:-$HOME/.config}/todoist"
command -v bun >/dev/null 2>&1 || { echo 'todoist-add requires Bun' >&2; exit 1; }
command -v td >/dev/null 2>&1 || { echo 'todoist-add requires td' >&2; exit 1; }
[ -d "$app/node_modules/@opentui/core" ] || {
  echo 'Todoist form dependencies are missing; apply the chezmoi dependency installer.' >&2
  exit 1
}
exec bun --no-install "$app/create.ts" "$@"
```

Verify Bun's `--no-install` option in installed help before adopting it. The
on-change installer includes manifest and lock SHA256 comments through chezmoi
`include`/`sha256sum`, validates shared package settings, and checks the union of
`packagePolicy.deniedPrefixes` and legacy `blocked_prefixes` against managed
direct requirements (`@opentui/core`, `@doist/todoist-cli`, `bun`). If denied,
skip installation with a clear message. Otherwise use the existing BUN_INSTALL
PATH convention and `bun install --cwd "$HOME/.config/todoist" --frozen-lockfile`.
Never run global cleanup just to provision this app.

- [ ] **2. Add Television action and dependency requirement.** Preserve existing completion/undo actions and add:

```toml
# Inside [keybindings]
ctrl-a = ["actions:create", "reload_source"]

[actions.create]
description = "Create task"
command = "todoist-add"
mode = "fork"
```

Include `todoist-add` in channel requirements. Document Ctrl+A overriding the
input-start binding and Ctrl+U when no search result is selectable.

- [ ] **3. Add discretionary offline boundary QA and human checklist.** In
`docs/qa/todoist-create.sh`, use temporary directories, fake bun/td executables,
and an isolated HOME/config root. Exercise the real launcher to verify XDG path,
argv forwarding, missing dependency errors, and no silent install. Render the
installer with controlled chezmoi data; fake bun must record a frozen install
for allowed packages, and no call for current/legacy denied prefixes. Keep this
script outside tests and all automated hooks. Commit the QA/contracts separately
from concrete UI/packaging implementation under Track A/B.

`docs/qa/todoist-create.md` must include:

```sh
bun test tests/todoist-create.test.ts tests/todoist-client.test.ts \
  tests/television-todoist.test.ts tests/television-actions.test.ts
bash docs/qa/todoist-create.sh
chezmoi diff ~/.config/todoist ~/.local/bin/todoist-add \
  ~/.config/television/cable/todoist.toml
```

Include an exact targeted apply for these files and the new installer, never a
broad apply that runs unrelated package cleanup. Preview the new installer
separately before executing it. Native OpenTUI import is discretionary QA, not a
unit test. Check the installed module without creating a renderer first.

Human QA: run `todoist-add`; verify 80x24 layout, resizing, all focus transitions,
multiline input, filtered project/section selection, section reset, due custom
visibility, cancel without creating, read errors/retry, pending submit guard,
and terminal restoration. With a deliberately disposable task, create once and
verify all fields in Todoist. Repeat through `tv todoist` Ctrl+A and check source
refresh and unchanged existing Ctrl+D/Ctrl+Z behavior. Do not run scripted UI
interaction or create live tasks without explicit operator participation.

- [ ] **4. Review, verify, commit and prepare targeted deployment.** Re-run all four targeted suites,
manual offline QA, `git diff --check`, and `tv --cable-dir` list-channels for
config loading. Review effect boundaries, race handling, error preservation,
package-policy compliance, shell quoting, and cleanup inline unless delegation
was explicitly chosen. Commit implementation with:

```sh
git commit -m "feat(todoist): add OpenTUI task creation command"
```

The integration worker prepares and reports exact targeted apply commands but
does not deploy before review. After the final whole-change review, the parent
applies only reviewed app/launcher/cable/installer changes, confirms targeted
chezmoi diff is empty, and reports which human/live QA remains unperformed.

## Review gates and completion record

- [ ] Spec coverage: five fields, native date presets, default Inbox, dependent
  sections, both launch paths, refresh, no automatic create retries, cleanup.
- [ ] Test evidence: observed RED; no remaining expected failures at final tip.
- [ ] No new unit tests depend on filesystem, processes, networking, or UI.
- [ ] Generated native dependencies are untracked and not managed as source.
- [ ] Real Todoist tasks remain untouched until human-driven QA is requested.
