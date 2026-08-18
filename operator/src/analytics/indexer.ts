import {
  decodeEventLog,
  parseAbi,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { AnalyticsDb } from "./db.js";
import { applyEventTransactions } from "./ledger.js";
import type {
  AnalyticsPeriod,
  AnalyticsReport,
  LedgerState,
  NavSnapshot,
  StrategyState,
  VaultEvent,
} from "./types.js";

const ANALYTICS_ABI = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)",
  "event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)",
  "event WithdrawalRequested(uint256 indexed requestId,address indexed owner,address indexed receiver,uint256 shares,uint256 assets)",
  "event WithdrawalProcessed(uint256 indexed requestId,address indexed receiver,uint256 assets)",
  "function grossManagedAssets() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

const PERIOD_MS: Record<Exclude<AnalyticsPeriod, "all">, number> = {
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

export interface IndexerConfig {
  deployBlock: bigint;
  chunkSize: bigint;
  confirmations: bigint;
  snapshotIntervalMs: number;
  pollIntervalMs: number;
}

export interface StrategyStatus {
  state: StrategyState;
  reason: string;
  openOrders: number;
  vaultBase: number;
  vaultQuote: number;
}

export class VaultAnalyticsIndexer {
  private readonly state: LedgerState;
  private timer?: NodeJS.Timeout;
  private syncing = false;
  private bootstrapBlocks: bigint[] = [];

  constructor(
    private readonly client: PublicClient,
    private readonly vault: Address,
    private readonly db: AnalyticsDb,
    private readonly config: IndexerConfig,
    private readonly log: (message: string) => void = console.log,
  ) {
    this.state = db.loadLedger();
  }

  async start(): Promise<void> {
    if (this.db.lastIndexedBlock() === undefined) {
      this.bootstrapBlocks = await this.findBootstrapBlocks();
    }
    await this.sync();
    this.timer = setInterval(() => void this.sync(), this.config.pollIntervalMs);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.db.close();
  }

  getReport(period: AnalyticsPeriod, strategy: StrategyStatus): AnalyticsReport {
    const current = this.db.latestSnapshot();
    const earliest = this.db.earliestSnapshot();
    if (!current || !earliest) throw new Error("Analytics snapshot unavailable");

    const boundary =
      period === "all"
        ? undefined
        : this.db.snapshotAtOrBefore(current.timestamp - PERIOD_MS[period]);
    const available = period === "all" || boundary !== undefined;
    const deposits = boundary
      ? current.deposits - boundary.deposits
      : current.deposits;
    const outflows = boundary
      ? current.outflows - boundary.outflows
      : current.outflows;
    const earnings = boundary
      ? current.grossNav - boundary.grossNav - deposits + outflows
      : current.earnings;

    const owners = [...this.state.owners.values()]
      .map((owner) => {
        const claim = convertToAssets(
          owner.shares,
          current.totalAssets,
          current.totalSupply,
        );
        const unrealized = claim - owner.basis;
        const total = owner.realized + unrealized;
        const previous = boundary?.ownerEarnings.get(owner.address);
        return {
          address: owner.address,
          shares: owner.shares.toString(),
          claim: claim.toString(),
          costBasis: owner.basis.toString(),
          realizedEarnings: owner.realized.toString(),
          unrealizedEarnings: unrealized.toString(),
          totalEarnings: total.toString(),
          periodEarnings: available
            ? (total - (previous ?? 0n)).toString()
            : null,
          pendingClaims: owner.pendingClaims.toString(),
          paidAssets: owner.paidAssets.toString(),
        };
      })
      .filter(
        (owner) =>
          owner.shares !== "0" ||
          owner.totalEarnings !== "0" ||
          owner.pendingClaims !== "0",
      )
      .sort((a, b) => {
        const left = BigInt(a.shares);
        const right = BigInt(b.shares);
        return left === right ? 0 : left > right ? -1 : 1;
      });

    return {
      period,
      available,
      asOf: current.timestamp,
      coverageStart: earliest.timestamp,
      strategy,
      pnl: {
        grossNav: current.grossNav.toString(),
        deposits: deposits.toString(),
        outflows: outflows.toString(),
        earnings: available ? earnings.toString() : null,
      },
      owners,
    };
  }

  private async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const head = await this.client.getBlockNumber();
      const confirmed =
        head > this.config.confirmations ? head - this.config.confirmations : 0n;
      let fromBlock =
        (this.db.lastIndexedBlock() ?? (this.config.deployBlock - 1n)) + 1n;
      if (this.config.deployBlock === 0n && fromBlock < 0n) fromBlock = 0n;

      while (fromBlock <= confirmed) {
        let toBlock = minBigInt(
          fromBlock + this.config.chunkSize - 1n,
          confirmed,
        );
        const checkpoint = this.bootstrapBlocks.find(
          (block) => block >= fromBlock && block <= toBlock,
        );
        if (checkpoint !== undefined) toBlock = checkpoint;

        const events = await this.loadEvents(fromBlock, toBlock);
        applyEventTransactions(this.state, events);
        this.db.persistRange(events, this.state, toBlock);

        if (checkpoint === toBlock) {
          await this.trySnapshot(toBlock);
          this.bootstrapBlocks = this.bootstrapBlocks.filter(
            (block) => block !== checkpoint,
          );
        }
        fromBlock = toBlock + 1n;
      }

      const latest = this.db.latestSnapshot();
      const lastSnapshotAt = this.db.lastSnapshotAt();
      if (
        confirmed >= this.config.deployBlock &&
        (!latest ||
          !lastSnapshotAt ||
          Date.now() - lastSnapshotAt >= this.config.snapshotIntervalMs)
      ) {
        await this.trySnapshot(confirmed);
      }
    } catch (error) {
      this.log(`analytics sync error: ${(error as Error).message}`);
    } finally {
      this.syncing = false;
    }
  }

  private async loadEvents(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<VaultEvent[]> {
    const logs = await this.client.getLogs({
      address: this.vault,
      fromBlock,
      toBlock,
    });
    const blockNumbers = [
      ...new Set(
        logs
          .map((entry) => entry.blockNumber)
          .filter((value): value is bigint => value !== null)
          .map(String),
      ),
    ].map(BigInt);
    const timestamps = new Map<bigint, number>();
    await Promise.all(
      blockNumbers.map(async (blockNumber) => {
        const block = await this.client.getBlock({ blockNumber });
        timestamps.set(blockNumber, Number(block.timestamp) * 1_000);
      }),
    );

    const events: VaultEvent[] = [];
    for (const entry of logs) {
      if (
        entry.blockNumber === null ||
        entry.transactionHash === null ||
        entry.transactionIndex === null ||
        entry.logIndex === null
      ) {
        continue;
      }
      try {
        const decoded = decodeEventLog({
          abi: ANALYTICS_ABI,
          data: entry.data,
          topics: entry.topics,
          strict: true,
        });
        const base = {
          blockNumber: entry.blockNumber,
          transactionIndex: entry.transactionIndex,
          logIndex: entry.logIndex,
          transactionHash: entry.transactionHash as Hash,
          timestamp: timestamps.get(entry.blockNumber)!,
        };
        const args = decoded.args as Record<string, unknown>;
        if (decoded.eventName === "Transfer") {
          events.push({
            ...base,
            type: "transfer",
            from: args.from as Address,
            to: args.to as Address,
            shares: args.value as bigint,
          });
        } else if (decoded.eventName === "Deposit") {
          events.push({
            ...base,
            type: "deposit",
            owner: args.owner as Address,
            assets: args.assets as bigint,
            shares: args.shares as bigint,
          });
        } else if (decoded.eventName === "Withdraw") {
          events.push({
            ...base,
            type: "withdraw",
            owner: args.owner as Address,
            receiver: args.receiver as Address,
            assets: args.assets as bigint,
            shares: args.shares as bigint,
          });
        } else if (decoded.eventName === "WithdrawalRequested") {
          events.push({
            ...base,
            type: "withdrawalRequested",
            requestId: args.requestId as bigint,
            owner: args.owner as Address,
            receiver: args.receiver as Address,
            assets: args.assets as bigint,
            shares: args.shares as bigint,
          });
        } else if (decoded.eventName === "WithdrawalProcessed") {
          events.push({
            ...base,
            type: "withdrawalProcessed",
            requestId: args.requestId as bigint,
            receiver: args.receiver as Address,
            assets: args.assets as bigint,
          });
        }
      } catch {
        // Ignore unrelated vault events.
      }
    }
    return events;
  }

  private async trySnapshot(blockNumber: bigint): Promise<void> {
    try {
      const [grossNav, totalAssets, totalSupply, block] = await Promise.all([
        this.client.readContract({
          address: this.vault,
          abi: ANALYTICS_ABI,
          functionName: "grossManagedAssets",
          blockNumber,
        }),
        this.client.readContract({
          address: this.vault,
          abi: ANALYTICS_ABI,
          functionName: "totalAssets",
          blockNumber,
        }),
        this.client.readContract({
          address: this.vault,
          abi: ANALYTICS_ABI,
          functionName: "totalSupply",
          blockNumber,
        }),
        this.client.getBlock({ blockNumber }),
      ]);
      const ownerEarnings = new Map<Address, bigint>();
      for (const owner of this.state.owners.values()) {
        const claim = convertToAssets(owner.shares, totalAssets, totalSupply);
        ownerEarnings.set(owner.address, owner.realized + claim - owner.basis);
      }
      this.db.saveSnapshot({
        blockNumber,
        timestamp: Number(block.timestamp) * 1_000,
        grossNav,
        totalAssets,
        totalSupply,
        deposits: this.state.deposits,
        outflows: this.state.outflows,
        earnings: grossNav + this.state.outflows - this.state.deposits,
        ownerEarnings,
      });
    } catch (error) {
      this.log(
        `analytics snapshot unavailable at block ${blockNumber}: ${(error as Error).message}`,
      );
    }
  }

  private async findBootstrapBlocks(): Promise<bigint[]> {
    const head = await this.client.getBlockNumber();
    const now = Date.now();
    const targets = [30, 7, 1].map(
      (days) => now - days * 24 * 60 * 60 * 1_000,
    );
    const blocks: bigint[] = [];
    for (const timestamp of targets) {
      const block = await this.findBlockAtOrBefore(timestamp, head);
      if (block >= this.config.deployBlock && !blocks.includes(block)) {
        blocks.push(block);
      }
    }
    return blocks.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  private async findBlockAtOrBefore(
    timestamp: number,
    head: bigint,
  ): Promise<bigint> {
    let low = this.config.deployBlock;
    let high = head;
    let answer = low;
    while (low <= high) {
      const middle = (low + high) / 2n;
      const block = await this.client.getBlock({ blockNumber: middle });
      const blockTime = Number(block.timestamp) * 1_000;
      if (blockTime <= timestamp) {
        answer = middle;
        low = middle + 1n;
      } else {
        if (middle === 0n) break;
        high = middle - 1n;
      }
    }
    return answer;
  }
}

export function defaultIndexerConfig(): IndexerConfig {
  return {
    deployBlock: envBigInt("VAULT_DEPLOY_BLOCK", 0n),
    chunkSize: envBigInt("ANALYTICS_BLOCK_CHUNK", 1_000n),
    confirmations: envBigInt("ANALYTICS_CONFIRMATIONS", 0n),
    snapshotIntervalMs: envNumber("ANALYTICS_SNAPSHOT_INTERVAL_MS", 60_000),
    pollIntervalMs: envNumber("ANALYTICS_POLL_INTERVAL_MS", 5_000),
  };
}

function convertToAssets(
  shares: bigint,
  totalAssets: bigint,
  totalSupply: bigint,
): bigint {
  return (shares * (totalAssets + 1n)) / (totalSupply + 1n);
}

function envBigInt(name: string, fallback: bigint): bigint {
  try {
    return process.env[name] ? BigInt(process.env[name]!) : fallback;
  } catch {
    return fallback;
  }
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
