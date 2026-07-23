import {
	addUsage,
	emptyUsage,
	type AgentRunRequest,
	type AgentRunResult,
	type ProcessInvocation,
	type ProcessOutcome,
	type ProcessRunner,
	type SubagentBackend,
	type UsageStats,
} from "./contracts.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function permissionDenialMessage(value: unknown): string | undefined {
	if (typeof value === "string" && value) return value;
	const denial = asRecord(value);
	if (!denial) return undefined;
	for (const field of ["message", "error", "reason"]) {
		if (typeof denial[field] === "string" && denial[field]) return denial[field];
	}
	return undefined;
}

function usageFromResult(result: Record<string, unknown>): UsageStats {
	const usage = asRecord(result.usage);
	return {
		input: numberValue(usage?.input_tokens),
		output: numberValue(usage?.output_tokens),
		cacheRead: numberValue(usage?.cache_read_input_tokens),
		cacheWrite: numberValue(usage?.cache_creation_input_tokens),
		contextTokens: 0,
		turns: numberValue(result.num_turns),
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: numberValue(result.total_cost_usd),
		},
	};
}

export function buildClaudeInvocation(request: AgentRunRequest): ProcessInvocation {
	if (request.agent.backend !== "claude") {
		throw new Error("Claude backend requires a Claude agent definition");
	}

	const tools = request.agent.tools.filter((tool) => tool !== "Agent").join(",");
	const args = [
		"-p",
		"--output-format",
		"stream-json",
		"--verbose",
		"--no-session-persistence",
		"--model",
		request.agent.model,
		"--tools",
		tools,
		"--allowedTools",
		tools,
		"--disallowedTools",
		"Agent",
		"--permission-mode",
		"dontAsk",
		"--append-system-prompt",
		request.agent.systemPrompt,
	];

	return { command: "claude", args, cwd: request.cwd, stdin: `Task: ${request.task}` };
}

export class ClaudeStreamParser {
	private readonly events: AgentRunResult["events"] = [];
	private readonly malformedEvents: string[] = [];
	private readonly permissionDenials: string[] = [];
	private readonly resultErrors: string[] = [];
	private readonly unconfiguredTools = new Set<string>();
	private hasPermissionDenials = false;
	private usage = emptyUsage();
	private model: string | undefined;
	private lastAssistantText = "";
	private finalOutput = "";
	private finalResultEvents = 0;
	private validFinalResults = 0;
	private acceptedAssistantMessages = 0;

	constructor(private readonly request: AgentRunRequest) {
		this.model = request.agent.model;
	}

	accept(line: string): void {
		if (!line.trim()) return;

		let event: Record<string, unknown> | null;
		try {
			event = asRecord(JSON.parse(line));
		} catch {
			this.malformedEvents.push(`Malformed Claude JSON event: ${line}`);
			return;
		}
		if (!event) {
			this.malformedEvents.push(`Malformed Claude JSON event: ${line}`);
			return;
		}

		if (event.type === "system" && event.subtype === "init" && typeof event.model === "string") {
			this.model = event.model;
			return;
		}
		if (event.type === "assistant") {
			this.acceptAssistant(event);
			return;
		}
		if (event.type === "result") this.acceptResult(event);
	}

	get acceptedMessages(): number {
		return this.acceptedAssistantMessages;
	}

	runningResult(): AgentRunResult {
		return this.result("running", "", undefined, undefined, this.lastAssistantText);
	}

	finish(outcome: ProcessOutcome): AgentRunResult {
		const status = outcome.aborted
			? "aborted"
			: this.malformedEvents.length > 0 ||
					this.resultErrors.length > 0 ||
					this.unconfiguredTools.size > 0 ||
					this.hasPermissionDenials ||
					outcome.exitCode !== 0 ||
					this.validFinalResults !== 1
				? "failed"
				: "completed";
		const diagnostics = [
			...this.resultErrors,
			...Array.from(this.unconfiguredTools, (tool) => `Claude emitted unconfigured tool "${tool}".`),
			...(this.permissionDenials.length > 0
				? this.permissionDenials
				: this.hasPermissionDenials
					? ["Claude permission was denied."]
					: []),
			...this.malformedEvents,
			outcome.spawnError,
			outcome.stderr,
			status === "aborted" ? "Claude process was aborted." : undefined,
			status === "failed" && this.finalResultEvents === 0 ? "Claude exited without a final result." : undefined,
		].filter((diagnostic): diagnostic is string => Boolean(diagnostic));
		return this.result(status, outcome.stderr, outcome.exitCode, diagnostics.join("\n") || undefined);
	}

	private acceptAssistant(event: Record<string, unknown>): void {
		const message = asRecord(event.message);
		if (!message) return;
		this.acceptedAssistantMessages++;
		if (typeof message.model === "string") this.model = message.model;

		const content = message.content;
		if (!Array.isArray(content)) return;
		for (const item of content) {
			const part = asRecord(item);
			if (!part) continue;
			if (part.type === "text" && typeof part.text === "string") {
				this.events.push({ type: "text", text: part.text });
				this.lastAssistantText = part.text;
			} else if (part.type === "tool_use" && typeof part.name === "string") {
				if (!this.request.agent.tools.includes(part.name)) this.unconfiguredTools.add(part.name);
				this.events.push({ type: "toolCall", name: part.name, args: asRecord(part.input) ?? {} });
			}
		}
	}

	private acceptResult(event: Record<string, unknown>): void {
		this.finalResultEvents++;
		const hasStringOutput = typeof event.result === "string";
		const isSuccessful = event.subtype === "success" && event.is_error !== true;
		if (isSuccessful && hasStringOutput) this.validFinalResults++;

		if (this.finalResultEvents > 1) {
			this.resultErrors.push("Claude emitted multiple final results.");
			return;
		}

		this.finalOutput = hasStringOutput ? event.result : "";
		this.usage = usageFromResult(event);

		if (event.subtype !== "success") {
			this.resultErrors.push(`Claude result ${typeof event.subtype === "string" ? event.subtype : "unknown"}.`);
		} else if (event.is_error === true) {
			this.resultErrors.push("Claude result reported an error.");
		} else if (!hasStringOutput) {
			this.resultErrors.push("Claude final result is missing string output.");
		}

		if (Array.isArray(event.permission_denials)) {
			this.hasPermissionDenials ||= event.permission_denials.length > 0;
			for (const denial of event.permission_denials) {
				const message = permissionDenialMessage(denial);
				if (message) this.permissionDenials.push(message);
			}
		}
	}

	private result(
		status: AgentRunResult["status"],
		stderr: string,
		exitCode: number | undefined,
		diagnostic?: string,
		output = this.finalOutput,
	): AgentRunResult {
		return {
			backend: "claude",
			agent: this.request.agent.name,
			agentSource: this.request.agent.source,
			task: this.request.task,
			status,
			output,
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

export function createClaudeBackend(runner: ProcessRunner): SubagentBackend {
	return {
		async run(request, signal, onUpdate) {
			const parser = new ClaudeStreamParser(request);
			const outcome = await runner.run(buildClaudeInvocation(request), {
				...(signal ? { signal } : {}),
				onStdoutLine(line) {
					const acceptedMessages = parser.acceptedMessages;
					parser.accept(line);
					if (onUpdate && parser.acceptedMessages > acceptedMessages) onUpdate(parser.runningResult());
				},
			});
			return parser.finish(outcome);
		},
	};
}
