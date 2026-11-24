// Sumber tunggal angka per zona (Bagian 3 vs 4B vs Rincian Hitung Risiko).
// Aturan: baris 4B (order yang dihitung lot/risikonya oleh server) adalah SUMBER FINAL untuk Entry, SL, TP1.
// Bagian 3 dan "Rincian Hitung Risiko" dipaksa mengikuti. Angka turunan (Jarak SL, R:R, Risiko) dihitung ulang server.
// Bila angka tidak bisa diselaraskan (entry di luar zona Bagian 3, hanya satu tabel yang punya setup, TP2 tidak masuk akal)
// maka setup dibatalkan di KEDUA tempat (WAIT / NO TRADE). Murni teks -> teks; tanpa alias import agar bisa diuji dengan node.

const splitRow = (line) => String(line).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSep = (line) => /^\s*\|?\s*:?-{2,}/.test(String(line)) && !/[A-Za-z0-9]/.test(String(line).replace(/[|:\-\s]/g, ''));
const clean = (t) => String(t || '').replace(/[*`]/g, '').trim();
const sideOf = (name) => {
  const t = String(name).toLowerCase();
  const s = t.search(/sell/), b = t.search(/buy/);
  if (s < 0 && b < 0) return null;
  return s >= 0 && (b < 0 || s < b) ? 'SELL' : 'BUY';
};
const zoneOf = (name) => { const m = /zona\s*(\d)/i.exec(String(name)); return m ? Number(m[1]) : null; };
const findCol = (h, re, ex) => h.findIndex((x) => re.test(x) && !(ex && ex.test(x)));
const NUM = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const nums = (cell) => (String(cell).match(NUM) || []).map((m) => Number(m.replace(/,/g, ''))).filter((n) => Number.isFinite(n) && n > 0);
const first = (cell) => nums(cell)[0] ?? null;

// ganti angka pertama dalam sel (anotasi lain dipertahankan)
function replaceFirst(cell, value, dec) {
  let done = false;
  return String(cell).replace(NUM, (tok) => {
    if (done) return tok;
    done = true;
    return tok.includes(',') ? Number(value).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : Number(value).toFixed(dec);
  });
}

const key = (r) => `${r.side}${r.zone}`;
const inactive3 = (cell) => !nums(cell).length || /tidak ada|tunggu/i.test(cell);

function scan(lines) {
  const rows3 = [], rows4 = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSep(lines[i + 1])) continue;
    const h = splitRow(lines[i]).map((x) => x.toLowerCase().replace(/[*`]/g, ''));
    const h0 = h[0] || '';
    const kind = /zona.*strategi/.test(h0) ? 'sec3' : /^order$/.test(h0) && h.some((x) => /lot/.test(x)) ? '4b' : null;
    let j = i + 2;
    if (!kind) { while (j < lines.length && lines[j].trim().startsWith('|')) j++; i = j - 1; continue; }
    const idx = {
      entry: findCol(h, /entry/, /syarat|konfirmasi/),
      sl: findCol(h, /stop loss|^sl\b/, /jarak/),
      tp1: kind === 'sec3' ? findCol(h, /take profit 1|tp1/) : findCol(h, /take profit|^tp\b/, /tp2|profit 2/),
      tp2: kind === 'sec3' ? findCol(h, /take profit 2|tp2/) : -1,
      conf: kind === 'sec3' ? findCol(h, /konfirmasi|syarat/) : -1,
      jar: kind === '4b' ? findCol(h, /jarak.*sl|sl.*jarak/) : -1,
      lot: kind === '4b' ? findCol(h, /\blot\b/) : -1,
      risk: kind === '4b' ? findCol(h, /risiko/) : -1,
      rr: kind === '4b' ? findCol(h, /^r\s*[:/]\s*r$|risk.?reward|\brr\b/) : -1,
    };
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const cells = splitRow(lines[j]);
      const name = clean(cells[0]);
      const side = sideOf(name), zone = zoneOf(name);
      if (!side || !zone || idx.entry < 0 || idx.entry >= cells.length) continue;
      (kind === 'sec3' ? rows3 : rows4).push({ kind, side, zone, name, j, cells, idx });
    }
    i = j - 1;
  }
  return { rows3, rows4 };
}

