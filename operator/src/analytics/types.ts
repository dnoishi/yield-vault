import type { Address, Hash } from "viem";

export type AnalyticsPeriod = "all" | "24h" | "7d" | "30d";
export type StrategyState = "active" | "idle" | "offline" | "halted";

interface EventBase {
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
  transactionHash: Hash;
  timestamp: number;
}

export type VaultEvent =
  | (EventBase & {
      type: "deposit";
      owner: Address;
      assets: bigint;
      shares: bigint;
    })
  | (EventBase & {
      type: "withdraw";
      owner: Address;
      receiver: Address;
      assets: bigint;
      shares: bigint;
    })
  | (EventBase & {
      type: "withdrawalRequested";
      requestId: bigint;
      owner: Address;
      receiver: Address;
      assets: bigint;
      shares: bigint;
    })
  | (EventBase & {
      type: "withdrawalProcessed";
      requestId: bigint;
      receiver: Address;
      assets: bigint;
    })
  | (EventBase & {
      type: "transfer";
      from: Address;
      to: Address;
      shares: bigint;
    });

export interface OwnerState {
  address: Address;
  shares: bigint;
  basis: bigint;
  realized: bigint;
  pendingClaims: bigint;
  paidAssets: bigint;
}

export interface RequestState {
  requestId: bigint;
  owner: Address;
  receiver: Address;
  assets: bigint;
  processed: boolean;
}

export interface LedgerState {
  deposits: bigint;
  outflows: bigint;
  owners: Map<Address, OwnerState>;
  requests: Map<bigint, RequestState>;
}

export interface NavSnapshot {
  id?: number;
  blockNumber: bigint;
  timestamp: number;
  grossNav: bigint;
  totalAssets: bigint;
  totalSupply: bigint;
  deposits: bigint;
  outflows: bigint;
  earnings: bigint;
  ownerEarnings: Map<Address, bigint>;
}

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
