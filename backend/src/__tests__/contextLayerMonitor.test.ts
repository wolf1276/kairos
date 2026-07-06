// Operational monitoring tests for the Context Layer: health summary computation, threshold
// warnings, the periodic self-check loop, and the /api/context-health route. Pure additions —
// no change to contextBuilder.ts or any domain builder.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.CONTEXT_MONITOR_INTERVAL_MS;
});

describe('monitor — health summary computation', () => {
  it('reports healthy with no warnings when metrics are all clean', async () => {
    const { resetContextMetrics, recordContextBuild, recordCacheHit, recordCacheMiss, recordValidation, recordQuality } = await import(
      '../agentContext/metrics.js'
    );
    const { getContextHealthSummary } = await import('../agentContext/monitor.js');
    resetContextMetrics();

    for (let i = 0; i < 25; i++) {
      recordContextBuild(10, 'success');
      recordValidation(true, []);
      recordQuality(0.9, 'high');
    }
    for (let i = 0; i < 20; i++) recordCacheHit();
    for (let i = 0; i < 2; i++) recordCacheMiss();

    const summary = getContextHealthSummary();
    expect(summary.status).toBe('healthy');
    expect(summary.warnings).toEqual([]);
    expect(summary.successRate).toBe(1);
    expect(summary.validationFailureRate).toBe(0);
  });

  it('flags LOW_SUCCESS_RATE when too many builds fail', async () => {
    const { resetContextMetrics, recordContextBuild } = await import('../agentContext/metrics.js');
    const { getContextHealthSummary } = await import('../agentContext/monitor.js');
    resetContextMetrics();

    for (let i = 0; i < 10; i++) recordContextBuild(10, 'success');
    for (let i = 0; i < 5; i++) recordContextBuild(10, 'failure');

    const summary = getContextHealthSummary();
    expect(summary.status).toBe('degraded');
    expect(summary.warnings.some((w) => w.code === 'LOW_SUCCESS_RATE')).toBe(true);
  });

  it('does not evaluate success rate with zero builds recorded (avoids a false positive on an idle system)', async () => {
    const { resetContextMetrics } = await import('../agentContext/metrics.js');
    const { getContextHealthSummary } = await import('../agentContext/monitor.js');
    resetContextMetrics();

    const summary = getContextHealthSummary();
    expect(summary.status).toBe('healthy');
    expect(summary.warnings).toEqual([]);
  });

  it('flags HIGH_VALIDATION_FAILURE_RATE when validation fails often', async () => {
    const { resetContextMetrics, recordValidation } = await import('../agentContext/metrics.js');
    const { getContextHealthSummary } = await import('../agentContext/monitor.js');
    resetContextMetrics();

    for (let i = 0; i < 3; i++) recordValidation(true, []);
    for (let i = 0; i < 7; i++) recordValidation(false, ['Some error']);

    const summary = getContextHealthSummary();
    expect(summary.warnings.some((w) => w.code === 'HIGH_VALIDATION_FAILURE_RATE')).toBe(true);
    expect(summary.validationFailureRate).toBeCloseTo(0.7, 5);
  });

  it('flags LOW_CACHE_HIT_RATE only once there is enough cache traffic to be meaningful', async () => {
    const { resetContextMetrics, recordCacheHit, recordCacheMiss } = await import('../agentContext/metrics.js');
    const { getContextHealthSummary } = await import('../agentContext/monitor.js');
    resetContextMetrics();

    // Below the sample-size floor: 1 hit, 2 misses (33% hit rate) — should NOT warn yet.
    recordCacheHit();
    recordCacheMiss();
    recordCacheMiss();
    let summary = getContextHealthSummary();
    expect(summary.warnings.some((w) => w.code === 'LOW_CACHE_HIT_RATE')).toBe(false);

    // Now push past the sample floor while keeping the hit rate low.
    for (let i = 0; i < 20; i++) recordCacheMiss();
    summary = getContextHealthSummary();
    expect(summary.warnings.some((w) => w.code === 'LOW_CACHE_HIT_RATE')).toBe(true);
  });

  it('flags HIGH_SLOW_BUILD_RATE when too many builds cross the slow-build threshold', async () => {
    const { resetContextMetrics, recordContextBuild } = await import('../agentContext/metrics.js');
    const { getContextHealthSummary } = await import('../agentContext/monitor.js');
    resetContextMetrics();

    for (let i = 0; i < 10; i++) recordContextBuild(10, 'success'); // fast
    for (let i = 0; i < 5; i++) recordContextBuild(999, 'success'); // slow (>=500ms threshold)

    const summary = getContextHealthSummary();
    expect(summary.warnings.some((w) => w.code === 'HIGH_SLOW_BUILD_RATE')).toBe(true);
  });

  it('flags LOW_AVG_QUALITY when average quality score is low', async () => {
    const { resetContextMetrics, recordQuality } = await import('../agentContext/metrics.js');
    const { getContextHealthSummary } = await import('../agentContext/monitor.js');
    resetContextMetrics();

    for (let i = 0; i < 5; i++) recordQuality(0.1, 'low');

    const summary = getContextHealthSummary();
    expect(summary.warnings.some((w) => w.code === 'LOW_AVG_QUALITY')).toBe(true);
  });

  it('accumulates multiple independent warnings at once', async () => {
    const { resetContextMetrics, recordContextBuild, recordValidation, recordQuality } = await import('../agentContext/metrics.js');
    const { getContextHealthSummary } = await import('../agentContext/monitor.js');
    resetContextMetrics();

    for (let i = 0; i < 5; i++) recordContextBuild(10, 'failure');
    for (let i = 0; i < 5; i++) recordValidation(false, ['bad']);
    for (let i = 0; i < 5; i++) recordQuality(0.05, 'low');

    const summary = getContextHealthSummary();
    expect(summary.status).toBe('degraded');
    expect(summary.warnings.length).toBeGreaterThanOrEqual(3);
    const codes = summary.warnings.map((w) => w.code);
    expect(codes).toContain('LOW_SUCCESS_RATE');
    expect(codes).toContain('HIGH_VALIDATION_FAILURE_RATE');
    expect(codes).toContain('LOW_AVG_QUALITY');
  });

  it('every warning carries a structured code/message/observed/threshold shape', async () => {
    const { resetContextMetrics, recordContextBuild } = await import('../agentContext/metrics.js');
    const { getContextHealthSummary } = await import('../agentContext/monitor.js');
    resetContextMetrics();
    for (let i = 0; i < 5; i++) recordContextBuild(10, 'failure');

    const summary = getContextHealthSummary();
    for (const w of summary.warnings) {
      expect(typeof w.code).toBe('string');
      expect(typeof w.message).toBe('string');
      expect(typeof w.observed).toBe('number');
      expect(typeof w.threshold).toBe('number');
    }
  });
});

