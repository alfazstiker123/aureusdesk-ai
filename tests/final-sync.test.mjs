import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reconcileZones, auditZoneNumbers, cancelMismatched } from '../lib/finalSync.js';
import { enforceSmcZones } from '../lib/smc/guard.js';
import { buildDecision } from '../lib/decision.js';

const MULT = 100; // XAUUSD: lot x jarak x 100

// Kasus audit: Bagian 3 SL 3605.00 / R:R ~1:2.0, tetapi 4B SL 3605.27 / R:R 1:1.66
const mk = ({ s3 = '3605.00', t3 = '3657.80', t2 = '3690.00', conf = 'Bullish engulfing M15. R:R ~1:2.0', e4 = '3625.00', s4 = '3605.27', tp4 = '3657.80', jar = '19.73', lot = '0.10', risk = '$197.30', rr = '1:1.66', det = '- Buy Limit Zona 2: 0.10 lot x 19.73 x 100 = $197.30' } = {}) => `
| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 2 - Intraday (Demand H1-H4) (Searah Bias) | 3615.00 - 3625.00 | ${s3} | ${t3} | ${t2} | ${conf} |
| SELL Zona 2 - Intraday (Supply M15-H1) | Tidak ada level valid (tunggu) | - | - | - | - |

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Buy Limit Zona 2 (Intraday Support) | ${e4} | ${s4} | ${tp4} | ${jar} | ${lot} | ${risk} | ${rr} | 24 Nov 2026, 22.40 WIB |
| Sell Limit Zona 2 (Intraday Resistance) | Tidak Ada Setup (Tunggu) | - | - | - | - | - | - | - |

**Rincian Hitung Risiko**
${det}
- Sell Limit Zona 2: tidak ada order
`;
const OPT = { dec: 2, mult: MULT, entryTol: 1.5 };
const sec3 = (md) => md.split('\n').find((l) => /^\| BUY Zona 2/.test(l));
const ord4 = (md) => md.split('\n').find((l) => /^\| Buy Limit Zona 2/.test(l));

test('kasus audit: SL Bagian 3 (3605.00) disamakan dengan SL final 4B (3605.27)', () => {
  const before = mk();
  assert.ok(auditZoneNumbers(before, OPT).some((m) => m.field === 'sl'), 'audit harus menemukan selisih SL');
  const r = reconcileZones(before, OPT);
  assert.match(sec3(r.markdown), /\| 3605\.27 \|/);
  assert.doesNotMatch(sec3(r.markdown), /3605\.00/);
  assert.deepEqual(r.mismatches, []);
  assert.ok(r.notes.some((n) => /SL Bagian 3 \(3605\.00\) disamakan/.test(n)));
});

test('R:R teks Bagian 3 (~1:2.0) mengikuti R:R final 4B (1:1.66)', () => {
  const r = reconcileZones(mk(), OPT);
  assert.match(sec3(r.markdown), /R:R ~1:1\.66/);
  assert.doesNotMatch(sec3(r.markdown), /1:2\.0/);
  assert.match(ord4(r.markdown), /\| 1:1\.66 \|/);
});

test('TP1 Bagian 3 berbeda dari TP 4B -> Bagian 3 mengikuti 4B', () => {
  const r = reconcileZones(mk({ t3: '3670.00' }), OPT);
  assert.match(sec3(r.markdown), /\| 3657\.80 \|/);
  assert.deepEqual(r.mismatches, []);
});

test('Jarak SL, R:R, dan Risiko 4B yang salah dihitung ulang server', () => {
  const r = reconcileZones(mk({ jar: '15.00', rr: '1:3.00', risk: '$50.00' }), OPT);
  const row = ord4(r.markdown);
  assert.match(row, /\| 19\.73 \|/);
  assert.match(row, /\| 1:1\.66 \|/);
  assert.match(row, /\| \$197\.30 \|/);
  assert.deepEqual(r.mismatches, []);
});

test('Rincian Hitung Risiko yang basi mengikuti tabel 4B (lot, jarak, risiko)', () => {
  const r = reconcileZones(mk({ det: '- Buy Limit Zona 2: 0.20 lot x 18.00 x 100 = $360.00' }), OPT);
  assert.match(r.markdown, /- Buy Limit Zona 2: 0\.10 lot x 19\.73 x 100 = \$197\.30/);
  assert.doesNotMatch(r.markdown, /360\.00/);
});

test('entry 4B di luar zona Bagian 3 -> kedua baris dibatalkan (WAIT / NO TRADE) dan rincian risiko ikut', () => {
  const r = reconcileZones(mk({ e4: '3650.00' }), OPT);
  assert.match(sec3(r.markdown), /Tidak ada level valid \(tunggu\)/);
  assert.match(ord4(r.markdown), /Tidak Ada Setup \(Tunggu\)/);
  assert.match(r.markdown, /- Buy Limit Zona 2: tidak ada order/);
  assert.equal(r.cancelled.length, 1);
  assert.deepEqual(r.mismatches, []);
  const d = buildDecision({ markdown: r.markdown, bias: 'BULLISH' });
  assert.notEqual(d.status, 'TRADE');
});

