import { expect, test } from "bun:test";
import { loadRows, taskRows, type Run, type Task } from "../dot_config/television/todoist";

const tasks: Task[] = [
  { id: "later", content: "Later", due: { date: "2027-02-02" }, sectionId: "work", projectId: "pWork" },
  { id: "plain", content: "No date", due: null },
  { id: "early", content: "Earlier", due: { date: "2020-01-01" }, sectionId: "home", projectId: "pHome" },
  { id: "deadline", content: "Deadline only", deadline: { date: "2026-01-01" }, sectionId: "work", projectId: "pWork" },
];
const sections = [{ id: "work", name: "Work" }, { id: "home", name: "Home" }];

test("scheduled excludes undated tasks and orders due dates earliest first", () => {
  expect(taskRows(tasks, sections, "scheduled")).toEqual([
    "early\t2020-01-01 [Home] Earlier",
    "later\t2027-02-02 [Work] Later",
  ]);
  expect(tasks[0].id).toBe("later");
});

test("backlog includes deadline-only tasks and embeds section names", () => {
  expect(taskRows(tasks, sections, "backlog")).toEqual([
    "plain\tNo date",
    "deadline\t[Work] Deadline only",
  ]);
});

test("scheduled orders all-day dates before times and keeps equal-date input order", () => {
  expect(taskRows([
    { id: "evening", content: "Evening", due: { date: "2027-01-01T18:00:00" } },
    { id: "day", content: "All day", due: { date: "2027-01-01" } },
    { id: "morning", content: "Morning", due: { date: "2027-01-01T09:00:00" } },
    { id: "also", content: "Also all day", due: { date: "2027-01-01" } },
  ], [], "scheduled").map(row => row.split("\t")[0])).toEqual(["day", "also", "morning", "evening"]);
});

test("missing section metadata leaves the task label unprefixed", () => {
  expect(taskRows([{ id: "orphan", content: "Task", sectionId: "gone" }], [], "backlog"))
    .toEqual(["orphan\tTask"]);
});

test("control characters in content and sections cannot create extra rows or fields", () => {
  expect(taskRows([{ id: "safe", content: "A\tB\nC\rD\u001b", sectionId: "s" }],
    [{ id: "s", name: "One\tTwo\nThree" }], "backlog"))
    .toEqual(["safe\t[One Two Three] A B C D "]);
});

test("unsafe task IDs are rejected before they reach shell command templates", () => {
  expect(() => taskRows([{ id: "x'; touch /tmp/no; '", content: "Unsafe" }], [], "backlog"))
    .toThrow("task ID");
});

test("empty task lists produce no rows in either tab", () => {
  expect(taskRows([], sections, "scheduled")).toEqual([]);
  expect(taskRows([], sections, "backlog")).toEqual([]);
});

// The fake matches argv, not shell strings: project names must remain one argument.
function fakeTd(project?: string): Run {
  const scope = project ? ["--project", project] : [];
  const responses = new Map<string, { results: unknown[]; nextCursor: null }>([
    [JSON.stringify(["--no-spinner", "task", "list", "--all", "--json", ...scope]), { results: tasks, nextCursor: null }],
  ]);
  const sectionScopes: Array<[string, typeof sections]> = project
    ? [[project, sections]]
    : [["id:pWork", [sections[0]]], ["id:pHome", [sections[1]]]];
  for (const [ref, results] of sectionScopes) {
    responses.set(JSON.stringify(["--no-spinner", "section", "list", "--all", "--json", "--project", ref]), { results, nextCursor: null });
  }
  return async args => {
    const response = responses.get(JSON.stringify(args));
    if (!response) throw new Error(`Unexpected td arguments: ${JSON.stringify(args)}`);
    return JSON.stringify(response);
  };
}

test("omitted or empty project loads all tasks and resolves sections by their project IDs", async () => {
  for (const config of [{}, { backlog: {} }, { backlog: { project: "" } }, { backlog: { project: "  " } }, { scheduled: { project: "Other" } }]) {
    expect(await loadRows(config, "backlog", fakeTd())).toEqual([
      "plain\tNo date", "deadline\t[Work] Deadline only",
    ]);
  }
});

test("configured project scopes both queries and stays a single literal argument", async () => {
  const project = "Work 'quoted' $(false)";
  expect(await loadRows({ scheduled: { project } }, "scheduled", fakeTd(project))).toEqual([
    "early\t2020-01-01 [Home] Earlier", "later\t2027-02-02 [Work] Later",
  ]);
});

test("each tab scopes task and section queries to its own project", async () => {
  const config = { scheduled: { project: "Work" }, backlog: { project: "Personal" } };
  expect(await loadRows(config, "scheduled", fakeTd("Work"))).toEqual([
    "early\t2020-01-01 [Home] Earlier", "later\t2027-02-02 [Work] Later",
  ]);
  expect(await loadRows(config, "backlog", fakeTd("Personal"))).toEqual([
    "plain\tNo date", "deadline\t[Work] Deadline only",
  ]);
});

test("an empty scheduled project does not inherit the backlog project", async () => {
  expect(await loadRows({ scheduled: { project: "" }, backlog: { project: "Personal" } }, "scheduled", fakeTd())).toEqual([
    "early\t2020-01-01 [Home] Earlier", "later\t2027-02-02 [Work] Later",
  ]);
});

test("non-string tab project fails instead of silently showing all projects", async () => {
  await expect(loadRows({ backlog: { project: 42 } }, "backlog", fakeTd())).rejects.toThrow("project");
});

test("malformed tab settings fail instead of silently showing all projects", async () => {
  for (const backlog of [null, "Personal", [], 42]) {
    await expect(loadRows({ backlog }, "backlog", fakeTd())).rejects.toThrow("backlog");
  }
});

test("CLI errors propagate instead of appearing as an empty task list", async () => {
  const fail: Run = async () => { throw new Error("td: authentication failed"); };
  await expect(loadRows({}, "backlog", fail)).rejects.toThrow("authentication failed");
});

test("malformed CLI output fails instead of appearing as an empty task list", async () => {
  await expect(loadRows({}, "backlog", async () => '{}')).rejects.toThrow("results");
});
