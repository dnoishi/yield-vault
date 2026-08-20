# Building an ERC-4626 vault on DreamDEX

This guide maps the repository's implementation to the decisions required for
a non-custodial DreamDEX strategy vault.

## 1. Keep ownership on-chain

Use ERC-4626 shares for deposits and claims. The vault contract—not an operator
EOA—must own tokens, DreamDEX manual-vault balances, and resting orders.

`YieldVault.grossManagedAssets` values:

- quote held by the vault;
- withdrawable pool quote;
- withdrawable base marked at midpoint with a haircut;
- principal locked in open bids and asks.

Subtract fixed queued liabilities from `totalAssets` so claims already removed
from share supply do not accrue to remaining holders.

## 2. Enable DreamDEX manual-vault mode

The admin configures the vault address as the DreamDEX owner and enables manual
vault mode. Capital enters or exits the pool only through keeper-controlled
vault methods. See `script/SetupMarket.s.sol`.

The operator registry grants a hot key only:

- `placeOrderFor(vault, ...)`
- `cancelOrderFor(vault, ...)`

Do not grant the operator token allowance, `KEEPER_ROLE`, guardian powers, or
admin rights.

## 3. Separate allocation from quoting

`allocate` moves idle USDso into the pool while enforcing `minIdleBps`.
`processQueue` pulls free pool USDso when needed. A separate optional keeper key
runs these methods; the market-making key only manages order placement.

This split limits a compromised quoting key while preserving automation.

## 4. Account for resting-order liquidity

Order principal remains part of NAV, but it is not instant liquidity.
`maxRedeem` is therefore bounded by vault-held idle USDso and returns zero while
any queued liability exists.

When idle is insufficient, `requestRedeem`:

1. prices shares at current NAV;
2. burns them immediately;
3. creates a fixed FIFO USDso liability;
4. pays after free liquidity covers the queue head.

The frontend must describe this as “queued—processing as liquidity frees,” not
as a pending or failed transaction.

## 5. Add a scoped strategy

The reference operator consumes DreamDEX top-of-book data, computes
inventory-aware post-only quotes, and manages orders with the scoped registry
permission. Its safety checks include:

- stale market feed;
- low gas;
- inventory ceiling;
- repeated placement failures;
- maximum observed book spread.

Start with `DRY_RUN=true`. The proximity score estimates resting interest; it
is not APY or guaranteed yield.

## 6. Add same-block reactive protection

`RiskHandler` subscribes to Somnia `EpochTick`, reads the canonical on-chain
book, and halts for:

- crossed bid/ask;
- spread above `maxSpreadBps`;
- midpoint movement above `maxMoveBps`.

The handler needs native-token funding for callbacks. Threshold ownership sits
behind a timelock. Measure live spread and move telemetry before changing
defaults with `script/ConfigureRisk.s.sol`.

## 7. Make liveness observable

The reference `/health` endpoint checks whether:

- the operator manages existing exposure;
- analytics snapshots are fresh;
- queued liabilities are making progress;
- the RiskHandler subscription is active;
- an automated keeper is configured;
- the vault is paused.

Return 503 for an unhealthy operator, stale analytics, or a stalled queue so
the process manager can restart and alert. A restart cannot fix a missing key,
inactive subscription, or locked liquidity; retain an incident runbook.

## 8. Present honest user accounting

The web app reads on-chain TVL, idle/deployed capital, queue state, and
RiskHandler status. Indexed flow-adjusted earnings include deposits and exits,
and realized/unrealized P&L can be negative.

Deposit screens should state that share price can go down and that the product
is a market-making vault, not a savings account.

## Reference map

| Concern | Implementation |
|---|---|
| Vault and queue | `src/YieldVault.sol` |
| Reactive circuit breaker | `src/RiskHandler.sol` |
| DreamDEX interfaces | `src/interfaces/IDreamDex.sol` |
| Market setup | `script/SetupMarket.s.sol` |
| Risk subscription/tuning | `script/SubscribeRisk.s.sol`, `script/ConfigureRisk.s.sol` |
| Quoting strategy | `operator/src/strategy/yieldOptimizer.ts` |
| Keeper automation | `operator/src/keeper.ts` |
| Liveness | `operator/src/watchdog.ts`, `operator/src/index.ts` |
| User transparency | `apps/web/src/` |
| End-to-end tests | `test/LocalIntegration.t.sol`, `test/ShannonFork.t.sol` |

For deployment steps, see [deployment.md](deployment.md). For operations and
incidents, see [operator-runbook.md](operator-runbook.md).
