import { describe, expect, it, vi } from "vitest";
import { runOperatorTick } from "./runtime.js";

describe("operator runtime", () => {
  it("contains tick failures and records diagnostics", async () => {
    const log = vi.fn();
    const result = await runOperatorTick(
      async () => {
        throw new Error("RPC unavailable\nrequest details");
      },
      {
        lastSuccessfulTickAt: "2026-08-20T12:00:00.000Z",
        consecutiveTickFailures: 1,
      },
      log,
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual({
      lastSuccessfulTickAt: "2026-08-20T12:00:00.000Z",
      consecutiveTickFailures: 2,
      lastTickError: "RPC unavailable",
    });
    expect(log).toHaveBeenCalledWith("operator tick failed: RPC unavailable");
  });

  it("clears failures after a successful tick", async () => {
    const result = await runOperatorTick(
      async () => undefined,
      {
        consecutiveTickFailures: 3,
        lastTickError: "old failure",
      },
      undefined,
      Date.parse("2026-08-20T13:00:00.000Z"),
    );

    expect(result).toEqual({
      ok: true,
      diagnostics: {
        lastSuccessfulTickAt: "2026-08-20T13:00:00.000Z",
        consecutiveTickFailures: 0,
      },
    });
  });
});
