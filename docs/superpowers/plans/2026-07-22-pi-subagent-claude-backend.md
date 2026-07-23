# Pi Subagent Claude Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each Pi subagent definition select either a non-interactive Pi process or Claude Code while preserving one single/parallel/chain contract.

**Architecture:** Parse agent frontmatter into a discriminated Pi/Claude configuration, then route execution through backend adapters that normalize CLI streams into one result schema. Keep process spawning behind an injected port, move orchestration out of the 1,016-line extension entry point, and wire concrete adapters only in `index.ts`.

**Tech Stack:** TypeScript, Bun test, Pi extension API, TypeBox, Node child processes, Claude Code `stream-json`, chezmoi.

## Global Constraints

- Edit only chezmoi source state under `dot_pi/agent`; never edit deployed `~/.pi/agent` files directly.
- Missing `backend` means `pi`; `backend: claude` requires non-empty backend-native `model` and `tools`.
- Do not add backend selection to the `subagent` tool input schema.
- Never expose Pi `subagent` or Claude `Agent` to child agents.
- Claude must use `--tools`, matching `--allowedTools`, `--disallowedTools Agent`, and `--permission-mode dontAsk`; never use a permission-bypass flag.
- Claude inherits normal `CLAUDE.md`, settings, hooks, plugins, and authentication; do not pass `--bare`, `--safe-mode`, or `--setting-sources`.
- Preserve maximums of eight parallel tasks, four concurrent processes, and 50 KiB model-visible output per task.
- Do not fall back, retry on another backend, or add Claude workflow templates.
- Rename managed Pi agents to `gpt-*` without unprefixed aliases; existing workflow templates must use `gpt-*`.
- Automated tests must use fakes/static fixtures only: no Pi/Claude subprocess, network, terminal UI, clock, or sampling.
- Bun test has no expected-failure semantics. Keep each raw RED commit local until its matching GREEN commit exists; never publish a RED branch tip.
- Any `throw new Error("not implemented")` shown below is a compile-only RED stub required by the project protocol and must be replaced in the matching GREEN commit.
- Commit directly to `main`; do not create a worktree or feature branch.

## File Structure

| File | Responsibility |
| --- | --- |
| `dot_pi/agent/exact_extensions/subagent/contracts.ts` | Backend-neutral execution, event, usage, process-port, and detail contracts. |
| `dot_pi/agent/exact_extensions/subagent/agents.ts` | Parse, validate, discover, and merge discriminated Pi/Claude agent definitions. |
| `dot_pi/agent/exact_extensions/subagent/process-runner.ts` | Production Node child-process effect and cancellation lifecycle. |
| `dot_pi/agent/exact_extensions/subagent/pi-backend.ts` | Build Pi invocation, parse Pi JSONL, and implement the Pi backend adapter. |
| `dot_pi/agent/exact_extensions/subagent/claude-backend.ts` | Build Claude invocation, parse Claude stream JSON, and implement the Claude adapter. |
| `dot_pi/agent/exact_extensions/subagent/orchestrator.ts` | Backend-neutral single, parallel, chain, truncation, and usage aggregation. |
| `dot_pi/agent/exact_extensions/subagent/index.ts` | TypeBox tool schema, project confirmation, composition root, and TUI rendering only. |
| `tests/subagent-agents.test.ts` | Agent schema and diagnostic contracts. |
| `tests/subagent-invocation.test.ts` | Pi and Claude invocation contracts. |
| `tests/subagent-streams.test.ts` | Static Pi/Claude stream normalization fixtures. |
| `tests/subagent-orchestrator.test.ts` | Fake-backed orchestration, failure, cancellation, truncation, and usage contracts. |
| `dot_pi/agent/agents/{gpt,claude}-*.md` | Eight explicit managed agent definitions. |
| `.chezmoiremove` | Remove deployed unprefixed agent files because `dot_pi/agent/agents` is not an exact directory. |
| `dot_pi/agent/prompts/*.md` | Existing GPT-backed workflow templates. |
| `docs/qa/pi-subagent-backends.md` | Manual-only production boundary verification. |

---

### Task 1: Discriminated Agent Definition Contract

