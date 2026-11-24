import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reconcileZones, auditZoneNumbers, cancelMismatched, syncNarrative, auditNarrative, ledgerOf } from '../lib/finalSync.js';
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
  assert.match(src, /import \{ reconcileZones, cancelMismatched, syncNarrative \} from '@\/lib\/finalSync'/);
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

// ======================= celah P0 #1: setup tanpa baris pasangan =======================
const dropLine = (md, re) => md.split('\n').filter((l) => !re.test(l)).join('\n');

test('P0-A: zona aktif di Bagian 3 tanpa baris 4B -> dibatalkan (tidak dilewati)', () => {
  const md = dropLine(mk(), /^\| Buy Limit Zona 2/);
  assert.ok(auditZoneNumbers(md, OPT).some((m) => m.field === 'pasangan'), 'audit harus menandai');
  const r = reconcileZones(md, OPT);
  assert.match(sec3(r.markdown), /Tidak ada level valid \(tunggu\)/);
  assert.equal(r.cancelled.length, 1);
  assert.match(r.markdown, /- Buy Limit Zona 2: tidak ada order/);
  assert.doesNotMatch(r.markdown, /197\.30/);
  assert.deepEqual(r.mismatches, []);
});

test('P0-A: order aktif di 4B tanpa baris Bagian 3 -> dibatalkan', () => {
  const md = dropLine(mk(), /^\| BUY Zona 2/);
  assert.ok(auditZoneNumbers(md, OPT).some((m) => m.field === 'pasangan'));
  const r = reconcileZones(md, OPT);
  assert.match(ord4(r.markdown), /Tidak Ada Setup \(Tunggu\)/);
  assert.match(r.markdown, /- Buy Limit Zona 2: tidak ada order/);
  assert.deepEqual(r.mismatches, []);
  assert.notEqual(buildDecision({ markdown: r.markdown, bias: 'BULLISH' }).status, 'TRADE');
});

test('P0-A: baris tidak aktif tanpa pasangan dibiarkan (tidak ada yang dibatalkan palsu)', () => {
  const md = dropLine(mk(), /^\| SELL Zona 2/);
  const r = reconcileZones(dropLine(md, /^\| Sell Limit Zona 2/), OPT);
  assert.deepEqual(r.cancelled, []);
});

// ======================= celah P0 #2: toleransi entry = 1 tick =======================
test('P0-B: entry hanya boleh di dalam zona (toleransi 1 tick, bukan 0.1xATR)', () => {
  const edgeIn = reconcileZones(mk({ e4: '3625.00' }), { dec: 2 });
  assert.deepEqual(edgeIn.cancelled, []);
  const oneTick = reconcileZones(mk({ e4: '3625.01' }), { dec: 2 });
  assert.deepEqual(oneTick.cancelled, [], '1 tick di luar masih boleh (pembulatan)');
  const far = reconcileZones(mk({ e4: '3626.50' }), { dec: 2 });
  assert.equal(far.cancelled.length, 1, '1.5 di luar zona harus dibatalkan');
  assert.match(far.cancelled[0].why, /di luar zona Bagian 3/);
  const below = reconcileZones(mk({ e4: '3614.90' }), { dec: 2 });
  assert.equal(below.cancelled.length, 1);
});

test('P0-B: opsi entryTol tidak lagi bisa memperluas zona (diabaikan)', () => {
  const r = reconcileZones(mk({ e4: '3628.00' }), { dec: 2, entryTol: 50 });
  assert.equal(r.cancelled.length, 1);
  assert.ok(auditZoneNumbers(mk({ e4: '3628.00' }), { dec: 2, entryTol: 50 }).some((m) => m.field === 'entry'));
  const src = fs.readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /entryTolSync/);
});

// ======================= sinkron teks bebas =======================
const FREE = (extra = '') => `**BIAS UTAMA:** BULLISH - FOKUS BUY
> **Ringkasan Cepat**
> - 🎯 Rencana: pasang Buy Limit Zona 2 di 3623.00, SL 3600.00, TP1 3650.00, TP2 3700.00, R:R ~1:2.5, lot 0.50, risiko $250.00
> - 📍 Level kunci: Support 3615-3625
> - ⏰ Hindari trading: tidak ada
${extra}${mk()}
**Skenario Batal (Invalidation Level):**
- Buy Zona 2: batal jika close H1 di bawah 3605.00.
- Sell Zona 2: batal jika close H1 di atas 3700.00.

**Manajemen Posisi:** Buy Zona 2: geser SL ke BE setelah TP1 3657.80 tercapai; ambil partial di 3670.00.
`;
const final = (md, opts = {}) => {
  const r = reconcileZones(md, OPT);
  return { r, n: syncNarrative(r.markdown, { dec: 2, stale: r.changes, ...opts }) };
};

