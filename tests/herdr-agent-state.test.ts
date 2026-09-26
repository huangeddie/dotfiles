import { expect, test } from "bun:test";
import {
  registerStateHandlers,
  type StateReporter,
} from "../dot_pi/private_agent/exact_extensions/herdr-agent-state";

type Handler = (...args: any[]) => unknown;

function createEventBus() {
  const handlers = new Map<string, Handler[]>();
  return {
    on(event: string, handler: Handler) {
      const entries = handlers.get(event) ?? [];
      entries.push(handler);
      handlers.set(event, entries);
    },
    async emit(event: string, data: unknown, context?: unknown) {
      for (const handler of handlers.get(event) ?? []) await handler(data, context);
    },
  };
}

class RecordingReporter implements StateReporter {
  reports: { state: string; message?: string }[] = [];
  updateSessionRef() {}
  async reportSession() {}
  queueState(state: "working" | "blocked" | "idle", message?: string) {
    this.reports.push({ state, message });
  }
  get state() {
    return this.reports.at(-1)?.state;
  }
}

async function createHarness(
  mode = "tui",
  idle = true,
  restoredSignals: ["busy" | "blocked", boolean][] = [],
) {
  const events = createEventBus();
  const lifecycle = createEventBus();
  const reporter = new RecordingReporter();
  const context = { mode, hasUI: mode === "tui" || mode === "rpc", isIdle: () => idle };
  // Package session_start handlers may run before the auto-discovered integration.
  lifecycle.on("session_start", async () => {
    for (const [kind, active] of restoredSignals) {
      await events.emit(`herdr:${kind}`, { active, label: "restored work" });
    }
    expect(reporter.reports).toEqual([]);
  });
  registerStateHandlers({ events, on: lifecycle.on }, reporter);
  await lifecycle.emit("session_start", { reason: "reload" }, context);
  return {
    reporter,
    busy: (active: boolean, label = "background work") =>
      events.emit("herdr:busy", { active, label }),
    blocked: (active: boolean) =>
      events.emit("herdr:blocked", { active, label: "decision required" }),
    start: () => lifecycle.emit("agent_start", {}, context),
    settle: () => lifecycle.emit("agent_settled", {}, context),
  };
}

test("parent settling with background work stays working until the last busy release", async () => {
  const h = await createHarness();
  await h.start();
  await h.busy(true);
  await h.settle();
  expect(h.reporter.state).toBe("working");
  await h.busy(false);
  expect(h.reporter.state).toBe("idle");
});

test("overlapping busy claims remain working after only one release", async () => {
  const h = await createHarness();
  await h.busy(true, "first");
  await h.busy(true, "second");
  await h.busy(false);
  expect(h.reporter.state).toBe("working");
  await h.busy(false);
  expect(h.reporter.state).toBe("idle");
});

test("attention overrides background work and clearing attention restores working", async () => {
  const h = await createHarness();
  await h.busy(true);
  await h.blocked(true);
  expect(h.reporter.reports.at(-1)).toEqual({ state: "blocked", message: "decision required" });
  await h.settle();
  expect(h.reporter.state).toBe("blocked");
  await h.blocked(false);
  expect(h.reporter.state).toBe("working");
  await h.busy(false);
  expect(h.reporter.state).toBe("idle");
});

test("releasing background work does not clear outstanding attention", async () => {
  const h = await createHarness();
  await h.busy(true);
  await h.blocked(true);
  await h.busy(false);
  expect(h.reporter.state).toBe("blocked");
  await h.blocked(false);
  expect(h.reporter.state).toBe("idle");
});

test("background completion keeps an active parent working until it settles", async () => {
  const h = await createHarness();
  await h.start();
  await h.busy(true);
  await h.busy(false);
  expect(h.reporter.state).toBe("working");
  await h.settle();
  expect(h.reporter.state).toBe("idle");
});

test("unmatched busy releases do not swallow the next busy claim", async () => {
  const h = await createHarness();
  await h.busy(false);
  await h.busy(false);
  expect(h.reporter.state).toBe("idle");
  await h.busy(true);
  expect(h.reporter.state).toBe("working");
  await h.busy(false);
  expect(h.reporter.state).toBe("idle");
});

test("background activity after parent settling changes idle to working", async () => {
  const h = await createHarness();
  await h.start();
  await h.settle();
  expect(h.reporter.state).toBe("idle");
  await h.busy(true);
  expect(h.reporter.state).toBe("working");
});

test("reload during an active parent starts working and ignores premature settling", async () => {
  const h = await createHarness("tui", false);
  expect(h.reporter.state).toBe("working");
  await h.settle();
  expect(h.reporter.state).toBe("working");
});

test.failing("reload retains busy claims restored before the integration session_start", async () => {
  const h = await createHarness("tui", true, [["busy", true]]);
  expect(h.reporter.state).toBe("working");
  await h.settle();
  expect(h.reporter.state).toBe("working");
  await h.busy(false);
  expect(h.reporter.state).toBe("idle");
});

test.failing("reload retains attention restored before the integration session_start", async () => {
  const h = await createHarness("tui", true, [["busy", true], ["blocked", true]]);
  expect(h.reporter.state).toBe("blocked");
  await h.blocked(false);
  expect(h.reporter.state).toBe("working");
  await h.busy(false);
  expect(h.reporter.state).toBe("idle");
});

test("busy work completed before session_start is not resurrected on reload", async () => {
  const h = await createHarness("tui", true, [["busy", true], ["busy", false]]);
  expect(h.reporter.state).toBe("idle");
  await h.busy(true);
  expect(h.reporter.state).toBe("working");
  await h.busy(false);
  expect(h.reporter.state).toBe("idle");
});

for (const mode of ["rpc", "json", "print"]) {
  test(`${mode} sessions never publish parent pane state`, async () => {
    const h = await createHarness(mode, true, [["busy", true], ["blocked", true]]);
    await h.busy(true);
    await h.blocked(true);
    await h.start();
    await h.settle();
    expect(h.reporter.reports).toEqual([]);
  });
}
