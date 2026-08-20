import { describe, expect, it, vi } from "vitest";
import type { ChainContext } from "./client.js";
import {
  INCORRECT_ORDER_SELECTOR,
  INCORRECT_SENDER_SELECTOR,
  INSUFFICIENT_BALANCE_SELECTOR,
  POST_ONLY_WOULD_CROSS_SELECTOR,
  TransientDreamDexError,
} from "./errors.js";
import { Pool } from "./pool.js";

const owner = "0x0000000000000000000000000000000000000001";
const operator = "0x0000000000000000000000000000000000000002";
const base = "0x0000000000000000000000000000000000000003";
const quote = "0x0000000000000000000000000000000000000004";

function context(readContract: ReturnType<typeof vi.fn>): ChainContext {
  return {
    net: { name: "testnet" },
    owner,
    account: { address: operator },
    publicClient: {
      readContract,
      simulateContract: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
    },
    walletClient: { writeContract: vi.fn() },
  } as unknown as ChainContext;
}

const params = [base, quote, 0n, 0n, 1n, 1n, 1n] as const;

describe("Pool transient order handling", () => {
  it("skips an order that disappears during inventory reconciliation", async () => {
    const readContract = vi.fn(async (request: { functionName: string; args?: readonly unknown[] }) => {
      if (request.functionName === "getPoolParams") return params;
      if (request.functionName === "getWithdrawableBalance") return 10n;
      if (request.functionName === "getOwnOpenOrders") return [1n, 2n];
      if (request.functionName === "getOrder" && request.args?.[0] === 1n) {
        throw { cause: { data: INCORRECT_ORDER_SELECTOR } };
      }
      if (request.functionName === "getOrder") {
        return {
          orderId: 2n,
          isBid: true,
          owner,
          userData: 0n,
          price: 2_000_000_000_000_000_000n,
          fullQuantity: 3n,
          quantityRemaining: 3n,
          expireTimestampNs: 1n,
        };
      }
      throw new Error(`unexpected ${request.functionName}`);
    });
    const pool = await Pool.load(context(readContract), "WETH:USDso");

    await expect(pool.inventoryBalances()).resolves.toEqual({
      base: 1e-17,
      quote: 1.6e-17,
    });
  });

  it("propagates unknown getOrder failures", async () => {
    const readContract = vi.fn(async (request: { functionName: string }) => {
      if (request.functionName === "getPoolParams") return params;
      if (request.functionName === "getWithdrawableBalance") return 0n;
      if (request.functionName === "getOwnOpenOrders") return [1n];
      if (request.functionName === "getOrder") throw new Error("RPC unavailable");
      throw new Error(`unexpected ${request.functionName}`);
    });
    const pool = await Pool.load(context(readContract), "WETH:USDso");

    await expect(pool.inventoryBalances()).rejects.toThrow("RPC unavailable");
  });

  it("classifies post-only crossing simulations as transient", async () => {
    const readContract = vi.fn(async (request: { functionName: string }) => {
      if (request.functionName === "getPoolParams") return params;
      throw new Error(`unexpected ${request.functionName}`);
    });
    const ctx = context(readContract);
    vi.mocked(ctx.publicClient.simulateContract).mockRejectedValue({
      cause: { data: POST_ONLY_WOULD_CROSS_SELECTOR },
    });
    const pool = await Pool.load(ctx, "WETH:USDso");

    await expect(
      pool.place({
        isBid: true,
        price: 2,
        quantity: 1,
        expireMs: 60_000,
      }),
    ).rejects.toBeInstanceOf(TransientDreamDexError);
    expect(ctx.walletClient.writeContract).not.toHaveBeenCalled();
  });

  it.each([INCORRECT_ORDER_SELECTOR, INCORRECT_SENDER_SELECTOR])(
    "treats stale cancel error %s as an already-reconciled order",
    async (selector) => {
      const readContract = vi.fn(async (request: { functionName: string }) => {
        if (request.functionName === "getPoolParams") return params;
        throw new Error(`unexpected ${request.functionName}`);
      });
      const ctx = context(readContract);
      vi.mocked(ctx.publicClient.simulateContract).mockRejectedValue({
        cause: {
          data: {
            metaMessages: ["execution reverted", { raw: selector }],
          },
        },
      });
      const pool = await Pool.load(ctx, "WETH:USDso");

      await expect(pool.cancel(1n)).resolves.toBeUndefined();
      expect(ctx.walletClient.writeContract).not.toHaveBeenCalled();
    },
  );

  it("keeps insufficient balance as a genuine placement failure", async () => {
    const readContract = vi.fn(async (request: { functionName: string }) => {
      if (request.functionName === "getPoolParams") return params;
      throw new Error(`unexpected ${request.functionName}`);
    });
    const ctx = context(readContract);
    const error = { raw: INSUFFICIENT_BALANCE_SELECTOR };
    vi.mocked(ctx.publicClient.simulateContract).mockRejectedValue(error);
    const pool = await Pool.load(ctx, "WETH:USDso");

    await expect(
      pool.place({
        isBid: false,
        price: 2,
        quantity: 1,
        expireMs: 60_000,
      }),
    ).rejects.toBe(error);
  });

  it("reconciles a stale selector returned while sending a cancellation", async () => {
    const readContract = vi.fn(async (request: { functionName: string }) => {
      if (request.functionName === "getPoolParams") return params;
      throw new Error(`unexpected ${request.functionName}`);
    });
    const ctx = context(readContract);
    vi.mocked(ctx.publicClient.simulateContract).mockResolvedValue({
      request: {},
    } as never);
    vi.mocked(ctx.walletClient.writeContract).mockRejectedValue({
      cause: {
        data: INCORRECT_SENDER_SELECTOR,
      },
    });
    const pool = await Pool.load(ctx, "WETH:USDso");

    await expect(pool.cancel(1n)).resolves.toBeUndefined();
    expect(ctx.publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("propagates unknown cancellation failures", async () => {
    const readContract = vi.fn(async (request: { functionName: string }) => {
      if (request.functionName === "getPoolParams") return params;
      throw new Error(`unexpected ${request.functionName}`);
    });
    const ctx = context(readContract);
    vi.mocked(ctx.publicClient.simulateContract).mockRejectedValue(
      new Error("RPC unavailable"),
    );
    const pool = await Pool.load(ctx, "WETH:USDso");

    await expect(pool.cancel(1n)).rejects.toThrow("RPC unavailable");
  });

  it("reports a mined cancellation revert distinctly", async () => {
    const readContract = vi.fn(async (request: { functionName: string }) => {
      if (request.functionName === "getPoolParams") return params;
      throw new Error(`unexpected ${request.functionName}`);
    });
    const ctx = context(readContract);
    vi.mocked(ctx.publicClient.simulateContract).mockResolvedValue({
      request: {},
    } as never);
    vi.mocked(ctx.walletClient.writeContract).mockResolvedValue("0x123" as never);
    vi.mocked(ctx.publicClient.waitForTransactionReceipt).mockResolvedValue({
      status: "reverted",
    } as never);
    const pool = await Pool.load(ctx, "WETH:USDso");

    await expect(pool.cancel(7n)).rejects.toThrow(
      "cancel transaction reverted for order 7: 0x123",
    );
  });
});
