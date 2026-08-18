import "./env.js";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { VAULT_ABI } from "./dreamdex/abi.js";
import { getNetwork } from "./dreamdex/config.js";

async function main(): Promise<void> {
  const net = getNetwork();
  const key = (process.env.ADMIN_PRIVATE_KEY ?? process.env.PRIVATE_KEY) as Hex;
  const vault = (process.env.VAULT_ADDRESS ?? process.env.OWNER_ADDRESS) as Address;
  const operator = process.env.OPERATOR_ADDRESS as Address;
  if (!key || !vault || !operator) {
    throw new Error("ADMIN_PRIVATE_KEY, VAULT_ADDRESS, and OPERATOR_ADDRESS are required");
  }
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: net.chain,
    transport: http(net.rpcUrl),
  });

  for (const call of [
    { functionName: "enableManualVaultMode" as const, args: [] as const },
    { functionName: "setOperator" as const, args: [operator, true] as const },
  ]) {
    const simulation = await publicClient.simulateContract({
      address: vault,
      abi: VAULT_ABI,
      ...call,
      account,
    });
    const hash = await walletClient.writeContract({
      ...simulation.request,
      account,
      chain: net.chain,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`${call.functionName}: ${hash}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
