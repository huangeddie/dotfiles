import type { AgentConfig } from "./agents.ts";
import { executeSubagentMode, type ExecuteSubagentModeInput, type SubagentExecution } from "./orchestrator.ts";
import type { ResolvedProfile } from "./profiles.ts";

export interface RuntimeProfileLoader {
	load(): Promise<ResolvedProfile>;
}

export function applyRuntimeProfile(
	agents: readonly AgentConfig[],
	profile: ResolvedProfile,
): AgentConfig[] {
	return agents.map((agent) => {
		if (agent.source !== "user" || !Object.hasOwn(profile.roles, agent.name)) return agent;

		const resolved = profile.roles[agent.name]!;
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
	});
}

export async function executeWithRuntimeProfile(
	input: ExecuteSubagentModeInput,
	loader: RuntimeProfileLoader,
): Promise<SubagentExecution> {
	const profile = await loader.load();
	return executeSubagentMode({ ...input, agents: applyRuntimeProfile(input.agents, profile) });
}

export function formatRuntimeProfileError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `Subagent profile resolution failed: ${message}`;
}
