// Fix4 (lanjutan A/B/C): label arah pada baris "Rincian Hitung Risiko" + total risiko tebal tanpa bullet.
// Hanya teks; tidak menguji/menyentuh rumus risiko, lot, SL, TP, validator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeOrders } from '../lib/finalSync.js';
import { syncOrderLabels } from '../lib/biasFinal.js';
import { syncBiasLabels } from '../lib/consistency.js';
import { doc, O } from './helpers/report-doc.mjs';

const post = (md, { status, dir, final }) => syncOrderLabels(finalizeOrders(md, { status, dir, maxRiskUsd: 26, dec: 2 }).markdown, final).markdown;
const LAB = { with: '(Searah Bias)', counter: '(Counter-Trend - Wajib Konfirmasi Ekstra)', neutral: '(Netral - Tunggu Konfirmasi)' };
const labelOf = (l) => (/Searah\s*Bias/i.test(l) ? 'Searah Bias' : /Counter[- ]?Trend/i.test(l) ? 'Counter-Trend' : /Netral/i.test(l) ? 'Netral' : null);
const labelsOf = (md, re) => md.split('\n').filter((l) => re.test(l) && labelOf(l)).map((l) => ({ where: /^\|\s*(BUY|SELL) Zona/i.test(l) ? 'B3' : /^\|/.test(l) ? '4B' : /^\s*>/.test(l) ? 'catatan' : 'rincian', label: labelOf(l) }));
// model menulis label pada baris Rincian (terbalik) — seperti laporan live XAUUSD 25 Nov
const withRincianLabels = (md, sellLab, buyLab) => md
  .replace(/^- (Sell Limit Zona \d)(: )/gm, `- $1 ${sellLab}$2`).replace(/^- (Buy Limit Zona \d)(: )/gm, `- $1 ${buyLab}$2`);
const rincian = (md) => md.split('\n').filter((l) => /^- (Sell|Buy) Limit Zona/.test(l));
const ORD = [O('SELL', 2, 3632.58, 3643.03, 3615, 0.02), O('BUY', 2, 3553.31, 3527.02, 3640, 0.01)];

