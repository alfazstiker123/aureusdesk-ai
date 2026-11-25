// Lot Mode (Automatic / Manual): regresi 19 butir. Mode AUTOMATIC harus identik dengan perilaku production sebelumnya.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildEngineOrders, makeLotFor, ordersSignature } from '../lib/engineOrders.js';
import { buildDecision } from '../lib/decision.js';
import { finalizeOrders } from '../lib/finalSync.js';
import { buildPdf } from '../lib/pdfReport.js';
import { buildConfig, configHash, buildAudit, auditLine } from '../lib/auditTrail.js';
import { configDiff } from '../lib/configDiff.js';
import { riskTransparency } from '../lib/riskTransparency.js';
import { normalizeSpec, lotFloorSpec } from '../lib/brokerSpec.js';
import {
  normalizeLotMode, parseManualLot, validateManualLot, evaluateManualOrder, fmtLot, buildLotModeBlock, insertLotModeBlock,
  parseLotMode, auditLotConsistency, finalOrderRows, makeManualLotFor, STATUS,
} from '../lib/lotMode.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-'));
for (const f of ['riskCheck.js', 'brokerSpec.js', 'pairs.js', 'marketTime.js']) {
  fs.writeFileSync(path.join(tmp, f), fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8').replace(/'@\/lib\/([\w]+)'/g, "'./$1.js'"));
}
const { verifyRiskTables } = await import(pathToFileURL(path.join(tmp, 'riskCheck.js')).href);
const { PAIRS, riskMult } = await import(pathToFileURL(path.join(tmp, 'pairs.js')).href);

const NOW = new Date('2026-11-25T10:00:00Z');
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// ───────────── fixture ─────────────
const specOf = (o = {}) => ({ lotsize: 100, tickvalue: 1, ticksize: 0.01, digits: 2, point: 0.01, minlot: 0.01, maxlot: 100, lotstep: 0.01, accountCurrency: 'USD', ...o });
const HEAD = '| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |\n|---|---|---|---|---|---|---|---|---|';
const row = (name, e, sl, tp, dist, lot = '0.01', risk = '$1.00') => `| ${name} | ${e} | ${sl} | ${tp} | ${dist} | ${lot} | ${risk} | 1:3.00 | 25 Nov 2026, 23.00 WIB |`;
const tbl = (rows, detail = []) => `**PAIR:** XAUUSD\n\n**4B. Order Baru yang Disarankan**\n\n${HEAD}\n${rows.join('\n')}\n\n**Rincian Hitung Risiko**\n${detail.join('\n')}\n`;
// BUY Z1: dist 10 ; BUY Z2: dist 10 (TP 3x) ; SELL Z1: dist 10
const GOLD_ROWS = [
  row('Buy Limit Zona 1 (Scalping)', '3610.00', '3600.00', '3640.00', '10.00'),
  row('Buy Limit Zona 2 (Intraday)', '3590.00', '3580.00', '3620.00', '10.00'),
];
const GOLD_DETAIL = ['- Buy Limit Zona 1: 0.01 lot x 10.00 x 100 = $10.00', '- Buy Limit Zona 2: 0.01 lot x 10.00 x 100 = $10.00'];
const goldMd = () => tbl(GOLD_ROWS, GOLD_DETAIL);
const run = (md, { cap = 200, lotMode, spec = specOf(), pair = PAIRS.XAUUSD, zones = 2, capPerDirection = true } = {}) =>
  verifyRiskTables(md, cap, pair, NOW, { last: 3600, capPerDirection, zones, spec, requireSpec: true, ...(lotMode ? { lotMode } : {}) });
const MAN = (lot) => ({ mode: 'MANUAL', lot });
const lotsIn = (md) => finalOrderRows(md).filter((r) => r.active).map((r) => r.lot);
const dropped = (md) => (md.match(/Tidak Ada Setup \([^)]*\)/g) || []);

// ───────────── 1. default pengguna lama = Automatic ─────────────
test('1. default tetap AUTOMATIC: tanpa/rusak = AUTOMATIC, hanya "MANUAL" yang mengaktifkan manual', () => {
  for (const v of [undefined, null, '', 'AUTOMATIC', 'automatic', 'auto', 'xyz', 0, 42, {}, 'MANUALX']) assert.equal(normalizeLotMode(v), 'AUTOMATIC', String(v));
  assert.equal(normalizeLotMode('MANUAL'), 'MANUAL');
  assert.equal(normalizeLotMode(' manual '), 'MANUAL');
});
test('1b. UI: state awal AUTOMATIC; hanya nilai tersimpan "MANUAL" yang memulihkan manual; AUTOMATIC tidak menulis penyimpanan', () => {
  const page = read('app/page.js');
  assert.match(page, /useState\('AUTOMATIC'\)/);
  assert.match(page, /localStorage\.getItem\(LS\.lotMode\) === 'MANUAL'\) setLotMode\('MANUAL'\)/);
  assert.match(page, /persist\(LS\.lotMode, m === 'MANUAL' \? 'MANUAL' : ''\)/); // AUTOMATIC = hapus kunci (sama seperti pengguna lama)
  // body ke server hanya menyertakan manualLot pada mode manual
  assert.match(page, /lotMode, \.\.\.\(lotMode === 'MANUAL' \? \{ manualLot \} : \{\}\)/);
});
test('1c. konfigurasi AUTOMATIC identik dengan sebelum fitur (configHash lama tidak berubah)', () => {
  const base = { balance: 1000, risk: 2, riskUsd: 20, zones: 2, zonesOff: [], capPerDirection: true, strict: true, mode: 'single', modeEffective: 'single', engine: 'gemini', geminiModel: 'g', gwModel: '', marketSource: 'mt4', pairChoice: 'XAUUSD', connectionId: null, copyFmt: 'ASLI' };
  const old = buildConfig(base);
  const auto = buildConfig({ ...base, lotMode: 'AUTOMATIC', manualLot: 0.5 });
  assert.deepEqual(auto, old);
  assert.equal(configHash(auto), configHash(old));
  assert.ok(!('lotMode' in auto) && !('manualLot' in auto));
  const man = buildConfig({ ...base, lotMode: 'MANUAL', manualLot: 0.1 });
  assert.equal(man.lotMode, 'MANUAL'); assert.equal(man.manualLot, 0.1);
  assert.notEqual(configHash(man), configHash(old)); // manual dibedakan di jejak audit
});
test('1d. AUTOMATIC: opts.lotMode kosong / AUTOMATIC / undefined menghasilkan keluaran identik byte-per-byte', () => {
  for (const cap of [0, 5, 20, 200]) {
    const a = run(goldMd(), { cap });
    const b = run(goldMd(), { cap, lotMode: { mode: 'AUTOMATIC' } });
    const c = verifyRiskTables(goldMd(), cap, PAIRS.XAUUSD, NOW, { last: 3600, zones: 2, spec: specOf(), requireSpec: true, lotMode: undefined });
    assert.equal(b.markdown, a.markdown); assert.equal(c.markdown, a.markdown);
    assert.deepEqual(b.notes, a.notes); assert.deepEqual(b.totals, a.totals);
  }
});

