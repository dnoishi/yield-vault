import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain, type Address } from "viem";

export const somnia = defineChain({
  id: 5031,
  name: "Somnia",
  nativeCurrency: { name: "SOMI", symbol: "SOMI", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.infra.mainnet.somnia.network"] } },
  blockExplorers: {
    default: { name: "Somnia Explorer", url: "https://explorer.somnia.network" },
  },
});

export const shannon = defineChain({
  id: 50312,
  name: "Somnia Shannon",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://api.infra.testnet.somnia.network/"] },
  },
  blockExplorers: {
    default: { name: "Shannon Explorer", url: "https://shannon-explorer.somnia.network" },
  },
  testnet: true,
});

export const localAnvil = defineChain({
  id: 31337,
  name: "Local Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545"] },
  },
  testnet: true,
});

export const config = createConfig({
  chains: [localAnvil, shannon, somnia],
  connectors: [injected()],
  transports: {
    [localAnvil.id]: http(import.meta.env.VITE_RPC_URL),
    [shannon.id]: http(),
    [somnia.id]: http(),
  },
});

export const configuredChainId = Number(import.meta.env.VITE_CHAIN_ID ?? shannon.id);
export const targetChain =
  configuredChainId === localAnvil.id
    ? localAnvil
    : configuredChainId === somnia.id
      ? somnia
      : shannon;
export const vaultAddress = (import.meta.env.VITE_VAULT_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as Address;
export const riskHandlerAddress = (import.meta.env.VITE_RISK_HANDLER_ADDRESS ??
  (configuredChainId === shannon.id
    ? "0x7655a76b44aF4aFc6F6A3c653d33214E4735F676"
    : "0x0000000000000000000000000000000000000000")) as Address;
export const metricsUrl =
  import.meta.env.VITE_OPERATOR_METRICS_URL ?? "http://localhost:8787/metrics";
export const analyticsUrl =
  import.meta.env.VITE_OPERATOR_ANALYTICS_URL ?? "http://localhost:8787/analytics";
export const dreamDexApiUrl =
  import.meta.env.VITE_DREAMDEX_API_URL ?? "https://stg.api.dreamdex.io/v0";
export const dreamDexSymbol =
  import.meta.env.VITE_DREAMDEX_SYMBOL ?? "WETH:USDso";
export const vaultDeployBlock = envBigInt(
  import.meta.env.VITE_VAULT_DEPLOY_BLOCK,
);

function envBigInt(value: string | undefined): bigint {
  try {
    return value ? BigInt(value) : 0n;
  } catch {
    return 0n;
  }
}
