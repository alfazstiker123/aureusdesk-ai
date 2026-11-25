// Tahap 3b: tick size dari brokerSpec.ticksize (bukan 10^-dec). Tanpa spesifikasi valid: jarak absolut, tanpa klaim jumlah tick.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zoneOverlap } from '../lib/overlap.js';

const mk = (dec, lo, hi) => `### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)

| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (Netral - Tunggu Konfirmasi) | ${lo.toFixed(dec)} - ${hi.toFixed(dec)} | ${(lo - 5).toFixed(dec)} | ${(hi + 5).toFixed(dec)} | ${(hi + 9).toFixed(dec)} | Close bullish. R:R TP1 ±1:1.50. - Dasar: M15 FVG, H1 OB |

### 4. Rekomendasi Susunan Pending Order

**4B. Order Baru yang Disarankan**

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Buy Limit Zona 1 (Scalping) | ${hi.toFixed(dec)} | ${(lo - 5).toFixed(dec)} | ${(hi + 5).toFixed(dec)} | 5.00 | 0.01 | $5.00 | 1:1.50 | 25 Nov 2026, 19.09 WIB |
`;
const fz = (low, high) => ({ type: 'BULLISH', low, high, status: 'FRESH' });
const an = (lo, hi, h1) => [{ timeframe: 'M15', status: 'OK', orderBlocks: [], fvgs: [fz(lo, hi)] }, { timeframe: 'H1', status: 'OK', fvgs: [], orderBlocks: [fz(h1[0], h1[1])] }];
const tagOf = (md) => md.split('\n').find((l) => /^\| BUY Zona 1/.test(l)).match(/H1 OB( \([^)]*\))?/)?.[1]?.trim() || '';
const r5 = (x, d = 8) => Number(x.toFixed(d));
// pair: [dec profil, lo, hi]
const P = { XAUUSD: [2, 3500, 3510], USDJPY: [3, 150, 150.4], USDCAD: [5, 1.43, 1.432], EURUSD: [5, 1.084, 1.085] };
const run = (pid, { ticksize, gapAbs, spec, side = 'up' }) => {
  const [dec, lo, hi] = P[pid];
  const a = side === 'up' ? r5(hi + gapAbs) : r5(lo - gapAbs - 1000 * (ticksize || 10 ** -dec));
  const b = side === 'up' ? r5(hi + gapAbs + 1000 * (ticksize || 10 ** -dec)) : r5(lo - gapAbs);
  return tagOf(zoneOverlap(mk(dec, lo, hi), { dec, spec, analyses: an(lo, hi, [a, b]) }).markdown);
};
const V = (ticksize, extra = {}) => ({ ticksize, point: ticksize, digits: 0, valid: true, ...extra });

