import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const OUTPUT_IDLE_CUTOFF_MS = 750;
const RENDER_INTERVAL_MS = 200;

export type TokenAccumulation = {
  tokens: number;
  activeMillis: number;
};

export type OutputBurst = TokenAccumulation & {
  startedAt: number;
  lastOutputAt: number;
};

export type TpsState = {
  sessionAccumulation: TokenAccumulation;
  currentBurst: OutputBurst | null;
  lastBurstAccumulation: TokenAccumulation | null;
  currentMessageEstimate: TokenAccumulation;
  active: boolean;
};

type AssistantDelta = {
  type: string;
  delta?: string;
};

type Theme = {
  fg(name: string, text: string): string;
};

export function createTpsState(): TpsState {
  return {
    sessionAccumulation: { tokens: 0, activeMillis: 0 },
    currentBurst: null,
    lastBurstAccumulation: null,
    currentMessageEstimate: { tokens: 0, activeMillis: 0 },
    active: false,
  };
}

export function resetSession(state: TpsState): void {
  state.sessionAccumulation = { tokens: 0, activeMillis: 0 };
  state.currentBurst = null;
  state.lastBurstAccumulation = null;
  state.currentMessageEstimate = { tokens: 0, activeMillis: 0 };
  state.active = false;
}

export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 4));
}

export function isOutputDelta(event: AssistantDelta): event is AssistantDelta & { delta: string } {
  return (event.type === "text_delta" || event.type === "thinking_delta") && typeof event.delta === "string";
}

function addActiveMillis(state: TpsState, millis: number): void {
  if (!state.currentBurst || millis <= 0) {
    return;
  }
  state.currentBurst.activeMillis += millis;
  state.sessionAccumulation.activeMillis += millis;
  state.currentMessageEstimate.activeMillis += millis;
}

function closeCurrentBurst(state: TpsState): void {
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
  state: TpsState,
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

export function recordAssistantDelta(state: TpsState, event: AssistantDelta, now: number): void {
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

export function handleAssistantMessageEnd(
  state: TpsState,
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

  state.currentMessageEstimate = { tokens: 0, activeMillis: 0 };
  state.active = false;
}

export function rate(accumulation: TokenAccumulation | null): number {
  if (!accumulation || accumulation.tokens <= 0 || accumulation.activeMillis <= 0) {
    return 0;
  }
  return accumulation.tokens / (accumulation.activeMillis / 1000);
}

export function formatStatus(state: TpsState, streaming: boolean): string {
  const hist = rate(state.sessionAccumulation).toFixed(1);
  const burstLabel = streaming && state.currentBurst ? "burst" : "last";
  const burstAccumulation = streaming && state.currentBurst ? state.currentBurst : state.lastBurstAccumulation;
  const burst = rate(burstAccumulation).toFixed(1);
  const icon = streaming ? "●" : "✓";
  return `${icon} hist ${hist} t/s | ${burstLabel} ${burst} t/s`;
}

function renderStatus(state: TpsState, theme: Theme, streaming: boolean): string {
  const status = formatStatus(state, streaming);
  const [icon, ...rest] = status.split(" ");
  const iconColor = streaming ? "accent" : "success";
  return theme.fg(iconColor, icon) + theme.fg("dim", ` ${rest.join(" ")}`);
}

export default function (pi: ExtensionAPI) {
  const state = createTpsState();
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
    ctx.ui.setStatus("tps", renderStatus(state, ctx.ui.theme, streaming));
  }

  function startInterval(ctx: ExtensionContext) {
    stopInterval();
    interval = setInterval(() => {
      closeStaleBurst(state, Date.now());
      setStatus(ctx, state.active && state.currentBurst !== null);
    }, RENDER_INTERVAL_MS);
  }

  pi.on("session_start", async (_event, ctx) => {
    resetSession(state);
    stopInterval();
    if (ctx.hasUI) {
      ctx.ui.setStatus("tps", undefined);
    }
  });

  pi.on("message_start", async (event, ctx) => {
    if (event.message.role !== "assistant") {
      return;
    }
    state.active = true;
    state.currentMessageEstimate = { tokens: 0, activeMillis: 0 };
    state.currentBurst = null;
    startInterval(ctx);
  });

  pi.on("message_update", async (event, ctx) => {
    recordAssistantDelta(state, event.assistantMessageEvent, Date.now());
    if (isOutputDelta(event.assistantMessageEvent)) {
      setStatus(ctx, true);
    }
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
      ctx.ui.setStatus("tps", undefined);
    }
  });
}
