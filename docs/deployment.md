# Deployment

## Local development

```sh
npm run local:up
npm run test:local
```

`local:up` launches a deterministic Anvil chain, deploys a mock WETH:USDso
market plus the complete vault stack, seeds 10,000 USDso and one WETH of
inventory, authorizes the second Anvil account as the scoped operator, and
starts the operator and web app. Addresses are stored in
`deployments/local.json`.

`test:local` is isolated: it starts a clean chain, runs contract and live
operator integration tests, then stops all processes automatically.

To connect a browser wallet:

- RPC: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency: `ETH`
- Import the first Anvil account printed by `npm run local:up`

Stop all three processes with `npm run local:down`. Restarting creates a clean
chain and rewrites the generated local environment files.

## Shannon validation without transactions

```sh
npm run test:shannon
```

This is deliberately read-only. The Foundry test creates an ephemeral fork and
validates contract deployment and DreamDEX permissions there; the operator
doctor checks chain ID 50312, the WETH/USDso token metadata, top of book,
operator-registry bytecode, and WebSocket freshness. No key is loaded and
nothing is broadcast.

## Shannon broadcast deployment

```sh
# Deploy. Shannon defaults to WETH:USDso; mainnet defaults to USDC.e:USDso.
forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast \
  --gas-estimate-multiplier 2000

# Schedule market setup through the timelock.
forge script script/SetupMarket.s.sol:SetupMarket --rpc-url "$RPC_URL" --broadcast \
  --gas-estimate-multiplier 2000

# After TIMELOCK_DELAY, rerun with EXECUTE_TIMELOCK=true.
EXECUTE_TIMELOCK=true forge script script/SetupMarket.s.sol:SetupMarket \
  --rpc-url "$RPC_URL" --broadcast --gas-estimate-multiplier 2000
```

Somnia charges substantially more than Ethereum for contract bytecode
deployment. Keep the gas multiplier on Shannon; the default Foundry estimate can
run out of gas even when simulation succeeds.

Fund the risk handler with at least 32 SOMI/STT, then schedule and execute
`SubscribeRisk.s.sol` in the same two-step manner. Verify every address against
the current DreamDEX market API and pool `getPoolParams()` before broadcasting.
Confirm `subscriptionId != 0` through `/metrics` or the web Safety page.

After collecting representative `marketSpreadBps` and `marketMoveBps`
telemetry, schedule and execute `ConfigureRisk.s.sol` to change thresholds.

Mainnet defaults use a two-day delay. Keep deposits allowlisted and capped until
legal review and an external audit are complete.

## Shannon, Railway, and Vercel

Use separate deployer and operator wallets. The deployer creates and administers
the stack through the timelock. The operator hot wallet receives only
`placeOrderFor` and `cancelOrderFor` permissions and should hold only enough STT
for gas.

Copy `.env.example` to `.env` and set at least:

```sh
NETWORK=testnet
RPC_URL=https://api.infra.testnet.somnia.network/
PRIVATE_KEY=0x<deployer-private-key>
OPERATOR_ADDRESS=0x<operator-address>
```

Validate Shannon, then deploy:

```sh
npm run test:shannon
forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast \
  --gas-estimate-multiplier 2000
```

The script writes the deployed addresses and deploy block to
`deployments/shannon.json`. Add `VAULT_ADDRESS` and `TIMELOCK_ADDRESS` from that
file to `.env`, then schedule and execute market setup:

```sh
forge script script/SetupMarket.s.sol:SetupMarket --rpc-url "$RPC_URL" --broadcast \
  --gas-estimate-multiplier 2000
EXECUTE_TIMELOCK=true forge script script/SetupMarket.s.sol:SetupMarket \
  --rpc-url "$RPC_URL" --broadcast --gas-estimate-multiplier 2000
```

To enable the circuit breaker, fund the risk handler with at least 32 STT, set
`RISK_HANDLER_ADDRESS`, and schedule and execute `SubscribeRisk.s.sol` in the
same way.

Copy `operator/.env.shannon.example` to `operator/.env.local`. Set its
`PRIVATE_KEY` to the operator hot key and start with `DRY_RUN=true`. The deploy
command reads the vault, pool, registry, and deploy block from
`deployments/shannon.json`, so those generated values take precedence over the
local file.

Set `KEEPER_PRIVATE_KEY` only when a separate EOA has `KEEPER_ROLE`. If omitted,
withdrawals require manual queue processing and the watchdog reports that
dependency whenever liabilities exist.

```sh
npm run dev:operator
```

Check `http://127.0.0.1:8787/health`, `/metrics`, and `/analytics` before setting
`DRY_RUN=false`.

Install and authenticate the deployment CLIs once:

```sh
npm install --global vercel @railway/cli
railway login
vercel login
```

Then deploy the operator to Railway and the website to Vercel:

```sh
npm run deploy
```

The command creates or links the `yield-vault-operator` Railway project and its
`operator` service, provisions a `/data` volume for analytics, sets the Shannon
operator variables, and deploys the Docker image. It then creates or links the
`yield-vault` Vercel project, sets its production `VITE_*` variables to the
Shannon deployment and Railway HTTPS endpoints, and publishes the production
site.

Set `RAILWAY_PROJECT_NAME`, `RAILWAY_SERVICE_NAME`, or `VERCEL_PROJECT_NAME`
before running the command to use different names. Set `OPERATOR_ENV` to use an
operator environment file other than `operator/.env.local`.

Never add a private key to Vercel. The deploy script sends the operator hot key
only to Railway and never reads the deployer key from the root `.env`.
