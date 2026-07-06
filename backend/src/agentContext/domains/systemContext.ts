// System Context domain — platform health the AI must know before reasoning about anything
// else. Pure read of existing service state (scheduler, price feed, config flags) — starts/stops
// nothing, writes nothing.
import { isSchedulerRunning } from '../../runner.js';
import { getPriceFeedService } from '../../priceFeed.js';
import { isProtocolExecutionEnabled } from '../../config.js';
import type { AgentRow } from '../../db.js';
import type { FeatureBuildResult } from '../featureEngine.js';

const ORACLE_STALE_AFTER_SECONDS_MULTIPLIER = 3;

export interface SystemContextView {
  oracleHealthy: boolean;
  schedulerRunning: boolean;
  priceFeedRunning: boolean;
  /** Whether this specific agent is in the 'running' state — distinct from `schedulerRunning`
   *  (a platform-wide signal). A stopped/errored agent must never report `executionAvailable:
   *  true` just because the scheduler process happens to be up for other agents. */
  agentRunning: boolean;
  protocolExecutionAvailable: boolean;
  executionAvailable: boolean;
  featureFlags: Record<string, boolean>;
  /** 0-1 — fraction of the platform-health signals that are currently green (oracle, scheduler,
   *  price feed). protocolExecutionAvailable is a feature flag, not a health signal, so it's
   *  excluded from this score. agentRunning is this agent's own state, not a platform-health
   *  signal, so it's also excluded — a stopped agent still has a fully healthy platform under it. */
  confidence: number;
}

/**
 * Oracle is considered healthy when its last candle isn't older than
 * `ORACLE_STALE_AFTER_SECONDS_MULTIPLIER` resolution buckets — the same staleness a scheduler
 * running on schedule would naturally produce; anything beyond that means Horizon/the feed
 * has stalled.
 */
export function buildSystemContextView(agentRow: AgentRow, result: FeatureBuildResult, intervalSeconds: number, now = Date.now()): SystemContextView {
  const ageSeconds = Math.max(0, (now - result.oracleTimestamp) / 1000);
  const oracleHealthy = ageSeconds <= intervalSeconds * ORACLE_STALE_AFTER_SECONDS_MULTIPLIER;
  const schedulerRunning = isSchedulerRunning();
  const priceFeedRunning = getPriceFeedService().isRunning();
  const agentRunning = agentRow.status === 'running';
  const protocolExecutionAvailable = isProtocolExecutionEnabled();

  const healthSignals = [oracleHealthy, schedulerRunning, priceFeedRunning];
  const confidence = healthSignals.filter(Boolean).length / healthSignals.length;

  return {
    oracleHealthy,
    schedulerRunning,
    priceFeedRunning,
    agentRunning,
    protocolExecutionAvailable,
    // A stopped/paused/errored agent must never be reported as execution-available purely
    // because the platform-wide scheduler and oracle are healthy — this is the signal a future
    // execution/authorization layer would check before acting, so it must reflect this agent's
    // own status, not just the platform's.
    executionAvailable: oracleHealthy && schedulerRunning && agentRunning,
    featureFlags: {
      protocolExecutionEnabled: protocolExecutionAvailable,
    },
    confidence,
  };
}
