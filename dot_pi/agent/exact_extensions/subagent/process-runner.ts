import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { ProcessOutcome, ProcessRunner } from "./contracts.ts";

const ABORT_KILL_DELAY_MS = 5_000;

export function createNodeProcessRunner(): ProcessRunner {
	return {
		run(invocation, options) {
			return new Promise<ProcessOutcome>((resolve) => {
				const process = spawn(invocation.command, invocation.args, {
					cwd: invocation.cwd,
					shell: false,
					stdio: ["pipe", "pipe", "pipe"],
				});
				const stdoutDecoder = new StringDecoder("utf8");
				const stderrDecoder = new StringDecoder("utf8");
				let stdoutBuffer = "";
				let stderr = "";
				let settled = false;
				let abortedBySignal = false;
				let killTimer: ReturnType<typeof setTimeout> | undefined;

				const clearAbort = () => {
					if (killTimer) clearTimeout(killTimer);
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
				const abort = () => {
					if (settled || abortedBySignal) return;
					abortedBySignal = true;
					if (!process.stdin.writableEnded) process.stdin.end();
					process.kill("SIGTERM");
					killTimer = setTimeout(() => {
						if (!settled) process.kill("SIGKILL");
					}, ABORT_KILL_DELAY_MS);
				};

				process.stdout.on("data", (data: Buffer) => emitLines(stdoutDecoder.write(data)));
				process.stderr.on("data", (data: Buffer) => {
					stderr += stderrDecoder.write(data);
				});
				process.on("error", (error) => {
					settle({ exitCode: 1, stderr: stderr + stderrDecoder.end(), aborted: abortedBySignal, spawnError: error.message });
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
