import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecision } from '../lib/decision.js';

const MD = `| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (Searah Bias) | 3617.45 - 3631.20 | 3608.71 | 3675.14 | 3689.62 | x |
| BUY Zona 2 - Intraday (Searah Bias) | 3614.73 - 3627.55 | 3608.41 | 3675.94 | 3689.62 | x |

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Buy Limit Zona 1 (Scalping) | 3631.20 | 3608.71 | 3675.14 | 22.49 | 0.01 | $22.49 | 1:1.9 | x |
| Buy Limit Zona 2 (Intraday) | 3627.55 | 3608.41 | 3675.94 | 19.14 | 0.01 | $19.14 | 1:2.53 | x |
`;

test('bias H4/H1 melawan D1 & W1 -> peringatan + htfConflict', () => {
  const d = buildDecision({ markdown: MD, bias: 'BULLISH', htf: { D1: 'BEARISH', W1: 'BEARISH' }, atrM5: 6.37 });
  assert.equal(d.htfConflict, true);
  assert.ok(d.warnings.some((w) => /MELAWAN D1 & W1/.test(w)));
  assert.match(d.text, /pullback melawan tren besar/);
});

test('bias searah D1/W1 -> tanpa peringatan HTF', () => {
  const d = buildDecision({ markdown: MD, bias: 'BULLISH', htf: { D1: 'BULLISH', W1: 'BULLISH' }, atrM5: 0 });
  assert.equal(d.htfConflict, false);
  assert.ok(!d.warnings.some((w) => /MELAWAN/.test(w)));
});

test('zona Scalping dengan SL > 3x ATR M5 diberi peringatan, Intraday tidak', () => {
  const d = buildDecision({ markdown: MD, bias: 'BULLISH', htf: {}, atrM5: 6.37 });
  assert.ok(d.warnings.some((w) => /Zona 1 \(Scalping\).*22\.49.*3\.5× ATR M5/.test(w)), d.warnings.join('|'));
  assert.ok(!d.warnings.some((w) => /Zona 2 \(Scalping\)/.test(w)));
});
