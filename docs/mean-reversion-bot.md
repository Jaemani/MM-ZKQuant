# Daily mean reversion bot

This Node.js program operates a strategist's portfolio through the existing encrypted TEE API. It needs Node 22.13+ and the repository dependencies (`npm ci`). No wallet signing or Binance API key is needed.

## Rules

- Once daily at **00:05 UTC (09:05 Korea)**, use the last 20 completed UTC daily candles, including yesterday's close, to calculate a simple moving average.
- Enter a long position when yesterday's close is at least 2% below that average.
- Keep an existing long until yesterday's close reaches or exceeds the average; then set its target to zero.
- Maximum target exposure: BTC 30%, ETH 30%, SOL 20%. Inactive allocations remain cash; no shorts or additional leverage.
- Send one complete portfolio vector each day. The TEE trades the differences; daily submission does not necessarily mean an actual fill every day.
- The signal uses Binance spot USDT candles; Perpl executes using its own prices. This is a starter strategy, without backtested performance claims.

Binance's [market data endpoint](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints) provides daily candles through the [public market-data-only host](https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only).

## Run

```sh
cp examples/mean-reversion.env.example .env.mean-reversion
# Set MMQ_API_TOKEN locally. The user's supplied key is already configured
# in the current workspace; a fresh checkout requires setting it again.
node scripts/mean-reversion.mjs --dry-run
node scripts/mean-reversion.mjs
```

The second command sends a live target immediately unless it already ran today, then waits for the next daily schedule. Keep the process running on an always-on machine (terminal/tmux/systemd); closing it stops the bot. It is not hosted on Vercel or Phala automatically.

To submit again manually on the same day, run `node scripts/mean-reversion.mjs --once`. This bypasses the daily checkpoint and submits a fresh target once. An existing pending request is resumed with its original ID instead; failed/partial requests still require reconciliation. `--once --dry-run` never submits. Repeated submissions can rebalance to the same target weights, but do not guarantee new fills. For cron, use `--once` daily from the repository directory with `TZ=UTC` and schedule `5 0 * * *`.

**This bot takes over the entire strategy's allocation.** The initial active markets are seeded from successful request #17 (BTC/ETH/SOL). On the first live run it can reduce or close those positions based on the signal. For another strategy, set the initial active markets to match its existing positions, or leave empty for a cash-only portfolio. Avoid manual submissions or another bot for the same strategy while running this program.

## Reliability and local state

Fresh attestation is verified before each run. API credentials and the complete target vector are encrypted locally and sent directly to the TEE; target vectors are not sent through the platform database. The TEE checks API authorization with the platform API. Actual venue transactions remain observable on-chain.

The encrypted local state under `.data/mean-reversion/` tracks intended holdings, the daily checkpoint, and a pending request. It is encrypted using a key derived from the API token. Keep this state across restarts; deleting it or changing the token prevents reliable recovery. State and credentials are ignored by Git. Logs only contain execution metadata, never target vectors or API tokens.

A saved pending request is resumed with the same request ID, sequence, and target vector, preventing duplicate submissions after a timeout. Only a successful `EXECUTED` result updates the holding state. On a failed/partial execution the process stops and retains the pending request: inspect the platform execution history and reconcile positions before editing/resetting state. It does not automatically retry failed trades or top up collateral. Missing/stale daily candles abort the run without an order. Run `--dry-run` to check data, authentication, policy limits, and TEE attestation without submitting or changing state.

Concurrent processes using the same state file are blocked by a lock directory. A graceful shutdown removes it. After a forced kill, confirm no bot remains running using the PID in `<state-file>.lock/pid`, then remove only that stale lock directory before restarting.
