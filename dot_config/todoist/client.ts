import type { Project, Section, Todoist } from "./model";

export type Run = (args: string[]) => Promise<string>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function results(output: string): unknown[] {
  const parsed: unknown = JSON.parse(output);
  if (!record(parsed) || !Array.isArray(parsed.results)) throw new Error("Invalid td list response");
  return parsed.results;
}

export function createTodoist(run: Run): Todoist {
  return {
    async projects(): Promise<Project[]> {
      const items = results(await run(["--no-spinner", "project", "list", "--all", "--json", "--full"]));
      return items.map(item => {
        if (!record(item) || !nonblank(item.id) || !nonblank(item.name) ||
          (item.inboxProject !== undefined && typeof item.inboxProject !== "boolean")) {
          throw new Error("Invalid td project");
        }
        return { id: item.id, name: item.name, inbox: item.inboxProject === true };
      });
    },
    async sections(projectId: string): Promise<Section[]> {
      const items = results(await run([
        "--no-spinner", "section", "list", "--project", `id:${projectId}`, "--all", "--json",
      ]));
      return items.map(item => {
        if (!record(item) || !nonblank(item.id) || !nonblank(item.name) ||
          !nonblank(item.projectId) || item.projectId !== projectId) {
          throw new Error("Invalid td section");
        }
        return { id: item.id, projectId: item.projectId, name: item.name };
      });
    },
    async create(input): Promise<{ id: string }> {
      const args = ["--no-spinner", "task", "add", "--content", input.title];
      if (input.description !== undefined) args.push("--description", input.description);
      if (input.projectId !== undefined) args.push("--project", `id:${input.projectId}`);
      if (input.sectionId !== undefined) args.push("--section", `id:${input.sectionId}`);
      if (input.due !== undefined) args.push("--due", input.due);
      args.push("--json");
      const created: unknown = JSON.parse(await run(args));
      if (!record(created) || !nonblank(created.id)) throw new Error("Invalid td created task ID");
      return { id: created.id };
    },
  };
}

export const runTd: Run = async args => {
  const child = Bun.spawn(["td", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || `td exited with status ${code}`);
  return stdout;
};
