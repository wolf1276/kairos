import { listRunningAgents } from './agentService.js';
import { runAgentTick } from './tick.js';
import { getSchedulerIntervalMs } from './config.js';

let timer: NodeJS.Timeout | null = null;
// Guards against overlapping cycles: each agent's own due-check reads `last_tick_at` from the
// DB at the *start* of its tick and only writes it back once the tick (oracle read + LLM call +
// execution) fully completes. If a cycle runs long enough to still be in flight when the next
// `setInterval` fires, an overlapping cycle would re-read the same stale `last_tick_at`, pass
// the "not due yet" check again, and execute the same agent's trade twice concurrently. This
// flag makes a slow cycle skip the next tick instead of overlapping it.
let cycleInProgress = false;

/** Starts the in-process scheduler: every interval, runs a tick for every 'running' agent
 *  (each agent's own `intervalSeconds` further throttles how often it actually acts). */
export function startScheduler(): void {
  if (timer) return;
  const tick = async () => {
    if (cycleInProgress) return;
    cycleInProgress = true;
    try {
      const agents = listRunningAgents();
      for (const agent of agents) {
        try {
          await runAgentTick(agent);
        } catch (error) {
          console.error(`[scheduler] agent ${agent.id} tick failed:`, error);
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
