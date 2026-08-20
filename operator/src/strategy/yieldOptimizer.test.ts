import { describe, expect, it, vi } from "vitest";
import type { ChainContext } from "../dreamdex/client.js";
import {
  INSUFFICIENT_BALANCE_SELECTOR,
  POST_ONLY_WOULD_CROSS_SELECTOR,
  TransientDreamDexError,
} from "../dreamdex/errors.js";
import type { Pool } from "../dreamdex/pool.js";
import type { StrategyConfig } from "./config.js";
import { calculateRiskTelemetry, YieldOptimizer } from "./yieldOptimizer.js";

describe("RiskHandler-compatible market telemetry", () => {
  it("measures spread and epoch-to-epoch midpoint movement", () => {
    const first = calculateRiskTelemetry(99.9, 100.1);
    expect(first.mid).toBe(100);
    expect(first.spreadBps).toBeCloseTo(20);
    expect(first.moveBps).toBe(0);

    const next = calculateRiskTelemetry(100.9, 101.1, first.mid);
    expect(next.mid).toBe(101);
    expect(next.moveBps).toBeCloseTo(100);
  });

  it("flags crossed books as maximally unsafe", () => {
    expect(calculateRiskTelemetry(101, 100).spreadBps).toBe(10_000);
  });
});

const strategyConfig: StrategyConfig = {
  symbol: "WETH:USDso",
  minWeight: 0,
  sigmaTicks: 50,
  halfSpreadBps: 5,
  gamma: 0.25,
  kVol: 1,
  volLookback: 60,
  notionalUsdso: 25,
  targetInventoryUsdso: 0,
  maxInventoryUsdso: 1_000,
  maxBookSpreadBps: 100,
  requoteTriggerBps: 2,
  requoteCooldownMs: 0,
  refreshIntervalMs: 1,
  staleMs: 15_000,
  minGasSomi: 0.2,
  expireMs: 60_000,
  dryRun: false,
};

function testOptimizer(
  place: ReturnType<typeof vi.fn>,
  overrides: Record<string, unknown> = {},
) {
  const poolMethods = {
    baseDecimals: 18,
    quoteDecimals: 18,
    params: {
      tick: 10_000_000_000_000_000n,
      minQuantity: 1_000_000_000_000_000n,
    },
    topOfBook: vi.fn().mockResolvedValue({
      bestBid: 99.9,
      bestAsk: 100.1,
      mid: 100,
      bestBidRaw: 99_900_000_000_000_000_000n,
      bestAskRaw: 100_100_000_000_000_000_000n,
      midRaw: 100_000_000_000_000_000_000n,
    }),
    inventoryBalances: vi.fn().mockResolvedValue({ base: 1, quote: 100 }),
    vaultBase: vi.fn().mockResolvedValue(1),
    vaultQuote: vi.fn().mockResolvedValue(100),
    openOrderIds: vi.fn().mockResolvedValue([]),
    activeOrderIds: vi.fn().mockResolvedValue([]),
    cancel: vi.fn().mockResolvedValue("0x1"),
    place,
    ...overrides,
  };
  const pool = poolMethods as unknown as Pool;
  const context = {
    account: { address: "0x0000000000000000000000000000000000000001" },
    publicClient: { getBalance: vi.fn().mockResolvedValue(1_000_000_000_000_000_000n) },
  } as unknown as ChainContext;
  const log = vi.fn();
  return {
    optimizer: new YieldOptimizer(context, pool, strategyConfig, log),
    log,
    pool: poolMethods,
  };
}

