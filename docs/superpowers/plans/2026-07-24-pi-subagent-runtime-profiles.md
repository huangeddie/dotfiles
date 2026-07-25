# Pi Subagent Runtime Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an atomic `pi-subagents use gpt|claude` runtime selector that changes all four generic subagent roles on the next invocation without rewriting front matter, applying chezmoi, or reloading Pi.

**Architecture:** A versioned JSON catalog defines normalized profiles, model aliases, and role/backend tool policies. A dependency-light domain module validates and resolves the catalog; filesystem adapters read the managed catalog and XDG selection state; both a Bun CLI and the subagent extension consume the same resolver. The extension snapshots one profile per tool invocation and overlays it only onto configured user-scope agents before calling the existing orchestrator.

**Tech Stack:** TypeScript, Bun, Bun test, Node filesystem APIs, Pi extension APIs, JSON, chezmoi.

## Global Constraints

- Work directly on `main`; this repository forbids worktrees for these changes.
- The managed catalog target is `~/.pi/agent/subagent-profiles.json`; active state is `${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagents-profile` and is not managed by chezmoi.
- Missing selection state resolves `defaultProfile` (`gpt`); empty, malformed, unreadable, or unknown state fails closed.
- Profile routing applies only to configured agents whose discovered source is `user`; project-local and unconfigured agents retain direct front-matter routing.
- Load exactly one profile snapshot per subagent tool invocation, before any backend starts.
- Claude requires a non-empty unique tools array and forbids `Agent`; Pi accepts a non-empty unique array or `null`.
- `pi-subagents use` validates before an atomic same-directory rename and never invokes chezmoi or Pi.
- Keep production-model QA manual and outside hooks and CI.
- Do not add a root package manifest in this scope. For Bun tests, use the accepted temporary symlink to installed `@earendil-works/pi-coding-agent@0.82.0`, remove it after every run, and never commit `node_modules`.
- Bun test has no expected-failure facility. Create local RED and GREEN commits, but do not push a RED branch tip.
- Follow Conventional Commits and keep Track A contracts/tests separate from Track B implementation.

---

## File Structure

### New files

- `dot_pi/agent/subagent-profiles.json` — versioned static profile catalog.
- `dot_pi/agent/exact_extensions/subagent/profiles.ts` — dependency-light schema parser, validation, and pure profile resolution.
- `dot_pi/agent/exact_extensions/subagent/profile-files.ts` — catalog/state paths and Node filesystem adapters.
- `dot_pi/agent/exact_extensions/subagent/profile-cli.ts` — testable CLI application and production composition root.
- `dot_pi/agent/exact_extensions/subagent/runtime-profiles.ts` — pure agent overlay plus one-snapshot execution wrapper.
- `dot_local/bin/executable_pi-subagents` — thin Bun executable that imports the deployed shared CLI module.
- `tests/subagent-profiles.test.ts` — catalog and selection contracts.
- `tests/pi-subagents-cli.test.ts` — CLI behavior with in-memory fakes and path contracts.
- `tests/subagent-runtime-profiles.test.ts` — user/project overlay, snapshot, and no-backend-on-failure behavior.
- `dot_pi/agent/exact_agents/{scout,planner,reviewer,worker}.md` — backend-neutral replacements for the current templates.

### Modified files

- `dot_pi/agent/exact_extensions/subagent/index.ts` — production wiring, profile snapshot loading, and fail-closed error result.
- `docs/qa/pi-subagent-backends.md` — runtime CLI and homogeneous-profile production QA.

### Removed files

- `.chezmoidata/pi/subagents.yaml` — rendered assignments/catalog superseded by the runtime catalog.
- `.chezmoitemplates/pi-subagent-frontmatter.tmpl` — backend routing no longer belongs in role front matter.
- `dot_pi/agent/exact_agents/{scout,planner,reviewer,worker}.md.tmpl` — replaced by plain Markdown definitions.

---

### Task 1: Profile catalog schema and pure resolver

**Files:**
- Create: `dot_pi/agent/subagent-profiles.json`
- Create: `dot_pi/agent/exact_extensions/subagent/profiles.ts`
- Create: `tests/subagent-profiles.test.ts`

**Interfaces:**
- Produces:

```ts
export type ProfileBackend = "pi" | "claude";
export type ProfileToolPolicy = readonly string[] | null;

export interface ProfileModel {
  readonly backend: ProfileBackend;
  readonly model: string;
}

export interface ProfileCatalog {
  readonly version: 1;
  readonly defaultProfile: string;
  readonly profiles: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly models: Readonly<Record<string, ProfileModel>>;
  readonly tools: Readonly<
    Record<string, Readonly<Record<ProfileBackend, ProfileToolPolicy>>>
  >;
}

export interface ResolvedRoleProfile {
  readonly alias: string;
  readonly backend: ProfileBackend;
  readonly model: string;
  readonly tools: ProfileToolPolicy;
}

export interface ResolvedProfile {
  readonly name: string;
  readonly roles: Readonly<Record<string, ResolvedRoleProfile>>;
}

export class ProfileConfigurationError extends Error {}

export function parseProfileCatalog(
  value: unknown,
  sourcePath: string,
): ProfileCatalog;

export function resolveProfile(
  catalog: ProfileCatalog,
  selectionContent: string | undefined,
  selectionPath: string,
): ResolvedProfile;
```

