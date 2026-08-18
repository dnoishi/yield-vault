import { dreamDexSymbol } from "../config";
import {
  format,
  money,
  percentage,
  short,
  signedMoney,
  signedPercent,
  tone,
  useVaultDashboard,
} from "../hooks/useVaultDashboard";
import {
  Metric,
  PageIntro,
  PeriodTabs,
  SectionHeading,
  Stat,
} from "../components/ui";

export function Analytics() {
  const {
    analytics,
    analyticsError,
    metrics,
    marketData,
    period,
    totalSupply,
    strategyEarnings,
    address,
  } = useVaultDashboard();

  return (
    <>
      <PageIntro
        eyebrow="STRATEGY INTELLIGENCE"
        title="See every signal in the constellation."
        action={<PeriodTabs />}
      >
        Indexed owner accounting, DreamDEX market activity, and operator metrics
        refresh continuously without obscuring the on-chain source of truth.
      </PageIntro>

      <section className="compact-stats stats-grid">
        <Stat
          label={`${period === "all" ? "Total" : period} strategy earnings`}
          value={strategyEarnings === undefined ? "Unavailable" : signedMoney(strategyEarnings)}
          tone={strategyEarnings === undefined ? "" : tone(strategyEarnings)}
        />
        <Stat label="Open strategy orders" value={analytics?.strategy?.openOrders.toString() ?? "—"} />
        <Stat label="Estimated yield score" value={(metrics?.estimatedYieldScore ?? 0).toFixed(2)} />
      </section>

      <section className="analytics-grid">
        <div className="glass data-panel">
          <SectionHeading eyebrow="DREAMDEX" title="Market telemetry" />
          <Metric label="Operator state" value={metrics?.status ?? "Unavailable"} />
          <Metric label="Score / second" value={(metrics?.scoreRate ?? 0).toFixed(4)} />
          <Metric
            label={`${dreamDexSymbol} mid`}
            value={marketData?.mid?.toFixed(4) ?? metrics?.lastMid?.toFixed(4) ?? "—"}
          />
          <Metric
            label="24h close / change"
            value={marketData ? `${marketData.close24h.toFixed(4)} · ${signedPercent(marketData.change24hPercent)}` : "—"}
          />
          <Metric
            label="Indexed quote volume"
            value={marketData ? `$${marketData.quoteVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
          />
          <p className="panel-note">
            Score is proximity-weighted resting interest, not guaranteed APY.
            Market data is from DreamDEX; dollar NAV comes from the vault.
          </p>
        </div>

        <div className="glass data-panel">
          <SectionHeading eyebrow="LATEST ACTIVITY" title="Recent DreamDEX fills" />
          {marketData?.trades.length ? (
            <div className="trades">
              {marketData.trades.slice(0, 6).map((trade) => (
                <div key={trade.id}>
                  <span className={trade.side.toLowerCase()}>{trade.side}</span>
                  <strong>{Number(trade.price).toFixed(4)}</strong>
                  <span>{Number(trade.amount).toFixed(4)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">No recent indexed fills.</p>
          )}
        </div>
      </section>

      <section className="owners-section glass">
        <SectionHeading
          eyebrow="ATTRIBUTION"
          title="Owner accounting"
          aside={<span className="index-count">{analytics?.owners.length ?? 0} INDEXED OWNERS</span>}
        />
        {analyticsError ? (
          <p className="empty-state error">Owner accounting is unavailable while the operator indexer is offline.</p>
        ) : !analytics ? (
          <p className="empty-state">Loading indexed owner accounting…</p>
        ) : analytics.owners.length === 0 ? (
          <p className="empty-state">No indexed vault owners.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Owner</th><th>Shares</th><th>Ownership</th><th>USDso claim</th>
                <th>Cost basis</th><th>Realized</th><th>Unrealized</th>
                <th>{period === "all" ? "Total" : period} earnings</th><th>Pending claim</th>
              </tr></thead>
              <tbody>
                {analytics.owners.map((owner) => {
                  const shares = BigInt(owner.shares);
                  const periodValue = owner.periodEarnings === null ? undefined : BigInt(owner.periodEarnings);
                  const realized = BigInt(owner.realizedEarnings);
                  const unrealized = BigInt(owner.unrealizedEarnings);
                  const isCurrent = address?.toLowerCase() === owner.address.toLowerCase();
                  return (
                    <tr key={owner.address} className={isCurrent ? "current-owner" : ""}>
                      <td>{short(owner.address)}{isCurrent && <span className="you">YOU</span>}</td>
                      <td>{format(shares)}</td>
                      <td>{percentage(shares, totalSupply)}</td>
                      <td>{money(BigInt(owner.claim))}</td>
                      <td>{money(BigInt(owner.costBasis))}</td>
                      <td className={tone(realized)}>{signedMoney(realized)}</td>
                      <td className={tone(unrealized)}>{signedMoney(unrealized)}</td>
                      <td className={periodValue === undefined ? "" : tone(periodValue)}>
                        {periodValue === undefined ? "Not enough history" : signedMoney(periodValue)}
                      </td>
                      <td>{money(BigInt(owner.pendingClaims))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="panel-note">
          Earnings use indexed deposits, exits, queued claims, fee mints, and
          carried share cost basis. Off-chain sale consideration is not observable.
        </p>
      </section>
    </>
  );
}
