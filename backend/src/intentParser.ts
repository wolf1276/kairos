// Step 1 of Agent Creation (see agentcreation.md): Natural Language -> Intent Parser -> Validated
// AgentSpec. Nothing beyond this is done here — no agent, wallet, or delegation is created.
//
// Provider failover: the parser tries a priority-ordered list of LLM providers (Hugging Face ->
// OpenRouter -> Gemini) and automatically moves to the next configured provider on a transient
// failure (rate limit, exhausted credits, timeout, outage, 5xx, network error) or a malformed/
// unusable response. Non-transient failures (bad API key, invalid request) are not retried against
// the same provider, but the next provider is still tried. Whichever provider answers, the output
// goes through the exact same JSON validation, missing-field/confidence clarification logic, and
// AgentSpec shape as before — the frontend has no way to tell which provider was used. If every
// configured provider fails, this returns the same 'failed' status as before: no fabricated
// AgentSpec, no regex/heuristic fallback.
import { HfInference } from '@huggingface/inference';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getHuggingFaceApiKey, getGeminiApiKey } from './config.js';
import { RISK_LEVELS, EXECUTION_STYLES } from '@kairos/types';
import type { RiskLevel, ExecutionStyle, AgentSpec, IntentParseResult } from '@kairos/types';

export { RISK_LEVELS, EXECUTION_STYLES };
export type { RiskLevel, ExecutionStyle, AgentSpec, IntentParseResult };

const HF_MODEL = 'meta-llama/Llama-3.1-8B-Instruct';
const GEMINI_MODEL = 'gemini-2.0-flash';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL = 'meta-llama/llama-3.1-8b-instruct:free';
const GPT_OSS_MODEL = 'openai/gpt-oss-20b:free';
const NVIDIA_MODEL = 'nvidia/nemotron-nano-9b-v2:free';

// 1 = no retry within a provider — on any failure, move to the next provider immediately.
// With 5 providers configured, retrying the same one before failing over just adds visible
// latency (backoff sleep + a second round-trip) to a request the user is waiting on; the
// failover chain itself is the retry.
const MAX_RETRIES_PER_PROVIDER = 1;
const BACKOFF_MS = 1500;
// A hung/dead provider previously ate 20s before failing over — user-visible stall on an
// interactive form. GPT-OSS (the current working fallback) answers in ~4-5s, so 10s leaves
// headroom for a legitimately slow model without making a dead one block the chain for long.
const REQUEST_TIMEOUT_MS = 10_000;

const CONFIDENCE_THRESHOLD = 0.6;

const SYSTEM_PROMPT = `You are Kairos's Intent Parser. A user describes a financial goal for an autonomous portfolio-management agent in plain English. Your job is ONLY to extract structured intent — you never create anything, you never pick a strategy, you never mention smart contracts, protocols, or blockchain internals.

Respond with strict JSON only, no markdown fences, matching exactly this shape:
{
  "mission": string | null,        // short name for what the agent does, e.g. "Yield Optimization"
  "objective": string | null,      // the underlying goal, e.g. "Long-term Growth"
  "riskLevel": "conservative" | "balanced" | "aggressive" | null,
  "suggestedCapital": string | null,   // only if the user actually stated an amount/percentage; otherwise null
  "executionStyle": "autonomous" | "guided" | null,
  "confidence": number,            // 0-1, your genuine confidence that mission+objective+riskLevel+executionStyle were all clearly stated
  "clarifyingQuestions": string[]  // non-empty ONLY if confidence is low or a required field (mission, objective, riskLevel, executionStyle) is missing/ambiguous
}

Rules:
- NEVER invent a value the user did not imply. If a required field is unclear, set it to null and add a clarifying question instead of guessing.
- "mission" is NOT new information — it is a short label (2-4 words) for the objective you already extracted, e.g. objective "Long-term Growth" -> mission "Growth Agent". If you can state an objective, you can always state a mission from it; only set mission to null if objective itself is null.
- If the user does not state a risk level but uses words like "low risk"/"safe"/"keeping risk low", that IS a stated risk level (conservative or balanced) — do not treat it as missing.
- If the user does not mention checking in / manual approval, default executionStyle to "autonomous" — silence on this point is not ambiguity, autonomous is the platform default.
- suggestedCapital must stay null unless the user actually mentioned an amount or percentage.
- Output valid JSON only.

Example:
User: "Grow my XLM while keeping risk low."
{"mission":"Growth Agent","objective":"Long-term Growth","riskLevel":"conservative","suggestedCapital":null,"executionStyle":"autonomous","confidence":0.9,"clarifyingQuestions":[]}`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Provider layer: each provider exposes configured() + call(), and every failure is normalized
// to a ProviderCallError with a classification that determines whether it's worth retrying.
// ---------------------------------------------------------------------------

