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

const stripCoords = (t) => String(t).replace(/\s*\d[\d,]*\.\d+(?:\s*[-–]\s*\d[\d,]*\.\d+)?/g, '').replace(/\(\s*\)/g, '').replace(/\s*\+\s*(?=[+,)]|$)/g, '').replace(/\s+/g, ' ').trim();
const write = (lines, r) => { lines[r.j] = `| ${r.cells.join(' | ')} |`; };
function cancelRow(lines, r, why) {
  const dead = r.cells.map(() => '-');
  dead[0] = /⛔/.test(r.cells[0]) ? stripCoords(r.cells[0]) : `${stripCoords(r.cells[0])} ⛔`;
  dead[r.idx.entry] = r.kind === '4b' ? 'Tidak Ada Setup (Tunggu)' : 'Tidak ada level valid (tunggu)';
  r.cells = dead;
  r.cancelled = why;
  write(lines, r);
}

const rrText = (rr) => `1:${rr.toFixed(2)}`;
const isPlaced = (r4) => /terpasang/i.test(r4.cells[r4.idx.entry]);
const active4 = (r4) => {
  const e = first(r4.cells[r4.idx.entry]);
  const lot = r4.idx.lot >= 0 ? first(r4.cells[r4.idx.lot]) : null;
  return !!e && !/tidak ada|tunggu/i.test(r4.cells[r4.idx.entry]) && !isPlaced(r4) && (r4.idx.lot < 0 || lot != null);
};
const active3 = (r3) => !inactive3(r3.cells[r3.idx.entry]);

/** Dipakai modul pelengkap (invalidation, spread): akses baris tabel Bagian 3 / 4B dan tulis balik. */
export const scanTables = (lines) => scan(lines);
export const writeRow = (lines, r) => write(lines, r);
export { active3 as isActive3, active4 as isActive4, nums as numsOf, first as firstNum };

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
 * @param {{dec?:number, mult?:number|null, maxRiskUsd?:number}} opts (toleransi entry = 1 tick, tidak bisa diperlebar)
 *   mult: pengali risiko (Risiko = Lot x Jarak x mult). Bila ada, Jarak SL / R:R / Risiko dihitung ulang dan diaudit.
 * @returns {{markdown:string, notes:string[], mismatches:object[], cancelled:object[]}}
 */
