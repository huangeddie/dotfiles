import { expect, test } from "bun:test";

import type { AgentDiagnostic, ClaudeAgentConfig, PiAgentConfig } from "../dot_pi/agent/exact_extensions/subagent/agents.ts";
import type {
	AgentRunRequest,
	AgentRunResult,
	SubagentBackend,
	UsageStats,
} from "../dot_pi/agent/exact_extensions/subagent/contracts.ts";
import {
	executeSubagentMode,
	PER_TASK_OUTPUT_CAP,
	truncateTaskOutput,
} from "../dot_pi/agent/exact_extensions/subagent/orchestrator.ts";

const piAgent: PiAgentConfig = {
	name: "gpt-worker",
	description: "GPT worker",
	backend: "pi",
	systemPrompt: "Work carefully.",
	source: "user",
	filePath: "/agents/gpt-worker.md",
};

const claudeAgent: ClaudeAgentConfig = {
	name: "claude-worker",
	description: "Claude worker",
	backend: "claude",
	model: "sonnet",
	tools: ["Read"],
	systemPrompt: "Work carefully.",
	source: "project",
	filePath: "/agents/claude-worker.md",
};

const agents = [piAgent, claudeAgent];

function discoveryDiagnostic(name: string, message: string): AgentDiagnostic {
	return { name, filePath: `/agents/${name}.md`, message };
}

function usage(overrides: Partial<UsageStats> = {}): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		contextTokens: 0,
		turns: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		...overrides,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, ...overrides.cost },
	};
}

function completed(request: AgentRunRequest, output = "done", resultUsage = usage()): AgentRunResult {
	return {
		backend: request.agent.backend,
		agent: request.agent.name,
		agentSource: request.agent.source,
		task: request.task,
		status: "completed",
		output,
		events: [{ type: "text", text: output }],
		stderr: "",
		usage: resultUsage,
	};
}

function failed(request: AgentRunRequest, diagnostic: string): AgentRunResult {
	return {
		...completed(request, ""),
		status: "failed",
		diagnostic,
	};
}

class Deferred<T> {
	readonly promise: Promise<T>;
	resolve!: (value: T) => void;

	constructor() {
		this.promise = new Promise<T>((resolve) => {
			this.resolve = resolve;
		});
	}
}

type RunHandler = (
	request: AgentRunRequest,
	signal: AbortSignal | undefined,
	onUpdate: ((result: AgentRunResult) => void) | undefined,
) => Promise<AgentRunResult>;

class FakeBackend implements SubagentBackend {
	readonly requests: AgentRunRequest[] = [];
	readonly signals: Array<AbortSignal | undefined> = [];
	active = 0;
	maximumActive = 0;
	private readonly startedWaiters: Array<{ count: number; resolve: () => void }> = [];

	constructor(private readonly handler: RunHandler) {}

	run(
		request: AgentRunRequest,
		signal: AbortSignal | undefined,
		onUpdate?: (result: AgentRunResult) => void,
	): Promise<AgentRunResult> {
		this.requests.push(request);
		this.signals.push(signal);
		this.active++;
		this.maximumActive = Math.max(this.maximumActive, this.active);
		this.releaseStartedWaiters();
		return this.handler(request, signal, onUpdate).finally(() => {
			this.active--;
		});
	}

	untilStarted(count: number): Promise<void> {
		if (this.requests.length >= count) return Promise.resolve();
		return new Promise((resolve) => this.startedWaiters.push({ count, resolve }));
	}

	private releaseStartedWaiters(): void {
		for (let index = this.startedWaiters.length - 1; index >= 0; index--) {
			if (this.requests.length >= this.startedWaiters[index].count) {
				this.startedWaiters[index].resolve();
				this.startedWaiters.splice(index, 1);
			}
		}
	}
}

function input(
	params: Parameters<typeof executeSubagentMode>[0]["params"],
	backends: ReadonlyMap<"pi" | "claude", SubagentBackend>,
	overrides: Partial<Parameters<typeof executeSubagentMode>[0]> = {},
) {
	return { params, agents, backends, defaultCwd: "/repo", ...overrides };
}