type FailureKind =
  | 'rate_limit'
  | 'credits_exhausted'
  | 'timeout'
  | 'network'
  | 'provider_unavailable'
  | 'authentication'
  | 'invalid_request'
  | 'malformed_response';

/** Transient — worth retrying (same provider, then falling over to the next). Everything else
 *  (authentication, invalid_request) fails a provider immediately without burning a retry, but
 *  the parser still moves on to the next configured provider. */
const RETRYABLE_KINDS: ReadonlySet<FailureKind> = new Set([
  'rate_limit',
  'credits_exhausted',
  'timeout',
  'network',
  'provider_unavailable',
  'malformed_response',
]);

class ProviderCallError extends Error {
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

/** Races a provider call against a timeout so a hanging connection can't stall the whole
 *  failover chain. */
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
  call(userText: string): Promise<string>;
}

function hf(): HfInference | null {
  const key = getHuggingFaceApiKey();
  return key ? new HfInference(key) : null;
}

const huggingFaceProvider: ProviderAdapter = {
  name: 'huggingface',
  configured: () => Boolean(getHuggingFaceApiKey()),
  async call(userText) {
    const client = hf();
    if (!client) throw new ProviderCallError('authentication', 'HUGGINGFACE_API_KEY unset');
    let res;
    try {
      res = await withTimeout(
        client.chatCompletion({
          model: HF_MODEL,
          max_tokens: 500,
          temperature: 0.2,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userText },
          ],
        }),
        REQUEST_TIMEOUT_MS
      );
    } catch (err) {
      throw classifyError(err);
    }
    const content = res.choices?.[0]?.message?.content;
    if (!content) throw new ProviderCallError('malformed_response', 'empty response from Hugging Face');
    return content;
  },
};

function resolveOpenRouterApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || process.env.OPENROUTER || undefined;
}

/** OpenRouter fronts many models behind one key/endpoint — each fallback model (default Llama,
 *  GPT-OSS, Nvidia Nemotron) is just this same call shape with a different `model` id, so they're
 *  built from one factory rather than copy-pasted adapters. */
function makeOpenRouterProvider(name: string, model: string): ProviderAdapter {
  return {
    name,
    configured: () => Boolean(resolveOpenRouterApiKey()),
    async call(userText) {
      const apiKey = resolveOpenRouterApiKey();
      if (!apiKey) throw new ProviderCallError('authentication', 'OPENROUTER_API_KEY unset');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 500,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userText },
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
        const err = classifyError({ status: res.status, message: `HTTP ${res.status}: ${text}` } as unknown as Error);
        throw err;
      }

      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new ProviderCallError('malformed_response', `empty response from ${name}`);
      return content;
    },
  };
}

const openRouterProvider = makeOpenRouterProvider('openrouter', OPENROUTER_MODEL);
const gptOssProvider = makeOpenRouterProvider('gpt-oss', GPT_OSS_MODEL);
const nvidiaProvider = makeOpenRouterProvider('nvidia', NVIDIA_MODEL);

