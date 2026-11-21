import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceSmcZones } from '../lib/smc/guard.js';
import { buildZoneCandidates } from '../lib/smc/engine.js';

const analyses = [{ timeframe: 'H1', status: 'OK', zones: [
  { type: 'BEARISH', low: 59757.6, high: 61281.3, source: 'FVG' },
  { type: 'BEARISH', low: 61201, high: 61913, source: 'ORDER_BLOCK' } ] }];
const md = `| Zona & Strategi | Zona Entry | Stop Loss (SL) | TP1 | TP2 | Syarat |
|---|---|---|---|---|---|
| BUY Zona 1 - Intraday | 57,800.00 - 58,000.00 | 57,500.00 | 58,600.00 | 59,200.00 | x |
| SELL Zona 1 - Intraday | 59,757.60 - 60,500.00 | 61,000.00 | 58,500.00 | 57,200.00 | x |

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 1 (Intraday) | 59,757.60 | 61,200.00 | 57,500.00 | 1442.40 | 0.01 | $14.42 | 1:1.57 | 21 Nov 2026, 14:12 WIB |
| Buy Limit Zona 1 (Intraday) | 57,800.00 | 57,500.00 | 58,600.00 | 300.00 | 0.09 | $27.00 | 1:2 | 21 Nov 2026, 14:12 WIB |

**Rincian Hitung Risiko:**
- Sell Limit Zona 1: 0.01 lot x 1442.40 x 1 = $14.42
- Buy Limit Zona 1: 0.09 lot x 300.00 x 1 = $27.00
`;
test('order di luar zona SMC dibatalkan, SL disinkronkan', () => {
  const r = enforceSmcZones(md, { analyses, atrH1: 864, price: 58265, priceRe: /\d{2,6}(?:\.\d+)?/ });
  assert.match(r.markdown, /Tidak ada level valid \(tunggu\)/);
  assert.match(r.markdown, /Tidak Ada Setup \(Tunggu\)/);
  assert.match(r.markdown, /Buy Limit Zona 1: tidak ada order/);
  assert.match(r.markdown, /Sell Limit Zona 1: 0\.01 lot/);
  assert.match(r.markdown, /\| SELL Zona 1 - Intraday \| 59,757\.60 - 60,500\.00 \| 61,200\.00 \|/); // SL B3 = 4B
  assert.ok(r.notes.some((n) => /BUY: tidak ada zona valid → WAIT/.test(n)));
});
test('kandidat: tanpa zona raksasa, Z1 dekat, Buy kosong', () => {
  const an = [
    { timeframe: 'M15', status: 'OK', zones: [{ type: 'BEARISH', low: 58609.4, high: 58810, source: 'FVG' }] },
    { timeframe: 'M5', status: 'OK', zones: [{ type: 'BEARISH', low: 58656.6, high: 58810, source: 'FVG' }] },
    ...analyses,
  ];
  const r = buildZoneCandidates(an, 58265, { z1: [518, 2160], z2: [1222, 3667] }, 864);
  assert.equal(r.res.SELL.z1.low, 58609.4);
  assert.ok(r.res.SELL.z2.entryHi - r.res.SELL.z2.entryLo <= 0.75 * 864 + 1);
  assert.equal(r.res.BUY.z1, null);
  assert.match(r.text, /BUY: WAIT/);
});

import { syncTargets } from '../lib/smc/guard.js';
import { buildSmcReport } from '../lib/smc/engine.js';

test('syncTargets: TP1 yang hampir di harga diganti (R:R >= 1.5), entry/SL tetap', () => {
  const md = [
    '| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat |',
    '|---|---|---|---|---|---|',
    '| SELL Zona 2 - Intraday | 56964.10 - 57691.60 | 58031.10 | 56000.00 | 55000.00 | x |',
    '',
    '| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu |',
    '|---|---|---|---|---|---|---|---|---|',
    '| Sell Limit Zona 2 | 56964.10 | 58031.10 | 56000.00 | 1067.00 | 0.01 | $10.67 | 1:0.90 | x |',
  ].join('\n');
  const analyses = [{ status: 'OK', timeframe: 'H1', zones: [], supports: [{ price: 52000 }], resistances: [] }];
  const r = syncTargets(md, { analyses, atrH1: 970, price: 56009, priceRe: /\d+(?:\.\d+)?/ });
  assert.ok(r.markdown.includes('58031.10'));
  assert.ok(!r.markdown.includes('| 56000.00 |'));
  const tp = Number(r.markdown.split('\n')[6].split('|')[4]);
  assert.ok(56964.1 - tp >= 1.5 * 1066.99, `TP ${tp}`);
  assert.equal(r.notes.length, 1);
});

test('engine: MN dianalisis dan support swing utuh terdeteksi', () => {
  const bars = [];
  let t = 1_600_000_000;
  const path = [10, 12, 15, 13, 11, 14, 18, 22, 19, 16, 20, 25, 30, 27, 23, 26, 33, 38, 34, 29, 24, 28, 31, 26, 22];
  path.forEach((p, i) => { bars.push({ time: t + i * 2_592_000, open: p, high: p + 2, low: p - 2, close: p + (i % 2 ? 1 : -1) }); });
  const rep = buildSmcReport({ MN: bars });
  const mn = rep.analyses.find((a) => a.timeframe === 'MN');
  assert.equal(mn.status, 'OK');
  assert.ok(Array.isArray(mn.supports));
  assert.ok(mn.supports.every((s) => s.price < mn.lastPrice));
  assert.match(rep.compactBlock, /Support swing utuh/);
});