- Consumes: no Pi SDK or filesystem modules; `profiles.ts` must remain loadable by the standalone CLI.

- [ ] **Step 1: Add the exact version-1 JSON catalog**

Create `dot_pi/agent/subagent-profiles.json` with the complete catalog from the approved design:

```json
{
  "version": 1,
  "defaultProfile": "gpt",
  "profiles": {
    "gpt": {
      "scout": "gpt-5.6-luna",
      "planner": "gpt-5.6-terra",
      "reviewer": "gpt-5.6-terra",
      "worker": "gpt-5.6-terra"
    },
    "claude": {
      "scout": "claude-haiku-5",
      "planner": "claude-sonnet-5",
      "reviewer": "claude-sonnet-5",
      "worker": "claude-sonnet-5"
    }
  },
  "models": {
    "gpt-5.6-luna": { "backend": "pi", "model": "openai-codex/gpt-5.6-luna" },
    "gpt-5.6-terra": { "backend": "pi", "model": "openai-codex/gpt-5.6-terra" },
    "claude-haiku-5": { "backend": "claude", "model": "haiku" },
    "claude-sonnet-5": { "backend": "claude", "model": "sonnet" }
  },
  "tools": {
    "scout": {
      "pi": ["read", "grep", "find", "ls", "bash"],
      "claude": ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"]
    },
    "planner": {
      "pi": ["read", "grep", "find", "ls"],
      "claude": ["Read", "Grep", "Glob", "WebSearch", "WebFetch"]
    },
    "reviewer": {
      "pi": ["read", "grep", "find", "ls", "bash"],
      "claude": ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"]
    },
    "worker": {
      "pi": null,
      "claude": ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"]
    }
  }
}
```

- [ ] **Step 2: Write the domain contract tests**

Create `tests/subagent-profiles.test.ts`. Load the source catalog as raw JSON, then assert exact resolution:

```ts
import { describe, expect, test } from "bun:test";
import {
  parseProfileCatalog,
  resolveProfile,
} from "../dot_pi/agent/exact_extensions/subagent/profiles.ts";

const catalogPath = `${import.meta.dir}/../dot_pi/agent/subagent-profiles.json`;
const rawCatalog = JSON.parse(await Bun.file(catalogPath).text());
const parse = (value: unknown = rawCatalog) =>
  parseProfileCatalog(structuredClone(value), catalogPath);

const setPath = (root: any, keys: readonly string[], value: unknown) => {
  let current = root;
  for (const key of keys.slice(0, -1)) current = current[key];
  current[keys.at(-1)!] = value;
  return root;
};

describe("runtime subagent profile catalog", () => {
  test("resolves the missing selection to the complete GPT profile", () => {
    const resolved = resolveProfile(parse(), undefined, "/state/subagents-profile");
    expect(resolved).toEqual({
      name: "gpt",
      roles: {
        scout: {
          alias: "gpt-5.6-luna",
          backend: "pi",
          model: "openai-codex/gpt-5.6-luna",
          tools: ["read", "grep", "find", "ls", "bash"],
        },
        planner: {
          alias: "gpt-5.6-terra",
          backend: "pi",
          model: "openai-codex/gpt-5.6-terra",
          tools: ["read", "grep", "find", "ls"],
        },
        reviewer: {
          alias: "gpt-5.6-terra",
          backend: "pi",
          model: "openai-codex/gpt-5.6-terra",
          tools: ["read", "grep", "find", "ls", "bash"],
        },
        worker: {
          alias: "gpt-5.6-terra",
          backend: "pi",
          model: "openai-codex/gpt-5.6-terra",
          tools: null,
        },
      },
    });
  });

  test("resolves one final newline to the complete Claude profile", () => {
    const resolved = resolveProfile(parse(), "claude\n", "/state/subagents-profile");
    expect(resolved.name).toBe("claude");
    expect(resolved.roles).toMatchObject({
      scout: { alias: "claude-haiku-5", backend: "claude", model: "haiku" },
      planner: { alias: "claude-sonnet-5", backend: "claude", model: "sonnet" },
      reviewer: { alias: "claude-sonnet-5", backend: "claude", model: "sonnet" },
      worker: { alias: "claude-sonnet-5", backend: "claude", model: "sonnet" },
    });
    expect(resolved.roles.worker.tools).toEqual([
      "Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebSearch", "WebFetch",
    ]);
  });
});
```

Add table-driven invalid catalog cases with these exact mutations and diagnostic fragments:

