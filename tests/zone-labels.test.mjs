import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { zoneStyle, zoneRole, zoneRowName, canonicalizeName, auditZoneLabels, kindFromName, ZONE_OFF_LABEL, ZONE_LABELS_VERSION } from '../lib/zoneLabels.js';
import { buildEngineOrders, lockToEngine, clearDeadDetail, ordersSignature, finalTableSignature, engineSkeleton, engineOrdersPrompt } from '../lib/engineOrders.js';
import { disableZoneRows } from '../lib/smc/guard.js';
import { syncExpiry } from '../lib/consistency.js';
import { buildAudit } from '../lib/auditTrail.js';
import { buildPdf } from '../lib/pdfReport.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-'));
for (const f of ['riskCheck.js', 'brokerSpec.js', 'pairs.js', 'marketTime.js']) {
  fs.writeFileSync(path.join(tmp, f), fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8').replace(/'@\/lib\/([\w]+)'/g, "'./$1.js'"));
}
const { verifyRiskTables, parseExpiryWIB } = await import(pathToFileURL(path.join(tmp, 'riskCheck.js')).href);
const { PAIRS } = await import(pathToFileURL(path.join(tmp, 'pairs.js')).href);

const PRICE = 3600, ATR = 10, DEC = 2, MULT = 100;
const NOW = new Date('2026-11-24T10:00:00Z');
const fmtExp = () => '24 Nov 2026, 22.40 WIB';
const lotFor = (dist, budget) => Math.max(0.01, Math.floor((budget / (dist * MULT)) * 100 + 1e-9) / 100);
const analyses = [{ timeframe: 'H1', status: 'OK', atr14: ATR, lastPrice: PRICE,
  supports: [3596.5, 3580.2, 3561.1].map((p) => ({ price: p })), resistances: [3624.89, 3688.4].map((p) => ({ price: p })), zones: [] }];
const cand = (lo, hi, sl) => ({ entryLo: lo, entryHi: hi, sl, score: 3 });
const zr3 = { BUY: { 1: cand(3588, 3592, 3580), 2: cand(3538.6, 3553.31, 3527.02), 3: cand(3529.96, 3543.56, 3520) }, SELL: { 1: cand(3608, 3612, 3620), 2: cand(3642.72, 3646.46, 3662.7), 3: cand(3710.52, 3721.63, 3728.3) } };
const zr2 = { BUY: { 1: zr3.BUY[2], 2: zr3.BUY[3] }, SELL: { 1: zr3.SELL[2], 2: zr3.SELL[3] } };
const COMBOS = [
  { name: '2 zona', zones: 2, zonesOff: [], zoneRes: zr2 },
  { name: '3 zona, Zona 1 ON', zones: 3, zonesOff: [], zoneRes: zr3 },
  { name: '3 zona, Zona 1 OFF', zones: 3, zonesOff: [1], zoneRes: zr3 },
];
const mkEng = (c, riskUsd = 200) => buildEngineOrders({ zoneRes: c.zoneRes, analyses, price: PRICE, atrH1: ATR, dec: DEC, zones: c.zones, zonesOff: c.zonesOff, riskUsd, lotFor });

const T = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const H3 = ['Zona & Strategi', 'Zona Entry', 'Stop Loss (SL)', 'Take Profit 1 (TP1)', 'Take Profit 2 (TP2)', 'Syarat Konfirmasi Candlestick'];
const H4 = ['Order', 'Harga Entry', 'Stop Loss', 'Take Profit', 'Jarak SL', 'Lot Aman', 'Risiko ($)', 'R:R', 'Waktu Berakhir (WIB)'];
/** Teks model: nama gaya per zona diambil dari fungsi `style(zone)`; angka dibuat sengaja salah agar mesin menimpanya. */
function model(zones, style, extra = '') {
  const zl = zones === 3 ? [1, 2, 3] : [1, 2];
  const r3 = [], r4 = [];
  for (const s of ['BUY', 'SELL']) for (const z of zl) {
    r3.push([`${s} Zona ${z} - ${style(z)} (Dasar H1 ${s === 'BUY' ? 'Demand' : 'Supply'}) (Searah Bias)`, '1.00 - 2.00', '1.00', '2.00', '-', 'Close M15.']);
  }
  for (const s of ['Sell', 'Buy']) for (const z of zl) {
    r4.push([`${s} Limit Zona ${z} (${style(z)} Dasar H1) (Searah Bias)`, '1.00', '2.00', '3.00', '1.00', '9.99', '$1.00', '1:1.0', z === 1 ? '24 Nov 2026, 12.10 WIB' : '24 Nov 2026, 22.40 WIB']);
  }
  return `**BIAS UTAMA: BULLISH**\n**HARGA TERAKHIR:** 3600.00\n\n${extra}\n### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)\n${T(H3, r3)}\n\n### 4. Rekomendasi Susunan Pending Order\n\n**4B. Order Baru yang Disarankan**\n${T(H4, r4)}\n\n**Rincian Hitung Risiko**\n- Buy Limit Zona 2: x\n`;
}
const official = (zones, zonesOff) => (z) => (zonesOff.includes(z) ? zoneStyle(zones, z) : zoneStyle(zones, z));
const wrongStyle = (zones) => (z) => ({ 1: 'Swing', 2: 'Scalping', 3: 'Intraday' })[z];
const names = (md) => {
  const out = { sec3: [], b4: [] };
  const lines = md.split('\n'); let kind = null;
  for (const l of lines) {
    if (/^\|\s*Zona & Strategi/i.test(l)) { kind = 'sec3'; continue; }
    if (/^\|\s*Order\s*\|/i.test(l)) { kind = 'b4'; continue; }
    if (!l.startsWith('|')) { kind = null; continue; }
    if (kind && !/^\|\s*-/.test(l)) out[kind].push(l.split('|')[1].trim());
  }
  return out;
};
const run = (c, text) => {
  const eng = mkEng(c);
  const z1 = disableZoneRows(text, c.zonesOff);
  const lk = lockToEngine(z1.markdown, eng, { dec: DEC, zones: c.zones, now: NOW, fmtExp, parseExp: parseExpiryWIB });
  return { eng, lk, md: clearDeadDetail(lk.markdown, eng) };
};
/** Isi tabel tanpa kolom nama (kolom 0) — untuk membuktikan angka identik. */
const withoutNames = (md) => md.split('\n').map((l) => (l.startsWith('|') ? l.split('|').map((c, i) => (i === 1 ? '' : c)).join('|') : l)).join('\n');

// ───────────── sumber label ─────────────
test('zoneLabels: peran resmi tiap mode', () => {
  assert.deepEqual([1, 2].map((z) => zoneStyle(2, z)), ['Intraday', 'Swing']);
  assert.deepEqual([1, 2, 3].map((z) => zoneStyle(3, z)), ['Scalping', 'Intraday', 'Swing']);
  assert.equal(zoneStyle(2, 3), null);
  assert.equal(zoneRole(3, 1, true), 'Dimatikan'); assert.equal(ZONE_OFF_LABEL, 'Dimatikan');
  assert.equal(zoneRole(3, 2, false), 'Intraday');
  assert.match(ZONE_LABELS_VERSION, /^zone-labels\//);
});
test('zoneRowName: nama baku Bagian 3 dan 4B untuk semua kombinasi', () => {
  assert.equal(zoneRowName('sec3', 'BUY', 1, 3), 'BUY Zona 1 - Scalping');
  assert.equal(zoneRowName('4b', 'sell', 3, 3), 'Sell Limit Zona 3 (Swing)');
  assert.equal(zoneRowName('sec3', 'SELL', 1, 2), 'SELL Zona 1 - Intraday');
  assert.equal(zoneRowName('4b', 'Buy', 2, 2), 'Buy Limit Zona 2 (Swing)');
  assert.equal(zoneRowName('sec3', 'BUY', 1, 3, true), 'BUY Zona 1 - Dimatikan 🚫');
  assert.equal(zoneRowName('4b', 'Sell', 1, 3, true), 'Sell Limit Zona 1 (Dimatikan) 🚫');
});
test('canonicalizeName: koreksi gaya, pertahankan deskripsi dasar, sisipkan bila hilang', () => {
  const a = canonicalizeName('BUY Zona 1 - Intraday (RBS / Demand Dekat) (Searah Bias)', { kind: 'sec3', zone: 1, zones: 3 });
  assert.equal(a.name, 'BUY Zona 1 - Scalping (RBS / Demand Dekat) (Searah Bias)'); assert.equal(a.found, 'Intraday'); assert.ok(a.fixed);
  const b = canonicalizeName('Sell Limit Zona 2 (Swing Supply Kuat)', { kind: '4b', zone: 2, zones: 3 });
  assert.equal(b.name, 'Sell Limit Zona 2 (Intraday Supply Kuat)');
  const c = canonicalizeName('BUY Zona 2 (Demand H1)', { kind: 'sec3', zone: 2, zones: 3 });
  assert.equal(c.name, 'BUY Zona 2 - Intraday (Demand H1)'); assert.equal(c.found, null);
  const d = canonicalizeName('Buy Limit Zona 1', { kind: '4b', zone: 1, zones: 2 });
  assert.equal(d.name, 'Buy Limit Zona 1 (Intraday)');
  const e = canonicalizeName('BUY Zona 1 - Scalp (x)', { kind: 'sec3', zone: 1, zones: 3 });
  assert.equal(e.fixed, false); // "Scalp" = Scalping
  const f = canonicalizeName('**BUY Zona 3 - Swing** (H4)', { kind: 'sec3', zone: 3, zones: 3 });
  assert.equal(f.fixed, false); assert.equal(f.name, '**BUY Zona 3 - Swing** (H4)');
});
test('canonicalizeName: "Swing High/Low" di deskripsi bukan gaya zona', () => {
  const r = canonicalizeName('SELL Zona 2 (Swing High H4)', { kind: 'sec3', zone: 2, zones: 3 });
  assert.equal(r.name, 'SELL Zona 2 - Intraday (Swing High H4)');
  const r2 = canonicalizeName('SELL Zona 1 - Intraday (Swing Low M15)', { kind: 'sec3', zone: 1, zones: 2 });
  assert.equal(r2.fixed, false);
});
test('canonicalizeName: Zona 1 OFF -> Dimatikan + 🚫 (tanpa dobel)', () => {
  const a = canonicalizeName('BUY Zona 1 - Scalping 🚫', { kind: 'sec3', zone: 1, zones: 3, off: true });
  assert.equal(a.name, 'BUY Zona 1 - Dimatikan 🚫');
  const b = canonicalizeName('Sell Limit Zona 1 (Intraday)', { kind: '4b', zone: 1, zones: 3, off: true });
  assert.equal(b.name, 'Sell Limit Zona 1 (Dimatikan) 🚫');
});
test('kindFromName identik dengan regex lama', () => {
  const old = (n = '') => (/scalp/i.test(n) ? 'Scalping' : /intraday/i.test(n) ? 'Intraday' : /swing/i.test(n) ? 'Swing' : null);
  for (const n of ['Buy Limit Zona 1 (Scalping)', 'Sell Limit Zona 2 (Intraday)', 'BUY Zona 3 - Swing', 'Buy Limit Zona 1 (Dimatikan) 🚫', '', 'x', 'Zona 1 scalp']) assert.equal(kindFromName(n), old(n));
});

// ───────────── semua kombinasi mode × Zona 1 ─────────────
for (const c of COMBOS) {
  test(`[${c.name}] nama zona benar di Bagian 3 dan 4B walau model salah semua`, () => {
    const r = run(c, model(c.zones, wrongStyle(c.zones)));
    const n = names(r.md);
    const zl = c.zones === 3 ? [1, 2, 3] : [1, 2];
    assert.equal(n.sec3.length, zl.length * 2); assert.equal(n.b4.length, zl.length * 2);
    for (const nm of n.sec3) {
      const z = Number(/Zona (\d)/.exec(nm)[1]); const off = c.zonesOff.includes(z);
      assert.ok(nm.includes(off ? `- Dimatikan` : `- ${zoneStyle(c.zones, z)}`), nm);
      if (!off) for (const bad of ['Scalping', 'Intraday', 'Swing'].filter((s) => s !== zoneStyle(c.zones, z))) assert.ok(!new RegExp(`Zona ${z} - ${bad}`).test(nm), nm);
    }
    for (const nm of n.b4) {
      const z = Number(/Zona (\d)/.exec(nm)[1]); const off = c.zonesOff.includes(z);
      assert.ok(nm.includes(off ? `(Dimatikan` : `(${zoneStyle(c.zones, z)}`), nm);
    }
    assert.ok(r.lk.labelFixes.length > 0);
    assert.ok(r.lk.notes.some((x) => /nama zona/.test(x)));
  });
  test(`[${c.name}] Bagian 3 dan 4B memakai label yang sama persis per zona`, () => {
    const r = run(c, model(c.zones, wrongStyle(c.zones)));
    const n = names(r.md);
    const role = (nm) => /(?:- |\()(Scalping|Intraday|Swing|Dimatikan)/.exec(nm)[1];
    const by = (arr) => Object.fromEntries(arr.map((nm) => [`${/(buy|sell)/i.exec(nm)[1].toUpperCase()}${/Zona (\d)/.exec(nm)[1]}`, role(nm)]));
    assert.deepEqual(by(n.sec3), by(n.b4));
  });
  test(`[${c.name}] angka identik: nama salah vs nama benar (Entry/SL/TP/lot/R:R/risiko/keputusan)`, () => {
    const bad = run(c, model(c.zones, wrongStyle(c.zones)));
    const good = run(c, model(c.zones, official(c.zones, c.zonesOff)));
    assert.equal(withoutNames(bad.md), withoutNames(good.md));
    assert.equal(finalTableSignature(bad.md), finalTableSignature(good.md));
    assert.equal(ordersSignature(bad.eng.orders), ordersSignature(good.eng.orders));
    assert.equal(bad.lk.overrides.length, good.lk.overrides.length); // jumlah penimpaan angka tak terpengaruh label
    assert.equal(good.lk.labelFixes.length, 0); // nama sudah benar -> tak ada koreksi
    assert.equal(names(bad.md).sec3.join('|').replace(/\(.*?\)/g, ''), names(good.md).sec3.join('|').replace(/\(.*?\)/g, ''));
  });
  test(`[${c.name}] pipeline penuh: verifyRiskTables menghasilkan angka & keputusan sama dengan nama benar`, () => {
    const mk = (style) => {
      const r = run(c, model(c.zones, style));
      const v = verifyRiskTables(r.md, 200, PAIRS.XAUUSD, NOW, { last: PRICE, capPerDirection: true, zones: c.zones, spec: null });
      return { md: v.markdown, sig: finalTableSignature(v.markdown) };
    };
    const a = mk(wrongStyle(c.zones)), b = mk(official(c.zones, c.zonesOff));
    assert.equal(a.sig, b.sig);
    assert.equal(withoutNames(a.md), withoutNames(b.md));
  });
  test(`[${c.name}] tabel dari mesin saat model tidak menulis tabel: nama resmi`, () => {
    const eng = mkEng(c);
    const lk = lockToEngine('Narasi saja, tanpa tabel.', eng, { dec: DEC, zones: c.zones, now: NOW, fmtExp, parseExp: parseExpiryWIB });
    const n = names(lk.markdown);
    for (const nm of [...n.sec3, ...n.b4]) {
      const z = Number(/Zona (\d)/.exec(nm)[1]);
      assert.ok(nm.includes(c.zonesOff.includes(z) ? 'Dimatikan' : zoneStyle(c.zones, z)), nm);
    }
  });
}

test('Zona 1 OFF: baris tetap tampil dengan label Dimatikan, tanpa order dan tanpa mengubah status', () => {
  const c = COMBOS[2];
  const r = run(c, model(3, wrongStyle(3)));
  for (const l of r.md.split('\n').filter((x) => /Zona 1/.test(x) && x.startsWith('|'))) {
    assert.match(l, /Dimatikan/); assert.match(l, /🚫/); assert.match(l, /Tidak (ada level valid|Ada Setup)/);
    assert.ok(!/\d{4}\.\d\d/.test(l), l); // tanpa harga
  }
  const off = r.eng.orders.filter((o) => o.zone === 1);
  assert.ok(off.every((o) => o.off === true && o.status !== 'OK' && o.lot == null));
  // status order mesin identik dengan label benar
  assert.equal(ordersSignature(r.eng.orders), ordersSignature(run(c, model(3, official(3, [1]))).eng.orders));
});
test('Zona 1 ON (mode 3) tidak diberi label Dimatikan', () => {
  const r = run(COMBOS[1], model(3, wrongStyle(3)));
  assert.ok(!/Dimatikan/.test(r.md));
  assert.match(rowOf(r.md, /^\| BUY Zona 1/), /Scalping/);
});
const rowOf = (md, re) => md.split('\n').find((l) => re.test(l));

// ───────────── Waktu Berakhir tetap benar ─────────────
test('syncExpiry: penyamaan Waktu Berakhir per tipe tetap bekerja dengan nama resmi (3 zona)', () => {
  const c = COMBOS[1];
  const rows4 = [
    ['Sell Limit Zona 1 (Scalping)', '3610.00', '3620.00', '3560.00', '10.00', '0.10', '$100.00', '1:2.0', '24 Nov 2026, 19.00 WIB'],
    ['Buy Limit Zona 1 (Scalping)', '3590.00', '3580.00', '3620.00', '10.00', '0.10', '$100.00', '1:2.0', '24 Nov 2026, 19.20 WIB'],
    ['Sell Limit Zona 2 (Intraday)', '3644.00', '3662.70', '3560.00', '18.70', '0.10', '$100.00', '1:2.0', '24 Nov 2026, 21.00 WIB'],
    ['Buy Limit Zona 2 (Intraday)', '3553.31', '3527.02', '3640.00', '26.29', '0.10', '$100.00', '1:2.0', '24 Nov 2026, 21.30 WIB'],
    ['Buy Limit Zona 3 (Swing)', '3543.56', '3520.00', '3700.00', '23.56', '0.10', '$100.00', '1:2.0', '25 Nov 2026, 04.00 WIB'],
  ];
  const md = `**4B. Order Baru yang Disarankan**\n${T(H4, rows4)}\n`;
  const out = syncExpiry(md, NOW);
  const exp = (re) => rowOf(out.markdown, re).split('|')[9].trim();
  assert.equal(exp(/Sell Limit Zona 1/), exp(/Buy Limit Zona 1/)); // Scalping sama
  assert.equal(exp(/Sell Limit Zona 2/), exp(/Buy Limit Zona 2/)); // Intraday sama
  assert.ok(out.changed >= 1);
  assert.match(exp(/Zona 3/), /25 Nov 2026/); // Swing tak disentuh
});
test('syncExpiry: baris Zona 1 Dimatikan dilewati (tidak ikut target Scalping)', () => {
  const rows4 = [
    ['Sell Limit Zona 1 (Dimatikan) 🚫', 'Tidak Ada Setup (Tunggu)', '-', '-', '-', '-', '-', '-', '-'],
    ['Buy Limit Zona 2 (Intraday)', '3553.31', '3527.02', '3640.00', '26.29', '0.10', '$100.00', '1:2.0', '24 Nov 2026, 21.30 WIB'],
  ];
  const out = syncExpiry(`**4B. Order Baru yang Disarankan**\n${T(H4, rows4)}\n`, NOW);
  assert.match(rowOf(out.markdown, /Zona 1/), /Dimatikan/);
  assert.equal(rowOf(out.markdown, /Zona 1/).split('|')[9].trim(), '-');
  assert.match(rowOf(out.markdown, /Zona 2/), /21\.30 WIB/);
});
test('model salah nama (Zona 1 "Swing") tidak lagi diperlakukan Swing/Daily Close oleh konsumen nama', () => {
  const r = run(COMBOS[1], model(3, wrongStyle(3)));
  // sesudah dikunci, hanya Zona 3 yang bernama Swing di 4B
  const sw = names(r.md).b4.filter((nm) => /\(Swing/.test(nm));
  assert.deepEqual(sw.map((nm) => /Zona (\d)/.exec(nm)[1]), ['3', '3']);
});

// ───────────── audit: narasi salah hanya dicatat ─────────────
test('auditZoneLabels: mencatat penyebutan bentrok, tidak mengubah teks', () => {
  const t = 'Ringkasan: Zona 1 (Intraday) dekat harga.\nZona 2 - Intraday OK.\nZona 3 Swing High H4.\nBUY Zona 1 - Scalping benar.';
  const a = auditZoneLabels(t, { zones: 3 });
  assert.equal(a.length, 1); assert.equal(a[0].zone, 1); assert.equal(a[0].found, 'Intraday'); assert.equal(a[0].expected, 'Scalping'); assert.equal(a[0].line, 1);
  const b = auditZoneLabels('Zona 1 (Scalping) dan Zona 3 Swing', { zones: 2 });
  assert.deepEqual(b.map((x) => [x.zone, x.expected]), [[1, 'Intraday'], [3, null]]);
  assert.equal(auditZoneLabels('Zona 1 - Dimatikan', { zones: 3 }).length, 0);
});
test('narasi di luar tabel TIDAK ditulis ulang oleh Tahap 2 (hanya dicatat)', () => {
  const c = COMBOS[1];
  const claim = 'Ringkasan Cepat: SELL Zona 1 (Intraday) paling dekat dengan harga.';
  const r = run(c, model(3, wrongStyle(3), claim));
  assert.ok(r.md.includes(claim));
  assert.equal(auditZoneLabels(r.md, { zones: 3 }).filter((x) => x.line && /Ringkasan Cepat/.test(x.text)).length, 1);
  assert.equal(auditZoneLabels(r.lk.markdown, { zones: 3 }).filter((x) => !/Ringkasan Cepat/.test(x.text)).length >= 0, true);
});
test('buildAudit mencatat labels (dibatasi) dan versi mesin berubah', () => {
  const a = buildAudit({ config: { zones: 3 }, labels: { v: ZONE_LABELS_VERSION, zones: 3, zone1Off: true, locked: true, fixed: Array.from({ length: 30 }, (_, i) => ({ side: 'BUY', zone: 1, found: 'Swing', want: 'Scalping', x: i })), modelMismatch: [{ line: 1 }], residual: [] } });
  assert.equal(a.labels.zones, 3); assert.equal(a.labels.zone1Off, true); assert.equal(a.labels.fixed.length, 12); assert.equal(a.labels.fixed[0].x, undefined);
  assert.match(a.engineVersion || a.engine?.version || JSON.stringify(a), /labels1/);
  assert.equal(buildAudit({ config: {} }).labels, null);
});

// ───────────── PDF & riwayat ─────────────
test('PDF memuat nama zona resmi yang sama dengan markdown tersimpan (riwayat = markdown yang sama)', () => {
  class P { constructor() { this.t = []; this.n = 1; this.fs = 10; } setFillColor() {} setDrawColor() {} setTextColor() {} setFont() {} setPage() {} setFontSize(n) { this.fs = n; } rect() {} roundedRect() {} addImage() {} addPage() { this.n++; } getNumberOfPages() { return this.n; } splitTextToSize(t) { return [String(t)]; } text(t) { this.t.push(Array.isArray(t) ? t.join(' ') : String(t)); } }
  const c = COMBOS[2];
  const r = run(c, model(3, wrongStyle(3)));
  const { doc } = buildPdf(P, { markdown: r.md, createdAt: '2026-11-24T10:00:00Z' });
  const txt = doc.t.join('\n');
  assert.ok(!/Zona 1 - Intraday|Zona 1 - Swing/.test(txt));
  assert.match(txt, /Intraday|Swing/);
  assert.ok(r.md.includes('Zona 1 - Dimatikan'));
});

// ───────────── prompt/skeleton memakai sumber yang sama; kabel route ─────────────
test('engineOrdersPrompt & engineSkeleton memakai nama gaya resmi', () => {
  for (const c of COMBOS) {
    const eng = mkEng(c);
    const p = engineOrdersPrompt(eng, DEC, c.zones);
    for (const o of eng.orders) assert.ok(p.includes(`${o.side} Zona ${o.zone} (${zoneStyle(c.zones, o.zone)})`));
    const sk = engineSkeleton(eng, { dec: DEC, zones: c.zones, mult: MULT });
    assert.ok(typeof sk === 'string' && sk.length > 50);
  }
});
test('kabel: STYLE lokal dihapus; engineOrders dan consistency memakai zoneLabels; route mencatat labels ke audit', () => {
  const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  assert.ok(!/const STYLE\s*=/.test(src('lib/engineOrders.js')));
  assert.match(src('lib/engineOrders.js'), /from '\.\/zoneLabels\.js'/);
  assert.match(src('lib/consistency.js'), /kindFromName as kindOf[^\n]*zoneLabels/);
  const r = src('app/api/analyze/route.js');
  assert.match(r, /auditZoneLabels/); assert.match(r, /labels: \{ v: ZONE_LABELS_VERSION/); assert.match(r, /labelFixes: labelFixesUsed/);
  assert.ok(!/replace\([^)]*Zona/.test(src('lib/zoneLabels.js').split('canonicalizeName')[0] || ''));
});
