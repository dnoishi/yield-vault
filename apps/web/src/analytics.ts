import type { Address } from "viem";

export type AnalyticsPeriod = "all" | "24h" | "7d" | "30d";
export type StrategyState = "active" | "idle" | "offline" | "halted";

export interface AnalyticsOwner {
  address: Address;
  shares: string;
  claim: string;
  costBasis: string;
  realizedEarnings: string;
  unrealizedEarnings: string;
  totalEarnings: string;
  periodEarnings: string | null;
  pendingClaims: string;
  paidAssets: string;
}

export interface AnalyticsReport {
  period: AnalyticsPeriod;
  available: boolean;
  asOf: number;
  coverageStart: number;
  strategy: {
    state: StrategyState;
    reason: string;
    openOrders: number;
    vaultBase: number;
    vaultQuote: number;
  };
  pnl: {
    grossNav: string;
    deposits: string;
    outflows: string;
    earnings: string | null;
  };
  owners: AnalyticsOwner[];
}

export async function loadAnalytics(
  url: string,
  period: AnalyticsPeriod,
): Promise<AnalyticsReport> {
  const target = new URL(url);
  target.searchParams.set("period", period);
  const response = await fetch(target);
  if (!response.ok) throw new Error(`Analytics unavailable (${response.status})`);
  return response.json() as Promise<AnalyticsReport>;
}
