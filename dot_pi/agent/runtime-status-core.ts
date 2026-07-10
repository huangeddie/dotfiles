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

const categories = ["generatingMillis", "toolWaitMillis", "idleMillis"] as const;

function isMillis(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validateRuntimeStatusReport(value: unknown): RuntimeStatusReport | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) {
    return null;
  }

  if (
    !isMillis(candidate.observedMillis) ||
    !isMillis(candidate.generatingMillis) ||
    !isMillis(candidate.toolWaitMillis) ||
    !isMillis(candidate.idleMillis)
  ) {
    return null;
  }

  if (
    candidate.observedMillis !==
    candidate.generatingMillis + candidate.toolWaitMillis + candidate.idleMillis
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
    return { generatingMillis: 0, toolWaitMillis: 0, idleMillis: 0 };
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
    generatingMillis: floors[0],
    toolWaitMillis: floors[1],
    idleMillis: floors[2],
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

export class ToolIntervalLedger {
  private intervals: Map<string, ToolInterval> = new Map();
  private sequence = 0;

  start(toolCallId: string, startedAt: number): void {
    this.intervals.set(toolCallId, {
      toolCallId,
      sequence: this.sequence++,
      startedAt,
      endedAt: null,
      subagentReport: null,
    });
  }

  end(toolCallId: string, endedAt: number): void {
    const interval = this.intervals.get(toolCallId);
    if (interval) {
      interval.endedAt = endedAt;
    }
  }

  attachSubagentReport(toolCallId: string, report: RuntimeStatusReport): void {
    const interval = this.intervals.get(toolCallId);
    if (!interval) {
      return;
    }
    interval.subagentReport = validateRuntimeStatusReport(report);
  }

  project(now: number): RuntimeCategoryMillis {
    const totals: RuntimeCategoryMillis = {
      generatingMillis: 0,
      toolWaitMillis: 0,
      idleMillis: 0,
    };

    const intervals = Array.from(this.intervals.values());
    if (intervals.length === 0) {
      return totals;
    }

    const boundaries = new Set<number>();
    for (const interval of intervals) {
      boundaries.add(interval.startedAt);
      boundaries.add(interval.endedAt ?? now);
    }
    const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

    const ownedDuration = new Map<string, number>();
    for (let i = 0; i < sortedBoundaries.length - 1; i++) {
      const segmentStart = sortedBoundaries[i];
      const segmentEnd = sortedBoundaries[i + 1];
      if (segmentEnd <= segmentStart) {
        continue;
      }
      const segmentDuration = segmentEnd - segmentStart;

      let ownerId: string | null = null;
      let ownerSequence = Infinity;
      for (const interval of intervals) {
        const effectiveEnd = interval.endedAt ?? now;
        if (interval.startedAt <= segmentStart && effectiveEnd > segmentStart) {
          if (interval.subagentReport && interval.sequence < ownerSequence) {
            ownerSequence = interval.sequence;
            ownerId = interval.toolCallId;
          }
        }
      }

      if (ownerId !== null) {
        ownedDuration.set(ownerId, (ownedDuration.get(ownerId) ?? 0) + segmentDuration);
      } else {
        totals.toolWaitMillis += segmentDuration;
      }
    }

    for (const interval of intervals) {
      const owned = ownedDuration.get(interval.toolCallId) ?? 0;
      if (owned <= 0 || !interval.subagentReport) {
        continue;
      }

      const report = interval.subagentReport;
      const effectiveEnd = interval.endedAt ?? now;
      const parentSubagentToolMillis = effectiveEnd - interval.startedAt;
      if (parentSubagentToolMillis <= 0) {
        totals.toolWaitMillis += owned;
        continue;
      }

      const attributable = Math.round(
        owned * Math.min(1, report.observedMillis / parentSubagentToolMillis),
      );
      const scaled = scaleReport(report, attributable);
      totals.generatingMillis += scaled.generatingMillis;
      totals.toolWaitMillis += scaled.toolWaitMillis;
      totals.idleMillis += scaled.idleMillis;
      totals.toolWaitMillis += owned - attributable;
    }

    return totals;
  }
}
