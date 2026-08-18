/**
 * Gaussian proximity math adapted from somnia-chain/dreamdex-bot-kit
 * under its MIT-style license.
 */
import { alignToTick } from "./quant.js";

export const WEIGHT_AT_ONE_SIGMA = Math.exp(-0.5);

export function proximityWeight(order: bigint, mid: bigint, sigma: bigint): number {
  if (sigma <= 0n) return 0;
  const delta = Number(order - mid);
  const width = Number(sigma);
  if (!Number.isFinite(delta) || !Number.isFinite(width)) return 0;
  return Math.exp(-(delta * delta) / (2 * width * width));
}

export function snapPriceToMinWeight(args: {
  candidate: bigint;
  mid: bigint;
  sigma: bigint;
  minWeight: number;
  tick: bigint;
  isBid: boolean;
  opposite: bigint;
}): bigint {
  const { mid, sigma, minWeight, tick, isBid, opposite } = args;
  let price = alignToTick(args.candidate, tick, isBid ? "bid" : "ask");
  if (price <= 0n) price = tick;
  for (let step = 0; step < 10_000; step++) {
    if (proximityWeight(price, mid, sigma) >= minWeight) return price;
    const next = isBid ? price + tick : price - tick;
    if (next <= 0n || (isBid ? next >= opposite : next <= opposite)) return price;
    price = next;
  }
  return price;
}

export function scoreIncrement(quantity: number, weight: number, seconds: number): number {
  return quantity > 0 && weight > 0 && seconds > 0 ? quantity * weight * seconds : 0;
}
