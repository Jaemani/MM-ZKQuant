import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { encryptRequest, SealedStore } from '../src/integration/sealed.js';
import { verifyPlatformTee } from '../src/platform/tee-attestation.js';
import { validateTargets } from '../src/platform/policy.js';

const DAY = 86400000;
export const MARKETS = [
  { market: 16, symbol: 'BTCUSDT', weightBps: 3000 },
  { market: 32, symbol: 'ETHUSDT', weightBps: 3000 },
  { market: 48, symbol: 'SOLUSDT', weightBps: 2000 },
];

export function signal(closes, active, entryBps = 200) {
  if (closes.length < 2 || closes.some(p => !Number.isFinite(p) || p <= 0)) throw Error('INVALID_PRICES');
  const price = closes.at(-1), mean = closes.reduce((a, b) => a + b, 0) / closes.length;
  return active ? price < mean : price <= mean * (1 - entryBps / 10000);
}

export function closedPrices(rows, now, lookback) {
  const candles = rows.filter(r => Number(r[6]) < now).slice(-lookback);
  const lastExpected = Math.floor(now / DAY) * DAY - 1;
  if (candles.length !== lookback || Number(candles.at(-1)[6]) !== lastExpected) throw Error('STALE_OR_INCOMPLETE_CANDLES');
  for (let i = 0; i < candles.length; i++) {
    if (Number(candles[i][6]) !== Number(candles[i][0]) + DAY - 1 ||
        (i && Number(candles[i][0]) - Number(candles[i - 1][0]) !== DAY)) throw Error('INVALID_CANDLE_INTERVAL');
  }
  const closes = candles.map(r => Number(r[4]));
  if (closes.some(p => !Number.isFinite(p) || p <= 0)) throw Error('INVALID_PRICES');
  return closes;
}

export function nextRun(now, utcTime) {
  const [hours, minutes] = utcTime.split(':').map(Number);
  if (!/^\d{2}:\d{2}$/.test(utcTime) || hours > 23 || minutes > 59) throw Error('INVALID_RUN_TIME');
  const today = Math.floor(now / DAY) * DAY + hours * 3600000 + minutes * 60000;
  return today > now ? today : today + DAY;
}

const log = value => console.log(JSON.stringify({ at: new Date().toISOString(), ...value }));
async function getJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(45000) });
  const body = await response.json();
  if (!response.ok) throw Error(`HTTP_${response.status}`);
  return body;
}