**Files:**
- Modify: `dot_pi/agent/exact_extensions/subagent/agents.ts:1-126`
- Create: `tests/subagent-agents.test.ts`

**Interfaces:**
- Produces: `AgentBackend`, `PiAgentConfig`, `ClaudeAgentConfig`, `AgentConfig`, `AgentDiagnostic`, and `parseAgentDefinition(content, filePath, source)`.
- Produces: `AgentDiscoveryResult.diagnostics`, consumed by Task 5 for actionable unknown/invalid-agent results.
- Preserves: `discoverAgents(cwd, scope)` and project-over-user precedence.

- [ ] **Step 1: Add contract shells and raw failing schema tests**

Add these exported contracts to `agents.ts`; leave the existing discovery implementation in place for the RED commit:

```ts
export type AgentBackend = "pi" | "claude";

interface BaseAgentConfig {
	name: string;
	description: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface PiAgentConfig extends BaseAgentConfig {
	backend: "pi";
	tools?: string[];
	model?: string;
}

export interface ClaudeAgentConfig extends BaseAgentConfig {
	backend: "claude";
	tools: string[];
	model: string;
}

export type AgentConfig = PiAgentConfig | ClaudeAgentConfig;

export interface AgentDiagnostic {
	name: string | null;
	filePath: string;
	message: string;
}

export type ParsedAgentDefinition =
	| { agent: AgentConfig; diagnostic: null }
	| { agent: null; diagnostic: AgentDiagnostic };

export function parseAgentDefinition(
	_content: string,
	filePath: string,
	_source: "user" | "project",
): ParsedAgentDefinition {
	throw new Error(`Agent parsing not implemented for ${filePath}`);
}
```

Create `tests/subagent-agents.test.ts` with tests using complete Markdown strings. Required assertions:

```ts
import { describe, expect, test } from "bun:test";
import { parseAgentDefinition } from "../dot_pi/agent/exact_extensions/subagent/agents";

const parse = (frontmatter: string) =>
	parseAgentDefinition(`---\n${frontmatter}\n---\nSystem prompt.\n`, "/agents/example.md", "user");

describe("subagent definitions", () => {
	test("defaults an omitted backend to pi", () => {
		expect(parse("name: worker\ndescription: Worker")).toEqual({
			agent: {
				name: "worker",
				description: "Worker",
				backend: "pi",
				systemPrompt: "System prompt.",
				source: "user",
				filePath: "/agents/example.md",
			},
			diagnostic: null,
		});
	});

	test("accepts backend-native Claude model and tools", () => {
		const parsed = parse(
			"name: claude-worker\ndescription: Worker\nbackend: claude\nmodel: sonnet\ntools: Read, Write, WebSearch",
		);
		expect(parsed.agent).toMatchObject({
			name: "claude-worker",
			backend: "claude",
			model: "sonnet",
			tools: ["Read", "Write", "WebSearch"],
		});
		expect(parsed.diagnostic).toBeNull();
	});

	for (const [name, definition, message] of [
		["backend", "name: bad\ndescription: Bad\nbackend: codex", 'unsupported backend "codex"'],
		["model", "name: bad\ndescription: Bad\nbackend: claude\ntools: Read", 'requires a non-empty "model"'],
		["tools", "name: bad\ndescription: Bad\nbackend: claude\nmodel: sonnet", 'requires a non-empty "tools"'],
		["nested", "name: bad\ndescription: Bad\nbackend: claude\nmodel: sonnet\ntools: Read, Agent", 'must not include the nested "Agent" tool'],
	] as const) {
		test(`rejects invalid Claude ${name}`, () => {
			const parsed = parse(definition);
			expect(parsed.agent).toBeNull();
			expect(parsed.diagnostic).toEqual({
				name: "bad",
				filePath: "/agents/example.md",
				message: expect.stringContaining(message),
			});
		});
	}
});
```

- [ ] **Step 2: Run the RED tests**

Run: `bun test tests/subagent-agents.test.ts`

Expected: FAIL because `parseAgentDefinition` throws “Agent parsing not implemented”.

- [ ] **Step 3: Commit the local RED contract**

```bash
git add dot_pi/agent/exact_extensions/subagent/agents.ts tests/subagent-agents.test.ts
git commit -m "test(pi): define subagent backend schema"
```

