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

				let terminalFlushed = false;
				const flushTerminalState = () => {
					if (terminalFlushed) return;
					terminalFlushed = true;
					emitLines(stdoutDecoder.end(), true);
					stderr += stderrDecoder.end();
				};
				const settle = (exitCode: number, spawnError?: string) => {
					if (settled) return;
					flushTerminalState();
					settled = true;
					clearAbort();
					resolve({
						exitCode,
						stderr,
						aborted: abortedBySignal,
						...(spawnError === undefined ? {} : { spawnError }),
					});
				};

				process.stdout.on("data", (data) => {
					if (!settled) emitLines(stdoutDecoder.write(data));
				});
				process.stderr.on("data", (data) => {
					if (!settled) stderr += stderrDecoder.write(data);
				});
				process.on("error", (error) => settle(1, error.message));
				process.on("close", (code) => settle(code ?? 1));

				process.stdin.end(invocation.stdin);
				if (options.signal) {
					if (options.signal.aborted) abort();
					else options.signal.addEventListener("abort", abort, { once: true });
				}
			});
		},
	};
}
