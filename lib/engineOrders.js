// Mesin order deterministik: Entry, SL, TP1, TP2, zona yang terisi dan lot awal ditentukan SERVER dari kandidat zona
// mesin SMC + level struktur. Gemini hanya menulis narasi; angka order di tabel Bagian 3 dan 4B ditimpa dari objek mesin.
// Modul murni (tanpa import) supaya bisa diuji langsung dengan node. Tidak mengubah algoritma BOS/CHoCH, OB/FVG,
// koordinat zona (entryLo/entryHi/sl dari buildZoneCandidates*), maupun rumus risiko (verifyRiskTables tetap menghitung risiko).

export const ENGINE_ORDERS_VERSION = 'engine-orders/1';
export const MIN_RR_Z3 = 2.0; // Zona 3 (Swing, mode 3 zona)
export const MIN_RR_OTHER = 1.5;
export const CAP1 = { 1: 2.5, 2: 3, 3: 5 }; // batas jarak TP1 (kelipatan R) per zona, sama dengan syncTargets
export const CAP2 = { 1: 4, 2: 5, 3: 8 };
const TF_RANK = { M15: 1, H1: 2, H4: 3, D1: 4, W1: 5, MN: 6 };
const TF_OK = new Set(Object.keys(TF_RANK));
const WEIGHTS = { 2: { 1: 40, 2: 60 }, 3: { 1: 20, 2: 35, 3: 45 } }; // porsi risiko per zona (prompt aturan 5)

export const minRrOf = (zone, zones) => (zones === 3 && zone === 3 ? MIN_RR_Z3 : MIN_RR_OTHER);
const rnd = (n, dec) => Number(Number(n).toFixed(dec));
const fmt = (n, dec) => Number(n).toFixed(dec);

/** Level struktur searah profit (swing support/resistance + tepi zona fresh lawan) dari TF M15..MN. Sama dengan pool syncTargets. */
export function structureLevels(analyses = [], side, entry, price) {
  const out = [];
  for (const a of analyses || []) {
    if (a?.status !== 'OK' || !TF_OK.has(a.timeframe)) continue;
    const rank = TF_RANK[a.timeframe];
    if (side === 'SELL') {
      for (const s of a.supports || []) if (s.price < entry && s.price < price) out.push({ price: s.price, tf: a.timeframe, rank, kind: 'support' });
      for (const z of a.zones || []) if (z.type === 'BULLISH' && z.high < entry && z.high < price) out.push({ price: z.high, tf: a.timeframe, rank, kind: 'zone' });
    } else {
      for (const s of a.resistances || []) if (s.price > entry && s.price > price) out.push({ price: s.price, tf: a.timeframe, rank, kind: 'resistance' });
      for (const z of a.zones || []) if (z.type === 'BEARISH' && z.low > entry && z.low > price) out.push({ price: z.low, tf: a.timeframe, rank, kind: 'zone' });
    }
  }
  return out;
}

/**
 * Pilih TP1/TP2 dari level struktur. Tidak ada level valid -> tp1 = null (NO TRADE / evaluasi manual); TIDAK ada kelipatan R pengganti.
 * TP1 = level terdekat searah profit yang: di sisi benar dari entry, R:R >= standar zona, jarak <= batas zona.
 * Seri jarak sama: TF lebih tinggi lebih dulu, lalu harga lebih kecil (urutan input tidak berpengaruh).
 */
