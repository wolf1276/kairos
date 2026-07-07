// Bridges a frozen ExecutionPlan (Phase 5) into RouteRequests the Route Engine can consume.
// Read-only with respect to the plan — never mutates or re-derives plan fields, only projects
// them into the Route Engine's own vocabulary.
import type { ExecutionPlan, PlanStep } from '../executionPlanner/types.js';
import type { ProtocolRegistry } from '../../protocolAdapters/registry.js';
import { computeRoute } from './routeEngine.js';
import type { ExecutionRoute, RouteAction, RouteEngineOptions, RouteRequest } from './types.js';

/** PrimaryAction ('HOLD'|'DEPOSIT'|'WITHDRAW'|'SWAP'|'REBALANCE', see decisionIntelligence/
 *  types.ts) has no lending/borrowing/reward-claim vocabulary of its own — those only exist at
 *  the protocol-adapter level. A plan step whose action doesn't map onto a RouteAction (HOLD,
 *  no_op, or an action type this mapping doesn't recognize) has nothing to route and is skipped
 *  by `routeRequestsFromPlan`, never sent to the Route Engine. REBALANCE is treated as a SWAP —
 *  the plan's own protocolRouting/assetRouting has already decided *what* moves; the Route
 *  Engine's job is only to decide *which protocol* executes that movement. */
const PLAN_ACTION_TO_ROUTE_ACTION: Partial<Record<PlanStep['action'], RouteAction>> = {
  SWAP: 'SWAP',
  REBALANCE: 'SWAP',
  DEPOSIT: 'DEPOSIT',
  WITHDRAW: 'WITHDRAW',
};

export interface PlanRouteRequestOptions {
  network: string;
  /** Resolves a step's fractional `allocation` into an absolute amount string for the RouteRequest.
   *  Defaults to the allocation itself as a decimal string (0-1) when not supplied — a caller that
   *  has the plan's underlying capital amount should supply this to get real trade sizes. */
  resolveAmount?: (step: PlanStep) => string;
  outputAssetFor?: (step: PlanStep) => string | undefined;
  liquidityHints?: Record<string, number>;
}

export function routeRequestsFromPlan(plan: ExecutionPlan, options: PlanRouteRequestOptions): { step: PlanStep; request: RouteRequest }[] {
  const resolveAmount = options.resolveAmount ?? ((step: PlanStep) => step.allocation.toString());
  return plan.steps
    .filter((step): step is PlanStep & { action: RouteAction } => step.type === 'execute' && step.action in PLAN_ACTION_TO_ROUTE_ACTION)
    .map((step) => {
      const action = PLAN_ACTION_TO_ROUTE_ACTION[step.action] as RouteAction;
      const request: RouteRequest = {
        action,
        asset: step.asset,
        outputAsset: options.outputAssetFor?.(step),
        amount: resolveAmount(step),
        network: options.network,
        liquidityHints: options.liquidityHints,
      };
      return { step, request };
    });
}

/** Computes one ExecutionRoute per routable step in the plan, in plan step order. Each route is
 *  independent (no shared state), so this is safe to call for a plan with many steps without
 *  route N's outcome affecting route N+1's discovery/ranking. */
export async function computeRoutesForPlan(plan: ExecutionPlan, registry: ProtocolRegistry, options: PlanRouteRequestOptions & RouteEngineOptions): Promise<{ stepId: string; route: ExecutionRoute }[]> {
  const requests = routeRequestsFromPlan(plan, options);
  const routes = await Promise.all(requests.map(({ request }) => computeRoute(request, registry, options)));
  return requests.map(({ step }, index) => ({ stepId: step.stepId, route: routes[index] }));
}
