#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPERATOR_ENV="${OPERATOR_ENV:-$ROOT/operator/.env.local}"
SHANNON_DEPLOYMENT="$ROOT/deployments/shannon.json"
RAILWAY_PROJECT_NAME="${RAILWAY_PROJECT_NAME:-yield-vault-operator}"
RAILWAY_SERVICE_NAME="${RAILWAY_SERVICE_NAME:-operator}"
VERCEL_PROJECT_NAME="${VERCEL_PROJECT_NAME:-yield-vault}"

cd "$ROOT"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing $1 CLI. Install once with:"
    echo "  npm install --global vercel @railway/cli"
    exit 1
  fi
}

json_value() {
  node -e '
    const fs = require("node:fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const value = data[process.argv[2]];
    if (value === undefined || value === null || value === "") process.exit(1);
    process.stdout.write(String(value));
  ' "$1" "$2"
}

json_has_mount() {
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const visit = (value) => {
        if (!value || typeof value !== "object") return false;
        if (value.mountPath === "/data") return true;
        return Object.values(value).some(visit);
      };
      process.exit(visit(JSON.parse(input)) ? 0 : 1);
    });
  '
}

domain_from_json() {
  node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const data = JSON.parse(input);
      const candidate = data.domain ?? data.domains?.[0];
      if (!candidate) process.exit(1);
      const url = String(candidate).startsWith("http")
        ? String(candidate)
        : `https://${candidate}`;
      process.stdout.write(url.replace(/\/$/, ""));
    });
  '
}

set_railway_variable() {
  local name="$1"
  local value="$2"
  printf '%s' "$value" |
    railway variable set "$name" --stdin \
      --service "$RAILWAY_SERVICE_NAME" --skip-deploys >/dev/null
}

upsert_vercel_variable() {
  local name="$1"
  local value="$2"
  vercel env add "$name" production \
    --force --value "$value" --yes --no-sensitive >/dev/null
}

require_command node
require_command railway
require_command vercel

if ! railway whoami >/dev/null 2>&1; then
  echo "Railway is not authenticated. Run: railway login"
  exit 1
fi
if ! vercel whoami >/dev/null 2>&1; then
  echo "Vercel is not authenticated. Run: vercel login"
  exit 1
fi
if [[ ! -f "$SHANNON_DEPLOYMENT" ]]; then
  echo "Missing deployments/shannon.json. Deploy the Shannon contracts first."
  exit 1
fi
if [[ ! -f "$OPERATOR_ENV" ]]; then
  echo "Missing $OPERATOR_ENV. Copy operator/.env.shannon.example and fill it in."
  exit 1
fi

set -a
# Defaults are loaded first; local values override them.
source "$ROOT/operator/.env.shannon.example"
source "$OPERATOR_ENV"
set +a

