#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANVIL="$HOME/.foundry/bin/anvil"
FORGE="$HOME/.foundry/bin/forge"
RPC_URL="http://127.0.0.1:8545"
ADMIN_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
OPERATOR_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"

cd "$ROOT"

if [[ -f .local-anvil.pid ]] && kill -0 "$(tr -d '[:space:]' < .local-anvil.pid)" 2>/dev/null; then
  echo "Local Anvil is already running."
  exit 0
fi

nohup "$ANVIL" --chain-id 31337 --host 127.0.0.1 --port 8545 \
  > .local-anvil.log 2>&1 &
echo "$!" > .local-anvil.pid

for _ in {1..30}; do
  if "$HOME/.foundry/bin/cast" block-number --rpc-url "$RPC_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
"$HOME/.foundry/bin/cast" block-number --rpc-url "$RPC_URL" >/dev/null
DEPLOY_BLOCK="$("$HOME/.foundry/bin/cast" block-number --rpc-url "$RPC_URL")"

"$FORGE" script script/DeployLocal.s.sol:DeployLocal \
  --rpc-url "$RPC_URL" --broadcast

VAULT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("deployments/local.json")).vault)')"
POOL="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("deployments/local.json")).pool)')"
REGISTRY="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("deployments/local.json")).operatorRegistry)')"
rm -f operator/data/local-analytics.sqlite*

cat > operator/.env.local <<EOF
NETWORK=local
RPC_URL=$RPC_URL
WS_URL=
PRIVATE_KEY=$OPERATOR_KEY
OWNER_ADDRESS=$VAULT
POOL_ADDRESS=$POOL
OPERATOR_REGISTRY=$REGISTRY
BASE_DECIMALS=18
QUOTE_DECIMALS=18
YO_SYMBOL=LOCAL:USDso
YO_SIGMA_TICKS=10000
YO_NOTIONAL_USDSO=25
YO_MAX_INVENTORY_USDSO=5000
YO_TARGET_INVENTORY_USDSO=2000
YO_MIN_GAS_SOMI=0
YO_REFRESH_INTERVAL_MS=2000
OPERATOR_PORT=8787
VAULT_DEPLOY_BLOCK=$DEPLOY_BLOCK
ANALYTICS_DB_PATH=data/local-analytics.sqlite
ANALYTICS_SNAPSHOT_INTERVAL_MS=1000
DRY_RUN=false
EOF

cat > apps/web/.env.local <<EOF
VITE_CHAIN_ID=31337
VITE_RPC_URL=$RPC_URL
VITE_VAULT_ADDRESS=$VAULT
VITE_VAULT_DEPLOY_BLOCK=$DEPLOY_BLOCK
VITE_OPERATOR_METRICS_URL=http://localhost:8787/metrics
VITE_OPERATOR_ANALYTICS_URL=http://localhost:8787/analytics
EOF

nohup npm run dev:operator > .local-operator.log 2>&1 &
echo "$!" > .local-operator.pid
nohup npm run dev -w @yield-vault/web -- --host 127.0.0.1 > .local-web.log 2>&1 &
echo "$!" > .local-web.pid

echo
echo "Local CLOB Yield Vault is running:"
echo "  UI:       http://127.0.0.1:5173"
echo "  Metrics:  http://127.0.0.1:8787/metrics"
echo "  RPC:      $RPC_URL"
echo "  Vault:    $VAULT"
echo "  Pool:     $POOL"
echo
echo "Add chain 31337 to your wallet and import the first Anvil account:"
echo "  $ADMIN_KEY"
echo "This key is public and must never be used outside local development."
