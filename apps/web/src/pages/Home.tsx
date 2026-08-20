import { Link } from "react-router-dom";
import {
  money,
  signedMoney,
  tone,
  useVaultDashboard,
} from "../hooks/useVaultDashboard";
import {
  Icon,
  PageIntro,
  Stat,
  StrategyStatus,
  SectionHeading,
  Metric,
} from "../components/ui";

export function Home() {
  const {
    totalAssets,
    sharePrice,
    strategyEarnings,
    analytics,
    idle,
    queued,
    metrics,
    marketData,
    riskHandler,
  } = useVaultDashboard();
  const deployed = totalAssets > idle ? totalAssets - idle : 0n;

  return (
    <>
      <PageIntro
        eyebrow="NON-CUSTODIAL MARKET-MAKING VAULT"
        title="Yield, shaped by the speed of dreams."
        action={<StrategyStatus />}
      >
        Put idle stablecoins to work at the top of the DreamDEX order book,
        with transparent accounting and on-chain controls on Somnia.
      </PageIntro>

      <section className="home-stats stats-grid">
        <Stat label="Total value locked" value={money(totalAssets)} icon={<span className="stat-glyph">◇</span>} />
        <Stat label="Share price" value={`$${sharePrice.toFixed(4)}`} icon={<span className="stat-glyph coral">◈</span>} />
        <Stat
          label="Strategy P&L including losses"
          value={
            strategyEarnings === undefined
              ? analytics?.available === false ? "Not enough history" : "Unavailable"
              : signedMoney(strategyEarnings)
          }
          tone={strategyEarnings === undefined ? "" : tone(strategyEarnings)}
          icon={<span className="stat-glyph cyan">↗</span>}
        />
      </section>

      <section className="feature-grid">
        <div className="feature-copy">
          <p className="eyebrow"><span />THE VAULT</p>
          <h2>Capital that stays<br />under your control.</h2>
          <p>
            Deposit USDso and receive composable vault shares. Exit instantly
            when idle USDso is available, or enter a FIFO queue that pays out
            as liquidity frees.
          </p>
          <Link className="text-link" to="/vault">Enter the vault <Icon name="arrow" /></Link>
          <Link className="text-link secondary-link" to="/swap">
            Need USDso? Mint 100 on testnet <Icon name="arrow" />
          </Link>
        </div>
        <div className="glass visual-card vault-visual">
          <div className="visual-halo" />
          <div className="floating-card">
            <small>AVAILABLE IDLE</small>
            <strong>{money(idle)}</strong>
            <span>Ready for instant redemptions</span>
          </div>
          <div className="floating-card offset">
            <small>QUEUED LIABILITIES</small>
            <strong>{money(queued)}</strong>
            <span>Queued — processing as liquidity frees</span>
          </div>
          <div className="capital-split">
            <Metric label="Idle capital" value={money(idle)} />
            <Metric label="Deployed capital" value={money(deployed)} />
          </div>
        </div>
      </section>

      <section className="journey-section">
        <SectionHeading
          eyebrow="HOW IT WORKS"
          title="From stablecoins to transparent market-making."
        />
        <div className="journey-grid">
          <article className="glass journey-card">
            <span>01</span>
            <h3>Deposit USDso</h3>
            <p>Connect on Somnia and receive yvUSDso shares representing your portion of the vault.</p>
          </article>
          <article className="glass journey-card">
            <span>02</span>
            <h3>Capital is deployed</h3>
            <p>The keeper preserves an idle buffer while scoped orders quote on the DreamDEX book.</p>
          </article>
          <article className="glass journey-card">
            <span>03</span>
            <h3>Track and redeem</h3>
            <p>Follow live NAV and earnings, then exit instantly or wait in the FIFO queue while liquidity frees.</p>
          </article>
        </div>
      </section>

      <section className="overview-section">
        <SectionHeading eyebrow="LIVE SIGNALS" title="A transparent strategy, not a black box." />
        <div className="overview-grid">
          <div className="glass overview-panel">
            <span className="panel-icon violet"><Icon name="spark" /></span>
            <h3>Proximity yield</h3>
            <p>Resting maker interest earns a proximity-weighted score. It is not a guaranteed APY.</p>
            <Metric label="Estimated score" value={(metrics?.estimatedYieldScore ?? 0).toFixed(2)} />
            <Metric label="Score / second" value={(metrics?.scoreRate ?? 0).toFixed(4)} />
          </div>
          <div className="glass overview-panel">
            <span className="panel-icon cyan"><Icon name="analytics" /></span>
            <h3>DreamDEX market</h3>
            <p>Live venue data is separated from the vault’s on-chain dollar NAV.</p>
            <Metric label="Market mid" value={marketData?.mid?.toFixed(4) ?? metrics?.lastMid?.toFixed(4) ?? "—"} />
            <Metric label="Open orders" value={analytics?.strategy?.openOrders.toString() ?? "—"} />
            <Metric
              label="Risk handler"
              value={
                !riskHandler.configured
                  ? "Not configured"
                  : riskHandler.subscriptionId > 0n
                    ? "Active"
                    : "Not subscribed"
              }
            />
          </div>
          <div className="glass overview-panel">
            <span className="panel-icon coral"><Icon name="safety" /></span>
            <h3>Bounded permissions</h3>
            <p>The operator can quote within defined controls, but cannot withdraw depositor capital.</p>
            <Link className="text-link" to="/safety">Explore safeguards <Icon name="arrow" /></Link>
          </div>
        </div>
      </section>
    </>
  );
}
