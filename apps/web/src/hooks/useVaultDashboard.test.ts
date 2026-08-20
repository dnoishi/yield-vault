import { describe, expect, it } from "vitest";
import { zeroAddress } from "viem";
import {
  capacity,
  formatInput,
  ownerPendingWithdrawals,
  percentage,
  safeParse,
  signedPercent,
  strategyLabel,
} from "./useVaultDashboard";

describe("vault dashboard presentation helpers", () => {
  it("parses valid amounts and rejects invalid input", () => {
    expect(safeParse("1.5")).toBe(1_500_000_000_000_000_000n);
    expect(safeParse("not-a-number")).toBe(0n);
  });

  it("formats ownership and values for transaction inputs", () => {
    expect(percentage(1n, 4n)).toBe("25.00%");
    expect(percentage(0n, 0n)).toBe("0.00%");
    expect(formatInput(1_500_000_000_000_000_000n)).toBe("1.5");
  });

  it("labels unavailable and unbounded values clearly", () => {
    expect(signedPercent(undefined)).toBe("—");
    expect(capacity(2n ** 255n, 2n ** 256n - 1n)).toBe("Uncapped");
    expect(strategyLabel("idle")).toBe("Idle — no strategy earnings");
  });

  it("selects unprocessed withdrawal claims for the connected receiver", () => {
    const alice = "0x1111111111111111111111111111111111111111";
    const bob = "0x2222222222222222222222222222222222222222";
    const pending = ownerPendingWithdrawals(alice, 3n, [
      {
        requestId: 3n,
        result: { receiver: bob, assets: 10n, requestedAt: 1n, processed: false },
      },
      {
        requestId: 4n,
        result: [alice, 25n, 2n, false],
      },
      {
        requestId: 5n,
        result: { receiver: alice, assets: 7n, requestedAt: 3n, processed: true },
      },
    ]);

    expect(pending).toEqual([
      { requestId: 4n, assets: 25n, requestedAt: 2n, queuePosition: 2 },
    ]);
    expect(ownerPendingWithdrawals(zeroAddress, 0n, [])).toEqual([]);
  });
});
