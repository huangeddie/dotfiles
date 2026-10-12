import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { CliRenderer, CliRendererErrorEvent, CliRendererHandlerErrorEvent } from "@opentui/core";
import { displayPath, parseArgs } from "./model";
import { scan, type ProcessRunner } from "./scanner";

const HELP = `Usage: grain [directory] [--exclude GLOB] [--exclude-tests] [--language NAME]

Scan source files once; default directory is the current working directory.
  --exclude GLOB   Exclude root-relative paths (repeatable, Bun.Glob syntax)
  --exclude-tests  Exclude common test and QA paths (included by default)
  --language NAME  Replace the source allowlist with scc names (repeatable)
  --help           Show help without scanning or opening the terminal UI
  --               End options, for example: grain -- -source

Keys: arrows/j/k rows, s sort, / literal path query, Enter return to rows,
      Escape clear query, q quit outside query, Ctrl+C quit everywhere.
      PageUp/PageDown scroll the screen on short terminals.
Requires Bun >=1.3.0, scc, and an interactive stdin/stdout terminal.
Example: grain . --exclude 'dot_config/nvim/**'`;

async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  if (options.help) { console.log(HELP); return; }
  const root = resolve(options.directory);
  try {
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
  } catch (cause) {
    throw new Error(`Cannot scan directory ${displayPath(root)}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("grain needs an interactive terminal on both stdin and stdout; run it from a TTY.");
  }
  if (!Bun.which("scc")) throw new Error("grain requires scc on PATH; install scc before scanning.");

  let activeProcess: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
  let renderer: CliRenderer | undefined;
  let cleanup: (() => void) | undefined;
  let finished = false;
  let failure: unknown;
  let complete!: () => void;
  const completion = new Promise<void>(resolve => { complete = resolve; });
  const finish = (error?: unknown) => {
    if (finished) return;
    finished = true;
    failure = error;
    // scc has no work to preserve. Kill immediately so cancellation cannot hang on a child.
    activeProcess?.kill("SIGKILL");
    complete();
  };
  const interrupt = () => { process.exitCode = 130; finish(); };
  const terminate = () => { process.exitCode = 143; finish(); };
  const onFailure = (error: unknown) => finish(error);
  const onRenderError = (event: CliRendererErrorEvent | CliRendererHandlerErrorEvent) => finish(event.error);
  const onDestroy = () => finish();
  const runner: ProcessRunner = {
    async run(request) {
      const child = Bun.spawn([...request.argv], { cwd: request.cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      activeProcess = child;
      try {
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
        ]);
        return { exitCode, stdout, stderr };
      } finally {
        child.kill();
        await child.exited;
        if (activeProcess === child) activeProcess = undefined;
      }
    },
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  process.on("uncaughtException", onFailure);
  process.on("unhandledRejection", onFailure);
  try {
    console.error("grain: scanning…");
    const files = await scan(root, options, runner);
    if (!finished) {
      const [{ createCliRenderer }, { mountDashboard }] = await Promise.all([import("@opentui/core"), import("./ui")]);
      if (!finished) {
        renderer = await createCliRenderer({ exitOnCtrlC: false, exitSignals: [], consoleMode: "disabled" });
        if (!finished) {
          renderer.on("render:error", onRenderError);
          renderer.on("handler:error", onRenderError);
          renderer.on("destroy", onDestroy);
          cleanup = mountDashboard(renderer, files, () => finish());
          await completion;
        }
      }
    }
  } catch (error) {
    if (!finished) finish(error);
  } finally {
    try { cleanup?.(); } catch (error) { failure ??= error; }
    try {
      renderer?.off("render:error", onRenderError);
      renderer?.off("handler:error", onRenderError);
      renderer?.off("destroy", onDestroy);
      renderer?.destroy();
    } catch (error) { failure ??= error; }
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    process.off("uncaughtException", onFailure);
    process.off("unhandledRejection", onFailure);
  }
  if (failure !== undefined) throw failure;
}

try { await main(); } catch (error) {
  console.error(`grain failed: ${displayPath(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
}
