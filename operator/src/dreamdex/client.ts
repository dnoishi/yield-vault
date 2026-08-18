import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getNetwork } from "./config.js";

export function createChainContext() {
  const net = getNetwork();
  const key = process.env.PRIVATE_KEY as Hex | undefined;
  const owner = process.env.OWNER_ADDRESS as Address | undefined;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("PRIVATE_KEY must be a 32-byte 0x-prefixed operator key");
  }
  if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    throw new Error("OWNER_ADDRESS must be the deployed YieldVault");
  }
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: net.chain,
    transport: http(net.rpcUrl),
  });
  return { net, owner, account, publicClient, walletClient };
}

export type ChainContext = ReturnType<typeof createChainContext>;