test('hanya satu tabel yang memuat setup -> dibatalkan di keduanya', () => {
  const a = reconcileZones(mk({ e4: 'Tidak Ada Setup (Batas Risiko: Tidak Dipasang)', s4: '-', tp4: '-', jar: '-', lot: '-', risk: '-', rr: '-' }), OPT);
  assert.match(sec3(a.markdown), /Tidak ada level valid \(tunggu\)/);
  const b = mk().replace('| 3615.00 - 3625.00 | 3605.00 | 3657.80 | 3690.00 | Bullish engulfing M15. R:R ~1:2.0 |', '| Tidak ada level valid (tunggu) | - | - | - | - |');
  const rb = reconcileZones(b, OPT);
  assert.match(ord4(rb.markdown), /Tidak Ada Setup \(Tunggu\)/);
  assert.deepEqual(rb.mismatches, []);
});

test('data 4B tidak lengkap (TP hilang) atau arah SL/TP salah -> setup dibatalkan, bukan dikarang', () => {
  const noTp = reconcileZones(mk({ tp4: '-' }), OPT);
  assert.equal(noTp.cancelled.length, 1);
  const wrong = reconcileZones(mk({ s4: '3640.00' }), OPT); // SL di atas entry BUY
  assert.equal(wrong.cancelled.length, 1);
  assert.match(sec3(wrong.markdown), /Tidak ada level valid/);
});

test('TP2 yang tidak lebih jauh dari TP1 dikosongkan, bukan dibiarkan beda', () => {
  const r = reconcileZones(mk({ t2: '3640.00' }), OPT);
  assert.match(sec3(r.markdown), /\| - \|/);
  assert.deepEqual(r.mismatches, []);
});

test('input yang sudah konsisten tidak berubah (idempoten, tanpa catatan)', () => {
  const ok = mk({ s3: '3605.27', conf: 'Bullish engulfing M15. R:R ~1:1.66' });
  assert.deepEqual(auditZoneNumbers(ok, OPT), []);
  const r = reconcileZones(ok, OPT);
  assert.equal(r.markdown, ok);
  assert.deepEqual(r.notes, []);
  const r2 = reconcileZones(r.markdown, OPT);
  assert.equal(r2.markdown, r.markdown);
});

test('zona SELL: SL/TP arah kebalikan juga disinkronkan', () => {
  const md = `
| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| SELL Zona 3 - Swing (Supply H4) | 3700.00 - 3710.00 | 3725.00 | 3640.00 | 3600.00 | R:R 1:3.0 |

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 3 (Swing Supply) | 3700.00 | 3724.50 | 3640.00 | 24.50 | 0.05 | $122.50 | 1:2.45 | - |
`;
  const r = reconcileZones(md, OPT);
  assert.match(r.markdown, /\| 3724\.50 \|/);
  assert.match(r.markdown, /R:R 1:2\.45/);
  assert.deepEqual(r.mismatches, []);
});

test('fuzz: 300 kombinasi angka acak -> setelah sinkron + audit akhir TIDAK ada selisih antarbagian', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const f2 = (n) => n.toFixed(2);
  let cancelledN = 0, syncedN = 0;
  for (let n = 0; n < 300; n++) {
    const e = 3600 + rnd() * 60;
    const sl = e - (5 + rnd() * 40);
    const tp = e + (10 + rnd() * 80);
    const lot = pick(['0.01', '0.05', '0.10', '0.37']);
    const md = mk({
      s3: pick([f2(sl), f2(sl - rnd() * 0.5), f2(sl + 1 + rnd() * 3), '-']),
      t3: pick([f2(tp), f2(tp + rnd() * 9), '-']),
      t2: pick([f2(tp + 30), f2(tp - 5), '-']),
      conf: pick(['R:R ~1:2.0', 'R:R 1:3.5, engulfing', 'konfirmasi CHoCH', 'R:R TP1 ~1:1.5']),
      e4: pick([f2(e), f2(e), f2(e + 80), 'Tidak Ada Setup (Tunggu)']),
      s4: pick([f2(sl), f2(sl), f2(e + 10)]),
      tp4: pick([f2(tp), f2(tp), '-']),
      jar: pick([f2(e - sl), f2(rnd() * 50)]),
      lot,
      risk: pick([`$${f2(Number(lot) * (e - sl) * MULT)}`, `$${f2(rnd() * 500)}`]),
      rr: pick([`1:${f2((tp - e) / (e - sl))}`, `1:${f2(rnd() * 5)}`]),
      det: pick([`- Buy Limit Zona 2: ${lot} lot x ${f2(e - sl)} x 100 = $${f2(Number(lot) * (e - sl) * MULT)}`, '- Buy Limit Zona 2: 9.99 lot x 1.00 x 100 = $999.00']),
    }).replace('3615.00 - 3625.00', `${f2(e - 8)} - ${f2(e + 2)}`);
    const r = reconcileZones(md, { ...OPT, entryTol: 1.5 });
    let out = r.markdown;
    let mism = r.mismatches;
    if (mism.length) { out = cancelMismatched(out, mism).markdown; }
    assert.deepEqual(auditZoneNumbers(out, { ...OPT, entryTol: 1.5 }), [], `kasus ${n}\n${md}\n=>\n${out}`);
    if (r.cancelled.length) cancelledN++; else if (r.notes.length) syncedN++;
  }
  assert.ok(cancelledN > 20 && syncedN > 20, `variasi kurang: batal=${cancelledN} sinkron=${syncedN}`);
});