```ts
const invalidCatalogCases = [
  ["version", ["version"], 2, "$.version must equal 1"],
  ["unknown top-level property", ["extra"], true, '$ contains unknown property "extra"'],
  ["missing default profile", ["defaultProfile"], "missing", '$.defaultProfile references unknown profile "missing"'],
  ["inconsistent roles", ["profiles", "claude", "worker"], undefined, '$.profiles.claude must define the same roles as $.profiles.gpt'],
  ["unknown alias", ["profiles", "gpt", "scout"], "missing", '$.profiles.gpt.scout references unknown model alias "missing"'],
  ["unsupported backend", ["models", "gpt-5.6-luna", "backend"], "other", '$.models.gpt-5.6-luna.backend must be "pi" or "claude"'],
  ["blank model", ["models", "gpt-5.6-luna", "model"], " ", "$.models.gpt-5.6-luna.model must be a non-empty string"],
  ["missing tools role", ["tools", "scout"], undefined, "$.tools.scout is required"],
  ["Pi empty tools", ["tools", "scout", "pi"], [], "$.tools.scout.pi must be a non-empty array or null"],
  ["Claude null tools", ["tools", "scout", "claude"], null, "$.tools.scout.claude must be a non-empty array"],
  ["blank tool", ["tools", "scout", "claude", "0"], " ", "$.tools.scout.claude[0] must be a non-empty string"],
  ["duplicate tool", ["tools", "scout", "claude", "1"], "Read", '$.tools.scout.claude contains duplicate tool "Read"'],
  ["nested Agent", ["tools", "scout", "claude", "0"], "Agent", '$.tools.scout.claude must not include nested tool "Agent"'],
] as const;
```

For the two removal cases, delete the property rather than assign `undefined`. Add selection cases for `""`, `"gpt\nextra\n"`, `"bad profile\n"`, and `"missing\n"`; each must throw a `ProfileConfigurationError` naming `/state/subagents-profile`. Also assert all profile names accept only `[A-Za-z0-9._-]+` and unknown object properties are rejected at model and tool-policy levels.

- [ ] **Step 3: Add compiling RED stubs**

Create `profiles.ts` with the exact exported types and signatures above. Each function body throws `new ProfileConfigurationError("runtime profile resolver is not implemented")`. Do not add validation or resolution logic in this step.

- [ ] **Step 4: Run the focused tests and verify RED**

Use the accepted temporary dependency bootstrap:

```bash
set -euo pipefail
trap 'rm -rf node_modules' EXIT
test ! -e node_modules
mkdir -p node_modules/@earendil-works
ln -s /Users/eddiehuang/.bun/install/global/node_modules/@earendil-works/pi-coding-agent \
  node_modules/@earendil-works/pi-coding-agent
bun test tests/subagent-profiles.test.ts
```

Expected: failures report `runtime profile resolver is not implemented`; the test file compiles.

- [ ] **Step 5: Commit the RED contracts and tests locally**

```bash
git add dot_pi/agent/subagent-profiles.json \
  dot_pi/agent/exact_extensions/subagent/profiles.ts \
  tests/subagent-profiles.test.ts
git commit -m "test(pi): define runtime profile contracts"
```

Do not push this RED commit.

- [ ] **Step 6: Implement strict parsing and resolution**

Implement small assertion helpers in `profiles.ts`:

```ts
const PROFILE_NAME = /^[A-Za-z0-9._-]+$/;

function fail(sourcePath: string, path: string, requirement: string): never {
  throw new ProfileConfigurationError(
    `Subagent profile catalog at "${sourcePath}": ${path} ${requirement}`,
  );
}

function assertPlainObject(
  value: unknown,
  sourcePath: string,
  jsonPath: string,
): asserts value is Record<string, unknown>;

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  sourcePath: string,
  jsonPath: string,
): void;

function parseTools(
  value: unknown,
  backend: ProfileBackend,
  sourcePath: string,
  jsonPath: string,
): ProfileToolPolicy;
```

Parse a defensive copy into readonly structures. Validate the complete catalog, not only the selected profile: exact top-level keys; version; profile names; non-empty and identical role sets; exact model-entry keys; supported backends; non-empty native model IDs; all alias references; exact `pi` and `claude` tool-policy keys for every role; unique trimmed tools; Claude non-null/non-empty; forbidden Claude `Agent`.

`resolveProfile` must:

```ts
const selected = selectionContent === undefined
  ? catalog.defaultProfile
  : parseSelection(selectionContent, selectionPath);
```

Accept only a profile name with zero or one final newline, reject other whitespace or multiple lines, verify the selected profile exists, and return fresh role records and tool arrays so callers cannot mutate catalog data.

- [ ] **Step 7: Run focused and existing agent-definition tests and verify GREEN**

Run with a fresh temporary dependency bootstrap:

```bash
set -euo pipefail
trap 'rm -rf node_modules' EXIT
test ! -e node_modules
mkdir -p node_modules/@earendil-works
ln -s /Users/eddiehuang/.bun/install/global/node_modules/@earendil-works/pi-coding-agent \
  node_modules/@earendil-works/pi-coding-agent
bun test tests/subagent-profiles.test.ts tests/subagent-agents.test.ts
```

Expected: all tests pass; no `node_modules` remains after the shell trap.

- [ ] **Step 8: Commit the resolver implementation**

```bash
git add dot_pi/agent/exact_extensions/subagent/profiles.ts
git commit -m "feat(pi): resolve runtime subagent profiles"
```

