import type { AgentConfig } from "./agents.ts";
import type { AgentRunRequest, AgentRunResult, ProcessOutcome, ProcessRunner, SubagentBackend } from "./contracts.ts";

export function buildPiArgs(_agent: AgentConfig, _task: string): string[] {
	throw new Error("not implemented");
}

export class PiStreamParser {
	constructor(_request: AgentRunRequest) {}

	accept(_line: string): void {
		throw new Error("not implemented");
	}

	finish(_outcome: ProcessOutcome): AgentRunResult {
		throw new Error("not implemented");
	}
}

export function createPiBackend(_runner: ProcessRunner): SubagentBackend {
	throw new Error("not implemented");
}
