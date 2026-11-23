import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveBias, syncHeadlineBias, syncBiasLabels, syncTfBias, syncLevelLabels, syncExpiry, describeLevel } from '../lib/consistency.js';

// riskCheck.js memakai alias '@/lib/*'; salin ke folder sementara dengan path relatif agar bisa diuji tanpa bundler.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-'));
for (const f of ['riskCheck.js', 'pairs.js', 'marketTime.js']) {
  fs.writeFileSync(path.join(tmp, f), fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8').replace(/'@\/lib\/([\w]+)'/g, "'./$1.js'"));
}
const { verifyRiskTables } = await import(pathToFileURL(path.join(tmp, 'riskCheck.js')).href);
const { PAIRS } = await import(pathToFileURL(path.join(tmp, 'pairs.js')).href);

const S3 = `| Zona & Strategi | Zona Entry | Stop Loss (SL) | TP1 | TP2 | Syarat |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (Demand M5) (Counter-Trend) | 3603.11 - 3606.59 | 3599.50 | 3615.00 | 3620.00 | x |
| BUY Zona 2 - Intraday (FVG M15) (Searah Bias) | 3577.48 - 3583.86 | 3574.00 | 3600.00 | 3612.00 | x |
| SELL Zona 1 - Scalping (...) | Tidak ada level valid (tunggu) | - | - | - | - |
| SELL Zona 2 - Intraday (FVG H1) (Searah Bias) | 3656.82 - 3661.30 | 3665.00 | 3635.00 | 3620.00 | x |
`;

test('label Searah/Counter-Trend ditentukan server dari bias, bukan Gemini', () => {
  const r = syncBiasLabels(S3, 'BEARISH');
  assert.match(r.markdown, /BUY Zona 2 - Intraday \(FVG M15\) \(Counter-Trend - Wajib Konfirmasi Ekstra\) \|/);
  assert.match(r.markdown, /BUY Zona 1 - Scalping \(Demand M5\) \(Counter-Trend - Wajib Konfirmasi Ekstra\) \|/);
  assert.match(r.markdown, /SELL Zona 2 - Intraday \(FVG H1\) \(Searah Bias\) \|/);
  assert.doesNotMatch(r.markdown, /BUY Zona 2[^|]*Searah Bias/);
  assert.ok(r.changed >= 2);
  const bull = syncBiasLabels(S3, 'BULLISH');
  assert.match(bull.markdown, /SELL Zona 2 - Intraday \(FVG H1\) \(Counter-Trend/);
  assert.match(syncBiasLabels(S3, 'NETRAL').markdown, /\(Netral - Tunggu Konfirmasi\)/);
});

test('bias headline: mesin menang bila bertentangan', () => {
  assert.deepEqual(resolveBias('BEARISH - FOKUS SELL', 'BEARISH'), { bias: 'BEARISH', overridden: false, headline: 'BEARISH' });
  const x = resolveBias('BULLISH - FOKUS BUY', 'BEARISH');
  assert.equal(x.bias, 'BEARISH');
  assert.ok(x.overridden);
  assert.equal(resolveBias('NETRAL - WAIT & SEE', 'BEARISH').bias, 'BEARISH');
  assert.match(syncHeadlineBias('**BIAS UTAMA:** BULLISH - FOKUS BUY\n', 'BEARISH'), /BEARISH - FOKUS SELL/);
});

const AN = [
  { timeframe: 'M15', status: 'OK', bias: 'BEARISH', liveNote: 'harga live ... CHoCH bullish', lastPrice: 3616, structureEvents: [], swings: [], zones: [], supports: [], resistances: [] },
  { timeframe: 'M5', status: 'OK', bias: 'BULLISH', lastPrice: 3620, structureEvents: [], swings: [], zones: [], supports: [], resistances: [] },
  { timeframe: 'H1', status: 'OK', bias: 'BULLISH', lastPrice: 3612, structureEvents: [], swings: [], zones: [], supports: [], resistances: [] },
  { timeframe: 'W1', status: 'OK', bias: 'BEARISH', lastPrice: 3579, structureEvents: [{ type: 'BOS', direction: 'BULLISH', level: 3435.48, time: 1 }],
    swings: [{ type: 'L', price: 3302.73 }], zones: [], supports: [], resistances: [] },
];
const S2 = `| Timeframe | Struktur/Trend | Level Kunci | Catatan |
|---|---|---|---|
| W1 | Bearish | $3435.48 (Low mingguan) | Tekanan jual |
| D1 | Bearish | $3620.99 (Harga saat ini) | Konsolidasi |
| H1 | Bullish (Korektif) | 3656.82 | Koreksi |
| M15 | Bullish | 3577.48 | Pantulan |
| M5 | Sideways/Range | 3603.11 | Range |
`;

test('bias TF dan nama Level Kunci mengikuti mesin SMC', () => {
  const a = syncTfBias(S2, AN);
  assert.match(a.markdown, /\| M15 \| Bearish \(harga live menembus swing; menunggu close candle\) \|/);
  assert.match(a.markdown, /\| M5 \| Bullish \|/);
  assert.match(a.markdown, /\| H1 \| Bullish \(Korektif\) \|/); // searah mesin: tidak disentuh
  const b = syncLevelLabels(S2, AN, 3620.99);
  assert.match(b.markdown, /\$3435\.48 \(BOS Bullish W1\)/);
  assert.doesNotMatch(b.markdown, /Low mingguan/);
  assert.match(b.markdown, /\| D1 \| Bearish \| — \(TF ini tidak dihitung mesin SMC\) \|/);
  assert.equal(describeLevel(AN[3], 3302.73, 1), 'Swing Low W1');
});

const NOW = new Date('2026-11-23T13:28:00Z'); // 20:28 WIB, Senin (pasar buka)
const S4B = `| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 2 (Intraday) | 3656.82 | 3665.00 | 3635.00 | 8.18 | 0.02 | $16.36 | 1:2.67 | 23 Nov 2026, 22:28 WIB |
| Buy Limit Zona 1 (Scalping) | 3603.11 | 3599.50 | 3615.00 | 3.61 | 0.01 | $3.61 | 1:3.29 | 23 Nov 2026, 22:28 WIB |
| Buy Limit Zona 2 (Intraday) | 3583.86 | 3574.28 | 3600.00 | 9.58 | 0.01 | $9.58 | 1:1.68 | 24 Nov 2026, 02:28 WIB |
| Buy Limit Zona 3 (Swing) | 3553.97 | 3539.96 | 3575.00 | 14.01 | 0.01 | $14.01 | 1:1.50 | 24 Nov 2026, 05:00 WIB |

> - ⏳ Masa Berlaku Sinyal: Zona 1 valid 1-2 jam hingga pukul 22:28 WIB; Zona 2 valid hingga 4-6 jam ke depan (03:10 WIB); Zona 3 (Swing) valid hingga Daily Close pukul 05:00 WIB.
`;

test('expiry konsisten per tipe zona; ringkasan memakai jam 4B', () => {
  const r = syncExpiry(S4B, NOW, PAIRS.XAUUSD);
  assert.match(r.markdown, /\| Sell Limit Zona 2 \(Intraday\) .* 24 Nov 2026, 02\.28 WIB \|/s); // dulu 22:28 (durasi Scalping)
  assert.match(r.markdown, /Zona 1 valid 1-2 jam hingga pukul 22:28 WIB/);
  assert.match(r.markdown, /\(02:28 WIB\)/); // ringkasan 03:10 -> 02:28
  assert.match(r.markdown, /Zona 3 \(Swing\) valid hingga Daily Close pukul 05:00 WIB/);
  assert.equal(r.changed, 1);
});

test('expiry tidak disentuh saat pasar emas tutup akhir pekan', () => {
  const sat = new Date('2026-11-21T10:00:00Z');
  assert.equal(syncExpiry(S4B, sat, PAIRS.XAUUSD).markdown, S4B);
});

const RISK = `| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Buy Limit Zona 1 (Scalping) | 3603.11 | 3599.50 | 3615.00 | 3.61 | 0.01 | $3.61 | 1:3.29 | 23 Nov 2026, 22:28 WIB |
| Buy Limit Zona 2 (Intraday) | 3583.86 | 3574.28 | 3600.00 | 3.48 | 0.02 | $6.96 | 1:2 | 24 Nov 2026, 02:28 WIB |
| Buy Limit Zona 3 (Swing) | 3553.97 | 3539.96 | 3575.00 | 4.16 | 0.02 | $8.32 | 1:2.5 | 24 Nov 2026, 05:00 WIB |

**Rincian Hitung Risiko:**
- Buy Limit Zona 1 (Scalping): 0.01 x 3.61 x 100 = $3.61
- Buy Limit Zona 2 (Intraday): 0.02 x 3.48 x 100 = $6.96
- Buy Limit Zona 3 (Swing): 0.02 x 4.16 x 100 = $8.32
`;

test('risiko: satu sumber angka; order zona terjauh tidak dipasang bila total > batas', () => {
  const r = verifyRiskTables(RISK, 20, PAIRS.XAUUSD, NOW, { last: 3620.99, capPerDirection: true, zones: 3 });
  // Z3 dibatalkan oleh server (bukan sekadar catatan), Z1+Z2 = 3.61 + 9.58 = 13.19 <= 20
  assert.match(r.markdown, /\| Buy Limit Zona 3 \(Swing\) \| Tidak Ada Setup \(Batas Risiko: Tidak Dipasang\) \|/);
  assert.match(r.markdown, /Buy Limit Zona 3 \(Swing\): tidak ada order \(melebihi batas risiko\)/);
  assert.ok(r.notes.some((n) => /Buy Limit Zona 3 \(Swing\).*TIDAK DIPASANG/.test(n)));
  assert.ok(Math.abs(r.totals.BUY - 13.19) < 0.01);
  // catatan risiko tidak boleh menyebut lot lama (0.02) yang sudah diturunkan ke tabel
  const z2 = r.notes.filter((n) => n.startsWith('Buy Limit Zona 2'));
  assert.ok(z2.every((n) => !/0\.02 x/.test(n)), z2.join(' | '));
  assert.match(r.markdown, /\| Buy Limit Zona 2 \(Intraday\) \| 3583\.86 \| 3574\.28 \| 3600\.00 \| 9\.58 \| 0\.01 \| \$9\.58 \|/);
});
