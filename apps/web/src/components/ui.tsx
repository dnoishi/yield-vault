import type { ReactNode } from "react";
import { useVaultDashboard, strategyLabel } from "../hooks/useVaultDashboard";

export function Icon({
  name,
  size = 18,
}: {
  name: "home" | "vault" | "swap" | "analytics" | "safety" | "arrow" | "spark";
  size?: number;
}) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
    vault: <><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M7 5V3h10v2M8 12h8M12 9v6" /></>,
    swap: <><path d="M4 8h13" /><path d="m14 5 3 3-3 3" /><path d="M20 16H7" /><path d="m10 13-3 3 3 3" /></>,
    analytics: <><path d="M4 19V9m6 10V4m6 15v-7m4 7H2" /></>,
    safety: <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 7.8 7.5 9.5 4.3-1.7 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-5" /></>,
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
    spark: <><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" /><path d="m19 17 .6 2.4L22 20l-2.4.6L19 23l-.6-2.4L16 20l2.4-.6L19 17Z" /></>,
  };
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      {paths[name]}
    </svg>
  );
}

export function PageIntro({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="page-intro">
      <div>
        <p className="eyebrow"><span />{eyebrow}</p>
        <h1>{title}</h1>
        <p className="lede">{children}</p>
      </div>
      {action}
    </section>
  );
}

export function StrategyStatus() {
  const { strategyState, analytics, paused, metrics } = useVaultDashboard();
  const watchdog = metrics?.watchdog;
  const label =
    watchdog?.checks.withdrawals === "stalled"
      ? "Queue stalled"
      : watchdog?.checks.operator === "offline"
        ? "Operator offline"
        : watchdog?.checks.riskHandler === "not_subscribed"
          ? "Risk unsubscribed"
          : strategyLabel(strategyState);
  const detail =
    watchdog?.reasons[0] ??
    analytics?.strategy?.reason ??
    (paused ? "Emergency halt is active" : "Operator data unavailable");
  const stateClass =
    watchdog?.level === "unhealthy" ? "offline" : strategyState;
  return (
    <div className={`strategy-pill ${stateClass}`}>
      <span className="pulse" />
      <div>
        <small>STRATEGY</small>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  tone: valueTone = "",
  icon,
}: {
  label: string;
  value: string;
  tone?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="stat-card glass">
      <div className="stat-label">{icon}<span>{label}</span></div>
      <strong className={valueTone}>{value}</strong>
    </div>
  );
}

export function Metric({
  label,
  value,
  tone: valueTone = "",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={valueTone}>{value}</strong>
    </div>
  );
}

export function PeriodTabs() {
  const { period, setPeriod } = useVaultDashboard();
  return (
    <div className="period-tabs" aria-label="Analytics period">
      {(["all", "24h", "7d", "30d"] as const).map((value) => (
        <button
          key={value}
          className={period === value ? "active" : ""}
          onClick={() => setPeriod(value)}
          type="button"
        >
          {value === "all" ? "All time" : value}
        </button>
      ))}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  aside,
}: {
  eyebrow?: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <small>{eyebrow}</small>}
        <h2>{title}</h2>
      </div>
      {aside}
    </div>
  );
}
