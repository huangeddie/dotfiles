import { expect, test } from "bun:test";
import { TaskForm, taskInput, type Draft, type Project, type Section, type TaskInput, type Todoist } from "../dot_config/todoist/model";

const projects: Project[] = [
  { id: "a", name: "Inbox", inbox: true },
  { id: "b", name: "Work", inbox: false },
];
const sections: Section[] = [
  { id: "sa", projectId: "a", name: "First" },
  { id: "sb", projectId: "b", name: "Second" },
];
function draft(patch: Partial<Draft> = {}): Draft {
  return { title: "  Ship release  ", description: "", projectId: "a", sectionId: null, due: { kind: "none" }, ...patch };
}
function fakeTodoist(): Todoist & { created: TaskInput[] } {
  const created: TaskInput[] = [];
  return {
    created,
    projects: async () => projects,
    sections: async id => sections.filter(section => section.projectId === id),
    create: async input => { created.push(input); return { id: "created-1" }; },
  };
}

// Each expectation uses a hand-derived payload; the fake only replaces the external service.
test.failing("next weekend is passed unchanged rather than computed locally", () => {
  expect(taskInput(draft({ projectId: "b", sectionId: "sb", due: { kind: "preset", value: "next weekend" } }), projects, sections))
    .toEqual({ title: "Ship release", projectId: "b", sectionId: "sb", due: "next weekend" });
});

test.failing("empty description and no date omit their optional properties", () => {
  expect(taskInput(draft({ description: "  " }), projects, sections)).toEqual({ title: "Ship release", projectId: "a" });
});

test.failing("description preserves newlines verbatim", () => {
  expect(taskInput(draft({ description: "first\nsecond" }), projects, sections))
    .toEqual({ title: "Ship release", description: "first\nsecond", projectId: "a" });
});

for (const phrase of ["today", "tomorrow", "next week", "next weekend"] as const) {
  test.failing(`${phrase} remains a literal due phrase`, () => {
    expect(taskInput(draft({ due: { kind: "preset", value: phrase } }), projects, sections))
      .toEqual({ title: "Ship release", projectId: "a", due: phrase });
  });
}

test.failing("custom date trims whitespace but is not interpreted", () => {
  expect(taskInput(draft({ due: { kind: "custom", value: "  every Monday  " } }), projects, sections))
    .toEqual({ title: "Ship release", projectId: "a", due: "every Monday" });
});

test.failing("omitting a project omits its flag and has no section", () => {
  expect(taskInput(draft({ projectId: null }), projects, [])).toEqual({ title: "Ship release" });
});

for (const [name, invalid] of [
  ["blank title", { title: "  " }],
  ["multiline title", { title: "one\ntwo" }],
  ["blank custom date", { due: { kind: "custom", value: " \n " } }],
  ["unknown project ID", { projectId: "unknown" }],
  ["section belonging to another project", { projectId: "b", sectionId: "sa" }],
  ["section absent from current sections", { sectionId: "sa" }],
] as const) {
  test.failing(`${name} prevents task creation`, async () => {
    const fake = fakeTodoist();
    const form = new TaskForm(fake);
    await form.load();
    if ("title" in invalid) form.edit({ title: invalid.title });
    if ("due" in invalid) form.edit({ due: invalid.due });
    // A selected ID can become invalid if remote metadata changes; validate the draft independently.
    if ("projectId" in invalid || "sectionId" in invalid) {
      const candidate = draft(invalid);
      expect(() => taskInput(candidate, projects, invalid.sectionId === "sa" && invalid.projectId !== "b" ? [] : sections)).toThrow();
    } else {
      await form.submit();
      expect(form.state.phase).toBe("ready");
      expect(form.state.error).toBeTruthy();
    }
    expect(fake.created).toEqual([]);
  });
}

test.failing("initial load selects Inbox and loads only its sections", async () => {
  const form = new TaskForm(fakeTodoist());
  await form.load();
  expect(form.state.phase).toBe("ready");
  expect(form.state.draft.projectId).toBe("a");
  expect(form.state.sections).toEqual([{ id: "sa", projectId: "a", name: "First" }]);
});

test.failing("without an Inbox project, initial project is null and sections are empty", async () => {
  const fake = fakeTodoist();
  fake.projects = async () => [projects[1]];
  fake.sections = async () => { throw new Error("null project must not load sections"); };
  const form = new TaskForm(fake);
  await form.load();
  expect(form.state.phase).toBe("ready");
  expect(form.state.draft.projectId).toBeNull();
  expect(form.state.sections).toEqual([]);
});

test.failing("changing project clears the selected section before loading finishes", async () => {
  const gate = Promise.withResolvers<Section[]>();
  const fake = fakeTodoist();
  fake.sections = async id => id === "a" ? [sections[0]] : gate.promise;
  const form = new TaskForm(fake);
  await form.load();
  form.selectSection("sa");
  const changing = form.selectProject("b");
  expect(form.state.draft.sectionId).toBeNull();
  expect(form.state.sections).toEqual([]);
  gate.resolve([sections[1]]);
  await changing;
  expect(form.state.sections.map(section => section.id)).toEqual(["sb"]);
});