---

### Task 2: Filesystem adapters and shared CLI

**Files:**
- Create: `dot_pi/agent/exact_extensions/subagent/profile-files.ts`
- Create: `dot_pi/agent/exact_extensions/subagent/profile-cli.ts`
- Create: `dot_local/bin/executable_pi-subagents`
- Create: `tests/pi-subagents-cli.test.ts`

**Interfaces:**
- Consumes: `ProfileCatalog`, `ResolvedProfile`, `parseProfileCatalog()`, and `resolveProfile()` from Task 1.
- Produces:

```ts
export interface ProfileCatalogRepository {
  load(): Promise<ProfileCatalog>;
}

export interface ProfileSelectionStore {
  readonly filePath: string;
  read(): Promise<string | undefined>;
  write(profile: string): Promise<void>;
}

export class NodeProfileCatalogRepository implements ProfileCatalogRepository {
  constructor(readonly filePath: string);
  load(): Promise<ProfileCatalog>;
}

export class NodeProfileSelectionStore implements ProfileSelectionStore {
  constructor(readonly filePath: string);
  read(): Promise<string | undefined>;
  write(profile: string): Promise<void>;
}

export function resolveAgentConfigDir(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string;

export function resolveProfileStatePath(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string;

export async function loadResolvedProfile(
  repository: ProfileCatalogRepository,
  store: ProfileSelectionStore,
): Promise<ResolvedProfile>;

export interface ProfileCliDependencies {
  repository: ProfileCatalogRepository;
  store: ProfileSelectionStore;
  stdout(line: string): void;
  stderr(line: string): void;
}

export async function runProfileCli(
  args: readonly string[],
  dependencies: ProfileCliDependencies,
): Promise<number>;

export async function runNodeProfileCli(args: readonly string[]): Promise<number>;
```

- [ ] **Step 1: Write CLI and path RED tests with practical fakes**

Create a stateful `FakeSelectionStore` and static `FakeCatalogRepository` in `tests/pi-subagents-cli.test.ts`:

```ts
class FakeSelectionStore implements ProfileSelectionStore {
  readonly filePath = "/state/pi/subagents-profile";
  writes: string[] = [];

  constructor(public content: string | undefined) {}

  async read() { return this.content; }

  async write(profile: string) {
    this.writes.push(profile);
    this.content = `${profile}\n`;
  }
}

class FakeCatalogRepository implements ProfileCatalogRepository {
  loads = 0;
  constructor(private readonly catalog: ProfileCatalog) {}
  async load() {
    this.loads++;
    return this.catalog;
  }
}
```

Test these exact behaviors:

```ts
test("bare command reports the default profile and sorted resolved roles", async () => {
  const output: string[] = [];
  const code = await runProfileCli([], {
    repository: new FakeCatalogRepository(catalog),
    store: new FakeSelectionStore(undefined),
    stdout: (line) => output.push(line),
    stderr: () => { throw new Error("unexpected stderr"); },
  });
  expect(code).toBe(0);
  expect(output).toEqual([
    "Active profile: gpt",
    "planner: pi/openai-codex/gpt-5.6-terra tools=read,grep,find,ls",
    "reviewer: pi/openai-codex/gpt-5.6-terra tools=read,grep,find,ls,bash",
    "scout: pi/openai-codex/gpt-5.6-luna tools=read,grep,find,ls,bash",
    "worker: pi/openai-codex/gpt-5.6-terra tools=default",
  ]);
});

test("use validates then writes one profile and reports Claude assignments", async () => {
  const store = new FakeSelectionStore("gpt\n");
  const output: string[] = [];
  const code = await runProfileCli(["use", "claude"], {
    repository: new FakeCatalogRepository(catalog),
    store,
    stdout: (line) => output.push(line),
    stderr: () => { throw new Error("unexpected stderr"); },
  });
  expect(code).toBe(0);
  expect(store.writes).toEqual(["claude"]);
  expect(output[0]).toBe("Active profile: claude");
  expect(output).toContain("scout: claude/haiku tools=Read,Grep,Glob,Bash,WebSearch,WebFetch");
});
```

Also test:

- `list` outputs `claude` and `gpt (default)` in lexical order without writing state.
- `use missing`, `use`, `use gpt extra`, and unknown commands return `2`, print exact usage, and never write.
- An unknown profile returns `1`, names the unknown value, and never writes.
- Corrupt existing state makes bare status fail, while `use gpt` repairs it because `use` validates the requested value without resolving old state.
- Repository/read/write failures return `1` and print one `Error:` line.
- `resolveAgentConfigDir` honors `PI_CODING_AGENT_DIR`, else returns `$HOME/.pi/agent`.
- `resolveProfileStatePath` honors an absolute `XDG_STATE_HOME`, else returns `$HOME/.local/state/pi/subagents-profile`; a relative `XDG_STATE_HOME` throws an actionable error.

- [ ] **Step 2: Add compiling RED interfaces and executable**

Create `profile-files.ts` and `profile-cli.ts` with the exact interfaces above and function bodies that throw `new Error("profile CLI is not implemented")`.

