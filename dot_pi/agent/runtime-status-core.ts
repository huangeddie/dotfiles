export type RuntimeDistribution = {
  wallMillis: number;
  modelMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
  unaccountedMillis: number;
};

type RuntimeCategoryMillis = Omit<RuntimeDistribution, "wallMillis">;

type Interval = { startedAt: number; endedAt: number | null };

export class RuntimeTimeline {
  private sessionStartedAt: number | null = null;
  private sessionEndedAt: number | null = null;
  private processingIntervals: Interval[] = [];
  private openProcessingInterval: Interval | null = null;
  private providerIntervals: Interval[] = [];
  private openProviderInterval: Interval | null = null;
  private tools: Map<string, Interval> = new Map();

  reset(): void {
    this.sessionStartedAt = null;
    this.sessionEndedAt = null;
    this.processingIntervals = [];
    this.openProcessingInterval = null;
    this.providerIntervals = [];
    this.openProviderInterval = null;
    this.tools.clear();
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

  startTool(toolCallId: string, now: number): void {
    if (this.sessionStartedAt === null || this.tools.has(toolCallId)) {
      return;
    }
    this.tools.set(toolCallId, { startedAt: now, endedAt: null });
  }

  endTool(toolCallId: string, now: number): void {
    const interval = this.tools.get(toolCallId);
    if (!interval || interval.endedAt !== null) {
      return;
    }
    this.endInterval(interval, now);
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
      toolWaitMillis: 0,
      idleMillis: 0,
      unaccountedMillis: 0,
    };
    const sessionStartedAt = this.sessionStartedAt;
    if (sessionStartedAt === null) {
      return { wallMillis: 0, ...totals };
    }

    const effectiveEnd = Math.max(sessionStartedAt, this.sessionEndedAt ?? now);
    const toolIntervals = Array.from(this.tools.values());
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
      } else if (toolIntervals.some((interval) =>
        this.isCoveredBy([interval], segmentStartedAt, effectiveEnd)
      )) {
        totals.toolWaitMillis += duration;
      } else if (this.isCoveredBy(this.providerIntervals, segmentStartedAt, effectiveEnd)) {
        totals.modelMillis += duration;
      } else {
        totals.unaccountedMillis += duration;
      }
    }

    const wallMillis = effectiveEnd - sessionStartedAt;
    if (
      totals.modelMillis + totals.toolWaitMillis + totals.idleMillis +
        totals.unaccountedMillis !== wallMillis
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
