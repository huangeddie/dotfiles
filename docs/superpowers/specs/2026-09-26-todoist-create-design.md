# Todoist task creation with OpenTUI

## Approved scope

Add `todoist-add`, a single-screen OpenTUI form, also launched by Ctrl+A in the
existing Todoist Television cable. Create one task, then exit; cancelling creates
nothing. Television remains open and reloads its active source on return.

Fields: title, description, project, section, and due date. No task editing,
priorities, labels, drafts on disk, recurring-date calculation, or batch creation.
The user approved this design in chat, including native Todoist due phrases.

## Contracts and data

```ts
interface Project { id: string; name: string; inbox: boolean }
interface Section { id: string; projectId: string; name: string }
type DueChoice =
  | { kind: "none" }
  | { kind: "preset"; value: "today" | "tomorrow" | "next week" | "next weekend" }
  | { kind: "custom"; value: string };
interface Draft {
  title: string;
  description: string;
  projectId: string | null;
  sectionId: string | null;
  due: DueChoice;
}
interface TaskInput {
  title: string;
  description?: string;
  projectId?: string;
  sectionId?: string;
  due?: string;
}
interface Todoist {
  projects(): Promise<Project[]>;
  sections(projectId: string): Promise<Section[]>;
  create(input: TaskInput): Promise<{ id: string }>;
}
```

Keep project/section metadata in their own lists; a draft references IDs rather
than copying names. Normalize Todoist's `inboxProject` field to `Project.inbox`.
Select the Inbox project initially when returned by the API. An omitted project
means Todoist's default Inbox; an omitted section means no section.

Trim the title and reject empty or multiline titles. Preserve description
newlines. Empty optional description is omitted. A section must belong to the
selected project and be present in the currently loaded sections. Project IDs
must come from the loaded project list. Never use labels/names as identifiers.
Changing project clears the section immediately. A late section response from a
previous project cannot replace the current project's sections.

Due presets are literal phrases passed unchanged to `td --due`: `today`,
`tomorrow`, `next week`, and `next weekend`. No date omits `--due`. Custom input
must be nonblank and is passed as a trimmed phrase. Do not infer or preview a
resolved date locally. Todoist documents next week as configurable and next
weekend as the second-next Saturday, unlike the earlier proposed local rule.

## Interfaces and effects

A narrow `Todoist` port belongs to the form/application logic. A CLI adapter
uses `td` with argument arrays (no shell interpolation), reusing the user's
existing authentication. The new app must not depend on Television's helpers.

Commands:

- `td --no-spinner project list --all --json --full`
- `td --no-spinner section list --project id:PROJECT --all --json`
- `td --no-spinner task add --content TITLE [optional flags] --json`

Use `--content` deliberately so titles beginning with `-` are treated as values.
Optional flags are `--description`, `--project id:ID`, `--section id:ID`, and
`--due`. Parse and validate responses; nonzero exits and malformed output are
errors, not empty successes. `create` returns the created task ID.

A headless form model handles loading, project changes, draft validation,
submission state, and errors. UI rendering observes the model. Wire the concrete
subprocess runner and OpenTUI at the entry point, not inside the domain model.
Ignore obsolete section responses using monotonically increasing request IDs.
Do not automatically retry task creation. Disable editing and further submission
while a create request is pending. Preserve the draft on failure, and warn that
an ambiguous network failure may require checking Todoist before resubmitting.
Do not offer cancellation as if it could revoke an in-flight create request.

## UI and command behavior

Use OpenTUI Core directly with Bun; no React/Solid dependency. Title is focused
initially. Description is multiline. Project and section use an inline filter
input with a compact select list; filter matches names case-insensitively without
changing the committed selection. Enter commits a highlighted picker option.
Duplicate names remain distinguishable with an ID in secondary text. Sections
are scoped to the selected project, with an explicit no-section choice.

