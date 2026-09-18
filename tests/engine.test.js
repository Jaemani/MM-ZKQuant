import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, chooseWeights, evaluateOutcome, markBook, planExecution, validateVector } from '../src/core/engine.js';

const vector = (BTC = 0, ETH = 0, MON = 0, SOL = 0) => ({ BTC, ETH, MON, SOL });
const prices = vector(100, 100, 100, 100);
const providers = (signals) => signals.map((vectorBps, index) => ({ id: `p${index}`, vectorBps }));
const weights = (count, value = 1000) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`p${index}`, value]));
const total = (values) => Object.values(values).reduce((sum, value) => sum + value, 0);
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);

test('vectors require exactly the fixed universe and signed integer bps', () => {
  assert.deepEqual(validateVector(vector(10000, -10000)), vector(10000, -10000));
  for (const input of [vector(10001), vector(0.5), vector(NaN), {}, { ...vector(), DOGE: 0 }, [0, 0, 0, 0]]) {
    assert.throws(() => validateVector(input));
  }
});

test('provider cap remains strict even when the cohort cannot allocate all capital', () => {
  const result = chooseWeights(providers([null, null, null]));
  assert.deepEqual(result.weightsBps, weights(3));
  assert.equal(result.unallocatedBps, 7000);
  assert.deepEqual(chooseWeights([]).weightsBps, {});
});

test('weights use prior returns, positive marginal contribution and completeness', () => {
  const cohort = Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, history: [] }));
  cohort[0].history = [{ status: 'SUBMITTED', netReturnBps: 50, marginalContributionBps: 100 }];
  cohort[1].history = [{ status: 'MISSED' }, { status: 'MISSED' }];
  cohort[2].history = [{ status: 'SUBMITTED', netReturnBps: -600, drawdownBps: -2000 }];
  const result = chooseWeights(cohort);
  assert.ok(result.weightsBps.p0 > result.weightsBps.p3);
  assert.ok(result.weightsBps.p1 < result.weightsBps.p3);
  assert.ok(result.weightsBps.p2 < result.weightsBps.p3);
  assert.ok(Object.values(result.weightsBps).every((weight) => Number.isInteger(weight) && weight <= 1000));
  assert.ok(total(result.weightsBps) <= 10000);
});

test('missing frozen weights become unallocated without increasing surviving weights', () => {
  const result = aggregate({ providers: providers([vector(10000), vector(10000), vector(10000), null]), weightsBps: weights(4) });
  assert.equal(result.status, 'READY');
  assert.equal(result.rawBps.BTC, 3000);
  assert.equal(result.targetBps.BTC, 2500);
  assert.equal(result.missingCount, 1);
  assert.equal(result.unallocatedBps, 7000);
});

test('opposite signed opinions net internally before risk and orders', () => {
  const result = aggregate({ providers: providers([vector(10000), vector(-10000), vector()]), weightsBps: weights(3) });
  assert.deepEqual(result.targetBps, vector());
  assert.equal(result.nettingRatio, 1);
  const execution = planExecution({ targetBps: result.targetBps, nav: 100000, prices });
  assert.deepEqual(execution.orders, []);
  assert.equal(execution.cost, 0);
});

test('asset and gross limits preserve signs and never round above caps', () => {
  const result = aggregate({ providers: providers([vector(10000, -10000, 10000, -10000), vector(10000, -10000, 10000, -10000), vector(10000, -10000, 10000, -10000)]),
    weightsBps: weights(3), risk: { grossCapBps: 3333 } });
  assert.deepEqual(result.targetBps, vector(833, -833, 833, -833));
  assert.equal(result.grossBps, 3332);
  assert.equal(result.riskAdjustments.length, 5);
});

test('all missing or insufficient submissions hold the current drifted book', () => {
  const current = vector(1321.12345678, -230.25);
  for (const signals of [[null, null, null], [vector(), null, null], [vector(), vector(), null]]) {
    const result = aggregate({ providers: providers(signals), weightsBps: weights(3), previousWeightsBps: current });
    assert.equal(result.status, 'SKIPPED');
    assert.deepEqual(result.targetBps, current);
    const execution = planExecution({ targetBps: result.targetBps, currentWeightsBps: current, nav: 100000, prices });
    assert.equal(execution.turnoverNotional, 0);
  }
});

test('invalid provider weights, unknown IDs and duplicate providers are rejected', () => {
  assert.throws(() => aggregate({ providers: providers([vector(), vector(), vector()]), weightsBps: { p0: 1001 } }));
  assert.throws(() => aggregate({ providers: providers([vector(), vector(), vector()]), weightsBps: { p99: 100 } }));
  assert.throws(() => chooseWeights([{ id: 'p' }, { id: 'p' }]));
  assert.throws(() => aggregate({ providers: providers(Array(11).fill(vector())), weightsBps: weights(11) }));
});