Do not push or publish this commit without Step 6.

- [ ] **Step 4: Implement parsing and discovery diagnostics**

Implement `parseAgentDefinition` with `parseFrontmatter<Record<string, string>>()`. Trim `backend`, `model`, and comma-separated tools; default backend to `pi`; reject missing name/description, unknown backends, missing Claude fields, and case-sensitive `Agent`. Return diagnostics in exactly the forms asserted above.

Replace `loadAgentsFromDir`’s inline parsing with `parseAgentDefinition`. Return both arrays:

```ts
interface LoadedAgents {
	agents: AgentConfig[];
	diagnostics: AgentDiagnostic[];
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): LoadedAgents {
	const agents: AgentConfig[] = [];
	const diagnostics: AgentDiagnostic[] = [];
	// Preserve current missing-directory, unreadable-directory, and unreadable-file behavior.
	// For each readable Markdown file:
	const parsed = parseAgentDefinition(content, filePath, source);
	if (parsed.agent) agents.push(parsed.agent);
	else diagnostics.push(parsed.diagnostic);
	return { agents, diagnostics };
}
```

Change discovery output to:

```ts
export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	diagnostics: AgentDiagnostic[];
	projectAgentsDir: string | null;
}
```

Concatenate diagnostics from every selected scope. Preserve project replacement of same-named user agents in `both` scope.

- [ ] **Step 5: Run focused and regression tests**

Run: `bun test tests/subagent-agents.test.ts tests/subagent-invocation.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the GREEN implementation**

```bash
git add dot_pi/agent/exact_extensions/subagent/agents.ts
git commit -m "feat(pi): validate subagent backend definitions"
```

---

### Task 2: Backend-Neutral Contracts and Pi Adapter

**Files:**
- Create: `dot_pi/agent/exact_extensions/subagent/contracts.ts`
- Create: `dot_pi/agent/exact_extensions/subagent/process-runner.ts`
- Create: `dot_pi/agent/exact_extensions/subagent/pi-backend.ts`
- Modify: `dot_pi/agent/exact_extensions/subagent/invocation.ts:1-6`
- Modify: `tests/subagent-invocation.test.ts:1-25`
- Create: `tests/subagent-streams.test.ts`

**Interfaces:**
- Consumes: `AgentConfig` from Task 1.
- Produces: `AgentRunRequest`, `AgentRunResult`, `DisplayEvent`, `UsageStats`, `SubagentBackend`, `ProcessRunner`, `ProcessInvocation`, and `ProcessOutcome`.
- Produces: `buildPiArgs`, `PiStreamParser`, and `createPiBackend` for Task 5.

- [ ] **Step 1: Add exact contracts, adapter shells, and raw failing Pi tests**

Create `contracts.ts` with these public types:

```ts
import type { AgentConfig, AgentScope } from "./agents.ts";

export type DisplayEvent =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, unknown> };

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	contextTokens: number;
	turns: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export type AgentRunStatus = "running" | "completed" | "failed" | "aborted";

export interface AgentRunRequest {
	agent: AgentConfig;
	task: string;
	cwd: string;
	step?: number;
}

export interface AgentRunResult {
	backend: "pi" | "claude";
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	status: AgentRunStatus;
	output: string;
	events: DisplayEvent[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	exitCode?: number;
	diagnostic?: string;
	step?: number;
}

export interface SubagentBackend {
	run(
		request: AgentRunRequest,
		signal: AbortSignal | undefined,
		onUpdate?: (result: AgentRunResult) => void,
	): Promise<AgentRunResult>;
}

export interface ProcessInvocation { command: string; args: string[]; cwd: string; stdin?: string }
export interface ProcessOutcome { exitCode: number; stderr: string; aborted: boolean; spawnError?: string }
export interface ProcessRunner {
	run(
		invocation: ProcessInvocation,
		options: { signal?: AbortSignal; onStdoutLine(line: string): void },
	): Promise<ProcessOutcome>;
}

export interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: AgentRunResult[];
}
```

Also export `emptyUsage()` and `addUsage(left, right)` with full zero-valued cost fields.

Create `pi-backend.ts` shells exporting:

```ts
export function buildPiArgs(agent: AgentConfig, task: string): string[] {
	throw new Error("not implemented");
}

