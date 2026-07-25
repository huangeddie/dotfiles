import { expect, test } from "bun:test";

import type { AgentConfig, ClaudeAgentConfig, PiAgentConfig } from "../dot_pi/agent/exact_extensions/subagent/agents.ts";
import type { AgentRunRequest, AgentRunResult, SubagentBackend } from "../dot_pi/agent/exact_extensions/subagent/contracts.ts";
import type { ExecuteSubagentModeInput } from "../dot_pi/agent/exact_extensions/subagent/orchestrator.ts";
import type { ResolvedProfile } from "../dot_pi/agent/exact_extensions/subagent/profiles.ts";
import {
	applyRuntimeProfile,
	executeWithRuntimeProfile,
	formatRuntimeProfileError,
	type RuntimeProfileLoader,
} from "../dot_pi/agent/exact_extensions/subagent/runtime-profiles.ts";

const claudeProfile = {
	name: "claude",
	roles: {
		scout: {
			alias: "claude-haiku-5",
			backend: "claude",
			model: "haiku",
			tools: ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"],
		},
		planner: {
			alias: "claude-sonnet-5",
			backend: "claude",
			model: "sonnet",
			tools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch"],
		},
		reviewer: {
			alias: "claude-sonnet-5",
			backend: "claude",
			model: "sonnet",
			tools: ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"],
		},
		worker: {
			alias: "claude-sonnet-5",
			backend: "claude",
			model: "sonnet",
			tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"],
		},
	},
} satisfies ResolvedProfile;

const gptProfile = {
	name: "gpt",
	roles: {
		worker: {
			alias: "gpt-5.6-terra",
			backend: "pi",
			model: "openai-codex/gpt-5.6-terra",
			tools: null,
		},
	},
} satisfies ResolvedProfile;

type AgentOverrides = {
	backend: "pi" | "claude";
	model?: string;
	tools?: string[];
};

function userAgent(name: string, overrides: AgentOverrides): AgentConfig {
	const base = {
		name,
		description: `${name} agent`,
		systemPrompt: `${name} prompt`,
		source: "user" as const,
		filePath: `/agents/${name}.md`,
	};
	if (overrides.backend === "claude") {
		return {
			...base,
			backend: "claude",
			model: overrides.model ?? "sonnet",
			tools: overrides.tools ?? ["Read"],
		};
	}
	return {
		...base,
		backend: "pi",
		...(overrides.model === undefined ? {} : { model: overrides.model }),
		...(overrides.tools === undefined ? {} : { tools: overrides.tools }),
	};
}

function projectAgent(name: string, overrides: AgentOverrides): AgentConfig {
	const agent = userAgent(name, overrides);
	return { ...agent, source: "project" } as AgentConfig;
}

function completed(request: AgentRunRequest): AgentRunResult {
	return {
		backend: request.agent.backend,
		agent: request.agent.name,
		agentSource: request.agent.source,
		task: request.task,
		status: "completed",
		output: request.task,
		events: [],
		stderr: "",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			contextTokens: 0,
			turns: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

class FakeBackend implements SubagentBackend {
	readonly requests: AgentRunRequest[] = [];

	constructor(private readonly onRun: (request: AgentRunRequest) => void = () => {}) {}

	async run(request: AgentRunRequest): Promise<AgentRunResult> {
		this.requests.push(request);
		this.onRun(request);
		return completed(request);
	}
}

class StatefulProfileLoader implements RuntimeProfileLoader {
	loads = 0;

	constructor(public next: ResolvedProfile) {}

	async load(): Promise<ResolvedProfile> {
		this.loads++;
		return this.next;
	}
}

function executionInput(
	params: ExecuteSubagentModeInput["params"],
	agents: AgentConfig[],
	backends: ReadonlyMap<"pi" | "claude", SubagentBackend>,
): ExecuteSubagentModeInput {
	return { params, agents, backends, defaultCwd: "/repo" };
}

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

test("loads one profile snapshot for every parallel request", async () => {
	const loader = new StatefulProfileLoader(claudeProfile);
	const pi = new FakeBackend();
	const claude = new FakeBackend();

	await executeWithRuntimeProfile(
		executionInput(
			{ tasks: Array.from({ length: 4 }, (_, index) => ({ agent: "scout", task: `task ${index}` })) },
			[userAgent("scout", { backend: "pi", model: "stale", tools: ["stale"] })],
			new Map([["pi", pi], ["claude", claude]]),
		),
		loader,
	);

	expect(loader.loads).toBe(1);
	expect(pi.requests).toEqual([]);
	expect(claude.requests.map((request) => request.agent)).toEqual(
		Array.from({ length: 4 }, () => expect.objectContaining({ backend: "claude", model: "haiku", tools: claudeProfile.roles.scout.tools })),
	);
});

test("keeps the first profile snapshot for every chain step", async () => {
	const loader = new StatefulProfileLoader(claudeProfile);
	const pi = new FakeBackend();
	const claude = new FakeBackend(() => {
		loader.next = gptProfile;
	});

	await executeWithRuntimeProfile(
		executionInput(
			{
				chain: [
					{ agent: "scout", task: "first" },
					{ agent: "scout", task: "second {previous}" },
				],
			},
			[userAgent("scout", { backend: "pi", model: "stale", tools: ["stale"] })],
			new Map([["pi", pi], ["claude", claude]]),
		),
		loader,
	);

	expect(loader.loads).toBe(1);
	expect(pi.requests).toEqual([]);
	expect(claude.requests.map((request) => request.agent)).toEqual([
		expect.objectContaining({ backend: "claude", model: "haiku", tools: claudeProfile.roles.scout.tools }),
		expect.objectContaining({ backend: "claude", model: "haiku", tools: claudeProfile.roles.scout.tools }),
	]);
});

test("does not start a backend when profile resolution rejects", async () => {
	const pi = new FakeBackend();
	const claude = new FakeBackend();
	const loader: RuntimeProfileLoader = {
		async load() {
			throw new Error("catalog diagnostic");
		},
	};

	await expect(
		executeWithRuntimeProfile(
			executionInput(
				{ agent: "scout", task: "inspect" },
				[userAgent("scout", { backend: "pi", model: "stale", tools: ["stale"] })],
				new Map([["pi", pi], ["claude", claude]]),
			),
			loader,
		),
	).rejects.toThrow("catalog diagnostic");
	expect(pi.requests).toEqual([]);
	expect(claude.requests).toEqual([]);
});

test("formats runtime profile resolution errors", () => {
	expect(formatRuntimeProfileError(new Error("bad state"))).toBe("Subagent profile resolution failed: bad state");
});
