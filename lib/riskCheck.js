// Verifikasi otomatis tabel Pending Order hasil AI.
// Multi-pair: Risiko ($) = Lot x Jarak_SL x pengali pair (XAU 100, XAG 5000, major 100000, JPY 100000/USDJPY, BTC 1)
// Juga: arah SL/TP, R:R dihitung ulang, batas risiko total per arah, jam server MT4 pada Waktu Berakhir.
// Jarak_SL = |Entry - SL| (selisih harga).  Angka yang salah dikoreksi agar tidak ada risiko "karangan".
import { PAIRS, riskMult } from '@/lib/pairs';
import { dailyCloseWIB, isPastWeekendCutoff, mt4ServerOffset, fmtMt4, weekendCutoffWIB } from '@/lib/marketTime';

const money = (n) => `$${n.toFixed(2)}`;

export function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

export const isSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

// Ambil angka harga pertama dari sel, sesuai pola harga pair
function firstPrice(cell = '', re) {
  const m = cell.replace(/,/g, '').match(re);
  return m ? parseFloat(m[0]) : null;
}
const MIN_RR_TP1 = 1.5; // standar minimal R:R ke TP1 (R:R 2.0/2.5 di Bagian 3 mengacu ke TP2, bukan kolom TP 4B)
function firstNumber(cell = '') {
  const m = cell.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function findCol(headers, test, exclude) {
  return headers.findIndex((h) => test.test(h) && !(exclude && exclude.test(h)));
}


// Kelengkapan dua arah x dua zona: Bagian 3 (setup) dan 4B (order baru) harus punya Buy/Sell x Zona 1/2.
function checkCoverage(lines, zones = 2) {
  const missing = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSeparator(lines[i + 1])) continue;
    const headers = splitRow(lines[i]).map((h) => h.toLowerCase());
    const h0 = headers[0] || '';
    let label = null;
    if (/zona.*strategi/.test(h0)) label = 'Bagian 3';
    else if (/^order$/.test(h0) && headers.some((h) => /lot/.test(h)) && headers.some((h) => /risiko/.test(h))) label = 'Bagian 4B';
    let j = i + 2;
    const rows = [];
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push(splitRow(lines[j])[0] || '');
    if (label) {
      const have = new Set();
      for (const r of rows) {
        const t = r.toLowerCase();
        const d = t.search(/sell/) >= 0 && (t.search(/buy/) < 0 || t.search(/sell/) < t.search(/buy/)) ? 'SELL' : t.search(/buy/) >= 0 ? 'BUY' : null;
        const z = /zona\s*1/.test(t) ? 1 : /zona\s*2/.test(t) ? 2 : /zona\s*3/.test(t) ? 3 : null;
        if (d && z) have.add(`${d} Zona ${z}`);
      }
      const need = ['BUY', 'SELL'].flatMap((d) => Array.from({ length: zones }, (_, i) => `${d} Zona ${i + 1}`)).filter((k) => !have.has(k));
      if (need.length) missing.push(`⚠️ ${label}: baris wajib belum lengkap (${need.join(', ')}) - minta generate ulang atau cek manual.`);
    }
    i = j - 1;
  }
  return missing;
}

// Waktu Berakhir (WIB) pada 4B: harus terisi, belum lewat, dan tidak melewati penutupan pasar Jumat.
const MONTHS_ID = { jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6, agu: 7, agt: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11 };
export function parseExpiryWIB(text = '') {
  const m = String(text).match(/(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})[,\s]+(\d{1,2})[.:](\d{2})/);
  if (!m) return null;
  const mon = MONTHS_ID[m[2].slice(0, 3).toLowerCase()];
  if (mon == null) return null;
  return Date.UTC(Number(m[3]), mon, Number(m[1]), Number(m[4]) - 7, Number(m[5])); // WIB = UTC+7
}

