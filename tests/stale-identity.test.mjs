import test from 'node:test';
import assert from 'node:assert/strict';
import { flagStaleStructure } from '../lib/staleStructure.js';

const MARK = /\[⚠️/;
const z = (type, low, high, status) => ({ type, low, high, status });
// Reproduksi USDJPY 25 Nov: daftar fvgs M15 (8 terakhir) semuanya MITIGATED; FVG fresh hanya ada di `zones` (daftar lengkap)
const USDJPY = [
  { timeframe: 'M15', status: 'OK', orderBlocks: [], fvgs: [z('BEARISH', 159.178, 159.206, 'MITIGATED'), z('BULLISH', 159.274, 159.287, 'MITIGATED')],
    zones: [{ ...z('BEARISH', 159.457, 159.486, 'FRESH'), source: 'FVG' }] },
  { timeframe: 'H4', status: 'OK', orderBlocks: [], fvgs: [z('BULLISH', 159.465, 159.472, 'MITIGATED')], zones: [] },
];
const TICK3 = 0.001;

test('USDJPY: M15 FVG fresh 159.457-159.486 tidak diberi label H4 FVG MITIGATED 159.465-159.472', () => {
  const md = '| M15 | Bearish | 159.457-159.486 (FVG Bearish M15 fresh, tepi bawah) / 159.035 (CHoCH Bearish M15) |\n- Zona fresh yang layak: OB bearish M5 159.271-159.318, FVG bearish M15 159.457-159.486, OB bullish H1 158.788-158.989.';
  const r = flagStaleStructure(md, USDJPY, { tick: TICK3 });
  assert.equal(r.flagged.length, 0); assert.equal(r.markdown, md); assert.deepEqual(r.notes, []);
});
test('perilaku lama terbukti salah: tanpa daftar lengkap & toleransi 0.05 zona H4 akan menyerobot (kontrol negatif)', () => {
  // Zona H4 hanya 0.008/0.014 dari FVG M15 fresh; di identitas ketat keduanya berbeda, di toleransi 0.05 lama dianggap sama.
  const h4 = USDJPY[1].fvgs[0], m15 = USDJPY[0].zones[0];
  assert.ok(Math.abs(h4.low - m15.low) <= 0.05 && Math.abs(h4.high - m15.high) <= 0.05);
  assert.ok(Math.abs(h4.low - m15.low) > TICK3 / 2);
});
test('FVG fresh di luar 8 entri terakhir (hanya di zones) tetap dikenali sebagai fresh', () => {
  const an = [{ timeframe: 'M15', status: 'OK', orderBlocks: [], fvgs: [z('BEARISH', 100.1, 100.3, 'MITIGATED')], zones: [{ ...z('BEARISH', 100.1, 100.3, 'FRESH'), source: 'FVG' }] }];
  // zona basi di TF lain berkoordinat sama persis: fresh M15 (tanpa petunjuk TF) menang
  an.push({ timeframe: 'H4', status: 'OK', orderBlocks: [], fvgs: [z('BEARISH', 100.1, 100.3, 'MITIGATED')], zones: [] });
  assert.equal(flagStaleStructure('zona 100.100-100.300', an, { tick: 0.001 }).flagged.length, 0);
});
test('zona basi yang benar-benar cocok tetap diberi penanda', () => {
  const md = 'Supply H4 159.465-159.472 jangan dipakai.';
  const r = flagStaleStructure(md, USDJPY, { tick: TICK3 });
  assert.equal(r.flagged.length, 1);
  assert.match(r.markdown, /159\.465-159\.472 \[⚠️ H4 FVG MITIGATED — bukan zona fresh\/konfluensi aktif\]/);
});
test('zona beda timeframe tidak saling menandai (petunjuk TF bertentangan menyisihkan kandidat)', () => {
  const an = [
    { timeframe: 'H1', status: 'OK', orderBlocks: [z('BEARISH', 100.1, 101.2, 'INVALIDATED')], fvgs: [], zones: [] },
    { timeframe: 'H4', status: 'OK', orderBlocks: [z('BEARISH', 100.1, 101.2, 'FRESH')], fvgs: [], zones: [] },
  ];
  assert.equal(flagStaleStructure('zona 100.10-101.20', an, { tick: 0.01 }).flagged.length, 0); // ambigu → fresh menang
  assert.equal(flagStaleStructure('OB bearish H4 100.10-101.20 fresh', an, { tick: 0.01 }).flagged.length, 0);
  const r = flagStaleStructure('OB bearish H1 100.10-101.20 jangan dipakai', an, { tick: 0.01 });
  assert.equal(r.flagged.length, 1); assert.equal(r.flagged[0].tf, 'H1');
});
test('koordinat berbeda TF dan berdekatan: tidak saling menandai', () => {
  const an = [
    { timeframe: 'M15', status: 'OK', orderBlocks: [], fvgs: [], zones: [{ ...z('BEARISH', 100.2, 100.8, 'FRESH'), source: 'FVG' }] },
    { timeframe: 'H4', status: 'OK', orderBlocks: [z('BEARISH', 100.21, 100.79, 'MITIGATED')], fvgs: [], zones: [] },
  ];
  assert.equal(flagStaleStructure('FVG M15 100.20-100.80', an, { tick: 0.01 }).flagged.length, 0);
});
test('zona beda jenis FVG/OB tidak saling menandai', () => {
  const an = [{ timeframe: 'H1', status: 'OK', orderBlocks: [z('BEARISH', 100.1, 101.2, 'INVALIDATED')], fvgs: [z('BEARISH', 100.1, 101.2, 'FRESH')], zones: [] }];
  assert.equal(flagStaleStructure('FVG bearish H1 100.10-101.20', an, { tick: 0.01 }).flagged.length, 0); // FVG fresh
  const r = flagStaleStructure('OB bearish H1 100.10-101.20', [{ timeframe: 'H1', status: 'OK', orderBlocks: [z('BEARISH', 100.1, 101.2, 'INVALIDATED')], fvgs: [z('BEARISH', 100.1, 101.2, 'MITIGATED')], zones: [] }], { tick: 0.01 });
  assert.equal(r.flagged.length, 1); assert.equal(r.flagged[0].kind, 'OB'); // FVG basi koordinat sama tak menyerobot label OB
  const fv = flagStaleStructure('FVG bearish H1 100.10-101.20', [{ timeframe: 'H1', status: 'OK', orderBlocks: [z('BEARISH', 100.1, 101.2, 'INVALIDATED')], fvgs: [z('BEARISH', 100.1, 101.2, 'MITIGATED')], zones: [] }], { tick: 0.01 });
  assert.equal(fv.flagged.length, 1); assert.equal(fv.flagged[0].kind, 'FVG');
});
test('zona beda arah (bullish/bearish) tidak saling menandai', () => {
  const an = [{ timeframe: 'H1', status: 'OK', orderBlocks: [], fvgs: [z('BULLISH', 100.1, 101.2, 'MITIGATED'), z('BEARISH', 100.1, 101.2, 'FRESH')], zones: [] }];
  assert.equal(flagStaleStructure('FVG bearish H1 100.10-101.20', an, { tick: 0.01 }).flagged.length, 0); // teks menyebut bearish → fresh bearish
  assert.equal(flagStaleStructure('FVG bullish H1 100.10-101.20', an, { tick: 0.01 }).flagged.length, 1); // teks menyebut bullish → yang basi bullish
  assert.equal(flagStaleStructure('FVG H1 100.10-101.20', an, { tick: 0.01 }).flagged.length, 0); // tanpa arah: ambigu → fresh menang
  const only = [{ timeframe: 'H1', status: 'OK', orderBlocks: [], fvgs: [z('BULLISH', 100.1, 101.2, 'MITIGATED')], zones: [] }];
  assert.equal(flagStaleStructure('FVG bearish H1 100.10-101.20', only, { tick: 0.01 }).flagged.length, 0); // arah disebut berbeda
  assert.equal(flagStaleStructure('FVG bullish H1 100.10-101.20', only, { tick: 0.01 }).flagged.length, 1);
});

// presisi 2, 3, 5 desimal: sama persis, selisih setengah tick (normalisasi), selisih satu tick, dan berdekatan tapi berbeda
const CASES = [
  { name: '2 desimal (XAUUSD)', dec: 2, lo: 3628.31, hi: 3640.39 },
  { name: '3 desimal (JPY)', dec: 3, lo: 159.465, hi: 159.472 },
  { name: '5 desimal (EURUSD)', dec: 5, lo: 1.09770, hi: 1.09810 },
];
for (const c of CASES) {
  const tick = Number('1e-' + c.dec);
  const f = (n) => n.toFixed(c.dec);
  const an = [{ timeframe: 'H4', status: 'OK', orderBlocks: [], fvgs: [z('BULLISH', c.lo, c.hi, 'MITIGATED')], zones: [] }];
  const run = (lo, hi) => flagStaleStructure(`FVG H4 ${f(lo)}-${f(hi)}`, an, { tick }).flagged.length;
  test(`presisi ${c.name}: batas sama persis → ditandai`, () => assert.equal(run(c.lo, c.hi), 1));
  test(`presisi ${c.name}: derau pembulatan < setengah tick → tetap ditandai`, () => {
    const r = flagStaleStructure(`FVG H4 ${c.lo + tick * 0.4}-${c.hi - tick * 0.4}`, an, { tick });
    assert.equal(r.flagged.length, 1);
  });
  test(`presisi ${c.name}: selisih satu tick di salah satu batas → zona berbeda, tidak ditandai`, () => {
    assert.equal(run(c.lo + tick, c.hi), 0); assert.equal(run(c.lo, c.hi + tick), 0); assert.equal(run(c.lo - tick, c.hi), 0);
  });
  test(`presisi ${c.name}: berdekatan (beberapa tick) tapi zona berbeda → tidak ditandai`, () => {
    assert.equal(run(c.lo + 8 * tick, c.hi + 14 * tick), 0);
  });
}
test('tanpa tick: hanya kecocokan praktis persis (tak ada toleransi longgar)', () => {
  const an = [{ timeframe: 'H4', status: 'OK', orderBlocks: [], fvgs: [z('BULLISH', 159.465, 159.472, 'MITIGATED')], zones: [] }];
  assert.equal(flagStaleStructure('159.465-159.472', an).flagged.length, 1);
  assert.equal(flagStaleStructure('159.466-159.472', an).flagged.length, 0);
  assert.equal(flagStaleStructure('159.457-159.486', an).flagged.length, 0);
});
test('tick tidak valid (NaN/negatif) diperlakukan sebagai tanpa tick', () => {
  const an = [{ timeframe: 'H4', status: 'OK', orderBlocks: [], fvgs: [z('BULLISH', 1.1, 1.2, 'MITIGATED')], zones: [] }];
  for (const tick of [NaN, -1, 'x', null, undefined]) assert.equal(flagStaleStructure('1.10-1.20', an, { tick }).flagged.length, 1);
  assert.equal(flagStaleStructure('1.11-1.20', an, { tick: NaN }).flagged.length, 0);
});
test('idempoten: dijalankan dua/tiga kali hasil sama, tanpa penanda ganda', () => {
  const md = 'Supply H4 159.465-159.472 dan FVG M15 159.457-159.486, lalu H4 159.465-159.472 lagi.';
  const a = flagStaleStructure(md, USDJPY, { tick: TICK3 });
  const b = flagStaleStructure(a.markdown, USDJPY, { tick: TICK3 });
  const c = flagStaleStructure(b.markdown, USDJPY, { tick: TICK3 });
  assert.equal(a.markdown, b.markdown); assert.equal(b.markdown, c.markdown);
  assert.equal(b.flagged.length, 0); assert.equal((a.markdown.match(/⚠️/g) || []).length, 2);
  assert.ok(!/\[⚠️[^\]]*\]\s*\[⚠️/.test(a.markdown));
});
test('penanda sendiri tidak mencemari petunjuk konteks rentang berikutnya (idempoten dengan banyak rentang)', () => {
  const an = [
    { timeframe: 'H1', status: 'OK', orderBlocks: [z('BEARISH', 100.1, 101.2, 'INVALIDATED')], fvgs: [], zones: [{ ...z('BEARISH', 105.1, 106.2, 'FRESH'), source: 'ORDER_BLOCK' }] },
  ];
  const md = 'OB bearish H1 100.10-101.20, OB bearish H1 105.10-106.20';
  const a = flagStaleStructure(md, an, { tick: 0.01 });
  assert.equal(a.flagged.length, 1); assert.ok(!MARK.test(a.markdown.split(', ')[1] || ''));
  assert.equal(flagStaleStructure(a.markdown, an, { tick: 0.01 }).markdown, a.markdown);
});
test('blok kode & jejak audit tetap dilewati; tanpa zona basi teks identik', () => {
  const t = 'x\n```text\nFVG: BULLISH 159.465-159.472 (MITIGATED)\n```\n> 🔎 Jejak audit: 159.465-159.472';
  assert.equal(flagStaleStructure(t, USDJPY, { tick: TICK3 }).markdown, t);
  assert.equal(flagStaleStructure('159.465-159.472', [], { tick: TICK3 }).markdown, '159.465-159.472');
});
test('kabel: route meneruskan tick dari presisi pair (bukan toleransi 0.05)', async () => {
  const fs = await import('node:fs');
  const r = fs.readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8');
  assert.match(r, /flagStaleStructure\(markdown, mt4ContextUsed\?\.smc\?\.analyses \|\| \[\], \{ tick: /);
  const s = fs.readFileSync(new URL('../lib/staleStructure.js', import.meta.url), 'utf8');
  assert.ok(!/tol\s*=\s*0\.05/.test(s));
});
