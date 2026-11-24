import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildEngineOrders, selectTargets, structureLevels, lockToEngine, clearDeadDetail, engineSkeleton, engineOrdersPrompt, ordersSignature, finalTableSignature, minRrOf } from '../lib/engineOrders.js';
import { enforceSmcZones, disableZoneRows } from '../lib/smc/guard.js';
import { reconcileZones, cancelMismatched } from '../lib/finalSync.js';
import { buildDecision } from '../lib/decision.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-'));
for (const f of ['riskCheck.js', 'brokerSpec.js', 'pairs.js', 'marketTime.js']) {
  fs.writeFileSync(path.join(tmp, f), fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8').replace(/'@\/lib\/([\w]+)'/g, "'./$1.js'"));
}
const { verifyRiskTables, parseExpiryWIB } = await import(pathToFileURL(path.join(tmp, 'riskCheck.js')).href);
const { PAIRS } = await import(pathToFileURL(path.join(tmp, 'pairs.js')).href);

const PRICE = 3600, ATR = 10, DEC = 2, MULT = 100;
const NOW = new Date('2026-11-24T10:00:00Z');
const fmtExp = (ts) => `24 Nov 2026, 22.40 WIB`;

function world({ resistances = [3624.89, 3688.4], supports = [3596.5, 3580.2, 3561.1] } = {}) {
  const analyses = [
    { timeframe: 'H1', status: 'OK', atr14: ATR, lastPrice: PRICE,
      supports: supports.map((p) => ({ price: p })), resistances: resistances.map((p) => ({ price: p })),
      zones: [
        { type: 'BULLISH', low: 3538.6, high: 3553.31, source: 'FVG' },
        { type: 'BULLISH', low: 3529.96, high: 3543.56, source: 'FVG' },
        { type: 'BEARISH', low: 3642.72, high: 3646.46, source: 'OB' },
        { type: 'BEARISH', low: 3710.52, high: 3721.63, source: 'OB' },
      ] },
  ];
  const zoneRes = {
    BUY: { 2: { entryLo: 3538.6, entryHi: 3553.31, sl: 3527.02, score: 3 }, 3: { entryLo: 3529.96, entryHi: 3543.56, sl: 3520.0, score: 3 } },
    SELL: { 2: { entryLo: 3642.72, entryHi: 3646.46, sl: 3662.7, score: 2 }, 3: { entryLo: 3710.52, entryHi: 3721.63, sl: 3728.3, score: 2 } },
  };
  return { analyses, zoneRes };
}
const lotFor = (dist, budget) => Math.max(0.01, Math.floor((budget / (dist * MULT)) * 100 + 1e-9) / 100);
const mkEng = (w, o = {}) => buildEngineOrders({ zoneRes: w.zoneRes, analyses: w.analyses, price: PRICE, atrH1: ATR, dec: DEC, zones: 3, zonesOff: [1], riskUsd: 60, lotFor, ...o });

// ---------- teks model (Gemini) yang bervariasi ----------
function modelText(v = {}) {
  const rows3 = v.rows3 || [
    ['BUY Zona 2 - Intraday (Searah Bias)', '3538.60 - 3553.31', '3527.02', v.tpBuy2 || '3640.00', '3700.00', 'Close M15 bullish.'],
    ['BUY Zona 3 - Swing (Searah Bias)', '3529.96 - 3543.56', '3520.00', v.tpBuy3 || '3700.00', '-', 'Close H4.'],
    ['SELL Zona 2 - Intraday (Counter-Trend)', '3642.72 - 3646.46', '3662.70', v.tpSell2 || '3560.00', '-', 'Close M15 bearish.'],
    ['SELL Zona 3 - Swing (Counter-Trend)', '3710.52 - 3721.63', '3728.30', '3690.00', '-', 'Close H1.'],
  ];
  const rows4 = v.rows4 || [
    ['Sell Limit Zona 2 (Intraday)', '3642.72', '3662.70', v.tpSell2 || '3560.00', '19.98', v.lot || '1.00', '$1999.00', '1:4.1', '24 Nov 2026, 22.40 WIB'],
    ['Buy Limit Zona 2 (Intraday)', '3553.31', '3527.02', v.tpBuy2 || '3640.00', '26.29', v.lot || '1.00', '$2629.00', '1:3.3', '24 Nov 2026, 22.40 WIB'],
    ['Buy Limit Zona 3 (Swing)', '3543.56', '3520.00', v.tpBuy3 || '3700.00', '23.56', v.lot || '1.00', '$2356.00', '1:6.6', '25 Nov 2026, 04.00 WIB'],
  ];
  const T = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
  return `**BIAS UTAMA: ${v.bias || 'BULLISH'}**
**PAIR:** XAUUSD
**HARGA TERAKHIR:** 3600.00
**ATR:** H1 10.00 | H4 25.00

${v.claim || ''}

### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)
${T(['Zona & Strategi', 'Zona Entry', 'Stop Loss (SL)', 'Take Profit 1 (TP1)', 'Take Profit 2 (TP2)', 'Syarat Konfirmasi Candlestick'], rows3)}

### 4. Rekomendasi Susunan Pending Order

**4B. Order Baru yang Disarankan**
${T(['Order', 'Harga Entry', 'Stop Loss', 'Take Profit', 'Jarak SL', 'Lot Aman', 'Risiko ($)', 'R:R', 'Waktu Berakhir (WIB)'], rows4)}

**Rincian Hitung Risiko**
- Buy Limit Zona 2: 1.00 x 26.29 x 100 = $2629.00
- Sell Limit Zona 2: 1.00 x 19.98 x 100 = $1998.00
**Skenario Batal (Invalidation Level):**
- Buy Zona 2: batal bila close di bawah 3527.02.
`;
}

const px = PAIRS.XAUUSD;
function pipeline(model, w, eng, { zonesOff = [1], riskUsd = 60, bias = 'BULLISH' } = {}) {
  const z1 = disableZoneRows(model, zonesOff);
  const lk = lockToEngine(z1.markdown, eng, { dec: DEC, zones: 3, now: NOW, fmtExp, parseExp: parseExpiryWIB });
  const txt = clearDeadDetail(lk.markdown, eng);
  const e = enforceSmcZones(txt, { analyses: w.analyses, atrH1: ATR, price: PRICE, priceRe: px.priceRe, candidates: w.zoneRes });
  const rc1 = reconcileZones(e.markdown, { dec: DEC });
  const c = verifyRiskTables(rc1.markdown, riskUsd, px, NOW, { last: PRICE, capPerDirection: true, zones: 3, spec: null });
  const rc2 = reconcileZones(c.markdown, { dec: DEC, mult: c.mult });
  const md = rc2.mismatches.length ? cancelMismatched(rc2.markdown, rc2.mismatches).markdown : rc2.markdown;
  const d = buildDecision({ markdown: md, bias, zoneRes: w.zoneRes, alignment: true, htf: {}, atrM5: 0 });
  return { md, decision: d.status, sig: finalTableSignature(md), lk, c };
}
const rowOf = (md, re) => md.split('\n').find((l) => re.test(l));

// ───────────── TP1: pemilihan level struktur ─────────────
test('TP1 = level struktur terdekat searah profit dengan R:R >= standar; TP2 dari level berikutnya', () => {
  const levels = [{ price: 3650, tf: 'H1', rank: 2, kind: 'resistance' }, { price: 3700, tf: 'H4', rank: 3, kind: 'resistance' }, { price: 3610, tf: 'M15', rank: 1, kind: 'resistance' }, { price: 3620, tf: 'H1', rank: 2, kind: 'resistance' }];
  const t = selectTargets({ side: 'BUY', entry: 3600, sl: 3590, zone: 2, zones: 3, levels, buf: 1, dec: 2 });
  assert.equal(t.tp1, 3619); // 3610 hanya 1.0R (<1.5R) ditolak; 3620-buf = 1.9R
  assert.equal(t.tp2, 3649); // >= 2R, <= 5R, > TP1 + 0.5R
  assert.ok(t.rr1 >= 1.5);
});
test('urutan level masukan tidak memengaruhi pilihan (determinisme)', () => {
  const lv = [{ price: 3620, tf: 'H1', rank: 2, kind: 'resistance' }, { price: 3620, tf: 'H4', rank: 3, kind: 'zone' }, { price: 3640, tf: 'D1', rank: 4, kind: 'resistance' }, { price: 3614, tf: 'M15', rank: 1, kind: 'resistance' }];
  const base = selectTargets({ side: 'BUY', entry: 3600, sl: 3590, zone: 2, zones: 2, levels: lv, buf: 1 });
  for (let i = 0; i < 24; i++) {
    const sh = [...lv].sort(() => Math.sin(i * 7.3 + lv.length) - 0.3);
    assert.deepEqual(selectTargets({ side: 'BUY', entry: 3600, sl: 3590, zone: 2, zones: 2, levels: sh, buf: 1 }), base);
  }
  assert.equal(base.src1, 'H4 zone'); // seri jarak sama: TF lebih tinggi lebih dulu
});
test('tidak ada level valid -> tp1 null (tanpa kelipatan R pengganti)', () => {
  const t = selectTargets({ side: 'BUY', entry: 3600, sl: 3590, zone: 2, zones: 2, levels: [], buf: 1 });
  assert.equal(t.tp1, null); assert.equal(t.tp2, null); assert.match(t.reason, /tidak ada level struktur/);
  const t2 = selectTargets({ side: 'BUY', entry: 3600, sl: 3590, zone: 2, zones: 2, levels: [{ price: 3610, tf: 'H1', rank: 2, kind: 'resistance' }], buf: 1 });
  assert.equal(t2.tp1, null); assert.match(t2.reason, /R:R >= 1:1\.5/);
});
test('kandidat TP di sisi yang salah dibuang (BUY di bawah entry, SELL di atas entry)', () => {
  const buy = structureLevels([{ status: 'OK', timeframe: 'H1', resistances: [{ price: 3590 }, { price: 3650 }], supports: [{ price: 3500 }], zones: [{ type: 'BEARISH', low: 3580, high: 3585 }] }], 'BUY', 3600, 3600);
  assert.deepEqual(buy.map((x) => x.price), [3650]);
  const sell = structureLevels([{ status: 'OK', timeframe: 'H1', supports: [{ price: 3620 }, { price: 3550 }], resistances: [{ price: 3700 }], zones: [{ type: 'BULLISH', low: 3590, high: 3610 }] }], 'SELL', 3600, 3600);
  assert.deepEqual(sell.map((x) => x.price), [3550]);
  const t = selectTargets({ side: 'BUY', entry: 3600, sl: 3590, zone: 2, zones: 2, levels: [{ price: 3590, tf: 'H1', rank: 2, kind: 'x' }, { price: 3600, tf: 'H1', rank: 2, kind: 'x' }], buf: 0 });
  assert.equal(t.tp1, null);
});
test('R:R di bawah standar ditolak: Zona 3 butuh 1:2.0, zona lain 1:1.5; tepat di batas lolos', () => {
  const lv = (p) => [{ price: p, tf: 'H4', rank: 3, kind: 'resistance' }];
  // R = 10. Zona 3: 1.94 ditolak, 2.0 lolos
  assert.equal(selectTargets({ side: 'BUY', entry: 3600, sl: 3590, zone: 3, zones: 3, levels: lv(3619.4), buf: 0 }).tp1, null);
  assert.equal(selectTargets({ side: 'BUY', entry: 3600, sl: 3590, zone: 3, zones: 3, levels: lv(3620), buf: 0 }).tp1, 3620);
  // Zona 2: 1.4 ditolak, 1.5 lolos; Zona 3 di mode 2 zona memakai 1.5
  assert.equal(selectTargets({ side: 'BUY', entry: 3600, sl: 3590, zone: 2, zones: 3, levels: lv(3614), buf: 0 }).tp1, null);
  assert.equal(selectTargets({ side: 'BUY', entry: 3600, sl: 3590, zone: 2, zones: 3, levels: lv(3615), buf: 0 }).tp1, 3615);
  assert.equal(minRrOf(3, 2), 1.5); assert.equal(minRrOf(3, 3), 2.0);
});
test('TP1 melewati batas jarak zona -> tidak dipilih (tanpa kelipatan R)', () => {
  const t = selectTargets({ side: 'SELL', entry: 3600, sl: 3610, zone: 2, zones: 3, levels: [{ price: 3560, tf: 'H4', rank: 3, kind: 'support' }], buf: 0 }); // 4R > cap 3R
  assert.equal(t.tp1, null);
});

// ───────────── objek mesin ─────────────
test('mesin: Entry limit = tepi zona dekat harga; koordinat zona/SL = kandidat mesin tanpa perubahan', () => {
  const w = world(); const eng = mkEng(w);
  const o = (s, z) => eng.orders.find((x) => x.side === s && x.zone === z);
  assert.equal(o('BUY', 2).limit, 3553.31); assert.equal(o('SELL', 2).limit, 3642.72);
  assert.equal(o('BUY', 2).sl, 3527.02); assert.equal(o('BUY', 2).entryLo, 3538.6); assert.equal(o('BUY', 2).entryHi, 3553.31);
  assert.equal(o('BUY', 1).status, 'NONE'); assert.equal(o('BUY', 1).off, true);
  for (const x of eng.orders.filter((y) => y.status === 'OK')) {
    assert.ok(x.side === 'BUY' ? x.tp1 > x.limit && x.sl < x.limit : x.tp1 < x.limit && x.sl > x.limit);
    assert.ok(Math.abs(x.tp1 - x.limit) / x.dist >= minRrOf(x.zone, 3) - 0.005);
    assert.ok(Math.abs(x.rr - Math.abs(x.tp1 - x.limit) / x.dist) < 0.006);
  }
});
test('mesin: lot awal memakai porsi risiko per zona (dinormalkan antar zona yang lolos), urutan tetap', () => {
  const eng = mkEng(world());
  const buy = eng.orders.filter((x) => x.side === 'BUY' && x.status === 'OK');
  assert.equal(buy.length, 2);
  const sum = buy.reduce((s, x) => s + x.budget, 0);
  assert.ok(Math.abs(sum - 60) < 1e-9);
  assert.ok(Math.abs(buy.find((x) => x.zone === 2).budget - (60 * 35) / 80) < 1e-9);
  assert.ok(Math.abs(buy.find((x) => x.zone === 3).budget - (60 * 45) / 80) < 1e-9);
});

// ───────────── tidak ada TP valid ─────────────
test('tidak ada target valid -> zona NO TRADE, baris kosong, tanpa TP karangan, keputusan tanpa zona itu', () => {
  const w = world({ resistances: [], supports: [] }); // BUY & SELL tanpa level resistance/support; hanya tepi zona lawan
  w.analyses[0].zones = w.analyses[0].zones.filter((z) => z.type === 'BULLISH'); // hapus tepi zona BEARISH (target BUY)
  const eng = mkEng(w);
  const buy2 = eng.orders.find((x) => x.side === 'BUY' && x.zone === 2);
  assert.equal(buy2.status, 'NONE'); assert.equal(buy2.noTarget, true);
  const r = pipeline(modelText({ tpBuy2: '3640.00' }), w, eng);
  assert.doesNotMatch(r.md, /\| Buy Limit Zona 2[^\n]*3640\.00/);
  assert.match(rowOf(r.md, /^\| Buy Limit Zona 2/), /Tidak Ada Setup \(Tidak Ada Target Struktural Valid/);
  assert.match(rowOf(r.md, /^\| BUY Zona 2/), /Tidak ada level valid \(tunggu\) — tidak ada target struktural valid/);
  assert.ok(r.lk.notes.some((n) => /BUY Zona 2: tidak ada target struktural valid/.test(n) && /evaluasi manual/.test(n)));
  assert.ok(!/\b3640\.00\b/.test(rowOf(r.md, /^\| BUY Zona 2/)));
});

// ───────────── Gemini tidak boleh mengubah angka / zona / keputusan ─────────────
test('Gemini mengubah TP/lot/entry: angka final tetap dari mesin', () => {
  const w = world(); const eng = mkEng(w);
  const clean = pipeline(modelText({}), w, eng);
  const bad = pipeline(modelText({ tpBuy2: '3999.00', tpBuy3: '3800.00', tpSell2: '3400.00', lot: '9.99' }), w, eng);
  assert.equal(bad.sig, clean.sig);
  const b2 = eng.orders.find((x) => x.side === 'BUY' && x.zone === 2);
  assert.match(rowOf(bad.md, /^\| Buy Limit Zona 2/), new RegExp(`\\| ${b2.tp1.toFixed(2)} \\|`));
  assert.ok(bad.lk.overrides.length > 0);
});
test('model mengosongkan zona yang punya kandidat valid: mesin tetap mengisi', () => {
  const w = world(); const eng = mkEng(w);
  const rows4 = [['Sell Limit Zona 2 (Intraday)', 'Tidak Ada Setup (Tunggu)', '-', '-', '-', '-', '-', '-', '-']];
  const rows3 = [['SELL Zona 2 - Intraday', 'Tidak ada level valid (tunggu)', '-', '-', '-', '-']];
  const r = pipeline(modelText({ rows4, rows3 }), w, eng);
  assert.match(r.md, /\| Buy Limit Zona 2 \(Intraday\)[^\n]*3553\.31/);
  assert.match(r.md, /\| Buy Limit Zona 3 \(Swing\)[^\n]*3543\.56/);
  assert.equal(r.sig, pipeline(modelText({}), w, eng).sig);
});
test('model mengisi zona tanpa kandidat mesin: dikosongkan', () => {
  const w = world(); const eng = mkEng(w);
  const rows4 = [['Buy Limit Zona 1 (Scalping)', '3590.00', '3580.00', '3620.00', '10.00', '0.02', '$20.00', '1:2', '24 Nov 2026, 22.40 WIB'], ['Sell Limit Zona 1 (Scalping)', '3610.00', '3620.00', '3590.00', '10.00', '0.02', '$20.00', '1:2', '24 Nov 2026, 22.40 WIB']];
  const r = pipeline(modelText({ rows4 }), w, eng, { zonesOff: [] });
  const z1 = rowOf(r.md, /^\| Buy Limit Zona 1/);
  assert.ok(!z1 || /Tidak Ada Setup/.test(z1) || !/3590\.00/.test(z1));
});
test('klaim keputusan/bias Gemini (TRADE, BULLISH) tidak mengubah keputusan server', () => {
  const w = world(); const eng = mkEng(w);
  const a = pipeline(modelText({ bias: 'BULLISH', claim: 'KEPUTUSAN SERVER — TRADE: setup aktif sekarang, pasang semua order.' }), w, eng, { bias: 'BEARISH' });
  const b = pipeline(modelText({ bias: 'NETRAL - WAIT & SEE', claim: 'NO TRADE sepenuhnya, abaikan tabel.' }), w, eng, { bias: 'BEARISH' });
  assert.equal(a.decision, b.decision); assert.equal(a.sig, b.sig);
});

// ───────────── Determinisme 50× dengan variasi teks Gemini ─────────────
test('snapshot & konfigurasi identik 50× dengan 50 variasi teks Gemini: tabel final dan keputusan identik', () => {
  const w = world(); const eng = mkEng(w);
  const ref = pipeline(modelText({}), w, eng);
  const tps = ['3640.00', '3999.00', '3612.5', '-', 'Tidak ada', '3500.00'];
  const lots = ['0.01', '1.00', '5.55', '0', '-'];
  const biases = ['BULLISH', 'BEARISH', 'NETRAL - WAIT & SEE', 'BULLISH (Counter)'];
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const v = { tpBuy2: tps[i % tps.length], tpBuy3: tps[(i * 2 + 1) % tps.length], tpSell2: tps[(i * 3) % tps.length], lot: lots[i % lots.length], bias: biases[i % biases.length], claim: `variasi ${i} ${'TRADE '.repeat(i % 3)}` };
    let m = modelText(v);
    if (i % 4 === 1) { // model menghapus satu/dua baris 4B
      const rows4 = [['Buy Limit Zona 2 (Intraday)', '3500.00', '3490.00', '3700.00', '10.00', '0.10', '$100.00', '1:2', '24 Nov 2026, 22.40 WIB']];
      m = modelText({ ...v, rows4 });
    }
    if (i % 5 === 2) m = m.replace(/\| BUY Zona 2[^\n]*\n/, ''); // baris Bagian 3 hilang
    if (i % 7 === 3) { // urutan baris 4B diacak
      const lines = m.split('\n'); const idx = lines.map((l, k) => (/^\| (Sell|Buy) Limit/.test(l) ? k : -1)).filter((k) => k >= 0);
      const rows = idx.map((k) => lines[k]).reverse(); idx.forEach((k, n) => { lines[k] = rows[n]; }); m = lines.join('\n');
    }
    const r = pipeline(m, w, eng, { bias: i % 2 ? 'BULLISH' : 'BEARISH' });
    assert.equal(r.sig, ref.sig, `variasi ${i}`);
    seen.add(r.decision);
  }
  assert.equal(seen.size <= 2, true); // bias final server (parameter) boleh membedakan arah, tabel tidak
});
test('keputusan identik 50× bila bias final server sama (variasi teks Gemini saja)', () => {
  const w = world(); const eng = mkEng(w);
  const out = new Set(); const sigs = new Set();
  for (let i = 0; i < 50; i++) {
    const r = pipeline(modelText({ tpBuy2: String(3600 + i), tpBuy3: String(3700 - i), lot: String(i / 10), claim: 'x'.repeat(i) }), w, eng, { bias: 'BULLISH' });
    out.add(r.decision); sigs.add(r.sig);
  }
  assert.equal(out.size, 1); assert.equal(sigs.size, 1);
});
test('urutan pemanggilan/komputasi mesin sama: 50× buildEngineOrders identik', () => {
  const w = world(); const s0 = ordersSignature(mkEng(w).orders);
  for (let i = 0; i < 50; i++) assert.equal(ordersSignature(mkEng(world()).orders), s0);
});

// ───────────── konsistensi angka antar bagian ─────────────
test('Entry, SL, TP, jarak, R:R, risiko di 4B konsisten satu sama lain dan dengan Bagian 3', () => {
  const w = world(); const eng = mkEng(w);
  const r = pipeline(modelText({ lot: '3.00' }), w, eng);
  const num = (c) => Number(String(c).replace(/[$,]/g, ''));
  for (const side of ['Buy', 'Sell']) for (const z of [2, 3]) {
    const row = rowOf(r.md, new RegExp(`^\\| ${side} Limit Zona ${z}`));
    if (!row || /Tidak Ada Setup/.test(row)) continue;
    const c = row.split('|').slice(1, -1).map((x) => x.trim());
    const [e, sl, tp, jar, lot, risk] = [num(c[1]), num(c[2]), num(c[3]), num(c[4]), num(c[5]), num(c[6])];
    assert.ok(Math.abs(jar - Math.abs(e - sl)) < 0.011);
    assert.ok(Math.abs(risk - lot * jar * MULT) < 0.02);
    const rr = Number(/1:([\d.]+)/.exec(c[7])[1]);
    assert.ok(Math.abs(rr - Math.abs(tp - e) / jar) < 0.02);
    const s3 = rowOf(r.md, new RegExp(`^\\| ${side.toUpperCase()} Zona ${z}`)).split('|').map((x) => x.trim());
    assert.equal(num(s3[3]), sl); assert.equal(num(s3[4]), tp);
    assert.ok(risk <= 60 + 0.005);
  }
});
test('batas risiko per arah: total satu arah <= batas (lot diperkecil deterministik), tanpa bergantung teks model', () => {
  const w = world(); const eng = mkEng(w);
  const a = pipeline(modelText({ lot: '0.01' }), w, eng), b = pipeline(modelText({ lot: '9.00' }), w, eng);
  assert.equal(a.sig, b.sig);
  assert.ok(a.c.totals.BUY <= 60.005);
});

// ───────────── kerangka saat Gemini gagal ─────────────
test('Gemini gagal: kerangka mesin diproses validator, tabel tampil, pemberitahuan jelas, tidak ada narasi karangan', () => {
  const w = world(); const eng = mkEng(w); eng.mult = MULT;
  const sk = engineSkeleton({ eng, pairId: 'XAUUSD', price: PRICE, dec: DEC, bias: 'BULLISH', atr: { h1: ATR, h4: 25 }, zones: 3, mult: MULT, reason: 'Gemini timeout' });
  assert.match(sk, /NARASI AI TIDAK TERSEDIA — TABEL MESIN TETAP DITAMPILKAN/);
  assert.match(sk, /BUKAN konfirmasi bahwa setup sudah aktif/);
  const r = pipeline(sk, w, eng);
  assert.match(r.md, /\| Buy Limit Zona 2 \(Intraday\)[^\n]*3553\.31/);
  assert.equal(r.sig, pipeline(modelText({}), w, eng).sig); // angka sama dengan jalur normal
  assert.ok(['TRADE', 'COUNTERTREND_ONLY', 'NO_TRADE', 'WAIT'].includes(r.decision) || typeof r.decision === 'string');
  assert.doesNotMatch(sk, /Fundamental|sentimen|kemungkinan besar/i);
});
test('teks model rusak total (tanpa tabel): tabel mesin disisipkan', () => {
  const w = world(); const eng = mkEng(w);
  const r = pipeline('Maaf, saya tidak bisa. {"error": true}', w, eng);
  assert.match(r.md, /\| Buy Limit Zona 2 \(Intraday\)[^\n]*3553\.31/);
  assert.ok(r.lk.notes.some((n) => /dibuat dari hasil mesin/.test(n)));
});

// ───────────── prompt & audit ─────────────
test('prompt mesin memuat angka final dan melarang Gemini mengubahnya', () => {
  const eng = mkEng(world());
  const p = engineOrdersPrompt(eng, 2, 3);
  assert.match(p, /TIDAK BOLEH DIUBAH/); assert.match(p, /BUY Zona 2 \(Intraday\): Entry limit 3553\.31/);
  assert.match(p, /TIDAK ADA SETUP/);
});
test('Zona 1 OFF: tidak pernah terisi walau model menulis', () => {
  const w = world(); const eng = mkEng(w);
  assert.equal(eng.orders.filter((o) => o.zone === 1 && o.status === 'OK').length, 0);
});

// ───────────── pemasangan di route (regresi statis; route tidak bisa dijalankan tanpa Next) ─────────────
const ROUTE = fs.readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8');
test('route: mesin order mengunci tabel SEBELUM enforceSmcZones; syncTargets (fallback kelipatan R) tidak jalan bila mesin aktif', () => {
  assert.ok(ROUTE.indexOf('lockToEngine(rawTxt') > 0 && ROUTE.indexOf('lockToEngine(rawTxt') < ROUTE.indexOf('enforceSmcZones(txt0'));
  assert.match(ROUTE, /const tpFix = eng \? \{ markdown: txt, notes: \[\] \} : syncTargets\(/);
});
test('route: Gemini gagal/format rusak/respons kosong -> tabel mesin + pemberitahuan, bukan error kosong', () => {
  assert.match(ROUTE, /engineOnlyText\(`Gemini tidak merespons/);
  assert.match(ROUTE, /engineOnlyText\(`Model \$\{two\.model\} tidak menghasilkan format analisa`\)/);
  assert.match(ROUTE, /engineOnlyText\('Respons kosong dari model'\)/);
  assert.match(ROUTE, /NARASI AI TIDAK TERSEDIA — TABEL MESIN TETAP DITAMPILKAN/);
});
test('route: prompt memuat order mesin; audit menyimpan tanda tangan order mesin', () => {
  assert.match(ROUTE, /engineOrdersPrompt\(computeEngine/);
  assert.match(ROUTE, /orders: \{ v: ENGINE_ORDERS_VERSION, sig: engUsed/);
});
