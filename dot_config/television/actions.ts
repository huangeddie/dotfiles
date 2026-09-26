import type { Run } from "./todoist";

export interface CompletionStore {
  load(): Promise<string | null>;
  save(taskId: string | null): Promise<void>;
}

export async function completeTask(taskId: string, run: Run, store: CompletionStore): Promise<void> {
  throw new Error("Not implemented");
}

export async function undoCompletion(run: Run, store: CompletionStore): Promise<void> {
  throw new Error("Not implemented");
}
