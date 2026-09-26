export type Tab = "scheduled" | "backlog";

export interface Task {
  id: string;
  content: string;
  sectionId?: string | null;
  projectId?: string;
  due?: { date: string } | null;
  deadline?: { date: string } | null;
}

export interface Section {
  id: string;
  name: string;
}

export type Run = (args: string[]) => Promise<string>;

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ANSI mode cannot use Television's display template, so retain a dimmed ID at the end.
export function displayRows(rows: string[], tab: Tab, today: string): string[] {
  // Television 0.15 requires a selected row even for an action without a template.
  if (!rows.length) return ["No active tasks\t"];
  return rows.map(row => {
    const [id, label] = row.split("\t");
    let display = label;
    if (tab === "scheduled") {
      const end = label.indexOf(" ");
      const due = label.slice(0, end);
      const day = due.slice(0, 10);
      const color = day < today ? "\x1b[31m" : day === today ? "\x1b[33m" : "";
      if (color) display = `${color}${due}\x1b[39m${label.slice(end)}`;
    }
    return `${display}\t\x1b[2m${id}\x1b[22m`;
  });
}

// Keep every task on one TSV line, including multiline task/section names.
function singleLine(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, " ");
}

export function taskRows(tasks: Task[], sections: Section[], tab: Tab): string[] {
  const names = new Map(sections.map(section => [section.id, section.name]));
  const selected = tasks.filter(task => Boolean(task.due?.date) === (tab === "scheduled"));
  if (tab === "scheduled") {
    // Todoist's ISO dates sort by calendar date, then time; all-day tasks go first.
    selected.sort((a, b) => {
      const left = a.due!.date;
      const right = b.due!.date;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }
  return selected.map(task => {
    // IDs are interpolated into Television's shell commands; never include task text there.
    if (!/^[a-zA-Z0-9_-]+$/.test(task.id)) throw new Error("Invalid Todoist task ID");
    const section = task.sectionId ? names.get(task.sectionId) : undefined;
    const label = `${task.due?.date ? `${task.due.date} ` : ""}${section ? `[${section}] ` : ""}${task.content}`;
    return `${task.id}\t${singleLine(label)}`;
  });
}

export async function loadRows(config: Record<string, unknown>, tab: Tab, run: Run): Promise<string[]> {
  const settings = config[tab];
  if (settings !== undefined && (settings === null || typeof settings !== "object" || Array.isArray(settings))) {
    throw new Error(`Todoist ${tab} settings must be a table`);
  }
  const projectValue = (settings as Record<string, unknown> | undefined)?.project;
  if (projectValue !== undefined && typeof projectValue !== "string") {
    throw new Error(`Todoist ${tab}.project must be a string`);
  }
  const project = (projectValue as string | undefined)?.trim();
  async function list<T>(entity: string, project?: string): Promise<T[]> {
    const scope = project ? ["--project", project] : [];
    const data = JSON.parse(await run(["--no-spinner", entity, "list", "--all", "--json", ...scope]));
    if (!data || !Array.isArray(data.results)) throw new Error(`Missing ${entity} results from td`);
    return data.results;
  }
  if (project) {
    const [tasks, sections] = await Promise.all([
      list<Task>("task", project), list<Section>("section", project),
    ]);
    return taskRows(tasks, sections, tab);
  }
  const tasks = await list<Task>("task");
  // td section list requires a project. Only visit projects represented in this tab.
  const projects = [...new Set(tasks
    .filter(task => Boolean(task.due?.date) === (tab === "scheduled"))
    .filter(task => task.sectionId && task.projectId)
    .map(task => `id:${task.projectId}`))];
  const sections: Section[] = [];
  // Bound concurrency so an account with many projects cannot flood the API.
  for (let i = 0; i < projects.length; i += 4) {
    const batch = await Promise.all(projects.slice(i, i + 4).map(ref => list<Section>("section", ref)));
    sections.push(...batch.flat());
  }
  return taskRows(tasks, sections, tab);
}

export const runTd: Run = async args => {
  const child = Bun.spawn(["td", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || `td exited with status ${code}`);
  return stdout;
};

if (import.meta.main) {
  try {
    const tab = Bun.argv[2];
    if (tab !== "scheduled" && tab !== "backlog") {
      throw new Error("Usage: bun todoist.ts scheduled|backlog");
    }
    const config = Bun.TOML.parse(await Bun.file(new URL("./todoist.toml", import.meta.url)).text());
    const rows = await loadRows(config, tab, runTd);
    console.log(displayRows(rows, tab, localDate(new Date())).join("\n"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
