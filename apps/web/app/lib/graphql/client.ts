const ENDPOINT = "/api/graphql";

async function gqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data as T;
}

export type GQLCandle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

export type GQLTicker = {
  symbol: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  eventTime: number;
};

export async function fetchCandlesGQL(
  symbol: string,
  interval: string,
  limit = 120,
): Promise<GQLCandle[]> {
  const data = await gqlRequest<{ candles: GQLCandle[] }>(
    `query($symbol:String!,$interval:String!,$limit:Int){
      candles(symbol:$symbol,interval:$interval,limit:$limit){
        openTime open high low close volume closeTime
      }
    }`,
    { symbol, interval, limit },
  );
  return data.candles;
}

export async function fetchTickersGQL(
  symbols: string[],
): Promise<GQLTicker[]> {
  const data = await gqlRequest<{ tickers: GQLTicker[] }>(
    `query($symbols:[String!]!){
      tickers(symbols:$symbols){
        symbol price change24h high24h low24h volume24h eventTime
      }
    }`,
    { symbols },
  );
  return data.tickers;
}
