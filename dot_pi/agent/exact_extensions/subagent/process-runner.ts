import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { ProcessInvocation, ProcessOutcome, ProcessRunner } from "./contracts.ts";

const ABORT_KILL_DELAY_MS = 5_000;

export interface NodeProcessReadable {
	on(event: "data", listener: (data: Uint8Array) => void): void;
}

export interface NodeProcessChild {
	stdin: { readonly writableEnded: boolean; end(input?: string): void };
	stdout: NodeProcessReadable;
	stderr: NodeProcessReadable;
	on(event: "error", listener: (error: Error) => void): void;
	on(event: "close", listener: (code: number | null) => void): void;
	kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export interface NodeProcessRunnerDependencies {
	spawn(invocation: ProcessInvocation): NodeProcessChild;
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(timer: unknown): void;
}

const nodeProcessRunnerDependencies: NodeProcessRunnerDependencies = {
	spawn(invocation) {
		return spawn(invocation.command, invocation.args, {
			cwd: invocation.cwd,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		}) as unknown as NodeProcessChild;
	},
	setTimeout(callback, delayMs) {
		return globalThis.setTimeout(callback, delayMs);
	},
	clearTimeout(timer) {
		globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>);
	},
};

function spawnErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createNodeProcessRunner(
	dependencies: NodeProcessRunnerDependencies = nodeProcessRunnerDependencies,
): ProcessRunner {
	return {
		run(invocation, options) {
			return new Promise<ProcessOutcome>((resolve) => {
				let process: NodeProcessChild;
				try {
					process = dependencies.spawn(invocation);
				} catch (error) {
					resolve({ exitCode: 1, stderr: "", aborted: false, spawnError: spawnErrorMessage(error) });
					return;
				}

				const stdoutDecoder = new StringDecoder("utf8");
				const stderrDecoder = new StringDecoder("utf8");
				let stdoutBuffer = "";
				let stderr = "";
				let settled = false;
				let abortedBySignal = false;
				let killTimer: unknown;

				const abort = () => {
					if (settled || abortedBySignal) return;
					abortedBySignal = true;
					if (!process.stdin.writableEnded) process.stdin.end();
					process.kill("SIGTERM");
					killTimer = dependencies.setTimeout(() => {
						if (!settled) process.kill("SIGKILL");
					}, ABORT_KILL_DELAY_MS);
				};
				const clearAbort = () => {
					if (killTimer !== undefined) dependencies.clearTimeout(killTimer);
					if (options.signal) options.signal.removeEventListener("abort", abort);
				};
				const settle = (outcome: ProcessOutcome) => {
					if (settled) return;
					settled = true;
					clearAbort();
					resolve(outcome);
				};
				const emitLines = (text: string, final = false) => {
					stdoutBuffer += text;
					const lines = stdoutBuffer.split("\n");
					stdoutBuffer = lines.pop() ?? "";
					for (const line of lines) options.onStdoutLine(line);
					if (final && stdoutBuffer) {
						options.onStdoutLine(stdoutBuffer);
						stdoutBuffer = "";
					}
				};

				process.stdout.on("data", (data) => emitLines(stdoutDecoder.write(data)));
				process.stderr.on("data", (data) => {
					stderr += stderrDecoder.write(data);
				});
				process.on("error", (error) => {
					settle({
						exitCode: 1,
						stderr: stderr + stderrDecoder.end(),
						aborted: abortedBySignal,
						spawnError: error.message,
					});
				});
				process.on("close", (code) => {
					emitLines(stdoutDecoder.end(), true);
					stderr += stderrDecoder.end();
					settle({ exitCode: code ?? 1, stderr, aborted: abortedBySignal });
				});

				process.stdin.end(invocation.stdin);
				if (options.signal) {
					if (options.signal.aborted) abort();
					else options.signal.addEventListener("abort", abort, { once: true });
				}
			});
		},
	};
}
