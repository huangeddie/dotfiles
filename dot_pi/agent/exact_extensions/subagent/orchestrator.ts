import type { AgentConfig } from "./agents.ts";
import type { AgentRunResult, SubagentBackend, UsageStats } from "./contracts.ts";

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
export const PER_TASK_OUTPUT_CAP = 50 * 1024;

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

export function truncateTaskOutput(output: string): string {
	return output;
}

export async function executeSubagentMode(_input: ExecuteSubagentModeInput): Promise<SubagentExecution> {
	throw new Error("not implemented");
}
