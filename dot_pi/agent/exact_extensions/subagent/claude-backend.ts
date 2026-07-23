import type { AgentRunRequest, AgentRunResult, ProcessInvocation, ProcessOutcome, ProcessRunner, SubagentBackend } from "./contracts.ts";

export function buildClaudeInvocation(_request: AgentRunRequest): ProcessInvocation {
	throw new Error("not implemented");
}

export class ClaudeStreamParser {
	constructor(_request: AgentRunRequest) {}

	accept(_line: string): void {
		throw new Error("not implemented");
	}

	finish(_outcome: ProcessOutcome): AgentRunResult {
		throw new Error("not implemented");
	}
}

export function createClaudeBackend(_runner: ProcessRunner): SubagentBackend {
	throw new Error("not implemented");
}
