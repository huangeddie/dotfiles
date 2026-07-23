import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentConfig } from "./agents.ts";
import { buildChildToolArgs } from "./invocation.ts";
import { addUsage, emptyUsage, type AgentRunRequest, type AgentRunResult, type ProcessOutcome, type ProcessRunner, type SubagentBackend, type UsageStats } from "./contracts.ts";

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) return { command: process.execPath, args };

	return { command: "pi", args };
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageFromMessage(message: Record<string, unknown>): UsageStats {
	const usage = asRecord(message.usage);
	const cost = asRecord(usage?.cost);
	return {
		input: numberValue(usage?.input),
		output: numberValue(usage?.output),
		cacheRead: numberValue(usage?.cacheRead),
		cacheWrite: numberValue(usage?.cacheWrite),
		contextTokens: 0,
		turns: 1,
		cost: {
			input: numberValue(cost?.input),
			output: numberValue(cost?.output),
			cacheRead: numberValue(cost?.cacheRead),
			cacheWrite: numberValue(cost?.cacheWrite),
			total: numberValue(cost?.total),
		},
	};
}

export function buildPiArgs(agent: AgentConfig, task: string): string[] {
	const args = ["--mode", "json", "-p", "--no-session"];
	if (agent.model) args.push("--model", agent.model);
	args.push(...buildChildToolArgs(agent.tools));
	if (agent.systemPrompt.trim()) args.push("--append-system-prompt", agent.systemPrompt);
	args.push(`Task: ${task}`);
	return args;
}

export class PiStreamParser {
	private readonly request: AgentRunRequest;
	private readonly events: AgentRunResult["events"] = [];
	private readonly malformedEvents: string[] = [];
	private usage = emptyUsage();
	private model: string | undefined;
	private lastAssistantText = "";
	private hasAssistantOutput = false;
	private errorMessage: string | undefined;
	private stopReason: "error" | "aborted" | undefined;
	private acceptedAssistantMessages = 0;

	constructor(request: AgentRunRequest) {
		this.request = request;
		this.model = request.agent.model;
	}

	accept(line: string): void {
		if (!line.trim()) return;

		let event: Record<string, unknown> | null;
		try {
			event = asRecord(JSON.parse(line));
		} catch {
			this.malformedEvents.push(`Malformed Pi JSON event: ${line}`);
			return;
		}
		if (!event) {
			this.malformedEvents.push(`Malformed Pi JSON event: ${line}`);
			return;
		}
		if (event.type !== "message_end") return;

		const message = asRecord(event.message);
		if (!message || message.role !== "assistant") return;
		this.acceptedAssistantMessages++;
		this.usage = addUsage(this.usage, usageFromMessage(message));

		const messageUsage = asRecord(message.usage);
		if (typeof messageUsage?.totalTokens === "number" && Number.isFinite(messageUsage.totalTokens)) {
			this.usage.contextTokens = messageUsage.totalTokens;
		}
		if (!this.model && typeof message.model === "string") this.model = message.model;
		if (message.stopReason === "error" || message.stopReason === "aborted") this.stopReason = message.stopReason;
		if (typeof message.errorMessage === "string" && message.errorMessage) this.errorMessage = message.errorMessage;

		const content = message.content;
		if (!Array.isArray(content)) return;
		for (const item of content) {
			const part = asRecord(item);
			if (!part) continue;
			if (part.type === "text" && typeof part.text === "string") {
				this.events.push({ type: "text", text: part.text });
				this.lastAssistantText = part.text;
				if (part.text) this.hasAssistantOutput = true;
			} else if (part.type === "toolCall" && typeof part.name === "string") {
				this.events.push({ type: "toolCall", name: part.name, args: asRecord(part.arguments) ?? {} });
			}
		}
	}

	get acceptedMessages(): number {
		return this.acceptedAssistantMessages;
	}

	runningResult(): AgentRunResult {
		return this.result("running", "", undefined);
	}

	finish(outcome: ProcessOutcome): AgentRunResult {
		const status = outcome.aborted || this.stopReason === "aborted"
			? "aborted"
			: this.stopReason === "error" || this.malformedEvents.length > 0 || outcome.exitCode !== 0 || !this.hasAssistantOutput
				? "failed"
				: "completed";
		const diagnostics = [
			this.errorMessage,
			...this.malformedEvents,
			outcome.spawnError,
			outcome.stderr,
			status === "aborted" ? "Pi process was aborted." : undefined,
			status === "failed" && !this.hasAssistantOutput ? "Pi exited without an assistant response." : undefined,
		].filter((diagnostic): diagnostic is string => Boolean(diagnostic));
		return this.result(status, outcome.stderr, outcome.exitCode, diagnostics.join("\n") || undefined);
	}

	private result(
		status: AgentRunResult["status"],
		stderr: string,
		exitCode: number | undefined,
		diagnostic?: string,
	): AgentRunResult {
		return {
			backend: "pi",
			agent: this.request.agent.name,
			agentSource: this.request.agent.source,
			task: this.request.task,
			status,
			output: this.lastAssistantText,
			events: [...this.events],
			stderr,
			usage: addUsage(emptyUsage(), this.usage),
			...(this.model ? { model: this.model } : {}),
			...(exitCode === undefined ? {} : { exitCode }),
			...(diagnostic ? { diagnostic } : {}),
			...(this.request.step === undefined ? {} : { step: this.request.step }),
		};
	}
}

export function createPiBackend(runner: ProcessRunner): SubagentBackend {
	return {
		async run(request, signal, onUpdate) {
			const parser = new PiStreamParser(request);
			const pi = getPiInvocation(buildPiArgs(request.agent, request.task));
			const outcome = await runner.run(
				{ ...pi, cwd: request.cwd },
				{
					...(signal ? { signal } : {}),
					onStdoutLine(line) {
						const acceptedMessages = parser.acceptedMessages;
						parser.accept(line);
						if (onUpdate && parser.acceptedMessages > acceptedMessages) onUpdate(parser.runningResult());
					},
				},
			);
			return parser.finish(outcome);
		},
	};
}
