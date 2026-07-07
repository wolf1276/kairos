/** Fires `onTick` every `intervalMs`, never overlapping: if a tick is still awaiting completion
 *  when the next one is due, that cycle is skipped rather than queued or run concurrently. */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private skippedCount = 0;
  private nextExecutionAt: number | null = null;

  constructor(
    private readonly intervalMs: number,
    private readonly onTick: () => Promise<void>,
  ) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError(`Scheduler intervalMs must be a positive number, got ${intervalMs}`);
    }
  }

  start(): void {
    if (this.timer) return;
    this.nextExecutionAt = Date.now() + this.intervalMs;
    this.timer = setInterval(() => {
      this.nextExecutionAt = Date.now() + this.intervalMs;
      void this.runTick();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.nextExecutionAt = null;
  }

  isActive(): boolean {
    return this.timer !== null;
  }

  getSkippedCount(): number {
    return this.skippedCount;
  }

  getNextExecutionAt(): number | null {
    return this.nextExecutionAt;
  }

  private async runTick(): Promise<void> {
    if (this.ticking) {
      this.skippedCount += 1;
      return;
    }
    this.ticking = true;
    try {
      await this.onTick();
    } finally {
      this.ticking = false;
    }
  }
}
