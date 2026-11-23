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

test('engine: support utuh memakai harga live (M5), bukan close TF tinggi', () => {
  const mk = (n, step, base) => Array.from({ length: n }, (_, i) => { const p = base + Math.sin(i / 3) * 5 + (i % 7); return { time: 1_700_000_000 + i * step, open: p, high: p + 3, low: p - 3, close: p + 1 }; });
  const w1 = mk(60, 604800, 100);
  const m5 = mk(60, 300, 100); m5[m5.length - 1] = { ...m5.at(-1), close: 50, low: 49, high: 60, open: 58 }; // live jauh di bawah
  const rep = buildSmcReport({ W1: w1, M5: m5 });
  const a = rep.analyses.find((x) => x.timeframe === 'W1');
  assert.equal(a.refPrice, 50);
  assert.ok(a.supports.every((x) => x.price < 50));
});

import { zoneEntry } from '../lib/smc/engine.js';
test('zoneEntry: zona lebar -> entry mulai 50%, SL di luar zona + zona tetangga distal', () => {
  const c = zoneEntry('SELL', { low: 56736.5, high: 58480.8 }, 750, 1000, [{ low: 56964.1, high: 58155 }]);
  assert.ok(Math.abs(c.entryLo - 57608.65) < 0.01);
  assert.ok(c.sl > 58480.8);
  const b = zoneEntry('BUY', { low: 100, high: 110 }, 50, 20);
  assert.equal(b.entryLo, 100); assert.ok(b.sl < 100);
});
test('zoneEntry: SL tidak tertinggal di dalam OB searah di atasnya', () => {
  const c = zoneEntry('SELL', { low: 59757.6, high: 61281.3 }, 750, 1000, [{ low: 61281.3, high: 61740.2 }, { low: 61201, high: 61913 }]);
  assert.ok(c.sl > 61913, `SL ${c.sl}`);
});

test('priceDec: BTC 1, emas 2, JPY 3, forex 5 (pembulatan tidak membuang digit)', async () => {
  const { priceDec, roundTo } = await import('../lib/smc/fmt.js');
  assert.equal(priceDec(56000), 1);
  assert.equal(priceDec(3600.23), 2);
  assert.equal(priceDec(155.432), 3);
  assert.equal(priceDec(48.123), 3);
  assert.equal(priceDec(1.08123), 5);
  assert.equal(roundTo(155.4326, priceDec(155.4)), 155.433);
});

test('fixWeekendExpiry: order akhir pekan digeser ke sesi buka Senin (Scalping +2j, Intraday +6j, Swing = Daily Close)', async () => {
  const { fixWeekendExpiry, dailyCloseAfter } = await import('../lib/weekendExpiry.js');
  const md = [
    '> - ⏳ Masa Berlaku Sinyal: Zona 1 (Scalping) valid hingga 16:19 WIB; Zona 3 (Swing) hingga Daily Close Minggu 05:00 WIB',
    '',
    '| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |',
    '|---|---|---|---|---|---|---|---|---|',
    '| Sell Limit Zona 1 (Scalping Resistance M15) | 1.0975 | 1.0990 | 1.0945 | 0.00150 | 0.03 | $4.50 | 1:2.00 | 21 Nov 2026, 16:19 WIB |',
    '| Sell Limit Zona 2 (Intraday Supply H1) | 1.0995 | 1.1020 | 1.0945 | 0.00250 | 0.03 | $7.50 | 1:2.00 | 21 Nov 2026, 20:19 WIB |',
    '| Sell Limit Zona 3 (Swing Supply H4) | 1.1060 | 1.1095 | 1.0930 | 0.00350 | 0.03 | $10.50 | 1:3.71 | 22 Nov 2026, 05:00 WIB |',
    '| Buy Limit Zona 1 (Scalping) | Tidak ada level valid (tunggu) | - | - | - | - | - | - | - |',
  ].join('\n');
  const sat = new Date(Date.UTC(2026, 10, 21, 7, 28)); // Sabtu 14:28 WIB
  const r = fixWeekendExpiry(md, sat, { id: 'EURUSD' });
  assert.equal(r.changed, 3);
  assert.match(r.markdown, /\| 23 Nov 2026, 07\.00 WIB \|/, 'Scalping: buka forex Senin 05:00 + 2 jam');
  assert.match(r.markdown, /\| 23 Nov 2026, 11\.00 WIB \|/, 'Intraday: buka + 6 jam');
  assert.match(r.markdown, /\| 24 Nov 2026, 05\.00 WIB \|/, 'Swing: Daily Close Selasa 05:00 WIB');
  assert.match(r.markdown, /MAPPING AKHIR PEKAN — pasang order setelah pasar buka 23 Nov 2026, 05\.00 WIB/);
  const g = fixWeekendExpiry(md, sat, { id: 'XAUUSD', group: 'gold' });
  assert.match(g.markdown, /pasar buka 23 Nov 2026, 06\.00 WIB/, 'emas CME buka 18:00 NY');
  assert.match(g.markdown, /\| 23 Nov 2026, 08\.00 WIB \|/);
  assert.ok(!/16:19 WIB/.test(r.markdown));
  // BTC (24 jam) dan hari kerja tidak diubah
  assert.equal(fixWeekendExpiry(md, sat, { id: 'BTCUSD', open24x7: true }).changed, 0);
  assert.equal(fixWeekendExpiry(md, new Date(Date.UTC(2026, 10, 24, 7, 28)), { id: 'EURUSD' }).changed, 0);
  // expiry yang sudah setelah buka dibiarkan
  const ok = md.replace('21 Nov 2026, 16:19 WIB', '23 Nov 2026, 09:00 WIB');
  assert.equal(fixWeekendExpiry(ok, sat, { id: 'EURUSD' }).changed, 2);
  assert.ok(dailyCloseAfter(Date.UTC(2026, 10, 23, 6, 0)) === Date.UTC(2026, 10, 23, 22, 0));
});

