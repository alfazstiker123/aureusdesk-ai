import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentSection, parseMeta, priceNumbers } from '../lib/zoneParse.js';

const SEC3 = `### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)
| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| **BUY Zona 1 - Scalping (Demand M5)** | Tidak ada level valid (tunggu) | - | - | - | - |
| SELL Zona 1 - Scalping (OB M15) (Searah Bias) | 1.09755 - 1.09798 | 1.09835 | 1.09650 | 1.09550 | Rejection wick di M5 |
| SELL Zona 3 - Swing | 3,584.74 - 3,590.10 | 3,600.00 | 3,570.00 | 3,550.00 | CHoCH |
`;

test('segmentSection mengubah tabel Bagian 3 menjadi baris zona', () => {
  const segs = segmentSection(SEC3);
  const ex = segs.find((s) => s.type === 'exec');
  assert.ok(ex);
  assert.equal(ex.rows.length, 3);
  assert.equal(ex.rows[0].valid, false);
  assert.equal(ex.rows[1].side, 'SELL');
  assert.equal(ex.rows[1].zone, 1);
  assert.equal(ex.rows[1].low, 1.09755);
  assert.equal(ex.rows[1].high, 1.09798);
  assert.equal(ex.rows[1].slVal, 1.09835);
  assert.equal(ex.rows[2].low, 3584.74);
  assert.equal(ex.rows[2].tp2Val, 3550);
});

test('tabel 4B dikenali sebagai pending, termasuk baris tanpa setup', () => {
  const md = `| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 1 (Scalping) | 1.09755 | 1.09835 | 1.09650 | 0.00080 | 0.07 | $5.60 | 1:1.31 | 23 Nov 07:00 WIB |
| Buy Limit Zona 1 | Tidak Ada Setup (Tunggu) | - | - | - | - | - | - | - |`;
  const p = segmentSection(md).find((s) => s.type === 'pending');
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].valid, true);
  assert.equal(p.rows[0].lot, '0.07');
  assert.equal(p.rows[1].valid, false);
  assert.match(p.rows[1].note, /Tidak Ada Setup/);
});

test('tabel lain tetap tabel biasa', () => {
  const md = `| Jam | Event |\n|---|---|\n| 19:30 | NFP |`;
  assert.equal(segmentSection(md)[0].type, 'table');
});

test('parseMeta membaca bias, pair, harga', () => {
  const m = parseMeta('**BIAS UTAMA:** BEARISH - FOKUS SELL\n\n**PAIR:** EURUSD\n\n**HARGA TERAKHIR:** 1.09720\n\n**ATR:** H1 0.00042 | H4 0.0011');
  assert.equal(m.bias, 'BEARISH - FOKUS SELL');
  assert.equal(m.pair, 'EURUSD');
  assert.equal(m.price, 1.0972);
  assert.match(m.atr, /H1/);
});

test('priceNumbers mengabaikan angka zona tanpa desimal', () => {
  assert.deepEqual(priceNumbers('Zona 1 1.2345').map((n) => n.raw), ['1.2345']);
});