Create the thin deployed executable:

```ts
#!/usr/bin/env bun

import { runNodeProfileCli } from "../../.pi/agent/extensions/subagent/profile-cli.ts";

process.exitCode = await runNodeProfileCli(process.argv.slice(2));
```

- [ ] **Step 3: Run focused tests and verify RED**

```bash
bun test tests/pi-subagents-cli.test.ts
```

Expected: failures report `profile CLI is not implemented`; tests compile.

- [ ] **Step 4: Commit the RED CLI contracts and tests locally**

```bash
git add dot_pi/agent/exact_extensions/subagent/profile-files.ts \
  dot_pi/agent/exact_extensions/subagent/profile-cli.ts \
  dot_local/bin/executable_pi-subagents \
  tests/pi-subagents-cli.test.ts
git commit -m "test(pi): define subagent profile CLI"
```

Do not push this RED commit.

- [ ] **Step 5: Implement file adapters and atomic state writes**

In `profile-files.ts`:

- Read JSON as UTF-8, parse it, and call `parseProfileCatalog(raw, filePath)`.
- Convert JSON syntax errors and filesystem errors to diagnostics naming `filePath`.
- Return `undefined` only for state `ENOENT`; propagate every other read error.
- For `write(profile)`, create the parent directory recursively with mode `0o700`, create a unique temporary file in that directory with mode `0o600`, write exactly `${profile}\n`, close it, then rename it over the state path.
- On failure after temporary-file creation, attempt unlink and preserve the original error.
- Resolve `PI_CODING_AGENT_DIR` and `XDG_STATE_HOME` exactly as specified in the interfaces; reject relative `XDG_STATE_HOME` rather than silently resolving it against the working directory.
- `loadResolvedProfile` awaits one repository load and one store read, then calls `resolveProfile(catalog, selection, store.filePath)`.

Use `node:fs/promises`, `node:os`, `node:path`, and `node:crypto.randomUUID`; do not import Pi packages.

- [ ] **Step 6: Implement the CLI application**

In `profile-cli.ts`, format roles in lexical order with this pure formatter:

```ts
function formatResolvedProfile(profile: ResolvedProfile): string[] {
  return [
    `Active profile: ${profile.name}`,
    ...Object.entries(profile.roles)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([role, config]) =>
        `${role}: ${config.backend}/${config.model} tools=${config.tools?.join(",") ?? "default"}`,
      ),
  ];
}
```

Implement command dispatch:

- `[]`: call `loadResolvedProfile` and print every formatter line.
- `["list"]`: load and validate the catalog, print profile names sorted; append ` (default)` to the default profile. Do not read or write selection state.
- `["use", profile]`: load the catalog, resolve the requested profile using `${profile}\n`, write only after successful resolution, then print the resolved lines.
- Any other shape: print `Usage: pi-subagents [list | use <profile>]` to stderr and return `2`.
- Expected runtime/configuration failures print `Error: ${message}` and return `1`.

`runNodeProfileCli` composes paths from `process.env` and `os.homedir()`, creates the two Node adapters, and writes through `console.log`/`console.error`. Wrap composition as well as `runProfileCli` so invalid path configuration prints one `Error:` line and returns `1` instead of producing an unhandled rejection.

- [ ] **Step 7: Run focused tests and direct CLI QA**

Run the unit tests:

```bash
bun test tests/pi-subagents-cli.test.ts tests/subagent-profiles.test.ts
```

Render the executable to a temporary path and exercise it against an isolated temporary HOME/config/state tree containing the managed catalog:

```bash
set -euo pipefail
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp" node_modules' EXIT
mkdir -p "$tmp/home/.pi/agent/extensions/subagent" "$tmp/home/.local/bin"
cp dot_pi/agent/subagent-profiles.json "$tmp/home/.pi/agent/subagent-profiles.json"
cp dot_pi/agent/exact_extensions/subagent/{profiles,profile-files,profile-cli}.ts \
  "$tmp/home/.pi/agent/extensions/subagent/"
cp dot_local/bin/executable_pi-subagents "$tmp/home/.local/bin/pi-subagents"
chmod +x "$tmp/home/.local/bin/pi-subagents"
HOME="$tmp/home" XDG_STATE_HOME="$tmp/state" "$tmp/home/.local/bin/pi-subagents"
HOME="$tmp/home" XDG_STATE_HOME="$tmp/state" "$tmp/home/.local/bin/pi-subagents" use claude
HOME="$tmp/home" XDG_STATE_HOME="$tmp/state" "$tmp/home/.local/bin/pi-subagents"
test "$(cat "$tmp/state/pi/subagents-profile")" = "claude"
```

Expected: first status is GPT, `use claude` and final status are Claude, and the state file contains exactly `claude` plus its final newline.

- [ ] **Step 8: Commit the CLI implementation**

```bash
git add dot_pi/agent/exact_extensions/subagent/profile-files.ts \
  dot_pi/agent/exact_extensions/subagent/profile-cli.ts
git commit -m "feat(pi): add runtime subagent profile CLI"
```

