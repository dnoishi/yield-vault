import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAbi } from "viem";

const runLocal = process.env.RUN_LOCAL_INTEGRATION === "true";

describe.runIf(runLocal)("local Anvil operator integration", () => {
  it("reads vault inventory, places and cancels a scoped order, and reports metrics", async () => {
    const deployment = JSON.parse(
      readFileSync(new URL("../../../deployments/local.json", import.meta.url), "utf8"),
    ) as Record<string, `0x${string}`>;
    process.env.NETWORK = "local";
    process.env.RPC_URL = "http://127.0.0.1:8545";
    process.env.WS_URL = "";
    process.env.PRIVATE_KEY =
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    process.env.OWNER_ADDRESS = deployment.vault;
    process.env.POOL_ADDRESS = deployment.pool;
    process.env.OPERATOR_REGISTRY = deployment.operatorRegistry;
    process.env.YO_SYMBOL = "LOCAL:USDso";
    process.env.YO_MIN_GAS_SOMI = "0";

    const [{ createChainContext }, { Pool }, { YieldOptimizer }, { loadStrategyConfig }] =
      await Promise.all([
        import("./client.js"),
        import("./pool.js"),
        import("../strategy/yieldOptimizer.js"),
        import("../strategy/config.js"),
      ]);
    const context = createChainContext();
    const pool = await Pool.load(context, "LOCAL:USDso");
    const book = await pool.topOfBook();
    expect(book.mid).toBe(2_000);
    expect(await pool.vaultQuote()).toBeGreaterThan(0);
    expect(await pool.vaultBase()).toBeGreaterThan(0);
    const inventoryBefore = await pool.inventoryBalances();

    const placed = await pool.place({
      isBid: true,
      price: 1_999,
      quantity: 0.01,
      expireMs: 60_000,
    });
    expect(placed.orderId).toBeGreaterThan(0n);
    expect(await pool.openOrderIds()).toContain(placed.orderId);
    const inventoryAfter = await pool.inventoryBalances();
    expect(inventoryAfter.base).toBeCloseTo(inventoryBefore.base);
    expect(inventoryAfter.quote).toBeCloseTo(inventoryBefore.quote);
    await pool.cancel(placed.orderId);
    expect(await pool.openOrderIds()).not.toContain(placed.orderId);

    const optimizer = new YieldOptimizer(context, pool, loadStrategyConfig(), () => {});
    expect(await optimizer.inventoryUsdso(book.mid)).toBeGreaterThan(0);
    expect(optimizer.metrics().vaultQuote).toBeGreaterThan(0);

    const paused = await context.publicClient.readContract({
      address: deployment.vault!,
      abi: parseAbi(["function paused() view returns (bool)"]),
      functionName: "paused",
    });
    expect(paused).toBe(false);
  });
});
