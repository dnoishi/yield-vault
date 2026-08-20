import { maxUint256 } from "viem";
import {
  money,
  short,
  strategyLabel,
  useVaultDashboard,
} from "../hooks/useVaultDashboard";
import { Icon, Metric, PageIntro, SectionHeading } from "../components/ui";

const ZERO_HASH = `0x${"0".repeat(64)}`;

export function Safety() {
  const { cap, haltReason, paused, strategyState, riskHandler } =
    useVaultDashboard();

  return (
    <>
      <PageIntro eyebrow="SAFETY BY DESIGN" title="Guardrails before growth.">
        Transparent smart-contract constraints reduce operator trust, but they
        do not eliminate market, contract, liquidity, or infrastructure risk.
      </PageIntro>

      <section className="safety-lead glass">
        <span className="safety-shield"><Icon name="safety" size={38} /></span>
        <div>
          <small>CURRENT VAULT STATE</small>
          <h2>{paused ? "Emergency halt active" : strategyLabel(strategyState)}</h2>
          <p>
            The vault exposes its cap, pause state, liabilities, and halt reason
            on-chain. Verify all material state independently before depositing.
          </p>
        </div>
        <div className="safety-metrics">
          <Metric label="Deposit cap" value={cap === maxUint256 ? "Uncapped" : money(cap)} />
          <Metric label="Operator withdrawal access" value="None" />
          <Metric
            label="RiskHandler"
            value={
              paused
                ? "Vault halted"
                : riskHandler.subscriptionId > 0n
                  ? "Active"
                  : "Not subscribed"
            }
          />
          <Metric label="Last halt reason" value={haltReason === ZERO_HASH ? "No halt recorded" : short(haltReason)} />
        </div>
      </section>

      <SectionHeading eyebrow="PROTECTION LAYERS" title="Designed for constrained operation." />
      <section className="safety-grid">
        <div className="glass safety-card">
          <span className="step">01</span>
          <Icon name="vault" size={25} />
          <h3>Non-custodial vault</h3>
          <p>Vault assets remain governed by contract logic. The operator has no withdrawal path to depositor capital.</p>
        </div>
        <div className="glass safety-card">
          <span className="step">02</span>
          <Icon name="safety" size={25} />
          <h3>Emergency controls</h3>
          <p>A guardian can halt operation immediately but cannot move user funds. Admin changes are intended for a timelock.</p>
        </div>
        <div className="glass safety-card">
          <span className="step">03</span>
          <Icon name="analytics" size={25} />
          <h3>Reactive capability</h3>
          <p>
            EpochTick protection is{" "}
            {riskHandler.subscriptionId > 0n ? "active" : "not subscribed"}.
            Current thresholds are {riskHandler.maxSpreadBps} bps spread and{" "}
            {riskHandler.maxMoveBps} bps price movement.
          </p>
        </div>
        <div className="glass safety-card">
          <span className="step">04</span>
          <Icon name="arrow" size={25} />
          <h3>Fair withdrawal queue</h3>
          <p>When idle USDso is unavailable, shares burn at the current NAV and enter a FIFO queue. Claims pay out as liquidity frees and take priority over later instant exits.</p>
        </div>
      </section>

      <section className="risk-disclosure">
        <SectionHeading eyebrow="IMPORTANT" title="Know the risks." />
        <div className="risk-list">
          <div><strong>Smart-contract risk</strong><p>This experimental software has not been audited. Bugs may cause partial or total loss.</p></div>
          <div><strong>Market & liquidity risk</strong><p>Maker strategies can lose value, and queued redemptions wait until liquidity frees — they are not failed transactions.</p></div>
          <div><strong>Infrastructure risk</strong><p>DreamDEX, Somnia testnet, RPC, indexer, or operator outages may interrupt quoting and data availability.</p></div>
          <div><strong>No guaranteed return</strong><p>Yield is variable. Scores and historical earnings are not forecasts or guaranteed APY.</p></div>
        </div>
        <p className="disclaimer">
          TESTNET / CAPPED RELEASE · Experimental, unaudited software. Principal
          is at risk. Nothing shown is financial advice.
        </p>
      </section>
    </>
  );
}
