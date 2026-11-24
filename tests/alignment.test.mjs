import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentOf } from '../lib/smc/alignment.js';
import { buildSmcReport } from '../lib/smc/engine.js';
import { buildDecision } from '../lib/decision.js';

const A = (o) => Object.entries(o).map(([timeframe, bias]) => ({ timeframe, status: 'OK', bias }));

test('SELARAS: H4, H1, M15 semuanya sama', () => {
  for (const b of ['BULLISH', 'BEARISH']) {
    const r = alignmentOf(A({ H4: b, H1: b, M15: b }));
    assert.equal(r.status, 'SELARAS'); assert.equal(r.alignment, true); assert.equal(r.warning, null);
  }
});
test('CAMPURAN: kasus laporan 24 Nov (H4 BULLISH, H1 BEARISH, M15 BULLISH) — dulu salah disebut SELARAS', () => {
  const r = alignmentOf(A({ H4: 'BULLISH', H1: 'BEARISH', M15: 'BULLISH' }));
  assert.equal(r.status, 'CAMPURAN'); assert.equal(r.alignment, false);
  assert.match(r.detail, /H4 BULLISH, H1 BEARISH, M15 BULLISH/);
  assert.match(r.warning, /Alignment CAMPURAN \(H4 BULLISH, H1 BEARISH, M15 BULLISH\)/);
  // definisi lama (hanya M15 vs H4, H1 diabaikan) memberi SELARAS pada data yang sama
  const an = A({ H4: 'BULLISH', H1: 'BEARISH', M15: 'BULLISH' });
  const oldAlign = an.find((x) => x.timeframe === 'M15').bias === an.find((x) => x.timeframe === 'H4').bias;
  assert.equal(oldAlign, true);
});
test('CAMPURAN: M15 melawan H4 walau H1 searah H4', () => {
  assert.equal(alignmentOf(A({ H4: 'BULLISH', H1: 'BULLISH', M15: 'BEARISH' })).status, 'CAMPURAN');
});
test('TIDAK DAPAT DINILAI: data tidak cukup dan yang tersedia tidak bertentangan', () => {
  assert.equal(alignmentOf(A({ H4: 'BULLISH', M15: 'BULLISH' })).status, 'TIDAK DAPAT DINILAI'); // H1 hilang
  assert.equal(alignmentOf(A({ H4: 'UNKNOWN', H1: 'BULLISH', M15: 'BULLISH' })).status, 'TIDAK DAPAT DINILAI');
  assert.equal(alignmentOf([]).status, 'TIDAK DAPAT DINILAI');
  const r = alignmentOf(A({ H1: 'BEARISH' }));
  assert.equal(r.alignment, null); assert.equal(r.warning, null);
  assert.match(r.detail, /H4 tidak tersedia/);
});
test('data tersedia sudah saling bertentangan -> CAMPURAN walau satu TF hilang', () => {
  assert.equal(alignmentOf(A({ H4: 'BULLISH', M15: 'BEARISH' })).status, 'CAMPURAN');
});
test('M5 dan TF lain tidak memengaruhi definisi; analisis non-OK diabaikan', () => {
  const base = A({ H4: 'BULLISH', H1: 'BULLISH', M15: 'BULLISH' });
  assert.equal(alignmentOf([...base, { timeframe: 'M5', status: 'OK', bias: 'BEARISH' }, { timeframe: 'D1', status: 'OK', bias: 'BEARISH' }]).status, 'SELARAS');
  assert.equal(alignmentOf([...base.slice(0, 2), { timeframe: 'M15', status: 'INSUFFICIENT', bias: 'BEARISH' }]).status, 'TIDAK DAPAT DINILAI');
});
test('urutan analisis masukan tidak memengaruhi hasil', () => {
  const a = A({ H4: 'BULLISH', H1: 'BEARISH', M15: 'BULLISH' });
  assert.deepEqual(alignmentOf([...a].reverse()), alignmentOf(a));
});

