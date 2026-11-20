// Guardrail jarak/arah/konflik: memeriksa hasil AI terhadap HARGA TERAKHIR dan Bias Utama.
// - Setup baru (Bagian 3 & 4B): arah (Sell di atas, Buy di bawah), rentang Zona 1/2 per pair, Zona 2 lebih jauh dari Zona 1,
//   serta deteksi "menyalin garis order user" dan klaim "Sudah Terpasang" untuk order yang di luar jangkauan zona.
// - Audit order user (4A): jarak, status vs bias, label DISARANKAN BATALKAN / DISARANKAN GESER (dihitung server).
// Tidak mengubah angka entry/SL/TP/lot; hanya menambah kolom/label dan peringatan.
import { zoneRange, fmtDistance, guessPairByPrice } from '@/lib/pairs';
import { splitRow, isSeparator } from '@/lib/riskCheck';

const TOL_RANGE = 0.15; // toleransi 15% di tepi rentang zona

export function parseLastPrice(markdown, pair) {
  const m =
    markdown.match(/HARGA\s+TERAKHIR\s*\**\s*[:：]\s*\**\s*([\d][\d.,]*)/i) ||
    markdown.match(/harga\s+terakhir[^0-9]{0,30}([\d][\d.,]*)/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, '').replace(/\.+$/, ''));
  if (!(n > 0)) return null;
  const g = guessPairByPrice(n);
  if (pair && g && g.group !== pair.group) return null; // angka tidak masuk akal untuk pair ini (mis. jam)
  return n;
}

export function biasSide(bias = '') {
  const b = String(bias).toUpperCase();
  if (/BEARISH|\bSELL\b/.test(b) && !/BULLISH/.test(b)) return 'SELL';
  if (/BULLISH|\bBUY\b/.test(b) && !/BEARISH/.test(b)) return 'BUY';
  return null;
}

function sideOf(text = '') {
  const t = text.toLowerCase();
  const s = t.search(/sell/);
  const b = t.search(/buy/);
  if (s < 0 && b < 0) return null;
  if (s >= 0 && (b < 0 || s < b)) return 'SELL';
  return 'BUY';
}

function allPrices(cell = '', pair) {
  const re = new RegExp(pair.priceRe.source, 'g');
  return (cell.replace(/,/g, '').match(re) || []).map(parseFloat).filter((n) => n > 0);
}

const findCol = (headers, test, exclude) => headers.findIndex((h) => test.test(h) && !(exclude && exclude.test(h)));
const join = (cells) => `| ${cells.join(' | ')} |`;
const clean = (t) => String(t || '').replace(/\*+/g, '').trim();
const inRange = (d, r) => d >= r[0] * (1 - TOL_RANGE) && d <= r[1] * (1 + TOL_RANGE);

function scanTables(lines) {
  const tables = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSeparator(lines[i + 1])) continue;
    const headers = splitRow(lines[i]).map((h) => h.toLowerCase());
    const h0 = headers[0] || '';
    let kind = null;
    if (/terpasang/.test(h0)) kind = 'audit';
    else if (/zona.*strategi/.test(h0)) kind = 'sec3';
    else if (/^order$/.test(h0) && headers.some((h) => /lot/.test(h))) kind = '4b';
    let j = i + 2;
    const rows = [];
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push(j);
    if (kind) tables.push({ kind, head: i, sep: i + 1, rows, headers });
    i = j - 1;
  }
  return tables;
}

/**
 * @returns {{markdown:string, notes:string[], flags:{cancel:string[], shift:string[]}, skipped:string|null}}
 */
