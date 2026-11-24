import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { reconcileZones, cancelMismatched, syncNarrative, finalizeOrders, auditZoneNumbers, auditNarrative } from '../lib/finalSync.js';
import { buildDecision } from '../lib/decision.js';
import { isNeutralHeadline } from '../lib/consistency.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-'));
for (const f of ['riskCheck.js', 'brokerSpec.js', 'pairs.js', 'marketTime.js']) {
  fs.writeFileSync(path.join(tmp, f), fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8').replace(/'@\/lib\/([\w]+)'/g, "'./$1.js'"));
}
const { verifyRiskTables } = await import(pathToFileURL(path.join(tmp, 'riskCheck.js')).href);
const { PAIRS } = await import(pathToFileURL(path.join(tmp, 'pairs.js')).href);

// Kasus live XAUUSD 24 Nov 2026 14:27 WIB (audit ke-7): total risiko di narasi Gemini masih memuat zona yang dibatalkan validator.
const LIVE2 = `**BIAS UTAMA:** NETRAL - WAIT & SEE (H4/H1 BULLISH, MOMENTUM M15/M5 BEARISH)
**PAIR:** XAUUSD
**HARGA TERAKHIR:** 3622.81

> **Ringkasan Cepat**
> - 🎯 Rencana: pasang Buy Limit Zona 3 di 3543.56 dan Sell Limit Zona 2 di 3642.72 saat harga menyentuh zona.

### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)

| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (FVG Bullish M15) (Netral - Tunggu Konfirmasi) | 3608.25 - 3610.83 (limit 3610.83) | 3606.89 | 3624.89 | 3640.07 | Tunggu rejection wick + close bullish M5; R:R ±1:3,5. - Dasar: M15 FVG |
| BUY Zona 2 - Intraday (FVG Bullish H1-H4) (Searah Bias H4/H1) | 3538.60 - 3553.31 (limit 3553.31) | 3527.02 | 3600.40 | 3678.03 | Close M15 bullish; R:R ±1:1,8. - Dasar: H1 FVG, H4 FVG |
| BUY Zona 3 - Swing (FVG Bullish H1-H4) (Searah Bias H4/H1) | 3529.96 - 3543.56 (limit 3543.56) | 3527.02 | 3611.46 | 3678.03 | Konfirmasi H4 close di atas 3543.56; R:R ±1:4,1. - Dasar: H1 FVG, H4 FVG |
| SELL Zona 1 - Scalping (OB/FVG M5) (Netral - Tunggu Konfirmasi) | Tidak ada level valid (tunggu) | - | - | - | - |
| SELL Zona 2 - Intraday (FVG/OB M15-H1) (Netral - Tunggu Konfirmasi) | 3642.72 - 3646.46 (limit 3642.72) | 3662.70 | 3602.36 | 3577.24 | Wajib close M15 di bawah 3642.72; R:R ±1:1,5. - Dasar: M15 OB, M15 FVG, H1 FVG |
| SELL Zona 3 - Swing (OB Bearish H1 + FVG H4) (Netral - Tunggu Konfirmasi) | 3710.52 - 3721.63 | 3728.30 | 3677.98 | 3640.00 | Close H1 bearish; R:R ±1:1,8. |

### 4. Rekomendasi Susunan Pending Order

**4B. Order Baru yang Disarankan**

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 1 (Scalping Supply Terdekat) | Tidak Ada Setup (Tunggu) | - | - | - | - | - | - | - |
| Sell Limit Zona 2 (Intraday FVG M15-H1) | 3642.72 | 3662.70 | 3602.36 | 19.98 | 0.01 | $19.98 | 1:2.02 | 24 Nov 2026, 20.00 WIB |
| Sell Limit Zona 3 (Swing OB H1 / FVG H4) | 3710.52 | 3728.30 | 3677.98 | 17.78 | 0.01 | $17.78 | 1:1.83 | 25 Nov 2026, 05.00 WIB |
| Buy Limit Zona 1 (Scalping FVG M15) | 3610.83 | 3606.89 | 3624.89 | 3.94 | 0.01 | $3.94 | 1:3.57 | 24 Nov 2026, 16.00 WIB |
| Buy Limit Zona 2 (Intraday FVG H1-H4) | 3553.31 | 3527.02 | 3600.40 | 26.29 | 0.01 | $26.29 | 1:1.79 | 24 Nov 2026, 20.00 WIB |
| Buy Limit Zona 3 (Swing FVG H1-H4) | 3543.56 | 3527.02 | 3611.46 | 16.54 | 0.01 | $16.54 | 1:4.11 | 25 Nov 2026, 05.00 WIB |

**Rincian Hitung Risiko**
- Sell Limit Zona 2: 0.01 lot x 19.98 x 100 = $19.98
- Sell Limit Zona 3: 0.01 lot x 17.78 x 100 = $17.78
- Buy Limit Zona 1: 0.01 lot x 3.94 x 100 = $3.94
- Buy Limit Zona 2: 0.01 lot x 26.29 x 100 = $26.29
- Buy Limit Zona 3: 0.01 lot x 16.54 x 100 = $16.54

⚠️ **Catatan Kepatuhan Risiko (batas $26 per arah):**
- Lot minimum 0.01 sudah menghasilkan risiko besar karena SL lebar. Total SELL (Z2+Z3) = $37.76 dan total BUY (Z1+Z2+Z3) = $46.77, keduanya melebihi $26.
- SELL: pilih HANYA SATU zona. Disarankan Sell Zona 2 ($19.98) karena lebih dekat; Sell Zona 3 ($17.78) sebagai alternatif.
- BUY: kombinasi yang PAS adalah Buy Zona 1 + Buy Zona 3 = $20.48 (<= $26). Buy Zona 2 ($26.29 sendirian) sudah melebihi batas, jadi lewati atau kecilkan cakupan SL-nya sesuai izin broker.
- Jika lot 0.01 pun dianggap terlalu besar, jangan buka order tersebut.

**Skenario Batal (Invalidation Level)**
- Sell Zona 2: candle M15 close di atas 3662.70.
- Buy Zona 1: candle M15 close di bawah 3606.89.
`;
const DEC = 2;
function run(md, { riskUsd = 26, status = 'WAIT', dir = null } = {}) {
  const p1 = reconcileZones(md, { dec: DEC });
  const c = verifyRiskTables(p1.markdown, riskUsd, PAIRS.XAUUSD, new Date('2026-11-24T07:27:00Z'), { last: 3622.81, capPerDirection: true, zones: 3 });
  const p2 = reconcileZones(c.markdown, { dec: DEC, mult: c.mult });
  const cm = p2.mismatches.length ? cancelMismatched(p2.markdown, p2.mismatches) : { markdown: p2.markdown };
  const nr = syncNarrative(cm.markdown, { dec: DEC, stale: [...p1.changes, ...p2.changes] });
  const fo = finalizeOrders(nr.markdown, { status, dir, maxRiskUsd: riskUsd, dec: DEC });
  return { c, p2, nr, fo, md: fo.markdown };
}
const line = (md, re) => md.split('\n').find((l) => re.test(l));

test('P0: Catatan Kepatuhan Risiko dibangun ulang dari order yang lolos (BUY $20.48, SELL $19.98), bukan $46.77 / $37.76', () => {
  const r = run(LIVE2);
  assert.doesNotMatch(r.md, /37\.76|46\.77|pilih HANYA SATU|kombinasi yang PAS|Disarankan Sell Zona 2|sebagai alternatif|lewati atau kecilkan/);
  assert.doesNotMatch(r.md, /Catatan Kepatuhan Risiko/);
  assert.match(r.md, /\*\*Aturan Pasang \(batas risiko \$26\.00 per arah; dihitung ulang server dari order yang lolos validator\):\*\*/);
  assert.match(r.md, /- SELL: Sell Z2 = \$19\.98 \(di bawah batas \$26\.00 per arah\) — CANDIDATE, belum boleh dipasang\./);
  assert.match(r.md, /- BUY: Buy Z1 \+ Buy Z3 = \$20\.48 \(di bawah batas \$26\.00 per arah\) — CANDIDATE, belum boleh dipasang\./);
  assert.match(r.md, /- Dibatalkan validator \(tidak dihitung\): Sell Z3 \(R:R Di Bawah Standar\), Buy Z2 \(Batas Risiko\)\./);
  assert.ok(Math.abs(r.fo.totals.BUY - 20.48) < 0.011 && Math.abs(r.fo.totals.SELL - 19.98) < 0.011);
});

test('semua teks risiko memakai satu sumber: catatan verifikasi, Aturan Pasang, dan tabel 4B sama', () => {
  const r = run(LIVE2);
  const note = line(r.md, /Total risiko per arah \(hanya order lolos validator\)/);
  assert.match(note, /BUY \$20\.48 \| SELL \$19\.98 \(batas \$26\.00 per arah\)/);
  const money = [...r.md.matchAll(/\$(\d+\.\d\d)/g)].map((m) => m[1]);
  for (const stale of ['37.76', '46.77', '17.78', '26.29']) {
    // $17.78 / $26.29 hanya boleh muncul pada catatan alasan pembatalan validator, tidak di total/aturan pasang
    const where = r.md.split('\n').filter((l) => l.includes(`$${stale}`));
    assert.ok(where.every((l) => /NO TRADE|TIDAK DIPASANG|melebihi batas \$26\.00 \(anggaran/.test(l)), `${stale}: ${where.join(' || ')}`);
  }
  assert.ok(money.length > 5);
});

test('WAIT & SEE: tidak ada teks yang menyarankan memasang order (Rencana Ringkasan Cepat ikut dibersihkan)', () => {
  const r = run(LIVE2);
  const plan = line(r.md, /Rencana/);
  assert.match(plan, /WAIT & SEE — saran pemasangan\/pemilihan order dihapus server/);
  assert.doesNotMatch(plan, /pasang Buy Limit Zona 3/i);
  const advice = r.md.split('\n').filter((l) => !/^\s*[|>]/.test(l) && /\b(pasang|memasang|pilih|disarankan|kombinasi)\b/i.test(l) && /\b(buy|sell)\s*(limit\s*)?(zona|z)\s*\d/i.test(l) && !/candidate|kandidat|jangan|belum boleh|dihapus server/i.test(l));
  assert.deepEqual(advice, []);
});

test('saat keputusan TRADE saran/rencana Gemini tidak dihapus (hanya total yang dihitung ulang)', () => {
  const r = run(LIVE2, { status: 'TRADE', dir: 'BUY' });
  assert.match(line(r.md, /Rencana/), /pasang Buy Limit Zona 3 di 3543\.56/);
  assert.match(r.md, /- BUY: Buy Z1 \+ Buy Z3 = \$20\.48 \(di bawah batas \$26\.00 per arah\)\./);
  assert.doesNotMatch(r.md, /37\.76|46\.77/);
});

test('baris total risiko lepas di luar blok juga dihitung ulang (tidak menyisakan angka lama)', () => {
  const md = LIVE2.replace('**Rincian Hitung Risiko**', 'Total SELL (Z2+Z3) = $37.76 melebihi batas.\n\n**Rincian Hitung Risiko**');
  const r = run(md);
  assert.doesNotMatch(r.md, /37\.76/);
  assert.match(r.md, /Total risiko per arah \(dihitung ulang dari order aktif\): BUY \$20\.48 \| SELL \$19\.98 \(batas \$26\.00 per arah\)\./);
});

test('teks R:R Bagian 3 bergaya "±1:1,5" (koma desimal, tanda ±) ikut diganti R:R final', () => {
  const r = run(LIVE2);
  assert.match(line(r.md, /^\| SELL Zona 2/), /R:R ±1:2\.02/);
  assert.match(line(r.md, /^\| BUY Zona 1/), /R:R ±1:3\.57/);
  assert.match(line(r.md, /^\| BUY Zona 3/), /R:R ±1:4\.11/);
  assert.doesNotMatch(r.md, /±1:1,5|±1:3,5|±1:4,1/);
  assert.deepEqual(auditZoneNumbers(r.md, { dec: DEC, mult: r.c.mult }), []);
  assert.deepEqual(auditNarrative(r.md, { dec: DEC }), []);
});

test('idempoten: menjalankan finalizeOrders lagi tidak mengubah apa pun', () => {
  const r = run(LIVE2);
  const again = finalizeOrders(r.md, { status: 'WAIT', dir: null, maxRiskUsd: 26, dec: DEC });
  assert.equal(again.markdown, r.md);
});
