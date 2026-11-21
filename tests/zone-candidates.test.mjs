import test from 'node:test';
import assert from 'node:assert/strict';
import { buildZoneCandidates } from '../lib/smc/engine.js';

const an = (tf, zones) => ({ timeframe: tf, status: 'OK', zones });
test('kandidat Z1/Z2 per sisi dan kosong bila tak ada', () => {
  const analyses = [
    an('M15', [{ type: 'BEARISH', low: 58819, high: 58922, source: 'ORDER_BLOCK' }, { type: 'BULLISH', low: 58157, high: 58466, source: 'ORDER_BLOCK' }]),
    an('H1', [{ type: 'BEARISH', low: 61201, high: 61913, source: 'ORDER_BLOCK' }, { type: 'BEARISH', low: 58850, high: 58900, source: 'FVG' }]),
  ];
  const r = buildZoneCandidates(analyses, 58667, { z1: [100, 1200], z2: [2000, 6000] }, 500);
  assert.equal(r.res.SELL.z1.low, 58819);        // klaster M15+H1 digabung, skor lebih tinggi
  assert.match(r.res.SELL.z1.src, /M15 OB/);
  assert.equal(r.res.SELL.z2.low, 61201);
  assert.equal(r.res.BUY.z1.high, 58466);
  assert.equal(r.res.BUY.z2, null);
  assert.match(r.text, /BUY Zona 2: Tidak ada level valid \(tunggu\)/);
});
