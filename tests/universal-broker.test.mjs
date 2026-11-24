import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-'));
for (const f of ['mt4Market.js', 'instruments.js', 'brokerSpec.js', 'pairs.js', 'marketTime.js', 'riskCheck.js', 'weekendExpiry.js', 'numFormat.js'])
  if (fs.existsSync(`lib/${f}`)) fs.writeFileSync(path.join(d, f), fs.readFileSync(`lib/${f}`, 'utf8').replace(/'@\/lib\/([\w]+)'/g, "'./$1.js'"));
const imp = (f) => import(pathToFileURL(path.join(d, f)).href);
const { normalizeSymbol } = await imp('instruments.js');
const { normalizeSpec, specMult, lotFloorSpec, specPromptBlock, stepDecimals } = await imp('brokerSpec.js');
const { validateMarketPayload, groupByConnection, pickConnection } = await imp('mt4Market.js');
const { PAIRS, riskMult, PAIR_ID_OK } = await imp('pairs.js');
const { verifyRiskTables } = await imp('riskCheck.js');

// ---- helper payload ----
const nowSec = () => Math.floor(Date.now() / 1000);
function bars(price, step = 300, n = 60, vol = 0.0005) {
  const t0 = Math.floor(nowSec() / step) * step - step;
  return Array.from({ length: n }, (_, i) => {
    const c = price * (1 + Math.sin(i / 5) * vol), o = price * (1 + Math.sin((i - 1) / 5) * vol);
    return { time: t0 - (n - 1 - i) * step, open: o, high: Math.max(o, c) * (1 + vol / 4), low: Math.min(o, c) * (1 - vol / 4), close: c };
  });
}
const payload = (symbol, price, extra = {}) => ({ symbol, timeframe: 'M5', bid: price, ask: price * 1.00005, digits: 2, bars: bars(price), ...extra });
const conn = (id, broker, server, ccy = 'USD') => ({ id, broker, server, ccy, platform: 'MT4', mask: '****1234' });
const specOf = (o = {}) => ({ lotsize: 100, tickvalue: 1, ticksize: 0.01, digits: 2, point: 0.01, minlot: 0.01, maxlot: 100, lotstep: 0.01, stoplevel: 0, freezelevel: 0, spread: 20, ...o });

test('normalisasi simbol: suffix/prefix/alias broker', () => {
  const cases = { XAUUSD: 'XAUUSD', XAUUSDm: 'XAUUSD', 'XAUUSD.pro': 'XAUUSD', GOLD: 'XAUUSD', XAUUSDz: 'XAUUSD', EURUSDc: 'EURUSD', 'FX.EURUSD': 'EURUSD',
    USDJPYm: 'USDJPY', GBPJPYm: 'GBPJPY', EURGBP: 'EURGBP', GBPAUDz: 'GBPAUD', USTEC: 'NAS100', 'NAS100.i': 'NAS100', US30: 'US30', 'US30.cash': 'US30', DJ30: 'US30', SPX500: 'US500',
    USOILm: 'USOIL', XTIUSD: 'USOIL', UKOIL: 'UKOIL', XBRUSD: 'UKOIL', BTCUSDm: 'BTCUSD', ETHUSD: 'ETHUSD', XAGUSDm: 'XAGUSD', SILVER: 'XAGUSD' };
  for (const [k, v] of Object.entries(cases)) assert.equal(normalizeSymbol(k)?.canonical, v, k);
});
test('simbol tidak dikenal DITOLAK (tidak ditebak)', () => {
  for (const k of ['FOO', 'XYZABC', 'AAPL', '', 'EURXYZ']) assert.equal(normalizeSymbol(k), null, k);
});
test('MT4_SYMBOL_MAP eksplisit diprioritaskan', () => {
  assert.equal(normalizeSymbol('GC_FUT', { map: { XAUUSD: 'GC_FUT' } })?.canonical, 'XAUUSD');
});
test('instrumen baru terdaftar di registry & dropdown', () => {
  for (const id of ['NAS100', 'US30', 'US500', 'USOIL', 'UKOIL', 'ETHUSD', 'USDCAD', 'USDCHF', 'EURGBP']) assert.ok(PAIR_ID_OK(id), id);
});

