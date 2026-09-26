import { expect, test } from "bun:test";
import { createTodoist, type Run } from "../dot_config/todoist/client";

const projectArgs = ["--no-spinner", "project", "list", "--all", "--json", "--full"];
const sectionArgs = ["--no-spinner", "section", "list", "--project", "id:p", "--all", "--json"];

function fakeRun(responses: [string[], string][]): { run: Run; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run: async args => {
      calls.push(args);
      const response = responses.find(([expected]) => JSON.stringify(expected) === JSON.stringify(args));
      if (!response) throw new Error(`Unexpected argv: ${JSON.stringify(args)}`);
      return response[1];
    },
  };
}

test.failing("task fields remain literal arguments including leading dashes and shell syntax", async () => {
  const calls: string[][] = [];
  const api = createTodoist(async args => {
    calls.push(args);
    return '{"id":"new"}';
  });
  expect(await api.create({
    title: "--title $(false)", description: "first\nsecond",
    projectId: "p", sectionId: "s", due: "next week",
  })).toEqual({ id: "new" });
  expect(calls).toEqual([[
    "--no-spinner", "task", "add", "--content", "--title $(false)",
    "--description", "first\nsecond", "--project", "id:p",
    "--section", "id:s", "--due", "next week", "--json",
  ]]);
});

test.failing("minimal task has no optional flags and tolerates unrelated output fields", async () => {
  const args = ["--no-spinner", "task", "add", "--content", "plain", "--json"];
  const { run, calls } = fakeRun([[args, '{"id":"t","content":"plain","priority":1}']]);
  expect(await createTodoist(run).create({ title: "plain" })).toEqual({ id: "t" });
  expect(calls).toEqual([args]);
});

for (const phrase of ["today", "tomorrow", "next week", "next weekend"]) {
  test.failing(`due phrase ${phrase} is passed unchanged`, async () => {
    const args = ["--no-spinner", "task", "add", "--content", "task", "--due", phrase, "--json"];
    const { run, calls } = fakeRun([[args, '{"id":"new"}']]);
    expect(await createTodoist(run).create({ title: "task", due: phrase })).toEqual({ id: "new" });
    expect(calls).toEqual([args]);
  });
}

test.failing("projects fetch all/full, normalize inbox and preserve duplicate names by ID", async () => {
  const { run, calls } = fakeRun([[projectArgs, JSON.stringify({
    results: [
      { id: "inbox", name: "Inbox", inboxProject: true, color: "blue" },
      { id: "p", name: "Duplicate", inboxProject: false },
      { id: "q", name: "Duplicate", workspaceId: "workspace" },
    ], nextCursor: null,
  })]]);
  expect(await createTodoist(run).projects()).toEqual([
    { id: "inbox", name: "Inbox", inbox: true },
    { id: "p", name: "Duplicate", inbox: false },
    { id: "q", name: "Duplicate", inbox: false },
  ]);
  expect(calls).toEqual([projectArgs]);
});

test.failing("sections fetch all for project ID and preserve duplicate names by ID", async () => {
  const { run, calls } = fakeRun([[sectionArgs, JSON.stringify({ results: [
    { id: "s1", projectId: "p", name: "Same", sectionOrder: 1 },
    { id: "s2", projectId: "p", name: "Same", sectionOrder: 2 },
  ], nextCursor: null })]]);
  expect(await createTodoist(run).sections("p")).toEqual([
    { id: "s1", projectId: "p", name: "Same" },
    { id: "s2", projectId: "p", name: "Same" },
  ]);
  expect(calls).toEqual([sectionArgs]);
});

test.failing("empty project and section results are valid", async () => {
  const { run, calls } = fakeRun([
    [projectArgs, '{"results":[],"nextCursor":null}'],
    [sectionArgs, '{"results":[],"nextCursor":null}'],
  ]);
  const api = createTodoist(run);
  expect(await api.projects()).toEqual([]);
  expect(await api.sections("p")).toEqual([]);
  expect(calls).toEqual([projectArgs, sectionArgs]);
});

for (const [name, response] of [
  ["missing results", '{}'],
  ["null results", '{"results":null}'],
  ["non-array results", '{"results":{}}'],
  ["bad JSON", '{'],
  ["invalid project ID", '{"results":[{"id":"","name":"Work"}]}'],
  ["invalid project name", '{"results":[{"id":"p","name":5}]}'],
  ["invalid inbox value", '{"results":[{"id":"p","name":"Work","inboxProject":"true"}]}'],
] as const) {
  test.failing(`projects reject ${name}`, async () => {
    const { run } = fakeRun([[projectArgs, response]]);
    expect(createTodoist(run).projects()).rejects.toThrow();
  });
}

for (const [name, response] of [
  ["missing results", '{}'],
  ["invalid section ID", '{"results":[{"id":"","projectId":"p","name":"Name"}]}'],
  ["invalid section name", '{"results":[{"id":"s","projectId":"p","name":null}]}'],
  ["missing project ID", '{"results":[{"id":"s","name":"Name"}]}'],
  ["wrong-project section", '{"results":[{"id":"s","projectId":"other","name":"Name"}]}'],
] as const) {
  test.failing(`sections reject ${name}`, async () => {
    const { run } = fakeRun([[sectionArgs, response]]);
    expect(createTodoist(run).sections("p")).rejects.toThrow();
  });
}

for (const response of ['{}', '{"id":""}', '{"id":9}', 'not json']) {
  test.failing(`create rejects missing or invalid ID: ${response}`, async () => {
    const { run } = fakeRun([[["--no-spinner", "task", "add", "--content", "task", "--json"], response]]);
    expect(createTodoist(run).create({ title: "task" })).rejects.toThrow();
  });
}

test.failing("runner rejection propagates without fabricated success", async () => {
  const error = new Error("td unavailable");
  const api = createTodoist(async () => { throw error; });
  expect(api.projects()).rejects.toBe(error);
  expect(api.sections("p")).rejects.toBe(error);
  expect(api.create({ title: "task" })).rejects.toBe(error);
});