export class PiStreamParser {
	constructor(_request: AgentRunRequest) {}
	accept(_line: string): void { throw new Error("not implemented"); }
	finish(_outcome: ProcessOutcome): AgentRunResult { throw new Error("not implemented"); }
}

export function createPiBackend(_runner: ProcessRunner): SubagentBackend {
	throw new Error("not implemented");
}
```

Extend `tests/subagent-invocation.test.ts` to assert a Pi Claude-independent worker produces:

```ts
expect(buildPiArgs(piAgent, "inspect repository")).toEqual([
	"--mode", "json", "-p", "--no-session",
	"--model", "openai-codex/gpt-5.6-terra",
	"--tools", "read,bash",
	"--exclude-tools", "subagent",
	"--append-system-prompt", "Worker prompt.",
	"Task: inspect repository",
]);
```

Add Pi cases to `tests/subagent-streams.test.ts` using inline JSON lines for an assistant text message and tool call. Assert normalized events, summed usage/cost, model, output, completed status, error stop reason, nonzero exit, and missing assistant output.

- [ ] **Step 2: Run the Pi RED tests**

Run: `bun test tests/subagent-invocation.test.ts tests/subagent-streams.test.ts`

Expected: FAIL at `buildPiArgs`/`PiStreamParser` “not implemented”.

- [ ] **Step 3: Commit the local RED contracts**

```bash
git add dot_pi/agent/exact_extensions/subagent/contracts.ts \
  dot_pi/agent/exact_extensions/subagent/pi-backend.ts \
  tests/subagent-invocation.test.ts tests/subagent-streams.test.ts
git commit -m "test(pi): define normalized Pi backend contract"
```

- [ ] **Step 4: Implement the Node process boundary**

In `process-runner.ts`, export `createNodeProcessRunner(): ProcessRunner`. Use `spawn(command, args, { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] })`; write `invocation.stdin` and end stdin; split stdout into UTF-8 lines while preserving a final unterminated line; collect stderr; resolve spawn errors as `spawnError`; and return exit code `1` when no code exists.

On abort: end stdin, send `SIGTERM`, and schedule `SIGKILL` after 5,000 ms. On close: clear the timer and remove the abort listener. Set `aborted: true` only when the supplied signal caused termination.

- [ ] **Step 5: Implement Pi argument construction and normalization**

Move `getPiInvocation` behavior from `index.ts` into `pi-backend.ts`. `buildPiArgs` must preserve exact order from Step 1 and always append `--exclude-tools subagent`. Pass the agent body directly to Pi’s documented text-or-file `--append-system-prompt` option.

`PiStreamParser` must:

- ignore blank lines but retain malformed non-empty lines as a failure diagnostic;
- consume `message_end` assistant messages;
- append text/tool-call content in source order;
- sum each assistant usage and keep the latest `totalTokens` as `contextTokens`;
- keep the last assistant text as canonical output;
- record `stopReason` error/aborted and `errorMessage`;
- use process stderr/spawn errors when no model diagnostic exists;
- fail a zero-exit run with no assistant output.

`createPiBackend(runner)` builds the invocation, sends each accepted line to the parser, emits running snapshots after valid events, and calls `finish(outcome)` once. Do not expose native Pi `Message` objects.

- [ ] **Step 6: Run Pi adapter tests**

Run: `bun test tests/subagent-invocation.test.ts tests/subagent-streams.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the GREEN Pi adapter**

```bash
git add dot_pi/agent/exact_extensions/subagent/contracts.ts \
  dot_pi/agent/exact_extensions/subagent/process-runner.ts \
  dot_pi/agent/exact_extensions/subagent/pi-backend.ts \
  dot_pi/agent/exact_extensions/subagent/invocation.ts
git commit -m "refactor(pi): isolate normalized Pi subagent backend"
```

---

### Task 3: Claude Code Adapter

**Files:**
- Create: `dot_pi/agent/exact_extensions/subagent/claude-backend.ts`
- Modify: `tests/subagent-invocation.test.ts`
- Modify: `tests/subagent-streams.test.ts`

