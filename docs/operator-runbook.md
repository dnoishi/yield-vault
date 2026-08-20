# Operator runbook

## Keys

- Deployer/timelock proposer: deployment and scheduled administration only.
- `PRIVATE_KEY`: scoped DreamDEX quoting key with gas only.
- `KEEPER_PRIVATE_KEY`: optional, separate key holding `KEEPER_ROLE`.
- Guardian: emergency halt key; keep separate from the operator.

Never grant the quoting key `KEEPER_ROLE` or fund it with vault assets.

## Go-live

1. Deploy the timelock, RiskHandler, and vault with `Deploy.s.sol`.
2. Fund RiskHandler with at least 32 SOMI/STT.
3. Schedule and execute `SetupMarket.s.sol` to enable manual-vault mode and
   approve the operator for place/cancel only.
4. Schedule and execute `SubscribeRisk.s.sol`; verify `subscriptionId != 0`.
5. Fund operator and keeper EOAs with gas only.
6. Configure `OWNER_ADDRESS`, `RISK_HANDLER_ADDRESS`, and deploy block.
7. Start with `DRY_RUN=true`; run the doctor and inspect all HTTP endpoints.
8. Confirm `/health` is healthy or only has understood degraded warnings.
9. Set `DRY_RUN=false` after observing expected quote sizes and risk telemetry.

`KEEPER_PRIVATE_KEY` is optional. If omitted, `/health` reports manual keeper
dependency whenever claims are queued. If set, the service calls
`processQueue(KEEPER_MAX_REQUESTS)`; the vault itself withdraws free pool USDso
before paying FIFO claims.

## Health endpoints

`/health` returns HTTP 200 for healthy/degraded operation and 503 for unhealthy
operation. Inspect `checks` and `reasons`:

| Check | Healthy | Action when unhealthy |
|---|---|---|
| operator | `quoting` or expected `dry-run` | Inspect feed, gas, and kill reason; cancel exposure |
| analytics | `current` | Restore RPC/indexer and persistent volume |
| withdrawals | `clear` or briefly `queued` | Run keeper, free/cancel resting liquidity, process FIFO |
| riskHandler | `active` | Fund handler and execute subscription timelock |
| keeper | `configured` or accepted `manual` | Restore separate keeper key/service |
| vault | `active` | Follow emergency-halt recovery |

`QUEUE_STALL_THRESHOLD_MS` defaults to 120 seconds. Any liability reduction
resets the timer. `/metrics` includes the same watchdog object plus current and
observed maximum spread/move telemetry.

## Queue-stall playbook

1. Verify `queuedLiabilities`, queue head, idle USDso, and open orders.
2. Confirm keeper balance and `KEEPER_ROLE`.
3. If free pool quote exists, call `processQueue`; it recalls free quote itself.
4. If principal is locked, use the scoped operator or guardian to cancel orders.
5. Run `processQueue` again and confirm liabilities decrease.
6. Do not enable instant exits while queued claims remain; contract priority
   prevents this automatically.

## Risk threshold operations

Observe `marketSpreadBps`, `marketMoveBps`, `observedMaxSpreadBps`, and
`observedMaxMoveBps` over representative Shannon conditions. Keep a margin over
normal behavior; do not tune against a single quiet window.

Schedule a threshold update:

```sh
MAX_SPREAD_BPS=<value> MAX_MOVE_BPS=<value> \
forge script script/ConfigureRisk.s.sol:ConfigureRisk \
  --rpc-url "$RPC_URL" --broadcast --gas-estimate-multiplier 2000
```

After the timelock delay, rerun with `EXECUTE_TIMELOCK=true`. Verify the values
in `/metrics` and the web Safety page. Defaults are 100/100 bps; these are
deployment defaults, not a claim that they fit every market regime.

## Emergency halt and recovery

An emergency halt pauses deposits/exits, revokes the operator, and attempts to
cancel all orders. `recall` and queue processing remain recovery paths.

Before unpausing:

1. Identify and remediate the halt reason.
2. Verify no unsafe open orders or unexpected inventory remain.
3. Confirm RiskHandler funding/subscription and operator/keeper gas.
4. Unpause through the timelock.
5. Explicitly call `setOperator` again; unpause does not re-authorize it.
6. Start in dry-run, verify health, then resume live quoting.
