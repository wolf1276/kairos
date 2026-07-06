// Shared provider execution: timeout, deterministic retry, JSON parsing, normalization,
// validation, and observability. Concrete providers (openaiProvider.ts, anthropicProvider.ts,
// deepseekProvider.ts) only implement doRequest() — the HTTP call to their own API — everything
// else is identical across providers so no provider-specific branching leaks into the
// orchestrator.
import { validateCandidateDecision, deriveAllowedPolicy } from '../validation.js';
import { ProviderError } from './errors.js';
import { estimateCost } from './pricing.js';
import { recordProviderCall } from './metrics.js';
import { parseStrictJson, normalizeToCandidateDecision, MalformedDecisionError } from './schema.js';
import type { ReasoningProvider } from '../interfaces.js';
import type { ReasoningContext, Prompt, CandidateDecision } from '../types.js';
import type { ProviderCallConfig, ProviderName, RawProviderResponse } from './types.js';

/** Base delay for exponential backoff between retries, in ms — doubled per attempt and capped at
 *  RETRY_BACKOFF_MAX_MS, plus up to one base-delay of jitter. Root cause this exists: a live
 *  benchmark (Phase 2B) showed retries firing immediately after a 429 almost always hit the same
 *  rate limit again — the upstream provider's own `retry_after_seconds` was consistently in the
 *  10-20s range, far longer than an instant retry could ever respect. */
const RETRY_BACKOFF_BASE_MS = 250;
const RETRY_BACKOFF_MAX_MS = 4000;

function backoffDelayMs(attempt: number): number {
  const exponential = Math.min(RETRY_BACKOFF_MAX_MS, RETRY_BACKOFF_BASE_MS * 2 ** attempt);
  const jitter = Math.random() * RETRY_BACKOFF_BASE_MS;
  return exponential + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export abstract class BaseProvider implements ReasoningProvider {
  abstract readonly name: string;
  protected abstract readonly providerName: ProviderName;
  protected readonly config: ProviderCallConfig;

  constructor(config: ProviderCallConfig) {
    this.config = config;
  }

  /** Performs the actual HTTP round trip to this provider's API. Must honor `signal` for
   *  cancellation and throw ProviderError (never a raw SDK/fetch error) on failure. */
  protected abstract doRequest(prompt: Prompt, signal: AbortSignal): Promise<RawProviderResponse>;

  async generateDecision(context: ReasoningContext, prompt: Prompt): Promise<CandidateDecision> {
    const start = performance.now();
    let retryCount = 0;
    let timedOut = false;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await this.doRequest(prompt, controller.signal);
        clearTimeout(timer);

        const modelOutput = parseStrictJson(response.raw);
        const decision = normalizeToCandidateDecision({
          modelOutput,
          providerVersion: `${this.providerName}:${this.config.model}`,
          buildDurationMs: performance.now() - start,
          promptHash: prompt.promptHash,
        });

        const validation = validateCandidateDecision(decision, deriveAllowedPolicy(context));
        if (!validation.ok) {
          throw new ProviderError('validation_failed', this.providerName, validation.errors.join('; '));
        }

        const estimatedCost = estimateCost(this.providerName, this.config.model, response.usage);
        recordProviderCall({
          provider: this.providerName,
          model: this.config.model,
          latencyMs: performance.now() - start,
          usage: response.usage,
          estimatedCost,
          retryCount,
          fallbackCount: response.fallbackCount ?? 0,
          timedOut: false,
          failed: false,
          requestId: response.requestId,
        });

        return decision;
      } catch (err) {
        clearTimeout(timer);
        const providerError = this.toProviderError(err, controller.signal.aborted);
        if (controller.signal.aborted) timedOut = true;

        const isLastAttempt = attempt === this.config.maxRetries;
        if (!providerError.retryable || isLastAttempt) {
          recordProviderCall({
            provider: this.providerName,
            model: this.config.model,
            latencyMs: performance.now() - start,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            estimatedCost: 0,
            retryCount,
            fallbackCount: 0,
            timedOut,
            failed: true,
            errorKind: providerError.kind,
          });
          throw providerError;
        }
        retryCount += 1;
        await sleep(backoffDelayMs(attempt));
      }
    }

    throw new ProviderError('provider_unavailable', this.providerName, 'exhausted retries without a result');
  }

  private toProviderError(err: unknown, aborted: boolean): ProviderError {
    if (err instanceof ProviderError) return err;
    if (aborted) return new ProviderError('timeout', this.providerName, `request timed out after ${this.config.timeoutMs}ms`);
    if (err instanceof MalformedDecisionError) return new ProviderError('invalid_json', this.providerName, err.message);
    const message = err instanceof Error ? err.message : String(err);
    return new ProviderError('network', this.providerName, message);
  }
}