if [[ ! "${PRIVATE_KEY:-}" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "PRIVATE_KEY in $OPERATOR_ENV must be a 32-byte operator hot key."
  exit 1
fi

VAULT_ADDRESS="$(json_value "$SHANNON_DEPLOYMENT" vault)"
VAULT_DEPLOY_BLOCK="$(json_value "$SHANNON_DEPLOYMENT" deployBlock)"
POOL_ADDRESS="$(json_value "$SHANNON_DEPLOYMENT" pool)"
OPERATOR_REGISTRY="$(json_value "$SHANNON_DEPLOYMENT" operatorRegistry)"

echo "Preparing Railway operator..."
if ! railway link --project "$RAILWAY_PROJECT_NAME" --json >/dev/null 2>&1; then
  railway init --name "$RAILWAY_PROJECT_NAME" --json >/dev/null
fi
if ! railway link --project "$RAILWAY_PROJECT_NAME" \
  --service "$RAILWAY_SERVICE_NAME" --json >/dev/null 2>&1; then
  railway add --service="$RAILWAY_SERVICE_NAME" --json >/dev/null
  railway link --project "$RAILWAY_PROJECT_NAME" \
    --service "$RAILWAY_SERVICE_NAME" --json >/dev/null
fi

set_railway_variable NETWORK "testnet"
set_railway_variable RPC_URL "${RPC_URL:-https://api.infra.testnet.somnia.network/}"
set_railway_variable WS_URL "${WS_URL:-wss://stg.api.dreamdex.io/v0/ws/public}"
set_railway_variable PRIVATE_KEY "$PRIVATE_KEY"
set_railway_variable OWNER_ADDRESS "$VAULT_ADDRESS"
set_railway_variable POOL_ADDRESS "$POOL_ADDRESS"
set_railway_variable OPERATOR_REGISTRY "$OPERATOR_REGISTRY"
set_railway_variable VAULT_DEPLOY_BLOCK "$VAULT_DEPLOY_BLOCK"
set_railway_variable ANALYTICS_DB_PATH "/data/analytics.sqlite"

OPERATOR_VARIABLES=(
  ANALYTICS_SNAPSHOT_INTERVAL_MS
  ANALYTICS_POLL_INTERVAL_MS
  ANALYTICS_BLOCK_CHUNK
  ANALYTICS_CONFIRMATIONS
  YO_SYMBOL
  YO_SIGMA_TICKS
  YO_MIN_WEIGHT
  YO_NOTIONAL_USDSO
  YO_HALF_SPREAD_BPS
  YO_GAMMA
  YO_K_VOL
  YO_MAX_INVENTORY_USDSO
  YO_TARGET_INVENTORY_USDSO
  YO_MAX_BOOK_SPREAD_BPS
  YO_REQUOTE_TRIGGER_BPS
  YO_REQUOTE_COOLDOWN_MS
  YO_STALE_MS
  YO_MIN_GAS_SOMI
  YO_REFRESH_INTERVAL_MS
  DRY_RUN
)
for name in "${OPERATOR_VARIABLES[@]}"; do
  if [[ -n "${!name:-}" ]]; then
    set_railway_variable "$name" "${!name}"
  fi
done

VOLUME_JSON="$(
  railway volume --service "$RAILWAY_SERVICE_NAME" list --json
)"
if ! printf '%s' "$VOLUME_JSON" | json_has_mount; then
  if ! railway volume --service "$RAILWAY_SERVICE_NAME" add \
    --mount-path /data --json >/dev/null; then
    echo "Warning: Railway volume creation failed; analytics will rebuild after redeploys."
  fi
fi

DOMAIN_JSON="$(railway domain list --service "$RAILWAY_SERVICE_NAME" --json)"
if ! RAILWAY_URL="$(printf '%s' "$DOMAIN_JSON" | domain_from_json)"; then
  DOMAIN_JSON="$(railway domain --service "$RAILWAY_SERVICE_NAME" --json)"
  RAILWAY_URL="$(printf '%s' "$DOMAIN_JSON" | domain_from_json)"
fi

echo "Deploying operator to Railway..."
railway up --detach --yes

echo "Preparing Vercel website..."
if [[ ! -f "$ROOT/.vercel/project.json" ]]; then
  vercel link --yes --project "$VERCEL_PROJECT_NAME"
fi

upsert_vercel_variable VITE_CHAIN_ID "50312"
upsert_vercel_variable VITE_RPC_URL "https://api.infra.testnet.somnia.network/"
upsert_vercel_variable VITE_VAULT_ADDRESS "$VAULT_ADDRESS"
upsert_vercel_variable VITE_VAULT_DEPLOY_BLOCK "$VAULT_DEPLOY_BLOCK"
upsert_vercel_variable VITE_DREAMDEX_API_URL "https://stg.api.dreamdex.io/v0"
upsert_vercel_variable VITE_DREAMDEX_SYMBOL "WETH:USDso"
upsert_vercel_variable VITE_OPERATOR_METRICS_URL "$RAILWAY_URL/metrics"
upsert_vercel_variable VITE_OPERATOR_ANALYTICS_URL "$RAILWAY_URL/analytics"

echo "Deploying website to Vercel..."
VERCEL_URL="$(vercel deploy --prod --yes)"

echo
echo "Shannon deployment complete:"
echo "  Website:  $VERCEL_URL"
echo "  Operator: $RAILWAY_URL"
echo "  Health:   $RAILWAY_URL/health"
echo "  Metrics:  $RAILWAY_URL/metrics"