// --- ticksize sama dengan 10^-digits (kondisi broker nyata Jarocel), 1/3/8/55 tick aktual, 4 pair
for (const [pid, [dec]] of Object.entries(P)) {
  for (const n of [1, 3, 8, 55]) {
    test(`${pid}: ticksize = 10^-digits (${dec}) -> ${n} tick aktual`, () => {
      const t = 10 ** -dec;
      const tag = run(pid, { ticksize: t, gapAbs: n * t, spec: V(t) });
      assert.match(tag, new RegExp(`= ${n} tick @`));
      assert.doesNotMatch(tag, /menyentuh|belum tersedia/);
    });
  }
}
// --- ticksize berbeda dari 10^-digits (lebih besar), jumlah tick aktual = gap / ticksize
for (const [pid, mult] of [['XAUUSD', 5], ['USDJPY', 10], ['USDCAD', 5], ['EURUSD', 10]]) {
  const dec = P[pid][0], t = r5(mult * 10 ** -dec);
  for (const n of [1, 3, 8, 55]) {
    test(`${pid}: ticksize ${t} (${mult}x lebih besar dari 10^-dec) -> ${n} tick aktual, bukan ${n * mult}`, () => {
      const tag = run(pid, { ticksize: t, gapAbs: r5(n * t), spec: V(t, { point: 10 ** -dec }) });
      assert.match(tag, new RegExp(`= ${n} tick @${t}`));
      assert.doesNotMatch(tag, new RegExp(`= ${n * mult} tick`));
    });
  }
}
// --- ticksize lebih kecil dari 10^-dec (digits broker lebih banyak): gap kecil tidak lagi disebut "menyentuh"
test('XAUUSD digits 3 (ticksize 0.001, dec profil 2): gap 0.004 = 4 tick aktual, bukan "menyentuh tepi"', () => {
  const tag = run('XAUUSD', { ticksize: 0.001, gapAbs: 0.004, spec: V(0.001, { digits: 3 }) });
  assert.match(tag, /terpisah 0\.004 = 4 tick @0\.001/);
  assert.doesNotMatch(tag, /menyentuh/);
});
test('USDCAD ticksize 0.00005 (lebih besar dari point 0.00001, digits 5): 0.00055 = 11 tick', () => {
  assert.match(run('USDCAD', { ticksize: 0.00005, gapAbs: 0.00055, spec: V(0.00005, { point: 0.00001, digits: 5 }) }), /= 11 tick @0\.00005/);
});
test('ticksize berbeda dari point DAN dari digits (XAUUSD ticksize 0.05, point 0.01, digits 2): 0.55 = 11 tick', () => {
  assert.match(run('XAUUSD', { ticksize: 0.05, gapAbs: 0.55, spec: V(0.05, { point: 0.01, digits: 2 }) }), /terpisah 0\.55 = 11 tick @0\.05/);
});
// --- toleransi sentuh tepi memakai ticksize aktual (setengah tick)
test('sentuh tepi: gap <= setengah tick AKTUAL = menyentuh; gap > setengah tick aktual = terpisah (ticksize 0.05)', () => {
  assert.match(run('XAUUSD', { ticksize: 0.05, gapAbs: 0, spec: V(0.05) }), /menyentuh tepi zona/);
  assert.match(run('XAUUSD', { ticksize: 0.05, gapAbs: 0.02, spec: V(0.05) }), /menyentuh tepi zona/);   // 0.4 tick
  assert.match(run('XAUUSD', { ticksize: 0.05, gapAbs: 0.03, spec: V(0.05) }), /terpisah 0\.03 = 0\.6 tick @0\.05/); // 0.6 tick
});
test('sentuh tepi dengan tick lebih kecil: gap 0.004 (ticksize 0.001) bukan sentuhan; gap 0.0004 = sentuhan', () => {
  assert.doesNotMatch(run('XAUUSD', { ticksize: 0.001, gapAbs: 0.004, spec: V(0.001) }), /menyentuh/);
  assert.match(run('XAUUSD', { ticksize: 0.001, gapAbs: 0.0004, spec: V(0.001) }), /menyentuh/);
});
// --- fallback: tidak ada / tidak valid
const FB = /terpisah [0-9.]+ dari zona, tanpa irisan; tick size broker belum tersedia, jumlah tick tidak dihitung/;
for (const [nm, spec] of [['spec null', null], ['spec undefined', undefined], ['spec {} (tanpa ticksize)', {}], ['ticksize 0', { ticksize: 0 }], ['ticksize negatif', { ticksize: -0.01 }], ['ticksize NaN/teks', { ticksize: 'abc' }],
  ['valid=false', { ticksize: 0.01, valid: false }], ['ticksize tak wajar (1000x lebih kecil dari 10^-dec)', { ticksize: 1e-9 }], ['ticksize tak wajar (>1000x)', { ticksize: 100 }]]) {
  test(`fallback (${nm}): jarak absolut + keterangan, TANPA klaim jumlah tick`, () => {
    const tag = run('XAUUSD', { gapAbs: 0.55, spec });
    assert.match(tag, FB);
    assert.match(tag, /terpisah 0\.55 /);
    assert.doesNotMatch(tag, /= \d+ tick/);
  });
}
for (const [pid, [dec]] of Object.entries(P)) {
  test(`fallback ${pid} (presisi ${dec} digit): jarak absolut dengan presisi dec, tanpa klaim tick; sentuh tepat tetap "menyentuh"`, () => {
    const t = 10 ** -dec;
    const tag = run(pid, { gapAbs: 55 * t, spec: null });
    assert.match(tag, FB);
    assert.doesNotMatch(tag, /= \d+ tick/);
    assert.match(run(pid, { gapAbs: 0, spec: null }), /menyentuh tepi zona/);
    assert.match(run(pid, { gapAbs: 0.4 * t, spec: null }), /menyentuh tepi zona/); // dalam presisi harga (estimasi)
  });
}
// --- irisan tidak terpengaruh spesifikasi
test('klasifikasi irisan tidak bergantung pada ticksize: persen sama dengan/tanpa spesifikasi', () => {
  const [dec, lo, hi] = P.XAUUSD, an2 = an(lo, hi, [3508, 3520]);
  const a = tagOf(zoneOverlap(mk(dec, lo, hi), { dec, analyses: an2 }).markdown);
  const b = tagOf(zoneOverlap(mk(dec, lo, hi), { dec, spec: V(0.05), analyses: an2 }).markdown);
  assert.equal(a, b); assert.match(a, /hanya 20% zona/);
});
// --- tidak ada perubahan pada angka lain; idempoten; kompatibilitas data lama
test('hanya anotasi dasar yang berubah: sel Entry/SL/TP/R:R dan tabel 4B identik dengan/tanpa spesifikasi; idempoten', () => {
  const [dec, lo, hi] = P.XAUUSD, A = an(lo, hi, [3510.55, 3530]);
  const base = mk(dec, lo, hi);
  const r1 = zoneOverlap(base, { dec, spec: V(0.05), analyses: A }), r0 = zoneOverlap(base, { dec, analyses: A });
  const strip = (m) => m.replace(/ \((?:terpisah|hanya|tidak ada)[^)]*\)/g, '').replace(/ \(tick [0-9.]+\)/g, '');
  const norm = (m) => m.split('\n').filter((l) => !/^\| BUY Zona 1/.test(l)).join('\n');
  assert.equal(norm(r1.markdown), norm(base)); assert.equal(norm(r0.markdown), norm(base));
  const cells = (m) => m.split('\n').find((l) => /^\| BUY Zona 1/.test(l)).split('|').slice(1, 6).join('|');
  assert.equal(cells(r1.markdown), cells(base));
  assert.equal(zoneOverlap(r1.markdown, { dec, spec: V(0.05), analyses: A }).markdown, r1.markdown);
  assert.equal(zoneOverlap(r0.markdown, { dec, analyses: A }).markdown, r0.markdown);
  assert.ok(strip(r1.markdown).length > 0);
});
test('kompatibilitas: data lama tanpa zones dan tanpa brokerSpec tetap diproses', () => {
  const [dec, lo, hi] = P.XAUUSD;
  const old = [{ timeframe: 'M15', status: 'OK', orderBlocks: [], fvgs: [fz(lo, hi)] }, { timeframe: 'H1', status: 'OK', fvgs: [], orderBlocks: [fz(3506, 3515)] }];
  assert.match(tagOf(zoneOverlap(mk(dec, lo, hi), { dec, analyses: old }).markdown), /hanya 40% zona/);
});
// --- route meneruskan spec; area yang dilarang tidak berubah
test('route.js meneruskan brokerSpec ke zoneOverlap', () => {
  assert.match(readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8'), /zoneOverlap\(md, \{ analyses: smcAnalyses, dec: pairCfg\.dec, spec: mt4ContextUsed\?\.brokerSpec \|\| null \}\)/);
});

test('jarak bukan kelipatan tick (batas zona di luar grid): ditampilkan pecahan 1 desimal, tidak dibulatkan menjadi klaim keliru', () => {
  assert.match(run('USDJPY', { ticksize: 0.01, gapAbs: 0.055, spec: V(0.01) }), /terpisah 0\.055 = 5\.5 tick @0\.01 dari zona/);
  assert.match(run('XAUUSD', { ticksize: 0.05, gapAbs: 0.55, spec: V(0.05) }), /= 11 tick @0\.05/);
});
