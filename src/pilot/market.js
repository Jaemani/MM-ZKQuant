import { createHash } from 'node:crypto';
import { ASSETS } from './policy.js';
const PAIRS = { BTC: 'XBTUSD', ETH: 'ETHUSD', MON: 'MONUSD', SOL: 'SOLUSD' };
const SERIES = { BTC: ['XBTUSD','XXBTZUSD'], ETH: ['ETHUSD','XETHZUSD'], MON: ['MONUSD'], SOL: ['SOLUSD'] };
export const sha256 = text => '0x' + createHash('sha256').update(text).digest('hex');

export function parseObservation(raw, asset, boundary, receivedAt, { maxAgeSeconds = 180 } = {}) {
  const data = JSON.parse(raw);
  if (data.error?.length || !data.result) throw new Error(`${asset}: market source error`);
  const series = Object.entries(data.result).filter(([key]) => key !== 'last');
  if (series.length !== 1 || !Array.isArray(series[0][1]) || !SERIES[asset]?.includes(series[0][0])) throw new Error(`${asset}: ambiguous or wrong market series`);
  // Kraken explicitly identifies the final row as the current incomplete candle.
  const closed = series[0][1].slice(0, -1);
  const candle = closed.find(row => Number(row[0]) + 60 === boundary);
  if (!candle || candle.length < 8) throw new Error(`${asset}: closed candle at required boundary missing`);
  const price = Number(candle[4]);
  if (!Number.isFinite(price) || price <= 0 || price > 1e12) throw new Error(`${asset}: invalid price`);
  if (receivedAt < boundary || receivedAt - boundary > maxAgeSeconds) throw new Error(`${asset}: future or stale observation`);
  return { asset, source: 'KRAKEN', instrument: PAIRS[asset], quote: 'USD', intervalSeconds: 60,
    candleOpenAt: Number(candle[0]), observedAt: boundary, receivedAt,
    price: String(candle[4]), tradeCount: Number(candle[7]), volume: String(candle[6]),
    zeroVolume: Number(candle[7]) === 0, rawSha256: sha256(raw) };
}
export async function collectMarket({ boundary = Math.floor(Date.now() / 60000) * 60 - 60, fetcher = fetch } = {}) {
  const observations = await Promise.all(ASSETS.map(async asset => {
    const url = `https://api.kraken.com/0/public/OHLC?pair=${PAIRS[asset]}&interval=1&since=${boundary - 120}`;
    const requestAt = new Date().toISOString();
    let response;
    for(let attempt=0;attempt<3;attempt++) {
      try {
        response=await fetcher(url,{signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
        if(response.ok || (response.status!==429 && response.status<500))break;
      } catch(error) {if(attempt===2)throw error;}
      if(attempt<2)await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
    }
    if(!response)throw new Error(`${asset}: market connection failed`);
    if (!response.ok) throw new Error(`${asset}: market HTTP ${response.status}`);
    const raw = await response.text();
    const receivedAt = Math.floor(Date.now() / 1000);
    const observation = parseObservation(raw, asset, boundary, receivedAt);
    return { ...observation, url, requestAt, serverDate: response.headers.get('date'), raw };
  }));
  return { schema: 'MM_PUBLIC_MARKET_V1', boundary, source: 'KRAKEN_CLOSED_1M_USD',
    prices: Object.fromEntries(observations.map(o => [o.asset, o.price])), observations,
    provenance: 'PUBLIC_HTTPS_SOURCE_OPERATOR_RETRIEVAL; zero-volume carry-forward candles explicitly retained; not an oracle signature' };
}
export function verifyMarket(bundle) {
  if (bundle.source !== 'KRAKEN_CLOSED_1M_USD' || bundle.observations.length !== 4) throw new Error('Unsupported market evidence');
  for (const asset of ASSETS) {
    const o = bundle.observations.find(o => o.asset === asset);
    if (!o || sha256(o.raw) !== o.rawSha256) throw new Error('Raw market evidence changed');
    const parsed = parseObservation(o.raw, asset, bundle.boundary, o.receivedAt);
    if (parsed.price !== bundle.prices[asset] || parsed.instrument !== o.instrument || parsed.observedAt !== o.observedAt) throw new Error('Market mark differs from source');
  }
  return true;
}
