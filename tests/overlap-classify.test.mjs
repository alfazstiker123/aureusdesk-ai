// Tahap 3: klasifikasi overlap (irisan / sentuh tepat di tepi / terpisah jarak positif) + daftar FVG lengkap (zones, bukan hanya 8 fvgs terakhir).
import test from 'node:test';
import assert from 'node:assert/strict';
import { zoneOverlap, freshByLabel } from '../lib/overlap.js';

const mk = (dec, lo, hi, dasar) => `### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)

| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (Netral - Tunggu Konfirmasi) | ${lo.toFixed(dec)} - ${hi.toFixed(dec)} | ${(lo - 5).toFixed(dec)} | ${(hi + 5).toFixed(dec)} | ${(hi + 9).toFixed(dec)} | Close bullish. R:R TP1 ±1:1.50. - Dasar: ${dasar} |

### 4. Rekomendasi Susunan Pending Order

**4B. Order Baru yang Disarankan**

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Buy Limit Zona 1 (Scalping) | ${hi.toFixed(dec)} | ${(lo - 5).toFixed(dec)} | ${(hi + 5).toFixed(dec)} | 5.00 | 0.01 | $5.00 | 1:1.50 | 25 Nov 2026, 19.09 WIB |
`;
const an = (tf, o = {}) => ({ timeframe: tf, status: 'OK', orderBlocks: [], fvgs: [], zones: [], ...o });
const fz = (low, high, extra = {}) => ({ type: 'BULLISH', low, high, status: 'FRESH', ...extra });
const row = (r) => r.markdown.split('\n').find((l) => /^\| BUY Zona 1/.test(l));
const PAIRS = [[2, 3500.0, 3510.0, 0.01], [3, 150.0, 150.4, 0.001], [5, 1.0840, 1.0850, 0.00001]];

// base: M15 FVG selalu beririsan penuh (agar baris tidak di-skip); H1 OB = dasar yang diuji
for (const [dec, lo, hi, tick] of PAIRS) {
  const base = fz(lo, hi);
  const run = (ob) => zoneOverlap(mk(dec, lo, hi, 'M15 FVG, H1 OB'), { dec, analyses: [an('M15', { fvgs: [base] }), an('H1', { orderBlocks: ob ? [ob] : [] })] });
  const tag = (r) => row(r).match(/H1 OB( \([^)]*\))?/)?.[1] || '';

  test(`dec=${dec}: irisan sebagian -> keterangan persen, bukan sentuh/terpisah`, () => {
    const r = run(fz(hi - (hi - lo) * 0.2, hi + 100 * tick));
    assert.match(tag(r), /hanya 20% zona/);
  });
  test(`dec=${dec}: sentuh tepat di tepi (gap 0) -> "menyentuh tepi"`, () => {
    assert.match(tag(run(fz(hi, hi + 100 * tick))), /menyentuh tepi zona, tanpa irisan/);
    assert.match(tag(run(fz(lo - 100 * tick, lo))), /menyentuh tepi zona, tanpa irisan/);
  });
  for (const n of [1, 3, 8, 55]) {
    test(`dec=${dec}: terpisah ${n} tick (atas dan bawah) -> "terpisah", BUKAN "menyentuh tepi"`, () => {
      const up = tag(run(fz(Number((hi + n * tick).toFixed(dec)), Number((hi + n * tick + 100 * tick).toFixed(dec)))));
      assert.match(up, new RegExp(`terpisah [0-9.]+ = ${n} tick dari zona, tanpa irisan`));
      assert.doesNotMatch(up, /menyentuh/);
      const dn = tag(run(fz(Number((lo - n * tick - 100 * tick).toFixed(dec)), Number((lo - n * tick).toFixed(dec)))));
      assert.match(dn, new RegExp(`terpisah [0-9.]+ = ${n} tick dari zona`));
    });
  }
  test(`dec=${dec}: idempoten dan koordinat zona/SL/TP tidak berubah`, () => {
    const r = run(fz(Number((hi + 8 * tick).toFixed(dec)), Number((hi + 108 * tick).toFixed(dec))));
    const again = zoneOverlap(r.markdown, { dec, analyses: [an('M15', { fvgs: [base] }), an('H1', { orderBlocks: [fz(Number((hi + 8 * tick).toFixed(dec)), Number((hi + 108 * tick).toFixed(dec)))] })] });
    assert.equal(again.markdown, r.markdown);
    const cells = (m) => row({ markdown: m }).split('|').slice(2, 6).join('|');
    assert.equal(cells(r.markdown), cells(mk(dec, lo, hi, 'M15 FVG, H1 OB')));
  });
}

