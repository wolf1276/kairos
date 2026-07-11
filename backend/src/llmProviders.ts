// Shared LLM provider failover chain used by both the intent parser (agent creation) and the
// decision engine (autonomous role-tick reasoning). One provider list, one retry/classify policy —
// previously each caller had its own copy (intentParser.ts) or no failover at all (decisionEngine.ts
// called Hugging Face only, with no other LLM to fall back to before the deterministic heuristic).
// Hugging Face has been removed as a provider: its inference API requires per-model routing that
// kept breaking independently of the other providers (see prior "Invalid username or password"
// failures), and OpenRouter already fronts free-tier equivalents of the same open models.
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiApiKey } from './config.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const GPT_OSS_MODEL = 'openai/gpt-oss-20b:free';
const NVIDIA_MODEL = 'nvidia/nemotron-nano-9b-v2:free';
const GEMINI_MODEL = 'gemini-2.5-flash';

// 1 = no retry within a provider — on any failure, move to the next provider immediately. With
// several providers configured, retrying the same one before failing over just adds visible
// latency to a request the caller is waiting on; the failover chain itself is the retry.
const MAX_RETRIES_PER_PROVIDER = 1;
const BACKOFF_MS = 1500;
const REQUEST_TIMEOUT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type FailureKind =
  | 'rate_limit'
  | 'credits_exhausted'
  | 'timeout'
  | 'network'
  | 'provider_unavailable'
  | 'authentication'
  | 'invalid_request'
  | 'malformed_response';

const RETRYABLE_KINDS: ReadonlySet<FailureKind> = new Set([
  'rate_limit',
  'credits_exhausted',
  'timeout',
  'network',
  'provider_unavailable',
  'malformed_response',
]);

export class ProviderCallError extends Error {
  readonly kind: FailureKind;
  readonly retryable: boolean;

  constructor(kind: FailureKind, message: string) {
    super(message);
    this.name = 'ProviderCallError';
    this.kind = kind;
    this.retryable = RETRYABLE_KINDS.has(kind);
  }
}

/** Classifies an arbitrary thrown error (SDK exception, fetch failure, HTTP status) into a
 *  FailureKind by inspecting status codes and message text — provider SDKs don't share a common
 *  error shape, so this is necessarily heuristic. */
