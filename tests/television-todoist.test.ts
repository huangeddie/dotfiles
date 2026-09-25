import { expect, test } from "bun:test";
import { displayRows, localDate, loadRows, taskRows, type Run, type Task } from "../dot_config/television/todoist";

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

test("scheduled colors only overdue dates red and today's dates yellow", () => {
  expect(displayRows([
    "old\t2026-06-13 [Work] Overdue",
    "now\t2026-06-14T09:00:00 [Work] Today",
    "next\t2026-06-15 Future",
  ], "scheduled", "2026-06-14")).toEqual([
    "\x1b[31m2026-06-13\x1b[39m [Work] Overdue\t\x1b[2mold\x1b[22m",
    "\x1b[33m2026-06-14T09:00:00\x1b[39m [Work] Today\t\x1b[2mnow\x1b[22m",
    "2026-06-15 Future\t\x1b[2mnext\x1b[22m",
  ]);
});

test("today's all-day date is yellow rather than overdue", () => {
  expect(displayRows(["day\t2026-06-14 All day"], "scheduled", "2026-06-14"))
    .toEqual(["\x1b[33m2026-06-14\x1b[39m All day\t\x1b[2mday\x1b[22m"]);
});

test("backlog dates in task names remain uncolored while IDs are dimmed", () => {
  expect(displayRows(["plain\t2020-01-01 is part of the title"], "backlog", "2026-06-14"))
    .toEqual(["2020-01-01 is part of the title\t\x1b[2mplain\x1b[22m"]);
});

test("changing the supplied date changes due-date color without changing task order", () => {
  const rows = ["one\t2026-06-14 Task"];
  expect(displayRows(rows, "scheduled", "2026-06-13"))
    .toEqual(["2026-06-14 Task\t\x1b[2mone\x1b[22m"]);
  expect(displayRows(rows, "scheduled", "2026-06-15"))
    .toEqual(["\x1b[31m2026-06-14\x1b[39m Task\t\x1b[2mone\x1b[22m"]);
});

test("local date uses padded local calendar fields at both ends of the day", () => {
  expect(localDate(new Date(2026, 0, 2, 0, 0))).toBe("2026-01-02");
  expect(localDate(new Date(2026, 0, 2, 23, 59))).toBe("2026-01-02");
});

test("configured project starts task and section requests without waiting for either", async () => {
  const gate = Promise.withResolvers<void>();
  const started: string[] = [];
  const run: Run = async args => {
    started.push(args[1]);
    await gate.promise;
    return JSON.stringify({ results: args[1] === "task" ? tasks : sections });
  };
  const loading = loadRows({ scheduled: { project: "Work" } }, "scheduled", run);
  try {
    expect(started).toEqual(["task", "section"]);
  } finally {
    gate.resolve();
    await loading;
  }
  expect(await loading).toEqual([
    "early\t2020-01-01 [Home] Earlier", "later\t2027-02-02 [Work] Later",
  ]);
});

test("unscoped tabs skip other-tab and unsectioned projects and deduplicate section lookups", async () => {
  const input: Task[] = [
    { id: "one", content: "One", due: { date: "2026-01-01" }, projectId: "p", sectionId: "s" },
    { id: "two", content: "Two", due: { date: "2026-01-02" }, projectId: "p", sectionId: "s" },
    { id: "three", content: "Three", due: { date: "2026-01-03" }, projectId: "unsectioned" },
    { id: "four", content: "Four", projectId: "backlog", sectionId: "b" },
  ];
  for (const tab of ["scheduled", "backlog"] as const) {
    const refs: string[] = [];
    const run: Run = async args => {
      if (args[1] === "task") return JSON.stringify({ results: input });
      refs.push(args.at(-1)!);
      return JSON.stringify({ results: [{ id: "s", name: "Section" }, { id: "b", name: "Other" }] });
    };
    const rows = await loadRows({}, tab, run);
    expect(refs).toEqual(tab === "scheduled" ? ["id:p"] : ["id:backlog"]);
    expect(rows).toEqual(tab === "scheduled" ? [
      "one\t2026-01-01 [Section] One", "two\t2026-01-02 [Section] Two", "three\t2026-01-03 Three",
    ] : ["four\t[Other] Four"]);
  }
});

test("unscoped section requests run concurrently with no more than four in flight", async () => {
  const gates = Array.from({ length: 6 }, () => Promise.withResolvers<void>());
  const signals = Array.from({ length: 6 }, () => Promise.withResolvers<void>());
  const started: number[] = [];
  let active = 0;
  let maximum = 0;
  const run: Run = async args => {
    if (args[1] === "task") return JSON.stringify({ results: gates.map((_, i) => ({
      id: `t${i}`, content: `Task ${i}`, projectId: `p${i}`, sectionId: `s${i}`,
    })) });
    const i = Number(args.at(-1)!.replace("id:p", ""));
    started.push(i);
    maximum = Math.max(maximum, ++active);
    signals[i].resolve();
    await gates[i].promise;
    active--;
    return JSON.stringify({ results: [{ id: `s${i}`, name: `Section ${i}` }] });
  };
  const loading = loadRows({}, "backlog", run);
  try {
    await signals[0].promise;
    expect(started).toEqual([0, 1, 2, 3]);
    // Complete the first group in reverse order: result order must not change.
    for (const i of [3, 2, 1, 0]) gates[i].resolve();
    await signals[4].promise;
    expect(maximum).toBe(4);
  } finally {
    for (const gate of gates) gate.resolve();
    await loading;
  }
  expect(maximum).toBe(4);
  expect(await loading).toEqual([
    "t0\t[Section 0] Task 0", "t1\t[Section 1] Task 1", "t2\t[Section 2] Task 2",
    "t3\t[Section 3] Task 3", "t4\t[Section 4] Task 4", "t5\t[Section 5] Task 5",
  ]);
});
