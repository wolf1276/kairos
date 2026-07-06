// Context Validation — the gate every AgentContext must pass before it's considered fit for any
// future AI layer to consume. Pure checks over already-assembled domain views; makes no I/O calls
// of its own.
import type { MarketContextView } from './domains/marketContext.js';
import type { ManagedCapitalContextView } from './domains/capitalContext.js';
import type { PolicyContextView } from './domains/policyContext.js';
import type { SystemContextView } from './domains/systemContext.js';
import { AGENT_CONTEXT_SCHEMA_VERSION } from './types.js';

const MAX_ORACLE_AGE_SECONDS = 900; // 15 minutes — well beyond any supported candle resolution
const ALLOCATION_SUM_TOLERANCE_PCT = 0.5; // xlmPct + usdcPct should sum to ~100; a small rounding
// tolerance, not a hard 100.0 equality — floating point allocation math ends up ever-so-slightly off.

export interface ContextValidationInput {
  market: MarketContextView;
  capital: ManagedCapitalContextView;
  policy: PolicyContextView;
  system: SystemContextView;
  schemaVersion?: string;
}

export interface ContextValidationResult {
  ok: boolean;
  errors: string[];
}

/** Single source of truth for "is this a usable number" — every numeric check below routes
 *  through this rather than repeating `Number.isFinite(...)` inline. */
function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateAgentContext(input: ContextValidationInput): ContextValidationResult {
  const errors: string[] = [];

  if (input.market.oracle.ageSeconds > MAX_ORACLE_AGE_SECONDS) {
    errors.push(`Oracle data is stale (${input.market.oracle.ageSeconds}s old, max ${MAX_ORACLE_AGE_SECONDS}s)`);
  }
  if (!isValidNumber(input.market.price) || input.market.price <= 0) {
    errors.push('Market price is missing or invalid');
  }
  if (!isValidNumber(input.capital.totalManagedCapital)) {
    errors.push('Managed capital did not load');
  }
  if (!isValidNumber(input.capital.deployableCapital) || input.capital.deployableCapital < 0) {
    errors.push('Deployable capital is missing or invalid');
  }
  if (!isValidNumber(input.capital.allocation.xlmPct) || !isValidNumber(input.capital.allocation.usdcPct)) {
    errors.push('Portfolio allocation is incomplete');
  } else if (Math.abs(input.capital.allocation.xlmPct + input.capital.allocation.usdcPct - 100) > ALLOCATION_SUM_TOLERANCE_PCT) {
    errors.push(
      `Portfolio allocation is inconsistent (xlmPct + usdcPct = ${input.capital.allocation.xlmPct + input.capital.allocation.usdcPct}, expected ~100)`
    );
  }
  if (!isValidNumber(input.capital.idleCapital) || input.capital.idleCapital < 0) {
    errors.push('Idle capital is missing or invalid');
  }
  for (const position of input.capital.protocolExposure) {
    const amount = parseFloat(position.amount);
    if (!isValidNumber(amount) || amount < 0) {
      errors.push(`Protocol exposure amount is invalid for ${position.protocolId}/${position.asset}`);
      break;
    }
  }
  if (input.policy.objective === 'unassigned') {
    errors.push('No policy/role assigned to this agent — cannot authorize any action');
  }
  if (!input.system.oracleHealthy) {
    errors.push('System reports oracle unhealthy');
  }
  if (input.policy.allowedProtocols.length === 0 && input.capital.protocolExposure.length > 0) {
    errors.push('Agent holds protocol exposure but no protocol is currently allowed by policy');
  }
  if (input.schemaVersion !== undefined && input.schemaVersion !== AGENT_CONTEXT_SCHEMA_VERSION) {
    errors.push(`Unsupported context schema version (${input.schemaVersion}, expected ${AGENT_CONTEXT_SCHEMA_VERSION})`);
  }

  return { ok: errors.length === 0, errors };
}
