// Token cost estimation. Prices are USD per 1,000 tokens and are configuration, not logic — the
// built-in table is a default; PROVIDER_PRICING_JSON (an env var holding a JSON object with the
// same shape) overrides/extends it without a code change.
import type { ProviderName, TokenUsage } from './types.js';

interface PricePerThousand {
  prompt: number;
  completion: number;
}

type PricingTable = Record<string, PricePerThousand>;

const DEFAULT_PRICING: PricingTable = {
  'openai:gpt-4o': { prompt: 0.0025, completion: 0.01 },
  'openai:gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'anthropic:claude-sonnet-5': { prompt: 0.003, completion: 0.015 },
  'anthropic:claude-haiku-4-5': { prompt: 0.001, completion: 0.005 },
  'deepseek:deepseek-chat': { prompt: 0.00014, completion: 0.00028 },
};

function loadOverrides(): PricingTable {
  const raw = process.env.PROVIDER_PRICING_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as PricingTable) : {};
  } catch {
    return {};
  }
}

export function estimateCost(provider: ProviderName, model: string, usage: TokenUsage): number {
  const overrides = loadOverrides();
  const key = `${provider}:${model}`;
  const price = overrides[key] ?? DEFAULT_PRICING[key];
  if (!price) return 0;
  return (usage.promptTokens / 1000) * price.prompt + (usage.completionTokens / 1000) * price.completion;
}