test('execution uses target minus existing exposure and slices bounded notionals', () => {
  const result = planExecution({ targetBps: vector(2500, -1000), currentWeightsBps: vector(1000, 200), nav: 100000, prices });
  assert.equal(result.turnoverNotional, 27000);
  assert.equal(result.orders.length, 11);
  assert.ok(result.orders.every((order) => order.notional <= 2500));
  assert.equal(result.orders[0].side, 'BUY');
  assert.equal(result.orders.at(-1).side, 'SELL');
  assert.equal(result.orders.at(-1).notional, 2000);
  assert.equal(result.fee, 27);
  assert.equal(result.slippage, 13.5);
  assert.equal(result.cost, 40.5);
  assert.equal(result.orders[0].fillPrice, 100.05);
  assert.equal(result.orders.at(-1).fillPrice, 99.95);
});

test('unchanged exposure has zero turnover and zero fees even with signed positions', () => {
  const targetBps = vector(2000, -1000, 300);
  const result = planExecution({ targetBps, currentWeightsBps: targetBps, nav: 100000, prices });
  assert.equal(result.orders.length, 0);
  assert.equal(result.cost, 0);
});

test('linear book PnL subtracts fees once and carries weights drifted by prices and NAV', () => {
  const result = evaluateOutcome({ providers: providers([vector(10000), vector(10000), vector(10000)]),
    weightsBps: weights(3), beginPrices: prices, endPrices: vector(110, 100, 100, 100) });
  assert.equal(result.aggregate.targetBps.BTC, 2500);
  assert.equal(result.execution.cost, 37.5);
  assert.equal(result.book.nav, 102462.5);
  close(result.book.netReturnBps, 246.25);
  close(result.book.weightsBps.BTC, 27500 / 102462.5 * 10000);
  assert.equal(result.book.drawdownBps, 0);
  assert.equal(result.book.peakNav, 102462.5);
});

test('flat signals and prices have no fees, no return and undefined prediction metrics', () => {
  const result = evaluateOutcome({ providers: providers([vector(), vector(), vector()]), weightsBps: weights(3), beginPrices: prices, endPrices: prices });
  assert.equal(result.book.nav, 100000);
  assert.equal(result.execution.cost, 0);
  assert.ok(result.providerResults.every((provider) => provider.predictionIC === null && provider.hitRate === null));
  assert.ok(result.providerResults.every((provider) => provider.predictionAssetCount === 4 && provider.directionalAssetCount === 0));
  assert.equal(result.rewardPreview.allocatedUnits, 0);
  assert.equal(result.rewardPreview.unallocatedUnits, 10000);
});

test('constant signals or constant cross-sectional returns have undefined IC', () => {
  const result = evaluateOutcome({ providers: providers([vector(1000, 1000, 1000, 1000), vector(2000), vector(-2000)]),
    weightsBps: weights(3), beginPrices: prices, endPrices: vector(110, 110, 110, 110) });
  assert.ok(result.providerResults.every((provider) => provider.predictionIC === null));
  assert.equal(result.providerResults[0].hitRate, 1);
  assert.equal(result.providerResults[2].hitRate, 0);
});

test('prediction sample counts report all IC assets and only nonzero directional pairs', () => {
  const result = evaluateOutcome({ providers: providers([vector(1000, -1000, 1000, 1000), vector(1000, 0, 1000, 0), vector()]),
    weightsBps: weights(3), beginPrices: prices, endPrices: vector(110, 90, 90, 100) });
  const first = result.providerResults[0];
  assert.equal(first.predictionAssetCount, 4);
  assert.equal(first.directionalAssetCount, 3);
  close(first.hitRate, 2 / 3);
  assert.equal(result.providerResults[1].directionalAssetCount, 2);
  assert.equal(result.providerResults[1].hitRate, 0.5);
  assert.equal(result.providerResults[2].predictionAssetCount, 4);
  assert.equal(result.providerResults[2].directionalAssetCount, 0);
  assert.equal(result.providerResults[2].hitRate, null);
});

test('missing providers flatten only their shadow and retain an explicit missing record', () => {
  const result = evaluateOutcome({ providers: providers([null, null, null]), weightsBps: weights(3),
    beginPrices: prices, endPrices: vector(110, 100, 100, 100),
    previousBook: { nav: 100000, weightsBps: vector(1000) },
    previousShadows: { p0: { nav: 100000, weightsBps: vector(2500), peakNav: 110000 } } });
  assert.equal(result.aggregate.status, 'SKIPPED');
  assert.equal(result.execution.cost, 0);
  assert.equal(result.book.nav, 101000);
  assert.equal(result.providerResults[0].status, 'MISSED');
  assert.equal(result.providerResults[0].cost, 37.5);
  assert.equal(result.providerResults[0].shadowBook.nav, 99962.5);
  assert.deepEqual(result.providerResults[0].shadowBook.weightsBps, vector());
  assert.equal(result.providerResults[0].predictionIC, null);
  assert.equal(result.providerResults[0].hitRate, null);
  assert.equal(result.providerResults[0].predictionAssetCount, 0);
  assert.equal(result.providerResults[0].directionalAssetCount, 0);
  assert.ok(result.providerResults.every((provider) => provider.marginalContributionBps === 0));
});