const geminiProvider: ProviderAdapter = {
  name: 'gemini',
  configured: () => Boolean(getGeminiApiKey()),
  async call(userText) {
    const key = getGeminiApiKey();
    if (!key) throw new ProviderCallError('authentication', 'GEMINI_API_KEY unset');
    const client = new GoogleGenerativeAI(key);
    const model = client.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { maxOutputTokens: 500, temperature: 0.2 },
    });
    let content: string;
    try {
      const res = await withTimeout(model.generateContent(userText), REQUEST_TIMEOUT_MS);
      content = res.response.text();
    } catch (err) {
      throw classifyError(err);
    }
    if (!content) throw new ProviderCallError('malformed_response', 'empty response from Gemini');
    return content;
  },
};

/** Priority order: primary (Hugging Face) -> OpenRouter/Llama -> GPT-OSS -> Nvidia Nemotron ->
 *  Gemini. All three OpenRouter-model providers share one API key (OPENROUTER_API_KEY) — if that
 *  key is unset all three are skipped together as unconfigured; if it's set but one model errors
 *  (rate limit, outage), failover just tries the next model id on the same key.
 *  A provider that isn't configured (missing API key) is skipped, not treated as a failure. */
const PROVIDERS: ProviderAdapter[] = [
  huggingFaceProvider,
  openRouterProvider,
  gptOssProvider,
  nvidiaProvider,
  geminiProvider,
];

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ component: 'intent-parser', event, ...fields }));
}

// ---------------------------------------------------------------------------
// Response validation (provider-agnostic — identical regardless of which provider answered).
// ---------------------------------------------------------------------------

interface RawIntentResponse {
  mission: string | null;
  objective: string | null;
  riskLevel: RiskLevel | null;
  suggestedCapital: string | null;
  executionStyle: ExecutionStyle | null;
  confidence: unknown;
  clarifyingQuestions: unknown;
}

function isRiskLevel(v: unknown): v is RiskLevel {
  return typeof v === 'string' && (RISK_LEVELS as readonly string[]).includes(v);
}

function isExecutionStyle(v: unknown): v is ExecutionStyle {
  return typeof v === 'string' && (EXECUTION_STYLES as readonly string[]).includes(v);
}

/** Validates the model's raw JSON. Returns null if the shape is unusable (missing/wrong-typed
 *  fields the model was explicitly told to produce) — that is a parser failure, not a low-confidence
 *  result, and callers must not treat it as a spec. */
function parseRaw(json: unknown): RawIntentResponse | null {
  if (typeof json !== 'object' || json === null) return null;
  const j = json as Record<string, unknown>;

  const mission = typeof j.mission === 'string' && j.mission.trim() ? j.mission.trim() : null;
  const objective = typeof j.objective === 'string' && j.objective.trim() ? j.objective.trim() : null;
  const riskLevel = isRiskLevel(j.riskLevel) ? j.riskLevel : null;
  const suggestedCapital = typeof j.suggestedCapital === 'string' && j.suggestedCapital.trim() ? j.suggestedCapital.trim() : null;
  const executionStyle = isExecutionStyle(j.executionStyle) ? j.executionStyle : null;

  return {
    mission,
    objective,
    riskLevel,
    suggestedCapital,
    executionStyle,
    confidence: j.confidence,
    clarifyingQuestions: j.clarifyingQuestions,
  };
}

function extractQuestions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
}

const REQUIRED_FIELD_QUESTIONS: Record<'mission' | 'objective' | 'riskLevel' | 'executionStyle', string> = {
  mission: 'What would you like to call this agent, or what should its main job be?',
  objective: 'What is the underlying goal — growth, income, capital preservation, or something else?',
  riskLevel: 'What level of risk are you comfortable with: conservative, balanced, or aggressive?',
  executionStyle: 'Should this agent act fully autonomously, or should it check in with you before acting?',
};