test("routes a Claude agent only to the Claude backend", async () => {
	const pi = new FakeBackend(async (request) => completed(request));
	const claude = new FakeBackend(async (request) => completed(request, "Claude output"));

	const execution = await executeSubagentMode(
		input({ agent: "claude-worker", task: "inspect" }, new Map([["pi", pi], ["claude", claude]])),
	);

	expect(claude.requests).toHaveLength(1);
	expect(pi.requests).toHaveLength(0);
	expect(execution.results[0].backend).toBe("claude");
	expect(execution.content).toBe("Claude output");
});

test("retains mixed-backend parallel input order when runs resolve in reverse order", async () => {
	const gates = [new Deferred<AgentRunResult>(), new Deferred<AgentRunResult>()];
	let gateIndex = 0;
	const pi = new FakeBackend(async () => gates[gateIndex++].promise);
	const claude = new FakeBackend(async () => gates[gateIndex++].promise);
	const executionPromise = executeSubagentMode(
		input(
			{
				tasks: [
					{ agent: "gpt-worker", task: "first" },
					{ agent: "claude-worker", task: "second" },
				],
			},
			new Map([["pi", pi], ["claude", claude]]),
		),
	);

	expect([...pi.requests, ...claude.requests]).toHaveLength(2);
	gates[1].resolve(completed(claude.requests[0], "second output"));
	gates[0].resolve(completed(pi.requests[0], "first output"));

	const execution = await executionPromise;
	expect(execution.results.map((result) => result.task)).toEqual(["first", "second"]);
	expect(execution.content).toContain("[gpt-worker] completed");
	expect(execution.content).toContain("[claude-worker] completed");
});

test("rejects more than eight parallel tasks before starting a backend", async () => {
	const pi = new FakeBackend(async (request) => completed(request));

	const execution = await executeSubagentMode(
		input(
			{ tasks: Array.from({ length: 9 }, (_, index) => ({ agent: "gpt-worker", task: `task ${index}` })) },
			new Map([["pi", pi]]),
		),
	);

	expect(pi.requests).toHaveLength(0);
	expect(execution.results).toEqual([]);
	expect(execution.content).toBe("Too many parallel tasks (9). Max is 8.");
});

test("starts no more than four parallel fake runs at once", async () => {
	const gates = Array.from({ length: 8 }, () => new Deferred<AgentRunResult>());
	let gateIndex = 0;
	const pi = new FakeBackend(async () => gates[gateIndex++].promise);
	const executionPromise = executeSubagentMode(
		input(
			{ tasks: Array.from({ length: 8 }, (_, index) => ({ agent: "gpt-worker", task: `task ${index}` })) },
			new Map([["pi", pi]]),
		),
	);

	expect(pi.requests).toHaveLength(4);
	expect(pi.maximumActive).toBe(4);
	gates[0].resolve(completed(pi.requests[0]));
	await pi.untilStarted(5);
	for (let index = 1; index < 4; index++) gates[index].resolve(completed(pi.requests[index]));
	await pi.untilStarted(8);
	for (let index = 4; index < 8; index++) gates[index].resolve(completed(pi.requests[index]));

	await executionPromise;
	expect(pi.maximumActive).toBe(4);
});

test("substitutes every previous-output placeholder across a Claude-to-GPT chain", async () => {
	const claude = new FakeBackend(async (request) => completed(request, "prior context"));
	const pi = new FakeBackend(async (request) => completed(request, "final answer"));

	const execution = await executeSubagentMode(
		input(
			{
				chain: [
					{ agent: "claude-worker", task: "research" },
					{ agent: "gpt-worker", task: "use {previous}; compare {previous}" },
				],
			},
			new Map([["pi", pi], ["claude", claude]]),
		),
	);

	expect(pi.requests[0].task).toBe("use prior context; compare prior context");
	expect(execution.content).toBe("final answer");
	expect(execution.results.map((result) => result.backend)).toEqual(["claude", "pi"]);
});

test("stops a chain after a failed step", async () => {
	const claude = new FakeBackend(async (request) => failed(request, "Claude denied the task"));
	const pi = new FakeBackend(async (request) => completed(request));

	const execution = await executeSubagentMode(
		input(
			{
				chain: [
					{ agent: "claude-worker", task: "first" },
					{ agent: "gpt-worker", task: "must not run" },
				],
			},
			new Map([["pi", pi], ["claude", claude]]),
		),
	);

	expect(pi.requests).toHaveLength(0);
	expect(execution.results).toHaveLength(1);
	expect(execution.content).toBe("Chain stopped at step 1 (claude-worker): Claude denied the task");
});

