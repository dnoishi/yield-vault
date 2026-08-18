/**
 * Yield optimizer adapted from somnia-chain/dreamdex-bot-kit under its
 * MIT-style license, with inventory sourced exclusively from DreamDEX manual
 * vault balances for the ERC-4626 owner.
 */
import { formatEther } from "viem";
import type { ChainContext } from "../dreamdex/client.js";
import { ORDER_TYPE } from "../dreamdex/abi.js";
import { Pool } from "../dreamdex/pool.js";
import { bpsDistance, fromRaw, toRaw } from "../dreamdex/quant.js";
import {
  proximityWeight,
  scoreIncrement,
  snapPriceToMinWeight,
} from "../dreamdex/yield.js";
import type { StrategyConfig } from "./config.js";

interface RestingLeg {
  orderId?: bigint;
  price: number;
  quantity: number;
  weight: number;
}

export interface OptimizerMetrics {
  status: "starting" | "quoting" | "dry-run" | "killed";
  killed: boolean;
  killReason?: string;
  estimatedYieldScore: number;
  scoreRate: number;
  inventoryUsdso: number;
  vaultBase: number;
  vaultQuote: number;
  lastMid?: number;
  gasTransactions: number;
  placeFailures: number;
  updatedAt: string;
}

export class YieldOptimizer {
  private bid?: RestingLeg;
  private ask?: RestingLeg;
  private mids: number[] = [];
  private killed = false;
  private killReason?: string;
  private score = 0;
  private scoreRate = 0;
  private lastAccrual = Date.now();
  private lastQuoteAt = 0;
  private lastQuoteMid?: number;
  private running = false;
  private gasTransactions = 0;
  private placeFailures = 0;
  private inventory = { base: 0, quote: 0, usdso: 0 };

  constructor(
    private readonly ctx: ChainContext,
    private readonly pool: Pool,
    private readonly config: StrategyConfig,
    private readonly log: (message: string) => void = console.log,
  ) {}

  async onBook(lastWsAt: number): Promise<void> {
    if (this.running || this.killed) return;
    this.running = true;
    try {
      if (lastWsAt !== 0 && Date.now() - lastWsAt > this.config.staleMs) {
        await this.tripKill(`market feed stale for ${Date.now() - lastWsAt}ms`);
        return;
      }
      const gas = Number(formatEther(await this.ctx.publicClient.getBalance({
        address: this.ctx.account.address,
      })));
      if (gas < this.config.minGasSomi) {
        await this.tripKill(`operator gas ${gas.toFixed(4)} below floor`);
        return;
      }
      await this.requote();
    } catch (error) {
      this.placeFailures += 1;
      this.log(`optimizer error: ${(error as Error).message}`);
      if (this.placeFailures >= 5) await this.tripKill("five consecutive strategy failures");
    } finally {
      this.running = false;
    }
  }

  async inventoryUsdso(mid?: number): Promise<number> {
    const { base, quote } = await this.pool.inventoryBalances();
    const value = base * (mid ?? this.lastQuoteMid ?? 0);
    this.inventory = { base, quote, usdso: value };
    return value;
  }

  async cancelAll(): Promise<void> {
    if (this.config.dryRun) {
      this.bid = undefined;
      this.ask = undefined;
      return;
    }
    const ids = await this.pool.openOrderIds();
    for (const id of ids) {
      try {
        await this.pool.cancel(id);
        this.gasTransactions += 1;
      } catch (error) {
        this.log(`cancel ${id} failed: ${(error as Error).message}`);
      }
    }
    this.bid = undefined;
    this.ask = undefined;
  }

  metrics(): OptimizerMetrics {
    return {
      status: this.killed
        ? "killed"
        : this.config.dryRun
          ? "dry-run"
          : this.bid || this.ask
            ? "quoting"
            : "starting",
      killed: this.killed,
      ...(this.killReason ? { killReason: this.killReason } : {}),
      estimatedYieldScore: this.score,
      scoreRate: this.scoreRate,
      inventoryUsdso: this.inventory.usdso,
      vaultBase: this.inventory.base,
      vaultQuote: this.inventory.quote,
      ...(this.lastQuoteMid !== undefined ? { lastMid: this.lastQuoteMid } : {}),
      gasTransactions: this.gasTransactions,
      placeFailures: this.placeFailures,
      updatedAt: new Date().toISOString(),
    };
  }

