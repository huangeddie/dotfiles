import { afterEach, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { copyFile, realpath, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const socketPaths = new Set<string>();
const modulePaths = new Set<string>();
let harnessSequence = 0;

type Handler = (...args: any[]) => unknown;
type AgentState = "working" | "blocked" | "idle";

function createEventBus() {
  const handlers = new Map<string, Set<Handler>>();

  return {
    on(event: string, handler: Handler) {
      const eventHandlers = handlers.get(event) ?? new Set<Handler>();
      eventHandlers.add(handler);
      handlers.set(event, eventHandlers);
      return () => eventHandlers.delete(handler);
    },
    emit(event: string, data: unknown) {
      for (const handler of handlers.get(event) ?? []) handler(data);
    },
    async emitLifecycle(event: string, data: unknown, context: unknown) {
      await Promise.all(
        [...(handlers.get(event) ?? [])].map((handler) => handler(data, context)),
      );
    },
  };
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function waitForState(states: AgentState[], expected: AgentState): Promise<void> {
  const deadline = Date.now() + 500;
  while (states.at(-1) !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(states.at(-1)).toBe(expected);
}

async function createHarness() {
  const id = `${process.pid}-${harnessSequence++}`;
  const socketPath = `/tmp/herdr-state-${id}.sock`;
  const modulePath = `/tmp/herdr-agent-state-${id}.ts`;
  socketPaths.add(socketPath);
  modulePaths.add(modulePath);
  const states: AgentState[] = [];
  const server = createServer((socket) => {
    let input = "";
    socket.on("data", (chunk) => {
      input += chunk.toString("utf8");
      const newline = input.indexOf("\n");
      if (newline < 0) return;

      const request = JSON.parse(input.slice(0, newline));
      if (request.method === "pane.report_agent") {
        states.push(request.params.state as AgentState);
      }
      socket.end('{"result":{}}\n');
    });
  });
  await listen(server, socketPath);

  const previousEnvironment = {
    HERDR_ENV: process.env.HERDR_ENV,
    HERDR_SOCKET_PATH: process.env.HERDR_SOCKET_PATH,
    HERDR_PANE_ID: process.env.HERDR_PANE_ID,
  };
  process.env.HERDR_ENV = "1";
  process.env.HERDR_SOCKET_PATH = socketPath;
  process.env.HERDR_PANE_ID = "w-test:p1";

  const sourceModuleUrl = new URL(
    "../dot_pi/private_agent/exact_extensions/herdr-agent-state.ts",
    import.meta.url,
  );
  await copyFile(fileURLToPath(sourceModuleUrl), modulePath);
  const importedModulePath = await realpath(modulePath);
  const { default: registerHerdrAgentState } = await import(
    pathToFileURL(importedModulePath).href
  );

  const extensionEvents = createEventBus();
  const lifecycleEvents = createEventBus();
  registerHerdrAgentState({
    events: extensionEvents,
    on: lifecycleEvents.on,
  });

  const context = {
    mode: "tui",
    isIdle: () => true,
    sessionManager: {
      getSessionFile: () => "/tmp/pi-session.jsonl",
      getSessionId: () => "pi-session",
    },
  };

  await lifecycleEvents.emitLifecycle("session_start", { reason: "startup" }, context);
  await waitForState(states, "idle");

  return {
    states,
    events: extensionEvents,
    start: () => lifecycleEvents.emitLifecycle("agent_start", {}, context),
    settle: () => lifecycleEvents.emitLifecycle("agent_settled", {}, context),
    reportSubagentToolResult: (details: unknown) =>
      lifecycleEvents.emitLifecycle(
        "tool_result",
        { toolName: "subagent", details, isError: false },
        context,
      ),
    async dispose() {
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await close(server);
      await Promise.all([
        rm(socketPath, { force: true }),
        rm(modulePath, { force: true }),
      ]);
      socketPaths.delete(socketPath);
      modulePaths.delete(modulePath);
    },
  };
}

afterEach(async () => {
  await Promise.all(
    [...socketPaths, ...modulePaths].map((path) => rm(path, { force: true })),
  );
  socketPaths.clear();
  modulePaths.clear();
});

test.serial("reports blocked, then working, until all background activity settles", async () => {
  const harness = await createHarness();
  try {
    harness.events.emit("herdr:busy", { active: true, label: "first subagent" });
    await waitForState(harness.states, "working");

    harness.events.emit("herdr:busy", { active: true, label: "second subagent" });
    harness.events.emit("herdr:blocked", { active: true, label: "decision required" });
    await waitForState(harness.states, "blocked");

    harness.events.emit("herdr:blocked", { active: false });
    await waitForState(harness.states, "working");

    await harness.settle();
    harness.events.emit("herdr:busy", { active: false });
    expect(harness.states.at(-1)).toBe("working");

    harness.events.emit("herdr:busy", { active: false });
    await waitForState(harness.states, "idle");
    const transitions = harness.states.filter(
      (state, index) => state !== harness.states[index - 1],
    );
    expect(transitions).toEqual(["idle", "working", "blocked", "working", "idle"]);
  } finally {
    await harness.dispose();
  }
});

test.serial("keeps working until every matching async workflow completes", async () => {
  const harness = await createHarness();
  try {
    await harness.start();
    await waitForState(harness.states, "working");

    await harness.reportSubagentToolResult({
      mode: "workflow",
      asyncId: "first-workflow",
    });
    await harness.reportSubagentToolResult({
      mode: "workflow",
      asyncId: "second-workflow",
    });
    await harness.settle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.states.at(-1)).toBe("working");

    harness.events.emit("subagent:async-complete", { runId: "other-workflow" });
    harness.events.emit("subagent:async-complete", { runId: "first-workflow" });
    expect(harness.states.at(-1)).toBe("working");

    harness.events.emit("subagent:async-complete", { runId: "second-workflow" });
    await waitForState(harness.states, "idle");
  } finally {
    await harness.dispose();
  }
});

test.serial("does not resurrect a workflow whose completion arrives before its tool result", async () => {
  const harness = await createHarness();
  try {
    await harness.start();
    await waitForState(harness.states, "working");

    harness.events.emit("subagent:async-complete", { runId: "fast-workflow" });
    await harness.reportSubagentToolResult({
      mode: "workflow",
      asyncId: "fast-workflow",
    });
    await harness.settle();
    await waitForState(harness.states, "idle");
  } finally {
    await harness.dispose();
  }
});
