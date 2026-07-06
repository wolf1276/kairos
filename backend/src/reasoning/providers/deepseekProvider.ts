// DeepSeek provider. OpenAI-compatible Chat Completions API; DeepSeek's public API does not
// support json_schema mode, so structured output is enforced via response_format: json_object
// plus the same fail-closed JSON parse + CandidateDecision validation every provider goes
// through in BaseProvider.
import { randomUUID } from 'crypto';
import { BaseProvider } from './baseProvider.js';
import { ProviderError, classifyHttpStatus } from './errors.js';
import type { Prompt } from '../types.js';
import type { ProviderName, RawProviderResponse } from './types.js';

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

function promptToMessages(prompt: Prompt): { role: 'system' | 'user'; content: string }[] {
  const s = prompt.sections;
  return [
    {
      role: 'system',
      content: `${s.system}\n\n${s.outputSchema}\nRespond with a single JSON object only — no prose, no markdown fences.`,
    },
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
      ].join('\n\n'),
    },
  ];
}

export class DeepSeekProvider extends BaseProvider {
  readonly name = 'deepseek';
  protected readonly providerName: ProviderName = 'deepseek';

  protected async doRequest(prompt: Prompt, signal: AbortSignal): Promise<RawProviderResponse> {
    const requestId = randomUUID();
    const body = {
      model: this.config.model,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      response_format: { type: 'json_object' },
      messages: promptToMessages(prompt),
    };

    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl ?? DEFAULT_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw new ProviderError('timeout', this.providerName, 'request aborted');
      throw new ProviderError('network', this.providerName, err instanceof Error ? err.message : String(err));
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(classifyHttpStatus(res.status), this.providerName, `HTTP ${res.status}: ${text}`);
    }

    const json = (await res.json()) as {
      id?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new ProviderError('invalid_json', this.providerName, 'no message content in response');

    return {
      raw: content,
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        totalTokens: json.usage?.total_tokens ?? 0,
      },
      requestId: json.id ?? requestId,
      providerVersion: `deepseek:${this.config.model}`,
    };
  }
}