function checkExpiry(lines, now, pair) {
  const notes = [];
  const off = mt4ServerOffset(now);
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSeparator(lines[i + 1])) continue;
    const headers = splitRow(lines[i]).map((h) => h.toLowerCase());
    const cExp = headers.findIndex((h) => /berakhir|expir|kedaluwarsa/.test(h));
    const isNewOrders = /^order$/.test(headers[0] || '') && headers.some((h) => /risiko/.test(h));
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      if (!isNewOrders) continue;
      const cells = splitRow(lines[j]);
      const name = (cells[0] || '').replace(/\*/g, '').trim();
      if (/terpasang|tidak ada setup|tunggu/i.test(cells[1] || '')) continue; // sudah ada di 4A / tanpa setup
      if (cExp < 0) continue;
      const raw = cells[cExp] || '';
      const ts = parseExpiryWIB(raw);
      if (ts == null) {
        notes.push(`⚠️ ${name}: Waktu Berakhir belum terbaca/kosong - isi manual di MT4.`);
        continue;
      }
      if (ts <= now.getTime()) {
        notes.push(`⚠️ ${name}: Waktu Berakhir (${raw.trim()}) sudah lewat dari sekarang - jangan dipakai.`);
        continue;
      }
      if (!pair?.open24x7 && isPastWeekendCutoff(ts)) {
        notes.push(`⚠️ ${name}: Waktu Berakhir (${raw.trim()}) melewati batas akhir pekan - maksimal Sabtu ${weekendCutoffWIB(new Date(ts)).replace(':', '.')} WIB.`);
      }
      // MT4 memakai jam server broker, bukan WIB -> tampilkan padanannya
      if (!/server/i.test(raw)) {
        cells[cExp] = `${raw.trim()} (MT4 server GMT${off >= 0 ? '+' : ''}${off}: ${fmtMt4(ts, off)})`;
        lines[j] = `| ${cells.join(' | ')} |`;
      }
    }
    i = j - 1;
  }
  return notes;
}

const sideOfName = (name = '') => {
  const t = name.toLowerCase();
  const a = t.search(/sell/);
  const b = t.search(/buy/);
  if (a < 0 && b < 0) return null;
  return a >= 0 && (b < 0 || a < b) ? 'SELL' : 'BUY';
};
const lotFloor = (x) => Math.max(0.01, Math.floor(x * 100 + 1e-9) / 100);

/**
 * @param {object} opts  { last: harga terakhir, fx: { usdjpy }, capPerDirection: true }
 *   capPerDirection: total risiko order BARU satu arah (BUY Z1 + BUY Z2, atau SELL Z1 + SELL Z2) <= batas risiko,
 *   karena kedua zona satu arah bisa sama-sama terisi dalam satu pergerakan.
 * @returns {{markdown:string, notes:string[], fixes:string[], tablesChecked:number, totals:object}}
 */
