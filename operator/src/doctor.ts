import WebSocket from "ws";
import { createPublicClient, http, parseAbi } from "viem";
import { SPOT_POOL_ABI } from "./dreamdex/abi.js";
import { getNetwork, MARKETS } from "./dreamdex/config.js";

const ERC20_METADATA_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

async function main(): Promise<void> {
  const net = getNetwork();
  if (net.name === "local") throw new Error("doctor is intended for Somnia networks");
  const symbol = process.env.YO_SYMBOL ?? "WETH:USDso";
  const market = MARKETS[net.name][symbol];
  if (!market) throw new Error(`Unknown ${net.name} market ${symbol}`);
  const client = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) });

  const [chainId, registryCode, params, bids, asks] = await Promise.all([
    client.getChainId(),
    client.getCode({ address: net.operatorRegistry }),
    client.readContract({
      address: market.pool,
      abi: SPOT_POOL_ABI,
      functionName: "getPoolParams",
    }),
    client.readContract({
      address: market.pool,
      abi: SPOT_POOL_ABI,
      functionName: "getBookLevels",
      args: [true, 1n],
    }),
    client.readContract({
      address: market.pool,
      abi: SPOT_POOL_ABI,
      functionName: "getBookLevels",
      args: [false, 1n],
    }),
  ]);
  if (chainId !== net.chainId) throw new Error(`RPC chain ${chainId}; expected ${net.chainId}`);
  if (!registryCode || registryCode === "0x") throw new Error("operator registry has no code");
  if (bids.length === 0 || asks.length === 0) throw new Error(`${symbol} book is not two-sided`);

  const [baseDecimals, quoteDecimals, baseSymbol, quoteSymbol] = await Promise.all([
    client.readContract({
      address: params[0],
      abi: ERC20_METADATA_ABI,
      functionName: "decimals",
    }),
    client.readContract({
      address: params[1],
      abi: ERC20_METADATA_ABI,
      functionName: "decimals",
    }),
    client.readContract({
      address: params[0],
      abi: ERC20_METADATA_ABI,
      functionName: "symbol",
    }),
    client.readContract({
      address: params[1],
      abi: ERC20_METADATA_ABI,
      functionName: "symbol",
    }),
  ]);
  const wsFresh = await checkWebSocket(net.wsUrl, symbol);
  if (!wsFresh) throw new Error("DreamDEX WebSocket produced no application message");

  console.log(
    JSON.stringify(
      {
        ok: true,
        network: net.name,
        chainId,
        pool: market.pool,
        operatorRegistry: net.operatorRegistry,
        base: { address: params[0], symbol: baseSymbol, decimals: baseDecimals },
        quote: { address: params[1], symbol: quoteSymbol, decimals: quoteDecimals },
        tickSize: params[4].toString(),
        minQuantity: params[5].toString(),
        lotSize: params[6].toString(),
        bestBid: bids[0]!.price.toString(),
        bestAsk: asks[0]!.price.toString(),
        websocket: "fresh",
      },
      null,
      2,
    ),
  );
}

function checkWebSocket(url: string, symbol: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 15_000);
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          operation: "subscribe",
          channel: "orderbook",
          params: { symbols: [symbol] },
        }),
      );
    });
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.operation === "pong") return;
        clearTimeout(timer);
        ws.close();
        resolve(true);
      } catch {
        // Wait for a valid application frame.
      }
    });
    ws.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

main().catch((error) => {
  console.error(`Shannon doctor failed: ${(error as Error).message}`);
  process.exit(1);
});