test('buildSmcReport: minFvgAtr membuang FVG mikro (forex)', () => {
  const bars = Array.from({ length: 60 }, (_, i) => {
    const o = 1.1 - i * 0.0003;
    return { time: 1700000000 + i * 300, open: o, high: o + 0.0004, low: o - 0.0004, close: o - 0.0002 };
  });
  bars[40] = { ...bars[40], high: bars[41].low - 0.00001 + 0 }; // celah sangat tipis
  const a = buildSmcReport({ M5: bars }, { minFvgAtr: 0.08 }).analyses.find((x) => x.timeframe === 'M5');
  const b = buildSmcReport({ M5: bars }, { minFvgAtr: 5 }).analyses.find((x) => x.timeframe === 'M5');
  assert.ok(b.zones.filter((z) => z.source === 'FVG').length === 0);
  assert.ok(a.zones.filter((z) => z.source === 'FVG').length >= b.zones.filter((z) => z.source === 'FVG').length);
});

test('syncTargets: kolom TP 4B disamakan dengan TP1 Bagian 3', () => {
  const md = [
    '| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat |',
    '|---|---|---|---|---|---|',
    '| SELL Zona 1 - Scalping | 1.09625 - 1.09668 | 1.09685 | 1.09532 | 1.09390 | x |',
    '',
    '| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu |',
    '|---|---|---|---|---|---|---|---|---|',
    '| Sell Limit Zona 1 | 1.09625 | 1.09685 | 1.09450 | 0.00060 | 0.06 | $3.60 | 1:2.92 | x |',
  ].join('\n');
  const analyses = [{ status: 'OK', timeframe: 'H1', zones: [], supports: [], resistances: [] }];
  const r = syncTargets(md, { analyses, atrH1: 0.00155, price: 1.09560, priceRe: /\d+(?:\.\d+)?/ });
  const row4b = r.markdown.split('\n')[6];
  assert.ok(row4b.includes('| 1.09532 |'), row4b);
  assert.ok(!r.markdown.includes('1.09450'));
  assert.ok(r.notes.some((n) => /4B disamakan/.test(n)));
});