test('payload broker berbeda, simbol sama: connection_id dipisah, tidak saling tertimpa', () => {
  const a = validateMarketPayload(payload('XAUUSD', 3600, { conn: conn('aaaaaaaa1111', 'Headway', 'Headway-Real'), spec: specOf() }));
  const b = validateMarketPayload(payload('XAUUSDm', 3601, { conn: conn('bbbbbbbb2222', 'Exness', 'Exness-Real3'), spec: specOf({ tickvalue: 0.01 }) }));
  assert.notEqual(a.connection_id, b.connection_id);
  assert.equal(a.canonical_symbol, 'XAUUSD'); assert.equal(b.canonical_symbol, 'XAUUSD');
  assert.equal(b.symbol, 'XAUUSDM');
  const groups = groupByConnection([{ ...a, timeframe: 'M5' }, { ...b, timeframe: 'M5' }, { ...b, timeframe: 'H1' }]);
  assert.equal(groups.length, 2);
  // PK DB = (connection_id, symbol, timeframe): dua baris berbeda, bukan satu
  assert.ok(fs.readFileSync('supabase/migration-v3-universal-broker.sql', 'utf8').includes('primary key (connection_id, symbol, timeframe)'));
  assert.ok(fs.readFileSync('lib/mt4Market.js', 'utf8').includes('on_conflict=connection_id,symbol,timeframe'));
});
test('pemilihan koneksi: eksplisit, default terbaru, tidak mencampur, id asing ditolak', () => {
  const mk = (id, t, tf) => ({ connection_id: id, symbol: 'XAUUSD', timeframe: tf, received_at: new Date(t).toISOString(), bars: [] });
  const g = groupByConnection([mk('a', 1000, 'M5'), mk('a', 1000, 'H1'), mk('b', 2000, 'M5')]);
  assert.equal(pickConnection(g).chosen.connectionId, 'b');
  assert.equal(pickConnection(g).chosen.rows.length, 1);              // hanya baris koneksi b
  assert.equal(pickConnection(g, 'a').chosen.rows.length, 2);          // semua TF dari koneksi a saja
  assert.equal(pickConnection(g, 'zzz').chosen, null);
  assert.ok(pickConnection(g, 'zzz').missing);
});
test('payload lama tanpa conn tetap diterima (fallback legacy)', () => {
  const p = validateMarketPayload(payload('XAUUSD', 3600));
  assert.equal(p.connection_id, 'legacy'); assert.equal(p.spec, null);
});
test('payload dengan conn tapi simbol tak dikenal ditolak; harga di luar rentang ditolak', () => {
  assert.throws(() => validateMarketPayload(payload('FOOBAR', 100, { conn: conn('cccccccc3333', 'X', 'Y') })), /registry/);
  assert.throws(() => validateMarketPayload(payload('EURUSD', 3600, { conn: conn('cccccccc3333', 'X', 'Y') })), /rentang wajar/);
});
test('timestamp salah/stale ditolak', () => {
  const p = payload('XAUUSD', 3600, { conn: conn('aaaaaaaa1111', 'H', 'S') });
  p.bars = p.bars.map((b) => ({ ...b, time: b.time - 86400 * 3 }));
  assert.throws(() => validateMarketPayload(p), /kedaluwarsa|DATA TIDAK CUKUP/);
  const f = payload('XAUUSD', 3600); f.bars = f.bars.map((b) => ({ ...b, time: b.time + 7200 }));
  assert.throws(() => validateMarketPayload(f), /masa depan|kedaluwarsa/);
});
test('ask < bid ditolak', () => {
  assert.throws(() => validateMarketPayload({ ...payload('XAUUSD', 3600), ask: 3590 }), /ask < bid|Bid\/Ask/);
});

