import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const OUTPUT_IDLE_CUTOFF_MS = 750;
const RENDER_INTERVAL_MS = 200;
const STATUS_KEY = "runtime";

export type TokenAccumulation = {
  tokens: number;
  activeMillis: number;
};

export type OutputBurst = TokenAccumulation & {
  startedAt: number;
  lastOutputAt: number;
};

export type TimeDistribution = {
  generatingMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
  messageStartedAt: number | null;
  currentToolWaitStartedAt: number | null;
  messageStartedGeneratingMillis: number;
  messageStartedToolWaitMillis: number;
};

export type RuntimeStatusState = {
  sessionAccumulation: TokenAccumulation;
  currentBurst: OutputBurst | null;
  lastBurstAccumulation: TokenAccumulation | null;
  currentMessageEstimate: TokenAccumulation;
  timeDistribution: TimeDistribution;
  active: boolean;
};

type AssistantDelta = {
  type: string;
  delta?: string;
};

type Theme = {
  fg(name: string, text: string): string;
};

export function createRuntimeStatusState(): RuntimeStatusState {
  return {
    sessionAccumulation: { tokens: 0, activeMillis: 0 },
    currentBurst: null,
    lastBurstAccumulation: null,
    currentMessageEstimate: { tokens: 0, activeMillis: 0 },
    timeDistribution: {
      generatingMillis: 0,
      toolWaitMillis: 0,
      idleMillis: 0,
      messageStartedAt: null,
      currentToolWaitStartedAt: null,
      messageStartedGeneratingMillis: 0,
      messageStartedToolWaitMillis: 0,
    },
    active: false,
  };
}

export function resetSession(state: RuntimeStatusState): void {
  state.sessionAccumulation = { tokens: 0, activeMillis: 0 };
  state.currentBurst = null;
  state.lastBurstAccumulation = null;
  state.currentMessageEstimate = { tokens: 0, activeMillis: 0 };
  state.timeDistribution = {
    generatingMillis: 0,
    toolWaitMillis: 0,
    idleMillis: 0,
    messageStartedAt: null,
    currentToolWaitStartedAt: null,
    messageStartedGeneratingMillis: 0,
    messageStartedToolWaitMillis: 0,
  };
  state.active = false;
}

export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 4));
}

export function isOutputDelta(event: AssistantDelta): event is AssistantDelta & { delta: string } {
  return (event.type === "text_delta" || event.type === "thinking_delta") && typeof event.delta === "string";
}

function addActiveMillis(state: RuntimeStatusState, millis: number): void {
  if (!state.currentBurst || millis <= 0) {
    return;
  }
  state.currentBurst.activeMillis += millis;
  state.sessionAccumulation.activeMillis += millis;
  state.currentMessageEstimate.activeMillis += millis;
  state.timeDistribution.generatingMillis += millis;
}

function closeCurrentBurst(state: RuntimeStatusState): void {
  if (!state.currentBurst) {
    return;
  }
  state.lastBurstAccumulation = {
    tokens: state.currentBurst.tokens,
    activeMillis: state.currentBurst.activeMillis,
  };
  state.currentBurst = null;
}

export function closeStaleBurst(
  state: RuntimeStatusState,
  now: number,
  idleCutoffMs = OUTPUT_IDLE_CUTOFF_MS,
): void {
  if (!state.currentBurst) {
    return;
  }
  if (now - state.currentBurst.lastOutputAt >= idleCutoffMs) {
    closeCurrentBurst(state);
  }
}

export function recordAssistantMessageStart(state: RuntimeStatusState, now: number): void {
  state.active = true;
  state.currentMessageEstimate = { tokens: 0, activeMillis: 0 };
  state.currentBurst = null;
  state.timeDistribution.messageStartedAt = now;
  state.timeDistribution.currentToolWaitStartedAt = null;
  state.timeDistribution.messageStartedGeneratingMillis = state.timeDistribution.generatingMillis;
  state.timeDistribution.messageStartedToolWaitMillis = state.timeDistribution.toolWaitMillis;
}