test("preserves successful parallel siblings when one run fails", async () => {
	const pi = new FakeBackend(async (request) => completed(request, "successful output"));
	const claude = new FakeBackend(async (request) => failed(request, "failed output"));

	const execution = await executeSubagentMode(
		input(
			{ tasks: [{ agent: "gpt-worker", task: "success" }, { agent: "claude-worker", task: "failure" }] },
			new Map([["pi", pi], ["claude", claude]]),
		),
	);

	expect(execution.results.map((result) => result.status)).toEqual(["completed", "failed"]);
	expect(execution.content).toContain("Parallel: 1/2 succeeded");
	expect(execution.content).toContain("[gpt-worker] completed");
	expect(execution.content).toContain("[claude-worker] failed");
});

test("forwards the identical aborted signal to every started backend run", async () => {
	const gates = [new Deferred<AgentRunResult>(), new Deferred<AgentRunResult>()];
	let gateIndex = 0;
	const pi = new FakeBackend(async () => gates[gateIndex++].promise);
	const claude = new FakeBackend(async () => gates[gateIndex++].promise);
	const controller = new AbortController();
	const executionPromise = executeSubagentMode(
		input(
			{ tasks: [{ agent: "gpt-worker", task: "one" }, { agent: "claude-worker", task: "two" }] },
			new Map([["pi", pi], ["claude", claude]]),
			{ signal: controller.signal },
		),
	);

	controller.abort();
	expect(pi.signals).toEqual([controller.signal]);
	expect(claude.signals).toEqual([controller.signal]);
	expect(pi.signals[0]?.aborted).toBeTrue();
	expect(claude.signals[0]?.aborted).toBeTrue();
	gates[0].resolve(completed(pi.requests[0]));
	gates[1].resolve(completed(claude.requests[0]));
	await executionPromise;
});

test("truncates ASCII and multibyte task output at a UTF-8 boundary within the content cap", () => {
	const ascii = `${"a".repeat(PER_TASK_OUTPUT_CAP)}x`;
	const asciiTruncated = truncateTaskOutput(ascii);
	expect(Buffer.byteLength(asciiTruncated, "utf8")).toBeLessThanOrEqual(PER_TASK_OUTPUT_CAP);
	expect(asciiTruncated).toContain("[Output truncated:");

	const multibyte = `${"a".repeat(PER_TASK_OUTPUT_CAP - 1)}€`;
	const multibyteTruncated = truncateTaskOutput(multibyte);
	expect(Buffer.byteLength(multibyteTruncated, "utf8")).toBeLessThanOrEqual(PER_TASK_OUTPUT_CAP);
	expect(multibyteTruncated).toContain("[Output truncated:");
	expect(multibyteTruncated).not.toContain("�");
});

test("aggregates final result usage and costs exactly once", async () => {
	const pi = new FakeBackend(async (request) =>
		completed(request, "one", usage({ input: 2, output: 3, contextTokens: 7, turns: 1, cost: { total: 0.2 } })),
	);
	const claude = new FakeBackend(async (request) =>
		completed(request, "two", usage({ input: 5, cacheRead: 11, cacheWrite: 13, contextTokens: 17, turns: 2, cost: { input: 0.5, total: 0.8 } })),
	);

	const execution = await executeSubagentMode(
		input(
			{ tasks: [{ agent: "gpt-worker", task: "one" }, { agent: "claude-worker", task: "two" }] },
			new Map([["pi", pi], ["claude", claude]]),
		),
	);

	expect(execution.usage).toEqual({
		input: 7,
		output: 3,
		cacheRead: 11,
		cacheWrite: 13,
		contextTokens: 24,
		turns: 3,
		cost: { input: 0.5, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 },
	});
});