**Interfaces:**
- Consumes: Task 2’s `ProcessRunner`, `SubagentBackend`, `AgentRunResult`, and usage helpers.
- Produces: `buildClaudeInvocation`, `ClaudeStreamParser`, and `createClaudeBackend` for Task 5.

- [ ] **Step 1: Add Claude shells and raw failing invocation/parser tests**

Create export shells matching the Pi adapter:

```ts
export function buildClaudeInvocation(request: AgentRunRequest): ProcessInvocation {
	throw new Error("not implemented");
}
export class ClaudeStreamParser {
	constructor(_request: AgentRunRequest) {}
	accept(_line: string): void { throw new Error("not implemented"); }
	finish(_outcome: ProcessOutcome): AgentRunResult { throw new Error("not implemented"); }
}
export function createClaudeBackend(_runner: ProcessRunner): SubagentBackend {
	throw new Error("not implemented");
}
```

Add an invocation test for `claude-worker` that asserts exactly:

```ts
expect(buildClaudeInvocation(request)).toEqual({
	command: "claude",
	cwd: "/repo",
	stdin: "Task: implement feature",
	args: [
		"-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence",
		"--model", "sonnet",
		"--tools", "Read,Write,Edit,Glob,Grep,Bash,WebSearch,WebFetch",
		"--allowedTools", "Read,Write,Edit,Glob,Grep,Bash,WebSearch,WebFetch",
		"--disallowedTools", "Agent",
		"--permission-mode", "dontAsk",
		"--append-system-prompt", "Worker prompt.",
	],
});
expect(buildClaudeInvocation(request).args.join(" ")).not.toContain("bypassPermissions");
expect(buildClaudeInvocation(request).args).not.toContain("--setting-sources");
```

Add static Claude stream lines for:

```json
{"type":"system","subtype":"init","model":"claude-sonnet-4-6"}
{"type":"assistant","message":{"model":"claude-sonnet-4-6","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/repo/a.ts"}},{"type":"text","text":"Working"}],"usage":{"input_tokens":10,"output_tokens":4,"cache_read_input_tokens":3,"cache_creation_input_tokens":2}}}
{"type":"result","subtype":"success","is_error":false,"num_turns":2,"result":"Done","total_cost_usd":0.012,"usage":{"input_tokens":20,"output_tokens":8,"cache_read_input_tokens":5,"cache_creation_input_tokens":3},"permission_denials":[]}
```

Assert model, tool call, text, final output, turns, authoritative result usage, total cost, and completed status. Add separate tests for `subtype: "error_during_execution"`, non-empty `permission_denials`, malformed JSON, missing result, nonzero exit, and aborted outcome.

- [ ] **Step 2: Run the Claude RED tests**

Run: `bun test tests/subagent-invocation.test.ts tests/subagent-streams.test.ts`

Expected: FAIL at Claude “not implemented” shells while Pi cases remain PASS.

- [ ] **Step 3: Commit the local RED Claude contract**

```bash
git add dot_pi/agent/exact_extensions/subagent/claude-backend.ts \
  tests/subagent-invocation.test.ts tests/subagent-streams.test.ts
git commit -m "test(pi): define Claude subagent backend contract"
```

- [ ] **Step 4: Implement Claude invocation and parsing**

Build the exact invocation asserted in Step 1. Do not include `Agent` in either exposed or allowed tools. Reject a non-Claude request passed to this builder with `Error("Claude backend requires a Claude agent definition")`.

`ClaudeStreamParser` must:

- ignore blank lines;
- remember malformed non-empty lines as a failure diagnostic;
- read `system/init.model` and assistant `message.model`;
- normalize assistant `text` and `tool_use` blocks in content order;
- treat the final `result.result` as canonical output;
- use final result usage as authoritative, mapping `cache_creation_input_tokens` to cache write and `cache_read_input_tokens` to cache read;
- map `num_turns` and `total_cost_usd` without estimating missing fields;
- join permission denial messages into the failure diagnostic;
- require one valid final `result` event even when exit code is zero;
- distinguish signal/backend abort from failure.

Implement `createClaudeBackend(runner)` with the same process-port/update flow as the Pi adapter.

