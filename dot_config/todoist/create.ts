import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createTodoist, runTd } from "./client";
import { TaskForm } from "./model";
import { mountForm, type CancelForm } from "./ui";

async function main(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("todoist-add needs an interactive terminal; run it from a TTY.");
    process.exitCode = 1;
    return;
  }

  let renderer: CliRenderer | undefined;
  let cleanup: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  let finished = false;
  let complete!: (result: { id?: string; error?: unknown }) => void;
  const completion = new Promise<{ id?: string; error?: unknown }>(resolve => { complete = resolve; });
  const finish = (result: { id?: string; error?: unknown } = {}) => {
    if (finished) return;
    finished = true;
    let error = result.error;
    try {
      unsubscribe?.();
      cleanup?.();
    } catch (failure) {
      error ??= failure;
    } finally {
      try { renderer?.destroy(); } catch (failure) { error ??= failure; }
      complete({ ...result, error });
    }
  };
  const cancel: CancelForm = () => finish();

  try {
    // Ctrl+C is handled at the key boundary, not by OpenTUI's process exit handler.
    renderer = await createCliRenderer({ exitOnCtrlC: false, exitSignals: [] });
    const form = new TaskForm(createTodoist(runTd));
    unsubscribe = form.subscribe(state => {
      if (state.phase === "created" && state.createdId !== null) finish({ id: state.createdId });
    });
    renderer.on("render:error", (error: unknown) => finish({ error }));
    renderer.on("handler:error", (error: unknown) => finish({ error }));
    cleanup = mountForm(renderer, form, cancel);
    if (!finished) void form.load().catch(error => finish({ error }));
    const result = await completion;
    if (result.error !== undefined) throw result.error;
    if (result.id !== undefined) console.log(result.id);
  } catch (error) {
    if (!finished) finish({ error });
    console.error("todoist-add failed:", error);
    process.exitCode = 1;
  }
}

await main();