test('spesifikasi: lengkap valid; tidak lengkap/tak konsisten ditandai', () => {
  assert.ok(normalizeSpec(specOf()).valid);
  const inc = normalizeSpec({ lotsize: 100, digits: 2 });
  assert.equal(inc.valid, false); assert.ok(inc.missing.includes('tickvalue'));
  assert.equal(normalizeSpec(specOf({ minlot: 1, maxlot: 0.5 })).valid, false);
  assert.equal(normalizeSpec(specOf({ digits: 3 }), { payloadDigits: 2 }).valid, false);
  assert.equal(normalizeSpec(null).valid, false);
});
test('spec tidak lengkap -> peringatan, tidak mengklaim akurat', () => {
  assert.match(specPromptBlock(null, 'x'), /TIDAK TERSEDIA/);
  assert.match(specPromptBlock(null, 'x'), /JANGAN klaim kalkulasi lot akurat/);
});

// ---- kalkulasi lot/risiko per kontrak ----
const tbl = (name, entry, sl, tp, lot, risk) => `| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| ${name} | ${entry} | ${sl} | ${tp} | - | ${lot} | ${risk} | 1:1 | 24 Nov 2026, 02:28 WIB |
`;
const NOW = new Date('2026-11-23T15:00:00Z');
const run = (pair, md, o = {}) => verifyRiskTables(md, 100, pair, NOW, { capPerDirection: false, ...o });

