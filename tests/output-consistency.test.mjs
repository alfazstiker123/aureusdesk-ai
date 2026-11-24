import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { finalizeOrders, ledgerOf } from '../lib/finalSync.js';
import { syncOrderLabels } from '../lib/biasFinal.js';
import { syncSummaryPlan, hasActionClause } from '../lib/summaryPlan.js';
import { flagStaleStructure } from '../lib/staleStructure.js';
import { buildPdf } from '../lib/pdfReport.js';

const H3 = ['Zona & Strategi', 'Zona Entry', 'Stop Loss (SL)', 'Take Profit 1 (TP1)', 'Take Profit 2 (TP2)', 'Syarat Konfirmasi Candlestick'];
const H4 = ['Order', 'Harga Entry', 'Stop Loss', 'Take Profit', 'Jarak SL', 'Lot Aman', 'Risiko ($)', 'R:R', 'Waktu Berakhir (WIB)'];
const T = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const O = (side, zone, entry, sl, tp, lot) => { const dist = +Math.abs(entry - sl).toFixed(2); return { side, zone, entry, sl, tp, lot, dist, risk: +(lot * dist * 100).toFixed(2) }; };
const STYLE = { 1: 'Scalping', 2: 'Intraday', 3: 'Swing' };
const rejected = (side, zone) => [`${side === 'SELL' ? 'Sell' : 'Buy'} Limit Zona ${zone} (${STYLE[zone]})`, 'Tidak Ada Setup (Batas Risiko: Tidak Dipasang)', '-', '-', '-', '-', '-', '-', '-'];

