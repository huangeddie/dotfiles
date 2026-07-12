export type RuntimeStatusReport = {
  version: 2;
  observedMillis: number;
  modelMillis: number;
  fileOpsMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
  unaccountedMillis: number;
};

export type RuntimeCategoryMillis = Pick<
  RuntimeStatusReport,
  "modelMillis" | "fileOpsMillis" | "toolWaitMillis" | "idleMillis" | "unaccountedMillis"
>;

export type RuntimeDistribution = RuntimeCategoryMillis & {
  wallMillis: number;
};

export type SubagentReportSink = {
  attachSubagentReport(toolCallId: string, report: RuntimeStatusReport): void;
};

export type RootToolClassification = "fileOps" | "toolWait";

export type ReportStore = {
  create(): Promise<string>;
  readAndRemove(path: string): Promise<unknown | null>;
  writeAtomically(path: string, report: RuntimeStatusReport): Promise<void>;
  remove(path: string): Promise<void>;
};

const categories = [
  "modelMillis",
  "fileOpsMillis",
  "toolWaitMillis",
  "idleMillis",
  "unaccountedMillis",
] as const;

function isMillis(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validateRuntimeStatusReport(value: unknown): RuntimeStatusReport | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 2) {
    return null;
  }

  if (
    !isMillis(candidate.observedMillis) ||
    !isMillis(candidate.modelMillis) ||
    !isMillis(candidate.fileOpsMillis) ||
    !isMillis(candidate.toolWaitMillis) ||
    !isMillis(candidate.idleMillis) ||
    !isMillis(candidate.unaccountedMillis)
  ) {
    return null;
  }

  if (
    candidate.observedMillis !==
    candidate.modelMillis + candidate.fileOpsMillis + candidate.toolWaitMillis +
      candidate.idleMillis + candidate.unaccountedMillis
  ) {
    return null;
  }

  return value as RuntimeStatusReport;
}

export function scaleReport(
  report: RuntimeStatusReport,
  targetMillis: number,
): RuntimeCategoryMillis {
  const total = report.observedMillis;
  if (total === 0 || targetMillis <= 0) {
    return {
      modelMillis: 0,
      fileOpsMillis: 0,
      toolWaitMillis: 0,
      idleMillis: 0,
      unaccountedMillis: 0,
    };
  }

  const raw = categories.map((category) => (targetMillis * report[category]) / total);
  const floors = raw.map(Math.floor);
  const deficit = targetMillis - floors.reduce((sum, floor) => sum + floor, 0);

  const indices = floors.map((_, index) => index);
  indices.sort((a, b) => {
    const remainderA = raw[a] - floors[a];
    const remainderB = raw[b] - floors[b];
    if (remainderB !== remainderA) {
      return remainderB - remainderA;
    }
    return a - b;
  });

  for (let i = 0; i < deficit; i++) {
    floors[indices[i]]++;
  }

  return {
    modelMillis: floors[0],
    fileOpsMillis: floors[1],
    toolWaitMillis: floors[2],
    idleMillis: floors[3],
    unaccountedMillis: floors[4],
  };
}

export async function publishChildReport(
  store: ReportStore,
  path: string,
  report: RuntimeStatusReport,
): Promise<void> {
  try {
    await store.writeAtomically(path, report);
  } catch {
    // A child report write failure is intentionally non-fatal and must not alter
    // Pi's exit code or response.
  }
}

type Interval = { startedAt: number; endedAt: number | null };

type ToolInterval = Interval & {
  toolCallId: string;
  sequence: number;
  classification: RootToolClassification;
  subagentReport: RuntimeStatusReport | null;
};

export class RuntimeTimeline implements SubagentReportSink {
  private sessionStartedAt: number | null = null;
  private sessionEndedAt: number | null = null;
  private processingIntervals: Interval[] = [];
  private openProcessingInterval: Interval | null = null;
  private providerIntervals: Interval[] = [];
  private openProviderInterval: Interval | null = null;
  private toolIntervals: Map<string, ToolInterval> = new Map();
  private sequence = 0;

  reset(): void {
    this.sessionStartedAt = null;
    this.sessionEndedAt = null;
    this.processingIntervals = [];
    this.openProcessingInterval = null;
    this.providerIntervals = [];
    this.openProviderInterval = null;
    this.toolIntervals.clear();
    this.sequence = 0;
  }

  startSession(now: number): void {
    if (this.sessionStartedAt !== null) {
      return;
    }
    this.sessionStartedAt = now;
  }

  startProcessing(now: number): void {
    if (!this.canStartAt(now) || this.openProcessingInterval) {
      return;
    }
    const interval: Interval = { startedAt: now, endedAt: null };
    this.processingIntervals.push(interval);
    this.openProcessingInterval = interval;
  }

  settle(now: number): void {
    if (!this.openProcessingInterval) {
      return;
    }
    this.endInterval(this.openProcessingInterval, now);
    this.openProcessingInterval = null;
  }

  startProvider(now: number): void {
    if (!this.canStartAt(now) || this.openProviderInterval) {
      return;
    }
    const interval: Interval = { startedAt: now, endedAt: null };
    this.providerIntervals.push(interval);
    this.openProviderInterval = interval;
  }

  endProvider(now: number): void {
    if (!this.openProviderInterval) {
      return;
    }
    this.endInterval(this.openProviderInterval, now);
    this.openProviderInterval = null;
  }

  startTool(toolCallId: string, classification: RootToolClassification, now: number): void {
    if (!this.canStartAt(now) || this.toolIntervals.get(toolCallId)?.endedAt === null) {
      return;
    }
    this.toolIntervals.set(toolCallId, {
      toolCallId,
      classification,
      sequence: this.sequence++,
      startedAt: now,
      endedAt: null,
      subagentReport: null,
    });
  }

