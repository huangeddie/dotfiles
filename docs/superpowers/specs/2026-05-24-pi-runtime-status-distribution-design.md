# Pi Runtime Status Distribution

## Goal

Replace the TPS-only Pi extension with a runtime status extension that reports
both model throughput and observed assistant time distribution.

The extension should move from:

```text
dot_pi/agent/exact_extensions/tps-status.ts
ctx.ui.setStatus("tps", statusText)
```

to:

```text
dot_pi/agent/exact_extensions/runtime-status.ts
ctx.ui.setStatus("runtime", statusText)
```

The status should answer two questions:

- How fast is the assistant producing output tokens?
- Where is observed assistant wall time going across generation, explicit tool
  execution, and idle time?

## Contracts

Keep token throughput state explicit:

```ts
type TokenAccumulation = {
  tokens: number;
  activeMillis: number;
};

type OutputBurst = TokenAccumulation & {
  startedAt: number;
  lastOutputAt: number;
};
```

Add runtime timing as a first-class contract:

```ts
type TimeDistribution = {
  generatingMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
  messageStartedAt: number | null;
  currentToolWaitStartedAt: number | null;
};
```

The runtime state should combine both contracts:

```ts
type RuntimeStatusState = {
  sessionAccumulation: TokenAccumulation;
  currentBurst: OutputBurst | null;
  lastBurstAccumulation: TokenAccumulation | null;
  currentMessageEstimate: TokenAccumulation;
  timeDistribution: TimeDistribution;
  active: boolean;
};
```

`sessionAccumulation.activeMillis` remains the TPS denominator. It counts only
active output generation time.

`timeDistribution.generatingMillis` mirrors the active generation time used for
TPS. `toolWaitMillis` accumulates explicit tool execution duration.
`idleMillis` accumulates residual observed assistant wall time for completed
assistant messages:

```ts
observedAssistantMillis - generatingMillis - toolWaitMillis
```

Clamp residual idle time at zero so overlapping or unusual event ordering cannot
display negative time.

While an assistant message is active, derive a temporary display snapshot from
the committed distribution plus the elapsed current message interval. Rendering
must not permanently add idle time; idle is committed once, when the assistant
message ends or the session shuts down.

## Event Boundary

Only assistant output deltas count as token generation:

- `assistantMessageEvent.type === "text_delta"`
- `assistantMessageEvent.type === "thinking_delta"`

Tool-call argument events still do not count as token generation or explicit
tool wait:

- `toolcall_start`
- `toolcall_delta`
- `toolcall_end`

Explicit tool wait is measured only from Pi tool lifecycle events:

- `tool_execution_start`
- `tool_execution_end`

`tool_execution_update` should not change elapsed time directly.

Silent provider gaps are not counted as generation or tool wait. They appear as
`idle` only because they are part of observed assistant wall time.

## Timing

Assistant wall time starts at assistant `message_start` and ends at assistant
`message_end`.

Generation time follows the existing active-output burst logic:

- Open a burst on the first `text_delta` or `thinking_delta`.
- Add gaps between output deltas only when the gap is below
  `OUTPUT_IDLE_CUTOFF_MS`.
- Close stale bursts after the cutoff.
- Do not let non-output gaps dilute TPS.

Tool wait starts at `tool_execution_start` when an assistant message is active.
Tool wait ends at `tool_execution_end`. Duplicate start events while a tool wait
is already active should be ignored defensively. End events without an active
tool wait should be ignored.

If an assistant message ends while a tool wait is open, close the tool wait at
the message end timestamp before finalizing idle. If the session shuts down
while an assistant message or tool wait is active, finalize both at shutdown
time before clearing UI state.

## Token Accounting

Live token estimation stays lightweight:

```ts
function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 4));
}
```

At assistant `message_end`, if `event.message.usage.output` is present, correct
only `sessionAccumulation.tokens`:

```ts
const correction = event.message.usage.output - currentMessageEstimate.tokens;
sessionAccumulation.tokens += correction;
```

Do not rewrite burst timing or generation timing with final provider usage.
Provider output usage can include content that this extension intentionally does
not classify as streamed generation.

## UI

The extension should use Pi's status API with the `runtime` key:

```ts
ctx.ui.setStatus("runtime", statusText);
```

It should clear the same key on `session_start` and `session_shutdown`.

Suggested streaming display:

```text
● 38.7 t/s | gen 12.4s 55% | tools 5.1s 23% | idle 4.9s 22%
```

Suggested idle display:

```text
✓ 39.2 t/s | gen 34.8s 61% | tools 14.2s 25% | idle 8.1s 14%
```

The leading TPS number is historical session throughput using only generation
time as the denominator. The displayed percentages use total classified runtime:

```ts
generatingMillis + toolWaitMillis + idleMillis
```

During an active assistant message, these values should come from the temporary
display snapshot rather than the committed distribution alone.

If total runtime is zero, display all percentages as `0%`.

## Lifecycle

- `session_start`: reset token and timing contracts, stop timers, clear
  `runtime` status.
- assistant `message_start`: mark the assistant message active, set
  `messageStartedAt`, reset `currentMessageEstimate`, and clear any stale
  burst/tool interval.
- assistant `message_update`: accumulate only `text_delta` and
  `thinking_delta` as output generation.
- `tool_execution_start`: open explicit tool wait when an assistant message is
  active and no tool wait is already open.
- `tool_execution_end`: close explicit tool wait when open.
- assistant `message_end`: close any open burst, close any open tool wait,
  finalize residual idle, apply final token usage correction, render status, and
  mark inactive.
- `session_shutdown`: finalize any open message/tool intervals, stop timers,
  and clear `runtime` status when UI is available.

Non-assistant `message_start` and `message_end` events must not mutate assistant
runtime state.

## Unit Tests

The implementation should isolate pure stats helpers so tests do not need a Pi
runtime.

Required contract tests:

- `text_delta` increments current message tokens, session tokens, burst tokens,
  session generation time, and distribution generation time.
- `thinking_delta` follows the same generation path as `text_delta`.
- `toolcall_delta` does not increment tokens, generation time, or tool wait.
- `tool_execution_start` followed by `tool_execution_end` accumulates
  `toolWaitMillis`.
- Duplicate `tool_execution_start` does not double-count tool wait.
- `tool_execution_end` without an active start is ignored.
- Assistant `message_end` closes an active tool wait before calculating idle.
- Idle time is residual assistant wall time and is clamped at zero.
- TPS uses generation time only, not tool wait or idle time.
- Assistant `message_end` applies `usage.output` correction with nullish
  semantics, preserving valid zero usage.
- Non-assistant `message_end` does not stop or mutate assistant tracking.
- `session_start` resets historical token and timing state.
- `session_shutdown` finalizes open intervals, clears timers, and clears the
  `runtime` status.

## File Layout

Rename the extension file to:

```text
dot_pi/agent/exact_extensions/runtime-status.ts
```

Keep the extension as a single TypeScript file. Export pure stats helpers from
that file so unit tests can exercise schemas and event contracts without a Pi
runtime.
