#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm run local:down >/dev/null 2>&1 || true
trap 'npm run local:down >/dev/null 2>&1 || true' EXIT
npm run local:up

for service in operator web; do
  pid_file=".local-$service.pid"
  if [[ -f "$pid_file" ]]; then
    pid="$(tr -d '[:space:]' < "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then kill "$pid"; fi
    rm -f "$pid_file"
  fi
done

RUN_LOCAL_INTEGRATION=true npm run test -w @yield-vault/operator
"$HOME/.foundry/bin/forge" test --match-contract LocalIntegrationTest
