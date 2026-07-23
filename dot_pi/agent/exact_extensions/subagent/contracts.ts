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

export interface ProcessInvocation {
	command: string;
	args: string[];
	cwd: string;
	stdin?: string;
}

export interface ProcessOutcome {
	exitCode: number;
	stderr: string;
	aborted: boolean;
	spawnError?: string;
}

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

export function emptyUsage(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		contextTokens: 0,
		turns: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function addUsage(left: UsageStats, right: UsageStats): UsageStats {
	return {
		input: left.input + right.input,
		output: left.output + right.output,
		cacheRead: left.cacheRead + right.cacheRead,
		cacheWrite: left.cacheWrite + right.cacheWrite,
		contextTokens: left.contextTokens + right.contextTokens,
		turns: left.turns + right.turns,
		cost: {
			input: left.cost.input + right.cost.input,
			output: left.cost.output + right.cost.output,
			cacheRead: left.cost.cacheRead + right.cost.cacheRead,
			total: left.cost.total + right.cost.total,
		},
	};
}
