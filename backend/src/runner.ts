import { listRunningAgents } from './agentService.js';
import { runAgentTick } from './tick.js';
import { getSchedulerIntervalMs } from './config.js';

let timer: NodeJS.Timeout | null = null;

/** Starts the in-process scheduler: every interval, runs a tick for every 'running' agent
 *  (each agent's own `intervalSeconds` further throttles how often it actually acts). */
export function startScheduler(): void {
  if (timer) return;
  const tick = async () => {
    const agents = listRunningAgents();
    for (const agent of agents) {
      try {
        await runAgentTick(agent);
      } catch (error) {
        console.error(`[scheduler] agent ${agent.id} tick failed:`, error);
      }
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