export function selectTargets({ side, entry, sl, zone, zones = 2, levels = [], buf = 0, dec = 2 }) {
  const dir = side === 'SELL' ? -1 : 1;
  const R = Math.abs(entry - sl);
  const res = { tp1: null, tp2: null, rr1: null, src1: null, src2: null, considered: 0, reason: null };
  if (!(R > 0)) { res.reason = 'jarak SL tidak valid'; return res; }
  const dist = (tp) => dir * (tp - entry);
  const lv = levels
    .map((l) => ({ ...l, tp: rnd(l.price - dir * buf, dec) }))
    .filter((l) => Number.isFinite(l.tp) && dist(l.tp) > 0)
    .sort((a, b) => dist(a.tp) - dist(b.tp) || b.rank - a.rank || a.price - b.price);
  res.considered = lv.length;
  const min = minRrOf(zone, zones);
  const cap1 = (CAP1[zone] || 3) * R, cap2 = (CAP2[zone] || 5) * R;
  const p1 = lv.find((l) => dist(l.tp) / R >= min - 0.005 && dist(l.tp) <= cap1 + 1e-9);
  if (!p1) {
    res.reason = lv.length
      ? `tidak ada level struktur dengan R:R >= 1:${min.toFixed(1)} dalam batas ${(CAP1[zone] || 3)}R`
      : 'tidak ada level struktur searah profit';
    return res;
  }
  res.tp1 = p1.tp; res.rr1 = dist(p1.tp) / R; res.src1 = `${p1.tf} ${p1.kind}`;
  const p2 = lv.find((l) => dist(l.tp) >= 2 * R && dist(l.tp) <= cap2 + 1e-9 && dist(l.tp) > dist(p1.tp) + 0.5 * R);
  if (p2) { res.tp2 = p2.tp; res.src2 = `${p2.tf} ${p2.kind}`; }
  return res;
}

const sideKey = (s) => (s === 'SELL' ? 'SELL' : 'BUY');

/**
 * Bangun semua kandidat order dari kandidat zona mesin. Urutan evaluasi TETAP: BUY Z1,Z2,Z3 lalu SELL Z1,Z2,Z3.
 * Lot awal: porsi risiko per zona (dinormalkan di antara zona yang LOLOS validator pada arah itu) / (jarak x pengali), lewat lotFor.
 * Batas risiko per order / per arah tetap diterapkan verifyRiskTables sesudahnya (rumus tidak diubah).
 */
export function buildEngineOrders({ zoneRes, analyses = [], price = 0, atrH1 = 0, dec = 2, zones = 2, zonesOff = [], riskUsd = 0, lotFor = null } = {}) {
  const buf = atrH1 > 0 ? atrH1 * 0.1 : price * 0.001;
  const off = new Set(zonesOff || []);
  const orders = [];
  const zl = zones === 3 ? [1, 2, 3] : [1, 2];
  for (const side of ['BUY', 'SELL']) {
    for (const zone of zl) {
      const o = { side, zone, status: 'NONE', reason: null, entryLo: null, entryHi: null, limit: null, sl: null, tp1: null, tp2: null, rr: null, dist: null, lot: null, src: null, score: null, srcTp1: null, srcTp2: null };
      orders.push(o);
      if (off.has(zone)) { o.reason = 'zona dinonaktifkan di Pengaturan'; o.off = true; continue; }
      const c = zoneRes?.[side]?.[zone];
      if (!c || !Number.isFinite(c.entryLo) || !Number.isFinite(c.entryHi) || !Number.isFinite(c.sl)) { o.reason = 'tidak ada kandidat zona fresh'; o.noCand = true; continue; }
      const limit = side === 'SELL' ? c.entryLo : c.entryHi; // konvensi guard: limit = tepi zona terdekat harga
      o.entryLo = rnd(c.entryLo, dec); o.entryHi = rnd(c.entryHi, dec); o.limit = rnd(limit, dec); o.sl = rnd(c.sl, dec);
      o.src = c.src || null; o.score = Number.isFinite(c.score) ? c.score : null;
      const slOk = side === 'SELL' ? o.sl > o.limit : o.sl < o.limit;
      if (!slOk) { o.reason = 'SL tidak berada di sisi yang benar dari entry'; continue; }
      o.dist = rnd(Math.abs(o.limit - o.sl), dec);
      const t = selectTargets({ side, entry: o.limit, sl: o.sl, zone, zones, levels: structureLevels(analyses, side, o.limit, price), buf, dec });
      if (t.tp1 == null) { o.reason = `tidak ada target struktural valid (${t.reason})`; o.noTarget = true; continue; }
      o.tp1 = t.tp1; o.tp2 = t.tp2; o.rr = rnd(t.rr1, 2); o.srcTp1 = t.src1; o.srcTp2 = t.src2;
      o.status = 'OK';
    }
  }
  // Lot awal: setelah SEMUA kandidat terbentuk (porsi dinormalkan di antara yang lolos), urutan tetap.
  const w = WEIGHTS[zones === 3 ? 3 : 2];
  for (const side of ['BUY', 'SELL']) {
    const act = orders.filter((o) => o.side === side && o.status === 'OK');
    const tot = act.reduce((s, o) => s + (w[o.zone] || 0), 0);
    for (const o of act) {
      const budget = tot > 0 && riskUsd > 0 ? (riskUsd * (w[o.zone] || 0)) / tot : 0;
      o.budget = budget;
      o.lot = typeof lotFor === 'function' && budget > 0 ? lotFor(o.dist, budget) : null;
    }
  }
  return { orders, version: ENGINE_ORDERS_VERSION, sha: ordersSignature(orders) };
}

