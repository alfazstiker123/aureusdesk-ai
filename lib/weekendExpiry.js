// Saat pasar (forex/emas) tutup akhir pekan, "Waktu Berakhir" yang dihitung dari jam sekarang jatuh SEBELUM pasar buka
// sehingga semua pending order kedaluwarsa sebelum sempat dipakai. Server menggeser ke jam buka berikutnya:
// Scalping = buka + 2 jam, Intraday = buka + 6 jam, Swing = Daily Close (17:00 New York) setelah buka.
// Tanpa import alias supaya bisa diuji dengan node.
import { metalsWeekendClosed, nextMetalsOpenSec, nyOffsetHours, fmtMt4 } from './marketTime.js';

const H = 3600e3;
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6, agu: 7, agt: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11 };
const splitRow = (line) => String(line).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

function parseWIB(text = '') {
  const m = String(text).match(/(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})[,\s]+(\d{1,2})[.:](\d{2})/);
  if (!m) return null;
  const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
  return mon == null ? null : Date.UTC(Number(m[3]), mon, Number(m[1]), Number(m[4]) - 7, Number(m[5]));
}

/** Daily Close (17:00 New York) pertama setelah `ts` (ms UTC). */
export function dailyCloseAfter(ts) {
  const off = nyOffsetHours(new Date(ts));
  const ny = new Date(ts + off * H);
  let target = Date.UTC(ny.getUTCFullYear(), ny.getUTCMonth(), ny.getUTCDate(), 17) - off * H;
  if (target <= ts) target += 24 * H;
  return target;
}

/** Jam buka berikutnya (ms UTC): forex Minggu 17:00 NY; emas/perak (CME) 18:00 NY. Pair tak dikenal -> forex. */
export function nextOpenMs(pair, nowMs = Date.now()) {
  const metal = pair?.group === 'gold' || pair?.group === 'silver';
  return nextMetalsOpenSec(Math.floor(nowMs / 1000)) * 1000 - (metal ? 0 : H);
}

export function fixWeekendExpiry(markdown = '', now = new Date(), pair = null) {
  const out = { markdown, notes: [], changed: 0 };
  if (!pair || pair.open24x7 || !metalsWeekendClosed(now.getTime())) return out;
  const open = nextOpenMs(pair, now.getTime());
  const lines = String(markdown).split('\n');
  const times = {};
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSep(lines[i + 1])) continue;
    const headers = splitRow(lines[i]).map((h) => h.toLowerCase());
    const cExp = headers.findIndex((h) => /berakhir|expir|kedaluwarsa/.test(h));
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      if (cExp < 0 || !/^order$/.test(headers[0] || '') || !headers.some((h) => /risiko/.test(h))) continue;
      const cells = splitRow(lines[j]);
      if (cExp >= cells.length || /terpasang|tidak ada setup|tunggu/i.test(cells[1] || '')) continue;
      const ts = parseWIB(cells[cExp]);
      if (ts == null) continue; // kosong/tak terbaca ditangani validator lain
      const name = cells[0] || '';
      let kind = null; let target = null;
      if (/scalp/i.test(name)) { kind = 'Scalping'; target = open + 2 * H; }
      else if (/intraday/i.test(name)) { kind = 'Intraday'; target = open + 6 * H; }
      else if (/swing/i.test(name)) { kind = 'Swing'; target = dailyCloseAfter(open + 1 * H); }
      if (target == null) continue;
      if (ts >= open) { times[kind] = ts; continue; } // sudah setelah buka: dibiarkan, tapi dipakai untuk baris ringkasan
      cells[cExp] = `${fmtMt4(target, 7)} WIB`;
      lines[j] = `| ${cells.join(' | ')} |`;
      times[kind] = target;
      out.changed++;
    }
    i = j - 1;
  }
  if (!Object.keys(times).length) return out;
  const w = (t) => `${fmtMt4(t, 7)} WIB`;
  const parts = ['Scalping', 'Intraday', 'Swing'].filter((k) => times[k]).map((k) => `${k} hingga ${w(times[k])}`);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*>\s*-\s*⏳\s*Masa Berlaku Sinyal:/.test(lines[i])) {
      lines[i] = `> - ⏳ Masa Berlaku Sinyal: MAPPING AKHIR PEKAN — pasang order setelah pasar buka ${w(open)}; ${parts.join('; ')}.`;
      break;
    }
  }
  out.markdown = lines.join('\n');
  if (!out.changed) return out;
  out.notes.push(`${out.changed} Waktu Berakhir digeser ke sesi buka berikutnya (${w(open)}) karena pasar sedang tutup.`);
  return out;
}