test.failing("late section response from project a cannot replace project b", async () => {
  const gate = Promise.withResolvers<Section[]>();
  const fake = fakeTodoist();
  fake.sections = async id => id === "a" ? gate.promise : [sections[1]];
  const form = new TaskForm(fake);
  const initial = form.load();
  await form.selectProject("b");
  expect(form.state.sections).toEqual([sections[1]]);
  gate.resolve([sections[0]]);
  await initial;
  expect(form.state.draft.projectId).toBe("b");
  expect(form.state.sections).toEqual([sections[1]]);
});

test.failing("late project a rejection cannot show an error after project b succeeds", async () => {
  const gate = Promise.withResolvers<Section[]>();
  const fake = fakeTodoist();
  fake.sections = async id => id === "a" ? gate.promise : [sections[1]];
  const form = new TaskForm(fake);
  const initial = form.load();
  await form.selectProject("b");
  gate.reject(new Error("stale read failure"));
  await initial;
  expect(form.state.sectionsStatus).toBe("ready");
  expect(form.state.error).toBeNull();
});

test.failing("failed project load can be retried", async () => {
  const fake = fakeTodoist();
  fake.projects = async () => { throw new Error("projects offline"); };
  const form = new TaskForm(fake);
  await form.load();
  expect(form.state.phase).toBe("load-error");
  expect(form.state.error).toContain("projects offline");
  fake.projects = async () => projects;
  await form.load();
  expect(form.state.phase).toBe("ready");
  expect(form.state.error).toBeNull();
  expect(form.state.projects).toEqual(projects);
});

test.failing("failed section load can be retried by selecting the project again", async () => {
  const fake = fakeTodoist();
  fake.sections = async () => { throw new Error("sections offline"); };
  const form = new TaskForm(fake);
  await form.load();
  expect(form.state.sectionsStatus).toBe("error");
  expect(form.state.error).toContain("sections offline");
  fake.sections = async () => [sections[0]];
  await form.selectProject("a");
  expect(form.state.sectionsStatus).toBe("ready");
  expect(form.state.sections).toEqual([sections[0]]);
  expect(form.state.error).toBeNull();
});

test.failing("two concurrent submits send one task input", async () => {
  const gate = Promise.withResolvers<{ id: string }>();
  const fake = fakeTodoist();
  fake.create = async input => { fake.created.push(input); return gate.promise; };
  const form = new TaskForm(fake);
  await form.load();
  form.edit({ title: "  New task  " });
  const first = form.submit();
  const second = form.submit();
  expect(form.state.phase).toBe("submitting");
  expect(fake.created).toEqual([{ title: "New task", projectId: "a" }]);
  form.edit({ title: "Should not change" });
  await form.selectProject("b");
  form.selectSection("sb");
  expect(form.state.draft).toEqual(draft({ title: "  New task  " }));
  gate.resolve({ id: "created-2" });
  await Promise.all([first, second]);
  expect(form.state.createdId).toBe("created-2");
});

test.failing("failed create preserves the draft and does not automatically retry", async () => {
  const fake = fakeTodoist();
  fake.create = async input => { fake.created.push(input); throw new Error("connection lost; check Todoist before retrying"); };
  const form = new TaskForm(fake);
  await form.load();
  form.edit({ title: "Retain me", description: "first\nsecond" });
  await form.submit();
  expect(form.state.phase).toBe("ready");
  expect(form.state.draft).toEqual(draft({ title: "Retain me", description: "first\nsecond" }));
  expect(form.state.error).toContain("connection lost");
  expect(fake.created).toEqual([{ title: "Retain me", description: "first\nsecond", projectId: "a" }]);
});

test.failing("successful create retains ID and ignores further submissions and edits", async () => {
  const fake = fakeTodoist();
  const form = new TaskForm(fake);
  await form.load();
  form.edit({ title: "Created" });
  await form.submit();
  await form.submit();
  form.edit({ title: "Ignored" });
  expect(form.state.phase).toBe("created");
  expect(form.state.createdId).toBe("created-1");
  expect(form.state.draft.title).toBe("Created");
  expect(fake.created).toEqual([{ title: "Created", projectId: "a" }]);
});

test.failing("unsubscribed listeners receive no further snapshots; earlier snapshots stay unchanged", async () => {
  const form = new TaskForm(fakeTodoist());
  const snapshots: typeof form.state[] = [];
  const unsubscribe = form.subscribe(state => snapshots.push(state));
  await form.load();
  const count = snapshots.length;
  expect(count).toBeGreaterThan(0);
  const previous = snapshots[count - 1];
  form.edit({ title: "first edit" });
  expect(previous.draft.title).toBe("");
  unsubscribe();
  const afterUnsubscribe = snapshots.length;
  form.edit({ title: "second edit" });
  expect(snapshots).toHaveLength(afterUnsubscribe);
});
