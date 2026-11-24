import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecision, insertDecision } from '../lib/decision.js';
import { isNeutralHeadline, resolveBias } from '../lib/consistency.js';

// Kasus nyata audit (XAUUSD 24 Nov 13:25 WIB): judul NETRAL memuat kata BULLISH & BEARISH; BUY Z3 R:R 1:1.90; BUY Z2 & Z3 tumpang tindih.
const EXEC = `| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 2 - Intraday (Demand H1-H4) | 3538.42 - 3553.31 | 3526.98 | 3592.80 | 3615.00 | x |
| BUY Zona 3 - Swing (Demand H1-H4) | 3529.96 - 3543.56 | 3526.98 | 3575.00 | 3605.00 | x |
| SELL Zona 2 - Intraday (Supply M15-H1) | 3642.72 - 3646.46 | 3662.74 | 3610.00 | 3585.00 | x |
`;
const pend = (b2, b3, s2) => `| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Buy Limit Zona 2 (Intraday Demand) | ${b2} | 3526.98 | 3592.80 | 26.33 | 0.01 | $26.33 | 1:2.5 | x |
| Buy Limit Zona 3 (Swing Demand) | ${b3} | 3526.98 | 3575.00 | 16.58 | 0.01 | $16.58 | 1:1.90 | x |
| Sell Limit Zona 2 (Intraday Resistance) | ${s2} | 3662.74 | 3610.00 | 20.02 | 0.01 | $20.02 | 1:1.63 | x |
`;
const NA = 'Tidak Ada Setup (Batas Risiko: Tidak Dipasang)';
const MD = (b2, b3, s2) => `**BIAS UTAMA:** NETRAL - WAIT & SEE (H1/H4 BULLISH KONSEKUTIF, M5/M15 BEARISH KOREKTIF)\n\n${EXEC}\n${pend(b2, b3, s2)}`;
const ZR = { BUY: { 2: { score: 5 }, 3: { score: 6.6 } }, SELL: { 2: { score: 7 } } };
const HTF = { D1: 'BEARISH', W1: 'BEARISH' };

test('judul NETRAL yang memuat kata BULLISH/BEARISH dikenali sebagai netral', () => {
  const h = 'NETRAL - WAIT & SEE (H1/H4 BULLISH KONSEKUTIF, M5/M15 BEARISH KOREKTIF)';
  assert.equal(isNeutralHeadline(h), true);
  assert.equal(isNeutralHeadline('BULLISH - FOKUS BUY'), false);
  assert.equal(isNeutralHeadline('NO TRADE'), true);
  // akar masalah lama: kedua kata -> judul tanpa arah -> bias mesin dipakai
  assert.equal(resolveBias(h, 'BULLISH').bias, 'BULLISH');
});
test('regresi audit: bias NETRAL tidak menghasilkan "SETUP UTAMA BUY"; kandidat tetap tampil dengan status jelas', () => {
  const d = buildDecision({ markdown: MD(NA, '3543.56', '3642.72'), bias: 'BULLISH', neutral: true, zoneRes: ZR, alignment: false, htf: HTF });
  assert.equal(d.status, 'WAIT');
  assert.equal(d.primary, null);
  assert.ok(!/SETUP UTAMA/.test(d.text));
  assert.match(d.text, /WAIT & SEE — BELUM ADA SETUP AKTIF/);
  assert.match(d.text, /KANDIDAT zona, bukan rekomendasi eksekusi/);
  assert.match(d.text, /Kandidat searah struktur H4\/H1 \(BULLISH\): BUY Zona 3/);
  assert.match(d.text, /SELL Zona 2/);
  assert.match(d.text, /M15 belum selaras/);
  assert.match(d.text, /MELAWAN D1 & W1/);
});
test('tanpa judul netral, bias BULLISH tetap menghasilkan setup utama (perilaku lama tidak berubah)', () => {
  const d = buildDecision({ markdown: MD(NA, '3543.56', '3642.72').replace(/1:1\.90/, '1:2.40'), bias: 'BULLISH', neutral: false, zoneRes: ZR, alignment: true, htf: {} });
  assert.equal(d.status, 'TRADE');
  assert.equal(d.primary.zone, 3);
});
test('R:R di bawah standar Zona 3 (1:1.90 < 1:2.0) tidak boleh jadi setup utama', () => {
  const d = buildDecision({ markdown: MD(NA, '3543.56', NA), bias: 'BULLISH', neutral: false, zoneRes: ZR, alignment: true, htf: {} });
  assert.notEqual(d.status, 'TRADE');
  assert.equal(d.primary, null);
  assert.match(d.text, /belum memenuhi R:R standar|belum valid/);
  assert.match(d.text, /R:R 1:1\.9 < standar 1:2\.0/);
  // zona lain yang memenuhi R:R jadi utama; Zona 3 hanya alternatif bertanda belum valid
  const two = buildDecision({ markdown: MD('3553.31', '3543.56', NA), bias: 'BULLISH', neutral: false, zoneRes: ZR, alignment: true, htf: {} });
  assert.equal(two.status, 'TRADE');
  assert.equal(two.primary.zone, 2);
  assert.match(two.text, /BUY Zona 3.*belum valid/);
});
test('zona searah yang tumpang tindih / SL sama diberi peringatan eksposur ganda', () => {
  const both = buildDecision({ markdown: MD('3553.31', '3543.56', NA), bias: 'BULLISH', zoneRes: ZR, htf: {} });
  assert.ok(both.warnings.some((w) => /BUY Zona 2 & Zona 3 tumpang tindih \(3538\.42–3543\.56\)/.test(w) && /Jangan pasang keduanya/.test(w)));
  const one = buildDecision({ markdown: MD(NA, '3543.56', NA), bias: 'BULLISH', zoneRes: ZR, htf: {} });
  assert.ok(one.warnings.some((w) => /tumpang tindih/.test(w) && /jangan dianggap dua peluang/.test(w)));
  // arah berbeda tidak dianggap tumpang tindih
  assert.ok(!both.warnings.some((w) => /SELL Zona/.test(w) && /tumpang/.test(w)));
});
test('blok keputusan WAIT bisa disisipkan ulang tanpa menumpuk', () => {
  const d = buildDecision({ markdown: MD(NA, '3543.56', '3642.72'), bias: 'BULLISH', neutral: true, zoneRes: ZR, htf: HTF });
  const md1 = insertDecision('**BIAS UTAMA:** NETRAL\n\n> **Ringkasan Cepat**\nx', d.text);
  const md2 = insertDecision(md1, d.text);
  assert.equal((md2.match(/KEPUTUSAN SERVER/g) || []).length, 1);
});