- [ ] **Step 5: Run Claude and Pi adapter tests**

Run: `bun test tests/subagent-invocation.test.ts tests/subagent-streams.test.ts`

Expected: PASS for both backends.

- [ ] **Step 6: Commit the GREEN Claude adapter**

```bash
git add dot_pi/agent/exact_extensions/subagent/claude-backend.ts
git commit -m "feat(pi): add Claude subagent backend adapter"
```

---

### Task 4: Backend-Neutral Orchestration

**Files:**
- Create: `dot_pi/agent/exact_extensions/subagent/orchestrator.ts`
- Create: `tests/subagent-orchestrator.test.ts`

**Interfaces:**
- Consumes: Task 2 contracts and a `ReadonlyMap<"pi" | "claude", SubagentBackend>`.
- Produces: `executeSubagentMode(input)` and `truncateTaskOutput(output)` for the extension composition root.

- [ ] **Step 1: Add orchestration shell and raw failing fake-backed tests**

Create this input/output contract:

```ts
export interface ExecuteSubagentModeInput {
	params: {
		agent?: string;
		task?: string;
		cwd?: string;
		tasks?: Array<{ agent: string; task: string; cwd?: string }>;
		chain?: Array<{ agent: string; task: string; cwd?: string }>;
	};
	agents: AgentConfig[];
	backends: ReadonlyMap<"pi" | "claude", SubagentBackend>;
	defaultCwd: string;
	signal?: AbortSignal;
	onUpdate?: (mode: "single" | "parallel" | "chain", results: AgentRunResult[]) => void;
}

export interface SubagentExecution {
	mode: "single" | "parallel" | "chain";
	results: AgentRunResult[];
	content: string;
	usage: UsageStats;
}

export async function executeSubagentMode(_input: ExecuteSubagentModeInput): Promise<SubagentExecution> {
	throw new Error("not implemented");
}
```

Create practical fake backends that record requests and return configured results. Tests must assert:

1. one Claude agent routes only to the Claude fake;
2. mixed GPT/Claude parallel results retain input order when manually controlled fake promises resolve in reverse order;
3. parallel limits eight tasks and starts no more than four fake runs simultaneously, using manually released gates rather than timers;
4. a Claude-to-GPT chain substitutes every `{previous}` occurrence;
5. a failed chain step prevents later fake calls;
6. one parallel failure preserves sibling success;
7. the same abort signal reaches all fake runs;
8. 50 KiB ASCII and multibyte output truncates without splitting UTF-8;
9. aggregate usage and costs sum once per final result;
10. unknown agent and missing backend adapter return explicit failed results rather than fallback.

- [ ] **Step 2: Run the orchestration RED tests**

Run: `bun test tests/subagent-orchestrator.test.ts`

Expected: FAIL at `executeSubagentMode` “not implemented”.

- [ ] **Step 3: Commit the local RED orchestration contract**

```bash
git add dot_pi/agent/exact_extensions/subagent/orchestrator.ts tests/subagent-orchestrator.test.ts
git commit -m "test(pi): define mixed-backend subagent orchestration"
```

- [ ] **Step 4: Implement mode validation, routing, and bounded output**

Move `mapWithConcurrencyLimit` out of `index.ts` and preserve constants:

```ts
export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
export const PER_TASK_OUTPUT_CAP = 50 * 1024;
```

Mode validation requires exactly one non-empty single, parallel, or chain mode. Resolve by agent name, then by `agent.backend`; never choose another backend when lookup fails.

Implement UTF-8-safe truncation with a `Buffer` boundary, not JavaScript code-unit slicing:

```ts
export function truncateTaskOutput(output: string): string {
	const bytes = Buffer.from(output, "utf8");
	if (bytes.length <= PER_TASK_OUTPUT_CAP) return output;
	let end = PER_TASK_OUTPUT_CAP;
	while (end > 0 && (bytes[end] & 0b1100_0000) === 0b1000_0000) end--;
	const kept = bytes.subarray(0, end).toString("utf8");
	return `${kept}\n\n[Output truncated: ${bytes.length - end} bytes omitted. Full output preserved in tool details.]`;
}
```