/** Parses a provider's raw completion text into a validated RawIntentResponse, or throws a
 *  ProviderCallError('malformed_response') if the text isn't usable JSON matching the expected
 *  shape. */
function parseCompletion(content: string): RawIntentResponse {
  const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    throw new ProviderCallError('malformed_response', 'model response was not valid JSON');
  }
  const raw = parseRaw(json);
  if (!raw) throw new ProviderCallError('malformed_response', 'model response did not match the expected AgentSpec shape');
  return raw;
}

/** Runs one provider through its own retry budget. Returns the validated response on success, or
 *  throws the last ProviderCallError once retries (for transient failures) or a single attempt
 *  (for non-retryable failures) are exhausted. */
async function runProvider(provider: ProviderAdapter, userText: string): Promise<RawIntentResponse> {
  let lastError: ProviderCallError = new ProviderCallError('network', 'provider never attempted');

  for (let attempt = 0; attempt < MAX_RETRIES_PER_PROVIDER; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS * attempt);
    const start = performance.now();
    try {
      const content = await provider.call(userText);
      const raw = parseCompletion(content);
      log('provider_succeeded', { provider: provider.name, attempt, latencyMs: Math.round(performance.now() - start) });
      return raw;
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

/** Runs the natural-language goal through the provider failover chain and returns a validated
 *  AgentSpec, or a request for clarification. Never fabricates a missing field, and never falls
 *  back to regex/heuristic parsing — if every configured provider fails, the caller gets the same
 *  'failed' status regardless of which providers were tried. */
export async function parseIntent(goalText: string): Promise<IntentParseResult> {
  const trimmed = goalText.trim();
  if (!trimmed) {
    return {
      status: 'needs_clarification',
      spec: null,
      clarifyingQuestions: ['What do you want this agent to accomplish?'],
    };
  }

  const configuredProviders = PROVIDERS.filter((p) => p.configured());
  if (configuredProviders.length === 0) {
    return {
      status: 'failed',
      spec: null,
      clarifyingQuestions: [],
      error: 'No intent-parsing provider is configured (HUGGINGFACE_API_KEY, OPENROUTER_API_KEY [needed for OpenRouter/GPT-OSS/Nvidia], GEMINI_API_KEY all unset). Cannot parse intent.',
    };
  }

  let lastError = '';
  for (const provider of configuredProviders) {
    log('provider_attempted', { provider: provider.name });
    let raw: RawIntentResponse;
    try {
      raw = await runProvider(provider, trimmed);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }

    const confidence = typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : 0;
    const questions = extractQuestions(raw.clarifyingQuestions);

    const missing: string[] = [];
    if (!raw.mission) missing.push(REQUIRED_FIELD_QUESTIONS.mission);
    if (!raw.objective) missing.push(REQUIRED_FIELD_QUESTIONS.objective);
    if (!raw.riskLevel) missing.push(REQUIRED_FIELD_QUESTIONS.riskLevel);
    if (!raw.executionStyle) missing.push(REQUIRED_FIELD_QUESTIONS.executionStyle);

    if (missing.length > 0 || confidence < CONFIDENCE_THRESHOLD) {
      const merged = Array.from(new Set([...questions, ...missing]));
      return {
        status: 'needs_clarification',
        spec: null,
        clarifyingQuestions: merged.length > 0 ? merged : ['Could you say more about what you want this agent to do?'],
      };
    }

    return {
      status: 'ok',
      spec: {
        mission: raw.mission!,
        objective: raw.objective!,
        riskLevel: raw.riskLevel!,
        suggestedCapital: raw.suggestedCapital,
        executionStyle: raw.executionStyle!,
        confidence,
      },
      clarifyingQuestions: [],
    };
  }

  return {
    status: 'failed',
    spec: null,
    clarifyingQuestions: [],
    error: `Intent parsing failed on every configured provider. Last error: ${lastError}`,
  };
}
