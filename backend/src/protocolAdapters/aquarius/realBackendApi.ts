// Real Aquarius Backend API client. Verified live during development against
// https://amm-api-testnet.aqua.network/api/external/v2/pools/ (see architecture doc for the
// verification log) — a real, paginated, public, unauthenticated endpoint listing every pool with
// its on-chain pool index, token contract addresses, and token symbols. Used for two things:
//   1. Pool discovery (`listPools`) — this IS the real data source for `POOL_DISCOVERY`.
//   2. Dynamic asset-code -> real contract address resolution and (assetA, assetB) -> pool_index
//      lookup, so nothing in this integration ever hardcodes a token or pool contract address —
//      they're all read from this live endpoint at call time.
// Path *amount* finding is intentionally NOT done here: this endpoint exposes pool membership,
// not reserves, so it cannot produce a trustworthy output-amount estimate. `findRoute` therefore
// only proves a route *exists*; actual amounts always come from a real on-chain `swap_chained`
// simulation in `realRouterClient.ts`, per the spec's "path finding" (not quoting) framing.
import type { AquariusBackendApiClient, PoolInfo, RouteResult } from './types.js';
import type { AquariusNetwork } from './config.js';

interface RawPool {
  index: string;
  address: string;
  tokens_addresses: string[];
  tokens_str: string[];
  pool_type: string;
}

interface RawPoolsPage {
  count: number;
  next: string | null;
  results: RawPool[];
}

function symbolOf(tokenStr: string): string {
  // tokens_str entries look like "native" or "AQUA:GISSUER..." — the asset code is either the
  // literal "native" (XLM) or the part before the colon.
  if (tokenStr === 'native') return 'XLM';
  return tokenStr.split(':')[0];
}

export interface AssetPoolRegistry {
  listPools(): Promise<PoolInfo[]>;
  resolveAddress(assetCode: string): Promise<string>;
  findPool(assetA: string, assetB: string): Promise<PoolInfo | null>;
  findPoolByIndex(poolIndex: string): Promise<PoolInfo | null>;
}

export interface RealBackendApiOptions {
  baseUrl: string;
  /** Safety cap on pagination — the live testnet endpoint had ~100 pools at verification time. */
  maxPages?: number;
  fetchImpl?: typeof fetch;
  /** How long a fetched pool listing stays valid before the next call re-fetches. Default 60s. */
  cacheTtlMs?: number;
}

/** Per-`AssetPoolRegistry`-instance cache of the full pool listing. Every one of
 *  `listPools`/`resolveAddress`/`findPool`/`findPoolByIndex` needs the same data, and a single
 *  `simulate()` call on the adapter can invoke 2-3 of them — without this cache, one `SWAP`
 *  simulate triggered a full re-paginated fetch of ~101 pools (6+ HTTP round trips) *per lookup*,
 *  which is why the first version of this integration took minutes for what should be a
 *  sub-second call. Found via the real integration test run (timeouts at 30s per test). */
const poolsCache = new Map<string, { pools: RawPool[]; fetchedAt: number }>();

async function fetchAllPools(options: RealBackendApiOptions): Promise<RawPool[]> {
  const ttl = options.cacheTtlMs ?? 60_000;
  const cached = poolsCache.get(options.baseUrl);
  if (cached && Date.now() - cached.fetchedAt < ttl) return cached.pools;

  const fetchFn = options.fetchImpl ?? fetch;
  const maxPages = options.maxPages ?? 20;
  const pools: RawPool[] = [];
  let url: string | null = `${options.baseUrl}/pools/`;
  let pages = 0;

  while (url && pages < maxPages) {
    const response = await fetchFn(url);
    if (!response.ok) throw new Error(`Aquarius backend API returned ${response.status} for ${url}`);
    const page = (await response.json()) as RawPoolsPage;
    if (!Array.isArray(page.results)) throw new Error('Aquarius backend API returned a malformed pools page (missing results array)');
    pools.push(...page.results);
    url = page.next;
    pages++;
  }
  poolsCache.set(options.baseUrl, { pools, fetchedAt: Date.now() });
  return pools;
}

function toPoolInfo(raw: RawPool): PoolInfo {
  const [assetA, assetB] = raw.tokens_str.map(symbolOf);
  return { poolId: raw.index, assetA, assetB, concentratedLiquidity: raw.pool_type === 'stable' || raw.pool_type === 'concentrated' };
}

export function createAssetPoolRegistry(options: RealBackendApiOptions): AssetPoolRegistry {
  return {
    async listPools() {
      const raw = await fetchAllPools(options);
      return raw.map(toPoolInfo);
    },

    async resolveAddress(assetCode: string) {
      const raw = await fetchAllPools(options);
      for (const pool of raw) {
        const idx = pool.tokens_str.findIndex((t) => symbolOf(t) === assetCode);
        if (idx !== -1) return pool.tokens_addresses[idx];
      }
      throw new Error(`Could not resolve a contract address for asset '${assetCode}' from the Aquarius backend API — no pool references it.`);
    },

    async findPool(assetA: string, assetB: string) {
      const raw = await fetchAllPools(options);
      const match = raw.find((pool) => {
        const symbols = pool.tokens_str.map(symbolOf);
        return symbols.includes(assetA) && symbols.includes(assetB);
      });
      return match ? toPoolInfo(match) : null;
    },

    async findPoolByIndex(poolIndex: string) {
      const raw = await fetchAllPools(options);
      const match = raw.find((pool) => pool.index === poolIndex);
      return match ? toPoolInfo(match) : null;
    },
  };
}

export function createRealAquariusBackendApiClient(options: RealBackendApiOptions): AquariusBackendApiClient {
  const registry = createAssetPoolRegistry(options);
  return {
    async findRoute(inputAsset: string, outputAsset: string, _amount: string, _network: AquariusNetwork): Promise<RouteResult | null> {
      const direct = await registry.findPool(inputAsset, outputAsset);
      if (!direct) return null;
      // Route existence only — no reserve data available from this endpoint to trustworthily
      // estimate `estimatedOutput`/`priceImpactPct`, so this intentionally returns null to defer
      // to the real on-chain simulation in resolveSwapRoute()'s fallback. Returning a route here
      // without a real amount would be worse than not finding one.
      return null;
    },
  };
}
