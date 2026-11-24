// Referensi struktur basi (Audit #13): rentang harga OB/FVG yang oleh mesin SMC berstatus INVALIDATED/MITIGATED tidak boleh
// terbaca sebagai zona fresh/konfluensi aktif. Teks TIDAK dihapus; rentang itu diberi penanda. Tanpa import.
const STALE = new Set(['INVALIDATED', 'MITIGATED']);
const RANGE = /(\d{1,3}(?:,\d{3})*\.\d+|\d+\.\d+)\s*[-–—]\s*(\d{1,3}(?:,\d{3})*\.\d+|\d+\.\d+)/g;
const num = (s) => Number(String(s).replace(/,/g, ''));

function zonesOf(analyses = []) {
  const stale = [], fresh = [];
  for (const a of analyses || []) {
    if (a?.status !== 'OK') continue;
    for (const [list, kind] of [[a.orderBlocks, 'OB'], [a.fvgs, 'FVG']]) {
      for (const z of list || []) {
        const rec = { tf: a.timeframe, kind, low: z.low, high: z.high, status: z.status, type: z.type };
        if (STALE.has(z.status)) stale.push(rec); else fresh.push(rec);
      }
    }
  }
  return { stale, fresh };
}

export function flagStaleStructure(markdown = '', analyses = [], { tol = 0.05 } = {}) {
  const { stale, fresh } = zonesOf(analyses);
  const out = { markdown, flagged: [], notes: [] };
  if (!stale.length) return out;
  const same = (z, lo, hi) => Math.abs(z.low - lo) <= tol && Math.abs(z.high - hi) <= tol;
  const lines = String(markdown).split('\n');
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { fence = !fence; continue; }
    if (fence || /^\s*>?\s*🔎|Jejak audit/.test(lines[i])) continue;
    lines[i] = lines[i].replace(RANGE, (all, a, b, off, str) => {
      const lo = Math.min(num(a), num(b)), hi = Math.max(num(a), num(b));
      if (fresh.some((z) => same(z, lo, hi))) return all;
      const z = stale.find((s) => same(s, lo, hi));
      if (!z) return all;
      if (str.slice(off + all.length, off + all.length + 6).includes('⚠️')) return all; // sudah ditandai
      out.flagged.push({ line: i + 1, tf: z.tf, kind: z.kind, status: z.status, low: lo, high: hi });
      return `${all} [⚠️ ${z.tf} ${z.kind} ${z.status} — bukan zona fresh/konfluensi aktif]`;
    });
  }
  out.markdown = lines.join('\n');
  if (out.flagged.length) out.notes.push(`🧱 ${out.flagged.length} rujukan zona yang berstatus INVALIDATED/MITIGATED di data SMC diberi penanda (tidak disajikan sebagai zona fresh).`);
  return out;
}