test('LOO starts from the same existing book and preserves other frozen weights', () => {
  const result = evaluateOutcome({ providers: providers([vector(10000), vector(-5000), vector()]), weightsBps: weights(3),
    beginPrices: prices, endPrices: vector(110, 100, 100, 100),
    previousBook: { nav: 100000, weightsBps: vector(500) } });
  // Full book 5% BTC: +50 bps and no turnover. Without p0: -5% BTC,
  // +1000 bps turnover -> -50 -1.5 bps. Without p1: 10% BTC,
  // +500 bps turnover -> +100 -0.75 bps.
  assert.equal(result.book.netReturnBps, 50);
  assert.equal(result.providerResults[0].marginalContributionBps, 101.5);
  assert.equal(result.providerResults[1].marginalContributionBps, -49.25);
  assert.equal(result.providerResults[2].marginalContributionBps, 0);
  assert.deepEqual(result.rewardPreview.credits, { p0: 10000, p1: 0, p2: 0 });
});

test('reward credits are integer, positive-only, and never exceed the fixed pool', () => {
  const result = evaluateOutcome({ providers: providers([vector(10000), vector(9000), vector(8000), vector(-1000)]),
    weightsBps: weights(4), beginPrices: prices, endPrices: vector(110, 100, 100, 100), rewardPoolUnits: 17 });
  assert.ok(Object.values(result.rewardPreview.credits).every((credit) => Number.isInteger(credit) && credit >= 0));
  assert.ok(result.rewardPreview.allocatedUnits <= 17);
  assert.equal(result.rewardPreview.credits.p3, 0);
  assert.equal(result.rewardPreview.allocatedUnits + result.rewardPreview.unallocatedUnits, 17);
});

test('subsequent epochs rebalance against drifted weights, not the old target', () => {
  const inputs = { providers: providers([vector(10000), vector(10000), vector(10000)]), weightsBps: weights(3) };
  const first = evaluateOutcome({ ...inputs, beginPrices: prices, endPrices: vector(110, 100, 100, 100) });
  const second = evaluateOutcome({ ...inputs, beginPrices: vector(110, 100, 100, 100), endPrices: vector(110, 100, 100, 100),
    previousBook: first.book });
  assert.ok(second.execution.turnoverNotional > 1800);
  assert.ok(second.execution.orders.every((order) => order.side === 'SELL'));
});

test('between-epoch mark captures carry PnL and drift without turnover or costs', () => {
  const book = markBook({ nav: 100000, peakNav: 105000, weightsBps: vector(2500, -1000) },
    prices, vector(110, 95, 100, 100));
  assert.equal(book.nav, 103000);
  assert.equal(book.cost, 0);
  assert.equal(book.turnoverBps, 0);
  assert.equal(book.peakNav, 105000);
  close(book.weightsBps.BTC, 27500 / 103000 * 10000);
  close(book.weightsBps.ETH, -9500 / 103000 * 10000);
  close(book.drawdownBps, (103000 / 105000 - 1) * 10000);
});

test('shadow maximum drawdown retains a gap trough after interval recovery', () => {
  const beforeGap = { nav: 100000, peakNav: 100000, weightsBps: vector(2500) };
  const marked = markBook(beforeGap, prices, vector(90, 100, 100, 100));
  assert.equal(marked.maxDrawdownBps, -250);
  const result = evaluateOutcome({ providers: providers([vector(10000), vector(10000), vector(10000)]),
    weightsBps: weights(3), beginPrices: vector(90, 100, 100, 100), endPrices: prices,
    previousShadows: { p0: marked } });
  assert.ok(result.providerResults[0].shadowBook.nav > 100000);
  assert.equal(result.providerResults[0].drawdownBps, 0);
  assert.equal(result.providerResults[0].maxDrawdownBps, -250);
});

test('inputs are not mutated and identical inputs produce identical outcomes', () => {
  const inputs = { providers: providers([vector(5000), vector(-1000), vector(2000)]), weightsBps: weights(3),
    beginPrices: prices, endPrices: vector(110, 95, 100, 105) };
  const before = JSON.stringify(inputs);
  assert.deepEqual(evaluateOutcome(inputs), evaluateOutcome(inputs));
  assert.equal(JSON.stringify(inputs), before);
});

test('invalid negative, zero, missing, and nonfinite prices are rejected', () => {
  for (const badPrice of [-1, 0, NaN, Infinity, undefined]) {
    assert.throws(() => evaluateOutcome({ providers: providers([vector(), vector(), vector()]), weightsBps: weights(3),
      beginPrices: prices, endPrices: vector(badPrice, 100, 100, 100) }));
  }
  assert.throws(() => planExecution({ targetBps: vector(), nav: -1, prices }));
});

test('extreme synthetic short loss is explicitly bankrupt and cannot manufacture negative holdings', () => {
  const result = evaluateOutcome({ providers: providers([vector(-10000), vector(-10000), vector(-10000)]), weightsBps: weights(3),
    beginPrices: prices, endPrices: vector(1000, 100, 100, 100) });
  assert.equal(result.book.nav, 0);
  assert.equal(result.book.bankrupt, true);
  assert.ok(result.book.lossBeyondCapital > 0);
  assert.equal(result.book.netReturnBps, -10000);
  assert.deepEqual(result.book.weightsBps, vector());
});