const write = (lines, r) => { lines[r.j] = `| ${r.cells.join(' | ')} |`; };
function cancelRow(lines, r, why) {
  const dead = r.cells.map(() => '-');
  dead[0] = /⛔/.test(r.cells[0]) ? r.cells[0] : `${r.cells[0]} ⛔`;
  dead[r.idx.entry] = r.kind === '4b' ? 'Tidak Ada Setup (Tunggu)' : 'Tidak ada level valid (tunggu)';
  r.cells = dead;
  r.cancelled = why;
  write(lines, r);
}

const rrText = (rr) => `1:${rr.toFixed(2)}`;

/** Ambil angka final tiap zona dari baris yang aktif. */
function figures(r3, r4) {
  const e4 = first(r4.cells[r4.idx.entry]);
  const sl4 = r4.idx.sl >= 0 ? first(r4.cells[r4.idx.sl]) : null;
  const tp4 = r4.idx.tp1 >= 0 ? first(r4.cells[r4.idx.tp1]) : null;
  const lot = r4.idx.lot >= 0 ? first(r4.cells[r4.idx.lot]) : null;
  return { e4, sl4, tp4, lot, zone3: nums(r3.cells[r3.idx.entry]) };
}

/**
 * @param {string} markdown
 * @param {{dec?:number, mult?:number|null, entryTol?:number, maxRiskUsd?:number}} opts
 *   mult: pengali risiko (Risiko = Lot x Jarak x mult). Bila ada, Jarak SL / R:R / Risiko dihitung ulang dan diaudit.
 * @returns {{markdown:string, notes:string[], mismatches:object[], cancelled:object[]}}
 */
