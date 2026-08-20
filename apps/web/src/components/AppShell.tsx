import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { vaultAddress } from "../config";
import { short, useVaultDashboard } from "../hooks/useVaultDashboard";
import { Icon } from "./ui";

const navItems = [
  { to: "/", label: "Home", icon: "home" as const },
  { to: "/vault", label: "Vault", icon: "vault" as const },
  { to: "/swap", label: "Mint", icon: "swap" as const },
  { to: "/analytics", label: "Analytics", icon: "analytics" as const },
  { to: "/safety", label: "Safety", icon: "safety" as const },
];

export function AppShell() {
  const {
    address,
    isConnected,
    connectWallet,
    disconnectWallet,
    switchNetwork,
    chain,
    wrongNetwork,
    message,
  } = useVaultDashboard();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="app-shell">
      <div className="dream-orb orb-one" />
      <div className="dream-orb orb-two" />
      <header className="topbar">
        <NavLink className="brand" to="/" aria-label="Somnia Yield home">
          <span className="brand-mark">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <path d="M20 3 35 12v16L20 37 5 28V12L20 3Z" />
              <path d="m13 24 7-13 7 13-7 5-7-5Z" />
            </svg>
          </span>
          <span>
            <strong>SOMNIA YIELD</strong>
            <small>DREAMDEX VAULT</small>
          </span>
        </NavLink>

        <nav className={menuOpen ? "nav open" : "nav"} aria-label="Primary">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="wallet-area">
          <span className="network-chip">
            <span className="network-dot" />
            {chain.name}
          </span>
          {isConnected ? (
            <button className="wallet-button" onClick={() => disconnectWallet()}>
              <span className="wallet-identicon" />
              {short(address!)}
            </button>
          ) : (
            <button className="wallet-button connect" onClick={connectWallet}>
              Connect wallet
            </button>
          )}
          <button
            className="menu-button"
            aria-expanded={menuOpen}
            aria-label="Toggle navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span /><span /><span />
          </button>
        </div>
      </header>

      <div className="release-banner">
        <span>TESTNET</span>
        <p>Experimental capped release. Unaudited software; variable yield and principal at risk.</p>
      </div>

      {wrongNetwork && (
        <div className="network-warning">
          <span>Wrong network. Switch to {chain.name} to transact.</span>
          <button onClick={switchNetwork}>Switch network</button>
        </div>
      )}

      <main className="page"><Outlet /></main>

      <footer>
        <div className="footer-brand">
          <strong>SOMNIA YIELD</strong>
          <span>Non-custodial yield infrastructure for the Somnia ecosystem.</span>
        </div>
        <div className="footer-meta">
          <span>Vault {short(vaultAddress)}</span>
          <a
            href={`${chain.blockExplorers?.default.url}/address/${vaultAddress}`}
            target="_blank"
            rel="noreferrer"
          >
            Verify vault ↗
          </a>
          <span>Not audited · Not financial advice</span>
        </div>
      </footer>
      {message && <div className="toast" role="status">{message}</div>}
    </div>
  );
}