  private async requote(): Promise<void> {
    const book = await this.pool.topOfBook();
    if (
      book.mid === undefined ||
      book.bestBid === undefined ||
      book.bestAsk === undefined ||
      book.midRaw === undefined ||
      book.bestBidRaw === undefined ||
      book.bestAskRaw === undefined
    ) {
      await this.cancelAll();
      return;
    }
    this.accrueScore();
    this.pushMid(book.mid);
    if (bpsDistance(book.bestBid, book.bestAsk) > this.config.maxBookSpreadBps) return;

    const inventory = await this.inventoryUsdso(book.mid);
    if (inventory > this.config.maxInventoryUsdso) {
      await this.tripKill(
        `inventory ${inventory.toFixed(2)} exceeds ${this.config.maxInventoryUsdso}`,
      );
      return;
    }
    const elapsed = Date.now() - this.lastQuoteAt;
    const drift =
      this.lastQuoteMid === undefined ? Infinity : bpsDistance(book.mid, this.lastQuoteMid);
    if (
      this.lastQuoteAt !== 0 &&
      elapsed < this.config.requoteCooldownMs &&
      drift < this.config.requoteTriggerBps
    ) return;
    if (this.bid && this.ask && drift < this.config.requoteTriggerBps) return;

    const volatility = this.realizedVol();
    const denominator = Math.max(
      this.config.targetInventoryUsdso,
      this.config.notionalUsdso,
      1e-9,
    );
    const normalizedInventory =
      (inventory - this.config.targetInventoryUsdso) / denominator;
    const reservation =
      book.mid - normalizedInventory * this.config.gamma * volatility ** 2 * book.mid;
    const halfSpread = Math.max(
      (book.mid * this.config.halfSpreadBps) / 10_000,
      this.config.kVol * volatility * book.mid,
    );
    const sigma = this.resolveSigma();
    const bidRaw = snapPriceToMinWeight({
      candidate: toRaw(Math.max(this.pool.params.tick === 0n ? 0 : fromRaw(this.pool.params.tick, this.pool.quoteDecimals), reservation - halfSpread), this.pool.quoteDecimals),
      mid: book.midRaw,
      sigma,
      minWeight: this.config.minWeight,
      tick: this.pool.params.tick,
      isBid: true,
      opposite: book.bestAskRaw,
    });
    const askRaw = snapPriceToMinWeight({
      candidate: toRaw(reservation + halfSpread, this.pool.quoteDecimals),
      mid: book.midRaw,
      sigma,
      minWeight: this.config.minWeight,
      tick: this.pool.params.tick,
      isBid: false,
      opposite: book.bestBidRaw,
    });
    if (bidRaw >= askRaw) return;

    const bidPrice = fromRaw(bidRaw, this.pool.quoteDecimals);
    const askPrice = fromRaw(askRaw, this.pool.quoteDecimals);
    const capacity = Math.max(
      0,
      1 - inventory / Math.max(this.config.maxInventoryUsdso, 1),
    );
    const bidNotional = Math.min(this.config.notionalUsdso * capacity, this.inventory.quote);
    const bidQuantity = bidPrice > 0 ? bidNotional / bidPrice : 0;
    const askQuantity = Math.min(
      this.config.notionalUsdso / askPrice,
      this.inventory.base,
    );

    await this.cancelAll();
    const newBid = await this.placeLeg(true, bidPrice, bidQuantity, book.midRaw, sigma);
    const newAsk = await this.placeLeg(false, askPrice, askQuantity, book.midRaw, sigma);
    this.bid = newBid;
    this.ask = newAsk;
    this.lastQuoteAt = Date.now();
    this.lastQuoteMid = book.mid;
    this.placeFailures = 0;
  }

  private async placeLeg(
    isBid: boolean,
    price: number,
    quantity: number,
    midRaw: bigint,
    sigma: bigint,
  ): Promise<RestingLeg | undefined> {
    const quantityRaw = toRaw(quantity, this.pool.baseDecimals);
    if (quantityRaw < this.pool.params.minQuantity) return undefined;
    const weight = proximityWeight(toRaw(price, this.pool.quoteDecimals), midRaw, sigma);
    if (weight < this.config.minWeight) return undefined;
    if (this.config.dryRun) {
      this.log(`dry-run ${isBid ? "bid" : "ask"} ${quantity} @ ${price}`);
      return { price, quantity, weight };
    }
    const result = await this.pool.place({
      isBid,
      price,
      quantity,
      orderType: ORDER_TYPE.PostOnly,
      expireMs: this.config.expireMs,
    });
    this.gasTransactions += 1;
    return { orderId: result.orderId, price, quantity, weight };
  }

  private accrueScore(): void {
    const now = Date.now();
    const seconds = (now - this.lastAccrual) / 1_000;
    const increment =
      scoreIncrement(this.bid?.quantity ?? 0, this.bid?.weight ?? 0, seconds) +
      scoreIncrement(this.ask?.quantity ?? 0, this.ask?.weight ?? 0, seconds);
    this.score += increment;
    this.scoreRate = seconds > 0 ? increment / seconds : 0;
    this.lastAccrual = now;
  }

  private pushMid(mid: number): void {
    this.mids.push(mid);
    while (this.mids.length > this.config.volLookback) this.mids.shift();
  }

  private realizedVol(): number {
    if (this.mids.length < 3) return 0;
    const returns: number[] = [];
    for (let i = 1; i < this.mids.length; i++) {
      returns.push(Math.log(this.mids[i]! / this.mids[i - 1]!));
    }
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance =
      returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  }

  private resolveSigma(): bigint {
    const explicit = process.env.YO_SIGMA_RAW;
    if (explicit) return BigInt(explicit);
    return this.pool.params.tick * BigInt(Math.round(this.config.sigmaTicks));
  }

  private async tripKill(reason: string): Promise<void> {
    if (this.killed) return;
    this.killed = true;
    this.killReason = reason;
    this.log(`KILL SWITCH: ${reason}`);
    await this.cancelAll();
  }
}
