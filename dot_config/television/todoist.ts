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
  return "";
}

export function displayRows(rows: string[], tab: Tab, today: string): string[] {
  return rows;
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
  const tasks = await list<Task>("task", project);
  // td section list requires a project. Only visit projects that need section labels.
  const projects = project ? [project] : [...new Set(tasks
    .filter(task => task.sectionId && task.projectId)
    .map(task => `id:${task.projectId}`))];
  const sections: Section[] = [];
  for (const ref of projects) sections.push(...await list<Section>("section", ref));
  return taskRows(tasks, sections, tab);
}

if (import.meta.main) {
  try {
    const tab = Bun.argv[2];
    if (tab !== "scheduled" && tab !== "backlog") {
      throw new Error("Usage: bun todoist.ts scheduled|backlog");
    }
    const config = Bun.TOML.parse(await Bun.file(new URL("./todoist.toml", import.meta.url)).text());
    const run: Run = async args => {
      const child = Bun.spawn(["td", ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      if (code !== 0) throw new Error(stderr.trim() || `td exited with status ${code}`);
      return stdout;
    };
    const rows = await loadRows(config, tab, run);
    if (rows.length) console.log(rows.join("\n"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