for (const [final, bias, sellWant, buyWant, status, dir] of [
  ['BULLISH', 'BULLISH', 'Counter-Trend', 'Searah Bias', 'COUNTERTREND_ONLY', 'BUY'],
  ['BEARISH', 'BEARISH', 'Searah Bias', 'Counter-Trend', 'TRADE', 'SELL'],
  ['NETRAL', 'NETRAL', 'Netral', 'Netral', 'WAIT', null],
]) {
  test(`Rincian: bias final ${final} → SELL=${sellWant}, BUY=${buyWant} (label model terbalik dikoreksi), sama di Bagian 3/4B/catatan/Rincian`, () => {
    const inv = final === 'BULLISH' ? [LAB.with, LAB.counter] : final === 'BEARISH' ? [LAB.counter, LAB.with] : [LAB.with, LAB.counter];
    const md = withRincianLabels(doc({ orders: ORD, bias, modelLabels: 'inverted' }), inv[0], inv[1]);
    const out = post(md, { status, dir, final });
    for (const [side, want] of [['Sell', sellWant], ['Buy', buyWant]]) {
      const labs = labelsOf(out, new RegExp(`${side} Limit Zona 2`, 'i'));
      assert.ok(labs.some((x) => x.where === 'rincian'), 'baris Rincian harus ada');
      assert.deepEqual([...new Set(labs.map((x) => x.label))], [want], `${side}: ${JSON.stringify(labs)}`);
    }
  });
}
test('Rincian: baris "tidak ada order (…)" ikut dikoreksi labelnya', () => {
  const base = doc({ orders: [ORD[0]], rejectedZones: [['SELL', 3]], bias: 'BULLISH', modelLabels: 'inverted' });
  const md = base.replace(/^(- Sell Limit Zona 2: .*)$/m, `$1\n- Sell Limit Zona 3 (Searah Bias): tidak ada order (melebihi batas risiko)`);
  const out = post(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' });
  const l = out.split('\n').find((x) => /^- Sell Limit Zona 3/.test(x));
  assert.match(l, /^- Sell Limit Zona 3 \(Counter-Trend - Wajib Konfirmasi Ekstra\): tidak ada order/);
});
test('Rincian: gaya zona dalam satu kurung dipertahankan "(Swing - Searah Bias)" → "(Swing - Counter-Trend - …)"', () => {
  const md = doc({ orders: [ORD[0]], bias: 'BULLISH', modelLabels: 'inverted' }).replace(/^- (Sell Limit Zona 2)(: )/m, '- $1 (Intraday - Searah Bias)$2');
  const out = post(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' });
  assert.match(out.split('\n').find((x) => /^- Sell Limit Zona 2/.test(x)), /^- Sell Limit Zona 2 \(Intraday - Counter-Trend - Wajib Konfirmasi Ekstra\): /);
});
test('Rincian: baris tanpa label tidak diberi label; angka perhitungan identik dengan tanpa sinkronisasi label', () => {
  const plain = doc({ orders: ORD, bias: 'BULLISH', modelLabels: 'inverted' });
  const fo = finalizeOrders(plain, { status: 'COUNTERTREND_ONLY', dir: 'BUY', maxRiskUsd: 26, dec: 2 }).markdown;
  const out = syncOrderLabels(fo, 'BULLISH').markdown;
  assert.deepEqual(rincian(out), rincian(fo));
  assert.ok(rincian(out).every((l) => !labelOf(l)));
});
test('Rincian: angka (lot × jarak × pengali = risiko) tidak berubah oleh sinkronisasi label', () => {
  const md = withRincianLabels(doc({ orders: ORD, bias: 'BULLISH', modelLabels: 'inverted' }), LAB.with, LAB.counter);
  const fo = finalizeOrders(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', maxRiskUsd: 26, dec: 2 }).markdown;
  const strip = (m) => m.split('\n').filter((l) => /^- (Sell|Buy) Limit Zona/.test(l)).map((l) => l.replace(/\s*\([^)]*\):/, ':'));
  assert.deepEqual(strip(syncOrderLabels(fo, 'BULLISH').markdown), strip(fo));
});
test('Rincian: baris di luar bagian Rincian (Skenario Batal, teks bebas) tidak disentuh', () => {
  const extra = '\n**Skenario Batal (Invalidation Level)**\n- Sell Limit Zona 2 (Searah Bias): contoh teks di luar Rincian\n\nCatatan bebas:\n- Sell Limit Zona 2 (Searah Bias): teks bebas lain\n';
  const md = withRincianLabels(doc({ orders: [ORD[0]], bias: 'BULLISH', modelLabels: 'inverted' }), LAB.with, LAB.counter) + extra;
  const out = post(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' });
  assert.ok(out.includes('- Sell Limit Zona 2 (Searah Bias): contoh teks di luar Rincian'));
  assert.ok(out.includes('- Sell Limit Zona 2 (Searah Bias): teks bebas lain'));
  assert.match(out.split('\n').find((l) => /^- Sell Limit Zona 2 .*lot x/.test(l)) || '', /Counter-Trend/); // baris Rincian sebenarnya tetap dikoreksi
});
test('Rincian: idempoten (dua kali jalan = sama)', () => {
  const md = withRincianLabels(doc({ orders: ORD, bias: 'BULLISH', modelLabels: 'inverted' }), LAB.with, LAB.counter);
  const a = post(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' });
  assert.equal(syncOrderLabels(a, 'BULLISH').markdown, a);
  assert.equal(syncOrderLabels(a, 'BULLISH').changed, 0);
});

// ───── D5b: total risiko tebal tanpa bullet ─────
const TOT = {
  'tebal tanpa bullet': '**Total risiko satu arah (SELL):** $18.62 (batas $26.00)',
  'tebal tanpa bullet, dua arah': '**Total BUY:** $16.56 | **Total SELL:** $18.62',
  'tebal dengan bullet': '- **Total risiko satu arah (SELL):** $18.62 (batas $26.00)',
  'polos tanpa bullet': 'Total BUY: $16.56 | Total SELL: $18.62 (batas $26.00 per arah).',
  'kutipan + tebal': '> **Total risiko satu arah (SELL):** $18.62',
};
for (const [nm, line] of Object.entries(TOT)) {
  test(`Total risiko: "${nm}" diganti angka server, tanpa awalan ganda, tanpa angka model tersisa`, () => {
    const md = doc({ orders: [ORD[0]], bias: 'BULLISH', modelLabels: 'inverted', staleTotal: line });
    const out = post(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' });
    assert.ok(!/\$18\.62|\$16\.56/.test(out), out.split('\n').filter((l) => /otal/.test(l)).join(' / '));
    assert.ok(!/Total\s+(?:BUY|SELL):\s*[^\n|]*Total risiko/i.test(out) && !/\*\*Total[^\n]*:\*\*\s*Total risiko/i.test(out));
    assert.match(out, /Total risiko per arah \(order yang lolos validator, termasuk kandidat yang belum boleh dipasang\): BUY \$0\.00 \| SELL \$20\.90 \(batas \$26\.00 per arah\)\./);
    assert.equal(post(out, { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' }), out); // idempoten
  });
}
test('Total risiko tebal tanpa bullet tidak menutup bagian Rincian (baris Rincian sesudahnya tetap diproses)', () => {
  const md = withRincianLabels(doc({ orders: ORD, bias: 'BULLISH', modelLabels: 'inverted', staleTotal: TOT['tebal tanpa bullet'] }), LAB.with, LAB.counter);
  const out = post(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' });
  assert.ok(!/\$18\.62/.test(out));
  assert.ok(rincian(out).length >= 2);
});

// ───── syncBiasLabels (Bagian 3): kurung gabungan — dicatat sebagai skenario, TIDAK diubah di cabang ini ─────
test('syncBiasLabels: label berdiri sendiri tetap dikoreksi (baseline)', () => {
  const md = '| Zona & Strategi | Zona Entry |\n|---|---|\n| SELL Zona 2 - Intraday (Searah Bias) | 3632.58 - 3640.36 |\n';
  assert.match(syncBiasLabels(md, 'BULLISH').markdown, /SELL Zona 2 - Intraday \(Counter-Trend - Wajib Konfirmasi Ekstra\)/);
});
test('syncBiasLabels: kurung gabungan "(Intraday - Searah Bias)" — celah yang diketahui (tidak diperbaiki di cabang ini)', { todo: 'syncBiasLabels meninggalkan label lama dan menambah label baru; belum disetujui untuk diperbaiki' }, () => {
  const md = '| Zona & Strategi | Zona Entry |\n|---|---|\n| SELL Zona 2 (Intraday - Searah Bias) | 3632.58 - 3640.36 |\n';
  const out = syncBiasLabels(md, 'BULLISH').markdown;
  // Harapan benar: tidak ada "Searah Bias" tersisa untuk SELL saat bias BULLISH. Bila celah ini belum ditutup, tes ini gagal → todo.
  assert.ok(!/Searah\s*Bias/.test(out.split('\n')[2]), out.split('\n')[2]);
});