Use truncated output only in parent-model `content`; retain complete result events/output in `results`. Parallel summaries include every agent and status. Chain content is the final successful output or the failed-step diagnostic. Aggregate only final result usage.

- [ ] **Step 5: Run orchestration and backend tests**

Run: `bun test tests/subagent-orchestrator.test.ts tests/subagent-streams.test.ts tests/subagent-invocation.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the GREEN orchestrator**

```bash
git add dot_pi/agent/exact_extensions/subagent/orchestrator.ts
git commit -m "feat(pi): orchestrate mixed subagent backends"
```

---

### Task 5: Extension Wiring, Rendering, Managed Agents, and QA

**Files:**
- Modify: `dot_pi/agent/exact_extensions/subagent/index.ts:1-1016`
- Rename: `dot_pi/agent/agents/{scout,planner,reviewer,worker}.md` to `dot_pi/agent/agents/gpt-{scout,planner,reviewer,worker}.md`
- Create: `dot_pi/agent/agents/claude-{scout,planner,reviewer,worker}.md`
- Modify: `.chezmoiremove`
- Modify: `dot_pi/agent/prompts/implement.md`
- Modify: `dot_pi/agent/prompts/scout-and-plan.md`
- Modify: `dot_pi/agent/prompts/implement-and-review.md`
- Create: `docs/qa/pi-subagent-backends.md`

**Interfaces:**
- Consumes: all Tasks 1-4 contracts and adapters.
- Produces: the deployed `subagent` tool with unchanged input schema and full backend parity.
- Produces: eight explicit managed agent names and three GPT-backed existing workflows.

This task is composition-root, TUI, prompt, and configuration work. Per project policy it does not add UI/system tests; behavior is covered below the effect boundary by Tasks 1-4.

- [ ] **Step 1: Reduce `index.ts` to composition, trust confirmation, and rendering**

Remove Pi-specific imports and all execution functions/types currently between constants and TypeBox schemas. Import:

```ts
import { createClaudeBackend } from "./claude-backend.ts";
import type { AgentRunResult, SubagentDetails, UsageStats } from "./contracts.ts";
import { createPiBackend } from "./pi-backend.ts";
import { createNodeProcessRunner } from "./process-runner.ts";
import { executeSubagentMode } from "./orchestrator.ts";
```

At extension construction, wire one shared runner and immutable registry:

```ts
const runner = createNodeProcessRunner();
const backends = new Map([
	["pi", createPiBackend(runner)],
	["claude", createClaudeBackend(runner)],
] as const);
```

Preserve the TypeBox `subagent` parameter schema exactly. In `execute`:

1. discover agents and diagnostics;
2. retain the existing project-agent confirmation before process execution;
3. call `executeSubagentMode({ params, agents, backends, defaultCwd: ctx.cwd, signal, onUpdate })`;
4. wrap update/final results in `SubagentDetails` with scope and project directory;
5. include matching discovery diagnostics when an unknown requested name was invalid;
6. return `content`, `details`, and converted nested `usage`.

Convert aggregate `UsageStats` to Pi `Usage` with `totalTokens = input + output + cacheRead + cacheWrite`; retain category costs and total cost. Do not include usage on partial updates.

- [ ] **Step 2: Adapt rendering to normalized results**

Replace all renderer dependencies as follows:

```text
SingleResult                         -> AgentRunResult
r.messages                           -> r.events
getDisplayItems(r.messages)          -> r.events
getFinalOutput(r.messages)           -> r.output
isFailedResult(r)                    -> r.status === "failed" || r.status === "aborted"
r.exitCode === -1                    -> r.status === "running"
r.exitCode === 0                     -> r.status === "completed"
```

Show `backend` next to source in headers, for example `claude-worker (user, claude)`. Make `formatToolCall` case-insensitive with `switch (toolName.toLowerCase())`; support Claude `file_path`, `pattern`, and `path` inputs. Preserve collapsed/expanded behavior and avoid UI tests.

Run:

```bash
rg -n 'SingleResult|\.messages|getFinalOutput|getDisplayItems|exitCode === -1' \
  dot_pi/agent/exact_extensions/subagent/index.ts
