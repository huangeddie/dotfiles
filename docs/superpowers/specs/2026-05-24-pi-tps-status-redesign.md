# Pi TPS Status Redesign

## Goal

Redesign `dot_pi/agent/exact_extensions/tps-status.ts` so it reports model
throughput rather than stream-event throughput.

The extension should show:

- historical session TPS since the current Pi session started
- last completed output burst TPS

Both metrics should count only periods when the assistant is actually producing
output tokens. Tool execution time, tool-call argument streaming, and silent
provider gaps should not dilute the rate.

## Contracts

The core state should use explicit accumulation names:

```ts
type TokenAccumulation = {
  tokens: number;
  activeMillis: number;
};

type OutputBurst = TokenAccumulation & {
  startedAt: number;
  lastOutputAt: number;
};

type TpsState = {
  sessionAccumulation: TokenAccumulation;
  currentBurst: OutputBurst | null;
  lastBurstAccumulation: TokenAccumulation | null;
  currentMessageEstimate: TokenAccumulation;
  active: boolean;
};
```

`TokenAccumulation` stores the numerator and denominator used to derive TPS:

```ts
tokens / (activeMillis / 1000)
```

`sessionAccumulation` is cumulative from `session_start`.
`currentBurst` is the currently open continuous output window.
`lastBurstAccumulation` is the most recently closed burst.
`currentMessageEstimate` supports reconciling final assistant usage after
`message_end`.

## Event Boundary

Only assistant stream events with user-visible or thinking output count:

- `assistantMessageEvent.type === "text_delta"`
- `assistantMessageEvent.type === "thinking_delta"`

All other message update events are ignored for token and time accumulation:

- `start`
- `text_start`
- `text_end`
- `thinking_start`
- `thinking_end`
- `toolcall_start`
- `toolcall_delta`
- `toolcall_end`
- `done`
- `error`

Tool lifecycle events are also ignored:

- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`

The extension should ignore non-assistant `message_start` and `message_end`
events before mutating active TPS state.

## Token Estimation

Live output should use a lightweight heuristic:

```ts
function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 4));
}
```

This is intentionally approximate. The status line needs a responsive live
estimate without provider-specific tokenizer dependencies.

At assistant `message_end`, if `event.message.usage.output` is present, use it
to correct `sessionAccumulation.tokens` for the completed assistant message:

```ts
const correction = event.message.usage.output - currentMessageEstimate.tokens;
sessionAccumulation.tokens += correction;
```

Do not rewrite `lastBurstAccumulation` with final usage. Provider output usage
can include tool-call JSON or hidden reasoning that this extension intentionally
does not count as an output burst.

## Timing

The denominator is active output time, not wall-clock assistant message time.

An output burst opens on the first `text_delta` or `thinking_delta`. Additional
output deltas extend the burst. If no output arrives for an idle cutoff, close
the current burst at the timestamp of the last output delta.

Recommended cutoff:

```ts
const OUTPUT_IDLE_CUTOFF_MS = 750;
```

A short periodic timer can close stale bursts and re-render status. The timer
must be cleaned up on `message_end` and `session_shutdown`.

## UI

Use Pi's status API rather than replacing the footer:

```ts
ctx.ui.setStatus("tps", statusText);
```

This composes with the built-in footer and other extensions.

The extension should check `ctx.hasUI` before setting status. In non-interactive
modes, it should still update internal state but skip UI writes.

Suggested streaming display:

```text
● hist 38.7 t/s | burst 72.4 t/s
```

Suggested idle display:

```text
✓ hist 39.2 t/s | last 68.1 t/s
```

## Lifecycle

- `session_start`: reset all accumulations and clear status.
- assistant `message_start`: mark active for the current assistant message and
  reset `currentMessageEstimate`.
- assistant `message_update`: accumulate only `text_delta` and
  `thinking_delta`.
- assistant `message_end`: close any open burst, apply final usage correction
  to session tokens when available, render final status, and mark inactive.
- `session_shutdown`: close bursts, clear timers, clear status when UI is
  available.

The extension should import types from `@earendil-works/pi-coding-agent`.

## Unit Tests

The implementation should isolate pure stats helpers so tests do not need a Pi
runtime.

Required tests:

- `text_delta` increments current message, current burst, and session tokens.
- `thinking_delta` increments current message, current burst, and session
  tokens.
- `toolcall_delta` does not increment tokens or active time.
- idle gaps beyond `OUTPUT_IDLE_CUTOFF_MS` close the current burst and do not
  count toward active time.
- assistant `message_end` applies `usage.output` correction with nullish
  semantics, preserving valid zero usage.
- non-assistant `message_end` does not stop or mutate assistant tracking.
- `session_start` resets historical state.
- `session_shutdown` clears timers and active burst state.

## File Layout

Keep the extension as a single TypeScript file. Export pure stats helpers from
that file so unit tests can exercise the contract without a Pi runtime.
