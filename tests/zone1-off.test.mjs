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
