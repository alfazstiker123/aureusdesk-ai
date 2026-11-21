import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSmcReport } from '../lib/smc/engine.js';

function makeBars() {
  const raw = [
    [10, 11, 9, 10], [10, 12, 9, 11], [11, 15, 10, 12], [12, 13, 10, 11], [11, 12, 9, 10],
    [10, 11, 8, 9], [9, 15.8, 8.5, 14.5], [14.5, 14.8, 12.5, 13.2],
    [13.2, 14, 12, 12.8], [12.8, 17, 12.5, 16],
  ];
  for (let i = 0; i < 22; i++) raw.push([16 + (i % 2) * 0.1, 16.8, 15.4, 16.2]);
  return raw.map((x, i) => ({ time: 1_700_000_000 + i * 3600, open: x[0], high: x[1], low: x[2], close: x[3] }));
}

test('detects confirmed bullish BOS from a close through a confirmed swing high', () => {
  const report = buildSmcReport({ H1: makeBars() });
  const h1 = report.analyses.find((x) => x.timeframe === 'H1');
  assert.ok(h1, 'H1 analysis exists');
  assert.ok(h1.atr14 > 0, 'ATR(14) is calculated from OHLC');
  assert.ok(h1.structureEvents.some((e) => e.type === 'BOS' && e.direction === 'BULLISH'), JSON.stringify(h1.structureEvents));
});

test('does not mark the pre-break impulse as OB mitigation', () => {
  const report = buildSmcReport({ H1: makeBars() });
  const h1 = report.analyses.find((x) => x.timeframe === 'H1');
  assert.ok(h1.orderBlocks.length > 0, 'OB should be found');
  assert.ok(h1.orderBlocks.some((ob) => ob.status === 'FRESH'), JSON.stringify(h1.orderBlocks));
});

test('returns stable analysis for equal-high plateaus without throwing', () => {
  const bars = makeBars();
  bars[12].high = bars[11].high;
  const report = buildSmcReport({ H1: bars });
  assert.equal(report.analyses[0].status, 'OK');
});
