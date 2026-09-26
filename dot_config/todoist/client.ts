import type { Todoist } from "./model";

export type Run = (args: string[]) => Promise<string>;

export function createTodoist(_run: Run): Todoist {
  throw new Error("Not implemented");
}

export const runTd: Run = async _args => { throw new Error("Not implemented"); };
