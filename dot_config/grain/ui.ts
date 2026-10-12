import {
  BoxRenderable, InputRenderable, ScrollBoxRenderable, SelectRenderable, TextRenderable,
  type CliRenderer, type KeyEvent,
} from "@opentui/core";
import {
  analyze, displayPath, updateDashboard,
  type DashboardAction, type DashboardState, type FileMetric, type HistogramBin,
} from "./model";

export function mountDashboard(renderer: CliRenderer, files: readonly FileMetric[], quit: () => void): () => void {
  let active = true;
  let state: DashboardState = { query: "", sort: "totalLines", selectedIndex: 0 };
  let distribution = analyze(files, state.query, state.sort);
  const viewport = new ScrollBoxRenderable(renderer, {
    id: "grain-viewport", width: "100%", height: "100%", scrollY: true,
  });
  renderer.root.add(viewport);
  const body = new BoxRenderable(renderer, { id: "grain", width: "100%", flexDirection: "column" });
  viewport.add(body);
  const summary = new TextRenderable(renderer, { id: "summary", width: "100%", wrapMode: "word", flexShrink: 0 });
  body.add(summary);
  const charts = new BoxRenderable(renderer, { id: "charts", width: "100%", flexShrink: 0 });
  body.add(charts);
  const lines = new TextRenderable(renderer, { id: "lines", height: 7, flexShrink: 0 });
  const complexity = new TextRenderable(renderer, { id: "complexity", height: 7, flexShrink: 0 });
  charts.add(lines);
  charts.add(complexity);
  const help = new TextRenderable(renderer, {
    id: "help", width: "100%", wrapMode: "word", flexShrink: 0,
    content: "↑/↓ j/k rows · s sort · / query · Enter rows · Esc clear · q/Ctrl+C quit · PgUp/PgDn scroll",
  });
  body.add(help);
  const query = new InputRenderable(renderer, {
    id: "query", width: "100%", placeholder: "/ — literal path query", flexShrink: 0,
  });
  body.add(query);
  const heading = new TextRenderable(renderer, { id: "files-heading", width: "100%", height: 1, flexShrink: 0 });
  body.add(heading);
  const rows = new SelectRenderable(renderer, {
    id: "files", width: "100%", height: 8, flexShrink: 0, showDescription: true,
    itemSpacing: 0, showScrollIndicator: true, wrapSelection: false,
  });
  body.add(rows);
  const detail = new TextRenderable(renderer, {
    id: "selected-path", width: "100%", wrapMode: "char", flexShrink: 0,
  });
  body.add(detail);

  const bars = (title: string, bins: readonly HistogramBin[], width: number): string => {
    const maximum = Math.max(1, ...bins.map(bin => bin.count));
    const digits = String(maximum).length;
    const barWidth = Math.max(0, Math.min(30, width - 10 - digits));
    return [title, ...bins.map(bin =>
      `${bin.label.padEnd(7)} ${String(bin.count).padStart(digits)} ${"█".repeat(Math.round(bin.count / maximum * barWidth))}`,
    )].join("\n");
  };
  const renderSelection = () => {
    rows.selectedIndex = state.selectedIndex;
    const file = distribution.files[state.selectedIndex];
    detail.content = file ? displayPath(file.path) : "No files match. Press / to edit or Esc to clear the query.";
  };
  const render = () => {
    if (!active) return;
    const narrow = renderer.width < 100;
    charts.flexDirection = narrow ? "column" : "row";
    lines.width = complexity.width = narrow ? "100%" : "50%";
    // Leave room for the outer scrollbar; each chart has its own scale.
    const chartWidth = Math.max(1, Math.floor((renderer.width - 2) / (narrow ? 1 : 2)));
    lines.content = bars("Total lines", distribution.lines.bins, chartWidth);
    complexity.content = bars("Estimated complexity", distribution.complexity.bins, chartWidth);
    const value = (number: number | null) => number === null ? "—" : String(number);
    summary.content = `${distribution.fileCount} files · ${distribution.totalLines} total lines\n` +
      `Lines median ${value(distribution.lines.median)} / p90 ${value(distribution.lines.p90)} · ` +
      `Estimated complexity median ${value(distribution.complexity.median)} / p90 ${value(distribution.complexity.p90)}`;
    heading.content = `Files — ${state.sort === "totalLines" ? "total lines" : "estimated complexity"} ↓`;
    rows.height = Math.max(2, Math.min(12, renderer.height - (narrow ? 23 : 16)));
    rows.options = distribution.files.map(file => ({
      name: displayPath(file.path),
      description: `${displayPath(file.language)} · ${file.totalLines} lines · ${file.complexity} est. complexity`,
      value: file.path,
    }));
    rows.visible = distribution.fileCount > 0;
    renderSelection();
  };
  const dispatch = (action: DashboardAction) => {
    state = updateDashboard(state, action, files);
    if (action.type === "move") renderSelection();
    else {
      distribution = analyze(files, state.query, state.sort);
      render();
    }
  };
  const focusRows = () => {
    query.blur(); rows.focus();
    viewport.scrollChildIntoView(distribution.fileCount > 0 ? rows.id : detail.id);
  };
  const onInput = () => { if (active) dispatch({ type: "query", value: query.value }); };
  query.on("input", onInput);
  const onKey = (key: KeyEvent) => {
    if (!active || key.eventType === "release") return;
    const consume = () => { key.preventDefault(); key.stopPropagation(); };
    if (key.ctrl && key.name === "c") { consume(); quit(); return; }
    if (key.name === "escape") {
      consume(); query.value = ""; dispatch({ type: "query", value: "" }); focusRows(); return;
    }
    if (query.focused) {
      if (key.name === "return") { consume(); focusRows(); }
      return;
    }
    if (key.ctrl || key.meta || key.option) { consume(); return; }
    switch (key.name) {
      case "q": consume(); quit(); break;
      case "s": consume(); dispatch({ type: "sort" }); break;
      case "/": consume(); query.focus(); viewport.scrollChildIntoView(query.id); break;
      case "up": case "k": case "down": case "j":
        consume();
        dispatch({ type: "move", delta: key.name === "up" || key.name === "k" ? -1 : 1 });
        viewport.scrollChildIntoView(rows.id);
        break;
      case "pageup": case "pagedown":
        consume(); viewport.scrollBy((key.name === "pageup" ? -1 : 1) * Math.max(1, renderer.height - 1)); break;
      // Keep selection owned by the model, not the select's additional default shortcuts.
      default: consume();
    }
  };
  renderer.keyInput.on("keypress", onKey);
  renderer.on("resize", render);
  const cleanup = () => {
    if (!active) return;
    active = false;
    renderer.keyInput.off("keypress", onKey);
    renderer.off("resize", render);
    query.off("input", onInput);
    viewport.destroyRecursively();
  };
  try { render(); rows.focus(); } catch (error) { cleanup(); throw error; }
  return cleanup;
}
