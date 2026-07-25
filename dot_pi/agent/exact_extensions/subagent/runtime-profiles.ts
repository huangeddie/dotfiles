import type { AgentConfig } from "./agents.ts";
import type { ExecuteSubagentModeInput, SubagentExecution } from "./orchestrator.ts";
import type { ResolvedProfile } from "./profiles.ts";

export interface RuntimeProfileLoader {
	load(): Promise<ResolvedProfile>;
}

export function applyRuntimeProfile(
	_agents: readonly AgentConfig[],
	_profile: ResolvedProfile,
): AgentConfig[] {
	throw new Error("runtime profile application is not implemented");
}

export async function executeWithRuntimeProfile(
	_input: ExecuteSubagentModeInput,
	_loader: RuntimeProfileLoader,
): Promise<SubagentExecution> {
	throw new Error("runtime profile application is not implemented");
}

export function formatRuntimeProfileError(_error: unknown): string {
	throw new Error("runtime profile application is not implemented");
}
