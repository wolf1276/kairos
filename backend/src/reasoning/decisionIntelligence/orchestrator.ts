// Decision Intelligence orchestrator: timeout, retry with exponential backoff, structured-output
// request, normalization, and fail-closed validation. Parallels providers/baseProvider.ts's
// pattern intentionally (same constants/shape) rather than reusing it directly, since
// BaseProvider.generateDecision is irreducibly coupled to CandidateDecision's schema/validator —
// see types.ts's header comment for why. providers/ itself is never modified.
import { deriveAllowedPolicy } from '../validation.js';
import { requestDecisionIntelligenceCompletion } from './requestClient.js';
import { parseStrictJson, MalformedDecisionIntelligenceError } from './schema.js';
import { normalizeToDecisionIntelligence } from './normalize.js';
import { validateDecisionIntelligence } from './validation.js';
import { recordDecisionIntelligenceCall } from './metrics.js';
import { ProviderError } from '../providers/errors.js';
import type { ReasoningContext, Prompt } from '../types.js';
import type { ProviderName } from '../providers/types.js';
import type { DecisionIntelligenceProviderConfig, DecisionIntelligenceProviderName } from './requestClient.js';
import type { DecisionIntelligence, DecisionIntelligenceValidationResult } from './types.js';

const RETRY_BACKOFF_BASE_MS = 250;
const RETRY_BACKOFF_MAX_MS = 4000;

function backoffDelayMs(attempt: number): number {
  const exponential = Math.min(RETRY_BACKOFF_MAX_MS, RETRY_BACKOFF_BASE_MS * 2 ** attempt);
  return exponential + Math.random() * RETRY_BACKOFF_BASE_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toProviderError(err: unknown, provider: DecisionIntelligenceProviderName, aborted: boolean): ProviderError {
  const p = provider as ProviderName; // string field only — see requestClient.ts's asProviderErrorProvider
  if (err instanceof ProviderError) return err;
  if (aborted) return new ProviderError('timeout', p, 'request timed out');
  if (err instanceof MalformedDecisionIntelligenceError) return new ProviderError('invalid_json', p, err.message);
  const message = err instanceof Error ? err.message : String(err);
  return new ProviderError('network', p, message);
}

export interface GenerateDecisionIntelligenceResult {
  decision: DecisionIntelligence;
  validation: DecisionIntelligenceValidationResult;
}

/**
 * Generates one Decision Intelligence result for a ReasoningContext + Prompt (built with the
 * Phase 3 `v2` prompt template). No execution, no blockchain interaction, no memory writes — this
 * is a pure request/validate pipeline, same contract as Phase 2's provider layer but targeting
 * the richer Decision Intelligence schema.
 */
export async function generateDecisionIntelligence(
  context: ReasoningContext,
  prompt: Prompt,
  config: DecisionIntelligenceProviderConfig
): Promise<GenerateDecisionIntelligenceResult> {
  const start = performance.now();
  const errProvider = config.provider as ProviderName; // string field only — see requestClient.ts
  let retryCount = 0;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await requestDecisionIntelligenceCompletion(config, prompt, controller.signal);
      clearTimeout(timer);
      const reasoningDurationMs = performance.now() - start;

      const modelOutput = parseStrictJson(response.raw);
      const decision = normalizeToDecisionIntelligence({
        modelOutput,
        providerVersion: `${config.provider}:${config.model}`,
        reasoningDurationMs,
        promptHash: prompt.promptHash,
      });

      const validationStart = performance.now();
      const validation = validateDecisionIntelligence(decision, {
        allowed: deriveAllowedPolicy(context),
        maxAllocationPct: context.userPolicy.maxAllocationPct,
      });
      const validationDurationMs = performance.now() - validationStart;

      if (!validation.ok) {
        recordDecisionIntelligenceCall({
          provider: config.provider, model: config.model, reasoningDurationMs, validationDurationMs,
          confidence: 0, alternativeCount: decision.alternatives?.length ?? 0, evidenceCount: decision.evidence?.length ?? 0,
          uncertaintyScore: 0, promptTokens: response.promptTokens, completionTokens: response.completionTokens,
          totalTokens: response.totalTokens, providerLatencyMs: reasoningDurationMs, retryCount, failed: true,
          errorKind: 'validation_failed',
        });
        throw new ProviderError('validation_failed', errProvider, validation.errors.join('; '));
      }

      recordDecisionIntelligenceCall({
        provider: config.provider, model: config.model, reasoningDurationMs, validationDurationMs,
        confidence: decision.confidence.overall, alternativeCount: decision.alternatives.length,
        evidenceCount: decision.evidence.length, uncertaintyScore: decision.uncertainty.score,
        promptTokens: response.promptTokens, completionTokens: response.completionTokens,
        totalTokens: response.totalTokens, providerLatencyMs: reasoningDurationMs, retryCount, failed: false,
      });

      return { decision, validation };
    } catch (err) {
      clearTimeout(timer);
      const providerError = toProviderError(err, config.provider, controller.signal.aborted);
      const isLastAttempt = attempt === config.maxRetries;

      if (!providerError.retryable || isLastAttempt) {
        if (providerError.kind !== 'validation_failed') {
          recordDecisionIntelligenceCall({
            provider: config.provider, model: config.model, reasoningDurationMs: performance.now() - start,
            validationDurationMs: 0, confidence: 0, alternativeCount: 0, evidenceCount: 0, uncertaintyScore: 0,
            promptTokens: 0, completionTokens: 0, totalTokens: 0, providerLatencyMs: performance.now() - start,
            retryCount, failed: true, errorKind: providerError.kind,
          });
        }
        throw providerError;
      }
      retryCount += 1;
      await sleep(backoffDelayMs(attempt));
    }
  }

  throw new ProviderError('provider_unavailable', errProvider, 'exhausted retries without a result');
}