/** Tanda tangan deterministik (teks) dari objek mesin: dipakai tes & audit; tidak memuat jam/expiry. */
export function ordersSignature(orders = []) {
  return orders
    .map((o) => [o.side, o.zone, o.status, o.limit, o.entryLo, o.entryHi, o.sl, o.tp1, o.tp2, o.rr, o.dist, o.lot].join(':'))
    .join('|');
}

// ───────────────────────── penulisan ke tabel markdown ─────────────────────────
const splitRow = (line) => String(line).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSep = (line) => /^\s*\|?\s*:?-{2,}/.test(String(line)) && !/[A-Za-z0-9]/.test(String(line).replace(/[|:\-\s]/g, ''));
const clean = (t) => String(t || '').replace(/[*`]/g, '').trim();
const sideOfName = (name) => { const t = name.toLowerCase(); const s = t.search(/sell/), b = t.search(/buy/); if (s < 0 && b < 0) return null; return s >= 0 && (b < 0 || s < b) ? 'SELL' : 'BUY'; };
const zoneOfName = (name) => (/zona\s*1/i.test(name) ? 1 : /zona\s*2/i.test(name) ? 2 : /zona\s*3/i.test(name) ? 3 : null);
const findCol = (h, re, ex) => h.findIndex((x) => re.test(x) && !(ex && ex.test(x)));
const STYLE = { 2: { 1: 'Intraday', 2: 'Swing' }, 3: { 1: 'Scalping', 2: 'Intraday', 3: 'Swing' } };

const SEC3_HEAD = ['Zona & Strategi', 'Zona Entry', 'Stop Loss (SL)', 'Take Profit 1 (TP1)', 'Take Profit 2 (TP2)', 'Syarat Konfirmasi Candlestick'];
const B4_HEAD = ['Order', 'Harga Entry', 'Stop Loss', 'Take Profit', 'Jarak SL', 'Lot Aman', 'Risiko ($)', 'R:R', 'Waktu Berakhir (WIB)'];

const noSetupSec3 = (o) => `Tidak ada level valid (tunggu)${o.noTarget ? ' — tidak ada target struktural valid' : ''}`;
const noSetup4b = (o) => (o.noTarget ? 'Tidak Ada Setup (Tidak Ada Target Struktural Valid: Tidak Dipasang)' : 'Tidak Ada Setup (Tunggu)');

function defaultExpiry(o, zones, now, fmtExp) {
  if (typeof fmtExp !== 'function') return '-';
  const swing = zones === 3 ? o.zone === 3 : o.zone === 2;
  return fmtExp(now.getTime() + (swing ? 24 : 5) * 3600e3);
}

/**
 * Timpa Bagian 3 dan 4B dengan objek mesin. Yang dipertahankan dari tulisan model: nama baris, kolom konfirmasi (narasi),
 * baris "Sudah Terpasang (Lihat 4A)" (berasal dari order user di screenshot), dan Waktu Berakhir bila terbaca valid.
 * @returns {{markdown:string, notes:string[], overrides:object[]}}
 */
export function lockToEngine(markdown, eng, { dec = 2, zones = 2, now = new Date(), fmtExp = null, lotStr = null, parseExp = null } = {}) {
  const orders = eng?.orders || [];
  const lines = String(markdown || '').split('\n');
  const notes = [];
  const overrides = [];
  const bySZ = new Map(orders.map((o) => [`${o.side}|${o.zone}`, o]));
  const zl = zones === 3 ? [1, 2, 3] : [1, 2];
  const lotTxt = (n) => (typeof lotStr === 'function' ? lotStr(n) : Number(n).toFixed(2));
  const slots3 = []; for (const s of ['BUY', 'SELL']) for (const z of zl) slots3.push([s, z]);
  const slots4 = []; for (const s of ['SELL', 'BUY']) for (const z of zl) slots4.push([s, z]);
  let found3 = false, found4 = false;

  const rebuild = (kind, h, body) => {
    const cEntry = findCol(h, /entry/, /syarat|konfirmasi/);
    const cSl = findCol(h, /stop loss|^sl\b/, /jarak/);
    const cTp1 = kind === 'sec3' ? findCol(h, /take profit 1|tp1/) : findCol(h, /take profit|^tp\b/);
    const cTp2 = kind === 'sec3' ? findCol(h, /take profit 2|tp2/) : -1;
    const cJarak = findCol(h, /jarak/);
    const cLot = findCol(h, /\blot\b/);
    const cRisk = findCol(h, /risiko/);
    const cRR = findCol(h, /^r\s*[:/]\s*r$|risk.?reward|\brr\b/);
    const cExp = findCol(h, /berakhir|expir|kedaluwarsa/);
    const cConf = kind === 'sec3' ? findCol(h, /konfirmasi|syarat/) : -1;
    const used = new Set();
    const out = [];
    for (const [side, zone] of kind === 'sec3' ? slots3 : slots4) {
      const o = bySZ.get(`${side}|${zone}`);
      const idx = body.findIndex((cells, i) => !used.has(i) && sideOfName(clean(cells[0])) === side && zoneOfName(clean(cells[0])) === zone);
      if (idx >= 0) used.add(idx);
      let cells = idx >= 0 ? body[idx].slice() : null;
      if (!o) { if (cells) out.push(cells); continue; }
      const prevEntry = cells && cEntry >= 0 ? String(cells[cEntry] || '') : '';
      if (/terpasang/i.test(prevEntry) && !o.off) { out.push(cells); continue; } // order user terpasang (4A): bukan keputusan model atas zona
      const width = h.length;
      const base = cells || Array.from({ length: width }, () => '-');
      while (base.length < width) base.push('-');
      cells = base;
      if (idx < 0) cells[0] = kind === 'sec3' ? `${side} Zona ${zone} - ${STYLE[zones === 3 ? 3 : 2][zone]}` : `${side === 'SELL' ? 'Sell' : 'Buy'} Limit Zona ${zone} (${STYLE[zones === 3 ? 3 : 2][zone]})`;
      const before = cells.join('|');
      const ok = o.status === 'OK';
      const set = (c, v) => { if (c >= 0 && c < cells.length) cells[c] = v; };
      if (ok) {
        if (kind === 'sec3') {
          set(cEntry, `${fmt(o.entryLo, dec)} - ${fmt(o.entryHi, dec)}`); set(cSl, fmt(o.sl, dec)); set(cTp1, fmt(o.tp1, dec)); set(cTp2, o.tp2 != null ? fmt(o.tp2, dec) : '-');
          if (cConf >= 0 && (idx < 0 || !cells[cConf] || cells[cConf] === '-')) cells[cConf] = 'Tunggu candle close konfirmasi di zona (CHoCH/engulfing TF kecil) sebelum entry.';
        } else {
          set(cEntry, fmt(o.limit, dec)); set(cSl, fmt(o.sl, dec)); set(cTp1, fmt(o.tp1, dec)); set(cJarak, fmt(o.dist, dec));
          set(cLot, o.lot != null ? lotTxt(o.lot) : '-'); set(cRisk, '-'); set(cRR, `1:${o.rr.toFixed(2)}`);
          if (cExp >= 0) {
            const cur = cells[cExp] || '';
            const t = typeof parseExp === 'function' ? parseExp(cur) : null;
            if (!(t != null && t > now.getTime())) cells[cExp] = defaultExpiry(o, zones, now, fmtExp);
          }
        }
      } else {
        cells = cells.map((c, k) => (k === 0 ? c : '-'));
        if (!o.off) cells = cells.map((c, k) => (k === 0 ? c.replace(/\s*[🚫⛔]+\s*$/u, '') : c));
        set(cEntry, kind === 'sec3' ? noSetupSec3(o) : noSetup4b(o));
      }
      if (cells.join('|') !== before) overrides.push({ kind, side, zone, status: o.status });
      out.push(cells);
    }
    body.forEach((cells, i) => { if (!used.has(i)) out.push(cells); });
    return out;
  };

  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSep(lines[i + 1])) continue;
    const h = splitRow(lines[i]).map((x) => x.toLowerCase());
    const h0 = h[0] || '';
    const kind = /zona.*strategi/.test(h0) ? 'sec3' : /^order$/.test(h0) && h.some((x) => /lot/.test(x)) ? '4b' : null;
    let j = i + 2;
    while (j < lines.length && lines[j].trim().startsWith('|')) j++;
    if (!kind) { i = j - 1; continue; }
    if ((kind === 'sec3' && found3) || (kind === '4b' && found4)) { i = j - 1; continue; }
    const rows = rebuild(kind, h, lines.slice(i + 2, j).map(splitRow)).map((c) => `| ${c.join(' | ')} |`);
    lines.splice(i + 2, j - (i + 2), ...rows);
    if (kind === 'sec3') found3 = true; else found4 = true;
    i = i + 2 + rows.length - 1;
  }

  const text = lines.join('\n');
  // Tabel yang tidak ada sama sekali (model rusak/format lain): sisipkan tabel standar dari mesin.
  let out = text;
  if (!found3 || !found4) {
    const add = [];
    const mk = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows].join('\n');
    const blank = (head) => Array.from({ length: head.length }, () => '-');
    if (!found3) {
      const rows = [];
      for (const [s, z] of slots3) { const c = blank(SEC3_HEAD); c[0] = `${s} Zona ${z} - ${STYLE[zones === 3 ? 3 : 2][z]}`; rows.push(c); }
      const r = rebuild('sec3', SEC3_HEAD.map((x) => x.toLowerCase()), rows).map((c) => `| ${c.join(' | ')} |`);
      add.push(`### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)\n${mk(SEC3_HEAD, r)}`);
    }
    if (!found4) {
      const rows = [];
      for (const [s, z] of slots4) { const c = blank(B4_HEAD); c[0] = `${s === 'SELL' ? 'Sell' : 'Buy'} Limit Zona ${z} (${STYLE[zones === 3 ? 3 : 2][z]})`; rows.push(c); }
      const r = rebuild('4b', B4_HEAD.map((x) => x.toLowerCase()), rows).map((c) => `| ${c.join(' | ')} |`);
      add.push(`**4B. Order Baru yang Disarankan**\n${mk(B4_HEAD, r)}`);
    }
    out = `${out.trimEnd()}\n\n${add.join('\n\n')}\n`;
    notes.push(`🧱 Tabel ${[!found3 && 'Bagian 3', !found4 && '4B'].filter(Boolean).join(' & ')} tidak terbaca dari model: dibuat dari hasil mesin.`);
  }
  const nOver = overrides.length;
  if (nOver) notes.push(`🔒 Angka order (Entry/SL/TP/lot/zona terisi) ditetapkan mesin server; ${nOver} baris tabel menyimpang dari tulisan model dan ditimpa.`);
  for (const o of orders) {
    if (o.noTarget) notes.push(`🎯 ${o.side} Zona ${o.zone}: ${o.reason} → NO TRADE untuk zona ini (evaluasi manual; server tidak membuat TP pengganti).`);
  }
  return { markdown: out, notes, overrides };
}

