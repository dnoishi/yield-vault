import type { StrategyStatus } from "./indexer.js";

export interface StrategyStatusInput {
  paused: boolean;
  killed: boolean;
  killReason?: string;
  operatorStatus: string;
  openOrders: number;
  vaultBase: number;
  vaultQuote: number;
}

export function deriveStrategyStatus(input: StrategyStatusInput): StrategyStatus {
  const exposure =
    input.openOrders > 0 || input.vaultBase > 0 || input.vaultQuote > 0;
  const shared = {
    openOrders: input.openOrders,
    vaultBase: input.vaultBase,
    vaultQuote: input.vaultQuote,
  };
  if (input.paused) {
    return {
      ...shared,
      state: "halted",
      reason: "Vault emergency halt is active",
    };
  }
  if (input.killed) {
    return {
      ...shared,
      state: "halted",
      reason: input.killReason ?? "Operator kill switch is active",
    };
  }
  if (
    input.operatorStatus === "quoting" &&
    exposure &&
    input.openOrders > 0
  ) {
    return {
      ...shared,
      state: "active",
      reason: "Operator is quoting with capital deployed on DreamDEX",
    };
  }
  if (
    input.openOrders === 0 &&
    (!exposure || input.operatorStatus === "dry-run")
  ) {
    return {
      ...shared,
      state: "idle",
      reason:
        input.operatorStatus === "dry-run"
          ? "Strategy is in dry-run; no live orders are earning"
          : "No strategy orders are active; vault capital is currently idle",
    };
  }
  return {
    ...shared,
    state: "offline",
    reason: "DreamDEX exposure exists but the operator is not actively quoting",
  };
}
