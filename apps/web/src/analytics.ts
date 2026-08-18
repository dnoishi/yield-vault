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
  const report: unknown = await response.json();
  if (!isAnalyticsReport(report)) {
    throw new Error("Analytics response has an invalid shape");
  }
  return report;
}

function isAnalyticsReport(value: unknown): value is AnalyticsReport {
  if (!isRecord(value) || typeof value.available !== "boolean") return false;
  if (!isRecord(value.strategy) || !isStrategyState(value.strategy.state)) {
    return false;
  }
  if (
    typeof value.strategy.reason !== "string" ||
    typeof value.strategy.openOrders !== "number" ||
    typeof value.strategy.vaultBase !== "number" ||
    typeof value.strategy.vaultQuote !== "number"
  ) {
    return false;
  }
  if (
    !isRecord(value.pnl) ||
    typeof value.pnl.grossNav !== "string" ||
    typeof value.pnl.deposits !== "string" ||
    typeof value.pnl.outflows !== "string" ||
    (value.pnl.earnings !== null && typeof value.pnl.earnings !== "string")
  ) {
    return false;
  }
  return (
    Array.isArray(value.owners) &&
    value.owners.every(
      (owner) =>
        isRecord(owner) &&
        typeof owner.address === "string" &&
        (owner.periodEarnings === null ||
          typeof owner.periodEarnings === "string"),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStrategyState(value: unknown): value is StrategyState {
  return (
    value === "active" ||
    value === "idle" ||
    value === "offline" ||
    value === "halted"
  );
}