describe("optimizer failure accounting", () => {
  it("does not count repeated post-only crossing races", async () => {
    const place = vi.fn().mockRejectedValue(
      new TransientDreamDexError(
        "PostOnlyWouldCross",
        POST_ONLY_WOULD_CROSS_SELECTOR,
      ),
    );
    const { optimizer, log } = testOptimizer(place);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await optimizer.onBook(0);
    }

    expect(optimizer.metrics().placeFailures).toBe(0);
    expect(optimizer.metrics().killed).toBe(false);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("skipped post-only"),
    );
  });

  it("tracks a placed leg when the opposite post-only leg crosses", async () => {
    const place = vi
      .fn()
      .mockResolvedValueOnce({ orderId: 7n, hash: "0x1", gasUsed: 1n })
      .mockRejectedValueOnce(
        new TransientDreamDexError(
          "PostOnlyWouldCross",
          POST_ONLY_WOULD_CROSS_SELECTOR,
        ),
      );
    const { optimizer } = testOptimizer(place);

    await optimizer.onBook(0);

    expect(optimizer.metrics().status).toBe("quoting");
    expect(optimizer.metrics().gasTransactions).toBe(1);
    expect(optimizer.metrics().placeFailures).toBe(0);
  });

  it("continues counting genuine placement failures", async () => {
    const { optimizer } = testOptimizer(
      vi.fn().mockRejectedValue(new Error("RPC unavailable")),
    );

    await optimizer.onBook(0);

    expect(optimizer.metrics().placeFailures).toBe(1);
    expect(optimizer.metrics().killed).toBe(false);
  });

  it("sizes new orders from post-cancel withdrawable balances", async () => {
    const place = vi
      .fn()
      .mockResolvedValue({ orderId: 7n, hash: "0x1", gasUsed: 1n });
    const { optimizer, pool } = testOptimizer(place, {
      inventoryBalances: vi.fn().mockResolvedValue({ base: 10, quote: 1_000 }),
      vaultBase: vi.fn().mockResolvedValue(0.01),
      vaultQuote: vi.fn().mockResolvedValue(2),
    });

    await optimizer.onBook(0);

    expect(pool.activeOrderIds.mock.invocationCallOrder[0]).toBeLessThan(
      pool.vaultBase.mock.invocationCallOrder[0]!,
    );
    expect(pool.activeOrderIds.mock.invocationCallOrder[0]).toBeLessThan(
      pool.vaultQuote.mock.invocationCallOrder[0]!,
    );
    expect(place).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        isBid: true,
        quantity: expect.closeTo(2 / 99.95, 10),
      }),
    );
    expect(place).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ isBid: false, quantity: 0.01 }),
    );
  });

  it("does not place new orders when cancellation cannot be verified", async () => {
    const place = vi.fn();
    const { optimizer, log } = testOptimizer(place, {
      openOrderIds: vi.fn().mockResolvedValue([1n]),
      cancel: vi.fn().mockRejectedValue(
        new Error("cancel transaction reverted for order 1: 0x123"),
      ),
      activeOrderIds: vi.fn().mockResolvedValue([1n]),
    });

    await optimizer.onBook(0);

    expect(place).not.toHaveBeenCalled();
    expect(optimizer.metrics().placeFailures).toBe(1);
    expect(log).toHaveBeenCalledWith(
      "cancel reconciliation blocked: 1 active orders remain after 1 cancellation failures",
    );
  });

  it("continues after a stale cancellation race is reconciled", async () => {
    const place = vi
      .fn()
      .mockResolvedValue({ orderId: 7n, hash: "0x1", gasUsed: 1n });
    const { optimizer } = testOptimizer(place, {
      openOrderIds: vi.fn().mockResolvedValue([1n]),
      cancel: vi.fn().mockResolvedValue(undefined),
      activeOrderIds: vi.fn().mockResolvedValue([]),
    });

    await optimizer.onBook(0);

    expect(place).toHaveBeenCalled();
    expect(optimizer.metrics().placeFailures).toBe(0);
  });

  it("continues when reconciliation proves a failed cancellation is gone", async () => {
    const place = vi
      .fn()
      .mockResolvedValue({ orderId: 7n, hash: "0x1", gasUsed: 1n });
    const { optimizer } = testOptimizer(place, {
      openOrderIds: vi.fn().mockResolvedValue([1n]),
      cancel: vi.fn().mockRejectedValue(
        new Error("cancel transaction reverted for order 1: 0x123"),
      ),
      activeOrderIds: vi.fn().mockResolvedValue([]),
    });

    await optimizer.onBook(0);

    expect(place).toHaveBeenCalled();
    expect(optimizer.metrics().placeFailures).toBe(0);
  });

  it("kills after repeated genuine insufficient-balance failures", async () => {
    const place = vi
      .fn()
      .mockRejectedValue({ raw: INSUFFICIENT_BALANCE_SELECTOR });
    const { optimizer } = testOptimizer(place);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await optimizer.onBook(0);
    }

    expect(optimizer.metrics().placeFailures).toBe(5);
    expect(optimizer.metrics().killed).toBe(true);
    expect(optimizer.metrics().killReason).toBe(
      "five consecutive strategy failures",
    );
  });
});
