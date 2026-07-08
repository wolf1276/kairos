# Strategy Engine

The Strategy Engine turns market data into deterministic trading signals. The backend has **two distinct strategy layers** — this README documents both and which path uses which.

## The two layers

### 1. `src/strategies/` — pure-signal quant strategies (legacy quant agents)

[`../strategies/index.ts`](../strategies/index.ts) is a registry of ~30 small, deterministic functions over OHLCV candles (no I/O, no side effects), each returning `buy | sell | hold`. They use `technicalindicators` (SMA, EMA, RSI, MACD, Bollinger, Stochastic, ADX, Williams %R, CCI, ROC, ATR, Donchian, Parabolic SAR, VWAP, Ichimoku, Keltner, TRIX, Awesome Oscillator, MFI, OBV, SuperTrend, Chaikin, DEMA, TEMA, HMA, Aroon).

**Consumer:** `tick.ts` looks these up by `id` for the manual **`quant`** agent strategy path.

### 2. `src/strategyEngine/` — registry-based Strategy Engine (autonomous pipeline)

This directory is a richer, registry-based engine whose registry (`registry.ts`) is intentionally modeled on the Protocol Layer's [`registry.ts`](../protocolAdapters/README.md): **fail-closed**, rejecting duplicate ids (`DuplicateStrategyError`) and structurally-broken strategies (`MalformedStrategyError`), and validating every emitted signal (`validateStrategySignal`).

| File | Role |
| :--- | :--- |
| `registry.ts` | `StrategyRegistry` — the single point through which callers reach a strategy. Adding a strategy = build a `Strategy`, `register(strategy)`. |
| `strategies/` | The registered strategies: `dca`, `emaCross`, `smaCross`, `rsiMeanReversion`, `macdTrend`, `momentum`, `breakout`, `bollingerBands`, `atrVolatility`, `portfolioRebalancing`, `stablecoinAllocation`, `yieldAllocation`. |
| `validation.ts` | Strategy-shape and signal validation. |
| `analytics.ts` | Strategy analytics. |
| `types.ts`, `util.ts` | `Strategy`/`StrategyInput`/`StrategySignal` types and helpers. |

**Consumers:** the Autonomous Runtime pipeline composition and strategy consensus ([`../runtime/README.md`](../runtime/README.md), `pipelineComposition/strategyConsensus.ts`), plus analytics/benchmark modules.

## Which is authoritative?

- Manual **`quant`** agents → `src/strategies/` signal functions via `tick.ts`.
- The **autonomous role-agent pipeline** and its consensus/analytics → `src/strategyEngine/` registry.

## Related

- [`reasoning/`](../reasoning/README.md) — consumes strategy signals during Decision Intelligence.
- [`runtime/`](../runtime/README.md) — composes strategies via consensus.
- [`protocolAdapters/`](../protocolAdapters/README.md) — the fail-closed registry pattern this engine mirrors.
