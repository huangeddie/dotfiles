import type { AgentConfig, AgentDiagnostic } from "./agents.ts";
import { addUsage, emptyUsage, type AgentRunResult, type SubagentBackend, type UsageStats } from "./contracts.ts";

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
export const PER_TASK_OUTPUT_CAP = 50 * 1024;
const MAX_UNKNOWN_AGENT_ENTRIES = 10;

type SubagentMode = "single" | "parallel" | "chain";
type TaskRequest = { agent: string; task: string; cwd?: string };

export interface ExecuteSubagentModeInput {
	params: {
		agent?: string;
		task?: string;
		cwd?: string;
		tasks?: TaskRequest[];
		chain?: TaskRequest[];
	};
	agents: AgentConfig[];
	discoveryDiagnostics?: readonly AgentDiagnostic[];
	backends: ReadonlyMap<"pi" | "claude", SubagentBackend>;
	defaultCwd: string;
	signal?: AbortSignal;
	onUpdate?: (mode: SubagentMode, results: AgentRunResult[]) => void;
}

export interface SubagentExecution {
	mode: SubagentMode;
	results: AgentRunResult[];
	content: string;
	usage: UsageStats;
}

function truncateModelVisibleContent(output: string): string {
	const bytes = Buffer.from(output, "utf8");
	if (bytes.length <= PER_TASK_OUTPUT_CAP) return output;

	let end = PER_TASK_OUTPUT_CAP;
	while (end > 0) {
		while (end > 0 && (bytes[end] & 0b1100_0000) === 0b1000_0000) end--;
		const suffix = `\n\n[Output truncated: ${bytes.length - end} bytes omitted. Full output preserved in tool details.]`;
		if (end + Buffer.byteLength(suffix, "utf8") <= PER_TASK_OUTPUT_CAP) {
			return `${bytes.subarray(0, end).toString("utf8")}${suffix}`;
		}
		end--;
	}

	return "[Output truncated. Full output preserved in tool details.]";
}

export async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

function failedResult(
	backend: "pi" | "claude",
	agent: string,
	task: string,
	diagnostic: string,
	step: number | undefined,
): AgentRunResult {
	return {
		backend,
		agent,
		agentSource: "unknown",
		task,
		status: "failed",
		output: "",
		events: [],
		stderr: "",
		usage: emptyUsage(),
		diagnostic,
		...(step === undefined ? {} : { step }),
	};
}

function validAgentDiagnostic(agents: readonly AgentConfig[]): string {
	if (agents.length === 0) return "Valid agents: none.";

	const entries = agents
		.map((agent) => `${agent.name} (${agent.source})`)
		.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
	const listed = entries.slice(0, MAX_UNKNOWN_AGENT_ENTRIES);
	const remaining = entries.length - listed.length;
	return `Valid agents: ${listed.join(", ")}${remaining ? `, and ${remaining} more` : ""}.`;
}

function unknownAgentResult(
	agent: string,
	task: string,
	step: number | undefined,
	agents: readonly AgentConfig[],
	discoveryDiagnostics: readonly AgentDiagnostic[] | undefined,
): AgentRunResult {
	const diagnostic = [
		`Unknown agent: "${agent}".`,
		validAgentDiagnostic(agents),
		...((discoveryDiagnostics ?? [])
			.filter((candidate) => candidate.name === agent)
			.map((candidate) => candidate.message)),
	].join("\n");
	return failedResult("pi", agent, task, diagnostic, step);
}

function outputFor(result: AgentRunResult): string {
	if (result.status === "failed" || result.status === "aborted") {
		return result.diagnostic || result.stderr || result.output || "(no output)";
	}
	return result.output || "(no output)";
}

function isFailed(result: AgentRunResult): boolean {
	return result.status === "failed" || result.status === "aborted";
}

function aggregateUsage(results: AgentRunResult[]): UsageStats {
	return results.reduce((total, result) => addUsage(total, result.usage), emptyUsage());
}

function snapshot(results: Array<AgentRunResult | undefined>): AgentRunResult[] {
	return results.filter((result): result is AgentRunResult => result !== undefined);
}

function hasNonEmptyAgentAndTask(item: TaskRequest): boolean {
	return Boolean(item.agent.trim() && item.task.trim());
}

