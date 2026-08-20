import { formatUnits } from "viem";
import { PageIntro, Stat } from "../components/ui";
import { useMintUsdso } from "../hooks/useMintUsdso";

export function Swap() {
  const faucet = useMintUsdso();

  return (
    <>
      <PageIntro eyebrow="SHANNON TESTNET" title="Mint testnet USDso.">
        Add 100 USDso to your connected wallet for testing deposits in the
        Somnia Yield vault.
      </PageIntro>

      <section className="compact-stats stats-grid">
        <Stat
          label="Your STT"
          value={`${formatToken(faucet.nativeBalance)} STT`}
        />
        <Stat
          label="Your USDso"
          value={`${formatToken(faucet.usdsoBalance)} USDso`}
        />
      </section>

      <section className="transaction-grid">
        <div className="glass transaction-panel">
          <div className="panel-title">
            <div>
              <small>TESTNET FAUCET</small>
              <h2>Get USDso</h2>
            </div>
            <span>100 USDso</span>
          </div>

          <p className="panel-note">
            Mint a fixed testnet allocation directly to your connected wallet.
            You only need a small amount of STT to pay for gas.
          </p>

          <button
            className="primary-button"
            disabled={
              !faucet.isConnected || faucet.wrongNetwork || faucet.busy
            }
            onClick={() => void faucet.mint()}
          >
            {faucet.busy ? "Minting…" : "Mint 100 USDso"}
          </button>

          {!faucet.isConnected && (
            <p className="action-note">Connect a wallet to continue.</p>
          )}
          {faucet.wrongNetwork && (
            <p className="action-note">
              Switch to Somnia Shannon to mint.
            </p>
          )}
          {faucet.status && (
            <p className="action-note swap-status" role="status">
              {faucet.status}
            </p>
          )}

          <p className="panel-note">
            Need STT for gas?{" "}
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