Due has No date, Today, Tomorrow, Next week, Next weekend, and Custom choices.
Only Custom reveals a free-text input. Use a compact flat layout; avoid nested
panels, excessive helper text, and emojis. Prefer built-in terminal colors and
minimal status text over a decorative theme. The form must remain usable at
80x24; scroll rather than allowing fields to become inaccessible.

- Tab / Shift+Tab: next / previous field.
- Ctrl+S: validate and create once.
- Esc / Ctrl+C: cancel before submission; destroy the renderer on exit.
- Loading and error status are visible inline; failed reads can be retried.
- Successful creation closes the form and prints the created task ID after
  terminal restoration. Cancel exits successfully without a task ID.

Television binds Ctrl+A to a fork action invoking `todoist-add`, followed by
`reload_source`. This overrides Television's default Ctrl+A input-start binding
only in this cable. Television 0.15.9 requires a selected row for all external
actions: the existing empty-tab placeholder works; users must clear a search
with Ctrl+U if it hides every row. No selected task context or tab-project
inheritance is required; creation defaults to Inbox in either entry point.

## File structure and dependencies

```text
dot_config/todoist/
  package.json          # Private ESM package, pinned OpenTUI Core dependency
  bun.lock              # Committed reproducible dependency graph
  model.ts              # Data contracts, validation, headless form state
  client.ts             # td adapter and subprocess boundary
  ui.ts                 # OpenTUI rendering and keyboard/focus handling
  create.ts             # Composition root and renderer/process lifecycle
dot_local/bin/executable_todoist-add
run_onchange_after_install-todoist-dependencies.sh.tmpl
tests/todoist-create.test.ts
tests/todoist-client.test.ts
docs/qa/todoist-create.md
```

Modify the existing cable TOML, `.gitignore`, and `.chezmoiignore` as needed.
Edit source state only. Do not put application files in Television's directory.
Keep node_modules out of Git and chezmoi source management.

Pin `@opentui/core` to `0.5.12`; commit a Bun lockfile. Runtime is Bun >=1.3.0,
with native platform packages for macOS/Linux x64/arm64. No Zig compiler is needed
for published packages. Dependency installation is a chezmoi on-change effect,
keyed by manifest/lock hashes, using `bun install --frozen-lockfile` in the
deployed app directory. Respect both current and legacy package deny prefixes
for managed direct dependencies; do not bypass denied Todoist/OpenTUI packages.
The launcher never silently downloads packages at runtime. Missing dependencies
produce an actionable error. Honor XDG_CONFIG_HOME for launch paths, retaining
this repository's standard ~/.config deployment convention.

## Verification

Unit tests use practical in-memory Todoist and runner fakes, with deferred
promises to control interleavings. No UI rendering, subprocesses, filesystem,
network, clocks, random sampling, or wall-clock thresholds in unit tests.

Cover title validation, description preservation, preset/custom due mapping,
project membership, section reset/membership, stale section responses (success
and failure), read errors/retry, duplicate submissions, draft preservation on
create failure, and argument-array construction/parsing at the td boundary.
Use expected-failure RED commits for contracts/tests and separate GREEN
implementation commits, following repository Track A / Track B rules.

QA is discretionary and never part of CI/hooks. Offline agent-driven QA checks
launcher/installer effects using temporary directories and fake executables.
Human-driven QA checks actual OpenTUI appearance, keyboard navigation, resize,
terminal restoration, and Television return/refresh. Any live task creation
requires a disposable task and deliberate operator action; do not mutate real
tasks merely to validate the form automatically.

## References inspected

- Installed `td` 5.4.2 help for task add, project list, and section list.
- OpenTUI Core README and input/select example:
  https://github.com/anomalyco/opentui/tree/main/packages/core
  https://github.com/anomalyco/opentui/blob/main/packages/examples/src/input-select-layout-demo.ts
- OpenTUI package metadata for 0.5.12: https://registry.npmjs.org/@opentui/core/latest
- Todoist date semantics:
  https://www.todoist.com/help/articles/introduction-to-dates-and-times-q7VobO
