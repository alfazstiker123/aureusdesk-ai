// Invalidation vs Stop Loss.
//   SL            = batas risiko posisi (angka final dari tabel 4B).
//   Invalidation  = kondisi yang membatalkan analisis/struktur setup. BOLEH berbeda dari SL, tetapi harus punya dasar struktur.
// Server TIDAK menciptakan level invalidation: setiap level yang ditulis Gemini di "Skenario Batal" diperiksa terhadap level struktur
// hasil mesin SMC (swing utuh, BOS/CHoCH, tepi OB/FVG). Level yang bukan struktur, sama dengan SL, atau di sisi salah dibuang.
// Bila tidak ada yang tersisa: "Invalidation struktural belum terdefinisi — perlu evaluasi manual".
// Murni teks -> teks, tanpa alias import (bisa diuji dengan node).
import { ledgerOf, scanTables, writeRow, isActive3 } from './finalSync.js';

const NUM = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const toNum = (t) => Number(String(t).replace(/,/g, ''));
const REF1 = /\b(buy|sell)(?:\s+(?:limit|stop))?\s+(?:zona|zone|z)\s*(\d)\b/gi;
const TF_RE = /\b(M1|M5|M15|M30|H1|H4|D1|W1|MN)\b/i;
const CLOSE_RE = /\b(?:close|closing|penutupan|tertutup|ditutup)\b/i;
export const UNDEFINED_TEXT = 'Invalidation struktural belum terdefinisi — perlu evaluasi manual';

/** Daftar level struktur dari analisa mesin SMC (semua TF berstatus OK). */
export function structuralLevels(analyses = []) {
  const out = [];
  const add = (price, tf, kind) => { const p = Number(price); if (Number.isFinite(p) && p > 0) out.push({ price: p, tf, kind }); };
  for (const a of analyses || []) {
    if (!a || a.status !== 'OK') continue;
    const tf = a.timeframe;
    for (const x of a.supports || []) add(x.price, tf, 'swing low utuh');
    for (const x of a.resistances || []) add(x.price, tf, 'swing high utuh');
    for (const e of a.structureEvents || []) add(e.level, tf, `${e.type} ${String(e.direction || '').toLowerCase()}`.trim());
    for (const z of a.orderBlocks || []) { add(z.low, tf, `tepi OB ${String(z.type || '').toLowerCase()} (${z.status})`); add(z.high, tf, `tepi OB ${String(z.type || '').toLowerCase()} (${z.status})`); }
    for (const z of a.fvgs || []) { add(z.low, tf, `tepi FVG ${String(z.type || '').toLowerCase()} (${z.status})`); add(z.high, tf, `tepi FVG ${String(z.type || '').toLowerCase()} (${z.status})`); }
  }
  return out;
}

/** Deskripsi dasar struktur sebuah level, mis. "swing low utuh H1 & M15". Null bila bukan level struktur. */
export function basisOf(levels, price, tol) {
  const hit = levels.filter((l) => Math.abs(l.price - price) <= tol);
  if (!hit.length) return null;
  const byKind = new Map();
  for (const h of hit) { if (!byKind.has(h.kind)) byKind.set(h.kind, []); if (!byKind.get(h.kind).includes(h.tf)) byKind.get(h.kind).push(h.tf); }
  return [...byKind.entries()].slice(0, 3).map(([k, tfs]) => `${k} ${tfs.join('/')}`).join('; ');
}

const dirOf = (clause) => {
  if (/di\s*bawah|ke\s*bawah|below|turun\s+(?:ke\s+)?bawah|<\s*\d/i.test(clause)) return 'below';
  if (/di\s*atas|ke\s*atas|above|naik\s+(?:ke\s+)?atas|>\s*\d/i.test(clause)) return 'above';
  return null; // "tembus"/"break" tanpa arah eksplisit: arah mengikuti sisi order
};

/**
 * Nilai satu klausa invalidation dari Gemini.
 * @returns {{kind:'struct'|'sl'|'wrong'|'unknown'|'none', level?:number, tf?:string, close?:boolean, basis?:string, complete?:boolean, why?:string}}
 */
export function judgeClause(clause, { side, lo, hi, sl, entry, levels, tol }) {
  const cand = (String(clause).match(NUM) || []).map(toNum).filter((n) => n > 0 && Math.abs(n - entry) / entry < 0.3 && !(Number.isInteger(n) && n < 100));
  if (!cand.length) return { kind: 'none' };
  const level = cand[cand.length - 1];
  const dir = dirOf(clause);
  const wantDir = side === 'BUY' ? 'below' : 'above';
  const sideOk = side === 'BUY' ? level < lo - tol : level > hi + tol;
  if (!sideOk || (dir && dir !== wantDir)) return { kind: 'wrong', level, why: `bukan di sisi invalidation ${side} (harus ${side === 'BUY' ? 'di bawah' : 'di atas'} zona entry)` };
  const tfM = TF_RE.exec(clause);
  const tf = tfM ? tfM[1].toUpperCase() : null;
  const close = CLOSE_RE.test(clause);
  const basis = basisOf(levels, level, tol);
  const atSl = sl != null && Math.abs(level - sl) <= tol;
  if (!basis) return atSl ? { kind: 'sl', level, tf, close, why: 'sama dengan SL (batas risiko), bukan level struktur' } : { kind: 'unknown', level, why: 'bukan level struktur dari mesin SMC' };
  return { kind: 'struct', level, tf, close, basis, atSl, complete: !!(tf && close) };
}

