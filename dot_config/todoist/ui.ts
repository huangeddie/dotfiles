import {
  BoxRenderable, InputRenderable, ScrollBoxRenderable, SelectRenderable, TextareaRenderable, TextRenderable,
  type CliRenderer, type KeyEvent, type SelectOption,
} from "@opentui/core";
import type { FormState, TaskForm } from "./model";

export type CancelForm = () => void;

type Field = "title" | "description" | "projectFilter" | "project" | "sectionFilter" | "section" | "due" | "customDue";
const dueOptions = [
  { name: "No date", description: "", value: "none" },
  { name: "Today", description: "", value: "today" },
  { name: "Tomorrow", description: "", value: "tomorrow" },
  { name: "Next week", description: "", value: "next week" },
  { name: "Next weekend", description: "", value: "next weekend" },
  { name: "Custom", description: "", value: "custom" },
];

export function mountForm(renderer: CliRenderer, form: TaskForm, cancel: CancelForm): () => void {
  let active = true;
  let syncing = false;
  const viewport = new ScrollBoxRenderable(renderer, { id: "form-viewport", width: "100%", height: "100%", scrollY: true });
  const body = new BoxRenderable(renderer, { id: "form", flexDirection: "column", width: "100%" });
  viewport.add(body);
  renderer.root.add(viewport);
  const label = (id: string, content: string): TextRenderable => {
    const text = new TextRenderable(renderer, { id, content, height: 1, width: "100%" });
    body.add(text);
    return text;
  };
  label("title-label", "Title");
  const title = new InputRenderable(renderer, { id: "title", placeholder: "Task title", width: "100%" });
  body.add(title);
  label("description-label", "Description (Enter inserts a newline)");
  const description = new TextareaRenderable(renderer, {
    id: "description", height: 3, width: "100%", placeholder: "Optional",
    onContentChange: () => { if (!syncing && active) form.edit({ description: description.plainText }); },
  });
  body.add(description);
  const projectLabel = label("project-label", "Project");
  const projectFilter = new InputRenderable(renderer, { id: "project-filter", placeholder: "Filter projects", width: "100%" });
  body.add(projectFilter);
  const project = new SelectRenderable(renderer, {
    id: "project", width: "100%", height: 4, showDescription: true, itemSpacing: 0,
  });
  body.add(project);
  const sectionLabel = label("section-label", "Section");
  const sectionFilter = new InputRenderable(renderer, { id: "section-filter", placeholder: "Filter sections", width: "100%" });
  body.add(sectionFilter);
  const section = new SelectRenderable(renderer, {
    id: "section", width: "100%", height: 4, showDescription: true, itemSpacing: 0,
  });
  body.add(section);
  label("due-label", "Due");
  const due = new SelectRenderable(renderer, {
    id: "due", width: "100%", height: 3, showDescription: false, options: dueOptions,
  });
  body.add(due);
  const customLabel = label("custom-label", "Custom due phrase");
  const customDue = new InputRenderable(renderer, { id: "custom-due", placeholder: "Todoist due phrase", width: "100%" });
  body.add(customDue);
  const status = label("status", "Loading projects…");
  label("help", "Tab/Shift+Tab fields  Enter select  Ctrl+S create  Esc/Ctrl+C cancel");

  const controls = { title, description, projectFilter, project, sectionFilter, section, due, customDue };
  let field: Field = "title";
  let lastProject: string | null = null;
  const ready = (state: FormState) => state.phase === "ready" && state.sectionsStatus !== "loading" && state.sectionsStatus !== "error";
  const canEdit = (state: FormState) => state.phase === "ready";
  const fields = (): Field[] => {
    const order: Field[] = ["title", "description", "projectFilter", "project"];
    if (form.state.draft.projectId !== null && form.state.sectionsStatus === "ready")
      order.push("sectionFilter", "section");
    order.push("due");
    if (customDue.visible) order.push("customDue");
    return order;
  };
  const focus = (next: Field) => {
    field = next;
    controls[next].focus();
    viewport.scrollChildIntoView(controls[next].id);
  };
  const options = (items: { id: string; name: string }[], filter: string, selected: string | null): SelectOption[] => {
    const matches = items.filter(item => item.name.toLowerCase().includes(filter.toLowerCase()));
    const names = new Map<string, number>();
    for (const item of items) names.set(item.name, (names.get(item.name) ?? 0) + 1);
    return matches.map(item => ({
      name: item.name, description: names.get(item.name)! > 1 ? `ID: ${item.id}${item.id === selected ? " (selected)" : ""}` :
        (item.id === selected ? "Selected" : ""), value: item.id,
    }));
  };
  const render = (state: FormState) => {
    if (!active) return;
    syncing = true;
    try {
      if (title.value !== state.draft.title) title.value = state.draft.title;
      if (description.plainText !== state.draft.description) description.setText(state.draft.description);
      if (lastProject !== state.draft.projectId) {
        lastProject = state.draft.projectId;
        sectionFilter.value = "";
      }
      project.options = [
        { name: "Default Inbox", description: "No project ID", value: null },
        ...options(state.projects, projectFilter.value, state.draft.projectId),
      ].filter(option => option.value === null ? !projectFilter.value || "default inbox".includes(projectFilter.value.toLowerCase()) : true);
      const projectIndex = project.options.findIndex(option => option.value === state.draft.projectId);
      if (!project.focused && project.options.length) project.selectedIndex = projectIndex >= 0 ? projectIndex : 0;
      section.options = state.sectionsStatus === "loading" || state.sectionsStatus === "error" ? [] : [
        { name: "No section", description: "", value: null },
        ...options(state.sections, sectionFilter.value, state.draft.sectionId),
      ].filter(option => option.value === null ? !sectionFilter.value || "no section".includes(sectionFilter.value.toLowerCase()) : true);
      const sectionIndex = section.options.findIndex(option => option.value === state.draft.sectionId);
      if (!section.focused && section.options.length) section.selectedIndex = sectionIndex >= 0 ? sectionIndex : 0;
      const dueValue = state.draft.due.kind === "none" ? "none" : state.draft.due.kind === "custom" ? "custom" : state.draft.due.value;
      if (!due.focused) due.selectedIndex = dueOptions.findIndex(option => option.value === dueValue);
      customLabel.visible = customDue.visible = state.draft.due.kind === "custom";
      if (state.draft.due.kind === "custom" && customDue.value !== state.draft.due.value) customDue.value = state.draft.due.value;
      projectLabel.content = `Project: ${state.projects.find(item => item.id === state.draft.projectId)?.name ?? "Default Inbox"}`;
      sectionLabel.content = `Section: ${state.sections.find(item => item.id === state.draft.sectionId)?.name ?? "No section"}`;
      const readStatus = state.phase === "loading" ? "Loading projects…" : state.phase === "load-error" ? "Project load failed (Ctrl+R to retry)" :
        state.sectionsStatus === "loading" ? "Loading sections…" : state.sectionsStatus === "error" ? "Section load failed (Ctrl+R to retry)" :
        state.phase === "submitting" ? "Creating task…" : "";
      const ambiguousCreate = state.error?.includes("Check Todoist before retrying") ?? false;
      status.height = state.error ? 4 : 1;
      status.content = [
        ambiguousCreate ? "Check Todoist before retrying; creation may have succeeded." : "",
        readStatus, state.error, ready(state) ? "Ctrl+S to create" : "",
      ].filter(Boolean).join("\n");
      // OpenTUI has no disabled property on these renderables; also guard paste and key events below.
      for (const control of [title, description, projectFilter, project, due]) control.focusable = canEdit(state);
      const sectionsAvailable = canEdit(state) && state.draft.projectId !== null && state.sectionsStatus === "ready";
      sectionFilter.focusable = section.focusable = sectionsAvailable;
      customDue.focusable = canEdit(state) && customDue.visible;
      if (canEdit(state) && !controls[field].focusable) focus("due");
      else if (canEdit(state) && !controls[field].focused) focus(field);
      if (state.error) viewport.scrollChildIntoView(status.id);
      else if (canEdit(state)) viewport.scrollChildIntoView(controls[field].id);
    } finally { syncing = false; }
  };

  title.on("input", () => { if (!syncing && active) form.edit({ title: title.value }); });
  projectFilter.on("input", () => { if (!syncing && active) render(form.state); });
  sectionFilter.on("input", () => { if (!syncing && active) render(form.state); });
  customDue.on("input", () => { if (!syncing && active) form.edit({ due: { kind: "custom", value: customDue.value } }); });
  project.on("itemSelected", (_index: number, option: SelectOption) => {
    if (canEdit(form.state)) void form.selectProject(option.value as string | null);
  });
  section.on("itemSelected", (_index: number, option: SelectOption) => {
    if (canEdit(form.state) && form.state.sectionsStatus !== "loading" && form.state.sectionsStatus !== "error")
      form.selectSection(option.value as string | null);
  });
  due.on("itemSelected", (_index: number, option: SelectOption) => {
    if (!canEdit(form.state)) return;
    const value = option.value as string;
    if (value === "none") form.edit({ due: { kind: "none" } });
    else if (value === "custom") { form.edit({ due: { kind: "custom", value: "" } }); focus("customDue"); }
    else form.edit({ due: { kind: "preset", value: value as "today" | "tomorrow" | "next week" | "next weekend" } });
  });
  const onKey = (key: KeyEvent) => {
    if (!active || key.eventType === "release") return;
    const state = form.state;
    if ((key.name === "escape" || key.name === "c" && key.ctrl) && state.phase !== "submitting" && state.phase !== "created") {
      key.preventDefault(); key.stopPropagation(); cancel(); return;
    }
    if (key.ctrl && key.name === "s") {
      key.preventDefault(); key.stopPropagation();
      if (ready(state)) void form.submit();
      return;
    }
    if (key.name === "r" && key.ctrl &&
      (state.phase === "load-error" || state.sectionsStatus === "error")) {
      key.preventDefault(); key.stopPropagation();
      if (state.phase === "load-error") void form.load();
      else void form.selectProject(state.draft.projectId);
      return;
    }
    if (!canEdit(state)) { key.preventDefault(); key.stopPropagation(); return; }
    if (key.name === "tab") {
      key.preventDefault(); key.stopPropagation();
      const order = fields();
      focus(order[(order.indexOf(field) + (key.shift ? order.length - 1 : 1)) % order.length]!);
      return;
    }
    // Enter in the filter highlights the first match; only Enter on the select commits it.
    if (key.name === "return" && (field === "projectFilter" || field === "sectionFilter")) {
      key.preventDefault(); key.stopPropagation();
      const picker = field === "projectFilter" ? project : section;
      if (picker.options.length) focus(field === "projectFilter" ? "project" : "section");
    }
  };
  const onPaste = (event: { preventDefault(): void; stopPropagation(): void }) => {
    if (!active || !canEdit(form.state)) { event.preventDefault(); event.stopPropagation(); }
  };
  renderer.keyInput.on("keypress", onKey);
  renderer.keyInput.on("paste", onPaste);
  const unsubscribe = form.subscribe(render);
  render(form.state);
  title.focus();
  return () => {
    if (!active) return;
    active = false;
    unsubscribe();
    renderer.keyInput.off("keypress", onKey);
    renderer.keyInput.off("paste", onPaste);
    viewport.destroyRecursively();
  };
}
