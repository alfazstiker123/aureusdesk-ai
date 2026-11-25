// Overlap OB/FVG: hitung IRISAN AKTUAL antara zona entry (Bagian 3) dan tiap dasar (TF + OB/FVG fresh searah dari mesin SMC).
// Label konfluensi ("Dasar: H4 FVG, H1 FVG") tidak boleh menyiratkan seluruh zona adalah overlap beberapa TF bila hanya sebagian kecil yang beririsan.
// Tidak mengubah koordinat zona, Entry, SL, TP, lot, R:R, risiko: hanya anotasi teks ("hanya N% zona") + tanda + catatan.
// Murni teks -> teks, tanpa alias import.
import { ledgerOf, scanTables, writeRow, isActive3 } from './finalSync.js';

const TFS = new Set(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']); // W1/MN hanya konteks bias, bukan dasar entry
const TOKEN = /\b(M1|M5|M15|M30|H1|H4|D1)\s+(OB|FVG)\b(?!\s*\((?:hanya|menyentuh|terpisah|tidak ada zona))/g;

const union = (iv) => {
  const a = iv.filter((x) => x[1] > x[0]).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const x of a) { const l = out[out.length - 1]; if (l && x[0] <= l[1] + 1e-12) l[1] = Math.max(l[1], x[1]); else out.push([x[0], x[1]]); }
  return out;
};
const intersect = (A, B) => {
  const out = [];
  for (const a of A) for (const b of B) { const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]); if (hi > lo + 1e-12) out.push([lo, hi]); }
  return union(out);
};
const stepDec = (x) => { for (let d = 0; d <= 8; d++) if (Math.abs(x * 10 ** d - Math.round(x * 10 ** d)) < 1e-9) return d; return 8; };
const len = (iv) => iv.reduce((s, x) => s + (x[1] - x[0]), 0);

/** OB/FVG fresh searah per label "TF SRC": { 'H1 FVG': [[low,high],...] } */
export function freshByLabel(analyses = [], side = 'BUY') {
  const want = side === 'SELL' ? 'BEARISH' : 'BULLISH';
  const map = new Map();
  for (const a of analyses || []) {
    if (!a || a.status !== 'OK' || !TFS.has(a.timeframe)) continue;
    // Daftar LENGKAP: orderBlocks + fvgs (tampilan, dipotong 8 terakhir) + zones (kandidat fresh penuh, termasuk FVG di luar 8 terakhir).
    const zs = (a.zones || []).map((z) => ({ ...z, _src: z.source === 'ORDER_BLOCK' ? 'OB' : z.source === 'FVG' ? 'FVG' : null }));
    for (const [src, list] of [['OB', a.orderBlocks], ['FVG', a.fvgs], ['OB', zs.filter((z) => z._src === 'OB')], ['FVG', zs.filter((z) => z._src === 'FVG')]]) {
      for (const z of list || []) {
        if (z.status !== 'FRESH' || String(z.type).toUpperCase() !== want) continue;
        const k = `${a.timeframe} ${src}`;
        if (!map.has(k)) map.set(k, []);
        const lo = Number(z.low), hi = Number(z.high);
        if (!map.get(k).some((x) => x[0] === lo && x[1] === hi)) map.get(k).push([lo, hi]);
      }
    }
  }
  return map;
}

/**
 * @param {string} markdown
 * @param {{analyses?:object[]|null, dec?:number}} opts
 * @returns {{markdown:string, notes:string[], items:object[]}}
 */