test('Headway XAUUSD: tickValue/tickSize = 100 -> sama dengan profil lama', () => {
  assert.equal(specMult(specOf()), 100);
  const sp = normalizeSpec(specOf({ accountCurrency: 'USD' })).spec;
  const RM = riskMult(PAIRS.XAUUSD, 3600, { spec: sp });
  assert.equal(RM.source, 'BROKER_SPEC'); assert.equal(Math.round(RM.mult), 100);
});
test('XAUUSD kontrak berbeda (contract size 10 / tickValue 0.1): lot memakai spesifikasi, bukan 100', () => {
  const sp = normalizeSpec(specOf({ lotsize: 10, tickvalue: 0.1, accountCurrency: 'USD' })).spec; // mult 10
  const r = run(PAIRS.XAUUSD, tbl('Buy Limit Zona 1', '3600.00', '3590.00', '3620.00', '0.05', '$5.00'), { spec: sp, last: 3610 });
  // jarak 10 x mult 10 = $100 per lot -> 0.05 lot = $5.00 (profil lama akan salah 10x)
  assert.match(r.markdown, /\$5\.00/);
  assert.ok(!r.notes.some((n) => /SPESIFIKASI BROKER TIDAK TERSEDIA/.test(n)));
});
test('EURUSD 5 digit & 4 digit: mult dari tickValue/tickSize', () => {
  const s5 = normalizeSpec({ lotsize: 100000, tickvalue: 1, ticksize: 0.00001, digits: 5, point: 0.00001, minlot: 0.01, maxlot: 100, lotstep: 0.01 }).spec;
  const s4 = normalizeSpec({ lotsize: 100000, tickvalue: 10, ticksize: 0.0001, digits: 4, point: 0.0001, minlot: 0.01, maxlot: 100, lotstep: 0.01 }).spec;
  assert.equal(Math.round(specMult(s5)), 100000); assert.equal(Math.round(specMult(s4)), 100000);
});
test('USDJPY 3/2 digit & akun non-USD: JPY dikonversi lewat tickValue broker (bukan kurs perkiraan)', () => {
  const s = normalizeSpec({ lotsize: 100000, tickvalue: 0.645, ticksize: 0.001, digits: 3, point: 0.001, minlot: 0.01, maxlot: 100, lotstep: 0.01, accountCurrency: 'USD' }).spec;
  const RM = riskMult(PAIRS.USDJPY, 155, { spec: s });
  assert.equal(RM.approx, false); assert.ok(Math.abs(RM.mult - 645) < 1e-6);
  const eur = normalizeSpec({ lotsize: 100000, tickvalue: 1, ticksize: 0.00001, digits: 5, point: 0.00001, minlot: 0.01, maxlot: 100, lotstep: 0.01, accountCurrency: 'EUR' }).spec;
  const r = run(PAIRS.EURUSD, tbl('Buy Limit Zona 1', '1.10000', '1.09500', '1.11000', '0.02', '$10.00'), { spec: eur, last: 1.1 });
  assert.ok(r.notes.some((n) => /EUR/.test(n)), 'notice mata uang akun'); 
});
test('akun IDR / mata uang lain: ada pemberitahuan satuan risiko', () => {
  const idr = normalizeSpec(specOf({ accountCurrency: 'IDR' })).spec;
  const r = run(PAIRS.XAUUSD, tbl('Buy Limit Zona 1', '3600.00', '3590.00', '3620.00', '0.01', '$10.00'), { spec: idr, last: 3610 });
  assert.ok(r.notes.some((n) => /IDR/.test(n)));
});
test('lot step / min / max broker dipatuhi', () => {
  const sp = { lotstep: 0.1, minlot: 0.1, maxlot: 5 };
  assert.equal(lotFloorSpec(0.37, sp), 0.3);
  assert.equal(lotFloorSpec(0.04, sp), 0); // di bawah minimum -> 0 (bukan dinaikkan)
  assert.equal(lotFloorSpec(9, sp), 5);
  assert.equal(lotFloorSpec(0.037, { lotstep: 0.001, minlot: 0.001, maxlot: 10 }), 0.037);
  assert.equal(lotFloorSpec(0.037, null), 0.03);
});
test('spek tidak tersedia + requireSpec: peringatan eksplisit, tanpa klaim akurat', () => {
  const r = run(PAIRS.NAS100, tbl('Buy Limit Zona 1', '20000.0', '19950.0', '20100.0', '0.10', '$5.00'), { last: 20010, requireSpec: true, specWhy: 'EA tidak mengirim spesifikasi' });
  assert.ok(r.notes.some((n) => /SPESIFIKASI BROKER TIDAK TERSEDIA/.test(n) && /BUKAN akurat/.test(n)));
});
test('indeks CFD & crypto & minyak: dihitung dari spesifikasi broker', () => {
  const idx = normalizeSpec({ lotsize: 1, tickvalue: 0.1, ticksize: 0.1, digits: 1, point: 0.1, minlot: 0.1, maxlot: 50, lotstep: 0.1, accountCurrency: 'USD' }).spec; // mult 1
  assert.equal(specMult(idx), 1);
  const cry = normalizeSpec({ lotsize: 1, tickvalue: 0.01, ticksize: 0.01, digits: 2, point: 0.01, minlot: 0.01, maxlot: 10, lotstep: 0.01, accountCurrency: 'USD' }).spec;
  assert.equal(specMult(cry), 1);
  const oil = normalizeSpec({ lotsize: 1000, tickvalue: 10, ticksize: 0.01, digits: 2, point: 0.01, minlot: 0.01, maxlot: 100, lotstep: 0.01, accountCurrency: 'USD' }).spec;
  assert.equal(specMult(oil), 1000);
  assert.equal(riskMult(PAIRS.USOIL, 70, { spec: oil }).mult, 1000);
});
test('forex cross tanpa spesifikasi: ditandai perkiraan', () => {
  assert.equal(riskMult(PAIRS.EURGBP, 0.85, {}).approx, true);
  assert.equal(riskMult(PAIRS.USDCAD, 1.4, {}).approx, true);
});