function invalidExecution(): SubagentExecution {
	return {
		mode: "single",
		results: [],
		content: truncateModelVisibleContent(
			"Invalid parameters. Provide exactly one non-empty mode: single { agent, task }, parallel { tasks: [{ agent, task }] }, or chain { chain: [{ agent, task }] }.",
		),
		usage: emptyUsage(),
	};
}

export async function executeSubagentMode(input: ExecuteSubagentModeInput): Promise<SubagentExecution> {
	const { params } = input;
	const hasSingle = Boolean(params.agent?.trim() && params.task?.trim());
	const hasParallel = (params.tasks?.length ?? 0) > 0;
	const hasChain = (params.chain?.length ?? 0) > 0;
	const hasInvalidTaskEntry =
		params.tasks?.some((item) => !hasNonEmptyAgentAndTask(item)) ||
		params.chain?.some((item) => !hasNonEmptyAgentAndTask(item));
	const hasIncompleteSingle = (params.agent !== undefined || params.task !== undefined) && !hasSingle;
	const modeCount = Number(hasSingle) + Number(hasParallel) + Number(hasChain);
	if (modeCount !== 1 || hasIncompleteSingle || hasInvalidTaskEntry) return invalidExecution();

	const mode: SubagentMode = hasSingle ? "single" : hasParallel ? "parallel" : "chain";
	const updates: Array<AgentRunResult | undefined> = [];
	const emitUpdate = () => input.onUpdate?.(mode, snapshot(updates));

	const run = async (item: TaskRequest, index: number, step?: number): Promise<AgentRunResult> => {
		const agent = input.agents.find((candidate) => candidate.name === item.agent);
		if (!agent) {
			const result = unknownAgentResult(item.agent, item.task, step, input.agents, input.discoveryDiagnostics);
			updates[index] = result;
			emitUpdate();
			return result;
		}

		const backend = input.backends.get(agent.backend);
		if (!backend) {
			const result = failedResult(
				agent.backend,
				agent.name,
				item.task,
				`No backend adapter is configured for "${agent.backend}".`,
				step,
			);
			updates[index] = result;
			emitUpdate();
			return result;
		}

		try {
			const result = await backend.run(
				{ agent, task: item.task, cwd: item.cwd ?? input.defaultCwd, ...(step === undefined ? {} : { step }) },
				input.signal,
				(partial) => {
					updates[index] = partial;
					emitUpdate();
				},
			);
			updates[index] = result;
			emitUpdate();
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const result = failedResult(agent.backend, agent.name, item.task, `Backend run failed: ${message}`, step);
			updates[index] = result;
			emitUpdate();
			return result;
		}
	};

	if (mode === "single") {
		const result = await run({ agent: params.agent!, task: params.task!, cwd: params.cwd }, 0);
		return {
			mode,
			results: [result],
			content: truncateModelVisibleContent(outputFor(result)),
			usage: aggregateUsage([result]),
		};
	}

	if (mode === "parallel") {
		const tasks = params.tasks!;
		if (tasks.length > MAX_PARALLEL_TASKS) {
			return {
				mode,
				results: [],
				content: truncateModelVisibleContent(`Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`),
				usage: emptyUsage(),
			};
		}
		const results = await mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY, (task, index) => run(task, index));
		const successCount = results.filter((result) => !isFailed(result)).length;
		const summaries = results.map((result) => `### [${result.agent}] ${result.status}\n\n${outputFor(result)}`);
		return {
			mode,
			results,
			content: truncateModelVisibleContent(
				`Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
			),
			usage: aggregateUsage(results),
		};
	}

	const results: AgentRunResult[] = [];
	let previousOutput = "";
	for (let index = 0; index < params.chain!.length; index++) {
		const step = params.chain![index];
		const task = { ...step, task: step.task.replace(/\{previous\}/g, previousOutput) };
		const result = await run(task, index, index + 1);
		results.push(result);
		if (isFailed(result)) {
			return {
				mode,
				results,
				content: truncateModelVisibleContent(
					`Chain stopped at step ${index + 1} (${step.agent}): ${outputFor(result)}`,
				),
				usage: aggregateUsage(results),
			};
		}
		previousOutput = result.output;
	}

	const finalResult = results[results.length - 1];
	return {
		mode,
		results,
		content: truncateModelVisibleContent(finalResult.output || "(no output)"),
		usage: aggregateUsage(results),
	};
}
