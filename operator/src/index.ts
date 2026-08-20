import "./env.js";
import { createServer } from "node:http";
import { parseAbi, zeroAddress, type Address } from "viem";
import { AnalyticsDb } from "./analytics/db.js";
import {
  defaultIndexerConfig,
  VaultAnalyticsIndexer,
  type StrategyStatus,
} from "./analytics/indexer.js";
import { deriveStrategyStatus } from "./analytics/status.js";
import type { AnalyticsPeriod } from "./analytics/types.js";
import { createChainContext } from "./dreamdex/client.js";
import { Pool } from "./dreamdex/pool.js";
import { DreamDexWs } from "./dreamdex/ws.js";
import {
  runOperatorTick,
  type RuntimeDiagnostics,
} from "./runtime.js";
import { loadStrategyConfig } from "./strategy/config.js";
import { YieldOptimizer } from "./strategy/yieldOptimizer.js";
import { keeperPrivateKey, WithdrawalKeeper } from "./keeper.js";
import {
  deriveWatchdogStatus,
  markWatchdogRuntimeFailure,
  QueueStallTracker,
  type WatchdogStatus,
} from "./watchdog.js";

const VAULT_STATE_ABI = parseAbi([
  "function paused() view returns (bool)",
  "function queuedLiabilities() view returns (uint256)",
]);
const RISK_ABI = parseAbi([
  "function subscriptionId() view returns (uint256)",
]);

interface RuntimeState extends RuntimeDiagnostics {
  paused: boolean;
  queuedLiabilities: bigint;
  riskSubscriptionId: bigint;
  watchdog: WatchdogStatus;
}

