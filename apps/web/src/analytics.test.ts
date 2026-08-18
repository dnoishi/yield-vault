import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAnalytics } from "./analytics";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadAnalytics", () => {
  it("accepts a complete analytics report", async () => {
    const report = {
      period: "all",
      available: true,
      asOf: 1,
      coverageStart: 1,
      strategy: {
        state: "idle",
        reason: "No active orders",
        openOrders: 0,
        vaultBase: 0,
        vaultQuote: 0,
      },
      pnl: {
        grossNav: "4",
        deposits: "4",
        outflows: "0",
        earnings: "0",
      },
      owners: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(report)),
    );

    await expect(
      loadAnalytics("https://operator.example/analytics", "all"),
    ).resolves.toEqual(report);
  });

  it("rejects a successful response without strategy data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          available: true,
          pnl: {
            grossNav: "4",
            deposits: "4",
            outflows: "0",
            earnings: "0",
          },
          owners: [],
        }),
      ),
    );

    await expect(
      loadAnalytics("https://operator.example/analytics", "all"),
    ).rejects.toThrow("invalid shape");
  });
});
