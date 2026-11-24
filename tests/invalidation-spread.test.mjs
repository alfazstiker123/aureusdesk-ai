import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { reconcileZones, cancelMismatched, syncNarrative, finalizeOrders, ledgerOf } from '../lib/finalSync.js';
import { syncInvalidation, labelConfirmationLevels, judgeClause, structuralLevels, UNDEFINED_TEXT } from '../lib/invalidation.js';
import { spreadInfo, spreadWarnings, assessZone, TAG, UNVERIFIED, SPREAD_ZONE_WARN_RATIO } from '../lib/spreadCheck.js';

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
  const fo = finalizeOrders(sp.markdown, { status, dir, maxRiskUsd: riskUsd, dec: DEC });
  return { inv, lab, sp, fo, md: fo.markdown, notes: [...inv.notes, ...lab.notes, ...sp.notes] };
}
const line = (md, re) => md.split('\n').find((l) => re.test(l));
const scen = (md) => { const a = md.split('\n'); const i = a.findIndex((l) => /Skenario Batal/.test(l)); const out = []; for (let k = i + 1; k < a.length && (/^\s*$/.test(a[k]) || /^\s*-/.test(a[k])); k++) if (a[k].trim()) out.push(a[k]); return out; };

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
  const advice = r.md.split('\n').filter((l) => !/^\s*[|>]/.test(l) && /\b(pasang|memasang)\b/i.test(l) && !/jangan|belum boleh|dihapus server|candidate|kandidat/i.test(l));
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
  const again = finalizeOrders(r.md, { status: 'WAIT', dir: null, maxRiskUsd: 26, dec: DEC });
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
