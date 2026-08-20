import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  encodeFunctionData,
  formatUnits,
  maxUint256,
  parseUnits,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import {
  useAccount,
  useCapabilities,
  useChainId,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useSendCallsSync,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { erc20Abi, riskHandlerAbi, vaultAbi } from "../abi";
import {
  analyticsUrl,
  configuredChainId,
  dreamDexApiUrl,
  dreamDexSymbol,
  metricsUrl,
  riskHandlerAddress,
  targetChain,
  vaultAddress,
} from "../config";
import {
  loadAnalytics,
  type AnalyticsPeriod,
  type AnalyticsReport,
} from "../analytics";
import {
  loadDreamDexMarketData,
  type DreamDexMarketData,
} from "../dreamdex";

export interface OperatorMetrics {
  status?: string;
  estimatedYieldScore?: number;
  scoreRate?: number;
  inventoryUsdso?: number;
  vaultBase?: number;
  vaultQuote?: number;
  lastMid?: number;
  vaultPaused?: boolean;
  marketSpreadBps?: number;
  marketMoveBps?: number;
  observedMaxSpreadBps?: number;
  observedMaxMoveBps?: number;
  watchdog?: {
    ok: boolean;
    level: "healthy" | "degraded" | "unhealthy";
    reasons: string[];
    checks: {
      operator: string;
      analytics: string;
      withdrawals: string;
      riskHandler: string;
      keeper: string;
      vault: string;
    };
  };
  updatedAt?: string;
}

const ZERO_HASH = `0x${"0".repeat(64)}` as Hash;
const MAX_QUEUE_SCAN = 128n;

export const QUEUE_STATUS_TITLE = "Queued — processing as liquidity frees";
export const QUEUE_SUCCESS_MESSAGE =
  "Withdrawal queued. Your shares were burned. Funds pay out as liquidity frees.";

export interface PendingWithdrawal {
  requestId: bigint;
  assets: bigint;
  requestedAt: bigint;
  queuePosition: number;
}

function useDashboardState() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: configuredChainId });
  const { writeContractAsync } = useWriteContract();
  const { mutateAsync: sendCallsSyncAsync } = useSendCallsSync();
  const { data: capabilities } = useCapabilities({
    query: { enabled: isConnected },
  });
  const account = address ?? zeroAddress;
  const [depositMode, setDepositMode] = useState<"deposit" | "mint">("deposit");
  const [depositInput, setDepositInput] = useState("");
  const [redeemInput, setRedeemInput] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [metrics, setMetrics] = useState<OperatorMetrics>();
  const [marketData, setMarketData] = useState<DreamDexMarketData>();
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState(false);
  const [period, setPeriod] = useState<AnalyticsPeriod>("all");
  const [analytics, setAnalytics] = useState<AnalyticsReport>();
  const [analyticsError, setAnalyticsError] = useState(false);

  const calls = [
    "asset",
    "totalAssets",
    "totalSupply",
    "balanceOf",
    "maxDeposit",
    "maxRedeem",
    "paused",
    "maxTotalAssets",
    "queuedLiabilities",
    "availableIdle",
    "nextRequestToProcess",
    "lastHaltReason",
    "nextRequestId",
  ] as const;
  const { data, refetch } = useReadContracts({
    contracts: calls.map((functionName) => ({
      address: vaultAddress,
      abi: vaultAbi,
      functionName,
      ...(functionName === "balanceOf" ||
      functionName === "maxDeposit" ||
      functionName === "maxRedeem"
        ? { args: [account] }
        : {}),
      chainId: configuredChainId,
    })),
    query: { refetchInterval: 8_000 },
  });

  const asset = (data?.[0]?.result as Address | undefined) ?? zeroAddress;
  const totalAssets = (data?.[1]?.result as bigint | undefined) ?? 0n;
  const totalSupply = (data?.[2]?.result as bigint | undefined) ?? 0n;
  const shareBalance = (data?.[3]?.result as bigint | undefined) ?? 0n;
  const maxDeposit = (data?.[4]?.result as bigint | undefined) ?? 0n;
  const maxRedeem = (data?.[5]?.result as bigint | undefined) ?? 0n;
  const paused = (data?.[6]?.result as boolean | undefined) ?? false;
  const cap = (data?.[7]?.result as bigint | undefined) ?? 0n;
  const queued = (data?.[8]?.result as bigint | undefined) ?? 0n;
  const idle = (data?.[9]?.result as bigint | undefined) ?? 0n;
  const queueHead = (data?.[10]?.result as bigint | undefined) ?? 0n;
  const haltReason = (data?.[11]?.result as Hash | undefined) ?? ZERO_HASH;
  const nextRequestId = (data?.[12]?.result as bigint | undefined) ?? 0n;

  const pendingRequestIds = useMemo(() => {
    if (nextRequestId <= queueHead) return [];
    const end =
      nextRequestId > queueHead + MAX_QUEUE_SCAN
        ? queueHead + MAX_QUEUE_SCAN
        : nextRequestId;
    const ids: bigint[] = [];
    for (let id = queueHead; id < end; id++) ids.push(id);
    return ids;
  }, [queueHead, nextRequestId]);

  const { data: requestData, refetch: refetchRequests } = useReadContracts({
    contracts: pendingRequestIds.map((requestId) => ({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "withdrawalRequests" as const,
      args: [requestId] as const,
      chainId: configuredChainId,
    })),
    query: { enabled: pendingRequestIds.length > 0, refetchInterval: 8_000 },
  });

  const pendingWithdrawals = useMemo(
    () =>
      ownerPendingWithdrawals(
        account,
        queueHead,
        pendingRequestIds.map((requestId, index) => ({
          requestId,
          result: requestData?.[index]?.result,
        })),
      ),
    [account, queueHead, pendingRequestIds, requestData],
  );
  const pendingClaimAssets = pendingWithdrawals.reduce(
    (sum, request) => sum + request.assets,
    0n,
  );

  const depositRaw = useMemo(() => safeParse(depositInput), [depositInput]);
  const redeemRaw = useMemo(() => safeParse(redeemInput), [redeemInput]);
  const { data: previewDepositShares = 0n } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "previewDeposit",
    args: [depositRaw],
    chainId: configuredChainId,
    query: { enabled: depositMode === "deposit" && depositRaw > 0n },
  });
  const { data: mintAssets = 0n } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "previewMint",
    args: [depositRaw],
    chainId: configuredChainId,
    query: { enabled: depositMode === "mint" && depositRaw > 0n },
  });
  const { data: redeemAssets = 0n } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "previewRedeem",
    args: [redeemRaw],
    chainId: configuredChainId,
    query: { enabled: redeemRaw > 0n },
  });
  const { data: positionAssets = 0n } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "convertToAssets",
    args: [shareBalance],
    chainId: configuredChainId,
    query: { enabled: shareBalance > 0n },
  });
  const requiredAssets = depositMode === "deposit" ? depositRaw : mintAssets;
  const sharesReceived =
    depositMode === "deposit" ? previewDepositShares : depositRaw;
  const { data: allowance = 0n, refetch: refetchAllowance } = useReadContract({
    address: asset,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, vaultAddress],
    chainId: configuredChainId,
    query: { enabled: asset !== zeroAddress && isConnected },
  });
  const { data: assetBalance = 0n } = useReadContract({
    address: asset,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
    chainId: configuredChainId,
    query: { enabled: asset !== zeroAddress && isConnected },
  });
  const riskCalls = [
    "subscriptionId",
    "maxSpreadBps",
    "maxMoveBps",
    "lastMid",
  ] as const;
  const { data: riskData } = useReadContracts({
    contracts: riskCalls.map((functionName) => ({
      address: riskHandlerAddress,
      abi: riskHandlerAbi,
      functionName,
      chainId: configuredChainId,
    })),
    query: {
      enabled: riskHandlerAddress !== zeroAddress,
      refetchInterval: 8_000,
    },
  });
  const riskHandler = {
    configured: riskHandlerAddress !== zeroAddress,
    subscriptionId: (riskData?.[0]?.result as bigint | undefined) ?? 0n,
    maxSpreadBps: Number(riskData?.[1]?.result ?? 0),
    maxMoveBps: Number(riskData?.[2]?.result ?? 0),
    lastMid: (riskData?.[3]?.result as bigint | undefined) ?? 0n,
  };

  useEffect(() => {
    const load = () =>
      fetch(metricsUrl)
        .then((response) => (response.ok ? response.json() : undefined))
        .then((value) => setMetrics(value as OperatorMetrics | undefined))
        .catch(() => setMetrics(undefined));
    void load();
    const interval = setInterval(load, 5_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const load = () =>
      loadDreamDexMarketData(dreamDexApiUrl, dreamDexSymbol)
        .then((value) => {
          setMarketData(value);
          setMarketError(false);
        })
        .catch(() => {
          setMarketData(undefined);
          setMarketError(true);
        })
        .finally(() => setMarketLoading(false));
    void load();
    const interval = setInterval(load, 8_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const load = () =>
      loadAnalytics(analyticsUrl, period)
        .then((report) => {
          setAnalytics(report);
          setAnalyticsError(false);
        })
        .catch(() => {
          setAnalytics(undefined);
          setAnalyticsError(true);
        });
    void load();
    const interval = setInterval(load, 8_000);
    return () => clearInterval(interval);
  }, [period]);

  const strategyState = paused
    ? "halted"
    : analytics?.strategy?.state ?? "offline";
  const strategyEarnings =
    analytics?.available && analytics.pnl.earnings !== null
      ? BigInt(analytics.pnl.earnings)
      : undefined;
  const connectedOwner = analytics?.owners.find(
    (owner) => owner.address.toLowerCase() === address?.toLowerCase(),
  );
  const ownerEarnings =
    connectedOwner?.periodEarnings !== null &&
    connectedOwner?.periodEarnings !== undefined
      ? BigInt(connectedOwner.periodEarnings)
      : undefined;
  const ownerRealized = connectedOwner
    ? BigInt(connectedOwner.realizedEarnings)
    : 0n;
  const ownerUnrealized = connectedOwner
    ? BigInt(connectedOwner.unrealizedEarnings)
    : 0n;
  const vaultRealized =
    analytics?.owners.reduce(
      (sum, owner) => sum + BigInt(owner.realizedEarnings),
      0n,
    ) ?? 0n;
  const vaultUnrealized =
    analytics?.owners.reduce(
      (sum, owner) => sum + BigInt(owner.unrealizedEarnings),
      0n,
    ) ?? 0n;
  const sharePrice =
    totalSupply > 0n ? Number(totalAssets) / Number(totalSupply) : 1;
  const ownerPercent = percentage(shareBalance, totalSupply);
  const wrongNetwork = isConnected && chainId !== configuredChainId;
  const requiresApproval = requiredAssets > allowance;
  const canInstantRedeem = redeemRaw <= maxRedeem && queued === 0n;
  const capabilityMap = capabilities as
    | Record<string, { atomic?: { status?: string } }>
    | undefined;
  const atomicStatus =
    capabilityMap?.[String(configuredChainId)]?.atomic?.status ??
    capabilityMap?.[`0x${configuredChainId.toString(16)}`]?.atomic?.status;
  const supportsAtomicBatch =
    atomicStatus === "supported" || atomicStatus === "ready";

  const indexedPendingClaims =
    connectedOwner?.pendingClaims !== undefined
      ? BigInt(connectedOwner.pendingClaims)
      : 0n;
  const claimAssets =
    pendingClaimAssets > 0n ? pendingClaimAssets : indexedPendingClaims;
  const hasPendingWithdrawals = claimAssets > 0n;
  const queueLength =
    nextRequestId > queueHead ? Number(nextRequestId - queueHead) : 0;

  async function refreshState() {
    await Promise.all([refetch(), refetchAllowance(), refetchRequests()]);
  }

  async function send(action: () => Promise<Hash>, success: string) {
    if (!publicClient) return;
    setBusy(true);
    setMessage("Confirm transaction in your wallet…");
    try {
      const hash = await action();
      setMessage("Transaction submitted…");
      await publicClient.waitForTransactionReceipt({ hash });
      setMessage(success);
      setRedeemInput("");
      await refreshState();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function depositOrMint() {
    if (!publicClient || requiredAssets === 0n) return;
    setBusy(true);
    try {
      const vaultCallData =
        depositMode === "deposit"
          ? encodeFunctionData({
              abi: vaultAbi,
              functionName: "deposit",
              args: [depositRaw, account],
            })
          : encodeFunctionData({
              abi: vaultAbi,
              functionName: "mint",
              args: [depositRaw, account],
            });
      if (requiresApproval && supportsAtomicBatch) {
        setMessage("Confirm the batched approval and deposit…");
        await sendCallsSyncAsync({
          chainId: configuredChainId,
          forceAtomic: true,
          calls: [
            {
              to: asset,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [vaultAddress, maxUint256],
              }),
            },
            { to: vaultAddress, data: vaultCallData },
          ],
          throwOnFailure: true,
        });
      } else {
        if (requiresApproval) {
          setMessage("First confirm USDso approval…");
          const approvalHash = await writeContractAsync({
            address: asset,
            abi: erc20Abi,
            functionName: "approve",
            args: [vaultAddress, maxUint256],
            chainId: configuredChainId,
          });
          await publicClient.waitForTransactionReceipt({ hash: approvalHash });
          setMessage("Approval confirmed. Now confirm the deposit…");
        } else {
          setMessage("Confirm transaction in your wallet…");
        }
        const hash = await writeContractAsync({
          address: vaultAddress,
          abi: vaultAbi,
          functionName: depositMode,
          args: [depositRaw, account],
          chainId: configuredChainId,
        });
        setMessage("Transaction submitted…");
        await publicClient.waitForTransactionReceipt({ hash });
      }
      setMessage(depositMode === "deposit" ? "Deposit complete." : "Shares minted.");
      setDepositInput("");
      await refreshState();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function redeemOrQueue() {
    await send(
      () =>
        writeContractAsync({
          address: vaultAddress,
          abi: vaultAbi,
          functionName: canInstantRedeem ? "redeem" : "requestRedeem",
          args: canInstantRedeem
            ? [redeemRaw, account, account]
            : [redeemRaw, account],
          chainId: configuredChainId,
        }),
      canInstantRedeem ? "Redemption complete." : QUEUE_SUCCESS_MESSAGE,
    );
  }

  return {
    address,
    isConnected,
    connectWallet: () => connectors[0] && connect({ connector: connectors[0] }),
    disconnectWallet: disconnect,
    switchNetwork: () => switchChain({ chainId: configuredChainId }),
    chain: targetChain,
    wrongNetwork,
    depositMode,
    setDepositMode,
    depositInput,
    setDepositInput,
    redeemInput,
    setRedeemInput,
    message,
    busy,
    metrics,
    marketData,
    marketLoading,
    marketError,
    period,
    setPeriod,
    analytics,
    analyticsError,
    totalAssets,
    totalSupply,
    assetBalance,
    shareBalance,
    maxDeposit,
    paused,
    cap,
    queued,
    idle,
    queueHead,
    nextRequestId,
    queueLength,
    pendingWithdrawals,
    pendingClaimAssets: claimAssets,
    hasPendingWithdrawals,
    haltReason,
    requiredAssets,
    sharesReceived,
    redeemAssets,
    positionAssets,
    strategyState,
    strategyEarnings,
    connectedOwner,
    ownerEarnings,
    ownerRealized,
    ownerUnrealized,
    vaultRealized,
    vaultUnrealized,
    riskHandler,
    sharePrice,
    ownerPercent,
    requiresApproval,
    canInstantRedeem,
    supportsAtomicBatch,
    redeemRaw,
    depositOrMint,
    redeemOrQueue,
  };
}

type VaultDashboardContextValue = ReturnType<typeof useDashboardState>;
const VaultDashboardContext = createContext<VaultDashboardContextValue | null>(null);

export function VaultDashboardProvider({ children }: { children: ReactNode }) {
  const value = useDashboardState();
  return (
    <VaultDashboardContext.Provider value={value}>
      {children}
    </VaultDashboardContext.Provider>
  );
}

export function useVaultDashboard() {
  const value = useContext(VaultDashboardContext);
  if (!value) {
    throw new Error("useVaultDashboard must be used inside VaultDashboardProvider");
  }
  return value;
}

export function safeParse(value: string): bigint {
  try {
    return value ? parseUnits(value, 18) : 0n;
  } catch {
    return 0n;
  }
}

export function format(value: bigint): string {
  return Number(formatUnits(value, 18)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

export function formatInput(value: bigint): string {
  return formatUnits(value, 18);
}

export function money(value: bigint): string {
  const amount = Number(formatUnits(value < 0n ? -value : value, 18));
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    notation: amount >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(amount);
}

export function signedMoney(value: bigint): string {
  if (value === 0n) return money(0n);
  return `${value > 0n ? "+" : "−"}${money(value)}`;
}

export function percentage(value: bigint, total: bigint): string {
  if (total === 0n) return "0.00%";
  return `${((Number(value) / Number(total)) * 100).toFixed(2)}%`;
}

export function signedPercent(value: number | undefined): string {
  if (value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function tone(value: bigint): string {
  return value > 0n ? "positive" : value < 0n ? "negative" : "";
}

export function capacity(value: bigint, cap: bigint): string {
  return cap === maxUint256 || value > maxUint256 / 2n
    ? "Uncapped"
    : money(value);
}

export function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
}

export function strategyLabel(
  state: "active" | "idle" | "offline" | "halted",
): string {
  if (state === "active") return "Active";
  if (state === "idle") return "Idle — no strategy earnings";
  if (state === "halted") return "Halted";
  return "Offline";
}

function errorMessage(error: unknown): string {
  return (error as Error).message.split("\n")[0] ?? "Transaction failed";
}

type WithdrawalRequestView = {
  receiver: string;
  assets: bigint;
  requestedAt: bigint;
  processed: boolean;
};

function asWithdrawalRequest(result: unknown): WithdrawalRequestView | undefined {
  if (!result) return undefined;
  if (Array.isArray(result) && result.length >= 4) {
    return {
      receiver: String(result[0]),
      assets: result[1] as bigint,
      requestedAt: result[2] as bigint,
      processed: Boolean(result[3]),
    };
  }
  if (typeof result === "object" && result !== null && "receiver" in result) {
    const request = result as WithdrawalRequestView;
    return {
      receiver: String(request.receiver),
      assets: request.assets,
      requestedAt: request.requestedAt,
      processed: Boolean(request.processed),
    };
  }
  return undefined;
}

export function ownerPendingWithdrawals(
  account: string,
  queueHead: bigint,
  requests: Array<{ requestId: bigint; result: unknown }>,
): PendingWithdrawal[] {
  if (!account || account === zeroAddress) return [];
  const owner = account.toLowerCase();
  const pending: PendingWithdrawal[] = [];
  for (const { requestId, result } of requests) {
    const request = asWithdrawalRequest(result);
    if (!request || request.processed) continue;
    if (request.receiver.toLowerCase() !== owner) continue;
    pending.push({
      requestId,
      assets: request.assets,
      requestedAt: request.requestedAt,
      queuePosition: Number(requestId - queueHead) + 1,
    });
  }
  return pending;
}
