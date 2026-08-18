import { describe, expect, it } from "vitest";
import { deriveStrategyStatus, type StrategyStatusInput } from "./status.js";

const healthy: StrategyStatusInput = {
  paused: false,
  killed: false,
  operatorStatus: "quoting",
  openOrders: 2,
  vaultBase: 1,
  vaultQuote: 100,
};

describe("strategy status precedence", () => {
  it("prioritizes halted over every other state", () => {
    expect(deriveStrategyStatus({ ...healthy, paused: true }).state).toBe(
      "halted",
    );
    expect(
      deriveStrategyStatus({ ...healthy, killed: true, killReason: "loss" })
        .state,
    ).toBe("halted");
  });

  it("requires live orders and quoting for active", () => {
    expect(deriveStrategyStatus(healthy).state).toBe("active");
    expect(
      deriveStrategyStatus({
        ...healthy,
        operatorStatus: "starting",
      }).state,
    ).toBe("offline");
  });

  it("reports a healthy strategy with no orders as idle", () => {
    expect(
      deriveStrategyStatus({
        ...healthy,
        operatorStatus: "idle",
        openOrders: 0,
        vaultBase: 0,
        vaultQuote: 0,
      }).state,
    ).toBe("idle");
    expect(
      deriveStrategyStatus({
        ...healthy,
        operatorStatus: "dry-run",
        openOrders: 0,
      }).state,
    ).toBe("idle");
  });
});