describe('monitor — periodic self-check loop', () => {
  it('start/stop is idempotent and mirrors runner.ts scheduler semantics', async () => {
    const { startContextMonitor, stopContextMonitor, isContextMonitorRunning } = await import('../agentContext/monitor.js');
    expect(isContextMonitorRunning()).toBe(false);
    startContextMonitor();
    expect(isContextMonitorRunning()).toBe(true);
    startContextMonitor(); // no-op, doesn't throw or double-schedule
    expect(isContextMonitorRunning()).toBe(true);
    stopContextMonitor();
    expect(isContextMonitorRunning()).toBe(false);
    stopContextMonitor(); // no-op
    expect(isContextMonitorRunning()).toBe(false);
  });

  it('runs an immediate check on start, populating getLastContextHealthSummary()', async () => {
    const { resetContextMetrics } = await import('../agentContext/metrics.js');
    const { startContextMonitor, stopContextMonitor, getLastContextHealthSummary } = await import('../agentContext/monitor.js');
    resetContextMetrics();

    expect(getLastContextHealthSummary()).toBeNull();
    startContextMonitor();
    try {
      const last = getLastContextHealthSummary();
      expect(last).not.toBeNull();
      expect(last!.status).toBe('healthy');
    } finally {
      stopContextMonitor();
    }
  });

  it('logs a structured warning via console.warn when the self-check finds a degraded state', async () => {
    process.env.CONTEXT_MONITOR_INTERVAL_MS = '100000'; // long enough that only the immediate check fires
    const { resetContextMetrics, recordContextBuild } = await import('../agentContext/metrics.js');
    const { startContextMonitor, stopContextMonitor } = await import('../agentContext/monitor.js');
    resetContextMetrics();
    for (let i = 0; i < 5; i++) recordContextBuild(10, 'failure');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startContextMonitor();
    try {
      expect(warnSpy).toHaveBeenCalledWith('[context-monitor] degraded:', expect.stringContaining('LOW_SUCCESS_RATE'));
    } finally {
      stopContextMonitor();
      warnSpy.mockRestore();
    }
  });

  it('does not log a warning when the self-check finds a healthy state', async () => {
    const { resetContextMetrics, recordContextBuild, recordValidation, recordQuality } = await import('../agentContext/metrics.js');
    const { startContextMonitor, stopContextMonitor } = await import('../agentContext/monitor.js');
    resetContextMetrics();
    for (let i = 0; i < 10; i++) {
      recordContextBuild(10, 'success');
      recordValidation(true, []);
      recordQuality(0.9, 'high');
    }

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startContextMonitor();
    try {
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      stopContextMonitor();
      warnSpy.mockRestore();
    }
  });
});

describe('monitor — no effect on Context generation', () => {
  it('getContextHealthSummary() never touches contextBuilder.js/buildAgentContext', async () => {
    const contextBuilderModule = await import('../agentContext/contextBuilder.js');
    const buildSpy = vi.spyOn(contextBuilderModule, 'buildAgentContext');
    const { getContextHealthSummary } = await import('../agentContext/monitor.js');

    getContextHealthSummary();
    expect(buildSpy).not.toHaveBeenCalled();
  });
});