const relation = (side, level, sl, P, atSl) => {
  if (atSl || sl == null) return atSl ? 'level sama dengan SL' : '';
  const beyond = side === 'BUY' ? level < sl : level > sl; // lebih jauh dari entry daripada SL
  const gap = Math.abs(level - sl);
  return beyond
    ? `${P(gap)} di luar SL → SL biasanya kena lebih dulu; invalidation = batas penilaian ulang analisis`
    : `${P(gap)} di dalam jarak SL → setup batal lebih dulu: cabut pending order bila belum terisi, evaluasi manual bila sudah terisi (SL tetap batas risiko)`;
};

const sideName = (k) => `${k.startsWith('SELL') ? 'Sell' : 'Buy'} Zona ${k.replace(/\D/g, '')}`;

/**
 * Tulis ulang "Skenario Batal" agar SL (batas risiko) dan invalidation (struktur) terpisah dan berdasar.
 * Tanpa analisa mesin (mode screenshot) level tidak bisa diverifikasi: teks dibiarkan, hanya diberi catatan.
 * @returns {{markdown:string, notes:string[], items:object[]}}
 */
export function syncInvalidation(markdown = '', { analyses = null, dec = 2 } = {}) {
  const lines = String(markdown).split('\n');
  const notes = [];
  const items = [];
  const P = (n) => Number(n).toFixed(dec);
  const tol = Math.pow(10, -dec) + 1e-9;
  const led = ledgerOf(markdown, { dec });
  const hs = lines.findIndex((l) => !/^\s*\|/.test(l) && /skenario batal/i.test(l) && !/^\s*[-*]\s/.test(l));
  if (hs < 0) return { markdown: String(markdown), notes, items };
  let he = hs + 1;
  while (he < lines.length && (/^\s*$/.test(lines[he]) || /^\s*[-*•]\s/.test(lines[he]))) he++;
  const levels = structuralLevels(analyses || []);
  if (!levels.length) {
    if (lines.slice(hs + 1, he).some((l) => /^\s*[-*•]\s/.test(l) && !/WAIT \/ NO TRADE/.test(l))) notes.push('🧭 Skenario Batal tidak diverifikasi terhadap struktur mesin (tidak ada data OHLC/SMC): level invalidation dari model, cek manual terhadap SL.');
    return { markdown: String(markdown), notes, items };
  }
  const covered = new Set();
  const out = [];
  for (let i = hs + 1; i < he; i++) {
    const t = lines[i];
    const refs = [...new Set([...t.matchAll(REF1)].map((m) => `${m[1].toUpperCase()}${m[2]}`))];
    const L = refs.length === 1 ? led.get(refs[0]) : null;
    if (!/^\s*[-*•]\s/.test(t) || refs.length !== 1 || !L || !L.active || /WAIT \/ NO TRADE/.test(t) || /Invalidation struktural/i.test(t)) {
      if (refs.length === 1 && /Invalidation struktural/i.test(t)) covered.add(refs[0]);
      out.push(t);
      continue;
    }
    const k = refs[0];
    covered.add(k);
    // Format baris tidak boleh bergantung pada titik dua: "Sell Zona 2: ...", "Sell Zona 2 batal jika ...", "SELL Z2 invalid jika ...", "Sell Limit Zona 2 batal apabila ..."
    const mm = /^(\s*[-*•]\s+(?:[^\w\s|*]{1,3}\s*)?)(?:\*\*)?(?:buy|sell)(?:\s+(?:limit|stop))?\s+(?:zona|zone|z)\s*\d\b(?:\*\*)?\s*[:\-–—]?\s*(.*)$/i.exec(t);
    if (!mm) { out.push(t); continue; }
    const body = mm[2];
    const clauses = body.split(/;\s+|\s+atau\s+|\s+or\s+|\s+serta\s+/i).filter((c) => c.trim());
    const ctx = { side: L.side, lo: L.lo ?? L.entry, hi: L.hi ?? L.entry, sl: L.sl, entry: L.entry, levels, tol };
    const judged = clauses.map((c) => ({ c, j: judgeClause(c, ctx) }));
    const keep = [];
    const seen = new Set();
    for (const { j } of judged) {
      if (j.kind !== 'struct') continue;
      const key = `${j.level}|${j.tf}`;
      if (seen.has(key)) continue;
      seen.add(key);
      keep.push(j);
    }
    const dropped = judged.filter(({ j }) => ['sl', 'wrong', 'unknown'].includes(j.kind)).map(({ j }) => ({ level: j.level, kind: j.kind, why: j.why }));
    const dirWord = L.side === 'BUY' ? 'di bawah' : 'di atas';
    const parts = keep.map((j) => {
      const rel = relation(L.side, j.level, L.sl, P, j.atSl);
      return j.complete
        ? `candle ${j.tf} close ${dirWord} ${P(j.level)} (${j.basis}${rel ? `; ${rel}` : ''})`
        : `harga menembus ${P(j.level)} (${j.basis}${rel ? `; ${rel}` : ''}) — TF & kondisi candle konfirmasi belum ditentukan, tentukan manual`;
    });
    const slTxt = `SL ${P(L.sl)} = batas risiko posisi (kena SL → posisi keluar)`;
    const next = `${mm[1]}${sideName(k)}: ${slTxt}. ${parts.length ? `Invalidation struktural: ${parts.join(' | ')}.` : `${UNDEFINED_TEXT}.`}`;
    items.push({ key: k, kept: keep, dropped, undefinedInvalidation: !parts.length });
    if (next !== t) {
      out.push(next);
      notes.push(`🧭 Skenario Batal ${sideName(k)}: SL dipisah dari invalidation${dropped.length ? `; level ${dropped.map((d) => `${P(d.level)} (${d.kind === 'sl' ? 'sama dengan SL' : d.kind === 'wrong' ? 'sisi salah' : 'bukan level struktur'})`).join(', ')} tidak dipakai sebagai invalidation` : ''}${parts.length ? '' : '; tidak ada level struktur valid → belum terdefinisi'}.`);
    } else out.push(t);
  }
  // zona aktif tanpa baris Skenario Batal: tulis "belum terdefinisi" (tidak mengarang level)
  for (const [k, L] of led.entries()) {
    if (!L.active || covered.has(k)) continue;
    out.push(`- ${sideName(k)}: SL ${P(L.sl)} = batas risiko posisi (kena SL → posisi keluar). ${UNDEFINED_TEXT}.`);
    items.push({ key: k, kept: [], dropped: [], undefinedInvalidation: true, added: true });
    notes.push(`🧭 Skenario Batal ${sideName(k)}: model tidak menulis invalidation → ${UNDEFINED_TEXT.toLowerCase()}.`);
  }
  lines.splice(hs + 1, he - hs - 1, ...out);
  return { markdown: lines.join('\n'), notes, items };
}

