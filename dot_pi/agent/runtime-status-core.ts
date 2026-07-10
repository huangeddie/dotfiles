export type RuntimeStatusReport = {
  version: 1;
  observedMillis: number;
  generatingMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
};

export type RuntimeCategoryMillis = Pick<
  RuntimeStatusReport,
  "generatingMillis" | "toolWaitMillis" | "idleMillis"
>;

export type ToolInterval = {
  toolCallId: string;
  sequence: number;
  startedAt: number;
  endedAt: number | null;
  subagentReport: RuntimeStatusReport | null;
};

export type ReportStore = {
  create(): Promise<string>;
  readAndRemove(path: string): Promise<unknown | null>;
  writeAtomically(path: string, report: RuntimeStatusReport): Promise<void>;
  remove(path: string): Promise<void>;
};

export function validateRuntimeStatusReport(_value: unknown): RuntimeStatusReport | null {
  return null;
}

export function scaleReport(_report: RuntimeStatusReport, _targetMillis: number): RuntimeCategoryMillis {
  return { generatingMillis: 0, toolWaitMillis: 0, idleMillis: 0 };
}

export class ToolIntervalLedger {
  start(_toolCallId: string, _startedAt: number): void {}
  end(_toolCallId: string, _endedAt: number): void {}
  attachSubagentReport(_toolCallId: string, _report: RuntimeStatusReport): void {}
  project(_now: number): RuntimeCategoryMillis {
    return { generatingMillis: 0, toolWaitMillis: 0, idleMillis: 0 };
  }
}