export async function runOnce(options, store, dryRun = false) {
  const state = store.read() || { strategyId: options.strategyId, active: options.initialActive, lastDay: null, pending: null };
  if (state.strategyId !== options.strategyId) throw Error('STATE_STRATEGY_MISMATCH');
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  if (state.lastDay === day && !state.pending && !dryRun) { log({ status: 'ALREADY_RAN_TODAY' }); return; }
  const config = await getJson(`${options.apiBase}/v1/config`);
  const attested = await verifyPlatformTee({ endpoint: config.teeEndpoint, publicKey: config.teeEncryptionPublicKey, vault: config.vaultAddress });
  async function send(message) {
    const channel = encryptRequest(attested.encryptionPublicKey, { strategyId: options.strategyId, apiKey: options.apiKey, ...message });
    const body = await getJson(`${attested.teeEndpoint}/platform/encrypted-strategy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(channel.packet),
    });
    if (!body.reply) throw Error('MISSING_TEE_REPLY');
    const result = channel.openReply(body.reply);
    if (result.error) throw Error(result.error);
    return result;
  }
  let status = await send({ action: 'STATUS' });
  if (status.reconciliationError || status.valuationError) throw Error('TEE_RECONCILIATION_OR_VALUATION_ERROR');
  if (!state.pending) {
    if (state.lastSequence !== undefined && status.sequence !== state.lastSequence) throw Error('SEQUENCE_CHANGED_CHECK_STRATEGY');
    if (status.status !== 'ACTIVE') throw Error('STRATEGY_NOT_ACTIVE');
    if (status.requests.some(r => ['QUEUED', 'EXECUTING'].includes(r.status))) throw Error('PREVIOUS_REQUEST_PENDING');
    const prices = await Promise.all(MARKETS.map(async market => {
      const url = new URL('/api/v3/klines', options.priceBase);
      url.search = new URLSearchParams({ symbol: market.symbol, interval: '1d', limit: String(options.lookback + 2) });
      const rows = await getJson(url);
      if (!Array.isArray(rows)) throw Error('INVALID_PRICE_RESPONSE');
      return closedPrices(rows, now, options.lookback);
    }));
    const active = Object.fromEntries(MARKETS.map((m, i) => [m.market, signal(prices[i], !!state.active[m.market], options.entryBps)]));
    const targets = validateTargets(MARKETS.map(m => ({ market: m.market, weightBps: active[m.market] ? m.weightBps : 0 })), status.policy);
    // Targets remain local to the strategist and inside the encrypted TEE request.
    // Logs deliberately contain no positions, credentials, or signals.
    if (dryRun) { log({ status: 'DRY_RUN_OK', markets: MARKETS.length, attestationVerified: true, orderSent: false }); return; }
    state.pending = { requestId: randomUUID(), sequence: status.sequence + 1, day, active, targets };
    store.write(state); // Persist before network I/O; retries use the same id and vector.
  } else if (dryRun) {
    log({ status: 'PENDING_REQUEST', sequence: state.pending.sequence, orderSent: false }); return;
  }
  const pending = state.pending;
  const existing = status.requests.find(r => r.id === pending.requestId);
  if (!existing) {
    if (status.sequence !== pending.sequence - 1) throw Error('SEQUENCE_CHANGED_CHECK_STRATEGY');
    try {
      const accepted = await send({ action: 'TARGET', targets: pending.targets, sequence: pending.sequence, requestId: pending.requestId });
      log({ status: accepted.status, sequence: pending.sequence, requestId: pending.requestId });
    } catch {
      // The server may have accepted a timed-out request. Poll, never create a new order id.
      log({ status: 'SUBMISSION_UNCONFIRMED', sequence: pending.sequence });
    }
  }
  const until = Date.now() + 240000;
  while (Date.now() < until) {
    status = await send({ action: 'STATUS' });
    const job = status.requests.find(r => r.id === pending.requestId);
    if (job && !['QUEUED', 'EXECUTING'].includes(job.status)) {
      log({ status: job.status, sequence: job.sequence, requestId: job.id, error: job.error || undefined });
      if (job.status !== 'EXECUTED') throw Error('EXECUTION_STOPPED_CHECK_HISTORY');
      state.active = pending.active; state.lastDay = pending.day; state.lastSequence = pending.sequence; state.pending = null;
      store.write(state); return;
    }
    if (!job) throw Error('SUBMISSION_UNCONFIRMED_RESTART_WITH_SAME_STATE');
    await sleep(5000);
  }
  throw Error('EXECUTION_PENDING_RESTART_WITH_SAME_STATE');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !['--once', '--dry-run', '--help'].includes(a))) throw Error('UNKNOWN_ARGUMENT');
  if (args.includes('--help')) {
    console.log('node scripts/mean-reversion.mjs [--once] [--dry-run]\nDefault: run now, then daily at configured UTC time. --dry-run never submits.'); return;
  }
  const envFile = process.env.MRQ_ENV_FILE || '.env.mean-reversion';
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const env = process.env;
  const options = {
    strategyId: env.MRQ_STRATEGY_ID,
    apiKey: env.MMQ_API_TOKEN,
    apiBase: (env.MRQ_API_URL || 'https://mm-zkquant.vercel.app/api').replace(/\/$/, ''),
    priceBase: env.MRQ_PRICE_URL || 'https://data-api.binance.vision',
    lookback: Number(env.MRQ_LOOKBACK_DAYS || 20),
    entryBps: Number(env.MRQ_ENTRY_BPS || 200),
    initialActive: Object.fromEntries((env.MRQ_INITIAL_ACTIVE_MARKETS || '').split(',').filter(Boolean).map(id => [Number(id), true])),
  };
  if (!options.strategyId || !options.apiKey) throw Error('SET_MRQ_STRATEGY_ID_AND_MMQ_API_TOKEN');
  if (!Number.isInteger(options.lookback) || options.lookback < 2 || options.lookback > 998 ||
      !Number.isInteger(options.entryBps) || options.entryBps <= 0 || options.entryBps >= 10000) throw Error('INVALID_SIGNAL_CONFIG');
  if (Object.keys(options.initialActive).some(id => !MARKETS.some(m => m.market === Number(id)))) throw Error('INVALID_INITIAL_MARKETS');
  const utcTime = env.MRQ_RUN_UTC || '00:05';
  nextRun(Date.now(), utcTime);
  const statePath = resolve(env.MRQ_STATE_FILE || `.data/mean-reversion/${options.strategyId}.sealed.json`);
  const lockPath = statePath + '.lock';
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  try { mkdirSync(lockPath, { mode: 0o700 }); } catch { throw Error('BOT_LOCKED_STOP_OTHER_PROCESS_OR_REMOVE_STALE_LOCK'); }
  writeFileSync(`${lockPath}/pid`, String(process.pid), { mode: 0o600 });
  const unlock = () => rmSync(lockPath, { recursive: true, force: true });
  process.on('exit', unlock);
  for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => process.exit(0));
  const key = createHash('sha256').update(`MRQ_STATE_V1:${options.apiKey}`).digest();
  const store = new SealedStore(statePath, key, 'mean-reversion-v1');
  const dryRun = args.includes('--dry-run');
  try {
    for (;;) {
      await runOnce(options, store, dryRun);
      if (args.includes('--once') || dryRun) break;
      const at = nextRun(Date.now(), utcTime);
      log({ status: 'WAITING', nextRun: new Date(at).toISOString() });
      while (Date.now() < at) await sleep(Math.min(60000, at - Date.now()));
    }
  } finally { unlock(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    const code = /^[A-Z][A-Z0-9_]+$/.test(error.message || '') ? error.message : 'CONNECTION_OR_VERIFICATION_ERROR';
    console.error(`Bot stopped: ${code}. Check execution history and configuration before restarting; retain the state file.`);
    process.exitCode = 1;
  });
}