---

### Task 3: Runtime extension integration

**Files:**
- Create: `dot_pi/agent/exact_extensions/subagent/runtime-profiles.ts`
- Create: `tests/subagent-runtime-profiles.test.ts`
- Modify: `dot_pi/agent/exact_extensions/subagent/index.ts`

**Interfaces:**
- Consumes: `AgentConfig`, `ExecuteSubagentModeInput`, `SubagentExecution`, `ResolvedProfile`, and `loadResolvedProfile()`.
- Produces:

```ts
export interface RuntimeProfileLoader {
  load(): Promise<ResolvedProfile>;
}

export function applyRuntimeProfile(
  agents: readonly AgentConfig[],
  profile: ResolvedProfile,
): AgentConfig[];

export async function executeWithRuntimeProfile(
  input: ExecuteSubagentModeInput,
  loader: RuntimeProfileLoader,
): Promise<SubagentExecution>;

export function formatRuntimeProfileError(error: unknown): string;
```

- [ ] **Step 1: Write overlay and one-snapshot RED tests**

Create `tests/subagent-runtime-profiles.test.ts` using stateful fake loaders and the existing `SubagentBackend` shape. Assert:

```ts
test("overlays configured user roles and leaves project or custom agents unchanged", () => {
  const result = applyRuntimeProfile(
    [
      userAgent("scout", { backend: "pi", model: "stale", tools: ["stale"] }),
      projectAgent("planner", { backend: "pi", model: "project-model", tools: ["read"] }),
      userAgent("custom", { backend: "claude", model: "opus", tools: ["Read"] }),
    ],
    claudeProfile,
  );

  expect(result[0]).toMatchObject({
    name: "scout", source: "user", backend: "claude", model: "haiku",
    tools: ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"],
  });
  expect(result[1]).toMatchObject({ name: "planner", source: "project", model: "project-model" });
  expect(result[2]).toMatchObject({ name: "custom", source: "user", model: "opus" });
});

test("Pi null policy removes stale model tools before execution", () => {
  const [worker] = applyRuntimeProfile(
    [userAgent("worker", { backend: "claude", model: "sonnet", tools: ["Read"] })],
    gptProfile,
  );
  expect(worker).toEqual(expect.objectContaining({
    name: "worker", source: "user", backend: "pi",
    model: "openai-codex/gpt-5.6-terra",
  }));
  expect(worker.tools).toBeUndefined();
});
```

Add asynchronous tests that:

- Execute a four-item parallel request and assert `loader.load()` is called exactly once and every fake backend request uses the same resolved profile.
- Execute a chain and mutate the fake loader's next result after step one; assert step two still uses the first snapshot.
- Make `loader.load()` reject with a catalog diagnostic; assert `executeWithRuntimeProfile` rejects and both fake backend request arrays stay empty.
- Assert `formatRuntimeProfileError(new Error("bad state"))` equals `Subagent profile resolution failed: bad state`.

- [ ] **Step 2: Add compiling RED runtime stubs**

Create `runtime-profiles.ts` with the exact interfaces and signatures above. Each runtime function throws `new Error("runtime profile application is not implemented")`.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
set -euo pipefail
trap 'rm -rf node_modules' EXIT
test ! -e node_modules
mkdir -p node_modules/@earendil-works
ln -s /Users/eddiehuang/.bun/install/global/node_modules/@earendil-works/pi-coding-agent \
  node_modules/@earendil-works/pi-coding-agent
bun test tests/subagent-runtime-profiles.test.ts
```

Expected: failures report `runtime profile application is not implemented`; tests compile.

- [ ] **Step 4: Commit the RED runtime tests locally**

```bash
git add dot_pi/agent/exact_extensions/subagent/runtime-profiles.ts \
  tests/subagent-runtime-profiles.test.ts
