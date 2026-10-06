import test from 'node:test';
import assert from 'node:assert/strict';
import { signal, closedPrices, nextRun } from '../scripts/mean-reversion.mjs';

test('enter below threshold, hold until mean recovery, then exit', () => {
  assert.equal(signal([...Array(19).fill(100), 97], false), true);
  assert.equal(signal([...Array(19).fill(100), 99], false), false);
  assert.equal(signal([...Array(19).fill(100), 99], true), true);
  assert.equal(signal([...Array(19).fill(100), 100], true), false);
  assert.throws(() => signal([100, NaN], true));
});

test('only completed contiguous daily candles are accepted', () => {
  const d = 86400000, now = 10 * d + 300000;
  const row = i => [i * d, 0, 0, 0, '100', 0, (i + 1) * d - 1];
  assert.deepEqual(closedPrices([row(8), row(9), row(10)], now, 2), [100, 100]);
  assert.throws(() => closedPrices([row(7), row(9)], now, 2));
  assert.throws(() => closedPrices([row(7), row(8)], now, 2));
});

test('schedule rolls across UTC midnight and rejects invalid times', () => {
  const now = Date.parse('2026-10-06T23:59:00Z');
  assert.equal(nextRun(now, '00:05'), Date.parse('2026-10-07T00:05:00Z'));
  assert.throws(() => nextRun(now, '24:00'));
});
