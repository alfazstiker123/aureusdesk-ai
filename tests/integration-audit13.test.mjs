// Integrasi Audit #13: total-line + A/B/C + stale-identity (Fix3) + overlap/tick size (Tahap 3c) berjalan bersama dalam urutan route.js.
// Urutan route: zoneOverlap -> (buildDecision, finalizeOrders) -> syncOrderLabels -> syncSummaryPlan -> flagStaleStructure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zoneOverlap } from '../lib/overlap.js';
import { flagStaleStructure } from '../lib/staleStructure.js';
import { syncOrderLabels } from '../lib/biasFinal.js';

const f = (low, high, status = 'FRESH', type = 'BULLISH') => ({ type, low, high, status });
const REP = `### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)

| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (Netral - Tunggu Konfirmasi) | 3500.00 - 3510.00 | 3495.00 | 3515.00 | 3519.00 | Close bullish. - Dasar: M15 FVG, H1 OB, H4 FVG |

**Key Levels:** zona 3500.00-3510.00 (M15 FVG fresh); H4 FVG 3503.00-3507.00 sudah MITIGATED; H1 OB 3506.00-3515.00 fresh.

### 4. Rekomendasi Susunan Pending Order

**4B. Order Baru yang Disarankan**

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Buy Limit Zona 1 (Scalping) (Searah Bias) | 3510.00 | 3495.00 | 3515.00 | 15.00 | 0.01 | $15.00 | 1:0.33 | 25 Nov 2026, 19.09 WIB |
`;
const far = Array.from({ length: 8 }, (_, i) => f(3700 + i * 10, 3705 + i * 10, 'MITIGATED'));
const AN = [
  { timeframe: 'M15', status: 'OK', orderBlocks: [], fvgs: [f(3500, 3510)], zones: [{ ...f(3500, 3510), source: 'FVG' }] },
  { timeframe: 'H1', status: 'OK', orderBlocks: [f(3506, 3515)], fvgs: far, zones: [{ ...f(3506, 3515), source: 'ORDER_BLOCK' }] },
  // H4 FVG fresh hanya ada di zones (di luar 8 terakhir); H4 FVG lama MITIGATED berkoordinat dekat zona fresh M15
  { timeframe: 'H4', status: 'OK', orderBlocks: [], fvgs: [f(3503, 3507, 'MITIGATED'), ...far], zones: [{ ...f(3508, 3509), source: 'FVG' }] },
];
const chain = (md, { spec = null, final = 'BULLISH' } = {}) => {
  const ov = zoneOverlap(md, { analyses: AN, dec: 2, spec });
  const lab = syncOrderLabels(ov.markdown, final).markdown;
  const st = flagStaleStructure(lab, AN, { tick: 0.01 });
  return { ov, md: st.markdown, flagged: st.flagged };
};
const row3 = (m) => m.split('\n').find((l) => /^\| BUY Zona 1/.test(l));

test('S3 urutan route: anotasi overlap tidak membuat zona fresh ditandai basi; zona H4 MITIGATED sungguhan tetap ditandai', () => {
  const r = chain(REP);
  assert.match(r.md, /3503\.00-3507\.00 \[⚠️ H4 FVG MITIGATED/);                       // basi sungguhan -> ditandai
  assert.doesNotMatch(r.md, /3500\.00-3510\.00 \[⚠️/);                                   // fresh M15 -> tidak
  assert.doesNotMatch(row3(r.md), /\[⚠️/);                                                // baris Bagian 3 beserta anotasi overlap tidak tertempel penanda basi
  assert.doesNotMatch(r.md, /3506\.00-3515\.00 \[⚠️/);                                    // fresh H1 OB -> tidak
});
test('S3 FVG fresh yang hanya ada di zones (di luar 8 FVG terakhir) dikenali oleh overlap DAN penanda basi', () => {
  const md = REP.replace('Dasar: M15 FVG, H1 OB, H4 FVG', 'Dasar: M15 FVG, H4 FVG');
  const r = chain(md);
  assert.match(row3(r.md), /H4 FVG \(hanya 10% zona: 3508\.00–3509\.00\)/);              // overlap melihat zones
  const s = flagStaleStructure('zona fresh H4 FVG 3508.00-3509.00', AN, { tick: 0.01 });
  assert.equal(s.flagged.length, 0);                                                      // penanda basi melihat zones
});
test('S3 idempoten: seluruh rantai dua kali = sekali', () => {
  const once = chain(REP).md, twice = chain(once).md;
  assert.equal(twice, once);
});
test('S3 tick size: dengan spec valid vs tanpa spec hanya anotasi dasar yang berbeda; penanda basi identik; Entry/SL/TP identik', () => {
  const a = chain(REP.replace(', H4 FVG |', ', H4 FVG, H1 FVG |'), { spec: { ticksize: 0.01, valid: true } }), b = chain(REP.replace(', H4 FVG |', ', H4 FVG, H1 FVG |'), { spec: null });
  assert.deepEqual(a.flagged.map((x) => x.text ?? x), b.flagged.map((x) => x.text ?? x));
  assert.match(row3(a.md), /H1 FVG \(terpisah|H1 FVG \(tidak ada zona fresh/);
  assert.match(row3(b.md), /H1 FVG \(tidak ada zona fresh|H1 FVG \(terpisah/);
  const cells = (m) => row3(m).split("|").slice(2, 6).join("|");
  assert.equal(cells(a.md), cells(REP)); assert.equal(cells(b.md), cells(REP));
});
test('S3 label 4B mengikuti bias final tanpa mengganggu penanda basi dan overlap', () => {
  const r = chain(REP, { final: 'BEARISH' });
  assert.match(r.md, /\| Buy Limit Zona 1 \(Scalping\) \(Counter-Trend/);
  assert.doesNotMatch(r.md, /Buy Limit Zona 1 \(Scalping\) \(Searah Bias\)/);
  assert.match(r.md, /3503\.00-3507\.00 \[⚠️ H4 FVG MITIGATED/);
});