/** Baris "Rincian Hitung Risiko"/"Skenario Batal" untuk zona tanpa order mengikuti mesin (zona tanpa setup tidak punya angka). */
export function clearDeadDetail(markdown, eng) {
  const dead = (eng?.orders || []).filter((o) => o.status !== 'OK');
  if (!dead.length) return markdown;
  const lines = String(markdown).split('\n');
  let inDetail = false;
  for (let k = 0; k < lines.length; k++) {
    const t = lines[k];
    if (/rincian hitung risiko/i.test(t)) { inDetail = true; continue; }
    if (!inDetail) continue;
    if (/^\s*#{1,6}\s/.test(t) || /^\s*\|/.test(t)) { inDetail = false; continue; }
    const m = t.match(/^(\s*[-*]\s+)(.+?):\s*\d/);
    if (!m) continue;
    const sd = sideOfName(m[2]), zn = zoneOfName(m[2]);
    if (dead.some((o) => o.side === sd && o.zone === zn)) lines[k] = `${m[1]}${m[2]}: tidak ada order (${dead.find((o) => o.side === sd && o.zone === zn).reason})`;
  }
  return lines.join('\n');
}

/** Tanda tangan tabel FINAL 4B (setelah semua validator): untuk audit/tes determinisme. */
export function finalTableSignature(markdown = '') {
  const rows = [];
  const lines = String(markdown).split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSep(lines[i + 1])) continue;
    const h = splitRow(lines[i]).map((x) => x.toLowerCase());
    const kind = /zona.*strategi/.test(h[0] || '') ? 'S3' : /^order$/.test(h[0] || '') && h.some((x) => /lot/.test(x)) ? '4B' : null;
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      if (!kind) continue;
      const cells = splitRow(lines[j]);
      const idx = kind === 'S3' ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6, 7];
      const nm = clean(cells[0] ?? '');
      const key = sideOfName(nm) && zoneOfName(nm) ? `${sideOfName(nm)}${zoneOfName(nm)}` : nm; // teks nama/label = narasi, bukan angka
      rows.push(`${kind}:${key};${idx.slice(1).map((k) => clean(cells[k] ?? '')).join(';')}`);
    }
    i = j - 1;
  }
  return rows.join('\n');
}

