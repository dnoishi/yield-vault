import { describe, expect, it } from "vitest";
import { type Address, type Hash, zeroAddress } from "viem";
import { applyEventTransactions, createLedgerState } from "./ledger.js";
import type { VaultEvent } from "./types.js";

const UNIT = 10n ** 18n;
const alice = "0x1000000000000000000000000000000000000001" as Address;
const bob = "0x2000000000000000000000000000000000000002" as Address;
const feeRecipient = "0x3000000000000000000000000000000000000003" as Address;

describe("analytics ledger", () => {
  it("does not count a deposit at an elevated share price as earnings", () => {
    const state = createLedgerState();
    applyEventTransactions(state, [
      transfer(1, 0, hash(1), zeroAddress, alice, 100n * UNIT),
      deposit(1, 1, hash(1), alice, 100n * UNIT, 100n * UNIT),
      transfer(2, 0, hash(2), zeroAddress, bob, 100n * UNIT),
      deposit(2, 1, hash(2), bob, 110n * UNIT, 100n * UNIT),
    ]);

    const grossNav = 220n * UNIT;
    expect(grossNav - state.deposits + state.outflows).toBe(10n * UNIT);
    expect(state.deposits).toBe(210n * UNIT);
  });

  it("carries basis on transfers and treats fee mints as zero basis", () => {
    const state = createLedgerState();
    applyEventTransactions(state, [
      transfer(1, 0, hash(1), zeroAddress, alice, 100n * UNIT),
      deposit(1, 1, hash(1), alice, 100n * UNIT, 100n * UNIT),
      transfer(2, 0, hash(2), alice, bob, 40n * UNIT),
      transfer(3, 0, hash(3), zeroAddress, feeRecipient, 10n * UNIT),
    ]);

    expect(state.owners.get(alice)?.basis).toBe(60n * UNIT);
    expect(state.owners.get(bob)?.basis).toBe(40n * UNIT);
    expect(state.owners.get(feeRecipient)?.basis).toBe(0n);
    expect(state.owners.get(feeRecipient)?.shares).toBe(10n * UNIT);
  });

  it("keeps instant and queued payouts flow-neutral", () => {
    const state = createLedgerState();
    applyEventTransactions(state, [
      transfer(1, 0, hash(1), zeroAddress, alice, 100n * UNIT),
      deposit(1, 1, hash(1), alice, 100n * UNIT, 100n * UNIT),
      transfer(2, 0, hash(2), alice, zeroAddress, 50n * UNIT),
      withdraw(2, 1, hash(2), alice, 60n * UNIT, 50n * UNIT),
      transfer(3, 0, hash(3), alice, zeroAddress, 50n * UNIT),
      request(3, 1, hash(3), 7n, alice, 60n * UNIT, 50n * UNIT),
    ]);

    expect(state.outflows).toBe(60n * UNIT);
    expect(state.owners.get(alice)?.realized).toBe(20n * UNIT);
    expect(state.owners.get(alice)?.pendingClaims).toBe(60n * UNIT);
    expect(60n * UNIT + state.outflows - state.deposits).toBe(20n * UNIT);

    applyEventTransactions(state, [processed(4, 0, hash(4), 7n, 60n * UNIT)]);
    expect(state.outflows).toBe(120n * UNIT);
    expect(state.owners.get(alice)?.pendingClaims).toBe(0n);
    expect(0n + state.outflows - state.deposits).toBe(20n * UNIT);
  });

  it("matches a deposit mint after an earlier same-transaction fee mint", () => {
    const state = createLedgerState();
    applyEventTransactions(state, [
      transfer(1, 0, hash(1), zeroAddress, alice, 10n * UNIT),
      transfer(1, 1, hash(1), zeroAddress, bob, 10n * UNIT),
      deposit(1, 2, hash(1), bob, 12n * UNIT, 10n * UNIT),
    ]);
    expect(state.owners.get(alice)?.basis).toBe(0n);
    expect(state.owners.get(bob)?.basis).toBe(12n * UNIT);
  });
});

function base(block: number, logIndex: number, transactionHash: Hash) {
  return {
    blockNumber: BigInt(block),
    transactionIndex: 0,
    logIndex,
    transactionHash,
    timestamp: block * 1_000,
  };
}

function transfer(
  block: number,
  logIndex: number,
  transactionHash: Hash,
  from: Address,
  to: Address,
  shares: bigint,
): VaultEvent {
  return { ...base(block, logIndex, transactionHash), type: "transfer", from, to, shares };
}

function deposit(
  block: number,
  logIndex: number,
  transactionHash: Hash,
  owner: Address,
  assets: bigint,
  shares: bigint,
): VaultEvent {
  return { ...base(block, logIndex, transactionHash), type: "deposit", owner, assets, shares };
}

function withdraw(
  block: number,
  logIndex: number,
  transactionHash: Hash,
  owner: Address,
  assets: bigint,
  shares: bigint,
): VaultEvent {
  return {
    ...base(block, logIndex, transactionHash),
    type: "withdraw",
    owner,
    receiver: owner,
    assets,
    shares,
  };
}

function request(
  block: number,
  logIndex: number,
  transactionHash: Hash,
  requestId: bigint,
  owner: Address,
  assets: bigint,
  shares: bigint,
): VaultEvent {
  return {
    ...base(block, logIndex, transactionHash),
    type: "withdrawalRequested",
    requestId,
    owner,
    receiver: owner,
    assets,
    shares,
  };
}

function processed(
  block: number,
  logIndex: number,
  transactionHash: Hash,
  requestId: bigint,
  assets: bigint,
): VaultEvent {
  return {
    ...base(block, logIndex, transactionHash),
    type: "withdrawalProcessed",
    requestId,
    receiver: alice,
    assets,
  };
}

function hash(value: number): Hash {
  return `0x${value.toString(16).padStart(64, "0")}`;
}
