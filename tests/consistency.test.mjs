import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveBias, syncHeadlineBias, syncBiasLabels, syncTfBias, syncLevelLabels, syncSummaryLevels, syncExpiry, describeLevel } from '../lib/consistency.js';

// riskCheck.js memakai alias '@/lib/*'; salin ke folder sementara dengan path relatif agar bisa diuji tanpa bundler.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-'));
for (const f of ['riskCheck.js', 'pairs.js', 'marketTime.js']) {
  fs.writeFileSync(path.join(tmp, f), fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8').replace(/'@\/lib\/([\w]+)'/g, "'./$1.js'"));
}
const { verifyRiskTables } = await import(pathToFileURL(path.join(tmp, 'riskCheck.js')).href);
const { PAIRS } = await import(pathToFileURL(path.join(tmp, 'pairs.js')).href);

const S3 = `| Zona & Strategi | Zona Entry | Stop Loss (SL) | TP1 | TP2 | Syarat |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (Demand M5) (Counter-Trend) | 3603.11 - 3606.59 | 3599.50 | 3615.00 | 3620.00 | x |
| BUY Zona 2 - Intraday (FVG M15) (Searah Bias) | 3577.48 - 3583.86 | 3574.00 | 3600.00 | 3612.00 | x |
| SELL Zona 1 - Scalping (...) | Tidak ada level valid (tunggu) | - | - | - | - |
| SELL Zona 2 - Intraday (FVG H1) (Searah Bias) | 3656.82 - 3661.30 | 3665.00 | 3635.00 | 3620.00 | x |
`;

test('label Searah/Counter-Trend ditentukan server dari bias, bukan Gemini', () => {
  const r = syncBiasLabels(S3, 'BEARISH');
  assert.match(r.markdown, /BUY Zona 2 - Intraday \(FVG M15\) \(Counter-Trend - Wajib Konfirmasi Ekstra\) \|/);
  assert.match(r.markdown, /BUY Zona 1 - Scalping \(Demand M5\) \(Counter-Trend - Wajib Konfirmasi Ekstra\) \|/);
  assert.match(r.markdown, /SELL Zona 2 - Intraday \(FVG H1\) \(Searah Bias\) \|/);
  assert.doesNotMatch(r.markdown, /BUY Zona 2[^|]*Searah Bias/);
  assert.ok(r.changed >= 2);
  const bull = syncBiasLabels(S3, 'BULLISH');
  assert.match(bull.markdown, /SELL Zona 2 - Intraday \(FVG H1\) \(Counter-Trend/);
  assert.match(syncBiasLabels(S3, 'NETRAL').markdown, /\(Netral - Tunggu Konfirmasi\)/);
});

test('bias headline: mesin menang bila bertentangan', () => {
  assert.deepEqual(resolveBias('BEARISH - FOKUS SELL', 'BEARISH'), { bias: 'BEARISH', overridden: false, headline: 'BEARISH' });
  const x = resolveBias('BULLISH - FOKUS BUY', 'BEARISH');
  assert.equal(x.bias, 'BEARISH');
  assert.ok(x.overridden);
  assert.equal(resolveBias('NETRAL - WAIT & SEE', 'BEARISH').bias, 'BEARISH');
  assert.match(syncHeadlineBias('**BIAS UTAMA:** BULLISH - FOKUS BUY\n', 'BEARISH'), /BEARISH - FOKUS SELL/);
});

const AN = [
  { timeframe: 'M15', status: 'OK', bias: 'BEARISH', liveNote: 'harga live ... CHoCH bullish', lastPrice: 3616, structureEvents: [], swings: [], zones: [], supports: [], resistances: [] },
  { timeframe: 'M5', status: 'OK', bias: 'BULLISH', lastPrice: 3620, structureEvents: [], swings: [], zones: [], supports: [], resistances: [] },
  { timeframe: 'H1', status: 'OK', bias: 'BULLISH', lastPrice: 3612, structureEvents: [], swings: [], zones: [], supports: [], resistances: [] },
  { timeframe: 'W1', status: 'OK', bias: 'BEARISH', lastPrice: 3579, structureEvents: [{ type: 'BOS', direction: 'BULLISH', level: 3435.48, time: 1 }],
    swings: [{ type: 'L', price: 3302.73 }], zones: [], supports: [], resistances: [] },
];
const S2 = `| Timeframe | Struktur/Trend | Level Kunci | Catatan |
|---|---|---|---|
| W1 | Bearish | $3435.48 (Low mingguan) | Tekanan jual |
| D1 | Bearish | $3620.99 (Harga saat ini) | Konsolidasi |
| H1 | Bullish (Korektif) | 3656.82 | Koreksi |
| M15 | Bullish | 3577.48 | Pantulan |
| M5 | Sideways/Range | 3603.11 | Range |
`;

test('bias TF dan nama Level Kunci mengikuti mesin SMC', () => {
  const a = syncTfBias(S2, AN);
  assert.match(a.markdown, /\| M15 \| Bearish \(harga live menembus swing; menunggu close candle\) \|/);
  assert.match(a.markdown, /\| M5 \| Bullish \|/);
  assert.match(a.markdown, /\| H1 \| Bullish \(Korektif\) \|/); // searah mesin: tidak disentuh
  const b = syncLevelLabels(S2, AN, 3620.99);
  assert.match(b.markdown, /\$3435\.48 \(BOS Bullish W1\)/);
  assert.doesNotMatch(b.markdown, /Low mingguan/);
  assert.match(b.markdown, /\| D1 \| Bearish \| — \(TF ini tidak dihitung mesin SMC\) \|/);
  assert.equal(describeLevel(AN[3], 3302.73, 1), 'Swing Low W1');
});

const NOW = new Date('2026-11-23T13:28:00Z'); // 20:28 WIB, Senin (pasar buka)
const S4B = `| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 2 (Intraday) | 3656.82 | 3665.00 | 3635.00 | 8.18 | 0.02 | $16.36 | 1:2.67 | 23 Nov 2026, 22:28 WIB |
| Buy Limit Zona 1 (Scalping) | 3603.11 | 3599.50 | 3615.00 | 3.61 | 0.01 | $3.61 | 1:3.29 | 23 Nov 2026, 22:28 WIB |
| Buy Limit Zona 2 (Intraday) | 3583.86 | 3574.28 | 3600.00 | 9.58 | 0.01 | $9.58 | 1:1.68 | 24 Nov 2026, 02:28 WIB |
| Buy Limit Zona 3 (Swing) | 3553.97 | 3539.96 | 3575.00 | 14.01 | 0.01 | $14.01 | 1:1.50 | 24 Nov 2026, 05:00 WIB |

> - ⏳ Masa Berlaku Sinyal: Zona 1 valid 1-2 jam hingga pukul 22:28 WIB; Zona 2 valid hingga 4-6 jam ke depan (03:10 WIB); Zona 3 (Swing) valid hingga Daily Close pukul 05:00 WIB.
`;

test('expiry konsisten per tipe zona; ringkasan memakai jam 4B', () => {
  const r = syncExpiry(S4B, NOW, PAIRS.XAUUSD);
  assert.match(r.markdown, /\| Sell Limit Zona 2 \(Intraday\) .* 24 Nov 2026, 02\.28 WIB \|/s); // dulu 22:28 (durasi Scalping)
  assert.match(r.markdown, /Zona 1 valid 1-2 jam hingga pukul 22:28 WIB/);
  assert.match(r.markdown, /\(02:28 WIB\)/); // ringkasan 03:10 -> 02:28
  assert.match(r.markdown, /Zona 3 \(Swing\) valid hingga Daily Close pukul 05:00 WIB/);
  assert.equal(r.changed, 1);
});

test('expiry tidak disentuh saat pasar emas tutup akhir pekan', () => {
  const sat = new Date('2026-11-21T10:00:00Z');
  assert.equal(syncExpiry(S4B, sat, PAIRS.XAUUSD).markdown, S4B);
});

const RISK = `| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Buy Limit Zona 1 (Scalping) | 3603.11 | 3599.50 | 3615.00 | 3.61 | 0.01 | $3.61 | 1:3.29 | 23 Nov 2026, 22:28 WIB |
| Buy Limit Zona 2 (Intraday) | 3583.86 | 3574.28 | 3600.00 | 3.48 | 0.02 | $6.96 | 1:2 | 24 Nov 2026, 02:28 WIB |
| Buy Limit Zona 3 (Swing) | 3553.97 | 3539.96 | 3575.00 | 4.16 | 0.02 | $8.32 | 1:2.5 | 24 Nov 2026, 05:00 WIB |

**Rincian Hitung Risiko:**
- Buy Limit Zona 1 (Scalping): 0.01 x 3.61 x 100 = $3.61
- Buy Limit Zona 2 (Intraday): 0.02 x 3.48 x 100 = $6.96
- Buy Limit Zona 3 (Swing): 0.02 x 4.16 x 100 = $8.32
`;

test('risiko: satu sumber angka; order zona terjauh tidak dipasang bila total > batas', () => {
  const r = verifyRiskTables(RISK, 20, PAIRS.XAUUSD, NOW, { last: 3620.99, capPerDirection: true, zones: 3 });
  // Z3 dibatalkan oleh server (bukan sekadar catatan), Z1+Z2 = 3.61 + 9.58 = 13.19 <= 20
  assert.match(r.markdown, /\| Buy Limit Zona 3 \(Swing\) \| Tidak Ada Setup \(Batas Risiko: Tidak Dipasang\) \|/);
  assert.match(r.markdown, /Buy Limit Zona 3 \(Swing\): tidak ada order \(melebihi batas risiko\)/);
  assert.ok(r.notes.some((n) => /Buy Limit Zona 3 \(Swing\).*TIDAK DIPASANG/.test(n)));
  assert.ok(Math.abs(r.totals.BUY - 13.19) < 0.01);
  // catatan risiko tidak boleh menyebut lot lama (0.02) yang sudah diturunkan ke tabel
  const z2 = r.notes.filter((n) => n.startsWith('Buy Limit Zona 2'));
  assert.ok(z2.every((n) => !/0\.02 x/.test(n)), z2.join(' | '));
  assert.match(r.markdown, /\| Buy Limit Zona 2 \(Intraday\) \| 3583\.86 \| 3574\.28 \| 3600\.00 \| 9\.58 \| 0\.01 \| \$9\.58 \|/);
});

// ---- Fase 2: konfluensi zona ----
import { zoneConfluence, zoneWeight, buildZoneCandidates3 } from '../lib/smc/engine.js';
import { enforceSmcZones } from '../lib/smc/guard.js';

const Z = (tf, kind, low, high, w) => ({ tf, kind, low, high, type: 'BULLISH', w });

test('zona HTF sangat lebar tidak meminjamkan konfluensi; duplikat TF+jenis dihitung sekali', () => {
  const unit = 21.34; // ATR H1
  const small = Z('M15', 'FVG', 3577.48, 3583.86, 2);
  const huge = Z('H4', 'FVG', 3472.72, 3600.96, 4); // 128 poin = 6 ATR H1
  const dupe = Z('M15', 'FVG', 3578, 3584, 2);
  const h1 = Z('H1', 'OB', 3580, 3590, 3);
  const base = zoneConfluence(small, [small, huge], unit);
  assert.equal(base.score, 2);
  assert.deepEqual(base.mates, []);
  assert.equal(zoneConfluence(small, [small, dupe], unit).score, 2);
  const withH1 = zoneConfluence(small, [small, huge, dupe, h1], unit);
  assert.equal(withH1.score, 5); // M15 (2) + H1 (3); H4 lebar & duplikat M15 diabaikan
  assert.deepEqual(withH1.mates.map((m) => m.tf), ['H1']);
  // zona lebar sendiri diskalakan turun, tidak di bawah 35%
  assert.ok(zoneWeight(Z('H4', 'FVG', 0, 128, 4), unit) < 4 && zoneWeight(Z('H4', 'FVG', 0, 128, 4), unit) >= 4 * 0.35);
  assert.equal(zoneWeight(Z('H1', 'OB', 0, 20, 3), unit), 3);
});

test('kandidat 3 zona: "dasar" tidak memuat zona HTF lebar', () => {
  const an = [
    { timeframe: 'M15', status: 'OK', zones: [{ type: 'BULLISH', low: 3577.48, high: 3583.86, source: 'FVG' }] },
    { timeframe: 'H4', status: 'OK', zones: [{ type: 'BULLISH', low: 3480, high: 3600, source: 'FVG' }] }, // 120 poin = 5.6 ATR H1
  ];
  const r = buildZoneCandidates3(an, 3620.99, { z1: [2, 8], z2: [12, 54], z3: [50, 150] }, { h1: 21.34, m15: 5.95 });
  assert.ok(r.res.BUY[2]);
  assert.equal(r.res.BUY[2].src, 'M15 FVG'); // H4 FVG lebar tidak jadi konfluensi
  assert.equal(r.res.BUY[2].score, 2);
});

test('guard: "Dasar" yang ditulis model diganti bukti mesin (tanpa MN FVG lebar)', () => {
  const analyses = [
    { timeframe: 'M15', status: 'OK', zones: [{ type: 'BULLISH', low: 3577.48, high: 3583.86, source: 'FVG' }] },
    { timeframe: 'MN', status: 'OK', zones: [{ type: 'BULLISH', low: 3472.72, high: 3600.96, source: 'FVG' }] },
  ];
  const md = `| Zona & Strategi | Zona Entry | Stop Loss (SL) | TP1 | TP2 | Syarat Konfirmasi |
|---|---|---|---|---|---|
| BUY Zona 2 - Intraday (FVG M15) | 3577.48 - 3583.86 | 3574.28 | 3600.00 | 3612.00 | Engulfing bullish di M15 · Dasar: M15 FVG, MN FVG |
`;
  const r = enforceSmcZones(md, { analyses, atrH1: 21.34, price: 3620.99, priceRe: /\d{3,5}(?:\.\d+)?/ });
  assert.match(r.markdown, /Dasar: M15 FVG\s*\|/);
  assert.doesNotMatch(r.markdown, /MN FVG/);
  assert.ok(r.notes.some((n) => /"Dasar" disamakan/.test(n)));
});

// ---- Fase 3: keputusan server ----
import { buildDecision, insertDecision } from '../lib/decision.js';

const D3 = `| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (Demand M5) (Counter-Trend - Wajib Konfirmasi Ekstra) | 3603.11 - 3606.59 | 3599.50 | 3615.00 | 3620.00 | x |
| SELL Zona 2 - Intraday (FVG H1) (Searah Bias) | 3656.82 - 3661.30 | 3665.00 | 3635.00 | 3620.00 | x |
| SELL Zona 3 - Swing (FVG H4/OB) (Searah Bias) | 3701.76 - 3715.55 | 3720.00 | 3674.40 | 3650.00 | x |

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 2 (Intraday) | 3656.82 | 3665.00 | 3635.00 | 8.18 | 0.02 | $16.36 | 1:2.67 | 24 Nov 2026, 02:28 WIB |
| Sell Limit Zona 3 (Swing) | Sudah Terpasang (Lihat 4A) | - | - | - | - | - | - | - |
| Buy Limit Zona 1 (Scalping) | 3603.11 | 3599.50 | 3615.00 | 3.61 | 0.01 | $3.61 | 1:3.29 | 23 Nov 2026, 22:28 WIB |

**BIAS UTAMA:** BEARISH - FOKUS SELL
> **Ringkasan Cepat**
`;
const ZR = { SELL: { 2: { score: 5.55 }, 3: { score: 4 } }, BUY: { 1: { score: 1 } } };

test('keputusan: satu setup utama searah bias; countertrend hanya alternatif', () => {
  const d = buildDecision({ markdown: D3, bias: 'BEARISH', zoneRes: ZR, alignment: true });
  assert.equal(d.status, 'TRADE');
  assert.equal(d.primary.side, 'SELL');
  assert.equal(d.primary.zone, 2);
  assert.match(d.text, /SETUP UTAMA SELL Zona 2/);
  assert.match(d.text, /\(countertrend, konfirmasi ekstra\) BUY Zona 1/);
  assert.match(d.text, /bukan probabilitas profit/);
  // zona yang sudah terpasang dengan skor tertinggi boleh jadi utama, ditandai jelas
  const p = buildDecision({ markdown: D3, bias: 'BEARISH', zoneRes: { ...ZR, SELL: { 2: { score: 3 }, 3: { score: 9 } } } });
  assert.equal(p.primary.zone, 3);
  assert.match(p.text, /sudah terpasang/);
  assert.ok(buildDecision({ markdown: D3, bias: 'BEARISH', zoneRes: ZR, alignment: false }).warnings.length === 1);
});

test('keputusan: hanya countertrend, NO TRADE, dan bias netral', () => {
  const noSell = D3.replace(/^\| SELL Zona \d.*\n/gm, '').replace(/^\| Sell Limit.*\n/gm, '');
  const c = buildDecision({ markdown: noSell, bias: 'BEARISH', zoneRes: ZR });
  assert.equal(c.status, 'COUNTERTREND_ONLY');
  assert.equal(c.primary, null);
  assert.match(c.text, /HANYA COUNTERTREND/);
  const empty = noSell.replace(/^\| BUY Zona.*\n/gm, '| BUY Zona 1 - Scalping | Tidak ada level valid (tunggu) | - | - | - | - |\n').replace(/^\| Buy Limit.*\n/gm, '');
  const n = buildDecision({ markdown: empty, bias: 'BEARISH', zoneRes: ZR });
  assert.equal(n.status, 'NO_TRADE');
  assert.match(n.text, /⛔ \*\*KEPUTUSAN SERVER — NO TRADE/);
  assert.equal(buildDecision({ markdown: D3, bias: 'NETRAL', zoneRes: ZR }).status, 'NO_TRADE');
  // zona yang ordernya dibatalkan batas risiko tidak boleh jadi setup
  const dropped = D3.replace('| Sell Limit Zona 2 (Intraday) | 3656.82 |', '| Sell Limit Zona 2 (Intraday) | Tidak Ada Setup (Batas Risiko: Tidak Dipasang) |');
  assert.equal(buildDecision({ markdown: dropped, bias: 'BEARISH', zoneRes: ZR }).primary.zone, 3);
});

test('insertDecision: sebelum Ringkasan Cepat, tidak dobel saat dipanggil ulang', () => {
  const d = buildDecision({ markdown: D3, bias: 'BEARISH', zoneRes: ZR });
  const once = insertDecision(D3, d.text);
  assert.ok(once.indexOf('KEPUTUSAN SERVER') < once.indexOf('Ringkasan Cepat'));
  const twice = insertDecision(once, d.text);
  assert.equal((twice.match(/KEPUTUSAN SERVER/g) || []).length, 1);
});

// ---- Audit lanjutan: 4 celah ----
import { insufficientDecision, dataGap } from '../lib/decision.js';

test('Dasar: tanpa fallback ke zona lebar; W1/MN hanya konteks bias', () => {
  const md = `| Zona & Strategi | Zona Entry | Stop Loss (SL) | TP1 | TP2 | Syarat Konfirmasi |
|---|---|---|---|---|---|
| BUY Zona 2 - Intraday (FVG M15) | 3577.48 - 3583.86 | 3574.28 | 3600.00 | 3612.00 | Engulfing · Dasar: MN FVG |
`;
  const onlyWide = [{ timeframe: 'MN', status: 'OK', zones: [{ type: 'BULLISH', low: 3472.72, high: 3600.96, source: 'FVG' }] }];
  const r = enforceSmcZones(md, { analyses: onlyWide, atrH1: 21.34, price: 3620.99, priceRe: /\d{3,5}(?:\.\d+)?/ });
  assert.match(r.markdown, /Dasar: tidak ada bukti konfluensi presisi/);
  assert.doesNotMatch(r.markdown, /MN FVG/);
  // MN sempit pun tidak jadi bukti entry
  const narrowMn = [{ timeframe: 'MN', status: 'OK', zones: [{ type: 'BULLISH', low: 3577, high: 3590, source: 'FVG' }] }];
  assert.match(enforceSmcZones(md, { analyses: narrowMn, atrH1: 21.34, price: 3620.99, priceRe: /\d{3,5}(?:\.\d+)?/ }).markdown, /tidak ada bukti konfluensi presisi/);
});

test('Level Kunci: angka yang tidak cocok level mesin ditandai tidak terverifikasi', () => {
  const an = [
    { timeframe: 'W1', status: 'OK', bias: 'BEARISH', lastPrice: 3579, structureEvents: [{ type: 'BOS', direction: 'BULLISH', level: 3435.48, time: 1 }], swings: [], zones: [], supports: [], resistances: [] },
    { timeframe: 'H4', status: 'OK', bias: 'BEARISH', lastPrice: 3612, structureEvents: [], swings: [{ type: 'H', price: 3715.55 }], zones: [], supports: [], resistances: [] },
  ];
  const md = `| Timeframe | Struktur/Trend | Level Kunci | Catatan |
|---|---|---|---|
| W1 | Bearish | $3500.00 (Low mingguan) | x |
| H4 | Bearish | $3715.55 (Swing High) | x |
| D1 | Bearish | $3715.55 (Swing High H4) | x |
| D1 | Bearish | $3800.00 (Resistance) | x |
`;
  const r = syncLevelLabels(md, an, 3620.99);
  assert.match(r.markdown, /\| W1 \| Bearish \| \$3500\.00 \(Low mingguan\) \(tidak terverifikasi mesin\) \|/);
  assert.match(r.markdown, /\| H4 \| Bearish \| \$3715\.55 \(Swing High H4\) \|/);
  assert.match(r.markdown, /\| D1 \| Bearish \| \$3715\.55 \(Swing High H4\) \|/); // D1 cocok level H4 mesin
  assert.match(r.markdown, /\$3800\.00 \(Resistance\) \(tidak terverifikasi mesin\)/);
  assert.equal(r.unverified, 2);
  assert.equal(syncLevelLabels(r.markdown, an, 3620.99).unverified, 0); // idempoten
});

test('risk cap keras: satu order di atas batas pada lot minimum dibatalkan dan tidak bisa jadi setup utama', () => {
  const md = `| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| SELL Zona 2 - Intraday (FVG H1) (Searah Bias) | 3656.82 - 3661.30 | 3685.00 | 3600.00 | 3580.00 | x |

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 2 (Intraday) | 3656.82 | 3684.00 | 3600.00 | 27.18 | 0.01 | $27.18 | 1:2.09 | 24 Nov 2026, 02:28 WIB |

**Rincian Hitung Risiko:**
- Sell Limit Zona 2 (Intraday): 0.01 x 27.18 x 100 = $27.18
`;
  for (const capPerDirection of [true, false]) {
    const r = verifyRiskTables(md, 20, PAIRS.XAUUSD, NOW, { last: 3620.99, capPerDirection, zones: 3 });
    assert.match(r.markdown, /\| Sell Limit Zona 2 \(Intraday\) \| Tidak Ada Setup \(Batas Risiko: Tidak Dipasang\) \|/);
    assert.ok(r.notes.some((n) => /TIDAK DIPASANG/.test(n) && /lot minimum/.test(n)));
    assert.equal(r.totals.SELL, 0);
    const d = buildDecision({ markdown: r.markdown, bias: 'BEARISH', zoneRes: { SELL: { 2: { score: 5 } } } });
    assert.equal(d.status, 'NO_TRADE');
    assert.equal(d.primary, null);
  }
});

test('INSUFFICIENT_DATA: data kurang bukan NO TRADE dan tidak mengeluarkan TRADE dari screenshot saja', () => {
  assert.match(dataGap({ hasSnapshots: false }), /screenshot/);
  assert.match(dataGap({ hasSnapshots: true, priceMismatch: true }), /PRICE MISMATCH/);
  assert.match(dataGap({ hasSnapshots: true, analyses: [{ timeframe: 'M15', status: 'OK' }, { timeframe: 'H1', status: 'OK' }, { timeframe: 'H4', status: 'INSUFFICIENT_DATA' }] }), /H4/);
  assert.equal(dataGap({ hasSnapshots: true, analyses: ['M15', 'H1', 'H4'].map((t) => ({ timeframe: t, status: 'OK' })) }), null);
  const d = insufficientDecision('OHLC feed tidak tersedia.');
  assert.equal(d.status, 'INSUFFICIENT_DATA');
  assert.match(d.text, /DATA TIDAK CUKUP/);
  assert.doesNotMatch(d.text, /SETUP UTAMA|NO TRADE/);
  const md = insertDecision(D3, d.text);
  assert.ok(md.indexOf('DATA TIDAK CUKUP') < md.indexOf('Ringkasan Cepat'));
  assert.match(md, /^> ⚠️ \*\*KEPUTUSAN SERVER — ([^:*]+):\*\*/mu); // pola yang dibaca ResultView
});

test('Rincian Hitung Risiko ikut dikoreksi walau nama order disingkat (Z2) dan total arah diperbarui', () => {
  const md = `### 4. Rekomendasi

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 2 (Intraday Supply H1/H4) (Counter-Trend) | 3710.52 | 3728.41 | 3657.17 | 17.89 | 0.01 | $17.89 | 1:2.98 | 24 Nov 2026, 06.16 WIB |
| Buy Limit Zona 2 (Intraday OB/FVG H1) (Searah Bias) | 3627.55 | 3608.41 | 3675.94 | 19.14 | 0.01 | $19.14 | 1:2.53 | 24 Nov 2026, 06.16 WIB |

**Rincian Hitung Risiko**
- Sell Limit Z2: 0.01 x 17.89 x 100 = $1.79
- Buy Limit Z2: 0.01 x 19.14 x 100 = $1.91
- Total BUY: $6.85 (<= $20 batas per arah) | Total SELL: $2.92 (<= $20).

**Skenario Batal**
- x
`;
  const r = verifyRiskTables(md, 20, PAIRS.XAUUSD, NOW, { last: 3665.67, capPerDirection: true, zones: 2 });
  assert.match(r.markdown, /Sell Limit Z2: 0\.01 lot x 17\.89 x 100 = \$17\.89/);
  assert.match(r.markdown, /Buy Limit Z2: 0\.01 lot x 19\.14 x 100 = \$19\.14/);
  assert.match(r.markdown, /Total BUY: \$19\.14 .*\| Total SELL: \$17\.89/);
  assert.doesNotMatch(r.markdown, /\$1\.79|\$6\.85/);
});

test('syncSummaryLevels: TF salah pada Level kunci Ringkasan Cepat dikoreksi, TF benar dibiarkan', () => {
  const mk = (tf, res) => ({ status: 'OK', timeframe: tf, structureEvents: [], swings: [], zones: [], supports: [], resistances: res.map((p) => ({ price: p })) });
  const analyses = [mk('M15', [3675.94, 3689.62]), mk('H1', [3689.62]), mk('M5', [3675.14, 3675.94])];
  const md = '> - 📍 Level kunci: 3675.94 (resistance swing H1), 3689.62 (resistance H1).';
  const r = syncSummaryLevels(md, analyses, 3665.67);
  assert.match(r.markdown, /3675\.94 \(Swing High utuh M15\)/);
  assert.match(r.markdown, /3689\.62 \(resistance H1\)/);
  assert.equal(r.notes.length, 1);
});