git commit -m "test(pi): define runtime profile routing"
```

Do not push this RED commit.

- [ ] **Step 5: Implement pure profile overlay and wrapper**

In `applyRuntimeProfile`, return a new array. For each configured user agent, destructure away stale `backend`, `model`, and `tools`, preserve identity/prompt/source/path, then construct the correct discriminated union:

```ts
const { backend: _backend, model: _model, tools: _tools, ...base } = agent;
if (resolved.backend === "claude") {
  return {
    ...base,
    backend: "claude",
    model: resolved.model,
    tools: [...resolved.tools!],
  };
}
return {
  ...base,
  backend: "pi",
  model: resolved.model,
  ...(resolved.tools === null ? {} : { tools: [...resolved.tools] }),
};
```

Do not overlay an agent unless `agent.source === "user"` and its exact name is an own property of `profile.roles`.

`executeWithRuntimeProfile` must await `loader.load()` once, apply the result once, then call `executeSubagentMode` with the copied input and resolved agents. It must not catch profile errors; the extension composition root formats them.

- [ ] **Step 6: Wire production repositories and fail-closed results in `index.ts`**

At extension setup, create the catalog repository, but defer state-path resolution until invocation so an invalid XDG environment fails the tool call rather than preventing extension registration:

```ts
const catalogRepository = new NodeProfileCatalogRepository(
  path.join(getAgentDir(), "subagent-profiles.json"),
);
const profileLoader: RuntimeProfileLoader = {
  async load() {
    const selectionStore = new NodeProfileSelectionStore(
      resolveProfileStatePath(process.env, os.homedir()),
    );
    return loadResolvedProfile(catalogRepository, selectionStore);
  },
};
```

Replace the direct `executeSubagentMode` call with `executeWithRuntimeProfile`. Preserve project-agent confirmation before execution. Catch only at the tool composition boundary:

```ts
let execution: SubagentExecution;
try {
  execution = await executeWithRuntimeProfile(
    {
      params,
      agents: discovery.agents,
      discoveryDiagnostics: discovery.diagnostics,
      backends,
      defaultCwd: ctx.cwd,
      signal,
      ...(onUpdate
        ? {
            onUpdate(mode, results) {
              const details = makeDetails(mode, results);
              onUpdate({
                content: [{ type: "text", text: "(running...)" }],
                details,
              });
            },
          }
        : {}),
    },
    profileLoader,
  );
} catch (error) {
  const diagnostic = formatRuntimeProfileError(error);
  return {
    content: [{ type: "text", text: diagnostic }],
    details: makeDetails(requestedMode, []),
    isError: true,
  };
}
```

Keep the existing update/details semantics unchanged. Do not alter backend adapters, process runner, invocation builders, or tool-call parameters.

- [ ] **Step 7: Run runtime, orchestrator, invocation, and agent tests**

```bash
set -euo pipefail
trap 'rm -rf node_modules' EXIT
test ! -e node_modules
mkdir -p node_modules/@earendil-works
ln -s /Users/eddiehuang/.bun/install/global/node_modules/@earendil-works/pi-coding-agent \
  node_modules/@earendil-works/pi-coding-agent
bun test \
  tests/subagent-runtime-profiles.test.ts \
  tests/subagent-orchestrator.test.ts \
  tests/subagent-invocation.test.ts \
  tests/subagent-agents.test.ts
```

Expected: all tests pass, including the unchanged direct-front-matter tests; the trap removes `node_modules`.

- [ ] **Step 8: Commit runtime integration**

```bash
git add dot_pi/agent/exact_extensions/subagent/runtime-profiles.ts \
  dot_pi/agent/exact_extensions/subagent/index.ts
git commit -m "feat(pi): route subagents through runtime profiles"
```

---

### Task 4: Backend-neutral agents, QA migration, and deployment

**Files:**
- Create: `dot_pi/agent/exact_agents/scout.md`
- Create: `dot_pi/agent/exact_agents/planner.md`
- Create: `dot_pi/agent/exact_agents/reviewer.md`
- Create: `dot_pi/agent/exact_agents/worker.md`
- Modify: `docs/qa/pi-subagent-backends.md`
- Remove: `.chezmoidata/pi/subagents.yaml`
- Remove: `.chezmoitemplates/pi-subagent-frontmatter.tmpl`
- Remove: `dot_pi/agent/exact_agents/scout.md.tmpl`
- Remove: `dot_pi/agent/exact_agents/planner.md.tmpl`
- Remove: `dot_pi/agent/exact_agents/reviewer.md.tmpl`
- Remove: `dot_pi/agent/exact_agents/worker.md.tmpl`

**Interfaces:**
- Consumes: runtime catalog, CLI, and extension resolver from Tasks 1–3.
- Produces: four backend-neutral managed agent definitions and a runtime-profile QA contract.

- [ ] **Step 1: Replace rendered front matter with identity-only Markdown**

For each role, copy its current prompt body verbatim into the corresponding plain `.md` file. Use exactly these front-matter blocks:

```yaml
---
name: scout
description: Fast codebase reconnaissance that returns compressed context for handoff
---
```

```yaml
---
name: planner
description: Creates implementation plans from context and requirements
---
```

```yaml
---
name: reviewer
description: Reviews code for quality, security, and maintainability
---
```

```yaml
---
name: worker
description: General-purpose worker with isolated context
---
```

No role file may contain `backend:`, `model:`, or `tools:`.

- [ ] **Step 2: Remove obsolete rendered-routing sources**

Delete the `.md.tmpl` files, `.chezmoidata/pi/subagents.yaml`, and `.chezmoitemplates/pi-subagent-frontmatter.tmpl`. If `.chezmoidata/pi` becomes empty, remove the empty directory. Do not add deployed agents to `.chezmoiremove`; `exact_agents` owns stale-target removal.

- [ ] **Step 3: Rewrite manual QA around runtime profiles**

Update `docs/qa/pi-subagent-backends.md` so prerequisites use:

```bash
pi-subagents list
pi-subagents
pi-subagents use claude
pi-subagents use gpt
```

Remove every instruction to edit `.chezmoidata`, run chezmoi between profile changes, or `/reload` after a profile change. Preserve the warning that production model checks are manual and require an authenticated disposable repository.

Define these checks explicitly:

1. Missing-state/default GPT status and GPT planner invocation.
2. Claude selection, Claude scout invocation, and Claude worker tool event.
3. Parallel and chain calls remain homogeneous within one selected profile.
4. Switching state while a long chain runs affects only the next tool invocation.
5. A project-local `scout` used with `agentScope: both` retains its own direct front matter while global user `scout` remains profiled.
6. Directly corrupting the state token causes an actionable failure before any backend starts; `pi-subagents use gpt` repairs it.
7. Claude cancellation and expanded-result rendering remain correct.
8. Cleanup restores the profile active before QA and removes disposable project-agent files.

- [ ] **Step 4: Verify source rendering before apply**

```bash
set -euo pipefail
for role in scout planner reviewer worker; do
  rendered="$(chezmoi cat "$HOME/.pi/agent/agents/$role.md")"
  printf '%s' "$rendered" | grep -q "^name: $role$"
  ! printf '%s' "$rendered" | grep -Eq '^(backend|model|tools):'
