import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { disableZoneRows } from '../lib/smc/guard.js';
import { buildZoneCandidates3 } from '../lib/smc/engine.js';

const md = `| Zona & Strategi | Zona Entry | Stop Loss (SL) | TP1 | TP2 | Syarat |
|---|---|---|---|---|---|
| SELL Zona 1 - Scalping (FVG M5) | 3,660.00 - 3,662.00 | 3,666.00 | 3,650.00 | 3,640.00 | Dasar: M5 FVG |
| SELL Zona 2 - Intraday (OB M15) | 3,665.00 - 3,668.00 | 3,675.00 | 3,640.00 | 3,620.00 | Dasar: M15 OB |
| SELL Zona 3 - Swing (OB H1) | 3,690.00 - 3,700.00 | 3,712.00 | 3,640.00 | 3,600.00 | Dasar: H1 OB |
| BUY Zona 1 - Scalping (OB M5) | 3,600.00 - 3,602.00 | 3,596.00 | 3,615.00 | 3,625.00 | Dasar: M5 OB |

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 1 (Scalping FVG M5) | 3,660.02 | 3,663.00 | 3,655.55 | 2.98 | 0.01 | $2.98 | 1:1.50 | 24 Nov 2026, 11:00 WIB |
| Sell Limit Zona 2 (Intraday OB M5) | 3,665.11 | 3,671.80 | 3,647.97 | 6.69 | 0.01 | $6.69 | 1:2.56 | 24 Nov 2026, 14:00 WIB |
| Buy Limit Zona 1 (Scalping) | 3,600.00 | 3,596.00 | 3,610.00 | 4.00 | 0.01 | $4.00 | 1:2.5 | 24 Nov 2026, 11:00 WIB |
`;

test('Zona 1 dimatikan: baris Zona 1 BUY/SELL di Bagian 3 dan 4B dikosongkan, Zona 2/3 utuh', () => {
  const r = disableZoneRows(md, [1]);
  const lines = r.markdown.split('\n');
  const row = (re) => lines.find((l) => re.test(l));
  assert.match(row(/SELL Zona 1 - Scalping/), /Tidak ada level valid \(tunggu\)/);
  assert.match(row(/BUY Zona 1 - Scalping/), /Tidak ada level valid \(tunggu\)/);
  assert.match(row(/Sell Limit Zona 1/), /Tidak Ada Setup \(Tunggu\)/);
  assert.match(row(/Buy Limit Zona 1/), /Tidak Ada Setup \(Tunggu\)/);
  assert.doesNotMatch(r.markdown, /3,660\.0|3,655\.55|3,596\.00/);
  // Zona 2 & 3 tidak berubah
  assert.ok(r.markdown.includes('| SELL Zona 2 - Intraday (OB M15) | 3,665.00 - 3,668.00 | 3,675.00 | 3,640.00 | 3,620.00 | Dasar: M15 OB |'));
  assert.ok(r.markdown.includes('| SELL Zona 3 - Swing (OB H1) | 3,690.00 - 3,700.00 |'));
  assert.ok(r.markdown.includes('| Sell Limit Zona 2 (Intraday OB M5) | 3,665.11 | 3,671.80 | 3,647.97 |'));
  assert.equal(r.disabled.length, 4);
  assert.match(r.notes[0], /dinonaktifkan/);
});
test('tanpa zona yang dimatikan: markdown tidak berubah', () => {
  const r = disableZoneRows(md, []);
  assert.equal(r.markdown, md);
  assert.deepEqual(r.disabled, []);
});

test('kandidat 3 zona: skip Zona 1 -> kandidat Zona 1 kosong, Zona 2/3 tetap dihitung dari harga', () => {
  const an = [
    { timeframe: 'M5', status: 'OK', zones: [{ type: 'BEARISH', low: 3662, high: 3664, source: 'FVG' }] },
    { timeframe: 'M15', status: 'OK', zones: [{ type: 'BEARISH', low: 3668, high: 3672, source: 'ORDER_BLOCK' }, { type: 'BEARISH', low: 3667, high: 3671, source: 'FVG' }] },
    { timeframe: 'H1', status: 'OK', zones: [{ type: 'BEARISH', low: 3668, high: 3675, source: 'ORDER_BLOCK' }] },
  ];
  const ranges = { z1: [1, 6], z2: [6, 25], z3: [25, 80], atr: { h1: 12, m15: 4 } };
  const on = buildZoneCandidates3(an, 3660, ranges, { h1: 12, m15: 4 });
  const off = buildZoneCandidates3(an, 3660, ranges, { h1: 12, m15: 4 }, 0.15, [1]);
  assert.ok(on.res.SELL[1], 'tanpa skip, Zona 1 ada');
  assert.equal(off.res.SELL[1], null);
  assert.equal(off.res.BUY[1], null);
  assert.deepEqual(off.res.SELL[2] && Math.round(off.res.SELL[2].d), on.res.SELL[2] && Math.round(on.res.SELL[2].d));
  assert.match(off.text, /Zona 1 \(Scalping\): DINONAKTIFKAN/);
});

