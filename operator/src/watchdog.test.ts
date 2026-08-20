import { describe, expect, it } from "vitest";
import {
  deriveWatchdogStatus,
  markWatchdogRuntimeFailure,
  QueueStallTracker,
} from "./watchdog.js";

describe("watchdog", () => {
  it("marks unmanaged exposure and stalled withdrawals unhealthy", () => {
    const status = deriveWatchdogStatus({
      paused: false,
      killed: false,
      operatorStatus: "starting",
      hasExposure: true,
      analyticsStale: false,
      queuedLiabilities: 10n,
      queueStalled: true,
      riskConfigured: true,
      riskSubscriptionId: 1n,
      keeperConfigured: true,
    });
    expect(status.ok).toBe(false);
    expect(status.checks.operator).toBe("offline");
    expect(status.checks.withdrawals).toBe("stalled");
  });

  it("warns without failing when reactive protection is unsubscribed", () => {
    const status = deriveWatchdogStatus({
      paused: false,
      killed: false,
      operatorStatus: "quoting",
      hasExposure: true,
      analyticsStale: false,
      queuedLiabilities: 0n,
      queueStalled: false,
      riskConfigured: true,
      riskSubscriptionId: 0n,
      keeperConfigured: false,
    });
    expect(status.ok).toBe(true);
    expect(status.level).toBe("degraded");
  });

  it("marks runtime failures unhealthy until a fresh status replaces them", () => {
    const healthy = deriveWatchdogStatus({
      paused: false,
      killed: false,
      operatorStatus: "quoting",
      hasExposure: true,
      analyticsStale: false,
      queuedLiabilities: 0n,
      queueStalled: false,
      riskConfigured: true,
      riskSubscriptionId: 1n,
      keeperConfigured: true,
    });
    const failed = markWatchdogRuntimeFailure(healthy, "RPC unavailable");

    expect(failed.ok).toBe(false);
    expect(failed.checks.operator).toBe("offline");
    expect(failed.reasons[0]).toBe("operator tick failed: RPC unavailable");
    expect(deriveWatchdogStatus({
      paused: false,
      killed: false,
      operatorStatus: "quoting",
      hasExposure: true,
      analyticsStale: false,
      queuedLiabilities: 0n,
      queueStalled: false,
      riskConfigured: true,
      riskSubscriptionId: 1n,
      keeperConfigured: true,
    }).level).toBe("healthy");
  });

  it("resets the stall clock when liabilities are processed", () => {
    const tracker = new QueueStallTracker(100);
    expect(tracker.update(10n, 0)).toBe(false);
    expect(tracker.update(10n, 101)).toBe(true);
    expect(tracker.update(5n, 102)).toBe(false);
    expect(tracker.update(5n, 203)).toBe(true);
    expect(tracker.update(0n, 204)).toBe(false);
  });
});