test('enforceSmcZones: SL beda 0.27 tetap disamakan walau ATR besar (akar masalah toleransi 0.02xATR)', () => {
  const analyses = [{ status: 'OK', timeframe: 'H1', atr14: 15, zones: [{ type: 'BULLISH', low: 3612, high: 3626, source: 'OB' }] }];
  const r = enforceSmcZones(mk({ s3: '3605.00' }), { analyses, atrH1: 15, price: 3640, priceRe: /\d+(?:\.\d+)?/ });
  assert.match(sec3(r.markdown), /3605\.27/);
});

test('route memakai sinkron final: tahap 1 sebelum validator risiko, tahap 2 dengan pengali final + audit + pembatalan', () => {
  const src = fs.readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ reconcileZones, cancelMismatched \} from '@\/lib\/finalSync'/);
  const i1 = src.indexOf('reconcileZones(txt');
  const iRisk = src.indexOf('verifyRiskTables(txt');
  const i2 = src.indexOf('reconcileZones(md');
  assert.ok(i1 > 0 && i1 < iRisk && iRisk < i2, 'urutan: reconcile(txt) -> verifyRiskTables -> reconcile(md)');
  assert.match(src, /mult: c\.mult/);
  assert.match(src, /cancelMismatched\(md, rc2\.mismatches\)/);
  const rc = fs.readFileSync(new URL('../lib/riskCheck.js', import.meta.url), 'utf8');
  assert.match(rc, /totals, mult: MULT/);
});

// ---- integrasi: urutan persis seperti route (tahap 1 -> verifyRiskTables -> tahap 2) ----
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const tmpRc = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-'));
for (const f of ['riskCheck.js', 'brokerSpec.js', 'pairs.js', 'marketTime.js']) {
  fs.writeFileSync(path.join(tmpRc, f), fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8').replace(/'@\/lib\/([\w]+)'/g, "'./$1.js'"));
}
const { verifyRiskTables } = await import(pathToFileURL(path.join(tmpRc, 'riskCheck.js')).href);
const { PAIRS } = await import(pathToFileURL(path.join(tmpRc, 'pairs.js')).href);

function pipeline(md, riskUsd = 26) {
  const p1 = reconcileZones(md, { dec: 2, entryTol: 1.5 });
  const c = verifyRiskTables(p1.markdown, riskUsd, PAIRS.XAUUSD, new Date('2026-11-24T06:00:00Z'), { last: 3640, capPerDirection: true, zones: 3 });
  const p2 = reconcileZones(c.markdown, { dec: 2, mult: c.mult, entryTol: 1.5 });
  const out = p2.mismatches.length ? cancelMismatched(p2.markdown, p2.mismatches).markdown : p2.markdown;
  return { out, c, p1, p2 };
}

test('integrasi: lot diturunkan validator -> risiko, rincian, R:R, SL Bagian 3 semua konsisten dengan angka final', () => {
  const { out, p2 } = pipeline(mk({ s4: '3605.27', jar: '19.73', lot: '0.10', risk: '$197.30' }));
  assert.deepEqual(auditZoneNumbers(out, { dec: 2, mult: 100, entryTol: 1.5 }), []);
  assert.deepEqual(p2.mismatches, []);
  const row = ord4(out).split('|').map((x) => x.trim());
  const lot = Number(row[6]); const jar = Number(row[5]); const risk = Number(row[7].replace('$', ''));
  assert.ok(lot > 0 && lot < 0.10, `lot harus diturunkan ke batas $26: ${lot}`);
  assert.ok(Math.abs(risk - lot * jar * 100) < 0.011);
  assert.ok(risk <= 26.005);
  assert.match(sec3(out), /\| 3605\.27 \|/);
  assert.match(out, new RegExp(`- Buy Limit Zona 2: ${row[6]} lot x 19\\.73 x 100 = \\$${risk.toFixed(2)}`));
});

test('integrasi: anggaran < lot minimum -> NO TRADE di 4B DAN Bagian 3 (tidak ada zona "hidup" tanpa order)', () => {
  const { out } = pipeline(mk(), 1); // batas $1: 0.01 lot x 19.73 x 100 = $19.73
  assert.match(ord4(out), /Tidak Ada Setup/);
  assert.match(sec3(out), /Tidak ada level valid/);
  assert.deepEqual(auditZoneNumbers(out, { dec: 2, mult: 100, entryTol: 1.5 }), []);
});
