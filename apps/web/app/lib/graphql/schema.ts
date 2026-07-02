import { createSchema } from "graphql-yoga";
import { BinanceOracle } from "@/oracle";

const typeDefs = /* GraphQL */ `
  type Candle {
    openTime: Float!
    open: Float!
    high: Float!
    low: Float!
    close: Float!
    volume: Float!
    closeTime: Float!
  }

  type Ticker {
    symbol: String!
    price: Float!
    change24h: Float!
    high24h: Float!
    low24h: Float!
    volume24h: Float!
    eventTime: Float!
  }

  type Query {
    candles(symbol: String!, interval: String!, limit: Int): [Candle!]!
    tickers(symbols: [String!]!): [Ticker!]!
  }
`;

const oracle = new BinanceOracle();

const resolvers = {
  Query: {
    candles: async (
      _: unknown,
      args: { symbol: string; interval: string; limit?: number },
    ) => {
      return oracle.getCandles(args.symbol, args.interval, args.limit ?? 120);
    },
    tickers: async (_: unknown, args: { symbols: string[] }) => {
      const results = await Promise.allSettled(
        args.symbols.map((sym) => oracle.getTicker(sym)),
      );
      return results
        .filter(
          (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof oracle.getTicker>>> =>
            r.status === "fulfilled",
        )
        .map((r) => ({
          symbol: r.value.symbol,
          price: parseFloat(r.value.lastPrice),
          change24h: parseFloat(r.value.priceChangePercent),
          high24h: parseFloat(r.value.highPrice),
          low24h: parseFloat(r.value.lowPrice),
          volume24h: parseFloat(r.value.quoteVolume),
          eventTime: r.value.closeTime,
        }));
    },
  },
};

export const schema = createSchema({ typeDefs, resolvers });