test('teks bebas: Entry/SL/TP/R:R/lot/risiko di Ringkasan Cepat disamakan dengan tabel final', () => {
  const { n } = final(FREE());
  const line = n.markdown.split('\n').find((l) => /Rencana/.test(l));
  assert.match(line, /Buy Limit Zona 2 di 3625\.00/);
  assert.match(line, /SL 3605\.27/);
  assert.match(line, /TP1 3657\.80/);
  assert.match(line, /R:R ~1:1\.66/);
  assert.match(line, /lot 0\.10/);
  assert.match(line, /risiko \$197\.30/);
  assert.doesNotMatch(line, /3600\.00|3650\.00|1:2\.5|0\.50|250\.00/);
  assert.deepEqual(n.mismatches, []);
});

test('teks bebas: angka lama yang diganti server (SL 3605.00) di Skenario Batal ikut berubah', () => {
  const { n } = final(FREE());
  assert.match(n.markdown, /- Buy Zona 2: batal jika close H1 di bawah 3605\.27\./);
  assert.doesNotMatch(n.markdown, /3605\.00/);
});

test('teks bebas: zona yang tidak punya setup (Sell Zona 2) -> WAIT / NO TRADE, bukan rekomendasi aktif', () => {
  const { n } = final(FREE());
  assert.match(n.markdown, /- WAIT \/ NO TRADE — Sell Zona 2: tidak ada order/);
  assert.doesNotMatch(n.markdown, /batal jika close H1 di atas 3700/);
});

test('teks bebas: zona dibatalkan (entry di luar zona) -> semua referensi aktif jadi WAIT / NO TRADE', () => {
  const { r, n } = final(FREE(), {});
  void r;
  const cancelled = reconcileZones(FREE().replace('| 3625.00 | 3605.27 |', '| 3650.00 | 3605.27 |'), OPT);
  assert.equal(cancelled.cancelled.length, 1);
  const nn = syncNarrative(cancelled.markdown, { dec: 2, stale: cancelled.changes });
  const plan = nn.markdown.split('\n').find((l) => /Rencana/.test(l));
  assert.match(plan, /WAIT \/ NO TRADE — Buy Zona 2/);
  assert.doesNotMatch(plan, /3600\.00|3650\.00|TP1|lot 0\.50/);
  assert.match(nn.markdown, /- WAIT \/ NO TRADE — Buy Zona 2: tidak ada order/);
  const mp = nn.markdown.split('\n').find((l) => /Manajemen Posisi/.test(l));
  assert.match(mp, /WAIT \/ NO TRADE — Buy Zona 2/);
  assert.deepEqual(nn.mismatches, []);
  assert.notEqual(buildDecision({ markdown: nn.markdown, bias: 'BULLISH' }).status, 'TRADE');
});

test('teks bebas: Manajemen Posisi TP1 mengikuti tabel final; tabel, blok verifikasi server & blok kode tidak disentuh', () => {
  const extra = '> 🧮 **Verifikasi risiko otomatis** (XAUUSD) catatan:\n> - Buy Limit Zona 2: Lot diturunkan 0.50 -> 0.10, SL 3600.00\n\n```text\nBuy Zona 2 SL 3600.00 TP1 3650.00\n```\n';
  const { n } = final(FREE(extra));
  assert.match(n.markdown, /Buy Limit Zona 2: Lot diturunkan 0\.50 -> 0\.10, SL 3600\.00/); // riwayat koreksi server dipertahankan
  assert.match(n.markdown, /Buy Zona 2 SL 3600\.00 TP1 3650\.00/); // blok kode lampiran
  assert.match(n.markdown, /\| BUY Zona 2/);
  const mp = n.markdown.split('\n').find((l) => /^\*\*Manajemen Posisi/.test(l));
  assert.match(mp, /TP1 3657\.80/);
});

test('teks bebas: klausa dengan dua zona dan angka berlabel -> diganti rujukan tabel final (tidak menebak)', () => {
  const md = FREE().replace('> - 📍 Level kunci', '> - 🎯 Eksekusi: Buy Zona 2 SL 3600.00 dan Sell Zona 2 SL 3700.00\n> - 📍 Level kunci');
  const { n } = final(md);
  assert.match(n.markdown, /Eksekusi: angka final tiap zona: lihat tabel Bagian 3 dan 4B/);
  assert.deepEqual(n.mismatches, []);
});

test('teks bebas: idempoten & audit bersih; catatan "Sudah Terpasang" tidak dianggap setup mati', () => {
  const { n } = final(FREE());
  const again = syncNarrative(n.markdown, { dec: 2 });
  assert.equal(again.markdown, n.markdown);
  assert.deepEqual(auditNarrative(n.markdown, { dec: 2 }), []);
  assert.deepEqual([...ledgerOf(n.markdown, { dec: 2 }).values()].filter((x) => x.active).map((x) => `${x.side}${x.zone}`), ['BUY2']);
});

