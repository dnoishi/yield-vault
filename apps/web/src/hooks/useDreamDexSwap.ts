import { useCallback, useEffect, useMemo, useState } from "react";
import {
  decodeAbiParameters,
  formatUnits,
  parseUnits,
  zeroAddress,
  type Address,
} from "viem";
import { createSiweMessage } from "viem/siwe";
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useReadContract,
  useSendTransaction,
  useSignMessage,
} from "wagmi";
import { erc20Abi } from "../abi";
import {
  configuredChainId,
  dreamDexApiUrl,
  dreamDexSwapSymbol,
} from "../config";
import {
  DreamDexApiError,
  getDreamDexAuthNonce,
  getDreamDexCurrencies,
  getDreamDexMarkets,
  getDreamDexOrderBook,
  loginToDreamDex,
  prepareDreamDexOrder,
  type DreamDexAuthToken,
  type DreamDexMarket,
  type DreamDexOrderBook,
} from "../dreamdex";

const USDSO_FALLBACK =
  "0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171" as Address;
const GAS_RESERVE = parseUnits("0.02", 18);
const SESSION_MARGIN_MS = 60_000;

export function useDreamDexSwap() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: configuredChainId });
  const { signMessageAsync } = useSignMessage();
  const { sendTransactionAsync } = useSendTransaction();
  const [amount, setAmount] = useState("");
  const [market, setMarket] = useState<DreamDexMarket>();
  const [book, setBook] = useState<DreamDexOrderBook>();
  const [usdsoAddress, setUsdsoAddress] = useState<Address>(USDSO_FALLBACK);
  const [loadingMarket, setLoadingMarket] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [marketError, setMarketError] = useState("");

  const nativeBalance = useBalance({
    address,
    chainId: configuredChainId,
    query: { enabled: Boolean(address) },
  });
  const usdsoBalance = useReadContract({
    address: usdsoAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address ?? zeroAddress],
    chainId: configuredChainId,
    query: { enabled: Boolean(address) },
  });

  const loadMarket = useCallback(async () => {
    if (!dreamDexApiUrl) {
      setMarketError("DreamDEX is unavailable on this network.");
      setLoadingMarket(false);
      return;
    }
    try {
      const [markets, currencies, orderBook] = await Promise.all([
        getDreamDexMarkets(dreamDexApiUrl),
        getDreamDexCurrencies(dreamDexApiUrl),
        getDreamDexOrderBook(dreamDexApiUrl, dreamDexSwapSymbol, 20),
      ]);
      const nextMarket = markets.find(
        (candidate) => candidate.symbol === dreamDexSwapSymbol,
      );
      if (!nextMarket || !orderBook) {
        throw new Error(`DreamDEX returned no ${dreamDexSwapSymbol} market`);
      }
      setMarket(nextMarket);
      setBook(orderBook);
      setUsdsoAddress(
        currencies.find((currency) => currency.code === "USDso")?.id ??
          USDSO_FALLBACK,
      );
      setMarketError("");
    } catch (error) {
      setMarketError(errorMessage(error));
    } finally {
      setLoadingMarket(false);
    }
  }, []);

  useEffect(() => {
    void loadMarket();
    const timer = window.setInterval(() => void loadMarket(), 8_000);
    return () => window.clearInterval(timer);
  }, [loadMarket]);

  useEffect(() => {
    setStatus("");
  }, [address]);

  const amountRaw = useMemo(
    () => parseAmount(amount, market?.baseDecimals ?? 18),
    [amount, market?.baseDecimals],
  );
  const minimumRaw = useMemo(
    () => parseAmount(market?.minQuantity ?? "", market?.baseDecimals ?? 18),
    [market],
  );
  const lotRaw = useMemo(
    () => parseAmount(market?.lotSize ?? "", market?.baseDecimals ?? 18),
    [market],
  );
  const amountIsValid =
    amountRaw > 0n &&
    amountRaw >= minimumRaw &&
    lotRaw > 0n &&
    amountRaw % lotRaw === 0n;
  const estimatedUsdso = useMemo(
    () => estimateSell(book, amount),
    [book, amount],
  );
  const availableStt =
    nativeBalance.data?.value && nativeBalance.data.value > GAS_RESERVE
      ? nativeBalance.data.value - GAS_RESERVE
      : 0n;

  async function authenticate(): Promise<string> {
    if (!dreamDexApiUrl || !address) throw new Error("Connect a wallet first.");
    const stored = readSession(address, dreamDexApiUrl);
    if (stored && stored.expiresAt > Date.now() + SESSION_MARGIN_MS) {
      return stored.token;
    }

    setStatus("Sign in to DreamDEX in your wallet…");
    const nonce = await getDreamDexAuthNonce(dreamDexApiUrl);
    const apiOrigin = new URL(dreamDexApiUrl).origin;
    const message = createSiweMessage({
      address,
      chainId: configuredChainId,
      domain: new URL(apiOrigin).host,
      nonce,
      statement: "Sign in to dreamDEX",
      uri: apiOrigin,
      version: "1",
    });
    const signature = await signMessageAsync({ message });
    const session = await loginToDreamDex(
      dreamDexApiUrl,
      message,
      signature,
    );
    writeSession(address, dreamDexApiUrl, session);
    return session.token;
  }

  async function sellStt() {
    if (!dreamDexApiUrl || !address || !publicClient || !market) return;
    if (chainId !== configuredChainId) {
      setStatus("Switch to Somnia Shannon before swapping.");
      return;
    }
    if (!amountIsValid) {
      setStatus(
        `Enter at least ${market.minQuantity} STT in ${market.lotSize} increments.`,
      );
      return;
    }
    if (amountRaw > availableStt) {
      setStatus("Insufficient STT after reserving 0.02 STT for gas.");
      return;
    }
    if (!book?.bids.length || estimatedUsdso.filled <= 0) {
      setStatus("No bids are available to fill this sell.");
      return;
    }

    setBusy(true);
    try {
      let token = await authenticate();
      setStatus("Preparing your market sell…");
      let transaction;
      try {
        transaction = await prepareDreamDexOrder(
          dreamDexApiUrl,
          dreamDexSwapSymbol,
          {
            type: "market",
            side: "sell",
            amount: normalizeAmount(amount, market.baseDecimals),
            fundingSource: "wallet",
            orderType: "immediateOrCancel",
          },
          token,
        );
      } catch (error) {
        if (!(error instanceof DreamDexApiError) || error.status !== 401) {
          throw error;
        }
        clearSession(address, dreamDexApiUrl);
        token = await authenticate();
        transaction = await prepareDreamDexOrder(
          dreamDexApiUrl,
          dreamDexSwapSymbol,
          {
            type: "market",
            side: "sell",
            amount: normalizeAmount(amount, market.baseDecimals),
            fundingSource: "wallet",
            orderType: "immediateOrCancel",
          },
          token,
        );
      }

      if (Number(transaction.chainId) !== configuredChainId) {
        throw new Error("DreamDEX prepared a transaction for the wrong network.");
      }

      setStatus("Checking the order on-chain…");
      const simulation = await publicClient.call({
        account: address,
        to: transaction.to,
        data: transaction.data,
        value: BigInt(transaction.value),
      });
      if (simulation.data) {
        const [success] = decodeAbiParameters(
          [{ type: "bool" }, { type: "uint128" }],
          simulation.data,
        );
        if (!success) throw new Error("DreamDEX rejected the order simulation.");
      }

      setStatus("Confirm the swap in your wallet…");
      const hash = await sendTransactionAsync({
        to: transaction.to,
        data: transaction.data,
        value: BigInt(transaction.value),
        ...(transaction.gasLimit
          ? { gas: BigInt(transaction.gasLimit) }
          : {}),
        chainId: configuredChainId,
      });
      setStatus("Swap submitted…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || receipt.logs.length === 0) {
        throw new Error("The transaction confirmed, but the order did not fill.");
      }
      setStatus("Swap complete. USDso was sent to your wallet.");
      setAmount("");
      await Promise.all([
        nativeBalance.refetch(),
        usdsoBalance.refetch(),
        loadMarket(),
      ]);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    amount,
    setAmount,
    market,
    book,
    loadingMarket,
    marketError,
    busy,
    status,
    isConnected,
    wrongNetwork: chainId !== configuredChainId,
    nativeBalance: nativeBalance.data?.value ?? 0n,
    usdsoBalance: (usdsoBalance.data as bigint | undefined) ?? 0n,
    availableStt,
    amountIsValid,
    estimatedUsdso,
    setMax: () =>
      setAmount(formatUnits(roundDown(availableStt, lotRaw), market?.baseDecimals ?? 18)),
    sellStt,
  };
}

