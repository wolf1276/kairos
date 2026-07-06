import { listRunningAgents, claimAgentLock, releaseAgentLock } from './agentService.js';
import { runAgentTick } from './tick.js';
import { getSchedulerIntervalMs } from './config.js';

let timer: NodeJS.Timeout | null = null;
// Guards against overlapping cycles *within this process*: each agent's own due-check reads
// `last_tick_at` from the DB at the *start* of its tick and only writes it back once the tick
// (oracle read + LLM call + execution) fully completes. If a cycle runs long enough to still be
// in flight when the next `setInterval` fires, an overlapping cycle in the same process would
// re-read the same stale `last_tick_at`, pass the "not due yet" check again, and execute the
// same agent's trade twice concurrently. This flag makes a slow cycle skip the next tick instead
// of overlapping it.
let cycleInProgress = false;

/** Starts the in-process scheduler: every interval, runs a tick for every 'running' agent
 *  (each agent's own `intervalSeconds` further throttles how often it actually acts).
 *
 *  `cycleInProgress` above only protects against overlap within one process. If this backend
 *  is ever run as more than one process/instance against the same DB (horizontal scaling,
 *  blue/green deploy overlap), each instance's own `cycleInProgress` flag can't see the other's
 *  in-flight cycle, so both could tick the same agent at once. `claimAgentLock` closes that gap
 *  with an atomic conditional UPDATE that only one process's claim can win for a given agent,
 *  regardless of how many processes are running. */
export function startScheduler(): void {
  if (timer) return;
  const tick = async () => {
    if (cycleInProgress) return;
    cycleInProgress = true;
    try {
      const agents = listRunningAgents();
      for (const agent of agents) {
        const lockToken = claimAgentLock(agent.id);
        if (!lockToken) continue; // another process is already ticking this agent
        try {
          await runAgentTick(agent);
        } catch (error) {
          console.error(`[scheduler] agent ${agent.id} tick failed:`, error);
        } finally {
          releaseAgentLock(agent.id, lockToken);
        }
      }
    } finally {
      cycleInProgress = false;
    }
  };
  timer = setInterval(tick, getSchedulerIntervalMs());
  tick();
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Read-only status check for the System Context domain — true once startScheduler() has been
 *  called and stopScheduler() hasn't since. */
export function isSchedulerRunning(): boolean {
  return timer !== null;
}