test('teks bebas: angka final tidak pernah berbeda dari tabel (fuzz 200 kasus, termasuk zona dibatalkan)', () => {
  let seed = 777;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const f2 = (v) => v.toFixed(2);
  let waits = 0, rewrites = 0;
  for (let n = 0; n < 200; n++) {
    const e = 3600 + rnd() * 50;
    const sl = e - (6 + rnd() * 30);
    const tp = e + (12 + rnd() * 70);
    const badEntry = rnd() < 0.25;
    const md = mk({
      s3: pick([f2(sl), f2(sl - 0.27)]), t3: pick([f2(tp), f2(tp + 4)]),
      e4: badEntry ? f2(e + 60) : f2(e), s4: f2(sl), tp4: f2(tp),
      jar: f2(e - sl), lot: pick(['0.10', '0.03']), risk: `$${f2(0.1 * (e - sl) * 100)}`, rr: `1:${f2((tp - e) / (e - sl))}`,
      det: `- Buy Limit Zona 2: 0.10 lot x ${f2(e - sl)} x 100 = $${f2(0.1 * (e - sl) * 100)}`,
    }).replace('3615.00 - 3625.00', `${f2(e - 8)} - ${f2(e + 2)}`);
    const free = `> - 🎯 Rencana: Buy Limit Zona 2 di ${f2(e - 1)}, SL ${f2(sl - 3)}, TP1 ${f2(tp + 9)}, R:R ~1:${f2(rnd() * 5 + 1)}, lot 0.${pick(['25', '50'])}, risiko $${f2(rnd() * 400)}\n${md}\n**Skenario Batal (Invalidation Level):**\n- Buy Zona 2: batal jika close di bawah ${f2(sl - 0.27)}\n- Sell Zona 2: batal jika close di atas ${f2(e + 80)}\n`;
    const r = reconcileZones(free, OPT);
    let out = r.mismatches.length ? cancelMismatched(r.markdown, r.mismatches).markdown : r.markdown;
    const nn = syncNarrative(out, { dec: 2, stale: r.changes });
    assert.deepEqual(nn.mismatches, [], `kasus ${n}\n${nn.markdown}`);
    assert.deepEqual(auditZoneNumbers(nn.markdown, { dec: 2 }), []);
    const led = ledgerOf(nn.markdown, { dec: 2 }).get('BUY2');
    const plan = nn.markdown.split('\n').find((l) => /Rencana/.test(l));
    if (led?.active) {
      assert.match(plan, new RegExp(`SL ${led.sl.toFixed(2)}`));
      assert.match(plan, new RegExp(`TP1 ${led.tp1.toFixed(2)}`));
      assert.match(plan, new RegExp(`R:R ~1:${led.rr.toFixed(2)}`));
      rewrites++;
    } else {
      assert.match(plan, /WAIT \/ NO TRADE/);
      assert.doesNotMatch(plan, /TP1|SL \d/);
      waits++;
    }
  }
  assert.ok(waits > 10 && rewrites > 100, `variasi: wait=${waits} aktif=${rewrites}`);
});

test('integrasi: tahap 1 -> validator risiko -> tahap 2 -> teks bebas, lot turun tetap tercermin di teks bebas', () => {
  const md = FREE().replace('Buy Limit Zona 2 di 3623.00', 'Buy Limit Zona 2 di 3623.00 (lot 0.10, risiko $197.30)');
  const p1 = reconcileZones(md, { dec: 2 });
  const c = verifyRiskTables(p1.markdown, 26, PAIRS.XAUUSD, new Date('2026-11-24T06:00:00Z'), { last: 3640, capPerDirection: true, zones: 3 });
  const p2 = reconcileZones(c.markdown, { dec: 2, mult: c.mult });
  const nn = syncNarrative(p2.markdown, { dec: 2, stale: [...p1.changes, ...p2.changes] });
  const row = ord4(nn.markdown).split('|').map((x) => x.trim());
  const lot = row[6], risk = row[7];
  const plan = nn.markdown.split('\n').find((l) => /Rencana/.test(l));
  assert.ok(Number(lot) < 0.10);
  assert.ok(plan.includes(`lot ${lot}`), plan);
  assert.ok(plan.includes(`risiko ${risk}`), plan);
  assert.deepEqual(nn.mismatches, []);
});

test('route: teks bebas disinkronkan setelah audit/pembatalan tahap 2, dengan daftar perubahan angka lama', () => {
  const src = fs.readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ reconcileZones, cancelMismatched, syncNarrative \}/);
  assert.ok(src.indexOf('cancelMismatched(md') < src.indexOf('syncNarrative(md'));
  assert.match(src, /stale: \[\.\.\.staleChanges, \.\.\.rc2\.changes\]/);
});