test('wiring: toggle hanya di mode 3 zona, dikirim ke server, prompt & validator server memakainya', () => {
  const route = fs.readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8');
  assert.match(route, /zones === 3 && body\.skipZone1 === true \? \[1\] : \[\]/);
  assert.equal((route.match(/zonesOff\.length \? ZONE1_OFF_SYSTEM/g) || []).length, 3);
  assert.match(route, /disableZoneRows\(wkFix\.markdown, zonesOff\)/);
  assert.match(route, /zonesOff \}\)/);
  const page = fs.readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
  assert.match(page, /skipZone1: zoneStyle === 'three' && skipZone1/);
  const set = fs.readFileSync(new URL('../components/SettingsSheet.js', import.meta.url), 'utf8');
  assert.match(set, /zoneStyle === 'three' && \(/);
  assert.match(set, /Zona 1 \(Scalping\): \{skipZone1/);
});

test('Zona 1 OFF: porsi risiko 45/55 dan R:R Zona 2/3 disesuaikan di prompt', () => {
  const pr = fs.readFileSync(new URL('../lib/prompt.js', import.meta.url), 'utf8');
  const blk = pr.slice(pr.indexOf('ZONA 1 (SCALPING) DINONAKTIFKAN'), pr.indexOf('AKHIR ===`;'));
  assert.match(blk, /45%.*55%/);
  assert.match(blk, /20\/35\/45.*TIDAK berlaku/);
  assert.match(blk, /Zona 2 \(Intraday\) minimal 1:1\.5.*TP2 sekitar 1:2\.5/);
  assert.match(blk, /Zona 3 \(Swing\) minimal 1:2 ke TP1.*1:3\.5/);
});

// ---- Peringatan server R:R Zona 3 (Swing) < 1:2 ----
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'rr3-'));
for (const f of ['riskCheck.js', 'pairs.js', 'marketTime.js', 'weekendExpiry.js', 'numFormat.js']) {
  if (fs.existsSync(new URL(`../lib/${f}`, import.meta.url))) fs.writeFileSync(path.join(tmpR, f), fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8').replace(/'@\/lib\/([\w]+)'/g, "'./$1.js'"));
}
const { verifyRiskTables: vrt } = await import(pathToFileURL(path.join(tmpR, 'riskCheck.js')).href);
const { PAIRS: PR } = await import(pathToFileURL(path.join(tmpR, 'pairs.js')).href);
const mkTbl = (tp2, tp3) => `| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Buy Limit Zona 2 (Intraday) | 3583.86 | 3574.28 | ${tp2} | 9.58 | 0.01 | $9.58 | 1:1 | 24 Nov 2026, 02:28 WIB |
| Buy Limit Zona 3 (Swing) | 3553.97 | 3539.96 | ${tp3} | 14.01 | 0.01 | $14.01 | 1:1 | 24 Nov 2026, 05:00 WIB |
`;
const NOWR = new Date('2026-11-23T15:00:00Z');
test('R:R Zona 3 < 1:2 diberi peringatan (mode 3 zona); Zona 2 pada R:R sama (1:1.7) tidak', () => {
  // Z2 R:R = (3600.18-3583.86)/9.58 = 1.70 ; Z3 R:R = 23.82/14.01 = 1.70
  const r = vrt(mkTbl('3600.18', '3577.79'), 100, PR.XAUUSD, NOWR, { last: 3620.99, capPerDirection: false, zones: 3 });
  assert.ok(r.notes.some((n) => /Zona 3 \(Swing\).*di bawah standar Zona 3 Swing 1:2\.0/.test(n)), r.notes.join(' | '));
  assert.ok(!r.notes.some((n) => /Zona 2 \(Intraday\).*di bawah standar/.test(n)), r.notes.join(' | '));
});
test('R:R Zona 3 >= 1:2 tidak diberi peringatan; angka tabel tidak diubah oleh aturan baru', () => {
  const r = vrt(mkTbl('3600.18', '3583.00'), 100, PR.XAUUSD, NOWR, { last: 3620.99, capPerDirection: false, zones: 3 });
  assert.ok(!r.notes.some((n) => /standar Zona 3/.test(n)), r.notes.join(' | '));
  assert.match(r.markdown, /\| Buy Limit Zona 3 \(Swing\) \| 3553\.97 \| 3539\.96 \| 3583\.00 \| 14\.01 \| 0\.01 \| \$14\.01 \|/);
});
test('mode 2 zona: peringatan khusus Zona 3 tidak berlaku', () => {
  const r = vrt(mkTbl('3600.18', '3577.79'), 100, PR.XAUUSD, NOWR, { last: 3620.99, capPerDirection: false, zones: 2 });
  assert.ok(!r.notes.some((n) => /standar Zona 3/.test(n)));
});
