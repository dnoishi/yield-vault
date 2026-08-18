/**
 * Adapted from somnia-chain/dreamdex-bot-kit under its MIT-style license.
 * This project is self-contained and does not import that repository.
 */
import { defineChain, type Chain } from "viem";

export type NetworkName = "mainnet" | "testnet" | "local";

export interface NetworkConfig {
  name: NetworkName;
  chainId: number;
  rpcUrl: string;
  wsUrl: string;
  explorer: string;
  operatorRegistry: `0x${string}`;
  chain: Chain;
}

function network(
  name: NetworkName,
  chainId: number,
  rpcUrl: string,
  wsUrl: string,
  explorer: string,
  operatorRegistry: `0x${string}`,
): NetworkConfig {
  const chain = defineChain({
    id: chainId,
    name: name === "mainnet" ? "Somnia" : name === "testnet" ? "Somnia Shannon" : "Local Anvil",
    nativeCurrency: {
      name: name === "mainnet" ? "SOMI" : name === "testnet" ? "STT" : "ETH",
      symbol: name === "mainnet" ? "SOMI" : name === "testnet" ? "STT" : "ETH",
      decimals: 18,
    },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Explorer", url: explorer } },
  });
  return { name, chainId, rpcUrl, wsUrl, explorer, operatorRegistry, chain };
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  mainnet: network(
    "mainnet",
    5031,
    process.env.RPC_URL ?? "https://api.infra.mainnet.somnia.network",
    process.env.WS_URL ?? "wss://api.dreamdex.io/v0/ws/public",
    "https://explorer.somnia.network",
    "0xE7a190736B6024a4DbafadC04E283075877005ce",
  ),
  testnet: network(
    "testnet",
    50312,
    process.env.RPC_URL ?? "https://api.infra.testnet.somnia.network/",
    process.env.WS_URL ?? "wss://stg.api.dreamdex.io/v0/ws/public",
    "https://shannon-explorer.somnia.network",
    "0x15C7e8CE38F021c5b45d098AaD788f63090bF20A",
  ),
  local: network(
    "local",
    31337,
    process.env.RPC_URL ?? "http://127.0.0.1:8545",
    process.env.WS_URL ?? "",
    "http://127.0.0.1:8545",
    (process.env.OPERATOR_REGISTRY ??
      "0x0000000000000000000000000000000000000000") as `0x${string}`,
  ),
};

export interface MarketMeta {
  symbol: string;
  pool: `0x${string}`;
  baseDecimals: number;
  quoteDecimals: number;
  baseIsNative: boolean;
}

export const MARKETS: Record<NetworkName, Record<string, MarketMeta>> = {
  mainnet: {
    "SOMI:USDso": {
      symbol: "SOMI:USDso",
      pool: "0x035De7403eac6872787779CCA7CCF1b4CDb61379",
      baseDecimals: 18,
      quoteDecimals: 18,
      baseIsNative: true,
    },
    "USDC.e:USDso": {
      symbol: "USDC.e:USDso",
      pool: "0x47fD2f18426f67106DBaC82F6d21D446c5F2120b",
      baseDecimals: 6,
      quoteDecimals: 18,
      baseIsNative: false,
    },
    "WETH:USDso": {
      symbol: "WETH:USDso",
      pool: "0xa936da11B57b50A344e1293AAaE5232885ea2bDE",
      baseDecimals: 18,
      quoteDecimals: 18,
      baseIsNative: false,
    },
    "WBTC:USDso": {
      symbol: "WBTC:USDso",
      pool: "0x25bfF6B7B5E2243424F38E75de7ab03C0522a5EA",
      baseDecimals: 8,
      quoteDecimals: 18,
      baseIsNative: false,
    },
  },
  testnet: {
    "SOMI:USDso": {
      symbol: "SOMI:USDso",
      pool: "0x259fD6559214dd5aD3752322426eA9F9fABEFff4",
      baseDecimals: 18,
      quoteDecimals: 18,
      baseIsNative: true,
    },
    "WETH:USDso": {
      symbol: "WETH:USDso",
      pool: "0xD180195da5459C7a0DEA188ed61216ec43682b50",
      baseDecimals: 18,
      quoteDecimals: 18,
      baseIsNative: false,
    },
    "WBTC:USDso": {
      symbol: "WBTC:USDso",
      pool: "0x3605f28aA7C50e7441211e77Cb0762d49539326C",
      baseDecimals: 8,
      quoteDecimals: 18,
      baseIsNative: false,
    },
  },
  local: {},
};

export function getNetwork(): NetworkConfig {
  const name = (process.env.NETWORK ?? "testnet") as NetworkName;
  if (!(name in NETWORKS)) throw new Error(`Unsupported NETWORK=${name}`);
  return NETWORKS[name];
}
