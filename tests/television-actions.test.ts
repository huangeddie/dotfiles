import { expect, test } from "bun:test";
import { completeTask, undoCompletion, type CompletionStore } from "../dot_config/television/actions";
import type { Run } from "../dot_config/television/todoist";

class MemoryStore implements CompletionStore {
  constructor(public taskId: string | null = null) {}
  async load() { return this.taskId; }
  async save(taskId: string | null) { this.taskId = taskId; }
}

function fakeTd() {
  const tasks = new Map([
    ["one", { id: "one", checked: false, isUncompletable: false, due: null }],
    ["two", { id: "two", checked: false, isUncompletable: false, due: null }],
    ["recurring", { id: "recurring", checked: false, isUncompletable: false,
      due: { date: "2026-06-14", isRecurring: true } }],
    ["reference", { id: "reference", checked: false, isUncompletable: true, due: null }],
  ]);
  const calls: string[][] = [];
  const failures = new Set<string>();
  const run: Run = async args => {
    calls.push(args);
    const [flag, entity, action, ref, ...options] = args;
    if (flag !== "--no-spinner" || entity !== "task" || !ref?.startsWith("id:")) {
      throw new Error(`Unexpected arguments: ${JSON.stringify(args)}`);
    }
    if (failures.has(action)) throw new Error("td unavailable");
    const task = tasks.get(ref.slice(3));
    if (!task) throw new Error("Task not found");
    if (action === "view" && JSON.stringify(options) === '["--json","--full"]') {
      return JSON.stringify(task);
    }
    if (options.length) throw new Error("Unexpected options");
    if (action === "complete") {
      if (!task.checked && !task.isUncompletable) {
        if (task.due?.isRecurring) task.due.date = "2026-06-15";
        else task.checked = true;
      }
    } else if (action === "uncomplete") {
      task.checked = false; // Native td is a no-op for an already-active recurring task.
    } else throw new Error(`Unexpected action: ${action}`);
    return "";
  };
  return { run, tasks, calls, failures };
}

test.failing("completion remembers the task only after Todoist succeeds", async () => {
  const td = fakeTd();
  const store = new MemoryStore();
  const run: Run = async args => {
    expect(store.taskId).toBeNull();
    return td.run(args);
  };
  await completeTask("one", run, store);
  expect(td.tasks.get("one")!.checked).toBe(true);
  expect(store.taskId).toBe("one");
});

test.failing("undo reopens only the latest completion and consumes the undo slot", async () => {
  const td = fakeTd();
  const store = new MemoryStore();
  await completeTask("one", td.run, store);
  await completeTask("two", td.run, store);
  await undoCompletion(td.run, store);
  expect(td.tasks.get("one")!.checked).toBe(true);
  expect(td.tasks.get("two")!.checked).toBe(false);
  expect(store.taskId).toBeNull();
  const count = td.calls.length;
  await undoCompletion(td.run, store);
  expect(td.calls).toHaveLength(count);
});

test.failing("undo with no saved completion does not call Todoist", async () => {
  const td = fakeTd();
  await undoCompletion(td.run, new MemoryStore());
  expect(td.calls).toEqual([]);
});

test.failing("failed completion preserves the previous undo slot", async () => {
  const td = fakeTd();
  const store = new MemoryStore("one");
  td.failures.add("complete");
  await expect(completeTask("two", td.run, store)).rejects.toThrow("td unavailable");
  expect(store.taskId).toBe("one");
  expect(td.tasks.get("two")!.checked).toBe(false);
});

test.failing("failed undo retains the saved task for retry", async () => {
  const td = fakeTd();
  const store = new MemoryStore("one");
  td.tasks.get("one")!.checked = true;
  td.failures.add("uncomplete");
  await expect(undoCompletion(td.run, store)).rejects.toThrow("td unavailable");
  expect(store.taskId).toBe("one");
  td.failures.clear();
  await undoCompletion(td.run, store);
  expect(td.tasks.get("one")!.checked).toBe(false);
  expect(store.taskId).toBeNull();
});

test.failing("recurring completion advances the date and native undo leaves it advanced", async () => {
  const td = fakeTd();
  const store = new MemoryStore();
  await completeTask("recurring", td.run, store);
  await undoCompletion(td.run, store);
  expect(td.tasks.get("recurring")!.due!.date).toBe("2026-06-15");
  expect(td.tasks.get("recurring")!.checked).toBe(false);
  expect(td.calls.at(-1)).toEqual(["--no-spinner", "task", "uncomplete", "id:recurring"]);
  expect(store.taskId).toBeNull();
});

test.failing("already-completed and uncompletable tasks cannot replace the undo slot", async () => {
  const td = fakeTd();
  td.tasks.get("one")!.checked = true;
  const store = new MemoryStore("two");
  for (const id of ["one", "reference"]) {
    await expect(completeTask(id, td.run, store)).rejects.toThrow("cannot be completed");
    expect(store.taskId).toBe("two");
  }
  expect(td.calls.every(args => args[2] === "view")).toBe(true);
});

test.failing("invalid or multiple selected task IDs are rejected before calling Todoist", async () => {
  const td = fakeTd();
  const store = new MemoryStore("one");
  for (const id of ["", "one two", "one\ntwo", "x'; touch /tmp/no", "id:one"]) {
    await expect(completeTask(id, td.run, store)).rejects.toThrow("task ID");
  }
  expect(td.calls).toEqual([]);
  expect(store.taskId).toBe("one");
});

test.failing("corrupt undo state fails without calling Todoist or discarding the state", async () => {
  const td = fakeTd();
  const store = new MemoryStore("one two");
  await expect(undoCompletion(td.run, store)).rejects.toThrow("task ID");
  expect(td.calls).toEqual([]);
  expect(store.taskId).toBe("one two");
});

test.failing("failed or malformed task lookup cannot trigger completion", async () => {
  const store = new MemoryStore("one");
  for (const output of ['{}', 'null', '{"id":"two"}', '{"id":"other","checked":false,"isUncompletable":false}']) {
    const calls: string[][] = [];
    const run: Run = async args => { calls.push(args); return output; };
    await expect(completeTask("two", run, store)).rejects.toThrow("Invalid task details");
    expect(calls).toHaveLength(1);
    expect(store.taskId).toBe("one");
  }
  const td = fakeTd();
  td.failures.add("view");
  await expect(completeTask("two", td.run, store)).rejects.toThrow("td unavailable");
  expect(td.calls).toHaveLength(1);
});
