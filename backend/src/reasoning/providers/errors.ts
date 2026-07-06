// Structured provider errors. Every failure a provider implementation can raise is normalized to
// this one class before it leaves providers/ — no raw SDK/HTTP exception, and no API key or
// credential text, ever reaches the orchestrator or logs.
import type { ProviderErrorKind, ProviderName } from './types.js';

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set(['timeout', 'rate_limit', 'network', 'provider_unavailable', 'empty_response']);

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: ProviderName;
  readonly retryable: boolean;

  constructor(kind: ProviderErrorKind, provider: ProviderName, message: string) {
    super(sanitize(message));
    this.name = 'ProviderError';
    this.kind = kind;
    this.provider = provider;
    this.retryable = RETRYABLE.has(kind);
  }
}

/** Strips anything that looks like a bearer token / api key / secret out of an error message
 *  before it is ever logged or thrown up the stack. Defense in depth — providers should not be
 *  putting secrets in error text to begin with. */
export function sanitize(message: string): string {
  if (!message) return message;
  return message
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, '[redacted]')
    .replace(/(Bearer|bearer)\s+[a-zA-Z0-9._-]+/g, '$1 [redacted]')
    .replace(/(api[_-]?key["']?\s*[:=]\s*)["']?[a-zA-Z0-9._-]{8,}["']?/gi, '$1[redacted]');
}

export function classifyHttpStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'authentication';
  if (status === 429) return 'rate_limit';
  if (status === 404) return 'model_unavailable';
  if (status >= 500) return 'provider_unavailable';
  return 'network';
}