/**
 * Kerangka analisa dari mesin saja (Gemini gagal / balasan tidak terbaca). Angka order tetap dari mesin;
 * TIDAK ada narasi karangan. Dipakai sebagai masukan runChecks sehingga validator dan keputusan server tetap berjalan.
 */
export function engineSkeleton({ eng, pairId = '', price = 0, dec = 2, bias = 'NETRAL', atr = null, zones = 2, mult = null, reason = '' }) {
  const head = bias === 'BULLISH' || bias === 'BEARISH' ? bias : 'NETRAL - WAIT & SEE';
  const L = [];
  L.push(`**BIAS UTAMA: ${head}**`);
  L.push(`**PAIR:** ${pairId}`);
  L.push(`**HARGA TERAKHIR:** ${fmt(price, dec)}`);
  if (atr && (atr.h1 || atr.h4)) L.push(`**ATR:** H1 ${atr.h1 ? fmt(atr.h1, dec) : '-'} | H4 ${atr.h4 ? fmt(atr.h4, dec) : '-'}`);
  L.push('');
  L.push(`> ⚠️ **NARASI AI TIDAK TERSEDIA — TABEL MESIN TETAP DITAMPILKAN.**${reason ? ` (${reason})` : ''}`);
  L.push('> Angka di bawah ditetapkan mesin server dari struktur candle. Ini BUKAN konfirmasi bahwa setup sudah aktif: konfirmasi candle tetap wajib dan keputusan mengikuti blok Keputusan Server.');
  L.push('');
  L.push('### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)');
  L.push(`| ${SEC3_HEAD.join(' | ')} |`, `| ${SEC3_HEAD.map(() => '---').join(' | ')} |`);
  L.push('', '### 4. Rekomendasi Susunan Pending Order', '', '**4A. Audit Posisi & Pending Order User**', 'Tidak ada data order terpasang (narasi AI tidak tersedia).', '', '**4B. Order Baru yang Disarankan**');
  L.push(`| ${B4_HEAD.join(' | ')} |`, `| ${B4_HEAD.map(() => '---').join(' | ')} |`);
  L.push('', '**Rincian Hitung Risiko**');
  const ok = (eng?.orders || []).filter((o) => o.status === 'OK');
  for (const o of ok) L.push(`- ${o.side === 'SELL' ? 'Sell' : 'Buy'} Limit Zona ${o.zone} (${STYLE[zones === 3 ? 3 : 2][o.zone]}): ${o.lot != null ? Number(o.lot).toFixed(2) : '0.01'} lot x ${fmt(o.dist, dec)} x ${mult || 1} = $0.00`);
  L.push('', '**Skenario Batal (Invalidation Level):**');
  for (const o of ok) L.push(`- ${o.side === 'SELL' ? 'Sell' : 'Buy'} Zona ${o.zone}: batal bila candle close menembus SL ${fmt(o.sl, dec)}.`);
  if (!ok.length) L.push('- Tidak ada order aktif.');
  L.push('', '**Manajemen Posisi:** tidak tersedia tanpa narasi AI; ikuti tabel dan keputusan server.', '', '_Bukan saran keuangan. Selalu gunakan manajemen risiko._');
  return L.join('\n');
}

