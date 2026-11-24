import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { reconcileZones, cancelMismatched, syncNarrative, finalizeOrders, ledgerOf } from '../lib/finalSync.js';
import { syncInvalidation, labelConfirmationLevels, judgeClause, structuralLevels, UNDEFINED_TEXT } from '../lib/invalidation.js';
import { spreadInfo, spreadWarnings, assessZone, TAG, UNVERIFIED, SPREAD_ZONE_WARN_RATIO } from '../lib/spreadCheck.js';
import { zoneOverlap } from '../lib/overlap.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-'));
for (const f of ['riskCheck.js', 'brokerSpec.js', 'pairs.js', 'marketTime.js', 'zoneCheck.js']) {
  fs.writeFileSync(path.join(tmp, f), fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8').replace(/'@\/lib\/([\w]+)'/g, "'./$1.js'"));
}
const { verifyRiskTables } = await import(pathToFileURL(path.join(tmp, 'riskCheck.js')).href);
const { PAIRS } = await import(pathToFileURL(path.join(tmp, 'pairs.js')).href);
const { applyOrderGuard } = await import(pathToFileURL(path.join(tmp, 'zoneCheck.js')).href);

// ---- Data struktur mesin SMC dari analisis live XAUUSD 24 Nov 2026 14:45 WIB (subset yang relevan)
const ANALYSES = [
  { timeframe: 'M5', status: 'OK', supports: [{ price: 3615.08 }, { price: 3613.52 }], resistances: [{ price: 3631.87 }, { price: 3640.07 }, { price: 3640.39 }],
    structureEvents: [{ type: 'CHoCH', direction: 'BULLISH', level: 3623.4 }], orderBlocks: [{ type: 'BULLISH', low: 3615.58, high: 3623.4, status: 'FRESH' }], fvgs: [{ type: 'BULLISH', low: 3619.54, high: 3620.09, status: 'FRESH' }] },
  { timeframe: 'M15', status: 'OK', supports: [{ price: 3613.52 }, { price: 3611.46 }, { price: 3600.4 }], resistances: [{ price: 3631.87 }, { price: 3640.39 }, { price: 3678.03 }],
    structureEvents: [], orderBlocks: [{ type: 'BEARISH', low: 3645.07, high: 3659.76, status: 'FRESH' }], fvgs: [{ type: 'BULLISH', low: 3608.25, high: 3610.83, status: 'FRESH' }, { type: 'BEARISH', low: 3642.72, high: 3646.46, status: 'FRESH' }, { type: 'BEARISH', low: 3659.76, high: 3662.53, status: 'PARTIALLY_MITIGATED' }] },
  { timeframe: 'H1', status: 'OK', supports: [{ price: 3611.46 }, { price: 3600.4 }, { price: 3502.82 }], resistances: [{ price: 3678.03 }, { price: 3689.62 }, { price: 3742.59 }],
    structureEvents: [{ type: 'BOS', direction: 'BULLISH', level: 3627.11 }], orderBlocks: [], fvgs: [{ type: 'BEARISH', low: 3642.72, high: 3652.99, status: 'FRESH' }] },
];
const QUOTE = { bid: 3623.25, ask: 3623.61, spread: 0.36 };
const DEC = 2;

// Keluaran mentah Gemini (sebelum server): BUY Z1/Z2 + SELL Z2 aktif; Skenario Batal menyamakan invalidation dengan SL / level karangan
const RAW = `**BIAS UTAMA:** NETRAL - TUNGGU KONFIRMASI
**PAIR:** XAUUSD
**HARGA TERAKHIR:** 3623.25

> **Ringkasan Cepat**
> - 🎯 Rencana: pasang Buy Limit Zona 1 di 3620.09 lalu Buy Limit Zona 2 di 3610.83.

### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)

| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (FVG/OB M5 Dekat) (Netral - Tunggu Konfirmasi) | 3619.54 - 3620.09 | 3614.10 | 3631.87 | 3640.07 | Candle M5 close bullish dengan wick bawah menolak zona. R:R ≈ 1:1.97 - Dasar: M5 OB, M5 FVG |
| BUY Zona 2 - Intraday (FVG M15, Konfirmasi H1) (Netral - Tunggu Konfirmasi) | 3608.25 - 3610.83 | 3605.20 | 3631.87 | 3645.50 | Candle M15 close bullish (engulfing) + tidak ada close di bawah 3605.20. R:R ≈ 1:3.74 - Dasar: M15 FVG |
| SELL Zona 1 - Scalping (Supply/Resistance Terdekat) (Netral - Tunggu Konfirmasi) | Tidak ada level valid (tunggu) | - | - | - | - |
| SELL Zona 2 - Intraday (FVG + OB M15, FVG H1) (Netral - Tunggu Konfirmasi) | 3642.72 - 3646.46 | 3662.70 | 3610.83 | 3600.40 | Candle M15 close bearish menolak zona. R:R ≈ 1:1.60 - Dasar: M15 OB, M15 FVG, H1 FVG |

### 4. Rekomendasi Susunan Pending Order

**4B. Order Baru yang Disarankan**

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 1 (Scalping Resistance Terdekat) | Tidak Ada Setup (Tunggu) | - | - | - | - | - | - | - |
| Sell Limit Zona 2 (Intraday Supply M15) | 3642.72 | 3662.70 | 3610.83 | 19.98 | 0.01 | $19.98 | 1:1.60 | 24 Nov 2026, 19.45 WIB |
| Buy Limit Zona 1 (Scalping Support M5) | 3620.09 | 3614.10 | 3631.87 | 5.99 | 0.01 | $5.99 | 1:1.97 | 24 Nov 2026, 16.40 WIB |
| Buy Limit Zona 2 (Intraday Demand M15) | 3610.83 | 3605.20 | 3631.87 | 5.63 | 0.01 | $5.63 | 1:3.74 | 24 Nov 2026, 19.45 WIB |

**Rincian Hitung Risiko**

- Sell Limit Zona 2: 0.01 lot x 19.98 x 100 = $19.98
- Buy Limit Zona 1: 0.01 lot x 5.99 x 100 = $5.99
- Buy Limit Zona 2: 0.01 lot x 5.63 x 100 = $5.63

**Skenario Batal (Invalidation Level)**

- Buy Zona 1: batal bila candle M5 close di bawah 3613.52 (low swing tembus).
- Buy Zona 2: batal bila candle H1 close di bawah 3600.40.
- Sell Zona 2: batal bila candle M15 close di atas 3662.70 atau harga tembus 3678.03 tanpa reaksi jual.

**Manajemen Posisi**

- Saat profit +1R, geser SL ke BE.
`;

// Alur lengkap: Gemini -> finalSync -> validator risiko -> invalidation/spread -> status order -> laporan
function pipeline(md, { status = 'WAIT', dir = null, quote = QUOTE, analyses = ANALYSES, riskUsd = 26 } = {}) {
  const p1 = reconcileZones(md, { dec: DEC });
  const c = verifyRiskTables(p1.markdown, riskUsd, PAIRS.XAUUSD, new Date('2026-11-24T07:45:00Z'), { last: 3623.25, capPerDirection: true, zones: 3 });
  const p2 = reconcileZones(c.markdown, { dec: DEC, mult: c.mult });
  const cm = p2.mismatches.length ? cancelMismatched(p2.markdown, p2.mismatches) : { markdown: p2.markdown };
  const nr = syncNarrative(cm.markdown, { dec: DEC, stale: [...p1.changes, ...p2.changes] });
  const inv = syncInvalidation(nr.markdown, { analyses, dec: DEC });
  const lab = labelConfirmationLevels(inv.markdown, { dec: DEC, items: inv.items });
  const sp = spreadWarnings(lab.markdown, { quote, dec: DEC });
  const ov = zoneOverlap(sp.markdown, { analyses, dec: DEC });
  const fo = finalizeOrders(ov.markdown, { status, dir, maxRiskUsd: riskUsd, dec: DEC, candidates: c.candidates });
  return { inv, lab, sp, ov, c, fo, md: fo.markdown, notes: [...inv.notes, ...lab.notes, ...sp.notes, ...ov.notes] };
}
const line = (md, re) => md.split('\n').find((l) => re.test(l));
const scen = (md) => { const a = md.split('\n'); const i = a.findIndex((l) => /Skenario Batal/.test(l)); const out = []; for (let k = i + 1; k < a.length && (/^\s*$/.test(a[k]) || /^\s*[-*•]/.test(a[k])); k++) if (a[k].trim()) out.push(a[k]); return out; };

// ================= P0: Invalidation vs SL =================
const LV = structuralLevels(ANALYSES);
const ctxBuy = { side: 'BUY', lo: 3608.25, hi: 3610.83, sl: 3605.2, entry: 3610.83, levels: LV, tol: 0.01 + 1e-9 };
const ctxSell = { side: 'SELL', lo: 3642.72, hi: 3646.46, sl: 3662.7, entry: 3642.72, levels: LV, tol: 0.01 + 1e-9 };

test('P0 judgeClause: level swing utuh dengan TF + close = struktural lengkap', () => {
  const j = judgeClause('batal bila candle H1 close di bawah 3600.40', ctxBuy);
  assert.equal(j.kind, 'struct');
  assert.equal(j.complete, true);
  assert.equal(j.tf, 'H1');
  assert.match(j.basis, /swing low utuh/);
});

test('P0 judgeClause: level = SL dan bukan struktur -> "sl" (tidak boleh jadi invalidation)', () => {
  const j = judgeClause('batal bila candle M15 close di atas 3662.70', ctxSell);
  assert.equal(j.kind, 'sl');
});

test('P0 judgeClause: level karangan (bukan struktur) dan level di sisi salah dibuang', () => {
  assert.equal(judgeClause('H1 close di bawah 3601.77', ctxBuy).kind, 'unknown');
  assert.equal(judgeClause('H1 close di atas 3678.03', ctxBuy).kind, 'wrong'); // BUY invalidation harus di bawah zona
  assert.equal(judgeClause('M15 close di bawah 3600.40', ctxSell).kind, 'wrong'); // SELL harus di atas zona
});

test('P0 judgeClause: level struktur tanpa TF/close ditandai tidak lengkap (tidak mengarang kondisi candle)', () => {
  const j = judgeClause('harga tembus 3678.03 tanpa reaksi jual', ctxSell);
  assert.equal(j.kind, 'struct');
  assert.equal(j.complete, false);
});

test('P0 kasus live: Buy Z2 -> SL 3605.20 (batas risiko) terpisah dari invalidation H1 close < 3600.40 (swing low utuh)', () => {
  const r = pipeline(RAW);
  const l = line(r.md, /^- Buy Zona 2:/);
  assert.match(l, /SL 3605\.20 = batas risiko posisi/);
  assert.match(l, /Invalidation struktural: candle H1 close di bawah 3600\.40 \(swing low utuh/);
  assert.match(l, /4\.80 di luar SL/);
});

test('P0 kasus live: Sell Z2 -> 3662.70 tidak lagi disebut invalidation (itu SL); 3678.03 tetap struktural tapi kondisi candle belum ditentukan', () => {
  const r = pipeline(RAW);
  const l = line(r.md, /^- Sell Zona 2:/);
  assert.match(l, /SL 3662\.70 = batas risiko posisi/);
  assert.doesNotMatch(l, /close di atas 3662\.70/);
  assert.match(l, /harga menembus 3678\.03 \(swing high utuh/);
  assert.match(l, /TF & kondisi candle konfirmasi belum ditentukan/);
});

test('P0 kasus live: Buy Z1 -> invalidation M5 close < 3613.52 dengan penjelasan relasi ke SL', () => {
  const r = pipeline(RAW);
  const l = line(r.md, /^- Buy Zona 1:/);
  assert.match(l, /SL 3614\.10 = batas risiko posisi/);
  assert.match(l, /candle M5 close di bawah 3613\.52/);
  assert.match(l, /0\.58 di luar SL/);
});

test('P0 tanpa level struktur valid: "Invalidation struktural belum terdefinisi — perlu evaluasi manual" (tidak mengarang)', () => {
  const md = RAW.replace('- Sell Zona 2: batal bila candle M15 close di atas 3662.70 atau harga tembus 3678.03 tanpa reaksi jual.', '- Sell Zona 2: batal bila candle M15 close di atas 3662.70 atau 3655.55 tertembus.');
  const r = pipeline(md);
  const l = line(r.md, /^- Sell Zona 2:/);
  assert.ok(l.includes(UNDEFINED_TEXT));
  assert.doesNotMatch(l, /3655\.55/);
  assert.match(l, /SL 3662\.70 = batas risiko posisi/);
});

test('P0 zona aktif yang tidak punya baris Skenario Batal diberi "belum terdefinisi" (bukan level baru)', () => {
  const md = RAW.replace(/- Buy Zona 2: batal[^\n]*\n/, '');
  const r = pipeline(md);
  const l = line(r.md, /^- Buy Zona 2:/);
  assert.ok(l.includes(UNDEFINED_TEXT));
  assert.match(l, /SL 3605\.20/);
});

test('P0 tanpa data struktur mesin (mode screenshot): teks tidak ditulis ulang, hanya diberi catatan tidak terverifikasi', () => {
  const r = pipeline(RAW, { analyses: null });
  assert.ok(r.inv.notes.some((n) => /tidak diverifikasi terhadap struktur mesin/.test(n)));
  assert.match(line(r.md, /^- Sell Zona 2:/), /close di atas 3662\.70/);
});

test('P0 konsistensi lintas bagian: kolom konfirmasi Bagian 3 menandai level SL "= SL", invalidation hanya di Skenario Batal', () => {
  const r = pipeline(RAW);
  assert.match(line(r.md, /^\| BUY Zona 2/), /tidak ada close di bawah 3605\.20 \(= SL, batas risiko\)/);
  assert.match(line(r.md, /^- Buy Zona 2:/), /SL 3605\.20/);
  assert.match(line(r.md, /^- Buy Zona 2:/), /3600\.40/);
});

test('P0 idempoten: menjalankan ulang tidak mengubah teks (tidak menumpuk label)', () => {
  const r = pipeline(RAW);
  const i2 = syncInvalidation(r.md, { analyses: ANALYSES, dec: DEC });
  const l2 = labelConfirmationLevels(i2.markdown, { dec: DEC, items: i2.items });
  assert.equal(l2.markdown, r.md);
  assert.equal((r.md.match(/\(= SL, batas risiko\)/g) || []).length, 1);
});

test('P0 angka Entry/SL/TP/R:R/lot/risiko tidak berubah oleh invalidation (tabel identik dengan jalur tanpa invalidation)', () => {
  const r = pipeline(RAW);
  const base = (() => { const p1 = reconcileZones(RAW, { dec: DEC }); const c = verifyRiskTables(p1.markdown, 26, PAIRS.XAUUSD, new Date('2026-11-24T07:45:00Z'), { last: 3623.25, capPerDirection: true, zones: 3 }); return c.markdown; })();
  const cells = (md, re) => md.split('\n').filter((l) => re.test(l)).map((l) => l.split('|').slice(2, 9).map((x) => x.trim()).join('|'));
  assert.deepEqual(cells(r.md, /^\| (?:Buy|Sell) Limit Zona/), cells(base, /^\| (?:Buy|Sell) Limit Zona/));
});

// ================= P1: spread =================
test('P1 spreadInfo: spread diambil dari Ask - Bid kuotasi broker; data tidak valid = belum terverifikasi', () => {
  const ok = spreadInfo({ bid: 3623.25, ask: 3623.61 });
  assert.equal(ok.valid, true);
  assert.ok(Math.abs(ok.spread - 0.36) < 1e-9);
  assert.equal(spreadInfo(null).valid, false);
  assert.equal(spreadInfo({ bid: 3623.25, ask: null }).valid, false);
  assert.equal(spreadInfo({ bid: 3623.25, ask: 3623.0 }).valid, false);
  assert.equal(spreadInfo({ bid: 3623.25, ask: 3623.25 }).valid, false);
  assert.equal(spreadInfo({ bid: 1.085, ask: 1.2 }).valid, false); // spread tidak wajar
  assert.equal(spreadInfo({ bid: NaN, ask: 1 }).valid, false);
});

test('P1 assessZone: rasio spread/lebar zona; BUY memakai Ask (zona efektif menyusut), SELL terisi di Bid', () => {
  const b = assessZone({ side: 'BUY', lo: 3619.54, hi: 3620.09, spread: 0.36 });
  assert.equal(b.narrow, true);
  assert.ok(Math.abs(b.ratio - 0.36 / 0.55) < 1e-9);
  assert.ok(Math.abs(b.effective - 0.19) < 1e-9);
  const s = assessZone({ side: 'SELL', lo: 3642.72, hi: 3646.46, spread: 0.36 });
  assert.equal(s.narrow, false);
  assert.equal(s.effective, s.width);
  assert.equal(assessZone({ side: 'BUY', lo: 100, hi: 100, spread: 0.1 }).narrow, true); // zona satu harga
  assert.equal(assessZone({ side: 'BUY', lo: 100, hi: 100.2, spread: 0.1 * SPREAD_ZONE_WARN_RATIO }).narrow, false);
});

test('P1 kasus live: BUY Zona 1 (lebar 0.55 vs spread 0.36) diberi peringatan ZONA SEMPIT; Zona 2 dan Sell Z2 tidak', () => {
  const r = pipeline(RAW);
  assert.match(line(r.md, /^\| BUY Zona 1/), /ZONA SEMPIT — RENTAN SPREAD & SLIPPAGE/);
  assert.match(line(r.md, /^\| Buy Limit Zona 1/), /ZONA SEMPIT — RENTAN SPREAD & SLIPPAGE/);
  assert.doesNotMatch(line(r.md, /^\| BUY Zona 2/), /ZONA SEMPIT/);
  assert.doesNotMatch(line(r.md, /^\| SELL Zona 2/), /ZONA SEMPIT/);
  const n = r.sp.notes.find((x) => x.includes(TAG));
  assert.match(n, /BUY Zona 1 lebar 0\.55 vs spread 0\.36 \(65% dari lebar zona; Bid 3623\.25 \/ Ask 3623\.61\)/);
  assert.match(n, /Ask ≤ entry \(Bid ≈ 3619\.73\), sehingga hanya 0\.19/);
  assert.match(n, /Entry\/SL\/TP tidak diubah/);
});

test('P1 peringatan spread TIDAK mengubah koordinat dan TIDAK membatalkan zona', () => {
  const r = pipeline(RAW);
  const noSpread = pipeline(RAW, { quote: null });
  const nums = (md) => md.split('\n').filter((l) => /^\| (?:BUY|SELL|Buy|Sell)/.test(l)).map((l) => (l.match(/\d+\.\d+/g) || []).join(','));
  assert.deepEqual(nums(r.md).sort(), nums(noSpread.md).sort());
  const led = ledgerOf(r.md, { dec: DEC });
  assert.equal(led.get('BUY1').active, true);
  assert.equal(led.get('BUY1').entry, 3620.09);
  assert.equal(led.get('BUY1').sl, 3614.1);
});

test('P1 spread tinggi: zona lebar pun diperingatkan bila spread besar; spread normal -> tidak ada peringatan', () => {
  const hi = pipeline(RAW, { quote: { bid: 3623.25, ask: 3624.75 } }); // spread 1.50
  assert.match(line(hi.md, /^\| BUY Zona 2/), /ZONA SEMPIT/); // lebar 2.58, rasio 58%
  assert.match(line(hi.md, /^\| SELL Zona 2/), /ZONA SEMPIT/); // lebar 3.74, rasio 40% (>= 25%)
  const lo = pipeline(RAW, { quote: { bid: 3623.25, ask: 3623.30 } }); // spread 0.05
  assert.equal(lo.sp.warned.length, 0);
  assert.doesNotMatch(lo.md, /ZONA SEMPIT/);
});

test('P1 spread tidak tersedia / tidak valid: "Spread belum terverifikasi", tanpa tanda pada baris', () => {
  for (const q of [null, { bid: 3623.25, ask: null }, { bid: 3623.25, ask: 3623.0 }]) {
    const r = pipeline(RAW, { quote: q });
    assert.ok(r.sp.notes.some((n) => n.includes(UNVERIFIED)), JSON.stringify(q));
    assert.equal(r.sp.verified, false);
    assert.doesNotMatch(r.md, /ZONA SEMPIT/);
  }
});

test('P1 SELL: catatan menyebut SL SELL terpicu oleh Ask (jarak SL efektif berkurang), zona SELL tidak menyusut', () => {
  const md = RAW.replace('3642.72 - 3646.46', '3642.72 - 3642.92');
  const r = pipeline(md);
  const n = r.sp.notes.find((x) => x.includes('SELL Zona 2'));
  assert.ok(n, r.sp.notes.join('\n'));
  assert.match(n, /Limit SELL terisi di Bid ≥ entry, tetapi SL SELL terpicu oleh Ask/);
});

test('P1 generik untuk pair Forex (EURUSD 5 desimal): memakai spread aktual, bukan angka tetap XAUUSD', () => {
  const md = `### 3. Pemetaan

| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (FVG M5) | 1.08420 - 1.08440 | 1.08380 | 1.08560 | 1.08700 | Close bullish M5 |
| BUY Zona 2 - Intraday (FVG M15) | 1.08200 - 1.08330 | 1.08150 | 1.08560 | 1.08700 | Close bullish M15 |

**4B. Order Baru yang Disarankan**

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Buy Limit Zona 1 (Scalping) | 1.08440 | 1.08380 | 1.08560 | 0.00060 | 0.10 | $6.00 | 1:2.00 | - |
| Buy Limit Zona 2 (Intraday) | 1.08330 | 1.08150 | 1.08560 | 0.00180 | 0.03 | $5.40 | 1:1.28 | - |
`;
  const wide = spreadWarnings(md, { quote: { bid: 1.0850, ask: 1.08512 }, dec: 5 }); // spread 0.00012
  assert.deepEqual(wide.warned, ['BUY1']); // lebar 0.00020 -> 60%; Zona 2 lebar 0.00130 -> 9%
  assert.match(wide.notes[0], /lebar 0\.00020 vs spread 0\.00012 \(60% dari lebar zona/);
  const tight = spreadWarnings(md, { quote: { bid: 1.0850, ask: 1.08503 }, dec: 5 }); // spread 0.00003 -> 15%
  assert.deepEqual(tight.warned, []);
  assert.equal(tight.verified, true);
});

test('P1 aturan lama ATR "sangat sempit" hanya cadangan: tidak ganda saat spread terverifikasi', () => {
  const md = `**ATR:** H1 19.61 | H4 51.23
**HARGA TERAKHIR:** 3623.25

| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (FVG M5) | 3619.54 - 3620.09 | 3614.10 | 3631.87 | 3640.07 | Dasar: M5 FVG |
`;
  const atr = { h1: 19.61, h4: 51.23, m15: 9.65, src: 'test' };
  const legacy = applyOrderGuard(md, { pair: PAIRS.XAUUSD, bias: 'NETRAL', atr, zones: 3, spreadVerified: false });
  assert.ok(legacy.notes.some((n) => /sangat sempit/.test(n)), legacy.notes.join('\n'));
  const guarded = applyOrderGuard(md, { pair: PAIRS.XAUUSD, bias: 'NETRAL', atr, zones: 3, spreadVerified: true });
  assert.ok(!guarded.notes.some((n) => /sangat sempit/.test(n)));
});

// ================= P1: judul & status 4B =================
test('P1 WAIT & SEE: judul 4B = "KANDIDAT ORDER — BELUM BOLEH DIPASANG", bukan "Order Baru yang Disarankan"', () => {
  const r = pipeline(RAW, { status: 'WAIT' });
  assert.match(r.md, /^\*\*4B\. KANDIDAT ORDER — BELUM BOLEH DIPASANG\*\*$/m);
  assert.doesNotMatch(r.md, /Order Baru yang Disarankan/);
  for (const l of r.md.split('\n').filter((x) => /^\| (?:Buy|Sell) Limit Zona/.test(x) && /\d{4}\.\d\d \|/.test(x))) assert.match(l, /⏳ CANDIDATE \(belum boleh dipasang\)/);
  assert.doesNotMatch(r.md, /✅ VALIDATED ORDER/);
});

test('P1 WAIT & SEE: tidak ada kalimat yang menyuruh memasang pending order; ACTIVE SETUP tidak diklaim', () => {
  const r = pipeline(RAW, { status: 'WAIT' });
  const banner = line(r.md, /Status order 4B/);
  assert.match(banner, /Jangan memasang pending order apa pun/);
  assert.match(banner, /ACTIVE SETUP/);
  assert.doesNotMatch(banner, /boleh dipasang setelah/);
  assert.doesNotMatch(r.md, /✅ Pasang hanya order/);
  const advice = r.md.split('\n').filter((l) => !/^\s*[|>]/.test(l) && /\b(pasang|memasang)\b/i.test(l) && !/jangan|belum boleh|dihapus server|candidate|kandidat/i.test(l) && !/^\*\*Aturan Pasang \(/.test(l));
  assert.deepEqual(advice, []);
  assert.doesNotMatch(r.md, /ACTIVE SETUP\*\*|status ACTIVE SETUP:/);
});

test('P1 TRADE & ada VALIDATED ORDER: judul kembali normal, VALIDATED tidak disamakan dengan ACTIVE SETUP', () => {
  const r = pipeline(RAW, { status: 'TRADE', dir: 'BUY' });
  assert.match(r.md, /^\*\*4B\. Order Baru yang Disarankan\*\*$/m);
  assert.match(r.md, /✅ VALIDATED ORDER/);
  const banner = line(r.md, /Status order 4B/);
  assert.match(banner, /BUKAN "ACTIVE SETUP"/);
  assert.match(banner, /syarat konfirmasi candle di Bagian 3/);
  // order arah lawan tetap CANDIDATE
  assert.match(line(r.md, /^\| Sell Limit Zona 2/), /⏳ CANDIDATE/);
});

test('P1 TRADE tetapi tidak ada order searah bias: judul tetap KANDIDAT (tidak ada VALIDATED ORDER)', () => {
  const r = pipeline(RAW, { status: 'TRADE', dir: 'SELL' });
  const r2 = pipeline(RAW, { status: 'TRADE', dir: null });
  assert.match(r2.md, /^\*\*4B\. KANDIDAT ORDER — BELUM BOLEH DIPASANG\*\*$/m);
  assert.doesNotMatch(r2.md, /✅ VALIDATED ORDER = lolos/);
  assert.match(r.md, /VALIDATED ORDER/); // dir SELL: Sell Z2 valid
});

test('P1 judul, banner, status baris, Ringkasan Cepat, dan Aturan Pasang konsisten saat WAIT', () => {
  const r = pipeline(RAW, { status: 'WAIT' });
  assert.match(r.md, /KANDIDAT ORDER — BELUM BOLEH DIPASANG/);
  assert.match(line(r.md, /Status order 4B/), /CANDIDATE ORDER/);
  assert.match(line(r.md, /Rencana/), /WAIT & SEE — saran pemasangan\/pemilihan order dihapus server/);
  assert.match(r.md, /\*\*Aturan Pasang|jangan memasang order apa pun|Total risiko per arah/);
  assert.match(line(r.md, /Total risiko per arah/), /BUY \$11\.62 \| SELL \$19\.98 \(batas \$26\.00 per arah\)/);
});

test('P1 judul 4B idempoten dan tidak merusak banner tunggal', () => {
  const r = pipeline(RAW, { status: 'WAIT' });
  const again = finalizeOrders(r.md, { status: 'WAIT', dir: null, maxRiskUsd: 26, dec: DEC, candidates: r.c.candidates });
  assert.equal(again.markdown, r.md);
  assert.equal((r.md.match(/Status order 4B/g) || []).length, 1);
});

test('P1 judul "Catatan batas risiko" tanpa bold juga dibangun ulang dari order final', () => {
  const md = RAW.replace('**Skenario Batal (Invalidation Level)**', 'Catatan batas risiko (per arah, batas $26.00):\n- Total BUY $99.99 | Total SELL $88.88 — pilih satu zona.\n\n**Skenario Batal (Invalidation Level)**');
  const r = pipeline(md, { status: 'WAIT' });
  assert.doesNotMatch(r.md, /99\.99|88\.88|pilih satu zona/);
  assert.match(r.md, /\*\*Aturan Pasang \(batas risiko \$26\.00 per arah/);
  assert.match(r.md, /- BUY: Buy Z1 \+ Buy Z2 = \$11\.62/);
});

// ================= Integrasi: BUY & SELL, XAUUSD & Forex, route wiring =================
test('integrasi: laporan akhir tanpa angka lama; BUY dan SELL sama-sama sinkron (Entry/SL/TP/R:R/lot/risiko)', () => {
  const r = pipeline(RAW, { status: 'WAIT' });
  const led = ledgerOf(r.md, { dec: DEC });
  assert.deepEqual([led.get('BUY1').entry, led.get('BUY1').sl, led.get('BUY1').tp1, led.get('BUY1').lot, led.get('BUY1').risk], [3620.09, 3614.1, 3631.87, '0.01', 5.99]);
  assert.deepEqual([led.get('SELL2').entry, led.get('SELL2').sl, led.get('SELL2').tp1, led.get('SELL2').lot, led.get('SELL2').risk], [3642.72, 3662.7, 3610.83, '0.01', 19.98]);
  assert.ok(Math.abs(led.get('SELL2').rr - 1.6) < 0.01);
  assert.match(line(r.md, /^\| SELL Zona 2/), /R:R ≈ 1:1\.60/);
  assert.match(scen(r.md).join('\n'), /SL 3662\.70 = batas risiko/);
});

test('route: validator terpasang di runChecks setelah rekonsiliasi akhir dan sebelum pembersihan catatan', () => {
  const src = fs.readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ syncInvalidation, labelConfirmationLevels \} from '@\/lib\/invalidation'/);
  assert.match(src, /import \{ spreadInfo, spreadWarnings \} from '@\/lib\/spreadCheck'/);
  assert.match(src, /spreadVerified: spreadInfo\(mt4ContextUsed\?\.quote\)\.valid/);
  const iRec = src.indexOf('const nr = syncNarrative');
  const iInv = src.indexOf('syncInvalidation(md');
  const iSp = src.indexOf('spreadWarnings(md');
  const iDead = src.indexOf('const dead = pairCfg ? deadKeys');
  assert.ok(iRec > 0 && iInv > iRec && iSp > iInv && iDead > iSp);
});

// ================= HOTFIX: format kalimat live tanpa titik dua (XAUUSD 24 Nov 2026 15:05 WIB) =================
const LIVE3 = `**BIAS UTAMA:** NETRAL - WAIT & SEE
**PAIR:** XAUUSD
**HARGA TERAKHIR:** 3623.42

> **Ringkasan Cepat**
> - Rencana: Tunggu pullback ke zona struktur; jangan kejar harga di tengah range.

### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)

| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (M15 FVG Demand) - Dasar: M15 FVG bullish 3608.25-3610.83 fresh (Netral - Tunggu Konfirmasi) | 3608.25 - 3610.83 | 3606.82 | 3616.84 | 3631.87 | Buy limit 3610.83; butuh bullish engulfing/close M5 di atas 3611.00. R:R TP1 ±1:1.50. |
| BUY Zona 2 - Intraday (Demand H1-H4) - Dasar: tidak ada FVG/OB bullish fresh di rentang ini (Netral - Tunggu Konfirmasi) | Tidak ada level valid (tunggu) | - | - | - | - |
| SELL Zona 1 - Scalping (M5-M15 Supply) - Dasar: tidak ada FVG/OB bearish fresh dekat harga (Netral - Tunggu Konfirmasi) | Tidak ada level valid (tunggu) | - | - | - | - |
| SELL Zona 2 - Intraday (M15 FVG/OB) - Dasar: M15 FVG bearish 3642.72-3646.46; M15 OB 3645.07-3659.76; H1 FVG 3642.72-3652.99 (Netral - Tunggu Konfirmasi) | 3642.72 - 3646.46 | 3662.61 | 3612.73 | 3600.40 | Sell limit 3642.72; butuh bearish rejection/close M15 di bawah 3642.72. R:R TP1 ±1:1.51. |

### 4. Rekomendasi Susunan Pending Order

**4B. Order Baru yang Disarankan**

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 1 (Scalping Supply) (Netral - Tunggu Konfirmasi) | Tidak Ada Setup (Tunggu) | - | - | - | - | - | - | - |
| Sell Limit Zona 2 (Intraday FVG/OB M15) (Netral - Tunggu Konfirmasi) | 3642.72 | 3662.61 | 3612.73 | 19.89 | 0.01 | $19.89 | 1:1.51 | 24 Nov 2026, 19.09 WIB |
| Buy Limit Zona 1 (Scalping M15 FVG) (Netral - Tunggu Konfirmasi) | 3610.83 | 3606.82 | 3616.84 | 4.01 | 0.01 | $4.01 | 1:1.50 | 24 Nov 2026, 17.09 WIB |
| Buy Limit Zona 2 (Intraday Demand) (Netral - Tunggu Konfirmasi) | Tidak Ada Setup (Tunggu) | - | - | - | - | - | - | - |

**Rincian Hitung Risiko**

- Sell Limit Zona 2: 0.01 lot x 19.89 x 100 = $19.89
- Buy Limit Zona 1: 0.01 lot x 4.01 x 100 = $4.01

**Skenario Batal (Invalidation Level)**

- Sell Zona 2 batal jika H1 close di atas 3662.61, atau M15 close di atas 3646.46 setelah sweep.
- Buy Zona 1 batal jika M15 close di bawah 3606.82.
- WAIT / NO TRADE — Sell Zona 3: tidak ada order (setup dibatalkan / belum valid; lihat Bagian 3 dan 4B); saat ini tidak dipasang karena batas risiko arah.
- WAIT / NO TRADE — Buy Zona 3: tidak ada order (setup dibatalkan / belum valid; lihat Bagian 3 dan 4B); saat ini tidak dipasang karena risiko minimum sudah melebihi batas.
- Hapus pending jika TP1 tersentuh sebelum order terisi.

**Manajemen Posisi**

- Ambil partial 50% di TP1, lalu pindahkan SL ke break-even setelah profit ±1R.
`;
const Q3 = { bid: 3623.42, ask: 3623.78 };
const pipe3 = (md, o = {}) => pipeline(md, { quote: Q3, ...o });
const SEL_LINE = 'Sell Zona 2 batal jika H1 close di atas 3662.61, atau M15 close di atas 3646.46 setelah sweep.';
const BUY_LINE = 'Buy Zona 1 batal jika M15 close di bawah 3606.82.';

test('HOTFIX unit: baris tanpa titik dua dikenali (batal jika / invalid jika / batal apabila / SELL Z2 / Sell Limit)', () => {
  const variants = [
    ['- Buy Zona 1 batal jika M15 close di bawah 3606.82.', 'Buy Zona 1'],
    ['- Buy Zona 1: M15 close di bawah 3606.82.', 'Buy Zona 1'],
    ['- SELL Z2 invalid jika H1 close di atas 3662.61.', 'Sell Zona 2'],
    ['- Sell Limit Zona 2 batal apabila H1 close di atas 3662.61.', 'Sell Zona 2'],
    ['- **Sell Zona 2** batal jika H1 close di atas 3662.61.', 'Sell Zona 2'],
    ['* Sell Zona 2 – batal jika H1 close di atas 3662.61.', 'Sell Zona 2'],
  ];
  for (const [src, name] of variants) {
    const md = LIVE3.replace(/- Sell Zona 2 batal jika[^\n]*\n- Buy Zona 1 batal jika[^\n]*\n/, `${src}\n`);
    const r = pipe3(md);
    const l = scen(r.md).find((x) => x.includes(`${name}: SL`));
    assert.ok(l, `${src}\n${scen(r.md).join('\n')}`);
    assert.doesNotMatch(l, /close di (?:atas|bawah) 3606\.82|close di atas 3662\.61/);
  }
});

test('HOTFIX live SELL Zona 2: SL 3662.61 bukan invalidation; 3646.46 = tepi atas zona (bukan di luar zona) -> dibuang; hasil "belum terdefinisi"', () => {
  const r = pipe3(LIVE3);
  const l = line(r.md, /^- Sell Zona 2:/);
  assert.ok(l, scen(r.md).join('\n'));
  assert.match(l, /SL 3662\.61 = batas risiko posisi/);
  assert.ok(l.includes(UNDEFINED_TEXT));
  assert.doesNotMatch(l, /Invalidation struktural: /);
  assert.doesNotMatch(r.md, /Sell Zona 2 batal jika/);
  const it = r.inv.items.find((x) => x.key === 'SELL2');
  assert.deepEqual(it.dropped.map((d) => [d.level, d.kind]), [[3662.61, 'sl'], [3646.46, 'wrong']]);
});

test('HOTFIX live BUY Zona 1: SL 3606.82 tidak lolos sebagai invalidation; tidak ada level pengganti karangan -> "belum terdefinisi"', () => {
  const r = pipe3(LIVE3);
  const l = line(r.md, /^- Buy Zona 1:/);
  assert.ok(l, scen(r.md).join('\n'));
  assert.match(l, /SL 3606\.82 = batas risiko posisi/);
  assert.ok(l.includes(UNDEFINED_TEXT));
  assert.doesNotMatch(l, /3600\.40|3611\.46|3613\.52/); // level struktur lain ada di mesin, tetapi server tidak memilihkan pengganti
  assert.doesNotMatch(r.md, /Buy Zona 1 batal jika/);
});

test('HOTFIX: level struktur valid pada kalimat tanpa titik dua tetap dipertahankan; tanpa TF/close ditandai manual', () => {
  const md = LIVE3.replace(BUY_LINE, 'Buy Zona 1 batal jika H1 close di bawah 3600.40.').replace(SEL_LINE, 'Sell Zona 2 batal jika harga tembus 3678.03 atau H1 close di atas 3662.61.');
  const r = pipe3(md);
  assert.match(line(r.md, /^- Buy Zona 1:/), /Invalidation struktural: candle H1 close di bawah 3600\.40 \(swing low utuh/);
  const s = line(r.md, /^- Sell Zona 2:/);
  assert.match(s, /harga menembus 3678\.03/);
  assert.match(s, /TF & kondisi candle konfirmasi belum ditentukan/);
  assert.doesNotMatch(s, /close di atas 3662\.61/);
});

test('HOTFIX: Entry/SL/TP/R:R/lot/risiko/koordinat zona identik sebelum dan sesudah syncInvalidation', () => {
  const r = pipe3(LIVE3);
  const p1 = reconcileZones(LIVE3, { dec: DEC });
  const c = verifyRiskTables(p1.markdown, 26, PAIRS.XAUUSD, new Date('2026-11-24T08:05:00Z'), { last: 3623.42, capPerDirection: true, zones: 3 });
  const p2 = reconcileZones(c.markdown, { dec: DEC, mult: c.mult });
  const pre = syncNarrative(p2.markdown, { dec: DEC, stale: [...p1.changes, ...p2.changes] }).markdown;
  const grab = (md) => md.split('\n').filter((l) => /^\| (?:BUY|SELL|Buy|Sell)/.test(l)).map((l) => l.split('|').slice(2, 9).map((x) => x.trim().replace(/\s*⚠️ ZONA SEMPIT[^|]*$/, '')).join('|'));
  assert.deepEqual(grab(r.md), grab(pre));
  const led = ledgerOf(r.md, { dec: DEC });
  assert.deepEqual([led.get('SELL2').entry, led.get('SELL2').sl, led.get('SELL2').tp1, led.get('SELL2').risk, led.get('SELL2').lo, led.get('SELL2').hi], [3642.72, 3662.61, 3612.73, 19.89, 3642.72, 3646.46]);
  assert.deepEqual([led.get('BUY1').entry, led.get('BUY1').sl, led.get('BUY1').tp1, led.get('BUY1').risk, led.get('BUY1').lo, led.get('BUY1').hi], [3610.83, 3606.82, 3616.84, 4.01, 3608.25, 3610.83]);
});

test('HOTFIX: idempoten pada laporan live (baris yang sudah ditulis ulang tidak diproses lagi)', () => {
  const r = pipe3(LIVE3);
  const i2 = syncInvalidation(r.md, { analyses: ANALYSES, dec: DEC });
  assert.equal(i2.markdown, r.md);
  assert.deepEqual(i2.notes, []);
  const lab = labelConfirmationLevels(i2.markdown, { dec: DEC, items: [] });
  assert.equal(lab.markdown, r.md);
});

test('HOTFIX: kalimat WAIT / NO TRADE dan baris tanpa zona tidak rusak', () => {
  const r = pipe3(LIVE3);
  for (const k of ['Sell Zona 3', 'Buy Zona 3']) {
    const l = line(r.md, new RegExp(`^- WAIT / NO TRADE — ${k}:`));
    assert.ok(l, k);
    assert.match(l, /tidak ada order \(setup dibatalkan \/ belum valid; lihat Bagian 3 dan 4B\); saat ini tidak dipasang karena/);
    assert.doesNotMatch(l, /SL \d|Invalidation struktural/);
  }
  assert.ok(r.md.includes('- Hapus pending jika TP1 tersentuh sebelum order terisi.'));
  assert.ok(r.md.includes('**Manajemen Posisi**'));
});

test('HOTFIX: BUY dan SELL diproses sekaligus; zona aktif tanpa baris tidak menambah level', () => {
  const r = pipe3(LIVE3);
  const names = scen(r.md).filter((l) => /: SL \d/.test(l)).map((l) => l.replace(/^- /, '').split(':')[0]).sort();
  assert.deepEqual(names, ['Buy Zona 1', 'Sell Zona 2']);
  assert.equal(r.inv.items.filter((x) => x.added).length, 0);
  assert.ok(r.inv.items.every((x) => x.undefinedInvalidation));
});

// ================= AUDIT FINAL: total risiko 3 kategori, invalidation lintas zona, overlap OB/FVG =================
// Fixture direkonstruksi dari angka audit live pasca c5ea4e8 (laporan mentah tidak ikut terlampir): BUY Z1 SL 3605.50 ($5.33), BUY Z3 SL 3527.11 ($16.45),
// SELL Z2 SL 3662.61 ($19.89); kandidat awal SELL Z3 ($17.69) dan BUY Z2 ($26.20) ditolak validator; total lama $37.58 / $47.98 ada di teks bebas Gemini.
const ANALYSES2 = [
  ...ANALYSES.map((a) => (a.timeframe === 'H1' ? { ...a, fvgs: [...a.fvgs, { type: 'BULLISH', low: 3529.96, high: 3557.16, status: 'FRESH' }, { type: 'BULLISH', low: 3538.39, high: 3568.22, status: 'FRESH' }] } : a)),
  { timeframe: 'H4', status: 'OK', supports: [{ price: 3502.82 }], resistances: [{ price: 3689.62 }], structureEvents: [], orderBlocks: [], fvgs: [{ type: 'BULLISH', low: 3542.22, high: 3575.28, status: 'FRESH' }] },
];
const LIVE4 = `**BIAS UTAMA:** NETRAL - WAIT & SEE
**PAIR:** XAUUSD
**HARGA TERAKHIR:** 3617.80

> **Ringkasan Cepat**
> - Rencana: Tunggu pullback ke zona struktur; jangan kejar harga di tengah range.

### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)

| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (M15 FVG Demand) (Netral - Tunggu Konfirmasi) | 3608.25 - 3610.83 | 3605.50 | 3619.00 | 3631.87 | Bullish engulfing M5. R:R TP1 ±1:1.53. - Dasar: M15 FVG |
| BUY Zona 2 - Intraday (Demand H1) (Netral - Tunggu Konfirmasi) | 3550.00 - 3553.31 | 3527.11 | 3600.00 | 3631.87 | Close M15 bullish. R:R TP1 ±1:1.80. - Dasar: H1 FVG |
| BUY Zona 3 - Swing (H4/H1 FVG Demand) (Netral - Tunggu Konfirmasi) | 3529.96 - 3543.56 | 3527.11 | 3578.00 | 3611.46 | Konfirmasi H4 close bullish. R:R TP1 ±1:2.09. - Dasar: H4 FVG, H1 FVG |
| SELL Zona 1 - Scalping (M5-M15 Supply) (Netral - Tunggu Konfirmasi) | Tidak ada level valid (tunggu) | - | - | - | - |
| SELL Zona 2 - Intraday (M15 FVG/OB) (Netral - Tunggu Konfirmasi) | 3642.72 - 3646.46 | 3662.61 | 3612.73 | 3600.40 | Bearish rejection M15. R:R TP1 ±1:1.51. - Dasar: M15 FVG, H1 FVG |
| SELL Zona 3 - Swing (H1 OB/H4 FVG) (Netral - Tunggu Konfirmasi) | 3710.52 - 3721.63 | 3728.21 | 3675.00 | 3640.00 | Close H1 bearish. R:R TP1 ±1:2.01. |

### 4. Rekomendasi Susunan Pending Order

**4B. Order Baru yang Disarankan**

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 1 (Scalping Supply) | Tidak Ada Setup (Tunggu) | - | - | - | - | - | - | - |
| Sell Limit Zona 2 (Intraday FVG/OB M15) | 3642.72 | 3662.61 | 3612.73 | 19.89 | 0.01 | $19.89 | 1:1.51 | 24 Nov 2026, 19.09 WIB |
| Sell Limit Zona 3 (Swing H1 OB/H4 FVG) | 3710.52 | 3728.21 | 3675.00 | 17.69 | 0.01 | $17.69 | 1:2.01 | 25 Nov 2026, 05.00 WIB |
| Buy Limit Zona 1 (Scalping M15 FVG) | 3610.83 | 3605.50 | 3619.00 | 5.33 | 0.01 | $5.33 | 1:1.53 | 24 Nov 2026, 17.09 WIB |
| Buy Limit Zona 2 (Intraday Demand H1) | 3553.31 | 3527.11 | 3600.00 | 26.20 | 0.01 | $26.20 | 1:1.80 | 24 Nov 2026, 19.09 WIB |
| Buy Limit Zona 3 (Swing H4/H1 FVG) | 3543.56 | 3527.11 | 3578.00 | 16.45 | 0.01 | $16.45 | 1:2.09 | 25 Nov 2026, 05.00 WIB |

**Rincian Hitung Risiko**

- Sell Limit Zona 2: 0.01 lot x 19.89 x 100 = $19.89
- Sell Limit Zona 3: 0.01 lot x 17.69 x 100 = $17.69
- Buy Limit Zona 1: 0.01 lot x 5.33 x 100 = $5.33
- Buy Limit Zona 2: 0.01 lot x 26.20 x 100 = $26.20
- Buy Limit Zona 3: 0.01 lot x 16.45 x 100 = $16.45
- Total risiko SELL Zona 2 + Zona 3 = $37.58 (melebihi batas $26).
- Total risiko BUY Zona 1 + Zona 2 + Zona 3 = $47.98 (melebihi batas $26).
- Kombinasi BUY Zona 1 + Zona 3 = $21.78.
- Total risiko BUY yang lolos validator = $21.78.
- Total risiko SELL yang lolos validator = $19.89.

**Skenario Batal (Invalidation Level)**

- Sell Zona 2 batal jika H1 close di atas 3662.61, atau M15 close di atas 3646.46 setelah sweep.
- Buy Zona 1 batal jika M15 close di bawah 3605.50.
- Buy Zona 2 dan Buy Zona 3 batal bila candle H1/H4 close di bawah 3527.11.
- Semua order batal bila struktur H1 berubah arah.
- Hapus pending jika TP1 tersentuh sebelum order terisi.

**Manajemen Posisi**

- Ambil partial 50% di TP1, lalu pindahkan SL ke break-even setelah profit ±1R.
`;
const Q4 = { bid: 3617.80, ask: 3618.16 };
const pipe4 = (o = {}) => pipeline(LIVE4, { quote: Q4, analyses: ANALYSES2, ...o });
const sec = (md, re) => { const a = md.split('\n'); const i = a.findIndex((l) => re.test(l)); const o = []; for (let k = i + 1; k < a.length && !/^\s*\*\*\S/.test(a[k]) && !/^\s*#/.test(a[k]); k++) o.push(a[k]); return o.join('\n'); };

test('AUDIT P0 total risiko: kasus live tanpa $37.58 / $47.98 / kombinasi lama; total akhir BUY $21.78, SELL $19.89 (batas $26)', () => {
  const r = pipe4();
  assert.deepEqual([r.fo.totals.BUY.toFixed(2), r.fo.totals.SELL.toFixed(2)], ['21.78', '19.89']);
  assert.doesNotMatch(r.md, /37\.58|47\.98|Kombinasi BUY Zona 1 \+ Zona 3|yang lolos validator = \$/);
  assert.match(r.md, /- BUY: Buy Z1 \+ Buy Z3 = \$21\.78 \(di bawah batas \$26\.00 per arah\) — CANDIDATE, belum boleh dipasang\./);
  assert.match(r.md, /- SELL: Sell Z2 = \$19\.89 \(di bawah batas \$26\.00 per arah\) — CANDIDATE, belum boleh dipasang\./);
});

test('AUDIT P0 total risiko: tiga kategori terpisah (kandidat awal / ditolak + alasan / lolos validator)', () => {
  const r = pipe4();
  const md = r.md;
  const iCand = md.indexOf('- Kandidat awal sebelum validator');
  const iRej = md.indexOf('- Dibatalkan validator (tidak dihitung)');
  const iPass = md.indexOf('- Lolos validator (total akhir');
  assert.ok(iCand > 0 && iRej > iCand && iPass > iRej, `${iCand} ${iRej} ${iPass}`);
  const cand = line(md, /^- Kandidat awal sebelum validator/);
  assert.match(cand, /BUKAN total dan bukan order aktif/);
  assert.match(cand, /Sell Z3 \$17\.69/);
  assert.match(cand, /Buy Z2 \$26\.20/);
  const rej = line(md, /^- Dibatalkan validator/);
  assert.match(rej, /Sell Z3 \(.+\)/);
  assert.match(rej, /Buy Z2 \(.+\)/);
  assert.doesNotMatch(rej, /Buy Z1|Buy Z3|Sell Z2/);
  assert.match(line(md, /^- Lolos validator \(total akhir; batas \$26\.00 per arah; semuanya hanya CANDIDATE\)/), /CANDIDATE/);
});

test('AUDIT P0 total risiko: kandidat ditolak (Sell Z3, Buy Z2) tidak disebut sebagai order aktif / total; satu baris total per arah', () => {
  const r = pipe4();
  const totalsLines = r.md.split('\n').filter((l) => /Total risiko per arah/.test(l));
  assert.ok(totalsLines.length >= 1);
  for (const l of totalsLines) assert.match(l, /BUY \$21\.78 \| SELL \$19\.89/);
  assert.equal(r.md.split('\n').filter((l) => /^- Total risiko per arah \(dihitung ulang/.test(l)).length, 1);
  const detail = sec(r.md, /Rincian Hitung Risiko/);
  assert.match(detail, /Sell Limit Zona 3: tidak ada order/);
  assert.match(detail, /Buy Limit Zona 2: tidak ada order/);
  assert.doesNotMatch(detail, /\$17\.69|\$26\.20/);
});

test('AUDIT P0 total risiko: Bagian 3, 4B, Rincian, ringkasan, dan catatan verifikasi memakai angka yang sama; tabel tidak berubah', () => {
  const r = pipe4();
  const led = ledgerOf(r.md, { dec: DEC });
  assert.equal(led.get('BUY1').risk, 5.33);
  assert.equal(led.get('BUY3').risk, 16.45);
  assert.equal(led.get('SELL2').risk, 19.89);
  assert.equal(led.get('BUY2').active, false);
  assert.equal(led.get('SELL3').active, false);
  assert.match(sec(r.md, /Rincian Hitung Risiko/), /Buy Limit Zona 3: 0\.01 lot x 16\.45 x 100 = \$16\.45/);
  assert.match(r.md, /BUY \$21\.78 \| SELL \$19\.89 \(batas \$26\.00 per arah\)/);
});

test('AUDIT P0 WAIT & SEE: tidak ada instruksi pasang / kata "posisi aktif" dan KANDIDAT ORDER tetap', () => {
  const r = pipe4();
  assert.match(r.md, /^\*\*4B\. KANDIDAT ORDER — BELUM BOLEH DIPASANG\*\*$/m);
  const advice = r.md.split('\n').filter((l) => !/^\s*[|>]/.test(l) && /\b(pasang|memasang)\b/i.test(l) && !/jangan|belum boleh|dihapus server|candidate|kandidat/i.test(l) && !/^\*\*Aturan Pasang \(/.test(l));
  assert.deepEqual(advice, []);
  assert.doesNotMatch(r.md, /order aktif yang lolos|posisi aktif/);
});

test('AUDIT P0 total risiko: status TRADE tidak menghapus rencana Gemini dan tetap memakai total final', () => {
  const r = pipe4({ status: 'TRADE', dir: 'BUY' });
  assert.match(r.md, /- BUY: Buy Z1 \+ Buy Z3 = \$21\.78 \(di bawah batas \$26\.00 per arah\)\./);
  assert.doesNotMatch(r.md, /37\.58|47\.98/);
});

test('AUDIT P0 SELL sisi lain: tanpa blok risiko dari Gemini pun ringkasan 3 kategori disisipkan dan idempoten', () => {
  const r = pipe4();
  const again = finalizeOrders(r.md, { status: 'WAIT', dir: null, maxRiskUsd: 26, dec: DEC, candidates: r.c.candidates });
  assert.equal(again.markdown, r.md);
  assert.equal((r.md.match(/^\*\*Aturan Pasang \(/gm) || []).length, 1);
});

test('AUDIT P0 invalidation lintas zona: "Buy Zona 2 dan Buy Zona 3 batal bila … 3527.11" dipecah; Buy Z2 -> WAIT / NO TRADE; Buy Z3 SL bukan invalidation', () => {
  const r = pipe4();
  const sc = scen(r.md).join('\n');
  assert.doesNotMatch(sc, /Buy Zona 2 dan Buy Zona 3/);
  assert.match(line(r.md, /^- WAIT \/ NO TRADE — Buy Zona 2:/), /tidak ada order/);
  const b3 = line(r.md, /^- Buy Zona 3:/);
  assert.ok(b3, sc);
  assert.match(b3, /SL 3527\.11 = batas risiko posisi/);
  assert.ok(b3.includes(UNDEFINED_TEXT));
  assert.doesNotMatch(b3, /close di bawah 3527\.11/);
  // satu baris = satu sisi + satu nomor zona
  for (const l of scen(r.md)) assert.ok(([...l.matchAll(/\b(?:buy|sell)(?:\s+limit)?\s+zona\s*\d/gi)].length) <= 1, l);
});

test('AUDIT P0 invalidation: kalimat umum "Semua order batal bila struktur H1 berubah arah" dihapus; aturan "Hapus pending" tetap', () => {
  const r = pipe4();
  assert.doesNotMatch(r.md, /Semua order batal bila struktur H1 berubah arah/);
  assert.ok(r.md.includes('- Hapus pending jika TP1 tersentuh sebelum order terisi.'));
  assert.ok(r.inv.notes.some((n) => /kalimat umum tanpa sisi\/nomor zona dihapus/.test(n)));
});

test('AUDIT P0 invalidation: SL tidak pernah jadi invalidation (Buy Z1 3605.50, Sell Z2 3662.61, Buy Z3 3527.11) dan tidak ada level karangan', () => {
  const r = pipe4();
  for (const [name, sl] of [['Buy Zona 1', '3605.50'], ['Sell Zona 2', '3662.61'], ['Buy Zona 3', '3527.11']]) {
    const l = line(r.md, new RegExp(`^- ${name}:`));
    assert.ok(l, name);
    assert.match(l, new RegExp(`SL ${sl} = batas risiko posisi`));
    assert.ok(l.includes(UNDEFINED_TEXT), l);
  }
});

test('AUDIT P0 invalidation: lintas zona Sell (Sell Zona 2 & Sell Zona 3) dan idempotensi', () => {
  const md = LIVE4.replace('- Buy Zona 2 dan Buy Zona 3 batal bila candle H1/H4 close di bawah 3527.11.', '- Sell Zona 2 dan Sell Zona 3 batal bila H1 close di atas 3678.03.');
  const r = pipeline(md, { quote: Q4, analyses: ANALYSES2 });
  assert.match(line(r.md, /^- Sell Zona 2:/), /SL 3662\.61/);
  assert.match(line(r.md, /^- WAIT \/ NO TRADE — Sell Zona 3:/), /tidak ada order/);
  const i2 = syncInvalidation(r.md, { analyses: ANALYSES2, dec: DEC });
  assert.equal(i2.markdown, r.md);
});

// ---- overlap OB/FVG
test('AUDIT P1 overlap: BUY Zona 3 (3529.96–3543.56) — H1 FVG mencakup seluruh zona, H4 FVG hanya 10% (3542.22–3543.56)', () => {
  const r = pipe4();
  const it = r.ov.items.find((x) => x.key === 'BUY3');
  assert.ok(it && it.multi);
  const h1 = it.labels.find((x) => x.label === 'H1 FVG'), h4 = it.labels.find((x) => x.label === 'H4 FVG');
  assert.ok(h1.cover > 0.999);
  assert.ok(Math.abs(h4.cover - 1.34 / 13.6) < 1e-6);
  assert.ok(Math.abs(it.common[0][0] - 3542.22) < 1e-9 && Math.abs(it.common[0][1] - 3543.56) < 1e-9);
  assert.ok(Math.abs(it.commonRatio - 1.34 / 13.6) < 1e-6);
  const note = r.ov.notes.find((n) => n.includes('BUY Zona 3'));
  assert.match(note, /H1 FVG mencakup seluruh zona; H4 FVG hanya 10% zona \(3542\.22–3543\.56\)/);
  assert.match(note, /bukan seluruh zona/);
  assert.match(note, /Irisan penuh antar dasar \(tanpa batas zona\): 3542\.22–3568\.22/);
  assert.match(note, /Koordinat zona tidak diubah/);
});

test('AUDIT P1 overlap: label konfluensi ditandai parsial; seluruh BUY Zona 3 tidak diklaim overlap H1/H4', () => {
  const r = pipe4();
  const row = line(r.md, /^\| BUY Zona 3/);
  assert.match(row, /🧩 KONFLUENSI PARSIAL \(irisan H1∩H4 hanya 10% zona\)/);
  assert.match(row, /Dasar: H4 FVG \(hanya 10% zona: 3542\.22–3543\.56\), H1 FVG\b(?! \(hanya)/);
  assert.doesNotMatch(row, /overlap H1\/H4 penuh|seluruh zona beririsan/);
});

test('AUDIT P1 overlap: zona satu TF (BUY Zona 1) tidak diberi tanda; Entry/SL/TP/lot/R:R/koordinat zona tidak berubah', () => {
  const r = pipe4();
  assert.doesNotMatch(line(r.md, /^\| BUY Zona 1/), /KONFLUENSI PARSIAL/);
  const base = pipe4({ analyses: ANALYSES });
  const grab = (md) => md.split('\n').filter((l) => /^\| (?:BUY|SELL|Buy|Sell)/.test(l)).map((l) => l.split('|').slice(2, 9).map((x) => x.trim().replace(/\s*⚠️ ZONA SEMPIT[^|]*$/, '').replace(/ \(hanya [^)]*\)/g, '')).join('|'));
  assert.deepEqual(grab(r.md), grab(base.md));
  const led = ledgerOf(r.md, { dec: DEC });
  assert.deepEqual([led.get('BUY3').lo, led.get('BUY3').hi, led.get('BUY3').entry, led.get('BUY3').sl, led.get('BUY3').tp1], [3529.96, 3543.56, 3543.56, 3527.11, 3578]);
});

test('AUDIT P1 overlap: SELL — M15 OB hanya sebagian zona diberi keterangan; tanpa data mesin tidak ada perubahan; idempoten', () => {
  const md = LIVE4.replace('Dasar: M15 FVG, H1 FVG |', 'Dasar: M15 FVG, M15 OB, H1 FVG |');
  const r = pipeline(md, { quote: Q4, analyses: ANALYSES2 });
  const row = line(r.md, /^\| SELL Zona 2/);
  assert.match(row, /M15 OB \(hanya 37% zona: 3645\.07–3646\.46\)/);
  assert.match(row, /KONFLUENSI PARSIAL \(irisan M15∩H1 hanya 37% zona\)/);
  assert.equal(zoneOverlap(r.md, { analyses: null, dec: DEC }).markdown, r.md);
  const again = zoneOverlap(r.md, { analyses: ANALYSES2, dec: DEC });
  assert.equal(again.markdown, r.md);
});

test('AUDIT P1 overlap: dasar tanpa irisan (hanya menyentuh tepi) diberi keterangan, bukan dihitung konfluensi', () => {
  const md = LIVE4.replace('Dasar: M15 FVG |', 'Dasar: M15 FVG, M5 OB |');
  const an = ANALYSES2.map((a) => (a.timeframe === 'M5' ? { ...a, orderBlocks: [{ type: 'BULLISH', low: 3610.83, high: 3615.0, status: 'FRESH' }] } : a));
  const r = pipeline(md, { quote: Q4, analyses: an });
  assert.match(line(r.md, /^\| BUY Zona 1/), /M5 OB \(hanya menyentuh tepi zona, tanpa irisan\)/);
});

test('route: overlap & kandidat risiko terpasang di route', () => {
  const src = fs.readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ zoneOverlap \} from '@\/lib\/overlap'/);
  assert.match(src, /zoneOverlap\(md, \{ analyses: smcAnalyses/);
  assert.match(src, /candidates: checked\?\.candidates \|\| \[\]/);
});
