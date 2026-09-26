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

export function taskInput(_draft: Draft, _projects: Project[], _sections: Section[]): TaskInput {
  return { title: "" };
}

export class TaskForm {
  private current: FormState = {
    phase: "loading", projects: [], sections: [], sectionsStatus: "idle",
    draft: { title: "", description: "", projectId: null, sectionId: null, due: { kind: "none" } },
    error: null, createdId: null,
  };
  constructor(_todoist: Todoist) {}
  get state(): FormState { return this.current; }
  subscribe(_listener: (state: FormState) => void): () => void { return () => {}; }
  async load(): Promise<void> {}
  edit(_patch: Partial<Pick<Draft, "title" | "description" | "due">>): void {}
  async selectProject(_projectId: string | null): Promise<void> {}
  selectSection(_sectionId: string | null): void {}
  async submit(): Promise<void> {}
}