/** Blok prompt: order FINAL dari mesin. Model hanya menjelaskan; angka ditimpa server apa pun yang model tulis. */
export function engineOrdersPrompt(eng, dec = 2, zones = 2) {
  if (!eng?.orders?.length) return '';
  const L = ['=== ORDER MESIN (FINAL — DITETAPKAN SERVER, TIDAK BOLEH DIUBAH) ==='];
  L.push('Entry, SL, TP1, TP2, zona yang terisi, lot, R:R dan keputusan ditentukan server. Tugas Anda HANYA: menjelaskan kondisi pasar, narasi/edukasi, syarat konfirmasi candle, dan risiko. Salin angka di bawah persis; jangan menggeser, menambah, atau mengganti zona/TP. Server menimpa angka yang berbeda.');
  for (const o of eng.orders) {
    const nm = `${o.side} Zona ${o.zone} (${STYLE[zones === 3 ? 3 : 2][o.zone]})`;
    if (o.status === 'OK') L.push(`- ${nm}: Entry limit ${fmt(o.limit, dec)} (zona ${fmt(o.entryLo, dec)}-${fmt(o.entryHi, dec)}), SL ${fmt(o.sl, dec)}, TP1 ${fmt(o.tp1, dec)}${o.tp2 != null ? `, TP2 ${fmt(o.tp2, dec)}` : ', TP2 kosong'}, R:R 1:${o.rr.toFixed(2)}`);
    else L.push(`- ${nm}: TIDAK ADA SETUP (${o.reason}). Tulis baris kosong ("Tidak ada level valid (tunggu)"); jangan mengarang level.`);
  }
  L.push('=== AKHIR ORDER MESIN ===');
  return L.join('\n');
}