  endTool(toolCallId: string, now: number): void {
    const interval = this.toolIntervals.get(toolCallId);
    if (!interval || interval.endedAt !== null) {
      return;
    }
    this.endInterval(interval, now);
  }

  attachSubagentReport(toolCallId: string, report: RuntimeStatusReport): void {
    const interval = this.toolIntervals.get(toolCallId);
    if (!interval) {
      return;
    }
    interval.subagentReport = validateRuntimeStatusReport(report);
  }

  shutdown(now: number): void {
    if (this.sessionStartedAt === null || this.sessionEndedAt !== null) {
      return;
    }
    this.sessionEndedAt = Math.max(now, this.sessionStartedAt);
  }

  snapshot(now: number): RuntimeDistribution {
    const totals: RuntimeCategoryMillis = {
      modelMillis: 0,
      fileOpsMillis: 0,
      toolWaitMillis: 0,
      idleMillis: 0,
      unaccountedMillis: 0,
    };
    const sessionStartedAt = this.sessionStartedAt;
    if (sessionStartedAt === null) {
      return { wallMillis: 0, ...totals };
    }

    const effectiveEnd = Math.max(sessionStartedAt, this.sessionEndedAt ?? now);
    const toolIntervals = Array.from(this.toolIntervals.values());
    const allIntervals = [
      ...this.processingIntervals,
      ...this.providerIntervals,
      ...toolIntervals,
    ];
    const boundaries = new Set<number>([sessionStartedAt, effectiveEnd]);
    for (const interval of allIntervals) {
      const intervalEnd = this.effectiveIntervalEnd(interval, effectiveEnd);
      if (interval.startedAt < effectiveEnd && intervalEnd > sessionStartedAt) {
        boundaries.add(Math.max(interval.startedAt, sessionStartedAt));
        boundaries.add(intervalEnd);
      }
    }

    const ownedDuration = new Map<string, number>();
    const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);
    for (let i = 0; i < sortedBoundaries.length - 1; i++) {
      const segmentStartedAt = sortedBoundaries[i];
      const segmentEndedAt = sortedBoundaries[i + 1];
      if (segmentEndedAt <= segmentStartedAt) {
        continue;
      }

      const duration = segmentEndedAt - segmentStartedAt;
      if (!this.isCoveredBy(this.processingIntervals, segmentStartedAt, effectiveEnd)) {
        totals.idleMillis += duration;
        continue;
      }

      let childOwner: ToolInterval | null = null;
      for (const interval of toolIntervals) {
        if (
          interval.subagentReport &&
          this.isCoveredBy([interval], segmentStartedAt, effectiveEnd) &&
          (!childOwner || interval.sequence < childOwner.sequence)
        ) {
          childOwner = interval;
        }
      }
      if (childOwner) {
        ownedDuration.set(
          childOwner.toolCallId,
          (ownedDuration.get(childOwner.toolCallId) ?? 0) + duration,
        );
        continue;
      }

      if (toolIntervals.some((interval) =>
        interval.classification === "toolWait" &&
        this.isCoveredBy([interval], segmentStartedAt, effectiveEnd)
      )) {
        totals.toolWaitMillis += duration;
      } else if (toolIntervals.some((interval) =>
        interval.classification === "fileOps" &&
        this.isCoveredBy([interval], segmentStartedAt, effectiveEnd)
      )) {
        totals.fileOpsMillis += duration;
      } else if (this.isCoveredBy(this.providerIntervals, segmentStartedAt, effectiveEnd)) {
        totals.modelMillis += duration;
      } else {
        totals.unaccountedMillis += duration;
      }
    }

    for (const interval of toolIntervals) {
      const owned = ownedDuration.get(interval.toolCallId) ?? 0;
      if (owned <= 0 || !interval.subagentReport) {
        continue;
      }

      const parentToolDuration = this.effectiveIntervalEnd(interval, effectiveEnd) - interval.startedAt;
      const attributable = parentToolDuration <= 0
        ? 0
        : Math.round(owned * Math.min(1, interval.subagentReport.observedMillis / parentToolDuration));
      const scaled = scaleReport(interval.subagentReport, attributable);
      totals.modelMillis += scaled.modelMillis;
      totals.fileOpsMillis += scaled.fileOpsMillis;
      totals.toolWaitMillis += scaled.toolWaitMillis + owned - attributable;
      totals.idleMillis += scaled.idleMillis;
      totals.unaccountedMillis += scaled.unaccountedMillis;
    }

    const wallMillis = effectiveEnd - sessionStartedAt;
    if (
      totals.modelMillis + totals.fileOpsMillis + totals.toolWaitMillis +
        totals.idleMillis + totals.unaccountedMillis !== wallMillis
    ) {
      throw new Error("RuntimeTimeline must partition session wall time");
    }
    return { wallMillis, ...totals };
  }

  private canStartAt(now: number): boolean {
    return this.sessionStartedAt !== null && this.sessionEndedAt === null && now >= this.sessionStartedAt;
  }

  private endInterval(interval: Interval, now: number): void {
    interval.endedAt = Math.max(interval.startedAt, now);
  }

  private effectiveIntervalEnd(interval: Interval, effectiveEnd: number): number {
    return Math.min(interval.endedAt ?? effectiveEnd, effectiveEnd);
  }

  private isCoveredBy(intervals: readonly Interval[], at: number, effectiveEnd: number): boolean {
    return intervals.some((interval) =>
      interval.startedAt <= at && this.effectiveIntervalEnd(interval, effectiveEnd) > at
    );
  }
}
