import { describe, expect, it } from "vitest";
import {
  capacity,
  formatInput,
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
});