test('fixWeekendExpiry: baris Masa Berlaku ditulis ulang walau Waktu Berakhir sudah benar', async () => {
  const { fixWeekendExpiry } = await import('../lib/weekendExpiry.js');
  const md = [
    '> - ⏳ Masa Berlaku Sinyal: Scalping (buka + 2 jam), Swing (Daily Close Senin 05:00 WIB)',
    '',
    '| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |',
    '|---|---|---|---|---|---|---|---|---|',
    '| Sell Limit Zona 1 (Scalping) | 1.09625 | 1.09685 | 1.09450 | 0.00060 | 0.06 | $3.60 | 1:2.9 | 23 Nov 2026, 07:00 WIB |',
    '| Sell Limit Zona 3 (Swing) | 1.0986 | 1.10036 | 1.0930 | 0.00176 | 0.06 | $10.56 | 1:3.1 | 24 Nov 2026, 05:00 WIB |',
  ].join('\n');
  const r = fixWeekendExpiry(md, new Date(Date.UTC(2026, 10, 21, 8)), { id: 'EURUSD' });
  assert.equal(r.changed, 0);
  assert.match(r.markdown, /MAPPING AKHIR PEKAN/);
  assert.match(r.markdown, /Swing hingga 24 Nov 2026, 05.00 WIB/);
  assert.ok(!/Daily Close Senin/.test(r.markdown));
});

test('enforceSmcZones: nama timeframe (H4, M15) di Level Kunci tidak ikut diganti', () => {
  const md = [
    '| Timeframe | Struktur/Trend | Level Kunci | Catatan |',
    '|---|---|---|---|',
    '| H4 | BEARISH | 1.09678 (OB Bearish H4) | x |',
    '| M15 | BEARISH | 1.09704 (OB Bearish M15), 1.0950 | y |',
  ].join('\n');
  const mk = (tf) => ({ status: 'OK', timeframe: tf, structureEvents: [{ level: 1.09678 }], swings: [], zones: [{ low: 1.09704, high: 1.09806 }], supports: [], resistances: [] });
  const r = enforceSmcZones(md, { analyses: [mk('H4'), mk('M15')], atrH1: 0.00155, price: 1.09662, priceRe: /\d+(?:\.\d+)?/ });
  assert.match(r.markdown, /OB Bearish H4\)/);
  assert.match(r.markdown, /OB Bearish M15\)/);
  assert.ok(!/OB Bearish H1\)|OB Bearish M1\)/.test(r.markdown));
  assert.ok(!/\d,\d{3}/.test(r.markdown));
});

test('syncTargets: TP1 = harga sekarang diganti level struktur (kasus BUY Z1 audit)', () => {
  const md = [
    '| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat |',
    '|---|---|---|---|---|---|',
    '| BUY Zona 1 - Scalping (Searah Bias) | 3617.45 - 3631.20 | 3608.71 | 3665.67 | 3679.17 | x |',
  ].join('\n');
  const analyses = [{ status: 'OK', timeframe: 'M15', zones: [], supports: [], resistances: [{ price: 3675.14 }, { price: 3675.94 }, { price: 3689.62 }] }];
  const r = syncTargets(md, { analyses, atrH1: 20.37, price: 3665.67, priceRe: /\d+(?:\.\d+)?/ });
  const tp1 = Number(r.markdown.split('\n')[2].split('|')[4]);
  assert.notEqual(tp1, 3665.67);
  assert.ok(tp1 > 3668 && tp1 <= 3675.14, `TP1 ${tp1}`);
  assert.ok(r.markdown.includes('3608.71') && r.markdown.includes('3617.45 - 3631.20'));
});

test('enforceSmcZones: tepi bersama dua rentang Level Kunci tidak meninggalkan "-" menggantung', () => {
  const md = [
    '| Timeframe | Struktur/Trend | Level Kunci | Catatan |',
    '|---|---|---|---|',
    '| M15 | BULLISH | 3614.73-3627.55 (OB Bullish M15 fresh); 3627.55-3645.89 (FVG Bullish M15 fresh) | x |',
  ].join('\n');
  const a = { status: 'OK', timeframe: 'M15', structureEvents: [], swings: [], zones: [{ low: 3614.73, high: 3627.55 }, { low: 3627.55, high: 3645.89 }], supports: [], resistances: [] };
  const r = enforceSmcZones(md, { analyses: [a], atrH1: 20.37, price: 3665.67, priceRe: /\d+(?:\.\d+)?/ });
  assert.ok(!/;\s*-\d/.test(r.markdown), r.markdown);
  assert.match(r.markdown, /3627\.55-3645\.89/);
});
