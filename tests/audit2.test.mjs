import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { enforceSmcZones } from '../lib/smc/guard.js';
import { buildZoneCandidates } from '../lib/smc/engine.js';

// ---------- Poin 1: pool TF Zona 1 / Zona 2 (mode 2 zona) ----------
const R = { z1: [3, 40], z2: [20, 120] };
const call = (an, price = 3600) => buildZoneCandidates(an, price, R, 20).res;
const mk = (tf, low, high, type = 'BEARISH', source = 'ORDER_BLOCK') => ({ timeframe: tf, status: 'OK', zones: [{ type, low, high, source }] });

test('Zona 1 tidak boleh berasal dari zona H1/H4 saja', () => {
  const r = call([mk('H4', 3612, 3618)]); // H4 bobot 4 >= 3 sebelumnya lolos jadi Zona 1
  assert.equal(r.SELL.z1, null);
  const r2 = call([mk('H1', 3612, 3618)]);
  assert.equal(r2.SELL.z1, null);
});
test('Zona 1 tetap bisa dari M15 + M5 (struktur utama M5/M15), H1 boleh jadi konfluensi', () => {
  const r = call([mk('M15', 3612, 3618), mk('M5', 3613, 3617), mk('H1', 3611, 3619)]);
  assert.ok(r.SELL.z1);
  assert.match(r.SELL.z1.src, /M15|M5/);
});
test('Zona 2 hanya dari struktur utama H1/H4, bukan M15 yang kebetulan menempel H1', () => {
  // M15 jauh dari harga (jarak ~50) + mate H1 + H4 -> sebelumnya bisa jadi Zona 2 lewat tfs; kini harus pool H1/H4
  const r = call([mk('M15', 3650, 3656), mk('H1', 3651, 3657), mk('H4', 3649, 3658)]);
  assert.ok(r.SELL.z2, 'zona H1/H4 yang dikonfirmasi tetap valid sebagai Zona 2');
  assert.ok(['H1', 'H4'].includes(r.SELL.z2.src.split(' ')[0]) || /H1|H4/.test(r.SELL.z2.src));
  const only15 = call([mk('M15', 3650, 3656), mk('M5', 3651, 3655), mk('H1', 3652, 3654)]);
  // kandidat primer M15/M5/H1: hanya H1 (mate M15+M5) yang boleh Zona 2; M15 sendiri tidak
  if (only15.SELL.z2) assert.equal(only15.SELL.z2.low, 3652);
});

// ---------- Poin 2: W1/MN tidak boleh meloloskan entry ----------
const wAn = [{ timeframe: 'W1', status: 'OK', zones: [{ type: 'BEARISH', low: 3700, high: 3760, source: 'ORDER_BLOCK' }] },
  { timeframe: 'H1', status: 'OK', zones: [] }];
const wMd = `| Zona & Strategi | Zona Entry | Stop Loss (SL) | TP1 | TP2 | Syarat |
|---|---|---|---|---|---|
| SELL Zona 1 - Intraday | 3,710.00 - 3,720.00 | 3,770.00 | 3,650.00 | 3,600.00 | Dasar: W1 OB |

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 1 (Intraday) | 3,710.00 | 3,770.00 | 3,600.00 | 60.00 | 0.01 | $6.00 | 1:1.8 | 21 Nov 2026, 14:12 WIB |
`;
test('entry yang hanya overlap zona W1 dibatalkan', () => {
  const r = enforceSmcZones(wMd, { analyses: wAn, atrH1: 20, price: 3600, priceRe: /\d{1,6}(?:\.\d+)?/ });
  assert.match(r.markdown, /Tidak ada level valid \(tunggu\)/);
  assert.match(r.markdown, /Tidak Ada Setup \(Tunggu\)/);
  assert.ok(r.neutralized.length >= 1);
});
test('entry yang overlap zona MN dibatalkan; zona H4 yang sama tetap valid', () => {
  const mn = [{ timeframe: 'MN', status: 'OK', zones: [{ type: 'BEARISH', low: 3700, high: 3760, source: 'FVG' }] }];
  assert.ok(enforceSmcZones(wMd, { analyses: mn, atrH1: 20, price: 3600, priceRe: /\d{1,6}(?:\.\d+)?/ }).neutralized.length >= 1);
  const h4 = [{ timeframe: 'H4', status: 'OK', zones: [{ type: 'BEARISH', low: 3700, high: 3730, source: 'ORDER_BLOCK' }] }];
  assert.equal(enforceSmcZones(wMd, { analyses: h4, atrH1: 20, price: 3600, priceRe: /\d{1,6}(?:\.\d+)?/ }).neutralized.length, 0);
});

