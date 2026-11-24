import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { reconcileZones, cancelMismatched, syncNarrative, deadKeys, pruneNotes, finalizeOrders, auditZoneNumbers, auditNarrative } from '../lib/finalSync.js';
import { buildDecision } from '../lib/decision.js';
import { isNeutralHeadline } from '../lib/consistency.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-'));
for (const f of ['riskCheck.js', 'brokerSpec.js', 'pairs.js', 'marketTime.js']) {
  fs.writeFileSync(path.join(tmp, f), fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8').replace(/'@\/lib\/([\w]+)'/g, "'./$1.js'"));
}
const { verifyRiskTables } = await import(pathToFileURL(path.join(tmp, 'riskCheck.js')).href);
const { PAIRS } = await import(pathToFileURL(path.join(tmp, 'pairs.js')).href);

// Kasus live XAUUSD 24 Nov 2026 14:05 WIB (audit): bias NETRAL, batas risiko $26 per arah.
const LIVE = `**BIAS UTAMA:** NETRAL - WAIT & SEE (H1/H4 BULLISH vs M15/M5 BEARISH)
**PAIR:** XAUUSD
**HARGA TERAKHIR:** 3621.84

> **Ringkasan Cepat**
> - 🎯 Rencana: Tunggu reaksi di dua zona terdekat - Supply M5 3624.51-3627.19 (sell) dan Demand M15 3608.25-3610.83 (buy); jangan kejar harga di tengah.

### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)

| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (FVG M15 Demand Dekat) (Netral - Tunggu Konfirmasi) | 3608.25 - 3610.83 | 3606.88 | 3628.94 | 3631.87 | M5 bullish engulfing; R:R ≈ 1:4.58 |
| BUY Zona 2 - Intraday (FVG H1-H4 Demand) - Dasar: H1 FVG BULLISH 3538.39-3568.22 (Netral - Tunggu Konfirmasi) | 3545.95 - 3553.31 | 3527.02 | 3600.40 | 3620.00 | Close M15 bullish; R:R ≈ 1:1.79 |
| BUY Zona 3 - Swing (FVG H1 Demand Besar) (Netral - Tunggu Konfirmasi) | 3529.96 - 3543.56 | 3527.02 | 3575.28 | 3600.40 | Close H1 bullish; R:R ≈ 1:1.92 |
| SELL Zona 1 - Scalping (FVG M5 Supply Terdekat) (Netral - Tunggu Konfirmasi) | 3624.51 - 3627.19 | 3628.60 | 3616.51 | 3613.52 | Rejection wick M5; R:R ≈ 1:1.96 |
| SELL Zona 2 - Intraday (FVG M15 + OB Bearish) (Netral - Tunggu Konfirmasi) | 3642.72 - 3646.46 | 3662.70 | 3611.46 | 3600.40 | Close M15 bearish; R:R ≈ 1:1.56 |
| SELL Zona 3 - Swing (OB H1 + FVG H4 Supply Kuat) (Netral - Tunggu Konfirmasi) | 3710.52 - 3721.63 | 3728.30 | 3678.00 | 3640.00 | Close H1 bearish; R:R ≈ 1:1.83 |

### 4. Rekomendasi Susunan Pending Order

**4B. Order Baru yang Disarankan**

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 1 (Scalping Supply M5 3624.51-3627.19) | 3624.51 | 3628.60 | 3616.51 | 4.09 | 0.01 | $4.09 | 1:1.96 | 24 Nov 2026, 16.06 WIB |
| Sell Limit Zona 2 (Intraday FVG M15/OB 3642.72-3646.46) | 3642.72 | 3662.70 | 3611.46 | 19.98 | 0.01 | $19.98 | 1:1.56 | 24 Nov 2026, 20.06 WIB |
| Sell Limit Zona 3 (Swing OB H1 3710.52-3721.63) | 3710.52 | 3728.30 | 3678.00 | 17.78 | 0.01 | $17.78 | 1:1.83 | 25 Nov 2026, 05.00 WIB |
| Buy Limit Zona 1 (Scalping FVG M15 3608.25-3610.83) | 3610.83 | 3606.88 | 3628.94 | 3.95 | 0.01 | $3.95 | 1:4.58 | 24 Nov 2026, 16.06 WIB |
| Buy Limit Zona 2 (Intraday FVG H1-H4 3538.60-3553.31) | 3553.31 | 3527.02 | 3600.40 | 26.29 | 0.01 | $26.29 | 1:1.79 | 24 Nov 2026, 20.06 WIB |
| Buy Limit Zona 3 (Swing FVG H1 3529.96-3543.56) | 3543.56 | 3527.02 | 3575.28 | 16.54 | 0.01 | $16.54 | 1:1.92 | 25 Nov 2026, 05.00 WIB |

**Aturan Pasang (Batas Risiko 2% = $26.00 per arah):**

- SELL: pasang Sell Z1 + Sell Z2 = $24.07 (aman). Jangan tambah Sell Z3 bersamaan -> total $41.85 melebihi batas.
- BUY: pasang Buy Z1 + Buy Z3 = $20.49 (aman). Buy Z2 tidak dipasang.

**Rincian Hitung Risiko**

- Sell Z1: 0.01 lot x 4.09 x 100 = $4.09
- Sell Z2: 0.01 lot x 19.98 x 100 = $19.98
- Sell Z3: 0.01 lot x 17.78 x 100 = $17.78
- Buy Z1: 0.01 lot x 3.95 x 100 = $3.95
- Buy Z2: 0.01 lot x 26.29 x 100 = $26.29
- Buy Z3: 0.01 lot x 16.54 x 100 = $16.54

**Skenario Batal (Invalidation Level)**

- Sell Z1 batal bila candle M5 close di atas 3628.60.
- Sell Z2 batal bila candle H1 close di atas 3662.70.
- Sell Z3 batal bila candle H4 close di atas 3728.30.
- Buy Z1 batal bila candle M15 close di bawah 3606.88.
- Buy Z2 dan Buy Z3 batal bila candle H1/H4 close di bawah 3527.02.
`;

const DEC = 2;
function run(md, { riskUsd = 26, status = null } = {}) {
  const p1 = reconcileZones(md, { dec: DEC });
  const c = verifyRiskTables(p1.markdown, riskUsd, PAIRS.XAUUSD, new Date('2026-11-24T07:06:00Z'), { last: 3621.84, capPerDirection: true, zones: 3 });
  const p2 = reconcileZones(c.markdown, { dec: DEC, mult: c.mult });
  const cm = p2.mismatches.length ? cancelMismatched(p2.markdown, p2.mismatches) : { markdown: p2.markdown };
  const nr = syncNarrative(cm.markdown, { dec: DEC, stale: [...p1.changes, ...p2.changes] });
  const decision = buildDecision({ markdown: nr.markdown, bias: 'BULLISH', neutral: isNeutralHeadline('NETRAL - WAIT & SEE (H1/H4 BULLISH vs M15/M5 BEARISH)') });
  const fo = finalizeOrders(nr.markdown, { status: status || decision.status, dir: null, maxRiskUsd: riskUsd, dec: DEC });
  return { p1, c, p2, nr, decision, md: fo.markdown, totals: fo.totals, live: fo.live };
}
const row = (md, re) => md.split('\n').find((l) => re.test(l));
const sec = (md, key) => md.split('\n').find((l) => l.startsWith(`| ${key}`));

test('P0: BUY Zona 3 R:R 1:1.92 (< 2.0) tidak masuk 4B dan tidak masuk total risiko', () => {
  const r = run(LIVE);
  assert.match(row(r.md, /^\| Buy Limit Zona 3/), /Tidak Ada Setup \(R:R Di Bawah Standar: Tidak Dipasang\)/);
  assert.doesNotMatch(row(r.md, /^\| Buy Limit Zona 3/), /3543\.56|16\.54|3575\.28/);
  assert.ok(r.c.notes.some((n) => /NO TRADE.*Buy Limit Zona 3.*R:R TP1 1:1\.92 di bawah standar Zona 3 Swing 1:2\.0/.test(n)), r.c.notes.join('\n'));
  assert.ok(Math.abs(r.c.totals.BUY - 3.95) < 0.01, `total BUY dari validator: ${r.c.totals.BUY}`);
  assert.ok(Math.abs(r.totals.BUY - 3.95) < 0.01);
  assert.doesNotMatch(r.md, /\$20\.49/);
});

test('P0: zona gagal R:R juga batal di Bagian 3 dan Rincian Hitung Risiko; SELL Zona 3 (1.83) sama', () => {
  const r = run(LIVE);
  assert.match(sec(r.md, 'BUY Zona 3'), /Tidak ada level valid \(tunggu\)/);
  assert.match(sec(r.md, 'SELL Zona 3'), /Tidak ada level valid \(tunggu\)/);
  assert.match(r.md, /- Buy Z3: tidak ada order \(R:R di bawah standar\)/);
  assert.match(r.md, /- Sell Z3: tidak ada order/);
  assert.doesNotMatch(r.md, /17\.78|16\.54/);
  assert.deepEqual(auditZoneNumbers(r.md, { dec: DEC, mult: r.c.mult }), []);
});

test('R:R tepat di standar (Zona 3 = 2.00) tetap lolos; 1.5 untuk zona lain', () => {
  const ok = LIVE.replace('| 3575.28 | 3600.40 | Close H1 bullish; R:R ≈ 1:1.92 |', '| 3576.62 | 3600.40 | Close H1 bullish; R:R ≈ 1:2.00 |')
    .replace('| 3543.56 | 3527.02 | 3575.28 | 16.54 | 0.01 | $16.54 | 1:1.92 |', '| 3543.56 | 3527.02 | 3576.62 | 16.54 | 0.01 | $16.54 | 1:2.00 |');
  const r = run(ok);
  assert.match(row(r.md, /^\| Buy Limit Zona 3/), /3543\.56 \| 3527\.02 \| 3576\.62/);
  assert.ok(Math.abs(r.c.totals.BUY - (3.95 + 16.54)) < 0.01);
});

test('P0: keputusan WAIT & SEE -> semua order 4B berlabel CANDIDATE, tidak ada VALIDATED/pemasangan aktif', () => {
  const r = run(LIVE);
  assert.equal(r.decision.status, 'WAIT');
  const live = r.md.split('\n').filter((l) => /^\| (Sell|Buy) Limit Zona \d \(/.test(l) && /\d{4}\.\d\d \| \d{4}\.\d\d/.test(l));
  assert.equal(live.length, 3);
  for (const l of live) assert.match(l, /⏳ CANDIDATE \(belum boleh dipasang\)/);
  assert.doesNotMatch(r.md, /VALIDATED ORDER = lolos[^\n]*\(\d+ order\)/);
  assert.match(r.md, /Status order 4B:\*\* ⏳ Keputusan server = WAIT & SEE\. Semua order di tabel ini berstatus \*\*CANDIDATE ORDER\*\*/);
  assert.doesNotMatch(r.md, /pasang Sell Z1 \+ Sell Z2/);
  assert.match(r.md, /- SELL: Sell Z1 \+ Sell Z2 = \$24\.07 \(di bawah batas \$26\.00 per arah\) — CANDIDATE, belum boleh dipasang\./);
  assert.match(r.md, /- BUY: Buy Z1 = \$3\.95 .* CANDIDATE/);
  assert.match(r.md, /- ⏳ WAIT & SEE: jangan memasang order apa pun/);
});

test('keputusan TRADE: order searah bias = VALIDATED ORDER, countertrend tetap CANDIDATE', () => {
  const r0 = run(LIVE);
  const fo = finalizeOrders(r0.nr.markdown, { status: 'TRADE', dir: 'SELL', maxRiskUsd: 26, dec: DEC });
  assert.match(row(fo.markdown, /^\| Sell Limit Zona 1/), /✅ VALIDATED ORDER/);
  assert.match(row(fo.markdown, /^\| Buy Limit Zona 1/), /⏳ CANDIDATE/);
  assert.match(fo.markdown, /VALIDATED ORDER = lolos validator & searah bias \(2 order\)/);
  assert.match(fo.markdown, /Pasang hanya order berstatus VALIDATED ORDER/);
});

test('tidak ada order lolos -> banner WAIT / NO TRADE, tidak ada label order', () => {
  const none = LIVE.replace(/\| (Sell|Buy) Limit Zona [123] [^\n]*\n/g, '');
  const fo = finalizeOrders(none.replace(/\*\*4B\.[\s\S]*?(?=\*\*Aturan)/, '**4B. Order Baru yang Disarankan**\n\n'), { status: 'NO_TRADE', dir: null, maxRiskUsd: 26, dec: DEC });
  assert.match(fo.markdown, /⛔ WAIT \/ NO TRADE — tidak ada order yang lolos semua validator/);
  assert.match(fo.markdown, /- SELL: tidak ada order valid \(WAIT \/ NO TRADE\)\./);
  assert.match(fo.markdown, /- BUY: tidak ada order valid \(WAIT \/ NO TRADE\)\./);
});

test('P1: semua angka BUY Zona 2 konsisten (tidak ada entry 3545.95 / koordinat zona lama di tempat mana pun kecuali catatan alasan)', () => {
  const r = run(LIVE);
  const notes = pruneNotes(['ℹ️ Bagian 3 BUY Zona 2: entry 3545.95 berjarak $75.89 (759 pips) dari harga 3621.84 — lebih jauh dari rentang tipikal.', '📐 BUY Zona 2: entry/SL diselaraskan (sebelumnya 3545.95).', '🔁 BUY Zona 1: R:R 4B dihitung ulang → 1:4.58.'], deadKeys(r.md, { dec: DEC }));
  assert.deepEqual(notes, ['🔁 BUY Zona 1: R:R 4B dihitung ulang → 1:4.58.']);
  assert.match(sec(r.md, 'BUY Zona 2'), /Tidak ada level valid \(tunggu\)/);
  assert.match(row(r.md, /^\| Buy Limit Zona 2/), /Tidak Ada Setup/);
  const z2rows = [sec(r.md, 'BUY Zona 2'), row(r.md, /^\| Buy Limit Zona 2/)].join('\n');
  assert.doesNotMatch(z2rows, /3538\.|3545\.95|3553\.31|3568\.22|3527\.02|26\.29|3600\.40/);
  assert.match(r.md, /- Buy Z2: tidak ada order/);
  assert.match(r.md, /WAIT \/ NO TRADE — Buy Zona 2 & Buy Zona 3: tidak ada order/);
  assert.doesNotMatch(r.md, /Buy Z2 dan Buy Z3 batal bila/);
});

test('P1: total risiko dihitung ulang setelah pembatalan (hanya order aktif) di catatan verifikasi', () => {
  const r = run(LIVE);
  const line = r.md.split('\n').find((l) => /Total risiko per arah \(hanya order lolos validator\)/.test(l));
  assert.match(line, /BUY \$3\.95 \| SELL \$24\.07 \(batas \$26\.00 per arah\)/);
  assert.doesNotMatch(r.md, /\$41\.85|\$20\.49|\$44\.56|\$28\.02/);
  assert.ok(Math.abs(r.totals.BUY + r.totals.SELL - 28.02) < 0.011);
});

test('lot/risiko di 4B konsisten dengan tabel setelah semua pembatalan; audit angka & teks bebas bersih', () => {
  const r = run(LIVE);
  assert.deepEqual(auditZoneNumbers(r.md, { dec: DEC, mult: r.c.mult }), []);
  assert.deepEqual(auditNarrative(r.md, { dec: DEC }), []);
  const sells = r.md.split('\n').filter((l) => /^\| Sell Limit Zona [12] /.test(l));
  assert.equal(sells.length, 2);
  assert.match(sells[0], /\| 4\.09 \| 0\.01 \| \$4\.09 \|/);
  assert.match(sells[1], /\| 19\.98 \| 0\.01 \| \$19\.98 \|/);
});

test('idempoten: finalizeOrders dua kali tidak menggandakan label/banner', () => {
  const r = run(LIVE);
  const again = finalizeOrders(r.md, { status: 'WAIT', dir: null, maxRiskUsd: 26, dec: DEC });
  assert.equal((again.markdown.match(/CANDIDATE \(belum boleh dipasang\)/g) || []).length, 3);
  assert.equal((again.markdown.match(/Status order 4B/g) || []).length, 1);
  assert.equal(again.markdown, r.md);
});

test('route: status order & pruning catatan terhubung setelah keputusan; lampiran kandidat menandai zona batal', () => {
  const src = fs.readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8');
  assert.match(src, /finalizeOrders\(markdown, \{ status: decision\.status/);
  assert.ok(src.indexOf('finalizeOrders(markdown') < src.indexOf('markdown = insertDecision(markdown'));
  assert.match(src, /pruneNotes\(g\.notes \|\| \[\], dead\)/);
  assert.match(src, /markDeadCandidates\(mt4ContextUsed\.zoneCandidates, deadZones\)/);
});