test('tanpa zona fresh searah untuk label -> tidak mengklaim "menyentuh tepi"', () => {
  const r = zoneOverlap(mk(2, 3500, 3510, 'M15 FVG, H1 OB'), { dec: 2, analyses: [an('M15', { fvgs: [fz(3500, 3510)] }), an('H1')] });
  assert.match(row(r), /H1 OB \(tidak ada zona fresh searah/);
  assert.doesNotMatch(row(r), /menyentuh/);
});
test('zona bearish / mitigated tidak dihitung sebagai dasar BUY', () => {
  const r = zoneOverlap(mk(2, 3500, 3510, 'M15 FVG, H1 OB'), { dec: 2, analyses: [an('M15', { fvgs: [fz(3500, 3510)] }), an('H1', { orderBlocks: [fz(3500, 3510, { type: 'BEARISH' }), fz(3500, 3510, { status: 'MITIGATED' })] })] });
  assert.match(row(r), /H1 OB \(tidak ada zona fresh/);
});

// ---- daftar FVG lengkap
test('FVG fresh yang tidak masuk 8 entri terakhir (hanya ada di zones) ikut dicek: irisan terdeteksi', () => {
  const inZone = fz(3503, 3507, { source: 'FVG' });
  const far = Array.from({ length: 8 }, (_, i) => fz(3700 + i * 10, 3705 + i * 10));
  const A = [an('M15', { fvgs: [fz(3500, 3510)] }), an('H1', { fvgs: far, zones: [{ ...inZone }, ...far.map((z) => ({ ...z, source: 'FVG' }))] })];
  assert.ok(freshByLabel(A, 'BUY').get('H1 FVG').some((x) => x[0] === 3503 && x[1] === 3507));
  const r = zoneOverlap(mk(2, 3500, 3510, 'M15 FVG, H1 FVG'), { dec: 2, analyses: A });
  assert.match(row(r), /H1 FVG \(hanya 40% zona: 3503\.00–3507\.00\)/);
});
test('FVG di luar 8 terakhir yang terpisah N tick: jarak dihitung dari daftar lengkap (bukan "menyentuh")', () => {
  const sep = fz(3510.08, 3512, { source: 'FVG' });
  const A = [an('M15', { fvgs: [fz(3500, 3510)] }), an('H1', { fvgs: [fz(3600, 3601)], zones: [sep] })];
  assert.match(row(zoneOverlap(mk(2, 3500, 3510, 'M15 FVG, H1 FVG'), { dec: 2, analyses: A })), /H1 FVG \(terpisah 0\.08 = 8 tick dari zona/);
});
test('zones ORDER_BLOCK ikut sebagai OB; duplikat dengan orderBlocks tidak digandakan', () => {
  const ob = fz(3503, 3507);
  const A = [an('H1', { orderBlocks: [ob], zones: [{ ...ob, source: 'ORDER_BLOCK' }] })];
  assert.equal(freshByLabel(A, 'BUY').get('H1 OB').length, 1);
});
test('regresi: data lama tanpa field zones tetap berfungsi', () => {
  const A = [an('M15', { fvgs: [fz(3500, 3510)] }), an('H1', { zones: undefined, orderBlocks: [fz(3506, 3515)] })];
  assert.match(row(zoneOverlap(mk(2, 3500, 3510, 'M15 FVG, H1 OB'), { dec: 2, analyses: A })), /H1 OB \(hanya 40% zona/);
});