async function main(): Promise<void> {
  const context = createChainContext();
  const config = loadStrategyConfig();
  const pool = await Pool.load(context, config.symbol);
  const optimizer = new YieldOptimizer(context, pool, config, (message) => {
    console.log(`[${new Date().toISOString()}] ${message}`);
  });
  const vault = context.owner as Address;
  const indexerConfig = defaultIndexerConfig();
  if (context.net.name !== "local" && indexerConfig.deployBlock === 0n) {
    throw new Error("VAULT_DEPLOY_BLOCK is required for analytics on public networks");
  }
  const analyticsDb = new AnalyticsDb(
    process.env.ANALYTICS_DB_PATH ?? "data/analytics.sqlite",
  );
  const analytics = new VaultAnalyticsIndexer(
    context.publicClient,
    vault,
    analyticsDb,
    indexerConfig,
    (message) => console.log(`[${new Date().toISOString()}] ${message}`),
  );
  await analytics.start();
  const riskHandler = (process.env.RISK_HANDLER_ADDRESS ??
    (context.net.name === "testnet"
      ? "0x7655a76b44aF4aFc6F6A3c653d33214E4735F676"
      : zeroAddress)) as Address;
  const riskConfigured = riskHandler !== zeroAddress;
  const keeperKey = keeperPrivateKey();
  const keeper = keeperKey
    ? new WithdrawalKeeper(
        context.publicClient,
        context.net,
        vault,
        keeperKey,
        BigInt(process.env.KEEPER_MAX_REQUESTS ?? 10),
        (message) => console.log(`[${new Date().toISOString()}] ${message}`),
      )
    : undefined;
  const stallTracker = new QueueStallTracker(
    Number(process.env.QUEUE_STALL_THRESHOLD_MS ?? 120_000),
  );
  const initialVaultState = await readVaultState(context, vault);
  const initialRiskSubscriptionId = await readRiskSubscription(
    context,
    riskHandler,
    riskConfigured,
  );
  let runtime: RuntimeState = {
    ...initialVaultState,
    riskSubscriptionId: initialRiskSubscriptionId,
    consecutiveTickFailures: 0,
    watchdog: deriveWatchdogStatus({
      paused: initialVaultState.paused,
      killed: false,
      operatorStatus: "starting",
      hasExposure: false,
      analyticsStale: false,
      queuedLiabilities: initialVaultState.queuedLiabilities,
      queueStalled: false,
      riskConfigured,
      riskSubscriptionId: initialRiskSubscriptionId,
      keeperConfigured: keeper !== undefined,
    }),
  };
  let ticking = false;

  const tick = async (lastWsAt: number) => {
    if (ticking) return;
    ticking = true;
    try {
      let nextRuntime: RuntimeState | undefined;
      const result = await runOperatorTick(
        async () => {
          const vaultState = await readVaultState(context, vault);
          if (vaultState.paused) await optimizer.cancelAll();
          else await optimizer.onBook(lastWsAt);
          await keeper?.tick();
          const [strategy, riskSubscriptionId] = await Promise.all([
            strategyStatus(pool, optimizer.metrics(), vaultState.paused),
            readRiskSubscription(context, riskHandler, riskConfigured),
          ]);
          const analyticsStale =
            Date.now() - (analyticsDb.lastSnapshotAt() ?? 0) >
            indexerConfig.snapshotIntervalMs * 3;
          nextRuntime = {
            ...vaultState,
            riskSubscriptionId,
            consecutiveTickFailures: 0,
            watchdog: deriveWatchdogStatus({
              paused: vaultState.paused,
              killed: optimizer.metrics().killed,
              operatorStatus: optimizer.metrics().status,
              hasExposure:
                strategy.openOrders > 0 ||
                strategy.vaultBase > 0 ||
                strategy.vaultQuote > 0,
              analyticsStale,
              queuedLiabilities: vaultState.queuedLiabilities,
              queueStalled: stallTracker.update(vaultState.queuedLiabilities),
              riskConfigured,
              riskSubscriptionId,
              keeperConfigured: keeper !== undefined,
            }),
          };
        },
        runtime,
        (message) => console.log(`[${new Date().toISOString()}] ${message}`),
      );
      if (result.ok) {
        runtime = { ...(nextRuntime ?? runtime), ...result.diagnostics };
      } else {
        runtime = {
          ...runtime,
          ...result.diagnostics,
          watchdog: markWatchdogRuntimeFailure(
            runtime.watchdog,
            result.diagnostics.lastTickError ?? "unknown error",
          ),
        };
      }
    } finally {
      ticking = false;
    }
  };

  let ws: DreamDexWs | undefined;
  if (context.net.wsUrl) {
    ws = new DreamDexWs(context.net.wsUrl, config.symbol, () => {
      void tick(ws?.lastMessageAt ?? 0);
    });
    ws.connect();
  } else {
    console.log("WebSocket disabled; using canonical on-chain polling");
  }
  const poll = setInterval(
    () => void tick(ws?.lastMessageAt ?? 0),
    config.refreshIntervalMs,
  );
  void tick(0);

  const port = Number(process.env.PORT ?? process.env.OPERATOR_PORT ?? 8787);
  const server = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Content-Type", "application/json");
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      response.statusCode = runtime.watchdog.ok ? 200 : 503;
      response.end(
        JSON.stringify({
          ...runtime.watchdog,
          paused: runtime.paused,
          queuedLiabilities: runtime.queuedLiabilities.toString(),
          riskSubscriptionId: runtime.riskSubscriptionId.toString(),
          lastSuccessfulTickAt: runtime.lastSuccessfulTickAt,
          consecutiveTickFailures: runtime.consecutiveTickFailures,
          lastTickError: runtime.lastTickError,
        }),
      );
      return;
    }
    if (url.pathname === "/metrics") {
      response.end(
        JSON.stringify({
          ...optimizer.metrics(),
          vault,
          pool: pool.address,
          symbol: pool.symbol,
          chainId: context.net.chainId,
          vaultPaused: runtime.paused,
          queuedLiabilities: runtime.queuedLiabilities.toString(),
          riskSubscriptionId: runtime.riskSubscriptionId.toString(),
          lastSuccessfulTickAt: runtime.lastSuccessfulTickAt,
          consecutiveTickFailures: runtime.consecutiveTickFailures,
          lastTickError: runtime.lastTickError,
          watchdog: runtime.watchdog,
        }),
      );
      return;
    }
    if (url.pathname === "/analytics") {
      const period = parsePeriod(url.searchParams.get("period"));
      void strategyStatus(pool, optimizer.metrics(), runtime.paused)
        .then((strategy) => {
          const report = analytics.getReport(period, strategy);
          if (
            Date.now() - (analyticsDb.lastSnapshotAt() ?? 0) >
              indexerConfig.snapshotIntervalMs * 3 &&
            report.strategy.state !== "halted"
          ) {
            report.strategy = {
              ...report.strategy,
              state: "offline",
              reason: "Analytics snapshots are stale",
            };
          }
          response.end(JSON.stringify(report));
        })
        .catch((error) => {
          response.statusCode = 503;
          response.end(
            JSON.stringify({
              error: "analytics_unavailable",
              message: (error as Error).message,
            }),
          );
        });
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(port, "0.0.0.0", () =>
    console.log(`operator metrics listening on 0.0.0.0:${port}`),
  );

  const shutdown = async () => {
    clearInterval(poll);
    ws?.close();
    analytics.close();
    await optimizer.cancelAll();
    server.close();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
}

async function strategyStatus(
  pool: Pool,
  metrics: ReturnType<YieldOptimizer["metrics"]>,
  paused: boolean,
): Promise<StrategyStatus> {
  const [openOrders, inventory] = await Promise.all([
    pool.openOrderIds(),
    pool.inventoryBalances(),
  ]);
  return deriveStrategyStatus({
    paused,
    killed: metrics.killed,
    ...(metrics.killReason ? { killReason: metrics.killReason } : {}),
    operatorStatus: metrics.status,
    openOrders: openOrders.length,
    vaultBase: inventory.base,
    vaultQuote: inventory.quote,
  });
}

function parsePeriod(value: string | null): AnalyticsPeriod {
  return value === "24h" || value === "7d" || value === "30d" ? value : "all";
}

async function readVaultState(
  context: ReturnType<typeof createChainContext>,
  vault: Address,
): Promise<{ paused: boolean; queuedLiabilities: bigint }> {
  const [paused, queuedLiabilities] = await Promise.all([
    context.publicClient.readContract({
      address: vault,
      abi: VAULT_STATE_ABI,
      functionName: "paused",
    }),
    context.publicClient.readContract({
      address: vault,
      abi: VAULT_STATE_ABI,
      functionName: "queuedLiabilities",
    }),
  ]);
  return { paused, queuedLiabilities };
}

async function readRiskSubscription(
  context: ReturnType<typeof createChainContext>,
  riskHandler: Address,
  configured: boolean,
): Promise<bigint> {
  if (!configured) return 0n;
  try {
    return await context.publicClient.readContract({
      address: riskHandler,
      abi: RISK_ABI,
      functionName: "subscriptionId",
    });
  } catch {
    return 0n;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
