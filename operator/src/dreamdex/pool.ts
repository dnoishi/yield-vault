/**
 * Vault-only DreamDEX pool client. Adapted from somnia-chain/dreamdex-bot-kit
 * under its MIT-style license.
 */
import { zeroAddress, type Address, type Hash } from "viem";
import type { ChainContext } from "./client.js";
import { MARKETS } from "./config.js";
import {
  ORDER_TYPE,
  SELF_MATCH_CANCEL_TAKER,
  SPOT_POOL_ABI,
  TOPIC_ORDER_PLACED,
} from "./abi.js";
import {
  INCORRECT_ORDER_SELECTOR,
  POST_ONLY_WOULD_CROSS_SELECTOR,
  TransientDreamDexError,
  isDreamDexError,
  isStaleOrderError,
} from "./errors.js";
import { alignToLot, alignToTick, fromRaw, toRaw } from "./quant.js";

export interface TopOfBook {
  bestBid?: number;
  bestAsk?: number;
  mid?: number;
  bestBidRaw?: bigint;
  bestAskRaw?: bigint;
  midRaw?: bigint;
}

export interface PoolParams {
  baseToken: Address;
  quoteToken: Address;
  tick: bigint;
  minQuantity: bigint;
  lot: bigint;
}

export interface PlaceResult {
  hash: Hash;
  orderId: bigint;
  gasUsed: bigint;
}

export class Pool {
  private constructor(
    readonly ctx: ChainContext,
    readonly symbol: string,
    readonly address: Address,
    readonly baseDecimals: number,
    readonly quoteDecimals: number,
    readonly baseIsNative: boolean,
    readonly params: PoolParams,
  ) {}

  static async load(ctx: ChainContext, symbol: string): Promise<Pool> {
    const configured = MARKETS[ctx.net.name][symbol];
    const poolOverride = process.env.POOL_ADDRESS as Address | undefined;
    const market = poolOverride
      ? {
          symbol,
          pool: poolOverride,
          baseDecimals: Number(process.env.BASE_DECIMALS ?? configured?.baseDecimals ?? 18),
          quoteDecimals: Number(process.env.QUOTE_DECIMALS ?? configured?.quoteDecimals ?? 18),
          baseIsNative:
            (process.env.BASE_IS_NATIVE ?? String(configured?.baseIsNative ?? false)) === "true",
        }
      : configured;
    if (!market) throw new Error(`Unknown ${ctx.net.name} market ${symbol}`);
    const values = await ctx.publicClient.readContract({
      address: market.pool,
      abi: SPOT_POOL_ABI,
      functionName: "getPoolParams",
    });
    return new Pool(
      ctx,
      symbol,
      market.pool,
      market.baseDecimals,
      market.quoteDecimals,
      market.baseIsNative,
      {
        baseToken: values[0],
        quoteToken: values[1],
        tick: values[4],
        minQuantity: values[5],
        lot: values[6],
      },
    );
  }

  async topOfBook(): Promise<TopOfBook> {
    const [bids, asks] = await Promise.all([
      this.ctx.publicClient.readContract({
        address: this.address,
        abi: SPOT_POOL_ABI,
        functionName: "getBookLevels",
        args: [true, 1n],
      }),
      this.ctx.publicClient.readContract({
        address: this.address,
        abi: SPOT_POOL_ABI,
        functionName: "getBookLevels",
        args: [false, 1n],
      }),
    ]);
    const bestBidRaw = bids[0]?.price;
    const bestAskRaw = asks[0]?.price;
    const bestBid =
      bestBidRaw === undefined ? undefined : fromRaw(bestBidRaw, this.quoteDecimals);
    const bestAsk =
      bestAskRaw === undefined ? undefined : fromRaw(bestAskRaw, this.quoteDecimals);
    const mid =
      bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : undefined;
    const midRaw =
      bestBidRaw !== undefined && bestAskRaw !== undefined
        ? (bestBidRaw + bestAskRaw) / 2n
        : undefined;
    return { bestBid, bestAsk, mid, bestBidRaw, bestAskRaw, midRaw };
  }

  async vaultBase(): Promise<number> {
    const raw = await this.ctx.publicClient.readContract({
      address: this.address,
      abi: SPOT_POOL_ABI,
      functionName: "getWithdrawableBalance",
      args: [this.ctx.owner, this.params.baseToken],
    });
    return fromRaw(raw, this.baseDecimals);
  }

  async vaultQuote(): Promise<number> {
    const raw = await this.ctx.publicClient.readContract({
      address: this.address,
      abi: SPOT_POOL_ABI,
      functionName: "getWithdrawableBalance",
      args: [this.ctx.owner, this.params.quoteToken],
    });
    return fromRaw(raw, this.quoteDecimals);
  }