/**
 * Kolom "Syarat Konfirmasi" Bagian 3: level "close di bawah/atas X" yang sama dengan SL diberi label "(= SL, batas risiko)"
 * supaya tidak terbaca sebagai invalidation. Level lain yang berbeda dari SL & invalidation hanya dicatat (tidak diubah).
 */
export function labelConfirmationLevels(markdown = '', { dec = 2, items = [] } = {}) {
  const lines = String(markdown).split('\n');
  const notes = [];
  const tol = Math.pow(10, -dec) + 1e-9;
  const led = ledgerOf(markdown, { dec });
  const { rows3 } = scanTables(lines);
  const RE = new RegExp(`((?:close|closing|penutupan|tertutup)[^|\\d]{0,30}?(?:di\\s*)?(?:bawah|atas)\\s*)(${NUM.source})(?!\\d|\\.\\d)(?!\\s*\\((?:=|sama)\\s*SL)`, 'gi');
  for (const r of rows3) {
    const L = led.get(`${r.side}${r.zone}`);
    if (!L || !L.active || r.idx.conf < 0 || !isActive3(r)) continue;
    const inv = (items.find((x) => x.key === `${r.side}${r.zone}`)?.kept || []).map((j) => j.level);
    const c0 = r.cells[r.idx.conf];
    let odd = null;
    const c1 = c0.replace(RE, (m, a, n) => {
      const v = toNum(n);
      if (L.sl != null && Math.abs(v - L.sl) <= tol) return `${a}${n} (= SL, batas risiko)`;
      if (!inv.some((x) => Math.abs(x - v) <= tol) && Math.abs(v - L.entry) / L.entry < 0.3) odd = v;
      return m;
    });
    if (c1 !== c0) { r.cells[r.idx.conf] = c1; writeRow(lines, r); notes.push(`🧭 Bagian 3 ${r.side} Zona ${r.zone}: level close di kolom konfirmasi sama dengan SL → diberi label "= SL, batas risiko" (bukan invalidation).`); }
    if (odd != null && inv.length) notes.push(`⚠️ Bagian 3 ${r.side} Zona ${r.zone}: syarat konfirmasi menyebut close di level ${odd.toFixed(dec)} yang berbeda dari SL ${Number(L.sl).toFixed(dec)} dan invalidation struktural (${inv.map((x) => x.toFixed(dec)).join(', ')}) — verifikasi manual.`);
  }
  return { markdown: lines.join('\n'), notes };
}