export function recordAssistantDelta(state: RuntimeStatusState, event: AssistantDelta, now: number): void {
  if (event.type === "toolcall_start" || event.type === "toolcall_delta" || event.type === "toolcall_end") {
    closeCurrentBurst(state);
    return;
  }

  if (!isOutputDelta(event)) {
    return;
  }

  const tokens = estimateTokens(event.delta);
  if (tokens === 0) {
    return;
  }

  state.active = true;

  if (!state.currentBurst) {
    state.currentBurst = {
      tokens: 0,
      activeMillis: 0,
      startedAt: now,
      lastOutputAt: now,
    };
  } else {
    const gap = now - state.currentBurst.lastOutputAt;
    if (gap >= OUTPUT_IDLE_CUTOFF_MS) {
      closeCurrentBurst(state);
      state.currentBurst = {
        tokens: 0,
        activeMillis: 0,
        startedAt: now,
        lastOutputAt: now,
      };
    } else {
      addActiveMillis(state, gap);
      state.currentBurst.lastOutputAt = now;
    }
  }

  state.currentBurst.tokens += tokens;
  state.sessionAccumulation.tokens += tokens;
  state.currentMessageEstimate.tokens += tokens;
}

export function recordToolExecutionStart(state: RuntimeStatusState, now: number): void {
  if (!state.active || state.timeDistribution.messageStartedAt === null) {
    return;
  }
  if (state.timeDistribution.currentToolWaitStartedAt !== null) {
    return;
  }
  closeCurrentBurst(state);
  state.timeDistribution.currentToolWaitStartedAt = now;
}

export function recordToolExecutionEnd(state: RuntimeStatusState, now: number): void {
  const startedAt = state.timeDistribution.currentToolWaitStartedAt;
  if (startedAt === null) {
    return;
  }
  state.timeDistribution.toolWaitMillis += Math.max(0, now - startedAt);
  state.timeDistribution.currentToolWaitStartedAt = null;
}

function currentToolWaitMillis(state: RuntimeStatusState, now: number): number {
  const startedAt = state.timeDistribution.currentToolWaitStartedAt;
  if (startedAt === null) {
    return 0;
  }
  return Math.max(0, now - startedAt);
}

export function finalizeAssistantMessageTime(state: RuntimeStatusState, now: number): void {
  const messageStartedAt = state.timeDistribution.messageStartedAt;
  if (messageStartedAt === null) {
    return;
  }

  recordToolExecutionEnd(state, now);

  const observedMillis = Math.max(0, now - messageStartedAt);
  const messageGeneratingMillis =
    state.timeDistribution.generatingMillis - state.timeDistribution.messageStartedGeneratingMillis;
  const messageToolWaitMillis =
    state.timeDistribution.toolWaitMillis - state.timeDistribution.messageStartedToolWaitMillis;

  state.timeDistribution.idleMillis += Math.max(0, observedMillis - messageGeneratingMillis - messageToolWaitMillis);
  state.timeDistribution.messageStartedAt = null;
  state.timeDistribution.currentToolWaitStartedAt = null;
  state.timeDistribution.messageStartedGeneratingMillis = state.timeDistribution.generatingMillis;
  state.timeDistribution.messageStartedToolWaitMillis = state.timeDistribution.toolWaitMillis;
}

export function handleAssistantMessageEnd(
  state: RuntimeStatusState,
  now: number,
  outputUsage: number | undefined,
): void {
  if (state.currentBurst) {
    const gap = now - state.currentBurst.lastOutputAt;
    if (gap > 0 && gap < OUTPUT_IDLE_CUTOFF_MS) {
      addActiveMillis(state, gap);
      state.currentBurst.lastOutputAt = now;
    }
    closeCurrentBurst(state);
  }

  if (outputUsage !== undefined) {
    state.sessionAccumulation.tokens += outputUsage - state.currentMessageEstimate.tokens;
  }

  finalizeAssistantMessageTime(state, now);
  state.currentMessageEstimate = { tokens: 0, activeMillis: 0 };
  state.active = false;
}

export function rate(accumulation: TokenAccumulation | null): number {
  if (!accumulation || accumulation.tokens <= 0 || accumulation.activeMillis <= 0) {
    return 0;
  }
  return accumulation.tokens / (accumulation.activeMillis / 1000);
}