function classifyError(err: unknown): ProviderCallError {
  if (err instanceof ProviderCallError) return err;

  const status: number | undefined =
    (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  const message = err instanceof Error ? err.message : String(err);

  if (status === 401 || status === 403 || /unauthori[sz]ed|invalid.*api.?key|authentication/i.test(message)) {
    return new ProviderCallError('authentication', message);
  }
  if (status === 429 || /rate.?limit|too many requests/i.test(message)) {
    return new ProviderCallError('rate_limit', message);
  }
  if (status === 402 || /credit|insufficient.*balance|quota exceeded|out of credits/i.test(message)) {
    return new ProviderCallError('credits_exhausted', message);
  }
  if (/abort|timed? ?out/i.test(message)) {
    return new ProviderCallError('timeout', message);
  }
  if ((status !== undefined && status >= 500) || /service unavailable|bad gateway|internal server error/i.test(message)) {
    return new ProviderCallError('provider_unavailable', message);
  }
  if (status === 400 || status === 404 || /invalid request|bad request/i.test(message)) {
    return new ProviderCallError('invalid_request', message);
  }
  return new ProviderCallError('network', message);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProviderCallError('timeout', `request timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

interface ProviderAdapter {
  name: string;
  configured(): boolean;
  /** Returns the raw completion text, or throws a ProviderCallError. */
  call(system: string, user: string): Promise<string>;
}

function resolveOpenRouterApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || process.env.OPENROUTER || undefined;
}

/** Any OpenAI-compatible /chat/completions endpoint (OpenRouter, Nvidia NIM) is the same call
 *  shape — just a different base URL, key, and `model` id — so they're all built from one factory
 *  rather than copy-pasted adapters. `resolveKey` returns undefined when unconfigured (provider
 *  skipped) or the bearer token. */
function makeOpenAICompatProvider(
  name: string,
  baseUrl: string,
  model: string,
  resolveKey: () => string | undefined
): ProviderAdapter {
  return {
    name,
    configured: () => Boolean(resolveKey()),
    async call(system, user) {
      const apiKey = resolveKey();
      if (!apiKey) throw new ProviderCallError('authentication', `${name} API key unset`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 700,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) throw new ProviderCallError('timeout', `request timed out after ${REQUEST_TIMEOUT_MS}ms`);
        throw classifyError(err);
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw classifyError({ status: res.status, message: `HTTP ${res.status}: ${text}` } as unknown as Error);
      }

      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new ProviderCallError('malformed_response', `empty response from ${name}`);
      return content;
    },
  };
}

const geminiProvider: ProviderAdapter = {
  name: 'gemini',
  configured: () => Boolean(getGeminiApiKey()),
  async call(system, user) {
    const key = getGeminiApiKey();
    if (!key) throw new ProviderCallError('authentication', 'GEMINI_API_KEY unset');
    const client = new GoogleGenerativeAI(key);
    const model = client.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: system,
      generationConfig: { maxOutputTokens: 700, temperature: 0.2 },
    });
    let content: string;
    try {
      const res = await withTimeout(model.generateContent(user), REQUEST_TIMEOUT_MS);
      content = res.response.text();
    } catch (err) {
      throw classifyError(err);
    }
    if (!content) throw new ProviderCallError('malformed_response', 'empty response from Gemini');
    return content;
  },
};

/** Priority order: OpenRouter/Llama -> GPT-OSS -> Nvidia Nemotron -> Gemini. All three
 *  OpenRouter-model providers share one API key (OPENROUTER_API_KEY) — if that key is unset all
 *  three are skipped together as unconfigured; if it's set but one model errors (rate limit,
 *  outage), failover just tries the next model id on the same key. A provider that isn't
 *  configured (missing API key) is skipped, not treated as a failure. */
const openRouter = (name: string, model: string) =>
  makeOpenAICompatProvider(name, OPENROUTER_BASE_URL, model, resolveOpenRouterApiKey);

const PROVIDERS: ProviderAdapter[] = [
  openRouter('openrouter', OPENROUTER_MODEL),
  openRouter('gpt-oss', GPT_OSS_MODEL),
  openRouter('nvidia', NVIDIA_MODEL),
  geminiProvider,
];

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ component: 'llm-providers', event, ...fields }));
}

export class AllProvidersFailedError extends Error {
  constructor(public readonly lastError: string) {
    super(`Every configured LLM provider failed. Last error: ${lastError}`);
    this.name = 'AllProvidersFailedError';
  }
}

export interface ChatResult {
  content: string;
  provider: string;
}

/** Runs one provider through its own retry budget. `validate` lets a caller reject a
 *  structurally-wrong-but-HTTP-successful response (e.g. non-JSON completion) as a
 *  malformed_response failure, so it fails over to the next provider instead of being returned. */
async function runProvider(
  provider: ProviderAdapter,
  system: string,
  user: string,
  validate?: (content: string) => boolean
): Promise<string> {
  let lastError: ProviderCallError = new ProviderCallError('network', 'provider never attempted');

  for (let attempt = 0; attempt < MAX_RETRIES_PER_PROVIDER; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS * attempt);
    const start = performance.now();
    try {
      const content = await provider.call(system, user);
      if (validate && !validate(content)) {
        throw new ProviderCallError('malformed_response', `${provider.name} returned a response that did not match the expected shape`);
      }
      log('provider_succeeded', { provider: provider.name, attempt, latencyMs: Math.round(performance.now() - start) });
      return content;
    } catch (err) {
      const providerError = classifyError(err);
      lastError = providerError;
      log('provider_failed', {
        provider: provider.name,
        attempt,
        reason: providerError.kind,
        latencyMs: Math.round(performance.now() - start),
      });
      if (!providerError.retryable) break;
    }
  }

  throw lastError;
}

/** Returns a canned, shape-correct completion for each of the four known callers (intent parser +
 *  the three role decision agents), selected by a marker in that caller's system prompt. Only used
 *  when LLM_MOCK is set — lets the full agent-creation / role-tick flow be exercised end-to-end
 *  without spending scarce free-tier LLM quota (every free provider caps at 20–50 requests/day).
 *  ponytail: canned static responses, not a real model — never enable in production (gated by env). */
function mockCompletion(system: string): string {
  if (/Intent Parser/i.test(system)) {
    return JSON.stringify({
      mission: 'Growth Agent',
      objective: 'Long-term Growth',
      riskLevel: 'balanced',
      suggestedCapital: null,
      executionStyle: 'autonomous',
      confidence: 0.95,
    });
  }
  if (/Strategic Agent/i.test(system)) {
    return JSON.stringify({ selectedStrategy: 'hold', action: 'hold', confidence: 0.7, reasoning: 'mock' });
  }
  if (/Yield Agent/i.test(system)) {
    return JSON.stringify({ action: 'hold', yieldVenue: null, confidence: 0.7, reasoning: 'mock' });
  }
  if (/Balancer Agent/i.test(system)) {
    return JSON.stringify({ action: 'hold', targetXlmPct: 50, targetUsdcPct: 50, confidence: 0.7, reasoning: 'mock' });
  }
  return JSON.stringify({ action: 'hold', confidence: 0.5, reasoning: 'mock' });
}

/** Tries every configured provider in priority order, returning the first successful raw
 *  completion. If `validate` is given and a provider's response fails it, that's treated as a
 *  malformed_response failure and the chain moves to the next provider (a valid response is not
 *  guaranteed just because the HTTP call succeeded). Throws AllProvidersFailedError if every
 *  configured provider fails, or if none are configured at all (no API key set for any of them). */
export async function chatCompletionWithFallback(
  system: string,
  user: string,
  opts?: { validate?: (content: string) => boolean }
): Promise<ChatResult> {
  if (process.env.LLM_MOCK) {
    log('provider_mocked', { provider: 'mock' });
    return { content: mockCompletion(system), provider: 'mock' };
  }

  const configured = PROVIDERS.filter((p) => p.configured());
  if (configured.length === 0) {
    throw new AllProvidersFailedError(
      'No LLM provider is configured (OPENROUTER_API_KEY [needed for OpenRouter/GPT-OSS/Nvidia] and GEMINI_API_KEY are both unset)'
    );
  }

  let lastError = '';
  for (const provider of configured) {
    log('provider_attempted', { provider: provider.name });
    try {
      const content = await runProvider(provider, system, user, opts?.validate);
      return { content, provider: provider.name };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new AllProvidersFailedError(lastError);
}
