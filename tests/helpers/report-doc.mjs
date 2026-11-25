// Pembangun laporan sintetis (disalin dari tests/output-consistency.test.mjs). Bukan data live.
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

export { doc, O, STYLE, T, H3, H4 };
