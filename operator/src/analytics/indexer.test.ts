import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Address, PublicClient } from "viem";
import { AnalyticsDb } from "./db.js";
import { VaultAnalyticsIndexer } from "./indexer.js";
import { createLedgerState } from "./ledger.js";

const UNIT = 10n ** 18n;
const alice = "0x1000000000000000000000000000000000000001" as Address;
const vault = "0x9000000000000000000000000000000000000009" as Address;
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("analytics persistence and periods", () => {
  it("restores the cursor and exact owner ledger after restart", () => {
    const path = databasePath();
    const state = createLedgerState();
    state.deposits = 100n * UNIT;
    state.owners.set(alice, {
      address: alice,
      shares: 100n * UNIT,
      basis: 100n * UNIT,
      realized: 7n * UNIT,
      pendingClaims: 3n * UNIT,
      paidAssets: 12n * UNIT,
    });

    const first = new AnalyticsDb(path);
    first.persistRange([], state, 42n);
    first.close();

    const second = new AnalyticsDb(path);
    const restored = second.loadLedger();
    expect(second.lastIndexedBlock()).toBe(42n);
    expect(restored.deposits).toBe(state.deposits);
    expect(restored.owners.get(alice)).toEqual(state.owners.get(alice));
    second.close();
  });

  it("returns flow-adjusted all-time and period earnings with coverage flags", () => {
    const db = new AnalyticsDb(databasePath());
    const state = createLedgerState();
    state.deposits = 100n * UNIT;
    state.owners.set(alice, {
      address: alice,
      shares: 100n * UNIT,
      basis: 100n * UNIT,
      realized: 0n,
      pendingClaims: 0n,
      paidAssets: 0n,
    });
    db.persistRange([], state, 20n);
    const now = Date.now();
    db.saveSnapshot({
      blockNumber: 10n,
      timestamp: now - 25 * 60 * 60 * 1_000,
      grossNav: 105n * UNIT,
      totalAssets: 105n * UNIT,
      totalSupply: 100n * UNIT,
      deposits: 100n * UNIT,
      outflows: 0n,
      earnings: 5n * UNIT,
      ownerEarnings: new Map([[alice, 5n * UNIT]]),
    });
    db.saveSnapshot({
      blockNumber: 20n,
      timestamp: now,
      grossNav: 120n * UNIT,
      totalAssets: 120n * UNIT,
      totalSupply: 100n * UNIT,
      deposits: 100n * UNIT,
      outflows: 0n,
      earnings: 20n * UNIT,
      ownerEarnings: new Map([[alice, 20n * UNIT]]),
    });

    const indexer = new VaultAnalyticsIndexer(
      {} as PublicClient,
      vault,
      db,
      {
        deployBlock: 0n,
        chunkSize: 1_000n,
        confirmations: 0n,
        snapshotIntervalMs: 60_000,
        pollIntervalMs: 5_000,
      },
    );
    const strategy = {
      state: "idle" as const,
      reason: "No orders",
      openOrders: 0,
      vaultBase: 0,
      vaultQuote: 0,
    };

    expect(indexer.getReport("all", strategy).pnl.earnings).toBe(
      (20n * UNIT).toString(),
    );
    const day = indexer.getReport("24h", strategy);
    expect(day.available).toBe(true);
    expect(day.pnl.earnings).toBe((15n * UNIT).toString());
    expect(day.owners[0]?.periodEarnings).toBe((15n * UNIT - 1n).toString());

    const month = indexer.getReport("30d", strategy);
    expect(month.available).toBe(false);
    expect(month.pnl.earnings).toBeNull();
    expect(month.owners[0]?.periodEarnings).toBeNull();
    db.close();
  });
});

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "yield-vault-analytics-"));
  directories.push(directory);
  return join(directory, "analytics.sqlite");
}
