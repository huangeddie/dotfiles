import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let startTime = 0;
  let tokenCount = 0;
  let interval: ReturnType<typeof setInterval> | null = null;

  function stopInterval() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  pi.on("message_start", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    startTime = Date.now();
    tokenCount = 0;
    stopInterval();

    interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed > 0 && tokenCount > 0) {
        const tps = tokenCount / elapsed;
        const theme = ctx.ui.theme;
        const spinner = theme.fg("accent", "●");
        const text = theme.fg("dim", ` ${tps.toFixed(1)} t/s`);
        ctx.ui.setStatus("tps", spinner + text);
      }
    }, 200);
  });

  pi.on("message_update", async () => {
    tokenCount++;
  });

  pi.on("message_end", async (event, ctx) => {
    stopInterval();
    if (event.message.role !== "assistant") return;

    const elapsed = (Date.now() - startTime) / 1000;
    const outputTokens = event.message.usage?.output || tokenCount;
    const tps = elapsed > 0 ? outputTokens / elapsed : 0;
    const theme = ctx.ui.theme;

    const check = theme.fg("success", "✓");
    const text = theme.fg(
      "dim",
      ` ${tps.toFixed(1)} t/s (${outputTokens}t, ${elapsed.toFixed(1)}s)`,
    );
    ctx.ui.setStatus("tps", check + text);
  });
}
