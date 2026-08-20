import {
  QUEUE_STATUS_TITLE,
  capacity,
  format,
  formatInput,
  money,
  signedMoney,
  tone,
  useVaultDashboard,
} from "../hooks/useVaultDashboard";
import { Link } from "react-router-dom";
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
    ownerRealized,
    ownerUnrealized,
    connectedOwner,
    ownerPercent,
    redeemAssets,
    canInstantRedeem,
    queueHead,
    queueLength,
    pendingWithdrawals,
    pendingClaimAssets,
    hasPendingWithdrawals,
    redeemRaw,
    totalAssets,
    sharePrice,
    queued,
    idle,
    assetBalance,
  } = dashboard;
  const nextClaim = pendingWithdrawals[0];
  const queueRoute = canInstantRedeem ? "Instant redemption" : QUEUE_STATUS_TITLE;

  return (
    <>
      <PageIntro eyebrow="THE VAULT" title="Enter the dream economy.">
        Deposit USDso to mint yvUSDso shares. Redeem instantly from idle USDso,
        or queue a withdrawal that pays out as liquidity frees.
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
          <p className="risk-note">
            Share price can go down. This is a market-making vault, not a
            savings account. Yield is variable and principal is at risk.
          </p>
          {!isConnected && <p className="action-note">Connect a wallet to continue.</p>}
          {isConnected && assetBalance === 0n && (
            <p className="action-note">
              Need funds? <Link className="inline-link" to="/swap">Mint testnet USDso</Link>.
            </p>
          )}
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
            <Metric
              label="Realized P&L"
              value={signedMoney(ownerRealized)}
              tone={tone(ownerRealized)}
            />
            <Metric
              label="Unrealized P&L"
              value={signedMoney(ownerUnrealized)}
              tone={tone(ownerUnrealized)}
            />
            <Metric label="Carried cost basis" value={connectedOwner ? money(BigInt(connectedOwner.costBasis)) : "$0.00"} />
            <Metric label="Pending claims" value={money(pendingClaimAssets)} />
            <Metric label="Vault ownership" value={ownerPercent} />
          </div>
          {hasPendingWithdrawals && (
            <div className="queue-status" role="status">
              <small>YOUR WITHDRAWAL</small>
              <strong>{QUEUE_STATUS_TITLE}</strong>
              <p>
                Your shares were already burned at the request NAV. USDso pays
                out when idle vault balance covers your place in the FIFO
                queue. Resting DreamDEX orders count toward NAV but not toward
                this payout until they fill or are cancelled.
              </p>
              <div className="queue-status-metrics">
                <Metric label="Your queued claim" value={money(pendingClaimAssets)} />
                <Metric
                  label="Queue position"
                  value={
                    nextClaim
                      ? `${nextClaim.queuePosition} of ${Math.max(queueLength, nextClaim.queuePosition)}`
                      : queueLength > 0
                        ? `In queue of ${queueLength}`
                        : "Waiting"
                  }
                />
                <Metric label="Idle available" value={money(idle)} />
                <Metric label="Vault queued" value={money(queued)} />
              </div>
            </div>
          )}
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
            <Metric label="Route" value={queueRoute} />
          </div>
          <button
            className="primary-button secondary"
            disabled={!isConnected || wrongNetwork || busy || redeemRaw === 0n || paused}
            onClick={() => void dashboard.redeemOrQueue()}
          >
            {paused ? "Vault halted" : canInstantRedeem ? "Redeem now" : "Request withdrawal"}
          </button>
          <p className="action-note">
            {canInstantRedeem
              ? `Paid from idle USDso in the vault. Queue head #${queueHead.toString()}.`
              : `Shares burn now at the current NAV. Funds pay out as idle liquidity frees. Resting orders stay in NAV until they fill or cancel. Queue head #${queueHead.toString()}.`}
          </p>
        </div>
      </section>
    </>
  );
}
