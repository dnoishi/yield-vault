import { WEIGHT_AT_ONE_SIGMA } from "../dreamdex/yield.js";

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric`);
  return parsed;
}

export interface StrategyConfig {
  symbol: string;
  minWeight: number;
  sigmaTicks: number;
  halfSpreadBps: number;
  gamma: number;
  kVol: number;
  volLookback: number;
  notionalUsdso: number;
  targetInventoryUsdso: number;
  maxInventoryUsdso: number;
  maxBookSpreadBps: number;
  requoteTriggerBps: number;
  requoteCooldownMs: number;
  refreshIntervalMs: number;
  staleMs: number;
  minGasSomi: number;
  expireMs: number;
  dryRun: boolean;
}

export function loadStrategyConfig(): StrategyConfig {
  return {
    symbol: process.env.YO_SYMBOL ?? "WETH:USDso",
    minWeight: numberEnv("YO_MIN_WEIGHT", WEIGHT_AT_ONE_SIGMA),
    sigmaTicks: numberEnv("YO_SIGMA_TICKS", 50),
    halfSpreadBps: numberEnv("YO_HALF_SPREAD_BPS", 5),
    gamma: numberEnv("YO_GAMMA", 0.25),
    kVol: numberEnv("YO_K_VOL", 1),
    volLookback: numberEnv("YO_VOL_LOOKBACK", 60),
    notionalUsdso: numberEnv("YO_NOTIONAL_USDSO", 25),
    targetInventoryUsdso: numberEnv("YO_TARGET_INVENTORY_USDSO", 0),
    maxInventoryUsdso: numberEnv("YO_MAX_INVENTORY_USDSO", 1_000),
    maxBookSpreadBps: numberEnv("YO_MAX_BOOK_SPREAD_BPS", 100),
    requoteTriggerBps: numberEnv("YO_REQUOTE_TRIGGER_BPS", 2),
    requoteCooldownMs: numberEnv("YO_REQUOTE_COOLDOWN_MS", 1_000),
    refreshIntervalMs: numberEnv("YO_REFRESH_INTERVAL_MS", 5_000),
    staleMs: numberEnv("YO_STALE_MS", 15_000),
    minGasSomi: numberEnv("YO_MIN_GAS_SOMI", 0.2),
    expireMs: numberEnv("YO_EXPIRE_MS", 3_600_000),
    dryRun: (process.env.DRY_RUN ?? "true").toLowerCase() !== "false",
  };
}
