import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Address } from "viem";
import { createLedgerState } from "./ledger.js";
import type {
  LedgerState,
  NavSnapshot,
  VaultEvent,
} from "./types.js";

interface SnapshotRow {
  id: number;
  block_number: string;
  timestamp: number;
  gross_nav: string;
  total_assets: string;
  total_supply: string;
  deposits: string;
  outflows: string;
  earnings: string;
}

export class AnalyticsDb {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path, { readBigInts: false, timeout: 5_000 });
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS events (
        transaction_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        block_number TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (transaction_hash, log_index)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS flows (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        deposits TEXT NOT NULL,
        outflows TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS owners (
        address TEXT PRIMARY KEY,
        shares TEXT NOT NULL,
        basis TEXT NOT NULL,
        realized TEXT NOT NULL,
        pending_claims TEXT NOT NULL,
        paid_assets TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS withdrawal_requests (
        request_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        receiver TEXT NOT NULL,
        assets TEXT NOT NULL,
        processed INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        block_number TEXT NOT NULL UNIQUE,
        timestamp INTEGER NOT NULL,
        gross_nav TEXT NOT NULL,
        total_assets TEXT NOT NULL,
        total_supply TEXT NOT NULL,
        deposits TEXT NOT NULL,
        outflows TEXT NOT NULL,
        earnings TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS snapshots_timestamp ON snapshots(timestamp);
      CREATE TABLE IF NOT EXISTS owner_snapshots (
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        earnings TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, address)
      ) STRICT;
    `);
  }

  close(): void {
    this.database.close();
  }

  loadLedger(): LedgerState {
    const state = createLedgerState();
    const flow = this.database
      .prepare("SELECT deposits, outflows FROM flows WHERE id = 1")
      .get() as { deposits: string; outflows: string } | undefined;
    if (flow) {
      state.deposits = BigInt(flow.deposits);
      state.outflows = BigInt(flow.outflows);
    }
    const owners = this.database
      .prepare("SELECT * FROM owners")
      .all() as unknown as Array<{
      address: Address;
      shares: string;
      basis: string;
      realized: string;
      pending_claims: string;
      paid_assets: string;
    }>;
    for (const row of owners) {
      state.owners.set(row.address, {
        address: row.address,
        shares: BigInt(row.shares),
        basis: BigInt(row.basis),
        realized: BigInt(row.realized),
        pendingClaims: BigInt(row.pending_claims),
        paidAssets: BigInt(row.paid_assets),
      });
    }
    const requests = this.database
      .prepare("SELECT * FROM withdrawal_requests")
      .all() as unknown as Array<{
      request_id: string;
      owner: Address;
      receiver: Address;
      assets: string;
      processed: number;
    }>;
    for (const row of requests) {
      const requestId = BigInt(row.request_id);
      state.requests.set(requestId, {
        requestId,
        owner: row.owner,
        receiver: row.receiver,
        assets: BigInt(row.assets),
        processed: row.processed === 1,
      });
    }
    return state;
  }

  lastIndexedBlock(): bigint | undefined {
    const row = this.database
      .prepare("SELECT value FROM metadata WHERE key = 'lastIndexedBlock'")
      .get() as { value: string } | undefined;
    return row ? BigInt(row.value) : undefined;
  }

  persistRange(
    events: VaultEvent[],
    state: LedgerState,
    lastIndexedBlock: bigint,
  ): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const eventInsert = this.database.prepare(`
        INSERT OR IGNORE INTO events
          (transaction_hash, log_index, block_number, timestamp, type, payload)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const event of events) {
        eventInsert.run(
          event.transactionHash,
          event.logIndex,
          event.blockNumber.toString(),
          event.timestamp,
          event.type,
          JSON.stringify(event, bigintJson),
        );
      }
      this.persistLedger(state);
      this.database
        .prepare(`
          INSERT INTO metadata(key, value) VALUES ('lastIndexedBlock', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `)
        .run(lastIndexedBlock.toString());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  saveSnapshot(snapshot: NavSnapshot): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          INSERT INTO snapshots
            (block_number, timestamp, gross_nav, total_assets, total_supply,
             deposits, outflows, earnings)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(block_number) DO UPDATE SET
            timestamp = excluded.timestamp,
            gross_nav = excluded.gross_nav,
            total_assets = excluded.total_assets,
            total_supply = excluded.total_supply,
            deposits = excluded.deposits,
            outflows = excluded.outflows,
            earnings = excluded.earnings
        `)
        .run(
          snapshot.blockNumber.toString(),
          snapshot.timestamp,
          snapshot.grossNav.toString(),
          snapshot.totalAssets.toString(),
          snapshot.totalSupply.toString(),
          snapshot.deposits.toString(),
          snapshot.outflows.toString(),
          snapshot.earnings.toString(),
        );
      const row = this.database
        .prepare("SELECT id FROM snapshots WHERE block_number = ?")
        .get(snapshot.blockNumber.toString()) as { id: number };
      this.database
        .prepare("DELETE FROM owner_snapshots WHERE snapshot_id = ?")
        .run(row.id);
      const ownerInsert = this.database.prepare(
        "INSERT INTO owner_snapshots(snapshot_id, address, earnings) VALUES (?, ?, ?)",
      );
      for (const [address, earnings] of snapshot.ownerEarnings) {
        ownerInsert.run(row.id, address, earnings.toString());
      }
      this.database
        .prepare(`
          INSERT INTO metadata(key, value) VALUES ('lastSnapshotAt', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `)
        .run(Date.now().toString());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  latestSnapshot(): NavSnapshot | undefined {
    const row = this.database
      .prepare("SELECT * FROM snapshots ORDER BY timestamp DESC, id DESC LIMIT 1")
      .get() as SnapshotRow | undefined;
    return row ? this.hydrateSnapshot(row) : undefined;
  }

  earliestSnapshot(): NavSnapshot | undefined {
    const row = this.database
      .prepare("SELECT * FROM snapshots ORDER BY timestamp ASC, id ASC LIMIT 1")
      .get() as SnapshotRow | undefined;
    return row ? this.hydrateSnapshot(row) : undefined;
  }

  snapshotAtOrBefore(timestamp: number): NavSnapshot | undefined {
    const row = this.database
      .prepare(
        "SELECT * FROM snapshots WHERE timestamp <= ? ORDER BY timestamp DESC, id DESC LIMIT 1",
      )
      .get(timestamp) as SnapshotRow | undefined;
    return row ? this.hydrateSnapshot(row) : undefined;
  }

  lastSnapshotAt(): number | undefined {
    const row = this.database
      .prepare("SELECT value FROM metadata WHERE key = 'lastSnapshotAt'")
      .get() as { value: string } | undefined;
    return row ? Number(row.value) : undefined;
  }

  private persistLedger(state: LedgerState): void {
    this.database
      .prepare(`
        INSERT INTO flows(id, deposits, outflows) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          deposits = excluded.deposits,
          outflows = excluded.outflows
      `)
      .run(state.deposits.toString(), state.outflows.toString());
    this.database.exec("DELETE FROM owners");
    const ownerInsert = this.database.prepare(`
      INSERT INTO owners
        (address, shares, basis, realized, pending_claims, paid_assets)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const owner of state.owners.values()) {
      ownerInsert.run(
        owner.address,
        owner.shares.toString(),
        owner.basis.toString(),
        owner.realized.toString(),
        owner.pendingClaims.toString(),
        owner.paidAssets.toString(),
      );
    }
    this.database.exec("DELETE FROM withdrawal_requests");
    const requestInsert = this.database.prepare(`
      INSERT INTO withdrawal_requests
        (request_id, owner, receiver, assets, processed)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const request of state.requests.values()) {
      requestInsert.run(
        request.requestId.toString(),
        request.owner,
        request.receiver,
        request.assets.toString(),
        request.processed ? 1 : 0,
      );
    }
  }

  private hydrateSnapshot(row: SnapshotRow): NavSnapshot {
    const ownerRows = this.database
      .prepare(
        "SELECT address, earnings FROM owner_snapshots WHERE snapshot_id = ?",
      )
      .all(row.id) as unknown as Array<{ address: Address; earnings: string }>;
    return {
      id: row.id,
      blockNumber: BigInt(row.block_number),
      timestamp: row.timestamp,
      grossNav: BigInt(row.gross_nav),
      totalAssets: BigInt(row.total_assets),
      totalSupply: BigInt(row.total_supply),
      deposits: BigInt(row.deposits),
      outflows: BigInt(row.outflows),
      earnings: BigInt(row.earnings),
      ownerEarnings: new Map(
        ownerRows.map((owner) => [owner.address, BigInt(owner.earnings)]),
      ),
    };
  }
}

function bigintJson(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
