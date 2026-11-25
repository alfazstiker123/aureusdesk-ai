// Referensi struktur basi (Audit #13, identitas zona diperketat di perbaikan fix3): rentang harga OB/FVG yang oleh mesin SMC
// berstatus INVALIDATED/MITIGATED tidak boleh terbaca sebagai zona fresh/konfluensi aktif. Teks TIDAK dihapus; rentang itu diberi penanda.
// Identitas zona = timeframe + jenis (OB/FVG) + arah + kedua batas harga. Tidak ada toleransi harga longgar: `tick` hanya menormalkan
// presisi angka (setengah tick), jadi zona berdekatan tetapi berbeda (beda tick, beda TF, beda jenis) tidak pernah dianggap sama. Tanpa import.
const STALE = new Set(['INVALIDATED', 'MITIGATED']);
const NUM = '(?:\\d{1,3}(?:,\\d{3})*\\.\\d+|\\d+\\.\\d+)';
const RANGE = new RegExp(`(${NUM})\\s*[-–—]\\s*(${NUM})`, 'g');
const MARK = /\s*\[⚠️[^\]]*\]/g;
const num = (s) => Number(String(s).replace(/,/g, ''));
const KIND = (src) => (/FVG/i.test(String(src)) ? 'FVG' : 'OB');

// Semua zona dari data SMC. Daftar fvgs hanya 8 entri terakhir (tampilan), jadi zona fresh diambil juga dari `zones` (daftar lengkap
// kandidat fresh dari mesin). Status selain INVALIDATED/MITIGATED (FRESH, PARTIALLY_MITIGATED, dst.) dianggap tidak basi.
export function zonesOf(analyses = []) {
  const stale = [], fresh = [];
  for (const a of analyses || []) {
    if (a?.status !== 'OK') continue;
    const put = (z, kind) => {
      if (!z || !Number.isFinite(Number(z.low)) || !Number.isFinite(Number(z.high))) return;
      const rec = { tf: a.timeframe, kind, low: Number(z.low), high: Number(z.high), status: z.status, type: String(z.type || '').toUpperCase() };
      (STALE.has(z.status) ? stale : fresh).push(rec);
    };
    for (const z of a.orderBlocks || []) put(z, 'OB');
    for (const z of a.fvgs || []) put(z, 'FVG');
    for (const z of a.zones || []) put({ ...z, status: STALE.has(z.status) ? z.status : 'FRESH' }, KIND(z.source));
  }
  return { stale, fresh };
}

// Petunjuk konteks yang SEMPIT: teks sebelum rentang (sejak pemisah , ; | / atau rentang sebelumnya) dan kurung langsung sesudahnya.
// Dipakai hanya untuk menyisihkan kandidat yang jelas bertentangan (TF/jenis/arah disebut tetapi beda); tidak pernah menambah kecocokan.
function hintsOf(line, start, end, prevEnd, nextStart) {
  const pre = line.slice(prevEnd, start).replace(MARK, '');
  const cut = Math.max(pre.lastIndexOf(','), pre.lastIndexOf(';'), pre.lastIndexOf('|'), pre.lastIndexOf('/'));
  let win = pre.slice(cut + 1);
  const post = /^\s*\(([^)]*)\)/.exec(line.slice(end, nextStart));
  if (post) win += ' ' + post[1];
  const tf = new Set((win.match(/\b(?:M1|M5|M15|M30|H1|H4|D1|W1|MN)\b/gi) || []).map((s) => s.toUpperCase()));
  const kind = new Set(); if (/\bFVG\b/i.test(win)) kind.add('FVG'); if (/\b(?:OB|order\s*block)\b/i.test(win)) kind.add('OB');
  const dir = new Set((win.match(/\b(?:bullish|bearish)\b/gi) || []).map((s) => s.toUpperCase()));
  return { tf, kind, dir };
}
const compatible = (z, h) => (!h.tf.size || h.tf.has(String(z.tf).toUpperCase())) && (!h.kind.size || h.kind.has(z.kind)) && (!h.dir.size || !z.type || h.dir.has(z.type));

export function flagStaleStructure(markdown = '', analyses = [], { tick = 0 } = {}) {
  const { stale, fresh } = zonesOf(analyses);
  const out = { markdown, flagged: [], notes: [] };
  if (!stale.length) return out;
  const t = Number(tick);
  const eps = (Number.isFinite(t) && t > 0 ? t / 2 : 0) + 1e-9; // hanya normalisasi presisi angka, bukan kedekatan zona
  const same = (z, lo, hi) => Math.abs(z.low - lo) <= eps && Math.abs(z.high - hi) <= eps;
  const lines = String(markdown).split('\n');
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { fence = !fence; continue; }
    if (fence || /^\s*>?\s*🔎|Jejak audit/.test(lines[i])) continue;
    const line = lines[i];
    const ms = [...line.matchAll(RANGE)];
    if (!ms.length) continue;
    let res = '', pos = 0, prevEnd = 0;
    ms.forEach((m, k) => {
      const start = m.index, end = start + m[0].length;
      const nextStart = k + 1 < ms.length ? ms[k + 1].index : line.length;
      res += line.slice(pos, end); pos = end;
      const lo = Math.min(num(m[1]), num(m[2])), hi = Math.max(num(m[1]), num(m[2]));
      const hint = hintsOf(line, start, end, prevEnd, nextStart);
      prevEnd = end;
      const fr = fresh.filter((z) => same(z, lo, hi) && compatible(z, hint));
      if (fr.length) return; // identitas fresh ditemukan: tidak pernah diberi penanda basi
      const z = stale.find((s) => same(s, lo, hi) && compatible(s, hint));
      if (!z) return;
      if (line.slice(end, end + 6).includes('⚠️')) return; // sudah ditandai
      out.flagged.push({ line: i + 1, tf: z.tf, kind: z.kind, status: z.status, low: lo, high: hi });
      res += ` [⚠️ ${z.tf} ${z.kind} ${z.status} — bukan zona fresh/konfluensi aktif]`;
    });
    lines[i] = res + line.slice(pos);
  }
  out.markdown = lines.join('\n');
  if (out.flagged.length) out.notes.push(`🧱 ${out.flagged.length} rujukan zona yang berstatus INVALIDATED/MITIGATED di data SMC diberi penanda (tidak disajikan sebagai zona fresh).`);
  return out;
}