// ───────────── 2. manual dipakai sesuai input ─────────────
test('2. Manual: semua order baru memakai lot input (menimpa tulisan model), risiko = lot x jarak x tickValue/tickSize', () => {
  const r = run(goldMd(), { cap: 1000, lotMode: MAN(0.05) });
  assert.deepEqual(lotsIn(r.markdown), [0.05, 0.05]);
  assert.match(r.markdown, /\| 0\.05 \| \$50\.00 \|/);
  assert.match(r.markdown, /Buy Limit Zona 1: 0\.05 lot x 10\.00 x 100[^=\n]*= \$50\.00/);
  assert.match(r.markdown, /Buy Limit Zona 2: 0\.05 lot x 10\.00 x 100[^=\n]*= \$50\.00/);
  assert.equal(r.candidates.every((c) => !c.dropped && c.lotCode === STATUS.OK), true);
  assert.equal(r.lotMode.lot, 0.05);
  assert.ok(auditLotConsistency(r.markdown, 0.05).ok);
});
test('2b. Manual: lot tidak dibulatkan (0,10 / "0,10" / 0.10 sama; 0.125 pada step 0.001 dipakai apa adanya)', () => {
  assert.equal(parseManualLot('0,10').value, 0.1);
  assert.equal(parseManualLot(' 0.10 ').value, 0.1);
  const r = run(goldMd(), { cap: 1000, spec: specOf({ lotstep: 0.001 }), lotMode: MAN(parseManualLot('0.125').value) });
  assert.deepEqual(lotsIn(r.markdown), [0.125, 0.125]);
  assert.match(r.markdown, /Risiko|\$125\.00/);
});
test('2c. Manual: mesin order memakai lot input walau anggaran risiko 0; otomatis tetap null tanpa anggaran', () => {
  const zoneRes = { BUY: { 2: { entryLo: 3538.6, entryHi: 3553.31, sl: 3527.02, score: 3 } }, SELL: {} };
  const analyses = [{ timeframe: 'H1', status: 'OK', atr14: 10, lastPrice: 3600, supports: [], resistances: [{ price: 3688.4 }, { price: 3700 }], zones: [] }];
  const base = { zoneRes, analyses, price: 3600, atrH1: 10, dec: 2, zones: 2, zonesOff: [] };
  const man = buildEngineOrders({ ...base, riskUsd: 0, lotFor: makeManualLotFor(0.07) });
  const buy2 = man.orders.find((o) => o.side === 'BUY' && o.zone === 2);
  if (buy2.status === 'OK') assert.equal(buy2.lot, 0.07);
  const lotFor = makeLotFor(100, specOf(), lotFloorSpec);
  const auto = buildEngineOrders({ ...base, riskUsd: 0, lotFor });
  assert.ok(auto.orders.every((o) => o.lot == null)); // perilaku lama
  const manInvalid = buildEngineOrders({ ...base, riskUsd: 50, lotFor: makeManualLotFor(null) });
  assert.ok(manInvalid.orders.filter((o) => o.status === 'OK').every((o) => o.lot === 0)); // 0 -> ditolak validator, bukan lot tebakan
});