export function reconcileZones(markdown = '', { dec = 2, mult = null } = {}) {
  const lines = String(markdown).split('\n');
  const notes = [];
  const cancelled = [];
  const changes = []; // angka lama -> baru (untuk membersihkan teks bebas)
  const tick = Math.pow(10, -dec);
  const tol = tick + 1e-9; // entry harus di dalam zona; toleransi hanya 1 tick pembulatan harga (bukan perluasan zona)
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
    if (!r3 || !r4) { // zona aktif yang tidak punya baris pasangan = tidak bisa diverifikasi -> batalkan (jangan dilewati)
      if (r3 && active3(r3)) kill(r3, null, 'zona aktif di Bagian 3 tetapi tidak ada baris pasangan di 4B');
      else if (r4 && active4(r4)) kill(null, r4, 'order aktif di 4B tetapi tidak ada baris pasangan di Bagian 3');
      continue;
    }
    const a3 = active3(r3);
    const placed4 = isPlaced(r4);
    const lot0 = r4.idx.lot >= 0 ? first(r4.cells[r4.idx.lot]) : null;
    const a4 = active4(r4);
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
      if (s3 != null) changes.push({ side, zone: r3.zone, field: 'sl', old: s3, new: f.sl4 });
      notes.push(`🔁 ${side} Zona ${r3.zone}: SL Bagian 3 (${s3 == null ? '-' : s3.toFixed(dec)}) disamakan dengan SL final 4B (${f.sl4.toFixed(dec)}).`);
      r3.cells[r3.idx.sl] = s3 == null ? f.sl4.toFixed(dec) : replaceFirst(r3.cells[r3.idx.sl], f.sl4, dec);
    }
    const t3 = r3.idx.tp1 >= 0 ? first(r3.cells[r3.idx.tp1]) : null;
    if (r3.idx.tp1 >= 0 && (t3 == null || !eq(t3, f.tp4))) {
      if (t3 != null) changes.push({ side, zone: r3.zone, field: 'tp1', old: t3, new: f.tp4 });
      notes.push(`🔁 ${side} Zona ${r3.zone}: TP1 Bagian 3 (${t3 == null ? '-' : t3.toFixed(dec)}) disamakan dengan TP final 4B (${f.tp4.toFixed(dec)}).`);
      r3.cells[r3.idx.tp1] = t3 == null ? f.tp4.toFixed(dec) : replaceFirst(r3.cells[r3.idx.tp1], f.tp4, dec);
    }
    // TP2 harus searah profit dan lebih jauh dari TP1; selain itu dikosongkan (tidak mengarang angka)
    if (r3.idx.tp2 >= 0) {
      const t2 = first(r3.cells[r3.idx.tp2]);
      if (t2 != null && !(dir * (t2 - f.tp4) > tick * 0.5)) {
        changes.push({ side, zone: r3.zone, field: 'tp2', old: t2, new: null });
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
      const c1 = c0.replace(/(R\s*:\s*R(?:\s*TP1)?\s*[~≈±=:]?\s*)1\s*[:/]\s*\d+(?:[.,]\d+)?/gi, (_, p) => `${p}${rrText(rr)}`);
      if (c1 !== c0) { r3.cells[r3.idx.conf] = c1; notes.push(`🔁 ${side} Zona ${r3.zone}: teks R:R Bagian 3 disamakan dengan R:R final ${rrText(rr)}.`); }
    }
    write(lines, r3);
    write(lines, r4);
  }

  // Baris yang tidak aktif tidak boleh membawa koordinat zona lama di namanya (mis. "Buy Limit Zona 2 (... 3538.60-3553.31)")
  {
    const live = scan(lines);
    for (const r of [...live.rows3, ...live.rows4]) {
      if (r.kind === '4b' ? (active4(r) || isPlaced(r)) : active3(r)) continue;
      const c = stripCoords(r.cells[0]);
      if (c !== r.cells[0]) { r.cells[0] = c; write(lines, r); }
    }
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
    if (!r) { // tidak ada baris 4B untuk zona ini = tidak ada order
      if (!/tidak ada order/i.test(t)) { lines[k] = `${m[1]}${m[2]}: tidak ada order (tidak ada baris 4B / setup dibatalkan)`; notes.push(`🔁 Rincian risiko ${sd} Zona ${zn} dihapus: tidak ada baris 4B.`); }
      continue;
    }
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
  return { markdown: out, notes, cancelled, changes, mismatches: auditZoneNumbers(out, { dec, mult }) };
}