export function distributionSnapshot(state: RuntimeStatusState, now: number): TimeDistribution {
  const snapshot: TimeDistribution = {
    ...state.timeDistribution,
    toolWaitMillis: state.timeDistribution.toolWaitMillis + currentToolWaitMillis(state, now),
  };
  const messageStartedAt = state.timeDistribution.messageStartedAt;
  if (messageStartedAt !== null) {
    const observedMillis = Math.max(0, now - messageStartedAt);
    const messageGeneratingMillis =
      snapshot.generatingMillis - state.timeDistribution.messageStartedGeneratingMillis;
    const messageToolWaitMillis = snapshot.toolWaitMillis - state.timeDistribution.messageStartedToolWaitMillis;
    const currentIdleMillis = Math.max(0, observedMillis - messageGeneratingMillis - messageToolWaitMillis);
    snapshot.idleMillis = state.timeDistribution.idleMillis + currentIdleMillis;
  }
  return snapshot;
}

function formatSeconds(millis: number): string {
  return `${(millis / 1000).toFixed(1)}s`;
}

function formatPercent(millis: number, totalMillis: number): string {
  if (millis <= 0 || totalMillis <= 0) {
    return "0%";
  }
  return `${Math.round((millis / totalMillis) * 100)}%`;
}

export function formatStatus(state: RuntimeStatusState, streaming: boolean, now = Date.now()): string {
  const tps = rate(state.sessionAccumulation).toFixed(1);
  const distribution = distributionSnapshot(state, now);
  const totalMillis =
    distribution.generatingMillis + distribution.toolWaitMillis + distribution.idleMillis;
  const icon = streaming ? "●" : "✓";
  return [
    `${icon} ${tps} t/s`,
    `gen ${formatSeconds(distribution.generatingMillis)} ${formatPercent(distribution.generatingMillis, totalMillis)}`,
    `tools ${formatSeconds(distribution.toolWaitMillis)} ${formatPercent(distribution.toolWaitMillis, totalMillis)}`,
    `idle ${formatSeconds(distribution.idleMillis)} ${formatPercent(distribution.idleMillis, totalMillis)}`,
  ].join(" | ");
}

function renderStatus(state: RuntimeStatusState, theme: Theme, streaming: boolean): string {
  const status = formatStatus(state, streaming);
  const [icon, ...rest] = status.split(" ");
  const iconColor = streaming ? "accent" : "success";
  return theme.fg(iconColor, icon) + theme.fg("dim", ` ${rest.join(" ")}`);
}

export default function (pi: ExtensionAPI) {
  const state = createRuntimeStatusState();
  let interval: ReturnType<typeof setInterval> | null = null;

  function stopInterval() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  function setStatus(ctx: ExtensionContext, streaming: boolean) {
    if (!ctx.hasUI) {
      return;
    }
    ctx.ui.setStatus(STATUS_KEY, renderStatus(state, ctx.ui.theme, streaming));
  }

  function startInterval(ctx: ExtensionContext) {
    stopInterval();
    interval = setInterval(() => {
      closeStaleBurst(state, Date.now());
      setStatus(ctx, state.active);
    }, RENDER_INTERVAL_MS);
  }

  pi.on("session_start", async (_event, ctx) => {
    resetSession(state);
    stopInterval();
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  });

  pi.on("message_start", async (event, ctx) => {
    if (event.message.role !== "assistant") {
      return;
    }
    recordAssistantMessageStart(state, Date.now());
    startInterval(ctx);
  });

  pi.on("message_update", async (event, ctx) => {
    recordAssistantDelta(state, event.assistantMessageEvent, Date.now());
    if (isOutputDelta(event.assistantMessageEvent)) {
      setStatus(ctx, true);
    }
  });

  pi.on("tool_execution_start", async (_event, ctx) => {
    recordToolExecutionStart(state, Date.now());
    setStatus(ctx, state.active);
  });

  pi.on("tool_execution_end", async (_event, ctx) => {
    recordToolExecutionEnd(state, Date.now());
    setStatus(ctx, state.active);
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") {
      return;
    }
    stopInterval();
    handleAssistantMessageEnd(state, Date.now(), event.message.usage?.output);
    setStatus(ctx, false);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopInterval();
    handleAssistantMessageEnd(state, Date.now(), undefined);
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  });
}
