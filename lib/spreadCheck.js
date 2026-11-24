// Kualitas zona terhadap SPREAD aktual broker (generik untuk semua instrumen: rasio spread / lebar zona, tanpa angka tetap per pair).
// Hanya PERINGATAN: Entry/SL/TP tidak diubah dan zona tidak dibatalkan. Spread berasal dari kuotasi EA (Ask - Bid).
// Murni teks -> teks, tanpa alias import.
import { ledgerOf, scanTables, writeRow, isActive3, isActive4, numsOf } from './finalSync.js';

/** spread/lebar zona >= nilai ini -> "ZONA SEMPIT". Heuristik kualitas eksekusi (bukan hasil backtest). */
export const SPREAD_ZONE_WARN_RATIO = 0.25;
export const TAG = '⚠️ ZONA SEMPIT — RENTAN SPREAD & SLIPPAGE';
export const UNVERIFIED = 'Spread belum terverifikasi';
const MAX_SPREAD_PCT = 1; // spread > 1% harga dianggap data tidak valid (salah kolom / kuotasi rusak)

/** Validasi kuotasi broker. spread dihitung dari Ask - Bid, bukan angka tetap. */
export function spreadInfo(quote) {
  const bid = Number(quote?.bid), ask = Number(quote?.ask);
  if (!quote) return { valid: false, why: 'tidak ada kuotasi broker (bukan sumber EA MT4)' };
  if (!(bid > 0) || !(ask > 0)) return { valid: false, why: 'Bid/Ask tidak tersedia' };
  if (ask < bid) return { valid: false, why: `Ask ${ask} lebih kecil dari Bid ${bid}` };
  const spread = ask - bid;
  if (!(spread > 0)) return { valid: false, why: 'spread 0 / tidak dilaporkan broker' };
  if (spread / bid * 100 > MAX_SPREAD_PCT) return { valid: false, why: `spread ${spread} tidak wajar (> ${MAX_SPREAD_PCT}% harga)` };
  return { valid: true, bid, ask, spread };
}

/** Penilaian satu zona. Bagian 3 menampilkan zona dalam harga BID (candle MT4), sedangkan order BUY terisi di ASK. */
export function assessZone({ side, lo, hi, spread }) {
  const width = Math.max(0, hi - lo);
  const ratio = width > 0 ? spread / width : Infinity;
  const narrow = ratio >= SPREAD_ZONE_WARN_RATIO;
  // BUY limit terisi saat Ask <= entry -> dalam Bid, harga harus turun sampai (entry - spread): bagian zona yang efektif menyusut.
  // SELL limit terisi di Bid (zona tidak menyusut); SL SELL terpicu oleh Ask, jadi jarak SL efektif berkurang sebesar spread.
  const effective = side === 'BUY' ? Math.max(0, width - spread) : width;
  return { width, ratio, narrow, effective };
}

/**
 * Beri tanda peringatan pada zona aktif yang terlalu sempit dibanding spread, lalu kembalikan catatan.
 * @param {{quote?:object, dec?:number}} opts
 * @returns {{markdown:string, notes:string[], verified:boolean, warned:string[]}}
 */
export function spreadWarnings(markdown = '', { quote = null, dec = 2 } = {}) {
  const lines = String(markdown).split('\n');
  const notes = [];
  const warned = [];
  const info = spreadInfo(quote);
  const led = ledgerOf(markdown, { dec });
  const { rows3, rows4 } = scanTables(lines);
  const active = [...led.values()].filter((v) => v.active);
  if (!active.length) return { markdown: String(markdown), notes, verified: info.valid, warned };
  if (!info.valid) {
    notes.push(`⚠️ ${UNVERIFIED} (${info.why}): kelayakan zona terhadap spread tidak dapat dinilai. Cek spread live di MT4 sebelum memasang.`);
    return { markdown: String(markdown), notes, verified: false, warned };
  }
  const P = (n) => Number(n).toFixed(dec);
  const { bid, ask, spread } = info;
  const tag = (r) => { if (!r.cells[0].includes('ZONA SEMPIT')) { r.cells[0] = `${r.cells[0]} ${TAG}`; writeRow(lines, r); } };
  for (const r3 of rows3) {
    if (!isActive3(r3)) continue;
    const L = led.get(`${r3.side}${r3.zone}`);
    if (!L?.active) continue;
    const zs = numsOf(r3.cells[r3.idx.entry]);
    if (!zs.length) continue;
    const lo = Math.min(...zs), hi = Math.max(...zs);
    const a = assessZone({ side: r3.side, lo, hi, spread });
    if (!a.narrow) continue;
    tag(r3);
    const r4 = rows4.find((x) => x.side === r3.side && x.zone === r3.zone);
    if (r4 && isActive4(r4)) tag(r4);
    warned.push(`${r3.side}${r3.zone}`);
    const pct = Number.isFinite(a.ratio) ? `${(a.ratio * 100).toFixed(0)}%` : 'zona hanya satu harga';
    const fill = r3.side === 'BUY'
      ? `Limit BUY terisi saat Ask ≤ entry (Bid ≈ ${P(Number(L.entry) - spread)}), sehingga hanya ${P(a.effective)} dari lebar zona yang efektif${a.effective <= 0 ? ' — Bid harus menembus seluruh zona' : ''}.`
      : `Limit SELL terisi di Bid ≥ entry, tetapi SL SELL terpicu oleh Ask (Bid ≈ ${P(Number(L.sl) - spread)}) sehingga jarak SL efektif berkurang ${P(spread)}.`;
    notes.push(`${TAG}: ${r3.side} Zona ${r3.zone} lebar ${P(a.width)} vs spread ${P(spread)} (${pct} dari lebar zona; Bid ${P(bid)} / Ask ${P(ask)}). ${fill} Entry/SL/TP tidak diubah; pertimbangkan limit di tepi zona dan konfirmasi di TF kecil.`);
  }
  return { markdown: lines.join('\n'), notes, verified: true, warned };
}
