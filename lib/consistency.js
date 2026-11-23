// Validator konsistensi server: hasil mesin SMC adalah sumber kebenaran, narasi Gemini tidak boleh menimpanya.
// Mengunci: label Searah Bias / Counter-Trend, bias per timeframe, deskripsi Level Kunci, dan Waktu Berakhir per tipe zona.
// Tanpa import alias supaya bisa diuji dengan node.
import { fmtMt4, metalsWeekendClosed } from './marketTime.js';

const H = 3600e3;
const splitRow = (line) => String(line).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSep = (line) => /^\s*\|?\s*:?-{2,}/.test(String(line)) && !/[A-Za-z0-9]/.test(String(line).replace(/[|:\-\s]/g, ''));
const clean = (t) => String(t || '').replace(/[*`]/g, '').trim();
const isRow = (l) => String(l).trim().startsWith('|');

function sideOf(name = '') {
  const t = name.toLowerCase();
  const s = t.search(/sell/), b = t.search(/buy/);
  if (s < 0 && b < 0) return null;
  return s >= 0 && (b < 0 || s < b) ? 'SELL' : 'BUY';
}

/** Iterasi tabel markdown: cb(headers, rowsInfo) dengan rowsInfo = [{ idx, cells }]; cells boleh diubah lalu dipanggil save(). */
function eachTable(lines, cb) {
  for (let i = 0; i < lines.length - 1; i++) {
    if (!isRow(lines[i]) || !isSep(lines[i + 1])) continue;
    const headers = splitRow(lines[i]).map((h) => h.toLowerCase());
    let j = i + 2;
    const rows = [];
    for (; j < lines.length && isRow(lines[j]); j++) rows.push({ idx: j, cells: splitRow(lines[j]) });
    cb(headers, rows, (r) => { lines[r.idx] = `| ${r.cells.join(' | ')} |`; });
    i = j - 1;
  }
}

/** Bias yang dipakai laporan: bias headline bila searah dengan mesin (H4, cadangan H1); bila berlawanan, mesin menang. */
export function resolveBias(headline = '', engineBias = '') {
  const eng = /BULL/i.test(engineBias) ? 'BULLISH' : /BEAR/i.test(engineBias) ? 'BEARISH' : null;
  const h = String(headline).toUpperCase();
  const head = /BEARISH|\bSELL\b/.test(h) && !/BULLISH/.test(h) ? 'BEARISH' : /BULLISH|\bBUY\b/.test(h) && !/BEARISH/.test(h) ? 'BULLISH' : null;
  if (head && eng && head !== eng) return { bias: eng, overridden: true, headline: head };
  return { bias: head || eng || 'NETRAL', overridden: false, headline: head };
}

/** Samakan baris "BIAS UTAMA:" dengan bias yang diputuskan server. */
export function syncHeadlineBias(markdown, bias) {
  if (bias !== 'BULLISH' && bias !== 'BEARISH') return markdown;
  const txt = bias === 'BULLISH' ? 'BULLISH - FOKUS BUY' : 'BEARISH - FOKUS SELL';
  return String(markdown).replace(/(BIAS\s*UTAMA\s*[:：]\s*\**\s*)[^\n*]+/i, `$1${txt}`);
}

const LABEL_RE = /\s*\((?:Searah\s*Bias|Counter[- ]?Trend[^)]*|Netral[^)]*)\)/gi;
export const LABEL_WITH = '(Searah Bias)';
export const LABEL_COUNTER = '(Counter-Trend - Wajib Konfirmasi Ekstra)';
export const LABEL_NEUTRAL = '(Netral - Tunggu Konfirmasi)';

/** Label arah-vs-bias pada kolom strategi Bagian 3 ditentukan server, bukan Gemini. */
export function syncBiasLabels(markdown, bias) {
  const lines = String(markdown).split('\n');
  const notes = [];
  let changed = 0;
  eachTable(lines, (h, rows, save) => {
    if (!/zona/.test(h[0] || '') || !/strategi/.test(h[0] || '')) return;
    for (const r of rows) {
      const name = r.cells[0] || '';
      const side = sideOf(clean(name));
      if (!side) continue;
      const empty = /tidak ada level valid|tunggu/i.test(r.cells[1] || '');
      const hasLabel = new RegExp(LABEL_RE.source, 'i').test(name);
      if (empty && !hasLabel) continue;
      const want = bias !== 'BULLISH' && bias !== 'BEARISH' ? LABEL_NEUTRAL
        : (bias === 'BULLISH') === (side === 'BUY') ? LABEL_WITH : LABEL_COUNTER;
      const stars = (name.match(/\*+$/) || [''])[0];
      const base = name.replace(/\*+$/, '').replace(LABEL_RE, '').trimEnd();
      const next = `${base} ${want}${stars}`;
      if (next !== name) { r.cells[0] = next; save(r); changed++; }
    }
  });
  if (changed) notes.push(`🧭 ${changed} label Searah Bias / Counter-Trend di Bagian 3 disamakan dengan bias ${bias} dari mesin SMC.`);
  return { markdown: lines.join('\n'), notes, changed };
}

const dirWord = (t = '') => {
  const m = String(t).toLowerCase().match(/^\W*(bullish|bearish|sideways|netral|neutral|range|konsolidasi)/);
  return m ? m[1] : null;
};

/** Kolom "Struktur/Trend" per timeframe (Bagian 2) memakai bias mesin; Gemini tidak boleh menulis arah yang bertentangan. */
export function syncTfBias(markdown, analyses = []) {
  const lines = String(markdown).split('\n');
  const byTf = new Map((analyses || []).filter((a) => a.status === 'OK').map((a) => [a.timeframe, a]));
  const notes = [];
  const fixed = [];
  eachTable(lines, (h, rows, save) => {
    const cT = h.findIndex((x) => /struktur|trend/.test(x));
    if (!/timeframe/.test(h[0] || '') || cT < 0) return;
    for (const r of rows) {
      const tf = clean(r.cells[0]).toUpperCase();
      const a = byTf.get(tf);
      if (!a || cT >= r.cells.length || !/^(BULLISH|BEARISH)$/.test(a.bias)) continue;
      const lead = dirWord(clean(r.cells[cT]));
      const eng = a.bias.toLowerCase();
      if (lead === eng) continue;
      const word = eng === 'bullish' ? 'Bullish' : 'Bearish';
      r.cells[cT] = a.liveNote ? `${word} (harga live menembus swing; menunggu close candle)` : word;
      save(r);
      fixed.push(`${tf} ${lead ? lead[0].toUpperCase() + lead.slice(1) : 'tanpa arah'} → ${word}`);
    }
  });
  if (fixed.length) notes.push(`🧭 Bias timeframe Bagian 2 disamakan dengan mesin SMC: ${fixed.join(', ')}.`);
  return { markdown: lines.join('\n'), notes, fixed: fixed.length };
}

// Deskripsi level dari mesin: BOS/CHoCH, tepi OB/FVG fresh, swing. Dipakai agar label "(Low mingguan)" karangan Gemini tidak salah memberi nama.
export function describeLevel(a, price, tol) {
  const hit = (v) => Math.abs(v - price) <= tol;
  const ev = [...(a.structureEvents || [])].reverse().find((e) => hit(e.level));
  if (ev) return `${ev.type} ${ev.direction === 'BULLISH' ? 'Bullish' : 'Bearish'} ${a.timeframe}`;
  for (const z of a.zones || []) {
    if (hit(z.low) || hit(z.high)) return `${z.source === 'FVG' ? 'FVG' : 'OB'} ${z.type === 'BULLISH' ? 'Bullish' : 'Bearish'} ${a.timeframe} fresh, tepi ${hit(z.low) ? 'bawah' : 'atas'}`;
  }
  const sw = (a.swings || []).find((x) => hit(x.price));
  if (sw) return `Swing ${sw.type === 'H' ? 'High' : 'Low'} ${a.timeframe}`;
  if ((a.supports || []).some((x) => hit(x.price))) return `Swing Low utuh ${a.timeframe}`;
  if ((a.resistances || []).some((x) => hit(x.price))) return `Swing High utuh ${a.timeframe}`;
  return null;
}

const levelsOf = (a) => [...(a.structureEvents || []).map((e) => e.level), ...(a.swings || []).map((x) => x.price), ...(a.zones || []).flatMap((z) => [z.low, z.high]), ...(a.supports || []).map((x) => x.price), ...(a.resistances || []).map((x) => x.price)].filter((v) => v > 0);

/** Level Kunci Bagian 2: nama level ("(Low mingguan)") diganti deskripsi dari mesin; D1 (tanpa data mesin) tidak boleh berisi harga berjalan. */
export function syncLevelLabels(markdown, analyses = [], price = 0) {
  const lines = String(markdown).split('\n');
  const byTf = new Map((analyses || []).filter((a) => a.status === 'OK').map((a) => [a.timeframe, a]));
  const ref = price || [...byTf.values()][0]?.lastPrice || 0;
  const tol = ref * 0.0004;
  const notes = [];
  let relabeled = 0, blanked = 0, unverified = 0;
  const allLevels = [...byTf.values()].flatMap((a) => [...(a.structureEvents || []).map((e) => e.level), ...(a.swings || []).map((x) => x.price), ...(a.zones || []).flatMap((z) => [z.low, z.high]), ...(a.supports || []).map((x) => x.price), ...(a.resistances || []).map((x) => x.price)]).filter((v) => v > 0);
  const isLevel = (a, n) => ((a ? levelsOf(a) : allLevels).some((v) => Math.abs(v - n) <= tol));
  eachTable(lines, (h, rows, save) => {
    const cL = h.findIndex((x) => /level kunci/.test(x));
    if (!/timeframe/.test(h[0] || '') || cL < 0 || !ref) return;
    for (const r of rows) {
      if (cL >= r.cells.length) continue;
      const tf = clean(r.cells[0]).toUpperCase();
      const a = byTf.get(tf);
      const cell = r.cells[cL];
      // Angka harus cocok dengan level mesin (BOS/CHoCH, swing, tepi OB/FVG); bila tidak, ditandai tidak terverifikasi
      const markUnverified = (txt) => {
        if (/tidak terverifikasi/i.test(txt)) return txt;
        let hit = false;
        const out = txt.replace(/(?<![A-Za-z0-9.,])(\$?\s*)(\d[\d,]*(?:\.\d+)?)(\s*\([^)]*\))?/g, (all, pre, num, lab) => {
          const n = parseFloat(num.replace(/,/g, ''));
          if (!(n > ref * 0.2 && n < ref * 2) || isLevel(a, n)) return all;
          hit = true;
          return `${pre}${num}${lab || ''} (tidak terverifikasi mesin)`;
        });
        return hit ? out : txt;
      };
      let next = cell;
      if (!a) {
        const nums = (cell.replace(/,/g, '').match(/(?<![A-Za-z0-9.])\d+(?:\.\d+)?/g) || []).map(parseFloat).filter((n) => n > ref * 0.5 && n < ref * 1.5);
        if (nums.length && nums.every((n) => Math.abs(n - ref) <= tol * 2) && /harga|saat ini|terakhir|close/i.test(cell)) {
          r.cells[cL] = '— (TF ini tidak dihitung mesin SMC)';
          save(r);
          blanked++;
          continue;
        }
      } else {
        next = cell.replace(/(\$?\s*)(\d[\d,]*(?:\.\d+)?)(\s*)\(([^)]*)\)/g, (all, pre, num, sp, label) => {
          const n = parseFloat(num.replace(/,/g, ''));
          if (!(n > ref * 0.2 && n < ref * 2)) return all;
          const d = describeLevel(a, n, Math.max(tol, 1e-9));
          if (!d || label.trim().toLowerCase() === d.toLowerCase()) return all;
          return `${pre}${num}${sp}(${d})`;
        });
        if (next !== cell) relabeled++;
      }
      const marked = markUnverified(next);
      if (marked !== next) unverified++;
      if (marked !== cell) { r.cells[cL] = marked; save(r); }
    }
  });
  if (relabeled) notes.push(`🧭 ${relabeled} nama Level Kunci Bagian 2 diganti deskripsi dari mesin SMC (BOS/CHoCH/OB/FVG/swing).`);
  if (blanked) notes.push(`🧭 ${blanked} Level Kunci berisi harga berjalan (bukan level struktur) dikosongkan.`);
  if (unverified) notes.push(`🧭 ${unverified} Level Kunci tidak cocok dengan BOS/CHoCH/swing/OB/FVG mesin: ditandai tidak terverifikasi.`);
  return { markdown: lines.join('\n'), notes, relabeled, blanked, unverified };
}

const parseWIB = (text = '') => {
  const M = { jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6, agu: 7, agt: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11 };
  const m = String(text).match(/(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})[,\s]+(\d{1,2})[.:](\d{2})/);
  if (!m) return null;
  const mon = M[m[2].slice(0, 3).toLowerCase()];
  return mon == null ? null : Date.UTC(Number(m[3]), mon, Number(m[1]), Number(m[4]) - 7, Number(m[5]));
};
const hhmm = (ts) => { const d = new Date(ts + 7 * H); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
// Jendela wajar sejak sekarang (jam): Scalping 1-2 jam, Intraday 4-6 jam (diberi toleransi); default bila tak ada yang wajar.
const WINDOW = { Scalping: { lo: 0.5, hi: 2.5, def: 2 }, Intraday: { lo: 3, hi: 7, def: 6 } };
const kindOf = (name = '') => (/scalp/i.test(name) ? 'Scalping' : /intraday/i.test(name) ? 'Intraday' : /swing/i.test(name) ? 'Swing' : null);

/**
 * Waktu Berakhir 4B konsisten per tipe zona (semua baris Scalping sama, semua Intraday sama) dan baris
 * "Masa Berlaku Sinyal" memakai jam yang sama. Swing = Daily Close (ditangani fixDailyClose), hanya diselaraskan ke ringkasan.
 * Saat pasar tutup akhir pekan dibiarkan untuk fixWeekendExpiry.
 */
export function syncExpiry(markdown, now = new Date(), pair = null) {
  const out = { markdown, notes: [], changed: 0 };
  if (pair && !pair.open24x7 && metalsWeekendClosed(now.getTime())) return out;
  const lines = String(markdown).split('\n');
  const rowsByKind = { Scalping: [], Intraday: [], Swing: [] };
  eachTable(lines, (h, rows, save) => {
    const cE = h.findIndex((x) => /berakhir|expir|kedaluwarsa/.test(x));
    if (cE < 0 || !/^order$/.test(h[0] || '') || !h.some((x) => /risiko/.test(x))) return;
    for (const r of rows) {
      if (/terpasang|tidak ada setup|tunggu|tidak dipasang/i.test(r.cells[1] || '')) continue;
      const k = kindOf(r.cells[0]);
      const ts = parseWIB(r.cells[cE]);
      if (!k || ts == null || cE >= r.cells.length) continue;
      rowsByKind[k].push({ r, cE, ts, save });
    }
  });
  const target = {};
  for (const k of ['Scalping', 'Intraday']) {
    const list = rowsByKind[k];
    if (!list.length) continue;
    const w = WINDOW[k];
    const ok = list.filter((x) => x.ts >= now.getTime() + w.lo * H && x.ts <= now.getTime() + w.hi * H);
    const freq = new Map();
    for (const x of ok) freq.set(x.ts, (freq.get(x.ts) || 0) + 1);
    const best = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    target[k] = best ?? Math.round((now.getTime() + w.def * H) / 60e3) * 60e3;
  }
  if (rowsByKind.Swing.length) target.Swing = [...rowsByKind.Swing].sort((a, b) => a.ts - b.ts)[0].ts;
  for (const k of Object.keys(rowsByKind)) {
    if (k === 'Swing' || target[k] == null) continue;
    for (const x of rowsByKind[k]) {
      if (x.ts === target[k]) continue;
      x.r.cells[x.cE] = `${fmtMt4(target[k], 7)} WIB`;
      x.save(x.r);
      out.changed++;
    }
  }
  // Ringkasan Cepat "Masa Berlaku Sinyal": jam tiap zona = jam di 4B
  let summaryFixed = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/Masa Berlaku Sinyal/i.test(lines[i])) continue;
    const head = lines[i].match(/^(.*?Masa Berlaku Sinyal\s*:?\s*)(.*)$/i);
    if (!head) break;
    const segs = head[2].split(';').map((s) => {
      const k = /zona\s*1|scalp/i.test(s) ? 'Scalping' : /zona\s*2|intraday/i.test(s) ? 'Intraday' : /zona\s*3|swing/i.test(s) ? 'Swing' : null;
      if (!k || target[k] == null) return s;
      const want = hhmm(target[k]);
      return s.replace(/(\d{1,2})[:.](\d{2})(\s*WIB)/i, (all, hh, mm, w) => {
        if (`${hh.padStart(2, '0')}:${mm}` === want) return all;
        summaryFixed++;
        return `${want}${w}`;
      });
    });
    lines[i] = head[1] + segs.join(';');
    break;
  }
  if (out.changed || summaryFixed) out.notes.push(`🕓 Waktu Berakhir disamakan per tipe zona (${out.changed} baris 4B, ${summaryFixed} jam di Ringkasan) agar Scalping/Intraday konsisten.`);
  out.markdown = lines.join('\n');
  return out;
}
