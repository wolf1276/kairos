// Dynamic free/paid model registry for OpenRouter. Model availability and pricing change over
// time — nothing here hardcodes a specific model id as permanently free; every classification is
// derived from a live call to OpenRouter's own /models endpoint, cached briefly to avoid a
// registry round trip on every reasoning request.
import { ProviderError } from './errors.js';

export const OPENROUTER_MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
const REGISTRY_TTL_MS = 5 * 60 * 1000;

interface OpenRouterModelPricing {
  prompt?: string;
  completion?: string;
}

interface OpenRouterModelEntry {
  id: string;
  pricing?: OpenRouterModelPricing;
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModelEntry[];
}

export interface ClassifiedModel {
  id: string;
  free: boolean;
}

interface RegistryCache {
  fetchedAt: number;
  models: ClassifiedModel[];
}

let cache: RegistryCache | null = null;

/** In-flight dedup: concurrent callers hitting a cold/expired cache share one fetch instead of
 *  each firing their own request to OpenRouter's /models endpoint. Under load (e.g. 100+
 *  concurrent reasoning requests all cold-starting the registry at once) this prevents an
 *  otherwise-silent thundering herd against the very endpoint whose rate limits we're trying to
 *  respect — found during the Phase 2 reliability audit's concurrency stress testing. */
let inflight: Promise<ClassifiedModel[]> | null = null;

/** A model is free only if OpenRouter reports zero prompt AND completion pricing — the `:free`
 *  id suffix is a secondary signal (some providers omit or malform the pricing block) but pricing
 *  is authoritative when present, so a model priced >0 is never treated as free even if its id
 *  happens to contain "free". */
function isFreePricing(entry: OpenRouterModelEntry): boolean {
  const prompt = Number(entry.pricing?.prompt);
  const completion = Number(entry.pricing?.completion);
  if (Number.isFinite(prompt) && Number.isFinite(completion)) {
    return prompt === 0 && completion === 0;
  }
  return entry.id.endsWith(':free');
}

/** Fetches and classifies the current OpenRouter model catalog. Fails closed: any network or
 *  non-2xx failure raises a `provider_unavailable` ProviderError rather than silently returning
 *  a stale or empty list that callers might mistake for "no free models exist". */
export async function fetchOpenRouterModelRegistry(apiKey: string, force = false): Promise<ClassifiedModel[]> {
  if (!force && cache && Date.now() - cache.fetchedAt < REGISTRY_TTL_MS) {
    return cache.models;
  }

  if (!force && inflight) {
    return inflight;
  }

  const fetchPromise = (async () => {
    let res: Response;
    try {
      res = await fetch(OPENROUTER_MODELS_ENDPOINT, {
        headers: { authorization: `Bearer ${apiKey}` },
      });
    } catch (err) {
      throw new ProviderError(
        'provider_unavailable',
        'openrouter',
        `failed to fetch OpenRouter model registry: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError('provider_unavailable', 'openrouter', `OpenRouter model registry request failed: HTTP ${res.status}: ${text}`);
    }

    const json = (await res.json()) as OpenRouterModelsResponse;
    const models = (json.data ?? []).map((entry) => ({ id: entry.id, free: isFreePricing(entry) }));
    cache = { fetchedAt: Date.now(), models };
    return models;
  })();

  if (!force) inflight = fetchPromise;
  try {
    return await fetchPromise;
  } finally {
    if (inflight === fetchPromise) inflight = null;
  }
}

/** Free model ids, sorted for deterministic ordering — callers use this order as the fallback
 *  sequence, so identical registry contents always produce the same fallback chain. */
export async function getFreeModelIds(apiKey: string): Promise<string[]> {
  const models = await fetchOpenRouterModelRegistry(apiKey);
  return models.filter((m) => m.free).map((m) => m.id).sort();
}

/** Unknown model ids are treated as NOT free — fail closed rather than risk routing to a paid
 *  model the registry simply hasn't seen (e.g. a typo, or a model removed since the cache was
 *  populated). */
export async function isModelFree(apiKey: string, modelId: string): Promise<boolean> {
  const models = await fetchOpenRouterModelRegistry(apiKey);
  return models.some((m) => m.id === modelId && m.free);
}

/** Test-only: clears the in-memory registry cache between test cases. */
export function resetOpenRouterRegistryCache(): void {
  cache = null;
  inflight = null;
}
