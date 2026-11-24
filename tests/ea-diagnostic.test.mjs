import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ea = fs.readFileSync(new URL('../mt4/AureusDesk_UniversalBridge_v3.2.mq4', import.meta.url), 'utf8');
const strip = ea.replace(/\/\/.*$/gm, ''); // tanpa komentar

test('EA: log diagnostik SHIFT 0 dan SHIFT 1 memuat symbol, TF, shift, timestamp, OHLC', () => {
  assert.match(ea, /input bool\s+DiagnosticLog\s*=\s*true/);
  const log = ea.slice(ea.indexOf('void LogShift'), ea.indexOf('string BarFragment'));
  for (const k of ['g_sym', 'g_names[i]', 'shift', 'TimeToString(t,', 'O=', 'H=', 'L=', 'C=']) assert.ok(log.includes(k), k);
  assert.match(ea, /LogShift\(i, 0, t0, o0, h0, l0, c0/);
  assert.match(ea, /LogShift\(i, 1, t1, o1, h1, l1, c1/);
});
test('EA: shift0/1 dibaca via iTime/iOpen/iHigh/iLow/iClose (independen dari CopyRates) dan dicocokkan', () => {
  for (const f of ['iTime(g_sym, per, 0)', 'iTime(g_sym, per, 1)', 'iOpen(g_sym, per, 1)', 'iHigh(g_sym, per, 1)', 'iLow(g_sym, per, 1)', 'iClose(g_sym, per, 1)']) assert.ok(ea.includes(f), f);
  assert.match(ea, /CopyRates\(g_sym, g_periods\[i\], 1, want, rates\)/); // payload mulai shift 1
  assert.match(ea, /r\[n - 1\]\.time != t1/);
  assert.match(ea, /r\[n - 1\]\.time >= t0/); // candle berjalan tidak boleh ikut terkirim
});
test('EA: tiga status DATA_VALID / DATA_STALE / DATA_MISMATCH dan data tidak valid tidak dikirim', () => {
  for (const s of ['DATA_VALID', 'DATA_STALE', 'DATA_MISMATCH']) assert.match(ea, new RegExp(`#define ${s}\\s+"${s}"`));
  assert.match(ea, /if\(verdict != DATA_VALID\)[\s\S]{0,200}return false;/);
  assert.match(ea, /if\(pErr != ""\)[\s\S]{0,250}return false;/);
  assert.ok(ea.indexOf('DiagCheck(i, rates') < ea.indexOf('WebRequest('));
  assert.ok(ea.indexOf('PayloadCheck(i, payload') < ea.indexOf('WebRequest('));
});
test('EA: batas umur sama dengan server (M5 20, M15 45, H1 180, H4 600, D1 7200, W1 21600 menit)', async () => {
  const body = ea.slice(ea.indexOf('int MaxAgeMinutes'), ea.indexOf('void LogShift'));
  const got = [...body.matchAll(/return (\d+);/g)].map((m) => Number(m[1]));
  assert.deepEqual(got, [20, 45, 180, 600, 7200, 21600]);
  const srv = fs.readFileSync(new URL('../lib/mt4Market.js', import.meta.url), 'utf8');
  assert.match(srv, /\{ M5: 20, M15: 45, H1: 180, H4: 600, D1: 7200, W1: 21600 \}/);
});
test('EA: D1/W1 tidak membandingkan close antar-TF; hanya timestamp & OHLC candle sendiri', () => {
  const fn = ea.slice(ea.indexOf('string DiagCheck'), ea.indexOf('string PayloadCheck'));
  assert.doesNotMatch(fn, /g_periods\[(?!i\])/); // hanya TF yang sedang diperiksa
  assert.doesNotMatch(strip.slice(strip.indexOf('string DiagCheck'), strip.indexOf('string PayloadCheck')), /Bid|MODE_BID|lastClose/);
});
test('EA: payload memuat candle shift1 persis & tanpa shift0; tetap tanpa fungsi trading', () => {
  assert.match(ea, /string PayloadCheck/);
  assert.match(ea, /payload memuat candle berjalan \(shift0\)/);
  assert.doesNotMatch(strip, /\b(OrderSend|OrderClose|OrderModify|OrderDelete)\s*\(/);
});

// Backend menerima format payload EA untuk D1/W1 (close sama antar candle bukan error) dan menolak candle yang timestamp-nya duplikat
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'eadiag-'));
fs.cpSync('lib/mt4Market.js', path.join(d, 'mt4Market.js'));
fs.cpSync('lib/instruments.js', path.join(d, 'instruments.js'));
fs.cpSync('lib/brokerSpec.js', path.join(d, 'brokerSpec.js'));
fs.cpSync('lib/pairs.js', path.join(d, 'pairs.js'));
fs.cpSync('lib/marketTime.js', path.join(d, 'marketTime.js'));
fs.cpSync('lib/marketTime.js', path.join(d, 'marketTime.js'));
const { validateMarketPayload } = await import(pathToFileURL(path.join(d, 'mt4Market.js')).href);
const NOW = Date.UTC(2026, 5, 3, 10, 30); // Rabu, pasar buka
const withNow = (fn) => { const r = Date.now; Date.now = () => NOW; try { return fn(); } finally { Date.now = r; } };
const series = (stepSec, lastOpenMs, same) => Array.from({ length: 40 }, (_, i) => {
  const c = same ? 4000 : 4000 + i; // same = semua close sama
  return { time: Math.floor(lastOpenMs / 1000) - (39 - i) * stepSec, open: c, high: c + 5, low: c - 5, close: c, volume: 9 };
});
test('backend: D1 & W1 dengan close identik antar candle diterima (bukan error); timestamp & OHLC dipertahankan persis', () => {
  withNow(() => {
    const dayOpen = Date.UTC(2026, 5, 2, 0, 0), weekOpen = Date.UTC(2026, 4, 25, 0, 0);
    const d1 = validateMarketPayload({ symbol: 'XAUUSD', timeframe: 'D1', bid: 4000, ask: 4000.3, digits: 2, bars: series(86400, dayOpen, true) });
    const w1 = validateMarketPayload({ symbol: 'XAUUSD', timeframe: 'W1', bid: 4000, ask: 4000.3, digits: 2, bars: series(604800, weekOpen, true) });
    assert.equal(d1.bars.at(-1).time, dayOpen / 1000);
    assert.equal(w1.bars.at(-1).time, weekOpen / 1000);
    assert.equal(d1.bars.at(-1).high, 4005);
    assert.equal(w1.bars.at(-1).low, 3995);
    assert.notDeepEqual(d1.bars.at(-1).time, w1.bars.at(-1).time);
  });
});
test('backend: candle D1 kedaluwarsa (DATA_STALE di EA) juga ditolak server; timestamp duplikat ditolak', () => {
  withNow(() => {
    assert.throws(() => validateMarketPayload({ symbol: 'XAUUSD', timeframe: 'D1', bars: series(86400, NOW - 9 * 86400e3, false) }), /DATA TIDAK CUKUP/);
    const dup = series(300, NOW - 600e3, false); dup[10].time = dup[9].time;
    assert.throws(() => validateMarketPayload({ symbol: 'XAUUSD', timeframe: 'M5', bars: dup }), /duplikat/);
  });
});