function estimateSell(
  book: DreamDexOrderBook | undefined,
  amount: string,
): { output: number; filled: number } {
  let remaining = Number(amount);
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return { output: 0, filled: 0 };
  }
  let output = 0;
  let filled = 0;
  for (const level of book?.bids ?? []) {
    const price = Number(level.price);
    const quantity = Number(level.quantity);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) continue;
    const take = Math.min(remaining, quantity);
    output += take * price;
    filled += take;
    remaining -= take;
    if (remaining <= 0) break;
  }
  return { output, filled };
}

function parseAmount(value: string, decimals: number): bigint {
  try {
    return value ? parseUnits(value, decimals) : 0n;
  } catch {
    return 0n;
  }
}

function normalizeAmount(value: string, decimals: number): string {
  return formatUnits(parseUnits(value, decimals), decimals);
}

function roundDown(value: bigint, increment: bigint): bigint {
  return increment > 0n ? value - (value % increment) : value;
}

function sessionKey(address: Address, baseUrl: string): string {
  return `dreamdex:${baseUrl}:${address.toLowerCase()}`;
}

function readSession(
  address: Address,
  baseUrl: string,
): DreamDexAuthToken | undefined {
  try {
    const value = sessionStorage.getItem(sessionKey(address, baseUrl));
    return value ? (JSON.parse(value) as DreamDexAuthToken) : undefined;
  } catch {
    return undefined;
  }
}

function writeSession(
  address: Address,
  baseUrl: string,
  session: DreamDexAuthToken,
) {
  sessionStorage.setItem(sessionKey(address, baseUrl), JSON.stringify(session));
}

function clearSession(address: Address, baseUrl: string) {
  sessionStorage.removeItem(sessionKey(address, baseUrl));
}

function errorMessage(error: unknown): string {
  return (error as Error).message?.split("\n")[0] ?? "Swap failed";
}
