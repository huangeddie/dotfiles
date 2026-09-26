export interface Project { id: string; name: string; inbox: boolean }
export interface Section { id: string; projectId: string; name: string }
export type DueChoice =
  | { kind: "none" }
  | { kind: "preset"; value: "today" | "tomorrow" | "next week" | "next weekend" }
  | { kind: "custom"; value: string };
export interface Draft {
  title: string;
  description: string;
  projectId: string | null;
  sectionId: string | null;
  due: DueChoice;
}
export interface TaskInput {
  title: string;
  description?: string;
  projectId?: string;
  sectionId?: string;
  due?: string;
}
export interface Todoist {
  projects(): Promise<Project[]>;
  sections(projectId: string): Promise<Section[]>;
  create(input: TaskInput): Promise<{ id: string }>;
}
export interface FormState {
  phase: "loading" | "load-error" | "ready" | "submitting" | "created";
  projects: Project[];
  sections: Section[];
  sectionsStatus: "idle" | "loading" | "ready" | "error";
  draft: Draft;
  error: string | null;
  createdId: string | null;
}

export function taskInput(draft: Draft, projects: Project[], sections: Section[]): TaskInput {
  const title = draft.title.trim();
  if (!title || /[\r\n]/.test(draft.title)) throw new Error("Title must be a single nonblank line");
  if (draft.projectId !== null && !projects.some(project => project.id === draft.projectId)) {
    throw new Error("Select an available project");
  }
  if (draft.sectionId !== null && (draft.projectId === null ||
    !sections.some(section => section.id === draft.sectionId && section.projectId === draft.projectId))) {
    throw new Error("Select a section in the current project");
  }
  if (draft.due.kind === "custom" && !draft.due.value.trim()) throw new Error("Enter a due date");

  const input: TaskInput = { title };
  if (draft.description.trim()) input.description = draft.description;
  if (draft.projectId !== null) input.projectId = draft.projectId;
  if (draft.sectionId !== null) input.sectionId = draft.sectionId;
  if (draft.due.kind === "preset") input.due = draft.due.value;
  if (draft.due.kind === "custom") input.due = draft.due.value.trim();
  return input;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TaskForm {
  private current: FormState = {
    phase: "loading", projects: [], sections: [], sectionsStatus: "idle",
    draft: { title: "", description: "", projectId: null, sectionId: null, due: { kind: "none" } },
    error: null, createdId: null,
  };
  private listeners = new Set<(state: FormState) => void>();
  private sectionRequest = 0;

  constructor(private readonly todoist: Todoist) {}
  get state(): FormState { return this.current; }
  subscribe(listener: (state: FormState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private update(patch: Partial<FormState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener(this.current);
  }
  async load(): Promise<void> {
    if (this.current.phase === "submitting" || this.current.phase === "created") return;
    ++this.sectionRequest;
    this.update({ phase: "loading", error: null, sections: [], sectionsStatus: "idle" });
    try {
      const projects = await this.todoist.projects();
      const projectId = projects.find(project => project.inbox)?.id ?? null;
      this.update({
        phase: "ready", projects: [...projects], draft: { ...this.current.draft, projectId, sectionId: null },
        error: null,
      });
      if (projectId !== null) await this.selectProject(projectId);
    } catch (error) {
      this.update({ phase: "load-error", error: message(error), projects: [], sections: [], sectionsStatus: "idle" });
    }
  }
  edit(patch: Partial<Pick<Draft, "title" | "description" | "due">>): void {
    if (this.current.phase !== "ready") return;
    this.update({ draft: { ...this.current.draft, ...patch }, error: null });
  }
  async selectProject(projectId: string | null): Promise<void> {
    if (this.current.phase !== "ready") return;
    const request = ++this.sectionRequest;
    this.update({
      draft: { ...this.current.draft, projectId, sectionId: null }, sections: [],
      sectionsStatus: projectId === null ? "idle" : "loading", error: null,
    });
    if (projectId === null) return;
    try {
      const sections = await this.todoist.sections(projectId);
      if (request !== this.sectionRequest) return;
      this.update({ sections: [...sections], sectionsStatus: "ready", error: null });
    } catch (error) {
      if (request !== this.sectionRequest) return;
      this.update({ sectionsStatus: "error", error: message(error) });
    }
  }
  selectSection(sectionId: string | null): void {
    if (this.current.phase !== "ready") return;
    this.update({ draft: { ...this.current.draft, sectionId }, error: null });
  }
  async submit(): Promise<void> {
    if (this.current.phase !== "ready") return;
    let input: TaskInput;
    try {
      input = taskInput(this.current.draft, this.current.projects, this.current.sections);
    } catch (error) {
      this.update({ error: message(error) });
      return;
    }
    this.update({ phase: "submitting", error: null });
    try {
      const created = await this.todoist.create(input);
      this.update({ phase: "created", createdId: created.id });
    } catch (error) {
      this.update({ phase: "ready", error: `${message(error)}. Check Todoist before retrying if the outcome is uncertain.` });
    }
  }
}
