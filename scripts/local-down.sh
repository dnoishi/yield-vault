#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

for service in web operator anvil; do
  pid_file=".local-$service.pid"
  if [[ -f "$pid_file" ]]; then
    pid="$(tr -d '[:space:]' < "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      for _ in {1..20}; do
        if ! kill -0 "$pid" 2>/dev/null; then break; fi
        sleep 0.1
      done
      if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid"; fi
    fi
    rm -f "$pid_file"
  fi
done

echo "Local CLOB Yield Vault stopped."
