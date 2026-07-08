# Price Oracle & Indicators

A self-contained market-data engine for the [Kairos web app](../README.md): it fetches live prices and OHLCV candles from Binance and derives technical indicators. It powers the app's charts, price displays, and the GraphQL price API.

> [!IMPORTANT]
> This oracle feeds the **frontend's charts and price displays only**. It is **separate from the agent decision pipeline**, which uses Stellar Horizon market data in the [backend](../../../backend/README.md). Do not confuse the two data paths.

## Modules

### `BinanceOracle` ([`BinanceOracle.ts`](./BinanceOracle.ts))

An Axios client against `https://api.binance.com/api/v3` with built-in rate limiting, a short response cache, and retry-with-backoff.

| Method | Returns |
| :--- | :--- |
| `getPrice(symbol)` | `PriceResponse` — latest price. |
| `getTicker(symbol)` | `TickerResponse` — 24-hour ticker. |
| `getCandles(symbol, interval?, limit?)` | `Candle[]` — klines. |
| `getMarketSnapshot(symbol, interval?)` | `MarketSnapshot` — price + ticker + candles fetched in parallel and run through the `IndicatorEngine`. |

Each accessor validates its `symbol` argument and throws a descriptive error on failure.

### `IndicatorEngine` ([`IndicatorEngine.ts`](./IndicatorEngine.ts))

Computes indicators from a candle series using the `technicalindicators` library: **EMA20, EMA50, SMA20, RSI(14), MACD(12/26/9), ATR(14)**.

> [!NOTE]
> The engine **fails closed**: if any required indicator value is `undefined` (e.g. too few candles), it throws rather than emitting partial/misleading numbers. Callers should supply enough candles (the snapshot path requests 200).

### `types.ts`

`PriceResponse`, `TickerResponse`, `Candle`, `RawCandle`, `MarketSnapshot`. [`index.ts`](./index.ts) re-exports the public surface.

## Consumers

- The GraphQL price API (`app/api/graphql`, schema in `app/lib/graphql`).
- Charting components under `app/components/charts`.

## Related

- [`apps/web`](../README.md) — the app that renders this data.
- [`backend`](../../../backend/README.md) — the agent pipeline's *separate* market-data source.