export function applyOrderGuard(markdown, { pair, bias } = {}) {
  const out = { markdown, notes: [], flags: { cancel: [], shift: [] }, skipped: null };
  if (!pair) return { ...out, skipped: 'pair' };
  const last = parseLastPrice(markdown, pair);
  if (!last) return { ...out, skipped: 'harga terakhir tidak terbaca' };
  const R = zoneRange(pair, last);
  if (!R) return { ...out, skipped: 'rentang zona' };

  const dec = pair.dec;
  const lines = markdown.split('\n');
  const tables = scanTables(lines);
  const bSide = biasSide(bias);
  const tol = pair.tolV ?? 0;
  const money = (n) => Number(n).toFixed(dec);
  const arrow = (d) => (d > 0 ? '↑ di atas' : '↓ di bawah');

  // ---- 1) order user (tabel audit)
  const user = [];
  for (const t of tables.filter((x) => x.kind === 'audit')) {
    const cEntry = (() => {
      const a = findCol(t.headers, /entry/);
      return a >= 0 ? a : findCol(t.headers, /^harga\b/, /terakhir|jarak/);
    })();
    if (cEntry < 0) continue;
    for (const ri of t.rows) {
      const cells = splitRow(lines[ri]);
      const name = clean(cells[0]);
      if (/\b(bid|ask)\b|harga (berjalan|terakhir|saat ini)/i.test(name) && !/limit|stop/i.test(name)) continue;
      const entry = allPrices(cells[cEntry], pair)[0];
      const side = sideOf(name);
      if (!entry || !side) continue;
      user.push({ table: t, ri, name, entry, side, dist: entry - last });
    }
  }

  // ---- 2) setup baru (Bagian 3 & 4B)
  const fresh = [];
  const placedRows = [];
  for (const t of tables.filter((x) => x.kind === 'sec3' || x.kind === '4b')) {
    const cEntry = findCol(t.headers, /entry/, /^order$/);
    const label = t.kind === 'sec3' ? 'Bagian 3' : 'Bagian 4B';
    for (const ri of t.rows) {
      const cells = splitRow(lines[ri]);
      const name = clean(cells[0]);
      const side = sideOf(name);
      const zm = /zona\s*([12])/i.exec(name);
      if (!side || !zm) continue;
      const zone = Number(zm[1]);
      const cell = cEntry >= 0 ? cells[cEntry] || '' : '';
      if (/terpasang/i.test(cell) || /sudah\s+terpasang/i.test(name)) {
        placedRows.push({ label, name, side, zone });
        continue;
      }
      const ps = allPrices(cell, pair);
      if (!ps.length) continue;
      const entry = ps.reduce((a, b) => a + b, 0) / ps.length;
      fresh.push({ label, name, side, zone, entry, dist: entry - last, kind: t.kind });
    }
  }

  const note = (m) => !out.notes.includes(m) && out.notes.push(m);
  const zoneTxt = (z) => (z === 1 ? pair.zone1 : pair.zone2);

  for (const f of fresh) {
    const tag = `${f.label} ${f.name.split(/\s[-(]/)[0].trim()}`;
    if ((f.side === 'SELL' && f.dist <= 0) || (f.side === 'BUY' && f.dist >= 0)) {
      note(`⚠️ ${tag}: arah salah — entry ${money(f.entry)} ${f.side === 'SELL' ? 'harus DI ATAS' : 'harus DI BAWAH'} harga terakhir ${money(last)}.`);
      continue;
    }
    const range = f.zone === 1 ? R.z1 : R.z2;
    if (!inRange(Math.abs(f.dist), range)) {
      note(
        `⚠️ ${tag}: entry ${money(f.entry)} berjarak ${fmtDistance(pair, f.dist)} dari harga ${money(last)}, di luar rentang Zona ${f.zone} (${zoneTxt(f.zone)}). Cek ulang level struktur.`
      );
    }
    const echo = user.find((u) => Math.abs(u.entry - f.entry) <= tol);
    if (echo) note(`⚠️ ${tag}: entry ${money(f.entry)} identik dengan garis order user (${echo.name} @ ${money(echo.entry)}). Garis order bukan bukti struktur — verifikasi level ini dari candle.`);
  }
  for (const side of ['SELL', 'BUY']) {
    const z1 = fresh.find((x) => x.side === side && x.zone === 1);
    const z2 = fresh.find((x) => x.side === side && x.zone === 2);
    if (z1 && z2 && Math.abs(z2.dist) <= Math.abs(z1.dist)) {
      note(`⚠️ ${side} Zona 2 (${money(z2.entry)}) tidak lebih jauh dari Zona 1 (${money(z1.entry)}) — urutan zona salah.`);
    }
  }
  for (const p of placedRows) {
    const range = p.zone === 1 ? R.z1 : R.z2;
    const ok = user.some((u) => u.side === p.side && inRange(Math.abs(u.dist), range) && (p.side === 'SELL' ? u.dist > 0 : u.dist < 0));
    if (user.length && !ok) {
      note(`⚠️ ${p.label} ${p.side} Zona ${p.zone}: ditulis "Sudah Terpasang" tetapi tidak ada order user dalam rentang Zona ${p.zone} (${zoneTxt(p.zone)}). Anggap zona ini KOSONG dan butuh level baru.`);
    }
  }

  // ---- 3) tulis ulang tabel audit (kolom jarak/bias + label rekomendasi)
  const byTable = new Map();
  for (const u of user) {
    const absD = Math.abs(u.dist);
    const conflict = bSide ? u.side !== bSide : false;
    const tooFar = absD > R.z2[1] * (1 + TOL_RANGE);
    const tooNear = absD < R.z1[0] * (1 - TOL_RANGE);
    u.status = tooFar ? 'Terlalu jauh' : tooNear ? 'Terlalu dekat' : 'Wajar';
    u.biasTxt = !bSide ? 'Netral' : conflict ? 'KONFLIK BIAS' : 'Searah';
    u.conflict = conflict;
    u.tooFar = tooFar;
    if (!byTable.has(u.table)) byTable.set(u.table, []);
    byTable.get(u.table).push(u);
  }

  const shiftTarget = (u) => {
    const c = fresh
      .filter((f) => f.side === u.side && ((u.side === 'SELL' && f.dist > 0) || (u.side === 'BUY' && f.dist < 0)))
      .filter((f) => Math.abs(f.dist) <= R.z2[1] * (1 + TOL_RANGE))
      .sort((a, b) => Math.abs(a.entry - u.entry) - Math.abs(b.entry - u.entry))[0];
    return c ? `${money(c.entry)} (${f_label(c)})` : 'level struktur terdekat pada Bagian 3/4B';
  };
  const f_label = (f) => `${f.label} Zona ${f.zone}`;

  for (const [t, list] of byTable) {
    let headers = splitRow(lines[t.head]);
    const lower = () => headers.map((h) => h.toLowerCase());
    const ensure = (test, title) => {
      let idx = findCol(lower(), test, /\bsl\b|stop/);
      if (idx < 0) {
        // sisipkan sebelum kolom Verdict bila ada, selain itu di akhir
        const v = findCol(lower(), /verdict/);
        const at = v >= 0 ? v : headers.length;
        const ins = (arr, val) => [...arr.slice(0, at), val, ...arr.slice(at)];
        headers = ins(headers, title);
        idx = at;
        lines[t.sep] = join(headers.map(() => '---'));
        for (const ri of t.rows) {
          const c = splitRow(lines[ri]);
          while (c.length < headers.length - 1) c.push('-');
          lines[ri] = join(ins(c, '-'));
        }
      }
      return idx;
    };
    let cVer = findCol(lower(), /verdict/);
    if (cVer < 0) {
      headers = [...headers, 'Verdict'];
      lines[t.sep] = join(headers.map(() => '---'));
      for (const ri of t.rows) lines[ri] = join([...splitRow(lines[ri]), '-']);
    }
    const cJar = ensure(/jarak.*harga|dari harga/, 'Jarak dari Harga');
    const cBias = ensure(/status.*bias|vs bias/, 'Status vs Bias');
    cVer = findCol(lower(), /verdict/);
    lines[t.head] = join(headers);
    const width = headers.length;
    for (const u of list) {
      const cells = splitRow(lines[u.ri]);
      while (cells.length < width) cells.push('-');
      cells[cJar] = `${u.dist > 0 ? '+' : '−'}${fmtDistance(pair, u.dist)} ${arrow(u.dist)} — ${u.status}`;
      cells[cBias] = u.conflict ? '🚫 **KONFLIK BIAS**' : u.biasTxt;
      const ver = cells[cVer] || '';
      if (!/DISARANKAN/i.test(ver)) {
        let label = '';
        if (u.conflict) {
          label = `🚫 **DISARANKAN BATALKAN** — order ${u.side} melawan bias ${bSide === 'SELL' ? 'BEARISH' : 'BULLISH'}${u.tooFar ? ' dan terlalu jauh' : ''}.`;
          out.flags.cancel.push(`${u.name} @ ${money(u.entry)}`);
        } else if (u.tooFar) {
          label = `⚠️ **DISARANKAN GESER** ke ${shiftTarget(u)} — terlalu jauh (${fmtDistance(pair, u.dist)} > batas Zona 2 ${fmtDistance(pair, R.z2[1])}).`;
          out.flags.shift.push(`${u.name} @ ${money(u.entry)}`);
        }
        if (label) cells[cVer] = `${label} ${ver && ver !== '-' ? ver.replace(/^\s*Pertahankan\s*:?\s*/i, '') : ''}`.trim();
      }
      lines[u.ri] = join(cells);
      if (u.conflict) note(`🚫 ${u.name} @ ${money(u.entry)}: KONFLIK BIAS — order ${u.side} sedangkan Bias Utama ${bSide === 'SELL' ? 'BEARISH' : 'BULLISH'}. DISARANKAN BATALKAN.`);
      if (u.tooFar) note(`⚠️ ${u.name} @ ${money(u.entry)}: ${fmtDistance(pair, u.dist)} dari harga, melewati batas Zona 2 (${zoneTxt(2)}). DISARANKAN GESER.`);
    }
  }

  // ---- 4) satu baris peringatan di Ringkasan Cepat
  const parts = [];
  if (out.flags.cancel.length) parts.push(`${out.flags.cancel.join(', ')} → DISARANKAN BATALKAN (konflik bias)`);
  if (out.flags.shift.length) parts.push(`${out.flags.shift.join(', ')} → DISARANKAN GESER (terlalu jauh)`);
  if (parts.length) {
    const warn = `> - 🚨 Peringatan Order: ${parts.join('; ')}. Detail di 4A.`;
    let at = lines.findIndex((l) => /^\s*>.*Masa Berlaku Sinyal/i.test(l));
    if (at < 0) {
      const h = lines.findIndex((l) => /^\s*>.*Ringkasan Cepat/i.test(l));
      at = h;
      while (at >= 0 && at + 1 < lines.length && /^\s*>/.test(lines[at + 1])) at++;
    }
    if (at >= 0) lines.splice(at + 1, 0, warn);
  }

  out.markdown = lines.join('\n');
  return out;
}