// ── integrasi mesin: laporan memuat status baru, bukan label lama ──
function bars(mirror = false) {
  const raw = [[10, 11, 9, 10], [10, 12, 9, 11], [11, 15, 10, 12], [12, 13, 10, 11], [11, 12, 9, 10], [10, 11, 8, 9], [9, 15.8, 8.5, 14.5], [14.5, 14.8, 12.5, 13.2], [13.2, 14, 12, 12.8], [12.8, 17, 12.5, 16]];
  for (let i = 0; i < 22; i++) raw.push([16 + (i % 2) * 0.1, 16.8, 15.4, 16.2]);
  return raw.map((x, i) => {
    const [o, h, l, c] = mirror ? [40 - x[0], 40 - x[2], 40 - x[1], 40 - x[3]] : x;
    return { time: 1_700_000_000 + i * 900, open: o, high: h, low: l, close: c };
  });
}
test('laporan mesin: alignmentInfo konsisten dengan bias per TF dan label lama tidak muncul', () => {
  const r = buildSmcReport({ H4: bars(false), H1: bars(true), M15: bars(false) });
  const by = Object.fromEntries(r.analyses.map((x) => [x.timeframe, x.bias]));
  assert.equal(r.alignmentInfo.status, alignmentOf(r.analyses).status);
  assert.equal(r.alignment, r.alignmentInfo.alignment);
  assert.match(r.promptBlock, /Alignment H4\/H1\/M15: (SELARAS|CAMPURAN|TIDAK DAPAT DINILAI) \(/);
  assert.match(r.compactBlock, /Alignment H4\/H1\/M15: \*\*(SELARAS|CAMPURAN|TIDAK DAPAT DINILAI)\*\*/);
  assert.doesNotMatch(r.promptBlock + r.compactBlock, /H4\/H1 ke M15|TIDAK SELARAS|BELUM CUKUP DATA/);
  if (by.H4 && by.H1 && by.H4 !== by.H1 && (by.H4 === 'BULLISH' || by.H4 === 'BEARISH') && (by.H1 === 'BULLISH' || by.H1 === 'BEARISH')) assert.equal(r.alignmentInfo.status, 'CAMPURAN');
});

// ── keputusan: hanya peringatan; status keputusan tidak berubah ──
const MD = `| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat |
|---|---|---|---|---|---|
| BUY Zona 2 - Intraday (Searah Bias) | 3538.60 - 3553.31 | 3527.02 | 3623.89 | 3641.72 | x |

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Buy Limit Zona 2 (Intraday) | 3553.31 | 3527.02 | 3623.89 | 26.29 | 0.01 | $26.29 | 1:2.68 | x |
`;
test('keputusan: CAMPURAN menampilkan peringatan berisi detail TF; status keputusan sama seperti SELARAS', () => {
  const info = alignmentOf(A({ H4: 'BULLISH', H1: 'BEARISH', M15: 'BULLISH' }));
  const campur = buildDecision({ markdown: MD, bias: 'BULLISH', alignment: info.alignment, alignmentWarning: info.warning });
  const sejalan = buildDecision({ markdown: MD, bias: 'BULLISH', alignment: true });
  assert.ok(campur.warnings.some((w) => /Alignment CAMPURAN \(H4 BULLISH, H1 BEARISH, M15 BULLISH\)/.test(w)));
  assert.equal(campur.status, sejalan.status);
  assert.equal(sejalan.warnings.some((w) => /CAMPURAN|belum selaras/.test(w)), false);
  assert.equal(buildDecision({ markdown: MD, bias: 'BULLISH', alignment: null }).warnings.some((w) => /selaras|CAMPURAN/.test(w)), false);
  assert.match(buildDecision({ markdown: MD, bias: 'BULLISH', alignment: false }).warnings.join(' '), /M15 belum selaras/); // jalur lama tetap
});
test('route meneruskan alignmentWarning ke keputusan', async () => {
  const fs = await import('node:fs');
  assert.match(fs.readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8'), /alignmentWarning: mt4ContextUsed\.smc\?\.alignmentInfo\?\.warning/);
});