```

Expected: no stale Pi-specific result references.

- [ ] **Step 3: Rename GPT agents and add Claude agents**

Use `git mv` for all four existing files. Change each frontmatter `name` to its `gpt-*` filename; retain current OpenAI model and Pi-native tools/body.

Create Claude files by copying corresponding role bodies and using exactly:

```yaml
# claude-scout.md
name: claude-scout
description: Fast Claude codebase recon that returns compressed context for handoff
backend: claude
model: haiku
tools: Read, Grep, Glob, Bash, WebSearch, WebFetch

# claude-planner.md
name: claude-planner
description: Claude implementation planner from context and requirements
backend: claude
model: sonnet
tools: Read, Grep, Glob, WebSearch, WebFetch

# claude-reviewer.md
name: claude-reviewer
description: Claude code review specialist for quality and security analysis
backend: claude
model: sonnet
tools: Read, Grep, Glob, Bash, WebSearch, WebFetch

# claude-worker.md
name: claude-worker
description: General-purpose Claude worker with isolated context
backend: claude
model: sonnet
tools: Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch
```

Wrap each block in `---` frontmatter and append the complete corresponding existing role body. Do not create unprefixed aliases.

Because `dot_pi/agent/agents` is not an exact chezmoi directory, append these targets to `.chezmoiremove` so renamed source files do not leave deployed aliases behind:

```text
.pi/agent/agents/scout.md
.pi/agent/agents/planner.md
.pi/agent/agents/reviewer.md
.pi/agent/agents/worker.md
```

- [ ] **Step 4: Route existing templates to GPT names**

Replace quoted agent references only:

```text
"scout"    -> "gpt-scout"
"planner"  -> "gpt-planner"
"reviewer" -> "gpt-reviewer"
"worker"   -> "gpt-worker"
```

Do not add or rename prompt templates.

- [ ] **Step 5: Add the manual QA procedure**

Create `docs/qa/pi-subagent-backends.md` with prerequisites (`chezmoi apply`, authenticated `pi` and `claude`, trusted disposable repository) and manual commands/prompts for:

1. `gpt-scout` read-only success;
2. `claude-scout` using `Read` or `WebSearch`;
3. mixed parallel `gpt-scout` plus `claude-scout`;
4. `claude-scout` → `gpt-planner` chain with `{previous}`;
5. Ctrl+C cancellation of a long Claude task;
6. a temporary invalid/denied Claude tool definition producing no fallback;
7. expanded rendering and nested session usage inspection.

State prominently: “Manual QA only. Do not add this procedure to hooks or CI.” Require restoring temporary files and rerunning `chezmoi apply` afterward.

- [ ] **Step 6: Run automated verification**

Run:

```bash
bun test tests/subagent-agents.test.ts \
  tests/subagent-invocation.test.ts \
  tests/subagent-streams.test.ts \
  tests/subagent-orchestrator.test.ts
bun test
git diff --check
```

Expected: all tests PASS and diff check emits nothing.

- [ ] **Step 7: Inspect and deploy chezmoi source state**

Run:

```bash
chezmoi diff ~/.pi/agent/extensions/subagent ~/.pi/agent/agents ~/.pi/agent/prompts
chezmoi apply ~/.pi/agent/extensions/subagent ~/.pi/agent/agents ~/.pi/agent/prompts
```

Expected: old unprefixed managed agents are removed by the exact managed directory, eight prefixed agents deploy, three prompt templates reference `gpt-*`, and all extension modules deploy.

- [ ] **Step 8: Perform manual QA**

Follow `docs/qa/pi-subagent-backends.md`. Record any production CLI schema difference as a failing static fixture/unit test before changing implementation. Do not automate real model calls.

- [ ] **Step 9: Commit extension wiring and managed configuration**

```bash
git add dot_pi/agent/exact_extensions/subagent/index.ts .chezmoiremove \
  dot_pi/agent/agents dot_pi/agent/prompts docs/qa/pi-subagent-backends.md
git commit -m "feat(pi): expose GPT and Claude subagent families"
```

- [ ] **Step 10: Verify the green branch tip**

Run:

```bash
git status --short
bun test
chezmoi status
```

Expected: git working tree is clean, all automated tests pass, and chezmoi reports no unapplied changes for the edited Pi paths.
