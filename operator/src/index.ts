import "./env.js";
import { createServer } from "node:http";
import { parseAbi, type Address } from "viem";
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
import { loadStrategyConfig } from "./strategy/config.js";
import { YieldOptimizer } from "./strategy/yieldOptimizer.js";

const PAUSE_ABI = parseAbi(["function paused() view returns (bool)"]);

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
  let paused = await isPaused(context, vault);
  let ticking = false;

  const tick = async (lastWsAt: number) => {
    if (ticking) return;
    ticking = true;
    try {
      paused = await isPaused(context, vault);
      if (paused) await optimizer.cancelAll();
      else await optimizer.onBook(lastWsAt);
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
      response.end(JSON.stringify({ ok: true, paused }));
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
          vaultPaused: paused,
        }),
      );
      return;
    }
    if (url.pathname === "/analytics") {
      const period = parsePeriod(url.searchParams.get("period"));
      void strategyStatus(pool, optimizer.metrics(), paused)
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

async function isPaused(
  context: ReturnType<typeof createChainContext>,
  vault: Address,
): Promise<boolean> {
  return context.publicClient.readContract({
    address: vault,
    abi: PAUSE_ABI,
    functionName: "paused",
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