/** Audit murni (tidak mengubah): daftar ketidakselarasan angka antar bagian. Kosong = konsisten. */
export function auditZoneNumbers(markdown = '', { dec = 2, mult = null } = {}) {
  const lines = String(markdown).split('\n');
  const { rows3, rows4 } = scan(lines);
  const tick = Math.pow(10, -dec);
  const tol = tick + 1e-9;
  const eq = (a, b) => Math.abs(a - b) <= 0.5 * tick + 1e-9;
  const bad = [];
  const add = (r, field, a, b) => bad.push({ side: r.side, zone: r.zone, field, a, b });
  for (const k of new Set([...rows3, ...rows4].map(key))) {
    const r3 = rows3.find((r) => key(r) === k);
    const r4 = rows4.find((r) => key(r) === k);
    if (!r3 || !r4) {
      if (r3 && active3(r3)) add(r3, 'pasangan', 'Bagian 3 aktif', '4B tidak ada baris');
      else if (r4 && active4(r4)) add(r4, 'pasangan', '4B aktif', 'Bagian 3 tidak ada baris');
      continue;
    }
    const a3 = active3(r3);
    const placed4 = isPlaced(r4);
    const e4 = first(r4.cells[r4.idx.entry]);
    const lot = r4.idx.lot >= 0 ? first(r4.cells[r4.idx.lot]) : null;
    const a4 = active4(r4);
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
        for (const mm of c3.matchAll(/R\s*:\s*R(?:\s*TP1)?\s*[~≈±=:]?\s*1\s*[:/]\s*(\d+(?:[.,]\d+)?)/gi)) {
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

// ====================== Teks bebas (Ringkasan Cepat, Skenario Batal, Manajemen Posisi, kesimpulan) ======================
// Angka Entry/SL/TP/R:R/lot/risiko di teks bebas HARUS sama dengan tabel final; zona yang batal/tidak ada setup tidak boleh
// tampil sebagai rekomendasi aktif. Server yang menulis angka (bukan Gemini).

const NUMT = '\\d+(?:,\\d{3})*(?:\\.\\d+)?';
const REF = /\b(buy|sell)(?:\s+(?:limit|stop))?\s+(?:zona|zone|z)\s*(\d)\b/gi;
const WAITISH = /tidak ada|tunggu|wait|no trade|batal|dibatalkan|tidak dipasang|tidak valid/i;

/** Angka final per zona dari tabel (zona aktif = ada di Bagian 3 DAN 4B; mati = ada baris tapi tidak aktif). */
export function ledgerOf(markdown = '', { dec = 2 } = {}) {
  const { rows3, rows4 } = scan(String(markdown).split('\n'));
  const led = new Map();
  for (const k of new Set([...rows3, ...rows4].map(key))) {
    const r3 = rows3.find((r) => key(r) === k);
    const r4 = rows4.find((r) => key(r) === k);
    const ref = r3 || r4;
    if (r4 && isPlaced(r4)) continue; // order sudah terpasang di 4A: bukan setup baru
    if (!(r3 && r4 && active3(r3) && active4(r4))) { led.set(k, { side: ref.side, zone: ref.zone, active: false }); continue; }
    const e = first(r4.cells[r4.idx.entry]), sl = first(r4.cells[r4.idx.sl]), tp1 = first(r4.cells[r4.idx.tp1]);
    const tp2 = r3.idx.tp2 >= 0 ? first(r3.cells[r3.idx.tp2]) : null;
    const lotCell = r4.idx.lot >= 0 ? (String(r4.cells[r4.idx.lot]).match(NUM) || [null])[0] : null;
    const risk = r4.idx.risk >= 0 ? first(r4.cells[r4.idx.risk]) : null;
    const dist = e != null && sl != null ? Math.abs(e - sl) : null;
    const z3 = nums(r3.cells[r3.idx.entry]);
    led.set(k, { side: ref.side, zone: ref.zone, active: true, entry: e, sl, tp1, tp2, lot: lotCell, risk, rr: dist > 0 && tp1 != null ? Math.abs(tp1 - e) / dist : null, dec, lo: z3.length ? Math.min(...z3) : null, hi: z3.length ? Math.max(...z3) : null });
  }
  return led;
}

const refsOf = (text) => [...new Set([...String(text).matchAll(REF)].map((m) => `${m[1].toUpperCase()}${m[2]}`))];
const sideName = (k) => `${k.startsWith('SELL') ? 'Sell' : 'Buy'} Zona ${k.replace(/\D/g, '')}`;
const waitText = (k) => `WAIT / NO TRADE — ${sideName(k)}: tidak ada order (setup dibatalkan / belum valid; lihat Bagian 3 dan 4B)`;

function syncClause(clause, led, { scenario = false, stale = [] } = {}) {
  const refs = refsOf(clause);
  if (!refs.length) return clause;
  const labeled = /\b(?:SL|TP\s*[12]?|stop\s*loss|take\s*profit|entry|lot|risiko|R\s*:\s*R)\b/i.test(clause);
  if (refs.length > 1 && refs.every((k) => led.get(k) && !led.get(k).active)) {
    if (/WAIT \/ NO TRADE/.test(clause) || (!scenario && WAITISH.test(clause))) return clause;
    return `WAIT / NO TRADE — ${refs.map(sideName).join(' & ')}: tidak ada order (setup dibatalkan / belum valid; lihat Bagian 3 dan 4B)`;
  }
  if (refs.length > 1) {
    // satu klausa memuat beberapa zona: angkanya tidak bisa dipetakan dengan pasti ke satu zona
    return labeled && refs.some((k) => led.get(k)) && new RegExp(NUMT).test(clause) ? 'angka final tiap zona: lihat tabel Bagian 3 dan 4B' : clause;
  }
  const k = refs[0];
  const L = led.get(k);
  if (!L) return clause;
  if (!L.active) {
    if (/WAIT \/ NO TRADE/.test(clause)) return clause;
    if (!scenario && WAITISH.test(clause)) return clause;
    return waitText(k);
  }
  const d = L.dec ?? 2;
  const P = (n) => Number(n).toFixed(d);
  let c = clause;
  const lab = (re, fn) => { c = c.replace(re, fn); };
  lab(new RegExp(`(\\bTP\\s*2\\b|take\\s*profit\\s*2\\b)(\\s*(?:di|@|:|=|~|≈)?\\s*)(${NUMT})`, 'gi'), (m, a, b, n) => (L.tp2 != null ? `${a}${b}${P(L.tp2)}` : m));
  lab(new RegExp(`(\\bTP\\s*1\\b|\\bTP\\b|take\\s*profit(?:\\s*1)?\\b)(\\s*(?:di|@|:|=|~|≈)?\\s*)(${NUMT})`, 'gi'), (m, a, b) => `${a}${b}${P(L.tp1)}`);
  lab(new RegExp(`((?:\\bSL\\b|stop\\s*loss)(?:\\s*\\([^)]*\\))?)(\\s*(?:di|@|:|=|~|≈)?\\s*)(${NUMT})`, 'gi'), (m, a, b) => `${a}${b}${P(L.sl)}`);
  lab(new RegExp(`(\\bentry\\b)(\\s*(?:di|@|:|=|~|≈)?\\s*)(${NUMT})`, 'gi'), (m, a, b) => `${a}${b}${P(L.entry)}`);
  lab(new RegExp(`(zona\\s*\\d\\b(?:\\s*\\([^)]*\\))?\\s*(?:di|@)\\s*)(${NUMT})`, 'gi'), (m, a) => `${a}${P(L.entry)}`);
  if (L.rr != null) lab(/(R\s*:\s*R(?:\s*TP1)?\s*[~≈±=:]?\s*)1\s*[:/]\s*\d+(?:[.,]\d+)?/gi, (m, a) => `${a}${rrText(L.rr)}`);
  if (L.lot != null) {
    lab(/(\blot(?:\s*aman)?\s*[:=]?\s*)(\d+\.\d+)/gi, (m, a) => `${a}${L.lot}`);
    lab(/(\d+\.\d+)(\s*lot\b)/gi, (m, n, b) => `${L.lot}${b}`);
  }
  if (L.risk != null) lab(new RegExp(`(\\brisiko(?:\\s*\\([^)]*\\))?\\s*[:=~≈]?\\s*)\\$?\\s*(${NUMT})`, 'gi'), (m, a) => `${a}$${L.risk.toFixed(2)}`);
  // angka harga lama yang sudah diganti server (mis. SL 3605.00 -> 3605.27) di mana pun muncul pada klausa zona ini
  for (const ch of stale.filter((x) => `${x.side}${x.zone}` === k && x.new != null && x.old != null)) {
    c = c.replace(new RegExp(`(?<![\\d.,])${NUMT}(?![\\d])`, 'g'), (tok) => (Math.abs(Number(tok.replace(/,/g, '')) - ch.old) < 1e-9 + 0.5 * Math.pow(10, -d) && Math.abs(ch.old - ch.new) > 0 ? P(ch.new) : tok));
  }
  return c;
}

const PREFIX = /^(\s*(?:>\s*)?(?:[-*•]\s+)?(?:[^\w\s|*]{1,3}\s*)?(?:\*\*[^*]{1,40}\*\*\s*:?\s*|[A-Za-zÀ-ÿ ]{1,30}:\s+)?)/;

/**
 * Sinkron teks bebas dengan tabel final. Tabel, blok kode, dan blok "Verifikasi risiko otomatis" (catatan server) tidak disentuh.
 * @param {{dec?:number, stale?:{side:string,zone:number,field:string,old:number,new:number|null}[]}} opts
 */
export function syncNarrative(markdown = '', { dec = 2, stale = [] } = {}) {
  const led = ledgerOf(markdown, { dec });
  const lines = String(markdown).split('\n');
  const notes = [];
  let fence = false, inNote = false, inScenario = false, inDetail = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    if (/^\s*```/.test(t)) { fence = !fence; continue; }
    if (fence) continue;
    if (/🧮\s*\*\*Verifikasi risiko otomatis/i.test(t)) { inNote = true; continue; }
    if (inNote) { if (/^\s*>/.test(t)) continue; inNote = false; }
    if (/^\s*\|/.test(t) || /^\s*#{1,6}\s/.test(t)) { inDetail = false; inScenario = false; continue; }
    if (/rincian hitung risiko/i.test(t)) { inDetail = true; inScenario = false; continue; }
    if (/skenario batal/i.test(t)) { inScenario = true; inDetail = false; }
    else if (/^\s*\*\*(?!Skenario)/.test(t) && !/^\s*[-*]/.test(t)) { inScenario = false; inDetail = false; }
    if (inDetail || !refsOf(t).length) continue;
    const pre = (PREFIX.exec(t) || [''])[0];
    const body = t.slice(pre.length);
    const clauses = body.split(/(;\s+)/);
    const out = clauses.map((c, idx) => (idx % 2 ? c : syncClause(c, led, { scenario: inScenario, stale })));
    const seen = new Set();
    const next = pre + out.filter((c, idx) => (idx % 2 ? true : (/^WAIT \/ NO TRADE/.test(c) ? (seen.has(c) ? false : (seen.add(c), true)) : true))).join('').replace(/(;\s+){2,}/g, '; ').replace(/;\s+$/, '');
    if (next !== t) { lines[i] = next; notes.push(`📝 Teks bebas disamakan dengan tabel final: "${t.trim().slice(0, 70)}${t.trim().length > 70 ? '…' : ''}"`); }
  }
  const out = lines.join('\n');
  return { markdown: out, notes, mismatches: auditNarrative(out, { dec }) };
}

/** Audit teks bebas: baris yang masih berubah bila disinkronkan lagi = masih tidak selaras. */
export function auditNarrative(markdown = '', { dec = 2 } = {}) {
  const led = ledgerOf(markdown, { dec });
  const lines = String(markdown).split('\n');
  const bad = [];
  let fence = false, inNote = false, inScenario = false, inDetail = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    if (/^\s*```/.test(t)) { fence = !fence; continue; }
    if (fence) continue;
    if (/🧮\s*\*\*Verifikasi risiko otomatis/i.test(t)) { inNote = true; continue; }
    if (inNote) { if (/^\s*>/.test(t)) continue; inNote = false; }
    if (/^\s*\|/.test(t) || /^\s*#{1,6}\s/.test(t)) { inDetail = false; inScenario = false; continue; }
    if (/rincian hitung risiko/i.test(t)) { inDetail = true; inScenario = false; continue; }
    if (/skenario batal/i.test(t)) { inScenario = true; inDetail = false; }
    else if (/^\s*\*\*(?!Skenario)/.test(t) && !/^\s*[-*]/.test(t)) { inScenario = false; inDetail = false; }
    if (inDetail || !refsOf(t).length) continue;
    const pre = (PREFIX.exec(t) || [''])[0];
    const body = t.slice(pre.length);
    if (body.split(/(;\s+)/).some((c, idx) => idx % 2 === 0 && syncClause(c, led, { scenario: inScenario }) !== c)) bad.push({ line: i + 1, text: t.trim().slice(0, 120) });
  }
  return bad;
}

// ====================== Catatan lama, status order, ringkasan risiko ======================

/** Kunci zona (mis. "BUY2") yang tidak punya order aktif di tabel final. */
export function deadKeys(markdown = '', { dec = 2 } = {}) {
  return [...ledgerOf(markdown, { dec }).entries()].filter(([, v]) => !v.active).map(([k]) => k);
}

/** Buang catatan server lama yang menyebut zona yang akhirnya batal (angka entry lama tidak boleh tertinggal). Catatan pembatalan sendiri dipertahankan. */
export function pruneNotes(notes = [], dead = []) {
  if (!dead.length) return notes;
  const res = dead.map((k) => new RegExp(`\\b${k.startsWith('SELL') ? 'SELL' : 'BUY'}\\s*(?:limit\\s*)?(?:zona|zone|z)\\s*${k.replace(/\D/g, '')}\\b`, 'i'));
  return notes.filter((n) => /^(⛔|🚫|⏸)|WAIT \/ NO TRADE/.test(String(n)) || !res.some((re) => re.test(n)));
}

const STATUS_LABEL = { WAIT: 'WAIT & SEE', NO_TRADE: 'NO TRADE', COUNTERTREND_ONLY: 'HANYA COUNTERTREND', INSUFFICIENT_DATA: 'DATA KURANG', TRADE: 'SETUP UTAMA' };
const usd = (n) => `$${Number(n).toFixed(2)}`;

/**
 * Langkah terakhir (setelah keputusan server): beri status tiap order 4B, buat ulang "Aturan Pasang" dan total risiko dari tabel final.
 * VALIDATED ORDER = lolos semua validator DAN searah bias saat keputusan = TRADE.
 * CANDIDATE ORDER = lolos validator tetapi belum boleh dipasang (WAIT & SEE / countertrend / NO TRADE).
 * "ACTIVE SETUP" tidak pernah diklaim server: konfirmasi candle (Bagian 3) dinilai trader.
 */
export function finalizeOrders(markdown = '', { status = 'NO_TRADE', dir = null, maxRiskUsd = 0, dec = 2, candidates = [] } = {}) {
  const lines = String(markdown).split('\n');
  const { rows4 } = scan(lines);
  const live = rows4.filter((r) => active4(r));
  const label = STATUS_LABEL[status] || status;
  const notes = [];
  const isValid = (r) => status === 'TRADE' && dir && r.side === dir;
  for (const r of live) {
    if (/VALIDATED ORDER|CANDIDATE/.test(r.cells[0])) continue;
    r.cells[0] = `${r.cells[0]} — ${isValid(r) ? '✅ VALIDATED ORDER' : '⏳ CANDIDATE (belum boleh dipasang)'}`;
    write(lines, r);
  }
  const totals = { BUY: 0, SELL: 0 };
  const names = { BUY: [], SELL: [] };
  for (const r of [...live].sort((a, b) => a.zone - b.zone)) {
    const rk = r.idx.risk >= 0 ? first(r.cells[r.idx.risk]) : null;
    if (rk != null) { totals[r.side] += rk; names[r.side].push(`${r.side === 'SELL' ? 'Sell' : 'Buy'} Z${r.zone}`); }
  }
  const nValid = live.filter(isValid).length;
  // Judul + banner status di atas tabel 4B. "Order Baru yang Disarankan" hanya boleh bila ada VALIDATED ORDER (keputusan TRADE & searah bias);
  // selain itu semua baris hanya KANDIDAT (belum boleh dipasang). VALIDATED ORDER bukan ACTIVE SETUP: server tidak membaca candle/harga aktual.
  const hi = lines.findIndex((l) => /^\s*(?:#{1,6}\s*)?\*\*4B\./.test(l));
  if (hi >= 0) {
    const canPlace = status === 'TRADE' && nValid > 0;
    const TITLE_CAND = '4B. KANDIDAT ORDER — BELUM BOLEH DIPASANG';
    if (!canPlace) lines[hi] = lines[hi].replace(/(\*\*)4B\.[^*]*(\*\*)/, `$1${TITLE_CAND}$2`);
    else if (/KANDIDAT ORDER/.test(lines[hi])) lines[hi] = lines[hi].replace(/(\*\*)4B\.[^*]*(\*\*)/, '$14B. Order Baru yang Disarankan$2');
    const banner = !live.length
      ? `> 🏷️ **Status order 4B:** ⛔ WAIT / NO TRADE — tidak ada order yang lolos semua validator. Jangan pasang order.`
      : canPlace
        ? `> 🏷️ **Status order 4B:** ✅ VALIDATED ORDER = lolos validator & searah bias (${nValid} order). Ini BUKAN "ACTIVE SETUP": server tidak membaca candle/harga aktual, jadi pasang hanya bila syarat konfirmasi candle di Bagian 3 terpenuhi di chart Anda. ⏳ CANDIDATE = belum boleh dipasang (countertrend/belum selaras).`
        : `> 🏷️ **Status order 4B:** ⏳ Keputusan server = ${label}${status === 'TRADE' ? ' (tidak ada order searah bias yang lolos)' : ''}. Semua order di tabel ini berstatus **CANDIDATE ORDER** (kandidat untuk perencanaan, BELUM boleh dipasang). Jangan memasang pending order apa pun selama keputusan server belum berubah menjadi setup utama; "ACTIVE SETUP" butuh konfirmasi harga/candle aktual yang belum dinilai validator.`;
    const bi = lines.findIndex((l, i) => i > hi && i < hi + 6 && /^\s*>\s*🏷️\s*\*\*Status order 4B/.test(l));
    if (bi >= 0) lines[bi] = banner; else lines.splice(hi + 1, 0, '', banner);
  }
  // Blok "Aturan Pasang" / "Catatan Kepatuhan Risiko" ditulis ulang server dari tabel final (total, kombinasi, saran pemilihan lama dibuang)
  const HDR = /^\s*(?:[^\w\s*]{1,3}\s*)?(?:\*\*)?(?:Aturan Pasang|Catatan Kepatuhan Risiko|Catatan Batas Risiko|Kepatuhan Risiko|Aturan Risiko|Ringkasan Risiko)\b/i;
  const ai = lines.findIndex((l) => HDR.test(l));
  const lim = maxRiskUsd > 0 ? maxRiskUsd : (ai >= 0 ? Number((lines[ai].match(/\$\s*([\d.,]+)/) || [])[1]?.replace(/,/g, '')) || 0 : 0);
  // Tiga kategori terpisah (jangan dicampur): (1) kandidat awal sebelum validator, (2) ditolak validator + alasan, (3) lolos validator
  const dropped = [];
  const droppedKeys = new Set();
  const nm = (sd, z) => `${sd === 'SELL' ? 'Sell' : 'Buy'} Z${z}`;
  for (const r of rows4) {
    const m = /Tidak Ada Setup \((.+?):\s*Tidak Dipasang\)/i.exec(r.cells[r.idx.entry] || '') || /Tidak Dipasang\s*\((.+?)\)/i.exec(r.cells[r.idx.entry] || '');
    if (m) { dropped.push(`${nm(r.side, r.zone)} (${m[1].trim()})`); droppedKeys.add(key(r)); }
  }
  for (const c of candidates || []) {
    if (c?.dropped && !droppedKeys.has(`${c.side}${c.zone}`)) { dropped.push(`${nm(c.side, c.zone)} (${c.why || 'ditolak validator'})`); droppedKeys.add(`${c.side}${c.zone}`); }
  }
  const cand0 = [...(candidates || [])].filter((c) => c && Number.isFinite(c.risk0)).sort((x, y) => (x.side === y.side ? x.zone - y.zone : x.side === 'SELL' ? -1 : 1));
  const buildBlock = () => {
    const bullets = [];
    if (cand0.length) bullets.push(`- Kandidat awal sebelum validator (risiko per order, BUKAN total dan bukan order aktif): ${cand0.map((c) => `${nm(c.side, c.zone)} ${usd(c.risk0)}`).join(', ')}.`);
    if (dropped.length) bullets.push(`- Dibatalkan validator (tidak dihitung): ${dropped.join(', ')}.`);
    bullets.push(`- Lolos validator (total akhir${lim > 0 ? `; batas ${usd(lim)} per arah` : ''}${status === 'TRADE' ? '' : '; semuanya hanya CANDIDATE'}):`);
    for (const sd of ['SELL', 'BUY']) {
      if (!names[sd].length) { bullets.push(`- ${sd}: tidak ada order valid (WAIT / NO TRADE).`); continue; }
      const over = lim > 0 && totals[sd] > lim + 0.005;
      bullets.push(`- ${sd}: ${names[sd].join(' + ')} = ${usd(totals[sd])}${lim > 0 ? (over ? ` (MELEBIHI batas ${usd(lim)} per arah)` : ` (di bawah batas ${usd(lim)} per arah)`) : ''}${status === 'TRADE' && dir === sd ? '' : ' — CANDIDATE, belum boleh dipasang'}.`);
    }
    if (live.length && status !== 'TRADE') bullets.push(`- ⏳ ${label}: jangan memasang order apa pun sebelum konfirmasi entry terpenuhi.`);
    else if (live.length) bullets.push('- ✅ Pasang hanya order berstatus VALIDATED ORDER, dan hanya bila syarat konfirmasi Bagian 3 terpenuhi.');
    return [`**Aturan Pasang (${lim > 0 ? `batas risiko ${usd(lim)} per arah; ` : ''}dihitung ulang server dari order yang lolos validator):**`, '', ...bullets, ''];
  };
  if (ai >= 0) {
    let k = ai + 1;
    while (k < lines.length && (/^\s*$/.test(lines[k]) || /^\s*(?:[-*]|\d+[.)])\s/.test(lines[k]))) k++;
    lines.splice(ai, k - ai, ...buildBlock());
    notes.push('📝 Blok aturan pasang / kepatuhan risiko dibuat ulang dari tabel 4B final.');
  } else if (live.length || dropped.length) {
    // Gemini tidak menulis blok risiko: sisipkan ringkasan 3 kategori setelah "Rincian Hitung Risiko" agar total lama tidak berdiri sendiri
    const ri = lines.findIndex((l) => /rincian hitung risiko/i.test(l));
    if (ri >= 0) {
      let k = ri + 1;
      while (k < lines.length && (/^\s*$/.test(lines[k]) || /^\s*(?:[-*]|\d+[.)])\s/.test(lines[k]))) k++;
      lines.splice(k, 0, ...buildBlock());
      notes.push('📝 Ringkasan risiko 3 kategori (kandidat awal / ditolak / lolos validator) ditambahkan dari tabel 4B final.');
    }
  }
  // Baris lepas yang masih menyebut total risiko per arah atau saran memilih/memasang zona (sisa narasi Gemini)
  {
    let fence = false, inNote = false, inDetail = false, aturan = false;
    const seen = new Set();
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i];
      if (/^\s*```/.test(t)) { fence = !fence; continue; }
      if (fence) continue;
      if (/🧮\s*\*\*Verifikasi risiko otomatis/i.test(t)) { inNote = true; continue; }
      if (inNote) { if (/^\s*>/.test(t)) continue; inNote = false; }
      if (HDR.test(t)) { aturan = true; continue; }
      if (aturan) { if (/^\s*$/.test(t) || /^\s*(?:[-*]|\d+[.)])\s/.test(t)) continue; aturan = false; }
      if (/rincian hitung risiko/i.test(t)) { inDetail = true; continue; }
      if (/^\s*\|/.test(t) || /^\s*#{1,6}\s/.test(t) || /^\s*\*\*\S/.test(t) && !/^\s*[-*]\s/.test(t)) { inDetail = false; continue; }
      if (/🏷️/.test(t)) continue;
      // Di dalam Rincian Hitung Risiko hanya baris hitung per order yang dibiarkan; baris total/kombinasi lama tetap diperiksa
      if (inDetail && (/[x×*]\s*[\d.,]+\s*[x×*]\s*[\d.]+\s*=\s*\$?[\d.,]+/.test(t) || /tidak ada order|WAIT \/ NO TRADE|^\s*$/.test(t))) continue;
      if (/^\s*(?:#|\*\*Aturan Pasang)/.test(t)) continue;
      const pre = (PREFIX.exec(t) || [''])[0];
      const body = t.slice(pre.length);
      if (/\btotal\s*(?:risiko\s*)?(?:arah\s*)?(?:buy|sell)\b/i.test(body) && /\$\s*\d/.test(body)) {
        const nt = `${pre}Total risiko per arah (dihitung ulang dari order aktif): BUY ${usd(totals.BUY)} | SELL ${usd(totals.SELL)}${lim > 0 ? ` (batas ${usd(lim)} per arah)` : ''}.`;
        if (seen.has('tot')) lines[i] = null; else { seen.add('tot'); lines[i] = nt; }
        continue;
      }
      if (status !== 'TRADE' && /\b(?:pasang|memasang|pilih|disarankan|rekomendasi(?:kan)?|kombinasi)\b/i.test(body) && refsOf(body).length && !/candidate|kandidat|jangan|belum boleh|tidak ada order/i.test(body)) {
        const nt = `${pre}${label} — saran pemasangan/pemilihan order dihapus server: order di 4B hanya berstatus CANDIDATE (belum boleh dipasang) sampai konfirmasi entry terpenuhi.`;
        if (seen.has('adv')) lines[i] = null; else { seen.add('adv'); lines[i] = nt; }
      }
    }
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i] === null) lines.splice(i, 1);
  }
  // Total risiko di catatan verifikasi dihitung ulang dari order yang benar-benar aktif
  const ti = lines.findIndex((l) => /^\s*>\s*-\s*ℹ️\s*Total risiko (?:bila semua order baru terisi|per arah)/.test(l));
  if (ti >= 0) {
    lines[ti] = `> - ℹ️ Total risiko per arah (hanya order lolos validator): BUY ${usd(totals.BUY)} | SELL ${usd(totals.SELL)}${lim ? ` (batas ${usd(lim)} per arah)` : ''}.`;
  }
  return { markdown: lines.join('\n'), notes, totals, live: live.length };
}