test("returns explicit failed results for unknown agents and missing backend adapters without fallback", async () => {
	const pi = new FakeBackend(async (request) => completed(request));

	const unknown = await executeSubagentMode(
		input({ agent: "not-configured", task: "work" }, new Map([["pi", pi]])),
	);
	const missingBackend = await executeSubagentMode(
		input({ agent: "claude-worker", task: "work" }, new Map([["pi", pi]])),
	);

	expect(unknown.results[0]).toMatchObject({ status: "failed", agent: "not-configured", diagnostic: 'Unknown agent: "not-configured".' });
	expect(missingBackend.results[0]).toMatchObject({
		status: "failed",
		backend: "claude",
		diagnostic: 'No backend adapter is configured for "claude".',
	});
	expect(pi.requests).toHaveLength(0);
});

test("attaches matching discovery diagnostics to an unknown-agent failure before formatting content", async () => {
	const pi = new FakeBackend(async (request) => completed(request));
	const definitionDiagnostic = 'Agent "missing-worker" with backend "claude" must not include the nested "Agent" tool';

	const execution = await executeSubagentMode(
		input(
			{ agent: "missing-worker", task: "work" },
			new Map([["pi", pi]]),
			{ discoveryDiagnostics: [discoveryDiagnostic("missing-worker", definitionDiagnostic)] },
		),
	);

	expect(execution.results[0].diagnostic).toBe(`Unknown agent: "missing-worker".\n${definitionDiagnostic}`);
	expect(execution.content).toBe(`Unknown agent: "missing-worker".\n${definitionDiagnostic}`);
	expect(pi.requests).toHaveLength(0);
});

test("does not enrich a successful sibling that quotes an unknown-agent diagnostic", async () => {
	const unknownAgentDiagnostic = 'Unknown agent: "missing-worker".';
	const definitionDiagnostic = 'Agent "missing-worker" with backend "claude" must not include the nested "Agent" tool';
	const pi = new FakeBackend(async (request) => completed(request, `Quoted protocol text: ${unknownAgentDiagnostic}`));

	const execution = await executeSubagentMode(
		input(
			{
				tasks: [
					{ agent: "gpt-worker", task: "quote" },
					{ agent: "missing-worker", task: "work" },
				],
			},
			new Map([["pi", pi]]),
			{ discoveryDiagnostics: [discoveryDiagnostic("missing-worker", definitionDiagnostic)] },
		),
	);

	expect(execution.results[0].output).toBe(`Quoted protocol text: ${unknownAgentDiagnostic}`);
	expect(execution.content).toContain(`### [gpt-worker] completed\n\nQuoted protocol text: ${unknownAgentDiagnostic}`);
	expect(execution.content).not.toContain(`Quoted protocol text: ${unknownAgentDiagnostic}\n${definitionDiagnostic}`);
	expect(execution.results[1].diagnostic).toBe(`${unknownAgentDiagnostic}\n${definitionDiagnostic}`);
});

test("caps enriched unknown-agent content while retaining the full discovery diagnostic in results", async () => {
	const diagnostic = `Agent "missing-worker" is invalid: ${"x".repeat(PER_TASK_OUTPUT_CAP)}`;
	const execution = await executeSubagentMode(
		input(
			{ agent: "missing-worker", task: "work" },
			new Map(),
			{ discoveryDiagnostics: [discoveryDiagnostic("missing-worker", diagnostic)] },
		),
	);
	const fullDiagnostic = `Unknown agent: "missing-worker".\n${diagnostic}`;

	expect(Buffer.byteLength(execution.content, "utf8")).toBeLessThanOrEqual(PER_TASK_OUTPUT_CAP);
	expect(execution.results[0].diagnostic).toBe(fullDiagnostic);
	expect(Buffer.byteLength(execution.results[0].diagnostic!, "utf8")).toBeGreaterThan(PER_TASK_OUTPUT_CAP);
});

test("rejects ambiguous and incomplete modes without starting a backend", async () => {
	const pi = new FakeBackend(async (request) => completed(request));

	const ambiguous = await executeSubagentMode(
		input(
			{ agent: "gpt-worker", task: "single", tasks: [{ agent: "gpt-worker", task: "parallel" }] },
			new Map([["pi", pi]]),
		),
	);
	const incomplete = await executeSubagentMode(input({ agent: "gpt-worker" }, new Map([["pi", pi]])));

	expect(ambiguous.content).toBe("Invalid parameters. Provide exactly one non-empty mode.");
	expect(incomplete.content).toBe("Invalid parameters. Provide exactly one non-empty mode.");
	expect(pi.requests).toHaveLength(0);
});
