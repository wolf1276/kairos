// Minimal HTTP request client for Decision Intelligence. Deliberately NOT reusing
// providers/openAiCompatible.ts — that function hardcodes CANDIDATE_DECISION_JSON_SCHEMA, which
// cannot express PrimaryAction's vocabulary. This reuses provider *configuration* and *error
// classification* (ProviderError, classifyHttpStatus — read-only imports) without modifying
// anything in providers/.
import { randomUUID } from 'crypto';
import { ProviderError, classifyHttpStatus } from '../providers/errors.js';
import { DECISION_INTELLIGENCE_JSON_SCHEMA } from './schema.js';
import type { Prompt } from '../types.js';
import type { ProviderCallConfig, ProviderName } from '../providers/types.js';

/** Decision Intelligence's own provider set is a superset of providers/types.ts::ProviderName —
 *  `huggingface` is not, and will never be, a provider in the frozen LLM provider layer (it has
 *  no CandidateDecision-shaped provider there), but Decision Intelligence's request pipeline is
 *  independent of that layer, so it can support it here without touching providers/. */
export type DecisionIntelligenceProviderName = ProviderName | 'huggingface';

export interface DecisionIntelligenceProviderConfig extends Omit<ProviderCallConfig, 'provider'> {
  provider: DecisionIntelligenceProviderName;
}

const DEFAULT_BASE_URLS: Record<DecisionIntelligenceProviderName, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  // Hugging Face's OpenAI-compatible router — same chat/completions request shape as the rest.
  huggingface: 'https://router.huggingface.co/v1',
  // No sane default — depends entirely on the remote machine's tunnel URL; OLLAMA_BASE_URL is
  // always set explicitly in deployment.
  ollama: 'http://localhost:11434/v1',
};

/** Providers confirmed (via live testing) to actually honor OpenAI's `json_schema` structured
 *  output mode for Decision Intelligence's schema. Everything else falls back to `json_object` —
 *  found live: Hugging Face's router rejected `json_schema` for meta-llama/Llama-3.1-8B-Instruct
 *  with HTTP 400 ("Model does not support 'json_schema' response format. Supported formats:
 *  json_object."), the same category of limitation the frozen provider layer already works around
 *  for DeepSeek (providers/deepseekProvider.ts always uses json_object). Untested providers
 *  (openrouter, anthropic, deepseek) default to the safer json_object rather than assuming support. */
const JSON_SCHEMA_CAPABLE_PROVIDERS = new Set<DecisionIntelligenceProviderName>(['openai', 'nvidia']);

export interface DecisionIntelligenceRawResponse {
  raw: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestId: string;
}

function promptToMessages(prompt: Prompt): { role: 'system' | 'user'; content: string }[] {
  const s = prompt.sections;
  return [
    { role: 'system', content: s.system },
    {
      role: 'user',
      content: [
        `Agent Identity:\n${s.agentIdentity}`,
        `Current Market Context:\n${s.marketContext}`,
        `Managed Capital:\n${s.managedCapital}`,
        `Historical Experience:\n${s.historicalExperience}`,
        `Detected Patterns:\n${s.detectedPatterns}`,
        `Evidence:\n${s.evidence}`,
        `Risk Constraints:\n${s.riskConstraints}`,
        `Allowed Protocols:\n${s.allowedProtocols}`,
        `Objectives:\n${s.objectives}`,
        `Required Output Schema:\n${s.outputSchema}`,
      ].join('\n\n'),
    },
  ];
}

/** `ProviderError`'s `provider` field is typed as providers/types.ts::ProviderName — 'huggingface'
 *  is cast through since it's still just a string field at runtime (only used for logging/error
 *  attribution), and casting here is strictly local to this file, not a change to providers/. */
function asProviderErrorProvider(provider: DecisionIntelligenceProviderName): ProviderName {
  return provider as ProviderName;
}

/** Performs one Chat Completions round trip requesting the Decision Intelligence structured
 *  schema. Only OpenAI-compatible chat/completions APIs are supported (every configured provider,
 *  including Hugging Face's router, exposes one) — Anthropic's native Messages API shape would
 *  need its own branch if Decision Intelligence runs against it directly instead of via a
 *  compatible router. */
export async function requestDecisionIntelligenceCompletion(
  config: DecisionIntelligenceProviderConfig,
  prompt: Prompt,
  signal: AbortSignal
): Promise<DecisionIntelligenceRawResponse> {
  const errProvider = asProviderErrorProvider(config.provider);
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URLS[config.provider];
  const requestId = randomUUID();
  const body: Record<string, unknown> = {
    model: config.model,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    messages: promptToMessages(prompt),
  };
  body.response_format = config.structuredOutput && JSON_SCHEMA_CAPABLE_PROVIDERS.has(config.provider)
    ? { type: 'json_schema', json_schema: { ...DECISION_INTELLIGENCE_JSON_SCHEMA, strict: true } }
    : { type: 'json_object' };

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw new ProviderError('timeout', errProvider, 'request aborted');
    throw new ProviderError('network', errProvider, err instanceof Error ? err.message : String(err));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // classifyHttpStatus (providers/errors.ts, frozen) has no case for 402 and falls back to
    // 'network' — retryable, which is wrong for a billing/quota failure that will never resolve
    // on its own. Found during the Phase 3 live smoke test against Hugging Face (a depleted
    // monthly credit balance returns 402); mapped to 'authentication' instead, which is already
    // non-retryable and semantically closer ("access denied until account state changes").
    const kind = res.status === 402 ? 'authentication' : classifyHttpStatus(res.status);
    throw new ProviderError(kind, errProvider, `HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    id?: string;
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new ProviderError('empty_response', errProvider, 'no message content in response');

  // Decision Intelligence's schema is much larger than CandidateDecision's — a completion cut off
  // by max_tokens produces JSON that fails to parse, indistinguishable in the resulting error from
  // genuine model malformation unless finish_reason is checked here. Root cause found during the
  // Phase 3 live smoke test: maxTokens=2000 truncated NVIDIA's response mid-object; 4000 did not.
  if (json.choices?.[0]?.finish_reason === 'length') {
    throw new ProviderError(
      'invalid_json',
      errProvider,
      `response was truncated (finish_reason=length, maxTokens=${config.maxTokens}) — increase maxTokens for Decision Intelligence's larger schema`
    );
  }

  return {
    raw: content,
    promptTokens: json.usage?.prompt_tokens ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
    totalTokens: json.usage?.total_tokens ?? 0,
    requestId: json.id ?? requestId,
  };
}