test('EA v3.2: tidak ada default XAU, kirim spesifikasi & koneksi, tetap read-only', () => {
  const ea = fs.readFileSync('mt4/AureusDesk_UniversalBridge_v3.2.mq4', 'utf8');
  assert.match(ea, /RequireSymbolContains\s*=\s*""/);
  for (const k of ['MODE_LOTSIZE', 'MODE_TICKVALUE', 'MODE_TICKSIZE', 'MODE_DIGITS', 'MODE_POINT', 'MODE_MINLOT', 'MODE_MAXLOT', 'MODE_LOTSTEP', 'MODE_STOPLEVEL', 'MODE_FREEZELEVEL', 'MODE_SPREAD', 'AccountCompany', 'AccountServer', 'AccountCurrency'])
    assert.ok(ea.includes(k), k);
  assert.ok(!/\b(OrderSend|OrderClose|OrderModify|OrderDelete)\s*\(/.test(ea));
  assert.ok(!/AccountPassword|Password\s*\(/i.test(ea.replace(/\/\/.*$/gm, '')));
});

test('P0: anggaran di bawah lot minimum broker -> NO TRADE, bukan dinaikkan ke minLot', () => {
  assert.equal(lotFloorSpec(0.04, { minlot: 0.1, lotstep: 0.1, maxlot: 50 }), 0);
  const sp = normalizeSpec(specOf({ minlot: 0.1, lotstep: 0.1, accountCurrency: 'USD' })).spec;
  // jarak 10 x mult 100 = $1000/lot; anggaran $100 -> 0.1 lot pas; anggaran $40 -> 0.04 lot < min 0.1 -> batal
  const ok = verifyRiskTables(tbl('Buy Limit Zona 1', '3600.00', '3590.00', '3620.00', '0.10', '$100.00'), 100, PAIRS.XAUUSD, NOW, { capPerDirection: false, spec: sp, last: 3610 });
  assert.ok(!/Tidak Dipasang/.test(ok.markdown));
  const no = verifyRiskTables(tbl('Buy Limit Zona 1', '3600.00', '3590.00', '3620.00', '0.10', '$100.00'), 40, PAIRS.XAUUSD, NOW, { capPerDirection: false, spec: sp, last: 3610 });
  assert.match(no.markdown, /Tidak Dipasang/);
  assert.ok(no.notes.some((n) => /NO TRADE/.test(n) && /lot minimum broker/.test(n)));
  // tanpa spesifikasi: 0.01 lot pun melebihi anggaran -> batal juga
  const ns = verifyRiskTables(tbl('Buy Limit Zona 1', '3600.00', '3590.00', '3620.00', '0.01', '$10.00'), 5, PAIRS.XAUUSD, NOW, { capPerDirection: false, last: 3610 });
  assert.match(ns.markdown, /Tidak Dipasang/);
});
test('P0: satuan tick — tickSize dalam HARGA; satuan salah (points) terdeteksi, spesifikasi tidak dipakai', () => {
  // benar (MQL4): XAUUSD tickSize 0.01 (harga), point 0.01, tickValue 1 -> mult 100 = contract size 100
  assert.ok(normalizeSpec(specOf({ accountCurrency: 'USD' }), { usdQuote: true }).valid);
  // salah: tickSize dikirim 1 'point' -> mult 1 != 100 -> ditolak
  const bad = normalizeSpec(specOf({ ticksize: 1, accountCurrency: 'USD' }), { usdQuote: true });
  assert.equal(bad.valid, false); assert.ok(bad.problems.some((p) => /tidak cocok dengan contract size/.test(p)));
  // ticksize bukan kelipatan point
  assert.equal(normalizeSpec(specOf({ ticksize: 0.015 }), {}).valid, false);
  // EURUSD 5 digit & EURUSD tickValue per tick: valid
  assert.ok(normalizeSpec({ lotsize: 100000, tickvalue: 1, ticksize: 0.00001, digits: 5, point: 0.00001, minlot: 0.01, maxlot: 100, lotstep: 0.01, accountCurrency: 'USD' }, { usdQuote: true }).valid);
  // payload dengan spek salah satuan -> spec.valid=false di server
  const p = validateMarketPayload(payload('XAUUSD', 3600, { conn: conn('aaaaaaaa1111', 'H', 'S'), spec: specOf({ ticksize: 1 }) }));
  assert.equal(p.spec.valid, false);
});
test('P1: lot step pecahan 0.25 / 0.125 selalu kelipatan step', () => {
  assert.equal(stepDecimals(0.25), 2); assert.equal(stepDecimals(0.125), 3); assert.equal(stepDecimals(0.01), 2); assert.equal(stepDecimals(1), 0);
  const s25 = { minlot: 0.25, lotstep: 0.25, maxlot: 10 };
  assert.equal(lotFloorSpec(0.74, s25), 0.5);
  assert.equal(lotFloorSpec(0.75, s25), 0.75);
  assert.equal(lotFloorSpec(0.24, s25), 0);
  const s125 = { minlot: 0.125, lotstep: 0.125, maxlot: 10 };
  assert.equal(lotFloorSpec(0.37, s125), 0.25);
  assert.equal(lotFloorSpec(0.375, s125), 0.375);
  assert.equal(lotFloorSpec(50, { minlot: 0.25, lotstep: 0.25, maxlot: 5.1 }), 5);
  for (const x of [0.26, 0.5, 1.37, 2.99, 4.9]) { const v = lotFloorSpec(x, s25); assert.ok(Math.abs(v / 0.25 - Math.round(v / 0.25)) < 1e-9, String(v)); }
});

const tbl2 = (rows) => `| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | - | ${r[4]} | $1.00 | 1:1 | 24 Nov 2026, 02:28 WIB |`).join('\n')}
`;
const activeLots = (md) => md.split('\n').filter((l) => /^\|\s*(Buy|Sell)/i.test(l) && !/Tidak Ada Setup/.test(l)).map((l) => Number(l.split('|')[6]));
test('regresi audit: lot AI 0.03 < minLot 0.10 -> baris dibatalkan (NO TRADE), 0.03 tidak tampil sebagai order aktif', () => {
  const sp = normalizeSpec(specOf({ minlot: 0.1, lotstep: 0.1, accountCurrency: 'USD' })).spec;
  for (const maxRisk of [100, 0]) { // dengan dan tanpa batas risiko user
    const r = verifyRiskTables(tbl2([['Buy Limit Zona 1', '3600.00', '3599.00', '3610.00', '0.03']]), maxRisk, PAIRS.XAUUSD, NOW, { capPerDirection: true, spec: sp, last: 3601 });
    assert.match(r.markdown, /Tidak Ada Setup/);
    assert.deepEqual(activeLots(r.markdown), []);
    assert.ok(r.notes.some((n) => /NO TRADE/.test(n) && /0\.0?3/.test(n) && /minimum broker/.test(n)));
  }
  // tanpa spesifikasi (min 0.01): 0.005 juga tidak valid
  const ns = verifyRiskTables(tbl2([['Buy Limit Zona 1', '3600.00', '3599.00', '3610.00', '0.005']]), 100, PAIRS.XAUUSD, NOW, { capPerDirection: true, last: 3601 });
  assert.match(ns.markdown, /Tidak Ada Setup/);
});
test('lot valid tetap lolos; lot di atas maxLot dipotong ke maxLot (kelipatan step)', () => {
  const sp = normalizeSpec(specOf({ minlot: 0.1, lotstep: 0.1, maxlot: 5, accountCurrency: 'USD' })).spec;
  const ok = verifyRiskTables(tbl2([['Buy Limit Zona 1', '3600.00', '3599.99', '3610.00', '0.30']]), 100000, PAIRS.XAUUSD, NOW, { capPerDirection: false, spec: sp, last: 3601 });
  assert.deepEqual(activeLots(ok.markdown), [0.3]);
  const over = verifyRiskTables(tbl2([['Buy Limit Zona 1', '3600.00', '3599.99', '3610.00', '9.00']]), 100000, PAIRS.XAUUSD, NOW, { capPerDirection: false, spec: sp, last: 3601 });
  assert.deepEqual(activeLots(over.markdown), [5]);
  assert.ok(over.notes.some((n) => /disesuaikan ke 5/.test(n)));
});
test('lot step pecahan 0.25 di tabel: hasil selalu kelipatan 0.25 dan >= min', () => {
  const sp = normalizeSpec(specOf({ minlot: 0.25, lotstep: 0.25, maxlot: 10, accountCurrency: 'USD' })).spec;
  const r = verifyRiskTables(tbl2([['Buy Limit Zona 1', '3600.00', '3599.99', '3610.00', '0.74']]), 100000, PAIRS.XAUUSD, NOW, { capPerDirection: false, spec: sp, last: 3601 });
  assert.deepEqual(activeLots(r.markdown), [0.5]);
});
test('batas risiko per arah: tidak ada lot tidak valid tersisa (semua aktif >= minLot & kelipatan step)', () => {
  const sp = normalizeSpec(specOf({ minlot: 0.1, lotstep: 0.1, maxlot: 50, accountCurrency: 'USD' })).spec;
  // dua order BUY: jarak 1.0 -> $100/lot; masing-masing 0.5 lot = $50; total $100; batas $60 -> perlu dipotong per arah
  const md = tbl2([['Buy Limit Zona 1', '3600.00', '3599.00', '3610.00', '0.50'], ['Buy Limit Zona 2', '3590.00', '3589.00', '3610.00', '0.50']]);
  const r = verifyRiskTables(md, 60, PAIRS.XAUUSD, NOW, { capPerDirection: true, spec: sp, last: 3601 });
  const lots = activeLots(r.markdown);
  assert.ok(lots.length >= 1);
  for (const l of lots) { assert.ok(l >= 0.1 - 1e-9, String(l)); assert.ok(Math.abs(l / 0.1 - Math.round(l / 0.1)) < 1e-9, String(l)); }
  const total = lots.reduce((a, b) => a + b, 0) * 100; // $/lot x lot
  assert.ok(total <= 60 + 0.01 || lots.length === 1, `total ${total}`);
});

test('properti: batas risiko per arah — kombinasi acak tidak pernah lolos melebihi batas, semua lot aktif valid', () => {
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const specs = [
    normalizeSpec(specOf({ minlot: 0.01, lotstep: 0.01, maxlot: 100, accountCurrency: 'USD' })).spec,
    normalizeSpec(specOf({ minlot: 0.1, lotstep: 0.1, maxlot: 5, accountCurrency: 'USD' })).spec,
    normalizeSpec(specOf({ minlot: 0.25, lotstep: 0.25, maxlot: 10, accountCurrency: 'USD' })).spec,
    normalizeSpec(specOf({ minlot: 0.125, lotstep: 0.125, maxlot: 10, accountCurrency: 'USD' })).spec,
  ];
  let checked = 0;
  for (let n = 0; n < 400; n++) {
    const sp = specs[n % specs.length];
    const side = rnd() < 0.5 ? 'Buy' : 'Sell';
    const rows = [1, 2, 3].slice(0, 1 + Math.floor(rnd() * 3)).map((z) => {
      const dist = +(0.5 + rnd() * 30).toFixed(2), entry = 3600 + z * 5;
      const sl = side === 'Buy' ? entry - dist : entry + dist, tp = side === 'Buy' ? entry + dist * 2 : entry - dist * 2;
      return [`${side} Limit Zona ${z}`, entry.toFixed(2), sl.toFixed(2), tp.toFixed(2), (sp.minlot * (1 + Math.floor(rnd() * 12))).toFixed(3)];
    });
    const maxRisk = +(10 + rnd() * 3000).toFixed(2);
    const r = verifyRiskTables(tbl2(rows), maxRisk, PAIRS.XAUUSD, NOW, { capPerDirection: true, zones: 3, spec: sp, last: 3601 });
    let total = 0;
    for (const l of r.markdown.split('\n').filter((x) => /^\|\s*(Buy|Sell)/i.test(x) && !/Tidak Ada Setup/.test(x))) {
      const c = l.split('|').map((x) => x.trim());
      const lot = Number(c[6]), dist = Math.abs(Number(c[2]) - Number(c[3]));
      assert.ok(lot >= sp.minlot - 1e-9 && lot <= sp.maxlot + 1e-9, `lot ${lot} di luar min/max`);
      assert.ok(Math.abs(lot / sp.lotstep - Math.round(lot / sp.lotstep)) < 1e-6, `lot ${lot} bukan kelipatan step ${sp.lotstep}`);
      total += lot * dist * 100; checked++;
    }
    assert.ok(total <= maxRisk + 0.02, `total risiko ${total.toFixed(2)} > batas ${maxRisk} (iterasi ${n})`);
  }
  assert.ok(checked > 100, 'cukup banyak order aktif teruji');
});
