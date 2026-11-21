import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ZoneMap.js berisi JSX; ambil bagian penggambar (sebelum komponen React) untuk diuji tanpa bundler.
const src = fs.readFileSync(new URL('../components/ZoneMap.js', import.meta.url), 'utf8');
const plain = src.split(/^export default function ZoneMap/m)[0].replace(/^'use client';\n/m, '').replace(/^import .*\n/gm, '');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zm-')), 'zm.mjs');
fs.writeFileSync(tmp, plain);
const { drawZoneMap, emaSeries } = await import(pathToFileURL(tmp).href);

test('peta zona: EMA 20, BOS asli, kotak R:R; event di luar rentang tidak digambar', () => {
const calls = [];
const ctx = new Proxy({}, { get: (t, k) => k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 40 }) : (...a) => { calls.push([k, a]); }, set: (t, k, v) => { calls.push(['set:' + k, v]); return true; } });
const canvas = { getContext: () => ctx };
const bars = Array.from({ length: 60 }, (_, i) => [1000 + i * 3600, 100 + i * 0.1, 101 + i * 0.1, 99 + i * 0.1, 100.5 + i * 0.1]);
const ema = emaSeries(bars.map((b) => b[4]));
if (Math.abs(ema[0] - bars[0][4]) > 1e-9 || !(ema[59] < bars[59][4])) throw new Error('ema');
const zones = [{ valid: true, side: 'SELL', zone: 1, low: 107, high: 108, slVal: 109, tp1Val: 104, tp2Val: 102 }];
drawZoneMap(canvas, 800, 400, 1, { zones, price: 105, dec: 2, pair: 'X', bias: 'BEARISH', filter: 'ALL', candles: bars.slice(-56), tfLabel: 'H1', ema: ema.slice(-56), events: [['BOS', 'BEARISH', 103.5, bars[30][0]], ['CHoCH', 'BULLISH', 999, bars[40][0]]] });
const txt = calls.filter((c) => c[0] === 'fillText').map((c) => c[1][0]);
if (!txt.some((t) => t === 'R:R 1:3.67')) throw new Error('rr ' + txt);
if (!txt.some((t) => t.startsWith('BOS'))) throw new Error('bos');
if (txt.some((t) => t.startsWith('CHoCH'))) throw new Error('out-of-range event drawn');
});
