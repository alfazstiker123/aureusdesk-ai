import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { orderKey, isOrderKey, planOf, estimatePnl, signedPnl, slippage, rMultiple, buildResult, sanitizeResult, computeOrderStats, parseInputNum, plausibility, ORDER_STATUS } from '../lib/orderResults.js';

// Kartu nyata dari screenshot: Sell Limit Zona 1, entry 3660.02, SL 3663.00, TP 3655.55, lot 0.01, risiko $2.98
const row = { side: 'SELL', title: 'Sell Limit Zona 1 (Scalping FVG M5) (Searah Bias)', entry: '3660.02', sl: '3663.00', tp: '3655.55', lot: '0.01', slDist: '2.98', risk: '$2.98', rr: '1:1.50' };

test('kunci order dari baris 4B', () => {
  assert.equal(orderKey(row), 'SELL-Z1');
  assert.equal(orderKey({ side: 'BUY', title: 'Buy Limit Zona 2 (Intraday)' }), 'BUY-Z2');
  assert.equal(orderKey({ side: 'BUY', title: 'Buy Limit' }), null);
  assert.ok(isOrderKey('SELL-Z1') && !isOrderKey('SELL-Z0') && !isOrderKey('X-Z1') && !isOrderKey('SELL-Z1;drop'));
});
test('Hit SL: P/L negatif, R terhadap risiko rencana, slippage positif = lebih buruk', () => {
  const plan = planOf(row);
  const r = buildResult({ status: 'SL', exit: '3663.22', pnl: '3.20', note: 'sl gap/slip' }, plan);
  assert.equal(r.pnl, -3.2);
  assert.equal(r.r, -1.07);
  assert.equal(r.slip, 0.22); // keluar 3663.22 vs SL 3663.00 pada SELL
  assert.equal(r.note, 'sl gap/slip');
});
test('P/L otomatis dari harga keluar bila tidak diisi (pengali implisit dari risiko/lot/jarak)', () => {
  const plan = planOf(row);
  assert.ok(Math.abs(estimatePnl(plan, 3663.22) - -3.2) < 0.011); // sama dengan hasil MT4 -3.20
  const r = buildResult({ status: 'SL', exit: 3663.22 }, plan);
  assert.equal(r.pnl, -3.2);
});
test('Cut Profit (BUY keluar sebelum TP) positif; slippage tidak dihitung; tanda dipaksa mengikuti status', () => {
  const buy = { side: 'BUY', title: 'Buy Limit Zona 1', entry: '3627.55', sl: '3608.34', tp: '3657.86', lot: '0.01', slDist: '19.21', risk: '$19.21' };
  const r = buildResult({ status: 'CUT_PROFIT', exit: '3655.50', pnl: '-27.95' }, planOf(buy)); // salah tanda diketik -> dikoreksi
  assert.equal(r.pnl, 27.95);
  assert.equal(r.slip, null);
  assert.equal(r.r, 1.45); // 27.95 / 19.21
  assert.equal(signedPnl('CUT_LOSS', 5), -5);
  assert.equal(signedPnl('EXPIRED', 5), 0);
});
test('Expired / Masih jalan: P/L 0, tanpa R', () => {
  const r = buildResult({ status: 'EXPIRED' }, planOf(row));
  assert.equal(r.pnl, 0);
  const s = sanitizeResult({ ...r, r: 3 });
  assert.equal(s.r, null);
});
test('server menolak status/angka/waktu tidak valid dan memotong catatan', () => {
  assert.throws(() => sanitizeResult({ status: 'WIN' }), /Status/);
  assert.throws(() => sanitizeResult({ status: 'SL', exit: 'abc' }), /Angka/);
  assert.throws(() => sanitizeResult({ status: 'SL', exit: 1, at: 'bukan-tanggal' }), /Waktu/);
  assert.equal(sanitizeResult({ status: 'SL', pnl: 2, note: 'x'.repeat(500) }).note.length, 200);
});
test('rekap per zona/arah: win rate hanya dari order tertutup, expired dihitung terpisah', () => {
  const items = [
    { order_results: { 'SELL-Z1': { status: 'SL', pnl: -3.2, r: -1.07, slip: 0.22 }, 'SELL-Z2': { status: 'TP', pnl: 6, r: 2 } } },
    { order_results: { 'BUY-Z1': { status: 'CUT_PROFIT', pnl: 27.95, r: 1.46 }, 'BUY-Z2': { status: 'EXPIRED', pnl: 0 } } },
    { order_results: { 'BUY-Z1': { status: 'RUNNING', pnl: 0 } } },
    { order_results: {} }, {},
  ];
  const s = computeOrderStats(items);
  assert.equal(s.all.n, 5);
  assert.equal(s.all.closed, 3);
  assert.equal(Math.round(s.all.winRate), 67);
  assert.equal(s.all.expired, 1);
  assert.equal(s.all.avgSlip, 0.22);
  assert.equal(s.all.pnl, 30.75);
  assert.deepEqual(s.zones.map((z) => z.name), ['Zona 1', 'Zona 2']);
  assert.equal(s.zones[0].n, 3);
});
test('integrasi: PATCH order_key terpisah dari evaluasi lama; kolom di daftar & skema; UI hanya aktif bila ada analysisId', () => {
  const r = fs.readFileSync(new URL('../app/api/history/[id]/route.js', import.meta.url), 'utf8');
  assert.match(r, /body\.order_key !== undefined/);
  assert.match(r, /update\(\{ order_results: next \}\)/);
  assert.match(r, /const outcome = String\(body\?\.outcome/); // jalur evaluasi lama tetap ada
  assert.match(fs.readFileSync(new URL('../app/api/history/route.js', import.meta.url), 'utf8'), /eval_notes, order_results'/);
  assert.match(fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'), /add column if not exists order_results jsonb/);
  const z = fs.readFileSync(new URL('../components/ZoneCards.js', import.meta.url), 'utf8');
  assert.match(z, /enabled=\{!!analysisId\}/);
  assert.match(z, /Simpan analisa ke Riwayat dulu/);
});

test('input keyboard HP Indonesia (koma desimal) dibaca benar: 3663,22 -> 3663.22 (bug: dulu 366322)', () => {
  assert.equal(parseInputNum('3663,22'), 3663.22);
  assert.equal(parseInputNum('3,2'), 3.2);
  assert.equal(parseInputNum('3.2'), 3.2);
  assert.equal(parseInputNum('3,663.22'), 3663.22);
  assert.equal(parseInputNum('3,663'), 3663);
  assert.equal(parseInputNum('$3,20'), 3.2);
  assert.ok(Number.isNaN(parseInputNum('abc')));
  const plan = planOf(row);
  const r = buildResult({ status: 'SL', exit: '3663,22', pnl: '3,2' }, plan);
  assert.equal(r.exit, 3663.22);
  assert.equal(r.pnl, -3.2);
  assert.equal(r.r, -1.07);
  assert.equal(r.slip, 0.22);
  // tanpa P/L: estimasi dari harga keluar
  assert.equal(buildResult({ status: 'SL', exit: '3663,22' }, plan).pnl, -3.2);
});
test('pengaman kewajaran: harga keluar >3% dari entry atau P/L >20x risiko diberi peringatan', () => {
  const plan = planOf(row);
  assert.match(plausibility(plan, { exit: 366322, pnl: -362661 }), /terlalu jauh/);
  assert.match(plausibility(plan, { exit: 3663.22, pnl: -100 }), /20×/);
  assert.equal(plausibility(plan, { exit: 3663.22, pnl: -3.2 }), null);
  const z = fs.readFileSync(new URL('../components/ZoneCards.js', import.meta.url), 'utf8');
  assert.match(z, /disabled=\{!status \|\| busy \|\| !!warn\}/);
});
