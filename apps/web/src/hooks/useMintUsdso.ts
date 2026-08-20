import { useState } from "react";
import { parseUnits, zeroAddress, type Address } from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { usdsoMintAbi } from "../abi";
import { configuredChainId } from "../config";

const USDSO_ADDRESS =
  "0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171" as Address;
const MINT_AMOUNT = parseUnits("100", 18);

export function useMintUsdso() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: configuredChainId });
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const nativeBalance = useBalance({
    address,
    chainId: configuredChainId,
    query: { enabled: Boolean(address) },
  });
  const usdsoBalance = useReadContract({
    address: USDSO_ADDRESS,
    abi: usdsoMintAbi,
    functionName: "balanceOf",
    args: [address ?? zeroAddress],
    chainId: configuredChainId,
    query: { enabled: Boolean(address) },
  });

  const wrongNetwork = isConnected && chainId !== configuredChainId;

  async function mint() {
    if (!address || !publicClient || wrongNetwork) return;
    setBusy(true);
    setStatus("Confirm transaction in your wallet…");
    try {
      const hash = await writeContractAsync({
        address: USDSO_ADDRESS,
        abi: usdsoMintAbi,
        functionName: "mint",
        args: [address, MINT_AMOUNT],
        chainId: configuredChainId,
      });
      setStatus("Transaction submitted…");
      await publicClient.waitForTransactionReceipt({ hash });
      await Promise.all([usdsoBalance.refetch(), nativeBalance.refetch()]);
      setStatus("Mint complete. 100 USDso was sent to your wallet.");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    isConnected,
    wrongNetwork,
    busy,
    status,
    usdsoBalance: usdsoBalance.data ?? 0n,
    nativeBalance: nativeBalance.data?.value ?? 0n,
    mint,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.split("\n")[0] ?? "Transaction failed.";
  }
  return "Transaction failed.";
}