export function zoneOverlap(markdown = '', { analyses = null, dec = 2, spec = null } = {}) {
  const lines = String(markdown).split('\n');
  const notes = [];
  const items = [];
  if (!analyses?.length) return { markdown: String(markdown), notes, items };
  const P = (n) => Number(n).toFixed(dec);
  // Tick: HANYA dari spesifikasi broker (ticksize) yang valid. Tanpa itu, 10^-dec hanyalah presisi harga (estimasi) -> tidak boleh diklaim sebagai jumlah tick.
  const precision = Number.isInteger(dec) && dec >= 0 && dec <= 8 ? Math.pow(10, -dec) : 1e-5;
  const ts = Number(spec?.ticksize);
  const brokerTick = spec && spec.valid !== false && Number.isFinite(ts) && ts > 0 && ts / precision >= 1e-3 && ts / precision <= 1e3 ? ts : null;
  const tick = brokerTick ?? precision;
  const gd = brokerTick ? Math.max(dec, stepDec(brokerTick)) : dec; // desimal tampilan jarak absolut (nilai jarak tidak berubah)
  const pct = (r) => `${Math.round(r * 100)}%`;
  const rng = (iv) => iv.map((x) => `${P(x[0])}–${P(x[1])}`).join(', ');
  const led = ledgerOf(markdown, { dec });
  const { rows3 } = scanTables(lines);
  for (const r of rows3) {
    const L = led.get(`${r.side}${r.zone}`);
    if (!L?.active || !isActive3(r) || !(L.hi > L.lo)) continue;
    const zone = [[L.lo, L.hi]];
    const W = L.hi - L.lo;
    const byLabel = freshByLabel(analyses, r.side);
    const labels = [];
    for (const [k, iv] of byLabel.entries()) {
      const inside = intersect(union(iv), zone);
      if (len(inside)) labels.push({ label: k, inside, cover: len(inside) / W, full: union(iv) });
    }
    if (!labels.length) continue;
    const row = { key: `${r.side}${r.zone}`, zone: [L.lo, L.hi], labels: labels.map((x) => ({ label: x.label, cover: x.cover })) };
    // irisan SEMUA dasar di dalam zona
    let common = labels[0].inside;
    for (const x of labels.slice(1)) common = intersect(common, x.inside);
    row.common = common;
    row.commonRatio = labels.length > 1 ? len(common) / W : labels[0].cover;
    row.multi = labels.length > 1;
    items.push(row);

    // Anotasi "Dasar:" -> dasar yang hanya sebagian kecil zona diberi keterangan
    const di = (() => { for (let q = r.cells.length - 1; q >= 0; q--) if (/dasar\s*:/i.test(r.cells[q])) return q; return -1; })();
    let changed = false;
    if (di >= 0) {
      const cell = r.cells[di];
      const at = cell.search(/dasar\s*:/i);
      const head = cell.slice(0, at), tail = cell.slice(at);
      const tail2 = tail.replace(TOKEN, (m, tf, src) => {
        const lab = labels.find((x) => x.label === `${tf} ${src}`);
        if (!lab) {
          // Klasifikasi tanpa irisan: menyentuh tepi persis (jarak <= setengah tick) vs terpisah (jarak positif) vs tidak ada data fresh.
          const all = byLabel.get(`${tf} ${src}`);
          if (!all?.length) return `${m} (tidak ada zona fresh searah untuk dasar ini di data mesin)`;
          const gap = Math.min(...all.map((x) => Math.max(L.lo - x[1], x[0] - L.hi, 0)));
          const ticks = gap / tick;
          if (ticks <= 0.5 + 1e-9) return `${m} (hanya menyentuh tepi zona, tanpa irisan)`;
          const g = gap.toFixed(gd);
          if (brokerTick) return `${m} (terpisah ${g} = ${Math.abs(ticks - Math.round(ticks)) < 0.05 ? Math.round(ticks) : +ticks.toFixed(1)} tick @${+brokerTick.toFixed(8)} dari zona, tanpa irisan)`;
          return `${m} (terpisah ${g} dari zona, tanpa irisan; tick size broker belum tersedia, jumlah tick tidak dihitung)`;
        }
        return lab.cover < 0.5 ? `${m} (hanya ${pct(lab.cover)} zona: ${rng(lab.inside)})` : m;
      });
      if (tail2 !== tail) { r.cells[di] = head + tail2; changed = true; }
    }
    // Konfluensi multi-dasar hanya sebagian kecil zona
    if (row.multi && row.commonRatio < 0.5 && !r.cells[0].includes('KONFLUENSI PARSIAL')) {
      r.cells[0] = `${r.cells[0]} 🧩 KONFLUENSI PARSIAL (irisan ${labels.map((x) => x.label.split(' ')[0]).filter((v, i, a) => a.indexOf(v) === i).join('∩')} hanya ${pct(row.commonRatio)} zona)`;
      changed = true;
    }
    if (changed) writeRow(lines, r);
    if (row.multi && row.commonRatio < 0.8) {
      let full = labels[0].full;
      for (const x of labels.slice(1)) full = intersect(full, x.full);
      const parts = labels.map((x) => `${x.label} ${x.cover >= 0.995 ? 'mencakup seluruh zona' : `hanya ${pct(x.cover)} zona (${rng(x.inside)})`}`);
      notes.push(`🧩 ${r.side} Zona ${r.zone} (${P(L.lo)}–${P(L.hi)}): ${parts.join('; ')}. Irisan semua dasar di dalam zona = ${common.length ? rng(common) : 'tidak ada'} (${pct(row.commonRatio)} zona); label konfluensi hanya berlaku di bagian itu, bukan seluruh zona. Irisan penuh antar dasar (tanpa batas zona): ${full.length ? rng(full) : 'tidak ada'}. Koordinat zona tidak diubah.`);
    }
  }
  return { markdown: lines.join('\n'), notes, items };
}