done
chezmoi cat "$HOME/.pi/agent/subagent-profiles.json" | jq -e \
  '.version == 1 and .defaultProfile == "gpt" and (.profiles | keys == ["claude", "gpt"])'
chezmoi cat "$HOME/.local/bin/pi-subagents" | grep -q '^#!/usr/bin/env bun$'
```

Expected: all commands exit zero.

- [ ] **Step 5: Commit migration and QA**

This is a configuration/UI-free migration covered by Tasks 1–3 tests, so it uses the repository's config-change TDD exception:

```bash
git add -A -- \
  .chezmoidata/pi/subagents.yaml \
  .chezmoitemplates/pi-subagent-frontmatter.tmpl \
  dot_pi/agent/exact_agents \
  docs/qa/pi-subagent-backends.md
git commit -m "refactor(pi): make subagent roles backend-neutral"
```

- [ ] **Step 6: Run the complete automated suite**

```bash
set -euo pipefail
trap 'rm -rf node_modules' EXIT
test ! -e node_modules
mkdir -p node_modules/@earendil-works
ln -s /Users/eddiehuang/.bun/install/global/node_modules/@earendil-works/pi-coding-agent \
  node_modules/@earendil-works/pi-coding-agent
bun test
```

Expected: all existing and new tests pass with zero failures; `node_modules` is removed by the trap.

- [ ] **Step 7: Preview and apply all managed targets**

```bash
chezmoi diff \
  "$HOME/.pi/agent/agents" \
  "$HOME/.pi/agent/extensions/subagent" \
  "$HOME/.pi/agent/subagent-profiles.json" \
  "$HOME/.local/bin/pi-subagents"
chezmoi apply \
  "$HOME/.pi/agent/agents" \
  "$HOME/.pi/agent/extensions/subagent" \
  "$HOME/.pi/agent/subagent-profiles.json" \
  "$HOME/.local/bin/pi-subagents"
```

Inspect the preview before applying. Expected changes are the plain agent front matter, new profile modules/catalog, and new CLI only.

- [ ] **Step 8: Verify deployed membership, default state, and immediate switching**

```bash
set -euo pipefail
actual="$(find "$HOME/.pi/agent/agents" -maxdepth 1 -type f -exec basename {} \; | sort)"
expected="$(printf '%s\n' planner.md reviewer.md scout.md worker.md)"
test "$actual" = "$expected"

for role in scout planner reviewer worker; do
  ! grep -Eq '^(backend|model|tools):' "$HOME/.pi/agent/agents/$role.md"
done

state_root="${XDG_STATE_HOME:-$HOME/.local/state}"
state_path="$state_root/pi/subagents-profile"
backup="$(mktemp)"
had_state=0
if test -f "$state_path"; then
  cp "$state_path" "$backup"
  had_state=1
fi
restore_state() {
  if test "$had_state" -eq 1; then
    mkdir -p "$(dirname "$state_path")"
    cp "$backup" "$state_path"
  else
    rm -f "$state_path"
  fi
  rm -f "$backup"
}
trap restore_state EXIT

pi-subagents list
pi-subagents
pi-subagents use claude
pi-subagents | grep -q '^Active profile: claude$'
pi-subagents use gpt
pi-subagents | grep -q '^Active profile: gpt$'

restore_state
trap - EXIT

status_output="$(chezmoi status \
  "$HOME/.pi/agent/agents" \
  "$HOME/.pi/agent/extensions/subagent" \
  "$HOME/.pi/agent/subagent-profiles.json" \
  "$HOME/.local/bin/pi-subagents")"
test -z "$status_output"
```

The script restores either the original state file or its original absence. Do not run production model calls automatically.

- [ ] **Step 9: Final hygiene and review preparation**

```bash
git diff --check
test -z "$(git status --porcelain)"
git log --oneline --decorate -12
```

Expected: no whitespace errors, a clean working tree, and every RED commit followed by its GREEN implementation before publication.

Prepare the complete implementation range from the design commit's parent through `HEAD` for final review. Verify the implementation against every section of `docs/superpowers/specs/2026-07-24-pi-subagent-runtime-profiles-design.md`. Defer production-model QA until authenticated disposable-environment prerequisites are available.
