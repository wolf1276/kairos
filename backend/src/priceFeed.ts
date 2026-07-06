// Near-real-time trigger detection for quant/limit agents via Horizon's native SSE trade
// stream — no external price oracle dependency. Horizon only pushes on actual DEX trades (not
// a fixed clock), so latency tracks real trading activity on that order book; thin pairs can
// still see multi-second gaps between ticks. This exists purely to react faster than the slow
// scheduler poll (backend/src/runner.ts, unchanged, still runs as the DCA driver and health-
// check fallback if a stream drops).
import { Asset, Horizon } from '@stellar/stellar-sdk';
import { getAgentRow, listRunningAgents } from './agentService.js';
import { evaluateLimitTrigger, runLimitTick, runQuantTick } from './tick.js';
import { TESTNET_USDC_ISSUER } from './priceHistory.js';
import type { LimitStrategyConfig, QuantStrategyConfig } from './types.js';

const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';
const REBUILD_INTERVAL_MS = 10_000;

function assetsForPair(pair: string): { base: Asset; counter: Asset } | null {
  if (pair !== 'XLM/USDC') return null;
  return { base: Asset.native(), counter: new Asset('USDC', TESTNET_USDC_ISSUER) };
}

interface TradeStreamRecord {
  base_amount: string;
  counter_amount: string;
  base_is_seller: boolean;
}

class PriceFeedService {
  private server = new Horizon.Server(HORIZON_TESTNET_URL, { allowHttp: false });
  private closers = new Map<string, () => void>();
  private agentsByPair = new Map<string, Set<string>>();
  private inFlight = new Set<string>();
  private rebuildTimer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.rebuildTimer) return;
    this.rebuild();
    this.rebuildTimer = setInterval(() => this.rebuild(), REBUILD_INTERVAL_MS);
  }

  stop(): void {
    if (this.rebuildTimer) {
      clearInterval(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    for (const close of this.closers.values()) close();
    this.closers.clear();
    this.agentsByPair.clear();
  }

  /** Read-only status check for the System Context domain. */
  isRunning(): boolean {
    return this.rebuildTimer !== null;
  }

  /** Number of pairs with a live subscription — a zero count while agents are running is a
   *  signal worth surfacing in System Context even though `isRunning()` is true. */
  activeSubscriptionCount(): number {
    return this.closers.size;
  }

  private rebuild(): void {
    const running = listRunningAgents().filter((row) => row.strategy_config_json);
    const nextAgentsByPair = new Map<string, Set<string>>();

    for (const row of running) {
      const strategy = JSON.parse(row.strategy_config_json!) as { type: string; pair?: string };
      if (strategy.type !== 'quant' && strategy.type !== 'limit') continue;
      const pair = strategy.pair;
      if (!pair || !assetsForPair(pair)) continue;
      if (!nextAgentsByPair.has(pair)) nextAgentsByPair.set(pair, new Set());
      nextAgentsByPair.get(pair)!.add(row.id);
    }

    this.agentsByPair = nextAgentsByPair;

    for (const pair of this.agentsByPair.keys()) {
      if (!this.closers.has(pair)) this.subscribe(pair);
    }
    for (const [pair, close] of this.closers.entries()) {
      if (!this.agentsByPair.has(pair)) {
        close();
        this.closers.delete(pair);
      }
    }
  }

  private subscribe(pair: string): void {
    const assets = assetsForPair(pair);
    if (!assets) return;
    try {
      const close = this.server
        .trades()
        .forAssetPair(assets.base, assets.counter)
        .cursor('now')
        .stream({
          onmessage: (record) => {
            const trade = record as unknown as TradeStreamRecord;
            const baseAmount = parseFloat(trade.base_amount);
            const counterAmount = parseFloat(trade.counter_amount);
            if (!(baseAmount > 0)) return;
            const price = counterAmount / baseAmount;
            void this.onTrade(pair, price);
          },
          onerror: (error) => {
            console.error(`[priceFeed] stream error for ${pair}:`, error);
          },
        });
      this.closers.set(pair, close);
    } catch (error) {
      console.error(`[priceFeed] failed to subscribe to ${pair}:`, error);
    }
  }

  private async onTrade(pair: string, price: number): Promise<void> {
    const agentIds = this.agentsByPair.get(pair);
    if (!agentIds) return;

    for (const agentId of agentIds) {
      if (this.inFlight.has(agentId)) continue;
      const row = getAgentRow(agentId);
      if (!row || row.status !== 'running' || !row.strategy_config_json) continue;
      const strategy = JSON.parse(row.strategy_config_json) as QuantStrategyConfig | LimitStrategyConfig;

      if (strategy.type === 'limit') {
        if (!evaluateLimitTrigger(strategy, price)) continue;
        this.inFlight.add(agentId);
        runLimitTick(row, strategy)
          .catch((error) => console.error(`[priceFeed] limit tick failed for ${agentId}:`, error))
          .finally(() => this.inFlight.delete(agentId));
      } else if (strategy.type === 'quant') {
        // Can't derive a full indicator series from a single trade tick — wake the agent early
        // instead of computing the signal here; runQuantTick re-fetches fresh candles itself.
        this.inFlight.add(agentId);
        runQuantTick(row, strategy)
          .catch((error) => console.error(`[priceFeed] quant tick failed for ${agentId}:`, error))
          .finally(() => this.inFlight.delete(agentId));
      }
    }
  }
}

let instance: PriceFeedService | null = null;

export function getPriceFeedService(): PriceFeedService {
  if (!instance) instance = new PriceFeedService();
  return instance;
}