// ---------- Poin 3,4: prompt OHLC_ONLY & status & harga Bid ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-'));
for (const f of ['prompt.js', 'pairs.js', 'marketTime.js', 'promptLegacy.js']) {
  fs.writeFileSync(path.join(tmp, f), fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8').replace(/'@\/lib\/([\w]+)'/g, "'./$1.js'"));
}
const { OHLC_ONLY_SYSTEM } = await import(pathToFileURL(path.join(tmp, 'prompt.js')).href);
const route = fs.readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8');

test('instruksi OHLC_ONLY melarang baca screenshot/status bar/order dan dipasang di semua jalur noShot', () => {
  assert.match(OHLC_ONLY_SYSTEM, /MENGALAHKAN/);
  assert.match(OHLC_ONLY_SYSTEM, /status bar/);
  assert.match(OHLC_ONLY_SYSTEM, /DILARANG mengarang order/);
  assert.equal((route.match(/OHLC_ONLY_SYSTEM/g) || []).length, 3); // import + Gemini + gateway
  assert.match(route, /noShot \? OHLC_ONLY_SYSTEM/);
});
test('status OHLC_ONLY dipakai saat tanpa screenshot, tidak ada peringatan screenshot basi', () => {
  assert.match(route, /noShot \? 'OHLC_ONLY' : 'OHLC_HYBRID'/);
  assert.match(route, /if \(mt4Status === 'OHLC_HYBRID' && mt4PriceDeltaPct != null && mt4PriceDeltaPct > 0\.3\)/);
  assert.match(route, /if \(mt4Status === 'OHLC_HYBRID' && pairCfg && lastPx\)/); // cek mismatch screenshot hanya hybrid
});
test('harga acuan jarak zona = Bid terbaru (bukan close M5), spread & timestamp dicatat', () => {
  const src = route.slice(route.indexOf('function feedPriceInfo'), route.indexOf('function zoneCandidateData'));
  const fn = new Function(`${src}; return feedPriceInfo;`)();
  const snaps = [{ timeframe: 'M5', bid: 3625, ask: 3625.4, received_at: '2026-11-24T05:00:00Z', bars: [{ time: 1700000000, close: 3620 }] }];
  const r = fn(snaps);
  assert.equal(r.price, 3625);
  assert.equal(r.quote.closeRef, 3620);
  assert.ok(Math.abs(r.quote.spread - 0.4) < 1e-9);
  assert.equal(r.quote.atWib, '12:00:00');
  assert.match(r.line, /Bid MT4/);
  // tanpa bid (cloud) -> tetap close
  const c = fn([{ timeframe: 'M5', bars: [{ time: 1700000000, close: 3620 }] }]);
  assert.equal(c.price, 3620);
  assert.equal(c.quote, null);
});

// ---------- Poin 5: toleransi PRICE MISMATCH adaptif ----------
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'a2m-'));
fs.cpSync('lib/mt4Market.js', path.join(d, 'mt4Market.js'));
fs.cpSync('lib/marketTime.js', path.join(d, 'marketTime.js'));
const { validateMarketPayload, bidCloseTolerance } = await import(pathToFileURL(path.join(d, 'mt4Market.js')).href);
const OPEN = Date.UTC(2026, 5, 2, 10, 5);
function bars(endMs, step, close = 4000, range = 4) {
  return Array.from({ length: 40 }, (_, i) => ({ time: Math.floor(endMs / 1000) - (39 - i) * step, open: close, high: close + range / 2, low: close - range / 2, close, volume: 5 }));
}
const withNow = (ms, fn) => { const real = Date.now; Date.now = () => ms; try { return fn(); } finally { Date.now = real; } };

test('toleransi adaptif: selisih bid vs close kecil-menengah (>0.05% tapi dalam ATR) bukan data rusak', () => {
  withNow(OPEN, () => {
    // ATR ~4; toleransi >= 16. selisih 10 (0.25%) diterima. Dulu pun diterima (3%) -> bandingkan di kasus ketat di bawah.
    assert.doesNotThrow(() => validateMarketPayload({ symbol: 'XAUUSD', timeframe: 'M5', bid: 4010, ask: 4010.4, bars: bars(OPEN - 300000, 300) }));
  });
});
test('toleransi adaptif lebih ketat dari 3% tetap: selisih 2% pada ATR kecil ditolak (dulu lolos)', () => {
  withNow(OPEN, () => {
    assert.throws(() => validateMarketPayload({ symbol: 'XAUUSD', timeframe: 'M5', bid: 4080, ask: 4080.4, bars: bars(OPEN - 300000, 300) }), /PRICE MISMATCH.*toleransi adaptif/);
  });
});
test('toleransi melebar mengikuti ATR & spread, dibatasi 3%', () => {
  const calm = bidCloseTolerance({ bars: bars(OPEN, 300, 4000, 4), bid: 4000, ask: 4000.4, timeframe: 'M5', ageMs: 600000 });
  const wild = bidCloseTolerance({ bars: bars(OPEN, 300, 4000, 40), bid: 4000, ask: 4000.4, timeframe: 'M5', ageMs: 600000 });
  const wide = bidCloseTolerance({ bars: bars(OPEN, 300, 4000, 4), bid: 4000, ask: 4004, timeframe: 'M5', ageMs: 600000 });
  assert.ok(wild > calm && wide > calm);
  assert.ok(bidCloseTolerance({ bars: bars(OPEN, 300, 4000, 4000), bid: 4000, ask: 4000.4, timeframe: 'M5', ageMs: 6e8 }) <= 4000 * 0.03 + 1e-9);
});
test('EA: toleransi adaptif ATR/spread (tanpa 3% tetap)', () => {
  const ea = fs.readFileSync(new URL('../mt4/AureusDesk_MarketBridge.mq4', import.meta.url), 'utf8');
  assert.match(ea, /double BidCloseTolerance\(/);
  assert.match(ea, /MathAbs\(bid - lastClose\) > tolPx/);
  assert.doesNotMatch(ea, /MathAbs\(bid - lastClose\) \/ lastClose \* 100\.0 > MaxBidCloseDiffPct/);
  assert.doesNotMatch(ea, /\b(OrderSend|OrderClose|OrderModify|OrderDelete)\s*\(/);
});
