import { formatUnits, parseUnits } from "viem";

export function toRaw(value: number, decimals: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid quantity ${value}`);
  return parseUnits(value.toFixed(decimals), decimals);
}

export function fromRaw(value: bigint, decimals: number): number {
  return Number(formatUnits(value, decimals));
}

export function alignToTick(value: bigint, tick: bigint, side: "bid" | "ask"): bigint {
  if (tick <= 0n) throw new Error("tick must be positive");
  const remainder = value % tick;
  if (remainder === 0n) return value;
  return side === "bid" ? value - remainder : value + tick - remainder;
}

export function alignToLot(value: bigint, lot: bigint): bigint {
  if (lot <= 0n) throw new Error("lot must be positive");
  return value - (value % lot);
}

export function bpsDistance(a: number, b: number): number {
  const mid = (a + b) / 2;
  return mid > 0 ? (Math.abs(a - b) / mid) * 10_000 : Infinity;
}
