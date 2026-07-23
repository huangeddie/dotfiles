import { expect, test } from "bun:test";

import type { ProcessInvocation } from "../dot_pi/agent/exact_extensions/subagent/contracts";
import {
	createNodeProcessRunner,
	type NodeProcessChild,
	type NodeProcessRunnerDependencies,
} from "../dot_pi/agent/exact_extensions/subagent/process-runner";

class FakeChildProcess implements NodeProcessChild {
	readonly stdinWrites: Array<string | undefined> = [];
	readonly killSignals: Array<"SIGTERM" | "SIGKILL"> = [];
	private stdoutListener: ((data: Uint8Array) => void) | undefined;
	private stderrListener: ((data: Uint8Array) => void) | undefined;
	private errorListener: ((error: Error) => void) | undefined;
	private closeListener: ((code: number | null) => void) | undefined;

	readonly stdin = {
		writableEnded: false,
		end: (input?: string) => {
			this.stdinWrites.push(input);
			this.stdin.writableEnded = true;
		},
	};
	readonly stdout = {
		on: (_event: "data", listener: (data: Uint8Array) => void) => {
			this.stdoutListener = listener;
		},
	};
	readonly stderr = {
		on: (_event: "data", listener: (data: Uint8Array) => void) => {
			this.stderrListener = listener;
		},
	};

	on(event: "error", listener: (error: Error) => void): void;
	on(event: "close", listener: (code: number | null) => void): void;
	on(
		event: "error" | "close",
		listener: ((error: Error) => void) | ((code: number | null) => void),
	): void {
		if (event === "error") this.errorListener = listener as (error: Error) => void;
		else this.closeListener = listener as (code: number | null) => void;
	}

	kill(signal: "SIGTERM" | "SIGKILL"): void {
		this.killSignals.push(signal);
	}

	emitStdout(data: Uint8Array): void {
		this.stdoutListener?.(data);
	}

	emitError(error: Error): void {
		this.errorListener?.(error);
	}

	emitClose(code: number | null): void {
		this.closeListener?.(code);
	}
}

class FakeAbortSignal {
	aborted = false;
	private readonly listeners = new Set<() => void>();

	addEventListener(_event: "abort", listener: () => void): void {
		this.listeners.add(listener);
	}

	removeEventListener(_event: "abort", listener: () => void): void {
		this.listeners.delete(listener);
	}

	abort(): void {
		this.aborted = true;
		for (const listener of this.listeners) listener();
	}

	get listenerCount(): number {
		return this.listeners.size;
	}
}

function invocation(): ProcessInvocation {
	return { command: "pi", args: ["--mode", "json"], cwd: "/project", stdin: "Task: inspect" };
}

test("normalizes a synchronous spawn exception as a process outcome", async () => {
	const runner = createNodeProcessRunner({
		spawn() {
			throw new Error("pi executable unavailable");
		},
		setTimeout,
		clearTimeout,
	});

	await expect(runner.run(invocation(), { onStdoutLine() {} })).resolves.toEqual({
		exitCode: 1,
		stderr: "",
		aborted: false,
		spawnError: "pi executable unavailable",
	});
});

test("flushes a final unterminated stdout line on normal close", async () => {
	const child = new FakeChildProcess();
	const runner = createNodeProcessRunner({ spawn: () => child, setTimeout, clearTimeout });
	const stdoutLines: string[] = [];

	const outcome = runner.run(invocation(), { onStdoutLine: (line) => stdoutLines.push(line) });
	child.emitStdout(new TextEncoder().encode("final unterminated stdout"));
	child.emitClose(0);

	expect(await outcome).toEqual({ exitCode: 0, stderr: "", aborted: false });
	expect(stdoutLines).toEqual(["final unterminated stdout"]);
});

test("flushes partial UTF-8 stdout before async error settlement only once", async () => {
	const child = new FakeChildProcess();
	const runner = createNodeProcessRunner({ spawn: () => child, setTimeout, clearTimeout });
	const stdoutLines: string[] = [];
	const encoded = new TextEncoder().encode("final €");

	const outcome = runner.run(invocation(), { onStdoutLine: (line) => stdoutLines.push(line) });
	await Promise.resolve();
	child.emitStdout(encoded.subarray(0, 7));
	child.emitStdout(encoded.subarray(7));
	child.emitError(new Error("pi executable unavailable"));

	expect(await outcome).toEqual({
		exitCode: 1,
		stderr: "",
		aborted: false,
		spawnError: "pi executable unavailable",
	});
	expect(stdoutLines).toEqual(["final €"]);

	child.emitClose(0);
	expect(stdoutLines).toEqual(["final €"]);
});

test("aborting closes stdin, escalates termination after five seconds, and cleans up", async () => {
	const child = new FakeChildProcess();
	const signal = new FakeAbortSignal();
	const timers: Array<{ callback: () => void; delayMs: number; cleared: boolean }> = [];
	const clearedTimers: Array<{ callback: () => void; delayMs: number; cleared: boolean }> = [];
	const dependencies: NodeProcessRunnerDependencies = {
		spawn: () => child,
		setTimeout(callback, delayMs) {
			const timer = { callback, delayMs, cleared: false };
			timers.push(timer);
			return timer;
		},
		clearTimeout(timer) {
			timer.cleared = true;
			clearedTimers.push(timer);
		},
	};
	const runner = createNodeProcessRunner(dependencies);

	const outcome = runner.run(invocation(), {
		signal: signal as unknown as AbortSignal,
		onStdoutLine() {},
	});
	await Promise.resolve();
	const taskStdin = ["Task: inspect"];
	expect(child.stdinWrites).toEqual(taskStdin);
	expect(signal.listenerCount).toBe(1);

	signal.abort();
	expect(child.stdin.writableEnded).toBe(true);
	expect(child.stdinWrites).toEqual(taskStdin);
	expect(child.killSignals).toEqual(["SIGTERM"]);
	expect(timers).toEqual([expect.objectContaining({ delayMs: 5_000, cleared: false })]);

	timers[0].callback();
	expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"]);

	child.emitClose(null);
	expect(await outcome).toEqual({ exitCode: 1, stderr: "", aborted: true });
	expect(clearedTimers).toEqual([timers[0]]);
	expect(timers[0].cleared).toBe(true);
	expect(signal.listenerCount).toBe(0);

	signal.abort();
	expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
});