  async inventoryBalances(): Promise<{ base: number; quote: number }> {
    const [base, quote, orders] = await Promise.all([
      this.vaultBase(),
      this.vaultQuote(),
      this.activeOrders(),
    ]);
    let totalBase = base;
    let totalQuote = quote;
    for (const order of orders) {
      if (order.quantityRemaining === 0n) continue;
      if (order.isBid) {
        totalQuote += fromRaw(
          (order.price * order.quantityRemaining) / (10n ** BigInt(this.baseDecimals)),
          this.quoteDecimals,
        );
      } else {
        totalBase += fromRaw(order.quantityRemaining, this.baseDecimals);
      }
    }
    return { base: totalBase, quote: totalQuote };
  }

  async activeOrderIds(): Promise<bigint[]> {
    return (await this.activeOrders()).map((order) => order.orderId);
  }

  async openOrderIds(): Promise<bigint[]> {
    const ids = await this.ctx.publicClient.readContract({
      address: this.address,
      abi: SPOT_POOL_ABI,
      functionName: "getOwnOpenOrders",
      account: this.ctx.owner,
    });
    return [...ids];
  }

  private async activeOrders() {
    const ids = await this.openOrderIds();
    const orders = await Promise.all(
      ids.map(async (orderId) => {
        try {
          const order = await this.ctx.publicClient.readContract({
            address: this.address,
            abi: SPOT_POOL_ABI,
            functionName: "getOrder",
            args: [orderId],
          });
          return order.owner.toLowerCase() === this.ctx.owner.toLowerCase()
            ? order
            : undefined;
        } catch (error) {
          if (isDreamDexError(error, INCORRECT_ORDER_SELECTOR)) {
            return undefined;
          }
          throw error;
        }
      }),
    );
    return orders.filter((order) => order !== undefined);
  }

  async place(args: {
    isBid: boolean;
    price: number;
    quantity: number;
    orderType?: number;
    expireMs: number;
  }): Promise<PlaceResult> {
    const price = alignToTick(
      toRaw(args.price, this.quoteDecimals),
      this.params.tick,
      args.isBid ? "bid" : "ask",
    );
    const quantity = alignToLot(toRaw(args.quantity, this.baseDecimals), this.params.lot);
    if (quantity < this.params.minQuantity) throw new Error("Order below pool minimum");
    const callArgs = [
      this.ctx.owner,
      args.isBid,
      0n,
      price,
      quantity,
      BigInt(Date.now() + args.expireMs) * 1_000_000n,
      args.orderType ?? ORDER_TYPE.PostOnly,
      SELF_MATCH_CANCEL_TAKER,
      zeroAddress,
      0n,
    ] as const;

    const simulation = await this.ctx.publicClient
      .simulateContract({
        address: this.address,
        abi: SPOT_POOL_ABI,
        functionName: "placeOrderFor",
        args: callArgs,
        account: this.ctx.account,
      })
      .catch((error: unknown) => {
        if (isDreamDexError(error, POST_ONLY_WOULD_CROSS_SELECTOR)) {
          throw new TransientDreamDexError(
            "PostOnlyWouldCross",
            POST_ONLY_WOULD_CROSS_SELECTOR,
            { cause: error },
          );
        }
        throw error;
      });
    if (!simulation.result[0]) throw new Error("placeOrderFor simulation returned false");
    const hash = await this.ctx.walletClient.writeContract({
      ...simulation.request,
      account: this.ctx.account,
      chain: this.ctx.net.chain,
    });
    const receipt = await this.ctx.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Order reverted: ${hash}`);
    const event = receipt.logs.find(
      (log) => log.topics[0]?.toLowerCase() === TOPIC_ORDER_PLACED,
    );
    const orderId = event?.topics[1]
      ? BigInt(event.topics[1])
      : this.ctx.net.name === "local"
        ? simulation.result[1]
        : undefined;
    if (orderId === undefined) throw new Error(`Order mined without OrderPlaced: ${hash}`);
    return { hash, orderId, gasUsed: receipt.gasUsed };
  }

  async cancel(orderId: bigint): Promise<Hash | undefined> {
    const simulation = await this.ctx.publicClient
      .simulateContract({
        address: this.address,
        abi: SPOT_POOL_ABI,
        functionName: "cancelOrderFor",
        args: [this.ctx.owner, orderId],
        account: this.ctx.account,
      })
      .catch((error: unknown) => {
        if (isStaleOrderError(error)) return undefined;
        throw error;
      });
    if (!simulation) return undefined;
    const hash = await this.ctx.walletClient
      .writeContract({
        ...simulation.request,
        account: this.ctx.account,
        chain: this.ctx.net.chain,
      })
      .catch((error: unknown) => {
        if (isStaleOrderError(error)) return undefined;
        throw error;
      });
    if (!hash) return undefined;
    const receipt = await this.ctx.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(
        `cancel transaction reverted for order ${orderId}: ${hash}`,
      );
    }
    return hash;
  }
}
