import {
  capacity,
  format,
  formatInput,
  money,
  signedMoney,
  tone,
  useVaultDashboard,
} from "../hooks/useVaultDashboard";
import { Metric, PageIntro, Stat } from "../components/ui";

export function Vault() {
  const dashboard = useVaultDashboard();
  const {
    depositMode,
    setDepositMode,
    depositInput,
    setDepositInput,
    redeemInput,
    setRedeemInput,
    isConnected,
    wrongNetwork,
    busy,
    paused,
    requiredAssets,
    sharesReceived,
    maxDeposit,
    cap,
    requiresApproval,
    supportsAtomicBatch,
    shareBalance,
    positionAssets,
    period,
    ownerEarnings,
    connectedOwner,
    ownerPercent,
    redeemAssets,
    canInstantRedeem,
    queueHead,
    redeemRaw,
    totalAssets,
    sharePrice,
    queued,
  } = dashboard;

  return (
    <>
      <PageIntro eyebrow="THE VAULT" title="Enter the dream economy.">
        Deposit USDso to mint yvUSDso shares, or redeem your position through
        instant liquidity and the on-chain withdrawal queue.
      </PageIntro>

      <section className="compact-stats stats-grid">
        <Stat label="Total value locked" value={money(totalAssets)} />
        <Stat label="Share price" value={`$${sharePrice.toFixed(4)}`} />
        <Stat label="Queued withdrawals" value={money(queued)} />
      </section>

      <section className="transaction-grid">
        <div className="glass transaction-panel">
          <div className="tabs">
            <button className={depositMode === "deposit" ? "active" : ""} onClick={() => setDepositMode("deposit")}>
              Deposit
            </button>
            <button className={depositMode === "mint" ? "active" : ""} onClick={() => setDepositMode("mint")}>
              Mint shares
            </button>
          </div>
          <label htmlFor="deposit-amount">
            {depositMode === "deposit" ? "USDso amount" : "Vault shares"}
          </label>
          <div className="amount">
            <input
              id="deposit-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={depositInput}
              onChange={(event) => setDepositInput(event.target.value)}
            />
            <span>{depositMode === "deposit" ? "USDso" : "yvUSDso"}</span>
          </div>
          <div className="transaction-details">
            <Metric
              label={depositMode === "deposit" ? "Shares you receive" : "USDso required"}
              value={depositMode === "deposit" ? `${format(sharesReceived)} yvUSDso` : money(requiredAssets)}
            />
            <Metric label="Available capacity" value={capacity(maxDeposit, cap)} />
          </div>
          <button
            className="primary-button"
            disabled={!isConnected || wrongNetwork || busy || requiredAssets === 0n || paused}
            onClick={() => void dashboard.depositOrMint()}
          >
            {paused ? "Vault halted" : depositMode === "deposit" ? "Deposit USDso" : "Mint shares"}
          </button>
          {!isConnected && <p className="action-note">Connect a wallet to continue.</p>}
          {requiresApproval && requiredAssets > 0n && (
            <p className="action-note">
              {supportsAtomicBatch
                ? "Your wallet supports one-confirmation approval and deposit batching."
                : "The first deposit may require separate approval and deposit confirmations."}
            </p>
          )}
        </div>

        <div className="glass transaction-panel">
          <div className="panel-title">
            <div><small>YOUR POSITION</small><h2>Withdraw</h2></div>
            <span>{format(shareBalance)} shares</span>
          </div>
          <div className="position-summary">
            <Metric label="Current position" value={money(positionAssets)} />
            <Metric
              label={`Your ${period === "all" ? "total" : period} earnings`}
              value={ownerEarnings === undefined ? "Unavailable" : signedMoney(ownerEarnings)}
              tone={ownerEarnings === undefined ? "" : tone(ownerEarnings)}
            />
            <Metric label="Carried cost basis" value={connectedOwner ? money(BigInt(connectedOwner.costBasis)) : "$0.00"} />
            <Metric label="Pending claims" value={connectedOwner ? money(BigInt(connectedOwner.pendingClaims)) : "$0.00"} />
            <Metric label="Vault ownership" value={ownerPercent} />
          </div>
          <label htmlFor="redeem-amount">Shares to redeem</label>
          <div className="amount">
            <input
              id="redeem-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={redeemInput}
              onChange={(event) => setRedeemInput(event.target.value)}
            />
            <button className="max-button" onClick={() => setRedeemInput(formatInput(shareBalance))}>MAX</button>
          </div>
          <div className="transaction-details">
            <Metric label="You receive" value={money(redeemAssets)} />
            <Metric label="Route" value={canInstantRedeem ? "Instant redemption" : "FIFO withdrawal queue"} />
          </div>
          <button
            className="primary-button secondary"
            disabled={!isConnected || wrongNetwork || busy || redeemRaw === 0n || paused}
            onClick={() => void dashboard.redeemOrQueue()}
          >
            {paused ? "Vault halted" : canInstantRedeem ? "Redeem now" : "Request withdrawal"}
          </button>
          <p className="action-note">
            Queue head #{queueHead.toString()}. Queued claims receive priority over instant exits.
          </p>
        </div>
      </section>
    </>
  );
}
