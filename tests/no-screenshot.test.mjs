import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-'));
for (const f of ['prompt.js', 'pairs.js', 'marketTime.js', 'promptLegacy.js']) {
  fs.writeFileSync(path.join(tmp, f), fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8').replace(/'@\/lib\/([\w]+)'/g, "'./$1.js'"));
}
const { buildUserPrompt } = await import(pathToFileURL(path.join(tmp, 'prompt.js')).href);
const { PAIRS } = await import(pathToFileURL(path.join(tmp, 'pairs.js')).href);

test('prompt tanpa screenshot memuat catatan mode OHLC saja', () => {
  const t = buildUserPrompt({ balance: 1000, risk: 2, session: '', labels: [], pair: PAIRS.XAUUSD, fundamental: '', strict: true });
  assert.match(t, /MODE TANPA SCREENSHOT/);
  assert.match(t, /tidak ada; mode OHLC MT4 saja/);
});
test('prompt dengan screenshot tidak berubah', () => {
  const t = buildUserPrompt({ balance: 1000, risk: 2, session: '', labels: ['H1'], pair: PAIRS.XAUUSD, fundamental: '', strict: true });
  assert.doesNotMatch(t, /MODE TANPA SCREENSHOT/);
  assert.match(t, /Gambar 1: H1/);
});
test('route: tanpa gambar hanya lolos untuk mt4 + pair tetap', () => {
  const src = fs.readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8');
  assert.match(src, /marketSource === 'mt4' && !!fixedPair/);
  assert.match(src, /noShot && !\(marketInitial\.snapshots\?\.length\)/);
});
