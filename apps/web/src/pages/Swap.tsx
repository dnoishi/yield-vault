import { formatUnits } from "viem";
import { Metric, PageIntro, Stat } from "../components/ui";
import { useDreamDexSwap } from "../hooks/useDreamDexSwap";

export function Swap() {
  const swap = useDreamDexSwap();
  const bestBid = swap.book?.bids[0]?.price;
  const fullyQuoted =
    Number(swap.amount) > 0 &&
    swap.estimatedUsdso.filled >= Number(swap.amount);

  return (
    <>
      <PageIntro eyebrow="DREAMDEX TESTNET" title="Turn STT into USDso.">
        Sell native Shannon STT into the live DreamDEX SOMI:USDso order
        book. DreamDEX calls the testnet native token SOMI; no wrapping or
        vault deposit is required.
      </PageIntro>

      <section className="compact-stats stats-grid">
        <Stat
          label="Your STT"
          value={`${formatToken(swap.nativeBalance)} STT`}
        />
        <Stat
          label="Your USDso"
          value={`${formatToken(swap.usdsoBalance)} USDso`}
        />
        <Stat
          label="Best bid"
          value={bestBid ? `${bestBid} USDso` : "No liquidity"}
        />
      </section>

      <section className="transaction-grid">
        <div className="glass transaction-panel">
          <div className="panel-title">
            <div>
              <small>MARKET SELL</small>
              <h2>Sell STT</h2>
            </div>
            <span>SOMI:USDso</span>
          </div>

          <label htmlFor="swap-amount">STT amount</label>
          <div className="amount">
            <input
              id="swap-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={swap.amount}
              onChange={(event) => swap.setAmount(event.target.value)}
            />
            <button className="max-button" onClick={swap.setMax}>
              MAX
            </button>
            <span>STT</span>
          </div>

          <div className="transaction-details">
            <Metric
              label="Estimated output"
              value={`${formatNumber(swap.estimatedUsdso.output)} USDso`}
            />
            <Metric
              label="Quoted amount"
              value={`${formatNumber(swap.estimatedUsdso.filled)} STT`}
              tone={
                Number(swap.amount) > 0 && !fullyQuoted ? "negative" : ""
              }
            />
            <Metric
              label="Execution"
              value="Market · Immediate or cancel"
            />
          </div>

          <button
            className="primary-button"
            disabled={
              !swap.isConnected ||
              swap.wrongNetwork ||
              swap.busy ||
              !swap.amountIsValid ||
              Boolean(swap.marketError) ||
              !swap.book?.bids.length
            }
            onClick={() => void swap.sellStt()}
          >
            {swap.busy ? "Swapping…" : "Sell STT for USDso"}
          </button>

          {!swap.isConnected && (
            <p className="action-note">Connect a wallet to continue.</p>
          )}
          {swap.wrongNetwork && (
            <p className="action-note">Switch to Somnia Shannon to swap.</p>
          )}
          {swap.market && !swap.amountIsValid && swap.amount && (
            <p className="action-note">
              Minimum {swap.market.minQuantity} STT in{" "}
              {swap.market.lotSize} STT increments.
            </p>
          )}
          {swap.status && (
            <p className="action-note swap-status" role="status">
              {swap.status}
            </p>
          )}
          {swap.marketError && (
            <p className="action-note negative" role="alert">
              {swap.marketError}
            </p>
          )}
        </div>

        <div className="glass transaction-panel">
          <div className="panel-title">
            <div>
              <small>LIVE LIQUIDITY</small>
              <h2>DreamDEX bids</h2>
            </div>
            <span>{swap.loadingMarket ? "Loading…" : "8s refresh"}</span>
          </div>

          {swap.book?.bids.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Price (USDso)</th>
                    <th>Size (STT)</th>
                    <th>Total (USDso)</th>
                  </tr>
                </thead>
                <tbody>
                  {swap.book.bids.slice(0, 8).map((bid, index) => (
                    <tr key={`${bid.price}-${index}`}>
                      <td className="positive">{bid.price}</td>
                      <td>{bid.quantity}</td>
                      <td>
                        {formatNumber(Number(bid.price) * Number(bid.quantity))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              {swap.loadingMarket
                ? "Loading the order book…"
                : "No bids are currently available."}
            </div>
          )}

          <div className="transaction-details">
            <Metric
              label="Minimum order"
              value={
                swap.market ? `${swap.market.minQuantity} STT` : "—"
              }
            />
            <Metric
              label="Lot size"
              value={swap.market ? `${swap.market.lotSize} STT` : "—"}
            />
          </div>
          <p className="panel-note">
            Keep some STT for gas. Need test tokens?{" "}
            <a
              className="inline-link"
              href="https://testnet.somnia.network/"
              target="_blank"
              rel="noreferrer"
            >
              Open the Somnia faucet ↗
            </a>
          </p>
        </div>
      </section>
    </>
  );
}

function formatToken(value: bigint): string {
  return Number(formatUnits(value, 18)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

function formatNumber(value: number): string {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 6 })
    : "0";
}
