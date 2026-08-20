import {
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { NetworkConfig } from "./dreamdex/config.js";

const KEEPER_ABI = parseAbi([
  "function queuedLiabilities() view returns (uint256)",
  "function processQueue(uint256 maxRequests)",
]);

export class WithdrawalKeeper {
  private running = false;
  private readonly account;
  private readonly walletClient;

  constructor(
    private readonly publicClient: PublicClient,
    network: NetworkConfig,
    private readonly vault: Address,
    key: Hex,
    private readonly maxRequests: bigint,
    private readonly log: (message: string) => void = console.log,
  ) {
    this.account = privateKeyToAccount(key);
    this.walletClient = createWalletClient({
      account: this.account,
      chain: network.chain,
      transport: http(network.rpcUrl),
    });
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const queued = await this.publicClient.readContract({
        address: this.vault,
        abi: KEEPER_ABI,
        functionName: "queuedLiabilities",
      });
      if (queued === 0n) return;
      const simulation = await this.publicClient.simulateContract({
        address: this.vault,
        abi: KEEPER_ABI,
        functionName: "processQueue",
        args: [this.maxRequests],
        account: this.account,
      });
      const hash = await this.walletClient.writeContract({
        ...simulation.request,
        account: this.account,
      });
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`processQueue reverted: ${hash}`);
      }
      this.log(`keeper processed withdrawal queue: ${hash}`);
    } catch (error) {
      this.log(`keeper tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

export function keeperPrivateKey(): Hex | undefined {
  const key = process.env.KEEPER_PRIVATE_KEY as Hex | undefined;
  if (!key) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("KEEPER_PRIVATE_KEY must be a 32-byte 0x-prefixed key");
  }
  return key;
}