/** Laporan sintetis: label arah ditulis model TERBALIK (model mengira bias berlawanan), total risiko lama salah. */
function doc({ orders = [], rejectedZones = [], modelLabels = 'inverted', rencana = 'Jangan buka order baru sekarang (masih di dalam No-Trade Zone). Tunggu 22:15 WIB, lalu siapkan Sell Limit di supply terdekat.', staleTotal = '- Total risiko arah SELL = $18.62 (batas $26.00, aman). Total arah BUY = $16.56 (aman).', bias = 'BULLISH' } = {}) {
  const lab = (side) => { const withBias = (bias === 'BULLISH') === (side === 'BUY'); const x = modelLabels === 'inverted' ? !withBias : withBias; return x ? '(Searah Bias)' : '(Counter-Trend - Wajib Konfirmasi Ekstra)'; };
  const nm = (o, k) => (k === 3 ? `${o.side} Zona ${o.zone} - ${STYLE[o.zone]} ${lab(o.side)}` : `${o.side === 'SELL' ? 'Sell' : 'Buy'} Limit Zona ${o.zone} (${STYLE[o.zone]}) ${lab(o.side)}`);
  const r3 = orders.map((o) => [nm(o, 3), `${(o.entry - 2).toFixed(2)} - ${(o.entry + 2).toFixed(2)}`, o.sl.toFixed(2), o.tp.toFixed(2), '-', 'Tunggu konfirmasi.']);
  const r4 = [...orders.map((o) => [nm(o, 4), o.entry.toFixed(2), o.sl.toFixed(2), o.tp.toFixed(2), o.dist.toFixed(2), o.lot.toFixed(2), `$${o.risk.toFixed(2)}`, '1:2.00', '25 Nov 2026, 05.00 WIB']), ...rejectedZones.map(([s, z]) => rejected(s, z))];
  const notes = [
    ...orders.map((o) => `> - ${nm(o, 4)}: Risiko dikoreksi - -> $${o.risk.toFixed(2)} (${o.lot.toFixed(2)} x ${o.dist.toFixed(2)} x 100)`),
    ...rejectedZones.map(([s, z]) => `> - 🚫 ${s === 'SELL' ? 'Sell' : 'Buy'} Limit Zona ${z} (${STYLE[z]}) ${lab(s)}: NO TRADE — risiko $26.01 pada lot minimum broker 0.01 melebihi batas $26.00.`),
  ];
  return `**BIAS UTAMA:** ${bias}

> **Ringkasan Cepat**
> - Rencana: ${rencana}
> - Level kunci: 3624.75

### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)
${T(H3, r3)}

### 4. Rekomendasi Susunan Pending Order

**4B. Order Baru yang Disarankan**
${T(H4, r4)}

**Rincian Hitung Risiko**
${orders.map((o) => `- ${o.side === 'SELL' ? 'Sell' : 'Buy'} Limit Zona ${o.zone}: ${o.lot.toFixed(2)} lot x ${o.dist.toFixed(2)} x 100 = $${o.risk.toFixed(2)}`).join('\n')}
${staleTotal}

> 🧮 **Verifikasi risiko otomatis** (XAUUSD) catatan:
${notes.join('\n')}
> - ℹ️ Total risiko per arah (hanya order lolos validator): BUY $99.99 | SELL $99.99 (batas $26.00 per arah).

_Bukan saran keuangan._
`;
}
/** Rangkaian akhir yang sama dengan route: finalizeOrders → syncOrderLabels → syncSummaryPlan. */
function post(md, { status, dir, final }) {
  const fo = finalizeOrders(md, { status, dir, maxRiskUsd: 26, dec: 2 });
  let out = syncOrderLabels(fo.markdown, final).markdown;
  out = syncSummaryPlan(out, { status, bias: final }).markdown;
  return { md: out, totals: fo.totals };
}
const usd = (n) => `$${Number(n).toFixed(2)}`;
const labelOf = (md, re) => { const l = md.split('\n').find((x) => re.test(x)); return /\((Searah Bias|Counter-Trend[^)]*|Netral[^)]*)\)/.exec(l)?.[1] ?? null; };
const sideLabels = (md) => md.split('\n').filter((l) => /(Buy|Sell) Limit Zona \d.*\((Searah Bias|Counter-Trend)/i.test(l)).map((l) => `${/(Buy|Sell)/i.exec(l)[1].toLowerCase()}:${/\((Searah Bias|Counter-Trend)/.exec(l)[1]}`);
const totalMentions = (md) => md.split('\n').filter((l) => /total/i.test(l) && /\$/.test(l) && /(buy|sell)/i.test(l) && !/^\s*\|/.test(l));

// 1. BUY searah bias, SELL countertrend
test('1) bias BULLISH: BUY = Searah Bias, SELL = Counter-Trend di tabel DAN catatan verifikasi (label model terbalik dikoreksi)', () => {
  const md = doc({ orders: [O('BUY', 2, 3553.31, 3527.02, 3640, 0.01), O('SELL', 2, 3632.58, 3643.03, 3615, 0.02)], bias: 'BULLISH' });
  const r = post(md, { status: 'TRADE', dir: 'BUY', final: 'BULLISH' });
  for (const l of sideLabels(r.md)) assert.ok(l === 'buy:Searah Bias' || l === 'sell:Counter-Trend', l);
  assert.equal(sideLabels(r.md).length, 4); // 2 baris tabel 4B + 2 baris catatan verifikasi
  assert.ok(!/sell:Searah|buy:Counter/.test(sideLabels(r.md).join(' ')));
});
// 2. SELL searah bias, BUY countertrend
test('2) bias BEARISH: SELL = Searah Bias, BUY = Counter-Trend di semua tempat', () => {
  const md = doc({ orders: [O('BUY', 2, 3553.31, 3527.02, 3640, 0.01), O('SELL', 2, 3632.58, 3643.03, 3615, 0.02)], bias: 'BEARISH', modelLabels: 'inverted' });
  const r = post(md, { status: 'TRADE', dir: 'SELL', final: 'BEARISH' });
  assert.deepEqual([...new Set(sideLabels(r.md))].sort(), ['buy:Counter-Trend', 'sell:Searah Bias']);
});
test('2b) bias NETRAL: label Netral untuk keduanya, termasuk catatan verifikasi', () => {
  const md = doc({ orders: [O('BUY', 2, 3553.31, 3527.02, 3640, 0.01)], bias: 'BULLISH' });
  const r = post(md, { status: 'WAIT', dir: null, final: 'NETRAL' });
  assert.ok(r.md.split('\n').filter((l) => /^> - Buy Limit Zona 2/.test(l)).every((l) => /\(Netral/.test(l)));
});
// 3. Order ditolak karena risiko lot minimum
test('3) order ditolak lot minimum: total BUY $0.00 di semua tempat; total lama ($16.56) hilang; label catatan ikut bias final', () => {
  const md = doc({ orders: [O('SELL', 2, 3632.58, 3643.03, 3615, 0.02)], rejectedZones: [['BUY', 2]], bias: 'BULLISH' });
  const r = post(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' });
  assert.equal(r.totals.BUY, 0); assert.equal(r.totals.SELL, 20.9);
  assert.ok(!/\$18\.62|\$16\.56/.test(r.md));
  for (const l of totalMentions(r.md)) assert.ok(/BUY \$0\.00/.test(l) && /SELL \$20\.90/.test(l), l);
  const rej = r.md.split('\n').find((l) => /🚫 Buy Limit Zona 2/.test(l));
  assert.match(rej, /\(Searah Bias\)/); // BUY searah bias BULLISH walau model menulis sebaliknya
});
// 4. Beberapa order lolos: total per arah
test('4) beberapa order lolos: total per arah = jumlah risiko order aktif di semua bagian', () => {
  const orders = [O('BUY', 2, 3553.31, 3527.02, 3640, 0.01), O('BUY', 3, 3543.56, 3520, 3700, 0.01), O('SELL', 2, 3632.58, 3643.03, 3615, 0.02)];
  const md = doc({ orders, bias: 'BULLISH' });
  const r = post(md, { status: 'TRADE', dir: 'BUY', final: 'BULLISH' });
  const buy = orders.filter((o) => o.side === 'BUY').reduce((s, o) => s + o.risk, 0), sell = 20.9;
  assert.ok(Math.abs(r.totals.BUY - buy) < 1e-9); assert.ok(Math.abs(r.totals.SELL - sell) < 1e-9);
  for (const l of totalMentions(r.md)) { assert.ok(l.includes(`BUY ${usd(buy)}`) && l.includes(`SELL ${usd(sell)}`), l); }
  assert.ok(!/\$99\.99|\$18\.62|\$16\.56/.test(r.md));
});
test('4b) pola "Total risiko arah SELL = $x. Total arah BUY = $y" (tanpa kata "per") terbaca dan diganti', () => {
  const md = doc({ orders: [O('SELL', 2, 3632.58, 3643.03, 3615, 0.02)], staleTotal: '- Total arah BUY = $16.56 dan total arah SELL = $18.62.' });
  const r = post(md, { status: 'TRADE', dir: 'SELL', final: 'BEARISH' });
  assert.ok(!/\$16\.56|\$18\.62/.test(r.md));
});
// 5. Hanya countertrend + Ringkasan
test('5) HANYA COUNTERTREND: Rencana "siapkan Sell Limit" diganti kalimat server (kandidat belum boleh dipasang)', () => {
  const md = doc({ orders: [O('SELL', 2, 3632.58, 3643.03, 3615, 0.02)], rejectedZones: [['BUY', 2]] });
  const r = post(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' });
  const l = r.md.split('\n').find((x) => /Rencana:/.test(x));
  assert.match(l, /HANYA COUNTERTREND/); assert.match(l, /Sell Zona 2 hanya berstatus CANDIDATE: belum boleh dipasang/);
  assert.ok(!/siapkan/i.test(l));
  assert.ok(!hasActionClause(l.split('Rencana:')[1].replace(/belum boleh dipasang/gi, '')));
});
// 6. No-Trade Zone aktif
test('6) No-Trade Zone aktif: jam dari teks model dipertahankan; tidak menyuruh membuka order', () => {
  const md = doc({ orders: [O('SELL', 2, 3632.58, 3643.03, 3615, 0.02)] });
  const r = post(md, { status: 'WAIT', dir: null, final: 'NETRAL' });
  const l = r.md.split('\n').find((x) => /Rencana:/.test(x));
  assert.match(l, /Keputusan server: WAIT/); assert.match(l, /No-Trade Zone aktif hingga 22:15 WIB/); assert.match(l, /Jangan membuka order baru/);
  const r2 = post(doc({ orders: [], rencana: 'Pasang Buy Limit di demand terdekat sekarang.' }), { status: 'NO_TRADE', dir: null, final: 'BULLISH' });
  const l2 = r2.md.split('\n').find((x) => /Rencana:/.test(x));
  assert.match(l2, /NO TRADE/); assert.ok(!/No-Trade Zone aktif/.test(l2)); // tanpa klaim jendela bila model tak menyebutnya
});
test('6b) Rencana yang sudah aman (hanya tunggu/jangan) tidak diubah — narasi alami dipertahankan', () => {
  const safe = 'Jangan buka order baru sekarang. Tunggu keputusan server berubah dan evaluasi ulang.';
  const r = post(doc({ orders: [O('SELL', 2, 3632.58, 3643.03, 3615, 0.02)], rencana: safe }), { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' });
  assert.ok(r.md.includes(`Rencana: ${safe}`));
  assert.equal(hasActionClause('Jangan memasang order apa pun.'), false);
  assert.equal(hasActionClause('Tunggu 22:15, lalu siapkan Sell Limit.'), true);
});
// 7. CANDIDATE vs VALIDATED
test('7) VALIDATED ORDER (TRADE searah bias) vs CANDIDATE: Rencana model tidak diganti saat TRADE; status order berbeda', () => {
  const orders = [O('BUY', 2, 3553.31, 3527.02, 3640, 0.01), O('SELL', 2, 3632.58, 3643.03, 3615, 0.02)];
  const t = post(doc({ orders, rencana: 'Siapkan Buy Limit di demand H1 setelah konfirmasi.' }), { status: 'TRADE', dir: 'BUY', final: 'BULLISH' });
  assert.ok(t.md.includes('Rencana: Siapkan Buy Limit di demand H1 setelah konfirmasi.'));
  assert.match(rowOf(t.md, /^\| Buy Limit Zona 2/), /VALIDATED ORDER/); assert.match(rowOf(t.md, /^\| Sell Limit Zona 2/), /CANDIDATE/);
  const c = post(doc({ orders, rencana: 'Siapkan Buy Limit di demand H1 setelah konfirmasi.' }), { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' });
  assert.ok(!/VALIDATED ORDER/.test(c.md)); assert.match(c.md.split('\n').find((x) => /Rencana:/.test(x)), /CANDIDATE/);
});
const rowOf = (md, re) => md.split('\n').find((l) => re.test(l));
// 8. Konsistensi antar-bagian, PDF, riwayat
test('8) satu sumber angka: semua penyebutan total identik; PDF memuat angka final; teks riwayat = markdown yang sama', () => {
  const md = doc({ orders: [O('SELL', 2, 3632.58, 3643.03, 3615, 0.02)], rejectedZones: [['BUY', 2]] });
  const r = post(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' });
  const mentions = totalMentions(r.md);
  assert.ok(mentions.length >= 2);
  for (const l of mentions) { assert.match(l, /BUY \$0\.00/); assert.match(l, /SELL \$20\.90/); }
  class P { constructor() { this.t = []; this.n = 1; this.fs = 10; } setFillColor() {} setDrawColor() {} setTextColor() {} setFont() {} setPage() {} setFontSize(n) { this.fs = n; } rect() {} roundedRect() {} addImage() {} addPage() { this.n++; } getNumberOfPages() { return this.n; } splitTextToSize(t) { return [String(t)]; } text(t) { this.t.push(Array.isArray(t) ? t.join(' ') : String(t)); } }
  const pdf = buildPdf(P, { markdown: r.md, createdAt: '2026-11-24T10:00:00Z' }).doc.t.join('\n');
  assert.ok(!/18\.62|16\.56|99\.99/.test(pdf));
  assert.ok(/20\.90/.test(pdf));
  assert.equal(r.md, post(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' }).md); // deterministik; yang disimpan ke riwayat = string ini
});
test('idempoten: menjalankan rangkaian dua kali tidak mengubah hasil', () => {
  const md = doc({ orders: [O('SELL', 2, 3632.58, 3643.03, 3615, 0.02)], rejectedZones: [['BUY', 2]] });
  const a = post(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' });
  const b = post(a.md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' });
  assert.equal(a.md, b.md);
});
test('angka order (Entry/SL/TP/lot/risiko/R:R) di tabel tidak berubah oleh Audit #13', () => {
  const md = doc({ orders: [O('SELL', 2, 3632.58, 3643.03, 3615, 0.02)], rejectedZones: [['BUY', 2]] });
  const r = post(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', final: 'BULLISH' });
  const cells = (m) => m.split('\n').filter((l) => /^\| (Sell|Buy) Limit/.test(l)).map((l) => l.split('|').slice(2).join('|'));
  assert.deepEqual(cells(r.md), cells(finalizeOrders(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', maxRiskUsd: 26, dec: 2 }).markdown));
  const L = ledgerOf(r.md).get('SELL2'); assert.equal(L.entry, 3632.58); assert.equal(L.sl, 3643.03); assert.equal(L.tp1, 3615); assert.equal(L.risk, 20.9);
});
test('baris berakhir CRLF tetap terbaca (catatan & Rencana)', () => {
  const md = doc({ orders: [O('SELL', 2, 3632.58, 3643.03, 3615, 0.02)] }).replace(/\n/g, '\r\n');
  const r = syncSummaryPlan(syncOrderLabels(md, 'BULLISH').markdown, { status: 'COUNTERTREND_ONLY', bias: 'BULLISH' });
  assert.match(r.markdown, /HANYA COUNTERTREND/);
  assert.match(r.markdown.split('\n').find((l) => /^> - Sell Limit Zona 2/.test(l)), /Counter-Trend/);
});

// ───────────── Temuan 4: struktur basi ─────────────
const AN = [
  { timeframe: 'H1', status: 'OK', orderBlocks: [{ type: 'BEARISH', low: 3628.31, high: 3640.39, status: 'INVALIDATED' }, { type: 'BEARISH', low: 3710.52, high: 3721.63, status: 'FRESH' }, { type: 'BEARISH', low: 3737.79, high: 3758.27, status: 'MITIGATED' }], fvgs: [{ type: 'BEARISH', low: 3642.72, high: 3652.99, status: 'PARTIALLY_MITIGATED' }] },
  { timeframe: 'M15', status: 'OK', orderBlocks: [], fvgs: [{ type: 'BEARISH', low: 3632.58, high: 3640.36, status: 'FRESH' }] },
];
test('4-struktur) OB H1 INVALIDATED diberi penanda; M15 FVG fresh tidak; teks lain tetap', () => {
  const line = '| SELL Zona 2 - Intraday - Dasar: M15 FVG bearish fresh 3632.58-3640.36 (area supply H1 3628.31-3640.39) (Counter-Trend) | 3632.58 - 3640.36 | 3643.03 |';
  const r = flagStaleStructure(line, AN);
  assert.equal(r.flagged.length, 1); assert.equal(r.flagged[0].tf, 'H1'); assert.equal(r.flagged[0].status, 'INVALIDATED');
  assert.match(r.markdown, /3628\.31-3640\.39 \[⚠️ H1 OB INVALIDATED — bukan zona fresh\/konfluensi aktif\]/);
  assert.match(r.markdown, /fresh 3632\.58-3640\.36 \(area/); // M15 FVG fresh tidak ditandai
  assert.match(r.markdown, /\| 3632\.58 - 3640\.36 \| 3643\.03 \|$/); // sel entry tak berubah
});
test('4-struktur) MITIGATED ditandai, PARTIALLY_MITIGATED/FRESH tidak; tanpa dobel; blok kode & jejak audit dilewati', () => {
  const t = 'Supply H1 3737.79-3758.27 dan FVG 3642.72-3652.99 serta OB 3710.52-3721.63.\n```text\nOrder Block: BEARISH 3628.31-3640.39 (INVALIDATED)\n```\n> 🔎 Jejak audit: 3628.31-3640.39';
  const a = flagStaleStructure(t, AN);
  assert.equal(a.flagged.length, 1); assert.equal(a.flagged[0].status, 'MITIGATED');
  assert.equal(flagStaleStructure(a.markdown, AN).markdown, a.markdown); // idempoten
});
test('4-struktur) zona yang INVALIDATED di satu TF tapi FRESH di TF lain tidak ditandai', () => {
  const an = [{ timeframe: 'H1', status: 'OK', orderBlocks: [{ type: 'BEARISH', low: 100.1, high: 101.2, status: 'INVALIDATED' }], fvgs: [] }, { timeframe: 'H4', status: 'OK', orderBlocks: [{ type: 'BEARISH', low: 100.1, high: 101.2, status: 'FRESH' }], fvgs: [] }];
  assert.equal(flagStaleStructure('zona 100.10-101.20', an).flagged.length, 0);
});
test('4-struktur) tanpa data SMC / tanpa zona basi: teks identik', () => {
  assert.equal(flagStaleStructure('zona 100.10-101.20', []).markdown, 'zona 100.10-101.20');
  assert.equal(flagStaleStructure('zona 100.10-101.20', [{ timeframe: 'H1', status: 'OK', orderBlocks: [], fvgs: [] }]).markdown, 'zona 100.10-101.20');
});
// ───────────── regresi pada laporan nyata 24 Nov (disimpan sebagai fixture) ─────────────
test('laporan nyata XAUUSD 24 Nov (fixture): keempat temuan hilang, angka order tak berubah', () => {
  const rep = fs.readFileSync(new URL('./fixtures/report-xauusd-24nov.md', import.meta.url), 'utf8').replace(/\r/g, '');
  let md = finalizeOrders(rep, { status: 'COUNTERTREND_ONLY', dir: 'BUY', maxRiskUsd: 26, dec: 2 }).markdown;
  md = syncOrderLabels(md, 'BULLISH').markdown;
  md = syncSummaryPlan(md, { status: 'COUNTERTREND_ONLY', bias: 'BULLISH' }).markdown;
  md = flagStaleStructure(md, AN).markdown;
  assert.ok(!/\$18\.62|\$16\.56/.test(md));
  assert.ok(!/Sell Limit Zona 2 [^\n]*\(Searah Bias\): Risiko/.test(md)); assert.ok(!/Buy Limit Zona 2 [^\n]*\(Counter-Trend\): NO TRADE/.test(md));
  assert.ok(!/lalu siapkan Sell Limit/.test(md)); assert.match(md, /H1 OB INVALIDATED/);
  const cells = (m) => m.split('\n').filter((l) => /^\| (Sell|Buy) Limit/.test(l)).map((l) => l.split('|').slice(2).join('|'));
  assert.deepEqual(cells(md), cells(rep));
});
test('kabel: route memanggil syncSummaryPlan & flagStaleStructure setelah syncOrderLabels', () => {
  const r = fs.readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8');
  assert.ok(r.indexOf('syncOrderLabels(markdown, biasInfo.final)') < r.indexOf('syncSummaryPlan(markdown'));
  assert.match(r, /flagStaleStructure\(markdown, mt4ContextUsed\?\.smc\?\.analyses/);
});

// ---- Perbaikan baris total ganda ("- Total BUY: Total risiko per arah ...") ----
{
  const base = () => fs.readFileSync(new URL('./fixtures/report-xauusd-24nov.md', import.meta.url), 'utf8').replace(/\r/g, '');
  const run = (line) => {
    const md = base().replace(/^- Total risiko arah SELL[^\n]*$/m, line);
    const r = finalizeOrders(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', maxRiskUsd: 26, dec: 2 });
    return r.markdown.split('\n').filter((l) => /Total risiko per arah/.test(l) && !/^\s*>/.test(l));
  };
  const SENT = /^- Total risiko per arah \(order yang lolos validator, termasuk kandidat yang belum boleh dipasang\): BUY \$0\.00 \| SELL \$20\.90 \(batas \$26\.00 per arah\)\.$/;
  const variants = {
    'format riskCheck "- Total BUY: $x (...) | Total SELL: $y (...)"': '- Total BUY: $6.85 (batas $26.00 per arah) | Total SELL: $2.92 (batas $26.00 per arah)',
    'format tebal "- **Total BUY:** $x | **Total SELL:** $y"': '- **Total BUY:** $6.85 | **Total SELL:** $2.92',
    'format polos "- Total BUY $x | Total SELL $y"': '- Total BUY $6.85 | Total SELL $2.92',
    'format urutan SELL dulu "- Total SELL: $y | Total BUY: $x"': '- Total SELL: $2.92 | Total BUY: $6.85',
    'format "Total risiko arah SELL = ... Total arah BUY = ..."': '- Total risiko arah SELL = $18.62 (aman). Total arah BUY = $16.56 (aman).',
  };
  for (const [name, line] of Object.entries(variants)) {
    test(`total risiko: ${name} → satu kalimat server, tanpa awalan "Total BUY:" ganda`, () => {
      const out = run(line);
      assert.equal(out.length, 1);
      assert.match(out[0], SENT);
      assert.doesNotMatch(out[0], /Total (BUY|SELL)\s*:/i);
    });
  }
  test('total risiko: angka total sama untuk semua format (BUY $0.00 | SELL $20.90) dan idempoten', () => {
    for (const line of Object.values(variants)) {
      const md = base().replace(/^- Total risiko arah SELL[^\n]*$/m, line);
      const a = finalizeOrders(md, { status: 'COUNTERTREND_ONLY', dir: 'BUY', maxRiskUsd: 26, dec: 2 }).markdown;
      const b = finalizeOrders(a, { status: 'COUNTERTREND_ONLY', dir: 'BUY', maxRiskUsd: 26, dec: 2 }).markdown;
      assert.equal(b, a);
    }
  });
}
