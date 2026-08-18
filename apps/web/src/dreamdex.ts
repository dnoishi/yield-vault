import type { Address, Hex } from "viem";

export interface DreamDexMarket {
  symbol: string;
  contract: Address;
  base: Address;
  quote: Address;
  baseDecimals: number;
  quoteDecimals: number;
  tickSize: string;
  lotSize: string;
  minQuantity: string;
}

interface MarketResponse {
  markets: DreamDexMarket[];
}

export interface DreamDexCurrency {
  code: string;
  decimals: number;
  id: Address;
  name: string;
}

interface CurrencyResponse {
  currencies: DreamDexCurrency[];
}

export interface DreamDexBookLevel {
  price: string;
  quantity: string;
}

export interface DreamDexOrderBook {
  symbol: string;
  bids: DreamDexBookLevel[];
  asks: DreamDexBookLevel[];
  timestamp: number;
}

interface OrderBookResponse {
  orderbooks: DreamDexOrderBook[];
}

interface TickerResponse {
  symbols: Array<{
    close: string;
    high: string;
    low: string;
    open: string;
    volume: string;
    lastTradeAt: number | null;
  }>;
}

interface VolumeResponse {
  quoteVolume: string;
  until: number;
}

export interface DreamDexTrade {
  id: string;
  timestamp: number;
  side: string;
  price: string;
  amount: string;
  cost: string;
}

interface TradesResponse {
  trades: DreamDexTrade[];
}

export interface DreamDexMarketData {
  symbol: string;
  pool: Address;
  bestBid?: number;
  bestAsk?: number;
  mid?: number;
  close24h: number;
  change24hPercent?: number;
  volume24hBase: number;
  quoteVolume: number;
  lastTradeAt: number | null;
  trades: DreamDexTrade[];
  updatedAt: number;
}

export interface DreamDexAuthToken {
  token: string;
  expiresAt: number;
}

export interface DreamDexPreparedTransaction {
  to: Address;
  data: Hex;
  value: string;
  chainId: string;
  gasLimit?: string;
}

export interface DreamDexMarketSell {
  type: "market";
  side: "sell";
  amount: string;
  fundingSource: "wallet";
  orderType: "immediateOrCancel";
}

export class DreamDexApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly name: string,
  ) {
    super(message);
    this.name = "DreamDexApiError";
  }
}

export async function loadDreamDexMarketData(
  baseUrl: string,
  symbol: string,
): Promise<DreamDexMarketData> {
  const encodedSymbol = encodeURIComponent(symbol);
  const [markets, books, tickers, volume, trades] = await Promise.all([
    getJson<MarketResponse>(`${baseUrl}/markets`),
    getJson<OrderBookResponse>(
      `${baseUrl}/orderbooks?symbols=${encodedSymbol}&depth=1`,
    ),
    getJson<TickerResponse>(`${baseUrl}/tickers?symbols=${encodedSymbol}`),
    getJson<VolumeResponse>(`${baseUrl}/markets/${encodedSymbol}/volume`),
    getJson<TradesResponse>(
      `${baseUrl}/markets/${encodedSymbol}/trades?limit=10`,
    ),
  ]);

  const market = markets.markets.find((candidate) => candidate.symbol === symbol);
  const book = books.orderbooks[0];
  const ticker = tickers.symbols[0];
  if (!market || !book || !ticker) {
    throw new Error(`DreamDEX returned no data for ${symbol}`);
  }

  const bestBid = numeric(book.bids[0]?.price);
  const bestAsk = numeric(book.asks[0]?.price);
  const open = numeric(ticker.open) ?? 0;
  const close = numeric(ticker.close) ?? 0;

  return {
    symbol,
    pool: market.contract,
    ...(bestBid !== undefined ? { bestBid } : {}),
    ...(bestAsk !== undefined ? { bestAsk } : {}),
    ...(bestBid !== undefined && bestAsk !== undefined
      ? { mid: (bestBid + bestAsk) / 2 }
      : {}),
    close24h: close,
    ...(open > 0 ? { change24hPercent: ((close - open) / open) * 100 } : {}),
    volume24hBase: numeric(ticker.volume) ?? 0,
    quoteVolume: numeric(volume.quoteVolume) ?? 0,
    lastTradeAt: ticker.lastTradeAt,
    trades: trades.trades,
    updatedAt: Math.max(book.timestamp, volume.until),
  };
}

export async function getDreamDexMarkets(
  baseUrl: string,
): Promise<DreamDexMarket[]> {
  return (await requestJson<MarketResponse>(`${baseUrl}/markets`)).markets;
}

export async function getDreamDexCurrencies(
  baseUrl: string,
): Promise<DreamDexCurrency[]> {
  return (await requestJson<CurrencyResponse>(`${baseUrl}/currencies`)).currencies;
}

export async function getDreamDexOrderBook(
  baseUrl: string,
  symbol: string,
  depth = 20,
): Promise<DreamDexOrderBook | undefined> {
  const query = new URLSearchParams({
    symbols: symbol,
    depth: String(depth),
  });
  return (
    await requestJson<OrderBookResponse>(`${baseUrl}/orderbooks?${query}`)
  ).orderbooks[0];
}

export async function getDreamDexAuthNonce(baseUrl: string): Promise<string> {
  return (await requestJson<{ nonce: string }>(`${baseUrl}/auth/nonce`)).nonce;
}

export async function loginToDreamDex(
  baseUrl: string,
  message: string,
  signature: Hex,
): Promise<DreamDexAuthToken> {
  return requestJson<DreamDexAuthToken>(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
}

export async function prepareDreamDexOrder(
  baseUrl: string,
  symbol: string,
  order: DreamDexMarketSell,
  token: string,
): Promise<DreamDexPreparedTransaction> {
  return requestJson<DreamDexPreparedTransaction>(
    `${baseUrl}/markets/${encodeURIComponent(symbol)}/orders`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(order),
    },
  );
}

async function getJson<T>(url: string): Promise<T> {
  return requestJson<T>(url);
}

async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let error: {
      name?: string;
      description?: string;
    } = {};
    try {
      error = (await response.json()) as typeof error;
    } catch {
      // The fallback below is used for non-JSON gateway errors.
    }
    throw new DreamDexApiError(
      error.description ??
        `DreamDEX request failed (${response.status})`,
      response.status,
      error.name ?? "request_failed",
    );
  }
  return response.json() as Promise<T>;
}

function numeric(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
