# CLOB Yield Vault

A non-upgradeable ERC-4626 vault for pooling USDso and deploying it to a
DreamDEX spot order book. A scoped off-chain operator runs a proximity-yield
market-making strategy; it can place and cancel orders but cannot withdraw
vault assets.

## Packages

- `src/` — vault and Somnia reactive risk-handler contracts
- `operator/` — self-contained DreamDEX client and yield optimizer
- `apps/web/` — depositor and transparency interface
- `script/` — parameterized Foundry deployment and setup scripts

The sibling `dreamdex-bot-kit` repository is reference-only. This project does
not import from or modify it.

## Local setup

```sh
npm install
forge build
forge test
npm run typecheck
npm run build
```

Copy `.env.example` to `.env` before running deployment scripts or the operator.
Defaults target WETH:USDso on Shannon testnet. Mainnet deployments are capped
and gated until legal review and an external contract audit are complete.

See `docs/architecture.md` and `docs/operator-runbook.md`.

## Full local stack

Foundry must be installed under `~/.foundry/bin`.

```sh
npm run local:up
```

This starts Anvil, deploys and seeds a mock DreamDEX market, configures the
scoped operator, starts the live strategy, and serves:

- Depositor UI: http://127.0.0.1:5173
- Operator metrics: http://127.0.0.1:8787/metrics
- Anvil RPC: http://127.0.0.1:8545 (chain ID `31337`)

The command prints the deployed addresses and the public first Anvil key to
import into a browser wallet. Never use an Anvil key on a public network.

```sh
npm run test:local
npm run local:down
```

`test:local` creates and tears down its own isolated stack. Use `local:down`
after an interactive `local:up` session.

Generated addresses are written to `deployments/local.json`; generated local
environment files and process logs are gitignored.

## Shannon read-only checks

```sh
npm run test:shannon
```

This forks Shannon ephemerally, verifies the real WETH:USDso pool and operator
registry, deploys the contracts only inside the fork, and checks RPC/WebSocket
market data. It uses no private key and broadcasts no transactions.
