import { readSync } from "node:fs";
import { mkdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { runTd, type Run } from "./todoist";

export interface CompletionStore {
  load(): Promise<string | null>;
  save(taskId: string | null): Promise<void>;
}

function validateId(taskId: unknown): asserts taskId is string {
  if (typeof taskId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(taskId)) {
    throw new Error("Invalid task ID: select exactly one task");
  }
}

export async function completeTask(taskId: string, run: Run, store: CompletionStore): Promise<void> {
  validateId(taskId);
  const task = JSON.parse(await run(["--no-spinner", "task", "view", `id:${taskId}`, "--json", "--full"]));
  if (!task || task.id !== taskId || typeof task.checked !== "boolean" || typeof task.isUncompletable !== "boolean") {
    throw new Error("Invalid task details from td");
  }
  // td returns success for these no-ops; do not overwrite a genuine completion.
  if (task.checked || task.isUncompletable) throw new Error("This task cannot be completed");
  await run(["--no-spinner", "task", "complete", `id:${taskId}`]);
  await store.save(taskId);
}

export async function undoCompletion(run: Run, store: CompletionStore): Promise<void> {
  const taskId = await store.load();
  if (taskId === null) return;
  validateId(taskId);
  // Intentionally use native semantics: recurring tasks keep their advanced due date.
  await run(["--no-spinner", "task", "uncomplete", `id:${taskId}`]);
  await store.save(null);
}

if (import.meta.main) {
  try {
    const [action, taskId, ...extra] = Bun.argv.slice(2);
    if (extra.length || (action !== "complete" && action !== "undo") || (action === "undo" && taskId !== undefined)) {
      throw new Error("Usage: bun actions.ts complete TASK_ID | undo");
    }
    if (action === "complete") validateId(taskId);
    const directory = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "television/todoist");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lock = join(directory, "lock");
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Another Todoist action is running (lock: ${lock})`);
      }
      throw error;
    }
    try {
      const path = join(directory, "completion.json");
      const store: CompletionStore = {
        async load() {
          try {
            return JSON.parse(await readFile(path, "utf8"));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          }
        },
        async save(id) {
          await writeFile(`${path}.tmp`, JSON.stringify(id) + "\n", { mode: 0o600 });
          await rename(`${path}.tmp`, path);
        },
      };
      if (action === "complete") await completeTask(taskId!, runTd, store);
      else await undoCompletion(runTd, store);
    } finally {
      await rmdir(lock);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    // Keep forked-action errors visible until acknowledged, before tv redraws.
    if (process.stdin.isTTY) {
      console.error("Press Enter to return.");
      readSync(0, new Uint8Array(1), 0, 1, null);
    }
    process.exitCode = 1;
  }
}
