export type WatchdogLevel = "healthy" | "degraded" | "unhealthy";

export interface WatchdogInput {
  paused: boolean;
  killed: boolean;
  operatorStatus: string;
  hasExposure: boolean;
  analyticsStale: boolean;
  queuedLiabilities: bigint;
  queueStalled: boolean;
  riskConfigured: boolean;
  riskSubscriptionId: bigint;
  keeperConfigured: boolean;
}

export interface WatchdogStatus {
  ok: boolean;
  level: WatchdogLevel;
  checks: {
    operator: string;
    analytics: string;
    withdrawals: string;
    riskHandler: string;
    keeper: string;
    vault: string;
  };
  reasons: string[];
}

export function deriveWatchdogStatus(input: WatchdogInput): WatchdogStatus {
  const reasons: string[] = [];
  let severity = 0;
  const worsen = (next: WatchdogLevel, reason: string) => {
    reasons.push(reason);
    severity = Math.max(severity, next === "unhealthy" ? 2 : 1);
  };

  const operatorOffline =
    input.killed ||
    (input.hasExposure &&
      input.operatorStatus !== "quoting" &&
      input.operatorStatus !== "dry-run");
  if (operatorOffline) worsen("unhealthy", "operator is not managing live exposure");
  if (input.analyticsStale) worsen("unhealthy", "analytics snapshots are stale");
  if (input.queueStalled) worsen("unhealthy", "withdrawal queue has stalled");
  if (input.paused) worsen("degraded", "vault emergency halt is active");
  if (input.riskConfigured && input.riskSubscriptionId === 0n) {
    worsen("degraded", "RiskHandler is not subscribed");
  }
  if (input.queuedLiabilities > 0n && !input.keeperConfigured) {
    worsen("degraded", "withdrawals depend on a manual keeper");
  }

  const level: WatchdogLevel =
    severity === 2 ? "unhealthy" : severity === 1 ? "degraded" : "healthy";
  return {
    ok: level !== "unhealthy",
    level,
    checks: {
      operator: operatorOffline ? "offline" : input.operatorStatus,
      analytics: input.analyticsStale ? "stale" : "current",
      withdrawals: input.queueStalled
        ? "stalled"
        : input.queuedLiabilities > 0n
          ? "queued"
          : "clear",
      riskHandler: !input.riskConfigured
        ? "not_configured"
        : input.riskSubscriptionId > 0n
          ? "active"
          : "not_subscribed",
      keeper: input.keeperConfigured ? "configured" : "manual",
      vault: input.paused ? "paused" : "active",
    },
    reasons,
  };
}

export function markWatchdogRuntimeFailure(
  status: WatchdogStatus,
  error: string,
): WatchdogStatus {
  return {
    ...status,
    ok: false,
    level: "unhealthy",
    checks: { ...status.checks, operator: "offline" },
    reasons: [
      `operator tick failed: ${error}`,
      ...status.reasons.filter(
        (reason) => !reason.startsWith("operator tick failed:"),
      ),
    ],
  };
}

export class QueueStallTracker {
  private queuedSince?: number;
  private previousLiabilities = 0n;

  constructor(private readonly thresholdMs: number) {}

  update(queuedLiabilities: bigint, now = Date.now()): boolean {
    if (
      queuedLiabilities === 0n ||
      queuedLiabilities < this.previousLiabilities
    ) {
      this.queuedSince = queuedLiabilities > 0n ? now : undefined;
    } else if (this.previousLiabilities === 0n && queuedLiabilities > 0n) {
      this.queuedSince = now;
    }
    this.previousLiabilities = queuedLiabilities;
    return (
      queuedLiabilities > 0n &&
      this.queuedSince !== undefined &&
      now - this.queuedSince >= this.thresholdMs
    );
  }
}