export function reconcileZones(markdown = '', { dec = 2, mult = null, entryTol = 0 } = {}) {
  const lines = String(markdown).split('\n');
  const notes = [];
  const cancelled = [];
  const tick = Math.pow(10, -dec);
  const tol = Math.max(entryTol || 0, 1.5 * tick);
  const eq = (a, b) => Math.abs(a - b) <= 0.5 * tick + 1e-9;
  const money = (n) => `$${Number(n).toFixed(2)}`;
  const kill = (r3, r4, why) => {
    if (r3 && !r3.cancelled) cancelRow(lines, r3, why);
    if (r4 && !r4.cancelled) cancelRow(lines, r4, why);
    const s = (r3 || r4);
    if (!cancelled.some((c) => c.side === s.side && c.zone === s.zone)) {
      cancelled.push({ side: s.side, zone: s.zone, why });
      notes.push(`⛔ ${s.side} Zona ${s.zone}: ${why} → setup dibatalkan di Bagian 3 dan 4B (WAIT / NO TRADE).`);
    }
  };

  const { rows3, rows4 } = scan(lines);
  const keys = new Set([...rows3, ...rows4].map(key));
  for (const k of keys) {
    const r3 = rows3.find((r) => key(r) === k);
    const r4 = rows4.find((r) => key(r) === k);
    if (!r3 || !r4) continue;
    const a3 = !inactive3(r3.cells[r3.idx.entry]);
    const placed4 = /terpasang/i.test(r4.cells[r4.idx.entry]);
    const lot0 = r4.idx.lot >= 0 ? first(r4.cells[r4.idx.lot]) : null;
    const a4 = !!first(r4.cells[r4.idx.entry]) && !/tidak ada|tunggu/i.test(r4.cells[r4.idx.entry]) && !placed4 && (r4.idx.lot < 0 || lot0 != null);
    if (!a3 && !a4) continue;
    if (placed4) continue; // order sudah ada di 4A: tidak ada angka 4B untuk disamakan
    if (a3 && !a4) { kill(r3, null, 'Bagian 3 memuat zona tetapi 4B tidak punya order (dibatalkan/ditolak validator)'); continue; }
    if (!a3 && a4) { kill(null, r4, '4B memuat order tetapi Bagian 3 tidak punya zona valid'); continue; }

    const f = figures(r3, r4);
    const side = r4.side;
    const dir = side === 'SELL' ? -1 : 1;
    if (f.e4 == null || f.sl4 == null || f.tp4 == null) { kill(r3, r4, 'Entry/SL/TP 4B tidak lengkap sehingga tidak bisa diselaraskan'); continue; }
    if (dir * (f.tp4 - f.e4) <= 0 || dir * (f.e4 - f.sl4) <= 0) { kill(r3, r4, `arah SL/TP salah terhadap entry ${f.e4.toFixed(dec)}`); continue; }
    const lo = Math.min(...f.zone3), hi = Math.max(...f.zone3);
    if (f.e4 < lo - tol || f.e4 > hi + tol) { kill(r3, r4, `entry 4B ${f.e4.toFixed(dec)} di luar zona Bagian 3 (${lo.toFixed(dec)}–${hi.toFixed(dec)})`); continue; }

    // SL & TP1: Bagian 3 mengikuti 4B
    const s3 = r3.idx.sl >= 0 ? first(r3.cells[r3.idx.sl]) : null;
    if (r3.idx.sl >= 0 && (s3 == null || !eq(s3, f.sl4))) {
      notes.push(`🔁 ${side} Zona ${r3.zone}: SL Bagian 3 (${s3 == null ? '-' : s3.toFixed(dec)}) disamakan dengan SL final 4B (${f.sl4.toFixed(dec)}).`);
      r3.cells[r3.idx.sl] = s3 == null ? f.sl4.toFixed(dec) : replaceFirst(r3.cells[r3.idx.sl], f.sl4, dec);
    }
    const t3 = r3.idx.tp1 >= 0 ? first(r3.cells[r3.idx.tp1]) : null;
    if (r3.idx.tp1 >= 0 && (t3 == null || !eq(t3, f.tp4))) {
      notes.push(`🔁 ${side} Zona ${r3.zone}: TP1 Bagian 3 (${t3 == null ? '-' : t3.toFixed(dec)}) disamakan dengan TP final 4B (${f.tp4.toFixed(dec)}).`);
      r3.cells[r3.idx.tp1] = t3 == null ? f.tp4.toFixed(dec) : replaceFirst(r3.cells[r3.idx.tp1], f.tp4, dec);
    }
    // TP2 harus searah profit dan lebih jauh dari TP1; selain itu dikosongkan (tidak mengarang angka)
    if (r3.idx.tp2 >= 0) {
      const t2 = first(r3.cells[r3.idx.tp2]);
      if (t2 != null && !(dir * (t2 - f.tp4) > tick * 0.5)) {
        notes.push(`🔁 ${side} Zona ${r3.zone}: TP2 ${t2.toFixed(dec)} tidak lebih jauh dari TP1 ${f.tp4.toFixed(dec)} → dikosongkan ("-").`);
        r3.cells[r3.idx.tp2] = '-';
      }
    }

    // Angka turunan 4B dari entry/SL/TP final
    const dist = Math.abs(f.e4 - f.sl4);
    const rr = Math.abs(f.tp4 - f.e4) / dist;
    if (r4.idx.jar >= 0) {
      const j0 = first(r4.cells[r4.idx.jar]);
      if (j0 == null || !eq(j0, dist)) { notes.push(`🔁 ${side} Zona ${r4.zone}: Jarak SL 4B dihitung ulang ${j0 == null ? '-' : j0.toFixed(dec)} → ${dist.toFixed(dec)}.`); r4.cells[r4.idx.jar] = dist.toFixed(dec); }
    }
    if (r4.idx.rr >= 0) {
      const m = String(r4.cells[r4.idx.rr]).replace(/,/g, '.').match(/(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/);
      const shown = m ? Number(m[2]) / Number(m[1]) : null;
      if (shown == null || Math.abs(shown - rr) > 0.005) { notes.push(`🔁 ${side} Zona ${r4.zone}: R:R 4B dihitung ulang → ${rrText(rr)}.`); r4.cells[r4.idx.rr] = rrText(rr); }
    }
    if (mult > 0 && lot0 != null && r4.idx.risk >= 0) {
      const risk = lot0 * dist * mult;
      const shown = first(r4.cells[r4.idx.risk]);
      if (shown == null || Math.abs(shown - risk) > 0.02) { notes.push(`🔁 ${side} Zona ${r4.zone}: Risiko 4B dihitung ulang ${shown == null ? '-' : money(shown)} → ${money(risk)}.`); r4.cells[r4.idx.risk] = money(risk); }
    }
    // Teks R:R di kolom konfirmasi Bagian 3 mengikuti R:R final
    if (r3.idx.conf >= 0) {
      const c0 = r3.cells[r3.idx.conf];
      const c1 = c0.replace(/(R\s*:\s*R(?:\s*TP1)?\s*[~≈=:]?\s*)1\s*[:/]\s*\d+(?:[.,]\d+)?/gi, (_, p) => `${p}${rrText(rr)}`);
      if (c1 !== c0) { r3.cells[r3.idx.conf] = c1; notes.push(`🔁 ${side} Zona ${r3.zone}: teks R:R Bagian 3 disamakan dengan R:R final ${rrText(rr)}.`); }
    }
    write(lines, r3);
    write(lines, r4);
  }

  // Rincian Hitung Risiko mengikuti angka final tabel 4B
  const live4 = scan(lines).rows4;
  let inDetail = false;
  for (let k = 0; k < lines.length; k++) {
    const t = lines[k];
    if (/rincian hitung risiko/i.test(t)) { inDetail = true; continue; }
    if (!inDetail) continue;
    if (/^\s*#{1,6}\s/.test(t) || /^\s*\|/.test(t)) { inDetail = false; continue; }
    const m = t.match(/^(\s*[-*]\s+)(.+?):\s*([\d.]+)\s*(lot)?\s*([x×*])\s*([\d.,]+)\s*([x×*])\s*([\d.]+)\s*=\s*\$?([\d.,]+)/i);
    if (!m) continue;
    const sd = sideOf(m[2]), zn = zoneOf(m[2]) || Number((m[2].match(/\bz\s*(\d)/i) || [])[1]) || null;
    const r = live4.find((x) => x.side === sd && x.zone === zn);
    if (!r) continue;
    const entryTxt = r.cells[r.idx.entry];
    if (!first(entryTxt) || /tidak ada|tunggu/i.test(entryTxt)) {
      if (!/tidak ada order/i.test(t)) { lines[k] = `${m[1]}${m[2]}: tidak ada order (setup dibatalkan / tidak selaras)`; notes.push(`🔁 Rincian risiko ${sd} Zona ${zn} dihapus: tidak ada order di 4B.`); }
      continue;
    }
    const lotV = r.idx.lot >= 0 ? first(r.cells[r.idx.lot]) : null;
    const jarV = r.idx.jar >= 0 ? first(r.cells[r.idx.jar]) : null;
    const riskV = r.idx.risk >= 0 ? first(r.cells[r.idx.risk]) : null;
    if (lotV == null || jarV == null || riskV == null) continue;
    const rest = t.slice(m[0].length);
    const lotTok = (String(r.cells[r.idx.lot]).match(NUM) || [String(lotV)])[0];
    const next = `${m[1]}${m[2]}: ${lotTok} lot ${m[5]} ${jarV.toFixed(dec)} ${m[7]} ${m[8]} = ${money(riskV)}${rest}`;
    if (Number(m[3]) !== lotV || !eq(Number(m[6].replace(/,/g, '')), jarV) || Math.abs(Number(m[9].replace(/,/g, '')) - riskV) > 0.005) {
      lines[k] = next;
      notes.push(`🔁 Rincian risiko ${sd} Zona ${zn} disamakan dengan tabel 4B (${lotV} lot × ${jarV.toFixed(dec)} = ${money(riskV)}).`);
    }
  }

  const out = lines.join('\n');
  return { markdown: out, notes, cancelled, mismatches: auditZoneNumbers(out, { dec, mult, entryTol }) };
}

/** Audit murni (tidak mengubah): daftar ketidakselarasan angka antar bagian. Kosong = konsisten. */
export function auditZoneNumbers(markdown = '', { dec = 2, mult = null, entryTol = 0 } = {}) {
  const lines = String(markdown).split('\n');
  const { rows3, rows4 } = scan(lines);
  const tick = Math.pow(10, -dec);
  const tol = Math.max(entryTol || 0, 1.5 * tick);
  const eq = (a, b) => Math.abs(a - b) <= 0.5 * tick + 1e-9;
  const bad = [];
  const add = (r, field, a, b) => bad.push({ side: r.side, zone: r.zone, field, a, b });
  for (const k of new Set([...rows3, ...rows4].map(key))) {
    const r3 = rows3.find((r) => key(r) === k);
    const r4 = rows4.find((r) => key(r) === k);
    if (!r3 || !r4) continue;
    const a3 = !inactive3(r3.cells[r3.idx.entry]);
    const placed4 = /terpasang/i.test(r4.cells[r4.idx.entry]);
    const e4 = first(r4.cells[r4.idx.entry]);
    const lot = r4.idx.lot >= 0 ? first(r4.cells[r4.idx.lot]) : null;
    const a4 = !!e4 && !/tidak ada|tunggu/i.test(r4.cells[r4.idx.entry]) && !placed4 && (r4.idx.lot < 0 || lot != null);
    if (placed4) continue;
    if (a3 !== a4) { add(r4, 'status', a3 ? 'Bagian 3 aktif' : 'Bagian 3 kosong', a4 ? '4B aktif' : '4B kosong'); continue; }
    if (!a3) continue;
    const sl4 = r4.idx.sl >= 0 ? first(r4.cells[r4.idx.sl]) : null;
    const tp4 = r4.idx.tp1 >= 0 ? first(r4.cells[r4.idx.tp1]) : null;
    const sl3 = r3.idx.sl >= 0 ? first(r3.cells[r3.idx.sl]) : null;
    const tp3 = r3.idx.tp1 >= 0 ? first(r3.cells[r3.idx.tp1]) : null;
    const z = nums(r3.cells[r3.idx.entry]);
    const lo = Math.min(...z), hi = Math.max(...z);
    if (e4 < lo - tol || e4 > hi + tol) add(r4, 'entry', e4, `${lo}-${hi}`);
    if (sl3 != null && sl4 != null && !eq(sl3, sl4)) add(r4, 'sl', sl3, sl4);
    if (tp3 != null && tp4 != null && !eq(tp3, tp4)) add(r4, 'tp1', tp3, tp4);
    const dir = r4.side === 'SELL' ? -1 : 1;
    const tp2 = r3.idx.tp2 >= 0 ? first(r3.cells[r3.idx.tp2]) : null;
    if (tp2 != null && tp4 != null && !(dir * (tp2 - tp4) > 0)) add(r4, 'tp2', tp2, tp4);
    if (e4 != null && sl4 != null) {
      const dist = Math.abs(e4 - sl4);
      const jar = r4.idx.jar >= 0 ? first(r4.cells[r4.idx.jar]) : null;
      if (jar != null && !eq(jar, dist)) add(r4, 'jarak', jar, dist);
      if (tp4 != null && dist > 0) {
        const rr = Math.abs(tp4 - e4) / dist;
        const rrs = (cell) => { const m = String(cell).replace(/,/g, '.').match(/(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/); return m ? Number(m[2]) / Number(m[1]) : null; };
        const s4 = r4.idx.rr >= 0 ? rrs(r4.cells[r4.idx.rr]) : null;
        if (s4 != null && Math.abs(s4 - rr) > 0.005) add(r4, 'rr', s4, rr);
        const c3 = r3.idx.conf >= 0 ? r3.cells[r3.idx.conf] : '';
        for (const mm of c3.matchAll(/R\s*:\s*R(?:\s*TP1)?\s*[~≈=:]?\s*1\s*[:/]\s*(\d+(?:[.,]\d+)?)/gi)) {
          const v = Number(mm[1].replace(',', '.'));
          if (Math.abs(v - rr) > 0.005) add(r3, 'rr_bagian3', v, rr);
        }
        if (mult > 0 && lot != null && r4.idx.risk >= 0) {
          const risk = first(r4.cells[r4.idx.risk]);
          if (risk != null && Math.abs(risk - lot * dist * mult) > 0.02) add(r4, 'risiko', risk, lot * dist * mult);
        }
      }
    }
  }
  return bad;
}

/** Batalkan zona yang masih tidak selaras setelah sinkron (jaring pengaman terakhir). */
export function cancelMismatched(markdown = '', mismatches = []) {
  if (!mismatches.length) return { markdown, notes: [] };
  const lines = String(markdown).split('\n');
  const { rows3, rows4 } = scan(lines);
  const notes = [];
  for (const k of new Set(mismatches.map((m) => `${m.side}${m.zone}`))) {
    for (const r of [...rows3, ...rows4].filter((x) => key(x) === k)) cancelRow(lines, r, 'audit akhir');
    const f = mismatches.filter((m) => `${m.side}${m.zone}` === k).map((m) => m.field).join(', ');
    notes.push(`⛔ ${k.replace(/(\d)/, ' Zona $1')}: angka tidak selaras (${f}) dan tak bisa disinkronkan → NO TRADE.`);
  }
  return { markdown: lines.join('\n'), notes };
}
