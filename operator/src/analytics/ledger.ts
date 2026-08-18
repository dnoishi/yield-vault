import { zeroAddress, type Address } from "viem";
import type {
  LedgerState,
  OwnerState,
  VaultEvent,
} from "./types.js";

export function createLedgerState(): LedgerState {
  return {
    deposits: 0n,
    outflows: 0n,
    owners: new Map(),
    requests: new Map(),
  };
}

export function applyEventTransactions(
  state: LedgerState,
  events: VaultEvent[],
): void {
  const sorted = [...events].sort(compareEvents);
  let index = 0;
  while (index < sorted.length) {
    const hash = sorted[index]!.transactionHash;
    let end = index + 1;
    while (end < sorted.length && sorted[end]!.transactionHash === hash) ++end;
    applyTransaction(state, sorted.slice(index, end));
    index = end;
  }
}

function applyTransaction(state: LedgerState, events: VaultEvent[]): void {
  const ignoredTransfers = new Set<number>();
  for (const event of events) {
    if (event.type === "deposit") {
      markClosestTransfer(
        events,
        ignoredTransfers,
        event,
        zeroAddress,
        event.owner,
        event.shares,
      );
    } else if (event.type === "withdraw" || event.type === "withdrawalRequested") {
      markClosestTransfer(
        events,
        ignoredTransfers,
        event,
        event.owner,
        zeroAddress,
        event.shares,
      );
    }
  }

  for (const event of [...events].sort(compareEvents)) {
    if (event.type === "transfer") {
      if (ignoredTransfers.has(event.logIndex)) continue;
      applyTransfer(state, event.from, event.to, event.shares);
      continue;
    }
    if (event.type === "deposit") {
      const owner = getOwner(state, event.owner);
      owner.shares += event.shares;
      owner.basis += event.assets;
      state.deposits += event.assets;
      continue;
    }
    if (event.type === "withdraw") {
      const owner = getOwner(state, event.owner);
      const basis = removeShares(owner, event.shares);
      owner.realized += event.assets - basis;
      owner.paidAssets += event.assets;
      state.outflows += event.assets;
      continue;
    }
    if (event.type === "withdrawalRequested") {
      const owner = getOwner(state, event.owner);
      const basis = removeShares(owner, event.shares);
      owner.realized += event.assets - basis;
      owner.pendingClaims += event.assets;
      state.requests.set(event.requestId, {
        requestId: event.requestId,
        owner: normalized(event.owner),
        receiver: normalized(event.receiver),
        assets: event.assets,
        processed: false,
      });
      continue;
    }
    const request = state.requests.get(event.requestId);
    if (!request) {
      throw new Error(`WithdrawalProcessed without request ${event.requestId}`);
    }
    if (!request.processed) {
      const owner = getOwner(state, request.owner);
      owner.pendingClaims -= request.assets;
      owner.paidAssets += request.assets;
      request.processed = true;
      state.outflows += request.assets;
    }
  }
}

function applyTransfer(
  state: LedgerState,
  from: Address,
  to: Address,
  shares: bigint,
): void {
  if (shares === 0n) return;
  if (from.toLowerCase() === zeroAddress) {
    getOwner(state, to).shares += shares;
    return;
  }
  const sender = getOwner(state, from);
  const basis = removeShares(sender, shares);
  if (to.toLowerCase() !== zeroAddress) {
    const receiver = getOwner(state, to);
    receiver.shares += shares;
    receiver.basis += basis;
  }
}

function removeShares(owner: OwnerState, shares: bigint): bigint {
  if (shares > owner.shares) {
    throw new Error(
      `Share ledger underflow for ${owner.address}: ${shares} > ${owner.shares}`,
    );
  }
  const basis =
    shares === owner.shares
      ? owner.basis
      : owner.shares === 0n
        ? 0n
        : (owner.basis * shares) / owner.shares;
  owner.shares -= shares;
  owner.basis -= basis;
  return basis;
}

function getOwner(state: LedgerState, address: Address): OwnerState {
  const key = normalized(address);
  let owner = state.owners.get(key);
  if (!owner) {
    owner = {
      address: key,
      shares: 0n,
      basis: 0n,
      realized: 0n,
      pendingClaims: 0n,
      paidAssets: 0n,
    };
    state.owners.set(key, owner);
  }
  return owner;
}

function markClosestTransfer(
  events: VaultEvent[],
  ignored: Set<number>,
  semantic: VaultEvent,
  from: Address,
  to: Address,
  shares: bigint,
): void {
  const transfer = events
    .filter(
      (candidate) =>
        candidate.type === "transfer" &&
        !ignored.has(candidate.logIndex) &&
        candidate.logIndex < semantic.logIndex &&
        candidate.from.toLowerCase() === from.toLowerCase() &&
        candidate.to.toLowerCase() === to.toLowerCase() &&
        candidate.shares === shares,
    )
    .sort((a, b) => b.logIndex - a.logIndex)[0];
  if (!transfer) {
    throw new Error(
      `Missing paired Transfer for ${semantic.type} in ${semantic.transactionHash}`,
    );
  }
  ignored.add(transfer.logIndex);
}

function compareEvents(a: VaultEvent, b: VaultEvent): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  if (a.transactionIndex !== b.transactionIndex) {
    return a.transactionIndex - b.transactionIndex;
  }
  return a.logIndex - b.logIndex;
}

function normalized(address: Address): Address {
  return address.toLowerCase() as Address;
}