// ───────────── 3 & 4. pergantian mode ─────────────
test('3/4. Automatic→Manual→Automatic: tidak ada kebocoran state; hasil otomatis identik di kedua sisi', () => {
  const a1 = run(goldMd(), { cap: 12 });
  const m = run(goldMd(), { cap: 12, lotMode: MAN(0.05) });
  const a2 = run(goldMd(), { cap: 12 });
  assert.equal(a2.markdown, a1.markdown);
  assert.deepEqual(a2.notes, a1.notes);
  assert.notEqual(m.markdown, a1.markdown);
  const m2 = run(goldMd(), { cap: 12, lotMode: MAN(0.05) });
  assert.equal(m2.markdown, m.markdown); // manual → otomatis → manual deterministik
  // otomatis memperkecil lot proporsional ke anggaran; manual menolak order bukan memperkecil
  assert.ok(lotsIn(a1.markdown).every((l) => l <= 0.01 + 1e-9));
  assert.deepEqual(lotsIn(m.markdown), []);
});
test('3b. Manual→Automatic: kunci penyimpanan dihapus, mode kembali AUTOMATIC pada pemuatan berikutnya', () => {
  const page = read('app/page.js');
  assert.match(page, /m === 'MANUAL' \? 'MANUAL' : ''/);
  assert.match(page, /const persist = \(k, v\) => \{[\s\S]*?if \(v\) localStorage\.setItem\(k, v\);\s*else localStorage\.removeItem\(k\);/);
});

// ───────────── 5. persistensi setelah logout/login ─────────────
test('5. setelah logout/login: lockApp hanya menghapus PIN; Lot Mode & lot manual tersimpan dan dipulihkan', () => {
  const page = read('app/page.js');
  const at = page.indexOf('function lockApp()');
  const lock = page.slice(at, page.indexOf('\n  }\n', at));
  assert.match(lock, /persist\(LS\.pin, ''\)/);
  assert.doesNotMatch(lock, /lotMode|manualLot|LS\.lotMode|LS\.manualLot|setLotMode|setManualLot|localStorage\.clear/);
  assert.doesNotMatch(page, /localStorage\.clear\(/);
  // dipulihkan pada inisialisasi (setelah login komponen tetap terpasang / dimuat ulang)
  assert.match(page, /localStorage\.getItem\(LS\.lotMode\)/);
  assert.match(page, /localStorage\.getItem\(LS\.manualLot\)/);
  assert.match(page, /onManualLot=\{\(v\) => \{ setManualLot\(v\); persist\(LS\.manualLot, v\); \}\}/);
  // memakai mekanisme penyimpanan lama (localStorage via LS/persist), bukan penyimpanan baru
  assert.match(page, /lotMode: 'aureus_lot_mode'/);
  assert.doesNotMatch(read('app/api/analyze/route.js'), /lot_mode.*(insert|upsert)/i);
});

// ───────────── 6-8. validasi min / maks / step ─────────────
test('6. lot manual di bawah minimum broker ditolak, TIDAK dinaikkan ke minimum', () => {
  const r = run(goldMd(), { cap: 1000, lotMode: MAN(0.005) });
  assert.deepEqual(lotsIn(r.markdown), []);
  assert.ok(!/\| 0\.01 \|/.test(r.markdown.split('Verifikasi risiko')[0]));
  assert.equal(dropped(r.markdown).length, 2);
  assert.match(r.markdown, /Lot Manual Tidak Valid/);
  assert.match(r.notes.join('\n'), /LOT TIDAK VALID — Buy Limit Zona 1 \(Scalping\): lot 0\.005 di bawah lot minimum broker 0\.01/);
  assert.equal(r.candidates.every((c) => c.dropped && c.lotCode === STATUS.LOT_INVALID), true);
  // minimum broker 0.10: lot 0.05 ditolak (bukan dinaikkan ke 0.10)
  const r2 = run(goldMd(), { cap: 1000, spec: specOf({ minlot: 0.1, lotstep: 0.1 }), lotMode: MAN(0.05) });
  assert.deepEqual(lotsIn(r2.markdown), []);
  assert.match(r2.notes.join('\n'), /di bawah lot minimum broker 0\.1/);
});
test('7. lot manual di atas maksimum broker ditolak, TIDAK dipangkas ke maksimum', () => {
  const r = run(goldMd(), { cap: 1e9, spec: specOf({ maxlot: 5 }), lotMode: MAN(10) });
  assert.deepEqual(lotsIn(r.markdown), []);
  assert.match(r.notes.join('\n'), /di atas lot maksimum broker 5/);
  assert.ok(!/\| 5\.00 \|/.test(r.markdown));
  const ok = run(goldMd(), { cap: 1e9, spec: specOf({ maxlot: 5 }), lotMode: MAN(5) });
  assert.deepEqual(lotsIn(ok.markdown), [5, 5]);
});
test('8. lot manual bukan kelipatan lot step ditolak, TIDAK dibulatkan ke bawah', () => {
  const sp = specOf({ lotstep: 0.05, minlot: 0.05 });
  const bad = run(goldMd(), { cap: 1e9, spec: sp, lotMode: MAN(0.07) });
  assert.deepEqual(lotsIn(bad.markdown), []);
  assert.match(bad.notes.join('\n'), /bukan kelipatan lot step broker 0\.05/);
  assert.deepEqual(lotsIn(run(goldMd(), { cap: 1e9, spec: sp, lotMode: MAN(0.1) }).markdown), [0.1, 0.1]);
  assert.equal(validateManualLot(0.015, specOf()).code, 'STEP');
  assert.equal(validateManualLot(0.3, specOf({ lotstep: 0.1, minlot: 0.1 })).status, 'VALID'); // 0.3/0.1 float aman
  assert.equal(validateManualLot(0.03, specOf()).status, 'VALID');
});
test('8b. format/angka tidak valid: kosong, 0, negatif, huruf, NaN, Infinity, notasi ilmiah, desimal berlebih', () => {
  for (const v of ['', ' ', null, undefined, 0, '0', -1, '-0.1', 'abc', NaN, Infinity, '1e2', '0.1.2', '0,1,2', '0.0000001', {}, [], true]) {
    assert.equal(parseManualLot(v).ok, false, String(v));
    const r = run(goldMd(), { cap: 1e9, lotMode: MAN(parseManualLot(v).value) });
    assert.deepEqual(lotsIn(r.markdown), [], String(v));
    assert.equal(dropped(r.markdown).length, 2, String(v));
  }
});

// ───────────── 9-10. risk cap ─────────────
test('9. risiko manual di bawah batas: lolos, lot tidak berubah, status LOT VALID · DALAM BATAS, persen terhitung', () => {
  const r = run(goldMd(), { cap: 200, lotMode: MAN(0.1) }); // $100 per order, total BUY $200 = batas
  assert.deepEqual(lotsIn(r.markdown), [0.1, 0.1]);
  assert.ok(r.totals.BUY <= 200 + 0.005);
  const b = buildLotModeBlock({ markdown: r.markdown, mode: 'MANUAL', manualLot: 0.1, candidates: r.candidates, maxRiskUsd: 200, balance: 10000, riskPct: 2, mult: r.mult, spec: r.spec, specOk: r.specOk });
  assert.match(b.text, /LOT MODE: MANUAL\*\* — lot 0\.10 berasal dari INPUT ANDA, bukan kalkulasi sistem/);
  assert.match(b.text, /Buy Z1: Lot 0\.10 \(MANUAL\) · Entry 3610\.00 · SL 3600\.00 · Risiko \$100\.00 \(1\.00% dari saldo \$10,000\) · LOT VALID · DALAM BATAS RISIKO/);
  assert.ok(b.items.every((i) => i.status === STATUS.OK));
});
test('10. risiko manual di atas batas: OVER RISK, order ditolak, lot TIDAK dikurangi, tidak ada order lolos', () => {
  const r = run(goldMd(), { cap: 50, lotMode: MAN(0.1) }); // $100 > $50
  assert.deepEqual(lotsIn(r.markdown), []);
  assert.equal(r.candidates.every((c) => c.dropped && c.lotCode === STATUS.OVER_RISK), true);
  assert.match(r.notes.join('\n'), /OVER RISK — Buy Limit Zona 1 \(Scalping\): lot manual 0\.10 berisiko \$100\.00 > batas \$50\.00 \(lebih \$50\.00\)/);
  assert.match(r.notes.join('\n'), /tidak dikurangi otomatis/);
  const b = buildLotModeBlock({ markdown: r.markdown, mode: 'MANUAL', manualLot: 0.1, candidates: r.candidates, maxRiskUsd: 50, balance: 1000, riskPct: 5, mult: r.mult, spec: r.spec, specOk: r.specOk });
  assert.match(b.text, /Buy Z1: ⛔ OVER RISK — lot 0\.10 berisiko \$100\.00 \(10\.00% dari saldo \$1,000\) > batas \$50\.00 \(lebih \$50\.00\)/);
  assert.ok(!/DALAM BATAS/.test(b.text));
  // transparansi lama membaca penolakan manual tanpa klaim "lot minimum"
  const rt = riskTransparency({ candidates: r.candidates, maxRiskUsd: 50, riskPct: 5, final: 'BULLISH', decision: { status: 'NO_TRADE' } });
  assert.match(rt.text, /OVER RISK — lot manual 0\.1 berisiko \$100\.00/);
  assert.doesNotMatch(rt.text, /anggaran risiko tidak cukup untuk lot minimum/);
});
test('10b. total per arah melewati batas walau tiap order di bawah batas: zona terjauh ditolak, lot tidak diperkecil', () => {
  const r = run(goldMd(), { cap: 200, lotMode: MAN(0.15) }); // $150 + $150 = $300 > $200
  assert.deepEqual(lotsIn(r.markdown), [0.15]);
  assert.match(r.markdown, /Buy Limit Zona 1[^\n]*\| 0\.15 \| \$150\.00 \|/);
  assert.match(r.markdown, /Buy Limit Zona 2[^\n]*Tidak Ada Setup \(Batas Risiko/);
  assert.match(r.notes.join('\n'), /OVER RISK — total risiko BUY \$300\.00/);
  assert.ok(r.totals.BUY <= 200 + 0.005);
  const z2 = r.candidates.find((c) => c.zone === 2);
  assert.equal(z2.lotCode, STATUS.OVER_RISK);
});
test('10c. Automatic: pembulatan lot tidak melewati batas; lot minimum di atas batas = ditolak (tidak dipaksa)', () => {
  const auto = run(tbl([row('Buy Limit Zona 1 (Scalping)', '3610.00', '3600.00', '3640.00', '10.00', '0.30', '$300.00')]), { cap: 25 });
  const lot = lotsIn(auto.markdown)[0];
  assert.ok(lot * 10 * 100 <= 25 + 0.005, `lot ${lot}`);
  assert.equal(lot, 0.02); // floor(25/1000/0.01)*0.01
  const forced = run(tbl([row('Buy Limit Zona 1 (Scalping)', '3610.00', '3600.00', '3640.00', '10.00', '0.01', '$10.00')]), { cap: 5 });
  assert.deepEqual(lotsIn(forced.markdown), []);
  assert.match(forced.notes.join('\n'), /NO TRADE — risiko \$10\.00 pada lot minimum broker 0\.01 melebihi batas \$5\.00/);
});

// ───────────── 11. SL tidak valid ─────────────
test('11. SL tidak ada / nol / tidak terbaca: lot tidak dianggap tervalidasi, order ditolak', () => {
  for (const [sl, dist] of [['-', '-'], ['3610.00', '0.00'], ['n/a', '-'], ['', '-']]) {
    const md = tbl([row('Buy Limit Zona 1 (Scalping)', '3610.00', sl, '3640.00', dist)]);
    const r = run(md, { cap: 1000, lotMode: MAN(0.05) });
    assert.deepEqual(lotsIn(r.markdown), [], sl);
    assert.equal(r.candidates[0]?.lotCode, STATUS.SL_INVALID, sl);
    assert.match(r.notes.join('\n'), /SL TIDAK VALID/, sl);
  }
  const ev = evaluateManualOrder({ lot: 0.05, entry: 3610, sl: 3610, mult: 100, specOk: true, spec: specOf(), maxRiskUsd: 100, balance: 1000 });
  assert.equal(ev.status, STATUS.SL_INVALID); assert.equal(ev.risk, null);
  assert.equal(evaluateManualOrder({ lot: 0.05, entry: 3610, sl: null, mult: 100, specOk: true, spec: specOf(), maxRiskUsd: 100 }).status, STATUS.SL_INVALID);
});

// ───────────── 12. spesifikasi broker tidak lengkap ─────────────
test('12. spesifikasi broker tidak ada/tidak lengkap: RISK CALCULATION UNAVAILABLE, tidak ada klaim aman, order ditolak', () => {
  const cases = { 'tanpa spesifikasi': null, 'tanpa lot min/maks/step': { tickvalue: 1, ticksize: 0.01 }, 'tanpa lot step': specOf({ lotstep: null }), 'tanpa tickvalue': { ...specOf(), tickvalue: null } };
  for (const [name, sp] of Object.entries(cases)) {
    const r = run(goldMd(), { cap: 1000, spec: sp, lotMode: MAN(0.05) });
    assert.deepEqual(lotsIn(r.markdown), [], name);
    assert.equal(r.candidates.every((c) => c.dropped && c.lotCode === STATUS.RISK_UNAVAILABLE), true, name);
    assert.match(r.notes.join('\n'), /RISK CALCULATION UNAVAILABLE/, name);
    const b = buildLotModeBlock({ markdown: r.markdown, mode: 'MANUAL', manualLot: 0.05, candidates: r.candidates, maxRiskUsd: 1000, balance: 10000, riskPct: 10, mult: r.mult, spec: r.spec, specOk: r.specOk });
    assert.match(b.text, /RISK CALCULATION UNAVAILABLE/, name);
    assert.doesNotMatch(b.text, /DALAM BATAS|LOT VALID/, name);
  }
});
test('12b. batas risiko / saldo belum diisi: kepatuhan risiko tidak dinyatakan (UNAVAILABLE), bukan "aman"', () => {
  const r = run(goldMd(), { cap: 0, lotMode: MAN(0.05) });
  assert.deepEqual(lotsIn(r.markdown), []);
  assert.equal(r.candidates.every((c) => c.lotCode === STATUS.RISK_UNAVAILABLE), true);
  assert.match(r.notes.join('\n'), /batas risiko \(saldo × risiko %\) belum diisi/);
  assert.equal(evaluateManualOrder({ lot: 0.05, entry: 3610, sl: 3600, mult: 100, specOk: true, spec: specOf(), maxRiskUsd: 0 }).status, STATUS.RISK_UNAVAILABLE);
  assert.equal(evaluateManualOrder({ lot: 0.05, entry: 3610, sl: 3600, mult: null, specOk: false, spec: null, maxRiskUsd: 100 }).status, STATUS.RISK_UNAVAILABLE);
});
test('12c. Automatic tanpa spesifikasi tetap seperti sebelumnya (peringatan perkiraan, bukan UNAVAILABLE)', () => {
  const r = run(goldMd(), { cap: 200, spec: null });
  assert.match(r.notes.join('\n'), /SPESIFIKASI BROKER TIDAK TERSEDIA/);
  assert.ok(lotsIn(r.markdown).length >= 1);
  const b = buildLotModeBlock({ markdown: r.markdown, mode: 'AUTOMATIC', candidates: r.candidates, maxRiskUsd: 200, balance: 10000, riskPct: 2, mult: r.mult, spec: r.spec, specOk: r.specOk });
  assert.match(b.text, /LOT MODE: AUTOMATIC/);
  assert.match(b.text, /\(OTOMATIS\)/);
  assert.match(b.text, /PERKIRAAN: spesifikasi broker tidak tersedia/);
  assert.doesNotMatch(b.text, /LOT VALID/);
});

// ───────────── 13. tick size ≠ digits ─────────────
test('13. risiko memakai tickValue/tickSize broker, bukan 10^-digits atau pengali tetap', () => {
  // tickSize 0.05, tickValue 5 (mult 100) padahal digits 2: sama dengan profil
  const sp1 = specOf({ ticksize: 0.05, tickvalue: 5, point: 0.01 });
  const r1 = run(goldMd(), { cap: 1e6, spec: sp1, lotMode: MAN(0.1) });
  assert.match(r1.markdown, /\| 0\.10 \| \$100\.00 \|/);
  // broker lain: tickValue 2 per 0.01 -> mult 200 (kontrak 200 oz): risiko berlipat, bukan pengali tetap 100
  const sp2 = specOf({ tickvalue: 2 });
  const r2 = run(goldMd(), { cap: 1e6, spec: sp2, lotMode: MAN(0.1) });
  assert.match(r2.markdown, /\| 0\.10 \| \$200\.00 \|/);
  assert.match(r2.markdown, /0\.10 lot x 10\.00 x 200[^=\n]*= \$200\.00/);
  // dua broker, tick berbeda dari digits, cap sama: satu lolos, satu OVER RISK
  const cap = 150;
  assert.deepEqual(lotsIn(run(goldMd(), { cap, spec: sp1, lotMode: MAN(0.1) }).markdown).length > 0, true);
  const over = run(goldMd(), { cap, spec: sp2, lotMode: MAN(0.1) });
  assert.deepEqual(lotsIn(over.markdown), []);
  assert.equal(over.candidates[0].lotCode, STATUS.OVER_RISK);
  const s = normalizeSpec({ lotsize: 100, tickvalue: 5, ticksize: 0.05, digits: 2, point: 0.01, minlot: 0.01, maxlot: 100, lotstep: 0.01 });
  assert.equal(s.valid, true);
});

// ───────────── 14. pair JPY ─────────────
const jpyRows = (side) => [row(`${side} Limit Zona 1 (Intraday)`, side === 'Buy' ? '155.500' : '155.000', side === 'Buy' ? '155.000' : '155.500', side === 'Buy' ? '157.000' : '153.500', '0.500')];
const jpyMd = (side = 'Buy') => `**PAIR:** USDJPY\n\n**4B. Order Baru yang Disarankan**\n\n${HEAD}\n${jpyRows(side).join('\n')}\n`;
test('14. pair JPY: mult dari tickValue/tickSize broker (≈645), 3 digit, JPY→USD tidak diasumsikan tetap', () => {
  const sp = specOf({ lotsize: 100000, tickvalue: 0.645, ticksize: 0.001, digits: 3, point: 0.001 });
  const mult = riskMult(PAIRS.USDJPY, 155.5, { spec: sp }).mult;
  assert.ok(Math.abs(mult - 645) < 1e-9);
  const r = verifyRiskTables(jpyMd(), 100, PAIRS.USDJPY, NOW, { last: 155.5, zones: 2, spec: sp, requireSpec: true, lotMode: MAN(0.1) });
  assert.deepEqual(lotsIn(r.markdown), [0.1]);
  assert.match(r.markdown, /\| 0\.10 \| \$32\.25 \|/); // 0.1 x 0.5 x 645
  const over = verifyRiskTables(jpyMd(), 30, PAIRS.USDJPY, NOW, { last: 155.5, zones: 2, spec: sp, requireSpec: true, lotMode: MAN(0.1) });
  assert.equal(over.candidates[0].lotCode, STATUS.OVER_RISK);
  // tanpa spesifikasi JPY: profil hanya perkiraan -> manual tidak menebak
  const none = verifyRiskTables(jpyMd(), 100, PAIRS.USDJPY, NOW, { last: 155.5, zones: 2, spec: null, requireSpec: true, lotMode: MAN(0.1) });
  assert.deepEqual(lotsIn(none.markdown), []);
  assert.equal(none.candidates[0].lotCode, STATUS.RISK_UNAVAILABLE);
});
test('14b. pair JPY SELL: arah tidak memengaruhi validasi lot', () => {
  const sp = specOf({ lotsize: 100000, tickvalue: 0.645, ticksize: 0.001, digits: 3, point: 0.001 });
  const r = verifyRiskTables(jpyMd('Sell'), 100, PAIRS.USDJPY, NOW, { last: 155.5, zones: 2, spec: sp, requireSpec: true, lotMode: MAN(0.1) });
  assert.deepEqual(lotsIn(r.markdown), [0.1]);
});

// ───────────── 15. XAUUSD ─────────────
test('15. XAUUSD: lot 0.10, jarak 10.00 → $100.00 dari tickValue/tickSize; status & batas konsisten', () => {
  const r = run(goldMd(), { cap: 200, lotMode: MAN(0.1) });
  assert.match(r.markdown, /\| Buy Limit Zona 1 \(Scalping\) \| 3610\.00 \| 3600\.00 \| 3640\.00 \| 10\.00 \| 0\.10 \| \$100\.00 \|/);
  assert.equal(r.mult, 100);
});

// ───────────── 16. multi-pair & multi-broker ─────────────
const PAIR_CASES = [
  { id: 'XAUUSD', price: 3600, dist: 10, dec: 2, spec: specOf(), mult: 100 },
  { id: 'EURUSD', price: 1.1, dist: 0.0025, dec: 5, spec: specOf({ lotsize: 100000, tickvalue: 1, ticksize: 0.00001, digits: 5, point: 0.00001 }), mult: 100000 },
  { id: 'USDJPY', price: 155.5, dist: 0.5, dec: 3, spec: specOf({ lotsize: 100000, tickvalue: 0.645, ticksize: 0.001, digits: 3, point: 0.001 }), mult: 645 },
  { id: 'XAGUSD', price: 30, dist: 0.5, dec: 3, spec: specOf({ lotsize: 5000, tickvalue: 5, ticksize: 0.001, digits: 3, point: 0.001 }), mult: 5000 },
  { id: 'BTCUSD', price: 90000, dist: 500, dec: 2, spec: specOf({ lotsize: 1, tickvalue: 0.01, ticksize: 0.01, digits: 2, point: 0.01 }), mult: 1 },
];
test('16. multi-pair: tiap pair memakai mult spesifikasinya sendiri; hasil = lot x jarak x tickValue/tickSize', () => {
  for (const c of PAIR_CASES) {
    const f = (n) => n.toFixed(c.dec);
    const md = `**PAIR:** ${c.id}\n\n**4B. Order Baru yang Disarankan**\n\n${HEAD}\n${row('Buy Limit Zona 1 (Intraday)', f(c.price), f(c.price - c.dist), f(c.price + c.dist * 3), f(c.dist))}\n`;
    const r = verifyRiskTables(md, 1e9, PAIRS[c.id], NOW, { last: c.price, zones: 2, spec: c.spec, requireSpec: true, lotMode: MAN(0.2) });
    const want = 0.2 * c.dist * c.mult;
    assert.deepEqual(lotsIn(r.markdown), [0.2], c.id);
    assert.ok(Math.abs(r.totals.BUY - want) < 0.011, `${c.id} ${r.totals.BUY} vs ${want}`);
    assert.equal(Math.round(r.mult * 1e6) / 1e6, c.mult, c.id);
  }
});
test('16b. multi-broker: lot yang sama valid di broker A, ditolak di broker B (min/step beda) dan broker C (tickValue beda → OVER RISK)', () => {
  const A = specOf();
  const B = specOf({ minlot: 0.1, lotstep: 0.1 });
  const C = specOf({ tickvalue: 3 }); // mult 300
  const md = tbl([GOLD_ROWS[0]], [GOLD_DETAIL[0]]);
  const ra = run(md, { cap: 200, spec: A, lotMode: MAN(0.05) });
  const rb = run(md, { cap: 200, spec: B, lotMode: MAN(0.05) });
  const rc = run(md, { cap: 100, spec: C, lotMode: MAN(0.05) }); // 0.05 x 10 x 300 = $150 > $100
  assert.deepEqual(lotsIn(ra.markdown), [0.05]);
  assert.deepEqual(lotsIn(rb.markdown), []); assert.equal(rb.candidates[0].lotCode, STATUS.LOT_INVALID);
  assert.deepEqual(lotsIn(rc.markdown), []); assert.equal(rc.candidates[0].lotCode, STATUS.OVER_RISK);
  // mata uang akun bukan USD: tetap dihitung dari tickValue broker + catatan satuan
  const eur = run(md, { cap: 200, spec: specOf({ accountCurrency: 'EUR' }), lotMode: MAN(0.05) });
  assert.match(eur.notes.join('\n'), /Akun broker dalam EUR/);
  assert.deepEqual(lotsIn(eur.markdown), [0.05]);
});
test('16c. route: manual diteruskan ke mesin order DAN validator dengan spesifikasi koneksi yang sama; konfigurasi dicatat', () => {
  const route = read('app/api/analyze/route.js');
  assert.match(route, /const lotModeSel = normalizeLotMode\(body\.lotMode\)/);
  assert.match(route, /lotCfg\.mode === 'MANUAL' \? makeManualLotFor\(lotCfg\.lot\) : makeLotFor\(RM\.mult, spec, lotFloorSpec\)/);
  assert.match(route, /spec: mt4ContextUsed\?\.brokerSpec \|\| null, requireSpec: true,[^\n]*lotMode: lotCfg \}\)/);
  assert.match(route, /buildConfig\(\{ lotMode: lotCfg\.mode, manualLot: lotCfg\.lot,/);
  assert.match(route, /buildLotModeBlock\(\{ markdown, mode: lotCfg\.mode, manualLot: lotCfg\.lot/);
  assert.match(route, /auditLotConsistency\(markdown, lotCfg\.lot\)/);
  assert.match(route, /lotMode: \{ mode: lotCfg\.mode, lot: lotCfg\.lot \?\? null \}/);
  // tidak ada batas risiko kedua: batas manual = riskUsd yang sama
  assert.ok(!/manualRiskCap|maxRiskManual/.test(route));
});

// ───────────── 17. PDF & riwayat = hasil analisis ─────────────
class MockPdf {
  constructor() { this.pages = 1; this.texts = []; this.fs = 10; }
  setFillColor() {} setDrawColor() {} setTextColor() {} setFont() {} setPage() {} setFontSize(n) { this.fs = n; }
  rect() {} roundedRect() {} addImage() {} addPage() { this.pages += 1; } getNumberOfPages() { return this.pages; }
  splitTextToSize(t) { return [String(t)]; }
  text(t) { this.texts.push(Array.isArray(t) ? t.join(' ') : String(t)); }
}
function finalMarkdown(mode, lot, cap = 200) {
  const r = run(goldMd(), { cap, lotMode: mode === 'MANUAL' ? MAN(lot) : undefined });
  let md = `**BIAS UTAMA:** BULLISH\n\n**PAIR:** XAUUSD\n\n**HARGA TERAKHIR:** 3600.00\n\n> 🎯 **KEPUTUSAN SERVER — SETUP UTAMA BUY Zona 1:** contoh.\n\n### 1. Analisa Fundamental\nx\n\n### 2. Analisa Teknikal\nx\n\n### 3. Pemetaan Setup\nx\n\n### 4. Rekomendasi Susunan Pending Order\n\n${r.markdown}`;
  const b = buildLotModeBlock({ markdown: md, mode, manualLot: mode === 'MANUAL' ? lot : null, candidates: r.candidates, maxRiskUsd: cap, balance: 10000, riskPct: 2, mult: r.mult, spec: r.spec, specOk: r.specOk });
  md = insertLotModeBlock(md, b.text);
  return { md, r, b };
}
test('17. riwayat & PDF = hasil analisis: markdown tersimpan memuat blok yang sama; PDF memuat lot, sumber, dan angka identik', () => {
  const { md, r } = finalMarkdown('MANUAL', 0.1);
  const stored = JSON.parse(JSON.stringify({ analysis_markdown: md })).analysis_markdown; // simpan → muat riwayat
  assert.equal(stored, md);
  assert.deepEqual(parseLotMode(stored), { mode: 'MANUAL', lot: 0.1, present: true });
  assert.deepEqual(finalOrderRows(stored), finalOrderRows(md));
  const doc = new MockPdf();
  buildPdf(function () { return doc; }, { markdown: stored, pair: 'XAUUSD', createdAt: NOW.toISOString(), maxRiskUsd: '200.00' });
  const text = doc.texts.join('\n');
  assert.match(text, /LOT MODE: MANUAL/);
  assert.match(text, /Lot: 0\.10 \(MANUAL\)/);
  assert.match(text, /Risiko: \$100\.00/);
  // angka yang sama dengan hasil analisis
  for (const row of finalOrderRows(md).filter((x) => x.active)) assert.ok(text.includes(`Lot: ${row.lotTxt} (MANUAL)`), row.lotTxt);
  assert.ok(auditLotConsistency(md, 0.1).ok);
  assert.ok(r.totals.BUY <= 200 + 0.005);
});
test('17b. analisis lama (tanpa blok) dibaca AUTOMATIC dan PDF tidak berubah; mode otomatis diberi tanda OTOMATIS', () => {
  const old = `**PAIR:** XAUUSD\n\n${run(goldMd(), { cap: 200 }).markdown}`;
  assert.deepEqual(parseLotMode(old), { mode: 'AUTOMATIC', lot: null, present: false });
  const d1 = new MockPdf(); buildPdf(function () { return d1; }, { markdown: old, pair: 'XAUUSD' });
  assert.ok(!/\((MANUAL|OTOMATIS)\)/.test(d1.texts.join('\n')));
  const { md } = finalMarkdown('AUTOMATIC');
  assert.deepEqual(parseLotMode(md), { mode: 'AUTOMATIC', lot: null, present: true });
  const d2 = new MockPdf(); buildPdf(function () { return d2; }, { markdown: md, pair: 'XAUUSD' });
  assert.match(d2.texts.join('\n'), /\(OTOMATIS\)/);
});
test('17c. blok idempotent, lot manual konsisten di tabel, Rincian, dan blok; ketidakkonsistenan terdeteksi', () => {
  const { md } = finalMarkdown('MANUAL', 0.05);
  assert.equal(insertLotModeBlock(md, '').includes('💼 **LOT MODE'), false);
  const again = insertLotModeBlock(md, md.match(/> 💼[\s\S]*?\n(?=\n|$)/)?.[0] || '');
  assert.equal((again.match(/💼 \*\*LOT MODE/g) || []).length, 1);
  assert.ok(auditLotConsistency(md, 0.05).ok);
  const tampered = md.replace('0.05 lot x 10.00', '0.01 lot x 10.00');
  const ac = auditLotConsistency(tampered, 0.05);
  assert.equal(ac.ok, false); assert.match(ac.mismatches.join(), /Rincian/);
  const tbl2 = md.replace(/\| 0\.05 \| \$50\.00 \|/, '| 0.03 | $30.00 |');
  assert.equal(auditLotConsistency(tbl2, 0.05).ok, false);
  const b = buildLotModeBlock({ markdown: tbl2, mode: 'MANUAL', manualLot: 0.05, candidates: [], maxRiskUsd: 200, balance: 10000, riskPct: 2, mult: 100, spec: specOf(), specOk: true });
  assert.match(b.text, /lot di tabel berbeda dari input manual: JANGAN dipakai/);
});
test('17d. jejak audit & perbandingan konfigurasi mencatat Lot Mode', () => {
  const cfg = buildConfig({ balance: 10000, risk: 2, riskUsd: 200, lotMode: 'MANUAL', manualLot: 0.1, zones: 2 });
  const audit = buildAudit({ config: cfg, env: {}, now: NOW });
  assert.match(auditLine(audit), /LOT MANUAL 0\.1/);
  const autoAudit = buildAudit({ config: buildConfig({ balance: 10000, risk: 2, riskUsd: 200, zones: 2 }), env: {}, now: NOW });
  assert.doesNotMatch(auditLine(autoAudit), /LOT MANUAL/);
  // perangkat sekarang Automatic vs analisis tersimpan Manual -> peringatan; analisis lama (tanpa kunci) vs Automatic -> tidak ada
  assert.deepEqual(configDiff(cfg, { balance: 10000, risk: 2, lotMode: 'AUTOMATIC' }).map((d) => d.key), ['lotMode']);
  assert.deepEqual(configDiff(autoAudit.config, { balance: 10000, risk: 2, lotMode: 'AUTOMATIC' }), []);
  assert.deepEqual(configDiff(autoAudit.config, { balance: 10000, risk: 2 }), []);
  assert.deepEqual(configDiff(cfg, { balance: 10000, risk: 2, lotMode: 'MANUAL', manualLot: 0.1 }), []);
  assert.deepEqual(configDiff(cfg, { balance: 10000, risk: 2, lotMode: 'MANUAL', manualLot: 0.2 }).map((d) => d.key), ['lotMode']);
});

// ───────────── 18. empat status keputusan tidak berubah karena mode ─────────────
const SEC3 = '| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat |\n|---|---|---|---|---|---|\n';
const sec3 = (side, lo, hi, sl, tp) => `${SEC3}| ${side} Zona 1 - Scalping (Searah Bias) | ${lo} - ${hi} | ${sl} | ${tp} | ${tp} | x |\n\n`;
const DEC = {
  TRADE: { sec3: sec3('BUY', '3600.00', '3610.00', '3600.00', '3640.00'), bias: 'BULLISH', neutral: false, rows: [row('Buy Limit Zona 1 (Scalping)', '3610.00', '3600.00', '3640.00', '10.00')] },
  WAIT: { sec3: sec3('BUY', '3600.00', '3610.00', '3600.00', '3640.00'), bias: 'BULLISH', neutral: true, rows: [row('Buy Limit Zona 1 (Scalping)', '3610.00', '3600.00', '3640.00', '10.00')] },
  COUNTERTREND_ONLY: { sec3: sec3('SELL', '3640.00', '3650.00', '3650.00', '3610.00'), bias: 'BULLISH', neutral: false, rows: [row('Sell Limit Zona 1 (Scalping)', '3640.00', '3650.00', '3610.00', '10.00')] },
  NO_TRADE: { sec3: sec3('BUY', '3600.00', '3610.00', '3600.00', '3640.00'), bias: 'NETRAL', neutral: false, rows: [row('Buy Limit Zona 1 (Scalping)', '3610.00', '3600.00', '3640.00', '10.00')] },
};
test('18. TRADE/WAIT/NO TRADE/COUNTERTREND tidak berubah hanya karena mode lot (lot manual = lot otomatis, valid)', () => {
  for (const [want, sc] of Object.entries(DEC)) {
    const md = sc.sec3 + tbl(sc.rows, []);
    const auto = run(md, { cap: 200 });
    const lot = lotsIn(auto.markdown)[0];
    const man = run(md, { cap: 200, lotMode: MAN(lot) });
    assert.equal(man.markdown.replace(/> 🧮[\s\S]*$/, ''), auto.markdown.replace(/> 🧮[\s\S]*$/, ''), want); // tabel identik
    const dA = buildDecision({ markdown: auto.markdown, bias: sc.bias, neutral: sc.neutral, htf: {}, atrM5: 0 });
    const dM = buildDecision({ markdown: man.markdown, bias: sc.bias, neutral: sc.neutral, htf: {}, atrM5: 0 });
    assert.equal(dA.status, want);
    assert.equal(dM.status, want);
    assert.equal(dM.text, dA.text);
  }
});
test('18b. blok Lot Mode tidak mengubah status keputusan maupun total risiko; finalizeOrders tetap memberi label order', () => {
  const md = DEC.TRADE.sec3 + tbl(DEC.TRADE.rows, []);
  const man = run(md, { cap: 200, lotMode: MAN(0.1) });
  const d = buildDecision({ markdown: man.markdown, bias: 'BULLISH', neutral: false, htf: {}, atrM5: 0 });
  const withBlock = insertLotModeBlock(`> 🎯 **KEPUTUSAN SERVER — X:** y\n\n${man.markdown}`, buildLotModeBlock({ markdown: man.markdown, mode: 'MANUAL', manualLot: 0.1, candidates: man.candidates, maxRiskUsd: 200, balance: 10000, riskPct: 2, mult: man.mult, spec: man.spec, specOk: man.specOk }).text);
  assert.equal(buildDecision({ markdown: withBlock, bias: 'BULLISH', neutral: false, htf: {}, atrM5: 0 }).status, d.status);
  const fo = finalizeOrders(withBlock, { status: d.status, dir: 'BUY', maxRiskUsd: 200, dec: 2, candidates: man.candidates });
  assert.match(fo.markdown, /VALIDATED ORDER/);
});
test('18c. manual yang ditolak mengikuti jalur penolakan risiko yang sama dengan otomatis (bukan jalan pintas)', () => {
  // OVER RISK manual → baris "Tidak Ada Setup (Batas Risiko…)" persis seperti penolakan otomatis → keputusan dihitung dari aturan yang sama
  const md = DEC.TRADE.sec3 + tbl(DEC.TRADE.rows, []);
  const autoDrop = run(md, { cap: 5 }); // lot minimum $10 > $5
  const manDrop = run(md, { cap: 5, lotMode: MAN(0.01) });
  assert.match(autoDrop.markdown, /Tidak Ada Setup \(Batas Risiko: Tidak Dipasang\)/);
  assert.match(manDrop.markdown, /Tidak Ada Setup \(Batas Risiko: Tidak Dipasang\)/);
  const a = buildDecision({ markdown: autoDrop.markdown, bias: 'BULLISH', neutral: false, htf: {}, atrM5: 0 });
  const m = buildDecision({ markdown: manDrop.markdown, bias: 'BULLISH', neutral: false, htf: {}, atrM5: 0 });
  assert.equal(m.status, a.status); assert.equal(m.status, 'NO_TRADE');
});

// ───────────── 19. engine order lama ─────────────
test('19. engine order lama tidak berubah: tanda tangan & lot otomatis sama; manual hanya lewat lotFor.manual', () => {
  const eng = read('lib/engineOrders.js');
  assert.match(eng, /\(budget > 0 \|\| lotFor\.manual === true\)/);
  const zoneRes = { BUY: { 2: { entryLo: 3538.6, entryHi: 3553.31, sl: 3527.02, score: 3 } }, SELL: { 2: { entryLo: 3642.72, entryHi: 3646.46, sl: 3662.7, score: 2 } } };
  const analyses = [{ timeframe: 'H1', status: 'OK', atr14: 10, lastPrice: 3600, supports: [{ price: 3500 }, { price: 3450 }], resistances: [{ price: 3750 }, { price: 3800 }], zones: [] }];
  const args = { zoneRes, analyses, price: 3600, atrH1: 10, dec: 2, zones: 2, zonesOff: [], riskUsd: 40 };
  const lotFor = makeLotFor(100, specOf(), lotFloorSpec);
  const a = buildEngineOrders({ ...args, lotFor });
  const b = buildEngineOrders({ ...args, lotFor: Object.assign((...x) => lotFor(...x), {}) }); // fungsi tanpa .manual
  assert.equal(ordersSignature(a.orders), ordersSignature(b.orders));
  const m = buildEngineOrders({ ...args, lotFor: makeManualLotFor(0.03) });
  // Entry/SL/TP/zona terisi identik; hanya lot yang berbeda
  const strip = (o) => ({ ...o, lot: null, budget: null });
  assert.deepEqual(m.orders.map(strip), a.orders.map(strip));
  for (const o of m.orders.filter((x) => x.status === 'OK')) assert.equal(o.lot, 0.03);
});
test('19b. verifyRiskTables otomatis: aturan lama tetap (turun ke batas, lot minimum ditolak, batas per arah, hitung ulang risiko)', () => {
  // lot diturunkan agar risiko <= batas
  const a = run(tbl([row('Buy Limit Zona 1 (Scalping)', '3610.00', '3600.00', '3640.00', '10.00', '0.50', '$500.00')]), { cap: 30 });
  assert.deepEqual(lotsIn(a.markdown), [0.03]);
  assert.match(a.notes.join('\n'), /Lot diturunkan 0\.50 -> 0\.03 agar risiko <= \$30\.00/);
  // batas per arah: proporsional
  const b = run(goldMd(), { cap: 15 });
  assert.ok(b.totals.BUY <= 15 + 0.005);
  // lot di bawah minimum otomatis -> NO TRADE (jalur lama)
  const c = run(tbl([row('Buy Limit Zona 1 (Scalping)', '3610.00', '3600.00', '3640.00', '10.00', '0.001', '$1.00')]), { cap: 100 });
  assert.match(c.notes.join('\n'), /NO TRADE — Buy Limit Zona 1 \(Scalping\): lot 0\.00 di bawah lot minimum broker 0\.01/);
  // candidates otomatis tidak membawa kolom lotCode
  assert.ok(a.candidates.every((x) => !('lotCode' in x)));
});

// ───────────── UI Position Sizing ─────────────
test('UI: Settings punya bagian Position Sizing (Lot Mode, Manual Lot hanya saat Manual, Risk Limit memakai konfigurasi lama)', () => {
  const s = read('components/SettingsSheet.js');
  assert.match(s, /<Group title="Position Sizing"/);
  assert.match(s, /k: 'AUTOMATIC', t: 'Automatic Lot · Bawaan'/);
  assert.match(s, /k: 'MANUAL', t: 'Manual Lot'/);
  assert.match(s, /\{lotMode === 'MANUAL' && \(\s*<div className="mt-3">\s*<label className="field-label" htmlFor="s-manual-lot">Manual Lot Size/);
  assert.match(s, /Batas risiko \(dipakai kedua mode\)/);
  assert.match(s, /berlaku untuk analisis berikutnya/);
  assert.doesNotMatch(s, /s-manual-risk|manualRiskLimit/);
  assert.match(s, /'0\.01', '0\.02', '0\.05', '0\.10', '0\.20'/);
  // fokus: tetap hanya satu .focus() dan efek bergantung [open] (regresi perbaikan sebelumnya)
  assert.equal([...s.matchAll(/\.focus\(\)/g)].length, 1);
  assert.match(s, /\}, \[open\]\);/);
});
test('UI: hasil analisis menampilkan Lot Mode (header), riwayat memakai markdown tersimpan', () => {
  const page = read('app/page.js');
  assert.match(page, /parseLotMode\(result\.markdown\)/);
  assert.match(page, /Lot MANUAL/);
  assert.match(page, /Lot Otomatis/);
  assert.match(page, /markdown: it\.analysis_markdown/);
});
test('fmtLot: desimal minimal 2, tanpa pembulatan nilai', () => {
  assert.equal(fmtLot(0.1), '0.10'); assert.equal(fmtLot(1), '1.00'); assert.equal(fmtLot(0.125), '0.125'); assert.equal(fmtLot(0.001), '0.001'); assert.equal(fmtLot('x'), '-');
});
