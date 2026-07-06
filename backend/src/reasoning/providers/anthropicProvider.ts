// Anthropic provider. Uses Messages API with a forced tool call so the model can only respond
// via the CandidateDecision JSON schema — never free-form text.
import { randomUUID } from 'crypto';
import { BaseProvider } from './baseProvider.js';
import { ProviderError, classifyHttpStatus } from './errors.js';
import { CANDIDATE_DECISION_JSON_SCHEMA } from './schema.js';
import type { Prompt } from '../types.js';
import type { ProviderName, RawProviderResponse } from './types.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const TOOL_NAME = 'emit_candidate_decision';

function promptToUserContent(prompt: Prompt): string {
  const s = prompt.sections;
  return [
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
  ].join('\n\n');
}

export class AnthropicProvider extends BaseProvider {
  readonly name = 'anthropic';
  protected readonly providerName: ProviderName = 'anthropic';

  protected async doRequest(prompt: Prompt, signal: AbortSignal): Promise<RawProviderResponse> {
    const requestId = randomUUID();
    const body = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      system: prompt.sections.system,
      messages: [{ role: 'user', content: promptToUserContent(prompt) }],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Emit the structured trading candidate decision.',
          input_schema: CANDIDATE_DECISION_JSON_SCHEMA.schema,
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    };

    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl ?? DEFAULT_BASE_URL}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
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
      content?: { type: string; name?: string; input?: unknown }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const toolUse = json.content?.find((block) => block.type === 'tool_use' && block.name === TOOL_NAME);
    if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
      throw new ProviderError('invalid_json', this.providerName, 'no tool_use block with structured input in response');
    }

    const promptTokens = json.usage?.input_tokens ?? 0;
    const completionTokens = json.usage?.output_tokens ?? 0;

    return {
      raw: JSON.stringify(toolUse.input),
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      requestId: json.id ?? requestId,
      providerVersion: `anthropic:${this.config.model}`,
    };
  }
}
