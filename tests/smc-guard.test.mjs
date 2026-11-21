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