export function verifyRiskTables(markdown = '', maxRiskUsd = 0, pair = PAIRS.XAUUSD, now = new Date(), opts = {}) {
  const { last = null, fx = {}, capPerDirection = true, zones = 2 } = opts;
  const RM = riskMult(pair, last, fx);
  const MULT = RM.mult;
  const multTxt = RM.text;
  const fmt = (n) => Number(n).toFixed(pair.dec);
  const lines = markdown.split('\n');
  const notes = [];
  const fixes = [];
  let tablesChecked = 0;
  const fresh = []; // order baru untuk batas risiko per arah
  if (RM.approx) notes.push(`ℹ️ ${pair.id}: risiko dikonversi JPY→USD dengan kurs USDJPY perkiraan (${multTxt}). Set env USDJPY_RATE untuk kurs terbaru.`);

  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSeparator(lines[i + 1])) continue;

    const headers = splitRow(lines[i]).map((h) => h.toLowerCase());
    // Entry: "Harga Entry" (tabel order) atau "Harga" (tabel audit order terpasang)
    let cEntry = findCol(headers, /entry/, /zona/);
    if (cEntry < 0) cEntry = findCol(headers, /^harga\b/, /terakhir|zona|jarak/);
    const cSl = findCol(headers, /stop loss|^sl\b/, /jarak/);
    const cTp = findCol(headers, /take profit|^tp\b/, /tp2|profit 2/);
    // Hanya kolom "Jarak SL"; "Jarak dari Harga Terakhir" (tabel audit) BUKAN jarak SL
    const cJarak = findCol(headers, /jarak.*sl|sl.*jarak/);
    const auditTable = cJarak < 0 || /terpasang/.test(headers[0] || '');
    const cLot = findCol(headers, /\blot\b/);
    const cRisk = findCol(headers, /risiko/);
    const cRR = findCol(headers, /^r\s*[:/]\s*r$|risk.?reward|\brr\b/);
    const cName = 0;

    let j = i + 2;
    const isTarget = cLot >= 0 && cRisk >= 0 && cSl >= 0 && cEntry >= 0;
    if (!isTarget) {
      i = j - 1;
      continue;
    }
    tablesChecked++;

    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const cells = splitRow(lines[j]);
      if (cells.length <= Math.max(cLot, cRisk, cSl, cEntry, cJarak)) continue;
      const name = (cells[cName] || 'Order').replace(/\*+/g, '').trim();

      // Garis harga berjalan (Bid/Ask) bukan order
      if (/\b(bid|ask)\b|harga (berjalan|terakhir|saat ini)|current price/i.test(name) && !/limit|stop/i.test(name)) continue;

      let lot = firstNumber(cells[cLot]);
      let dist = auditTable || cJarak < 0 ? null : firstNumber(cells[cJarak]);
      const entry = cEntry >= 0 ? firstPrice(cells[cEntry], pair.priceRe) : null;
      const sl = cSl >= 0 ? firstPrice(cells[cSl], pair.priceRe) : null;
      const tp = cTp >= 0 ? firstPrice(cells[cTp], pair.priceRe) : null;
      const side = sideOfName(name);
      let dirBad = false;
      if (lot == null) continue; // mis. "Sudah terpasang - lihat 4A"
      if (lot === 0 && !auditTable && entry != null && sl != null) { // model menulis lot 0.00 untuk order nyata
        lot = 0.01;
        cells[cLot] = '0.01';
        notes.push(`${name}: Lot 0.00 tidak valid untuk order nyata → diset 0.01 (lalu dicek terhadap batas risiko).`);
      }

      // 0) Arah SL/TP: BUY -> SL di bawah entry, TP di atas; SELL -> kebalikannya
      if (side && entry != null) {
        const slBad = sl != null && (side === 'BUY' ? sl >= entry : sl <= entry);
        const tpBad = tp != null && (side === 'BUY' ? tp <= entry : tp >= entry);
        if (slBad || tpBad) {
          const what = [
            slBad && `SL ${fmt(sl)} harus ${side === 'BUY' ? 'DI BAWAH' : 'DI ATAS'} entry ${fmt(entry)}`,
            tpBad && `TP ${fmt(tp)} harus ${side === 'BUY' ? 'DI ATAS' : 'DI BAWAH'} entry ${fmt(entry)}`,
          ].filter(Boolean).join('; ');
          notes.push(`🚫 ${name}: ARAH SL/TP SALAH — ${what}. ${auditTable ? 'Perbaiki order di MT4.' : 'JANGAN dipasang sebelum diperbaiki.'}`);
          if (!auditTable) {
            dirBad = true;
            fixes.push(`${name}: ${what}.`);
            cells[0] = `🚫 ${cells[0]} (SL/TP salah arah)`;
          }
        }
      }

      // 1) Jarak SL harus = |Entry - SL|
      if (entry != null && sl != null) {
        const real = Math.abs(entry - sl);
        const tol = Math.pow(10, -pair.dec) * 1.5;
        if (auditTable) {
          dist = real; // order terpasang: hanya hitung ulang, tidak mengubah lot user
          if (cJarak >= 0) cells[cJarak] = fmt(real);
        } else if (dist == null || Math.abs(real - dist) > tol) {
          notes.push(`${name}: Jarak SL dikoreksi ${dist == null ? '-' : fmt(dist)} -> ${fmt(real)} (|${fmt(entry)} - ${fmt(sl)}|)`);
          dist = real;
          cells[cJarak] = fmt(real);
        }
      } else if (auditTable && sl == null) {
        notes.push(`⚠️ ${name}: order terpasang TANPA Stop Loss terbaca - risiko tidak terbatas.`);
        continue;
      }
      if (dist == null || dist <= 0) continue;

      // 2) R:R = |TP - Entry| / |Entry - SL|
      if (cRR >= 0 && entry != null && tp != null) {
        const rr = Math.abs(tp - entry) / dist;
        const m = String(cells[cRR] || '').replace(/,/g, '.').match(/(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/);
        const shownRR = m ? Number(m[2]) / Number(m[1]) : firstNumber(cells[cRR]);
        if (shownRR == null || Math.abs(shownRR - rr) > 0.1) {
          notes.push(`${name}: R:R dikoreksi ${cells[cRR] || '-'} -> 1:${rr.toFixed(2)}`);
        }
        cells[cRR] = `1:${rr.toFixed(2)}`;
        if (!auditTable && rr < 1) notes.push(`⚠️ ${name}: R:R hanya 1:${rr.toFixed(2)} (< 1:1) — tidak layak kecuali winrate sangat tinggi.`);
        else if (!auditTable && rr < MIN_RR_TP1 - 0.005) notes.push(`⚠️ ${name}: R:R TP1 1:${rr.toFixed(2)} di bawah standar 1:${MIN_RR_TP1.toFixed(1)}.`);
      }

      // 3) Lot tidak boleh membuat risiko melebihi batas user (hanya order baru)
      if (!auditTable && maxRiskUsd > 0 && lot * dist * MULT > maxRiskUsd + 0.005) {
        const safe = lotFloor(maxRiskUsd / (dist * MULT));
        if (safe < lot) {
          notes.push(`${name}: Lot diturunkan ${lot.toFixed(2)} -> ${safe.toFixed(2)} agar risiko <= ${money(maxRiskUsd)}`);
          lot = safe;
          cells[cLot] = lot.toFixed(2);
        }
      }

      // 4) Risiko = Lot x Jarak x pengali
      const risk = lot * dist * MULT;
      const shown = firstNumber(cells[cRisk]);
      if (shown == null || Math.abs(shown - risk) > 0.02) {
        notes.push(`${name}: Risiko dikoreksi ${shown == null ? '-' : money(shown)} -> ${money(risk)} (${lot.toFixed(2)} x ${fmt(dist)} x ${multTxt})`);
      }
      cells[cRisk] = money(risk);
      if (maxRiskUsd > 0 && risk > maxRiskUsd + 0.005) {
        notes.push(
          auditTable
            ? `⚠️ ${name}: risiko order terpasang ${money(risk)} melebihi batas ${money(maxRiskUsd)}.`
            : `⚠️ ${name}: lot minimum 0.01 pun berisiko ${money(risk)} (> batas ${money(maxRiskUsd)}). Perkecil jarak SL.`
        );
      }

      lines[j] = `| ${cells.join(' | ')} |`;
      if (!auditTable && side && !dirBad) fresh.push({ j, name, side, lot, dist, cells, cLot, cRisk });
    }
    i = j - 1;
  }

  // 5) Batas risiko total per arah (Zona 1 + Zona 2 satu arah bisa terisi bersamaan)
  const totals = { BUY: 0, SELL: 0 };
  for (const side of ['BUY', 'SELL']) {
    const list = fresh.filter((f) => f.side === side);
    let sum = list.reduce((s, f) => s + f.lot * f.dist * MULT, 0);
    if (capPerDirection && maxRiskUsd > 0 && list.length > 1 && sum > maxRiskUsd + 0.005) {
      const k = maxRiskUsd / sum;
      for (const f of list) {
        const nl = lotFloor(f.lot * k);
        if (nl < f.lot) {
          f.lot = nl;
          f.cells[f.cLot] = nl.toFixed(2);
          f.cells[f.cRisk] = money(nl * f.dist * MULT);
          lines[f.j] = `| ${f.cells.join(' | ')} |`;
        }
      }
      const before = sum;
      sum = list.reduce((s, f) => s + f.lot * f.dist * MULT, 0);
      notes.push(
        sum > maxRiskUsd + 0.005
          ? `⚠️ Total risiko ${side} (${list.length} order) ${money(sum)} masih > batas ${money(maxRiskUsd)} karena lot minimum 0.01 — pasang satu zona saja.`
          : `Total risiko ${side} ${money(before)} > batas ${money(maxRiskUsd)} → lot semua order ${side} diperkecil proporsional, total sekarang ${money(sum)}.`
      );
    }
    totals[side] = sum;
  }
  // 5b) Samakan baris "Rincian Hitung Risiko" dengan angka tabel yang sudah dikoreksi
  if (fresh.length) {
    const norm = (t) => String(t).replace(/[*`🚫]/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const byName = new Map(fresh.map((f) => [norm(f.name), f]));
    let inDetail = false;
    for (let k = 0; k < lines.length; k++) {
      const t = lines[k];
      if (/rincian hitung risiko/i.test(t)) { inDetail = true; continue; }
      if (!inDetail) continue;
      if (/^\s*#{1,6}\s/.test(t) || /^\s*\|/.test(t)) { inDetail = false; continue; }
      const m = t.match(/^(\s*[-*]\s+)(.+?):\s*[\d.]+\s*(?:lot)?\s*[x×*]\s*[\d.,]+\s*[x×*]\s*[\d.]+\s*=\s*\$?[\d.,]+/i);
      if (!m) continue;
      const f = byName.get(norm(m[2]));
      if (!f) continue;
      const rest = t.slice(m[0].length).replace(/\s*\((?:Lot di bawah minimum|[^)]*risiko nihil)[^)]*\)/i, '');
      lines[k] = `${m[1]}${m[2]}: ${f.lot.toFixed(2)} lot x ${fmt(f.dist)} x ${multTxt} = ${money(f.lot * f.dist * MULT)}${rest}`;
    }
  }
  if (fresh.length) {
    notes.push(
      `ℹ️ Total risiko bila semua order baru terisi: BUY ${money(totals.BUY)} + SELL ${money(totals.SELL)} = ${money(totals.BUY + totals.SELL)}` +
        (capPerDirection ? ` (batas ${money(maxRiskUsd)} per arah).` : '.')
    );
  }

  notes.push(...checkCoverage(lines, zones));
  notes.push(...checkExpiry(lines, now, pair));

  let out = markdown;
  if (tablesChecked || notes.length) {
    out = lines.join('\n');
    const head = notes.length
      ? `> 🧮 **Verifikasi risiko otomatis** (${pair.id}: Risiko = Lot × Jarak SL × ${multTxt}) catatan:\n${notes.map((n) => `> - ${n}`).join('\n')}`
      : `> 🧮 **Verifikasi risiko otomatis:** semua angka Risiko ($) sudah sesuai rumus ${pair.id}: Lot × Jarak SL × ${multTxt}.`;
    out = `${out.trimEnd()}\n\n${head}\n`;
  }
  return { markdown: out, notes, fixes, tablesChecked, totals };
}


/**
 * Samakan jam "Daily Close" yang ditulis AI dengan jam resmi (17:00 New York dalam WIB) bila selisihnya <= 180 menit.
 * Berlaku untuk teks Ringkasan Cepat dan Waktu Berakhir baris 4B bergaya Swing.
 */
export function fixDailyClose(markdown = '', now = new Date()) {
  const dc = dailyCloseWIB(now);
  const [dh, dm] = dc.split(':').map(Number);
  const notes = [];
  let out = String(markdown).replace(/(Daily\s+Close(?:\s+pukul)?\s*)(\d{1,2}[:.]\d{2})(\s*WIB)/gi, (all, a, t, b) => {
    if (t.replace('.', ':').padStart(5, '0') === dc) return all;
    notes.push(`Jam Daily Close dikoreksi ${t} → ${dc} WIB`);
    return `${a}${dc}${b}`;
  });
  const lines = out.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSeparator(lines[i + 1])) continue;
    const headers = splitRow(lines[i]).map((h) => h.toLowerCase());
    const cExp = headers.findIndex((h) => /berakhir|expir|kedaluwarsa/.test(h));
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      if (cExp < 0 || !/^order$/.test(headers[0] || '')) continue;
      const cells = splitRow(lines[j]);
      if (!/swing/i.test(cells[0] || '') || cExp >= cells.length) continue;
      const ts = parseExpiryWIB(cells[cExp]);
      if (ts == null) continue;
      const d = new Date(ts + 7 * 3600e3);
      const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), dh, dm) - 7 * 3600e3;
      if (target !== ts && Math.abs(target - ts) <= 180 * 60e3 && target > now.getTime()) {
        cells[cExp] = `${fmtMt4(target, 7)} WIB`;
        lines[j] = `| ${cells.join(' | ')} |`;
        notes.push(`Waktu Berakhir ${String(cells[0]).replace(/\*/g, '').split('(')[0].trim()} disamakan dengan Daily Close ${dc} WIB`);
      }
    }
    i = j - 1;
  }
  return { markdown: lines.join('\n'), notes };
}
