// Penjaga server: SMC = sumber kebenaran. Order (Bagian 3 & 4B) yang entry-nya tidak berada di OB/FVG fresh
// searah diganti "Tidak ada level valid (tunggu)" / "Tidak Ada Setup (Tunggu)". Juga menyamakan SL Bagian 3 dengan 4B.
// Tanpa import alias supaya bisa diuji dengan node.
import { priceDec } from './fmt.js';

const splitRow = (line) => String(line).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSep = (line) => /^\s*\|?\s*:?-{2,}/.test(String(line)) && !/[A-Za-z0-9]/.test(String(line).replace(/[|:\-\s]/g, ''));
const clean = (t) => String(t || '').replace(/[*`]/g, '').trim();
const norm = (t) => clean(t).replace(/🚫|⛔/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function sideOf(name) {
  const t = name.toLowerCase();
  const s = t.search(/sell/), b = t.search(/buy/);
  if (s < 0 && b < 0) return null;
  return s >= 0 && (b < 0 || s < b) ? 'SELL' : 'BUY';
}
const zoneOf = (name) => (/zona\s*1/i.test(name) ? 1 : /zona\s*2/i.test(name) ? 2 : /zona\s*3/i.test(name) ? 3 : null);
const findCol = (h, re, ex) => h.findIndex((x) => re.test(x) && !(ex && ex.test(x)));

/**
 * Matikan zona tertentu (mis. Zona 1 Scalping) pada tabel Bagian 3 dan 4B: baris diganti
 * "Tidak ada level valid (tunggu)" / "Tidak Ada Setup (Tunggu)". Deterministik, tidak bergantung pada model.
 */
export function disableZoneRows(markdown, zonesOff = []) {
  const off = new Set(zonesOff);
  if (!off.size) return { markdown, notes: [], disabled: [] };
  const lines = String(markdown).split('\n');
  const disabled = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSep(lines[i + 1])) continue;
    const h = splitRow(lines[i]).map((x) => x.toLowerCase());
    const h0 = h[0] || '';
    const kind = /zona.*strategi/.test(h0) ? 'sec3' : /^order$/.test(h0) && h.some((x) => /lot/.test(x)) ? '4b' : null;
    let j = i + 2;
    if (!kind) { while (j < lines.length && lines[j].trim().startsWith('|')) j++; i = j - 1; continue; }
    const cEntry = findCol(h, /entry/, /syarat|konfirmasi/);
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const cells = splitRow(lines[j]);
      const name = clean(cells[0]);
      const side = sideOf(name), zone = zoneOf(name);
      if (!side || !off.has(zone) || cEntry < 0 || cEntry >= cells.length) continue;
      const out = cells.map(() => '-');
      out[0] = `${cells[0]} 🚫`;
      out[cEntry] = kind === '4b' ? 'Tidak Ada Setup (Tunggu)' : 'Tidak ada level valid (tunggu)';
      lines[j] = `| ${out.join(' | ')} |`;
      disabled.push({ kind, side, zone });
    }
    i = j - 1;
  }
  return { markdown: lines.join('\n'), notes: disabled.length ? [`🚫 Zona ${[...off].join(', ')} dinonaktifkan di Pengaturan (${disabled.length} baris dikosongkan).`] : [], disabled };
}

export function enforceSmcZones(markdown, { analyses, atrH1 = 0, price = 0, priceRe = /\d+(?:\.\d+)?/, candidates = null } = {}) {
  const zones = [];
  for (const a of analyses || []) {
    if (a.status !== 'OK' || a.timeframe === 'M1') continue;
    for (const z of a.zones || []) zones.push({ type: z.type, low: z.low, high: z.high, tf: a.timeframe, src: z.source === 'FVG' ? 'FVG' : 'OB' });
  }
  if (!zones.length && !(analyses || []).some((a) => a.status === 'OK')) return { markdown, notes: [], neutralized: [] };
  const tol = (atrH1 > 0 ? atrH1 * 0.1 : price * 0.001) || 0;
  const re = new RegExp(priceRe.source, 'g');
  const nums = (cell) => (String(cell).replace(/,/g, '').match(re) || []).map(parseFloat).filter((n) => n > 0);
  const lines = markdown.split('\n');
  const notes = [];
  const neutralized = []; // { kind, side, zone, name }
  const rows = []; // untuk sinkron SL
  const snapped = [];

  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSep(lines[i + 1])) continue;
    const h = splitRow(lines[i]).map((x) => x.toLowerCase());
    const h0 = h[0] || '';
    const kind = /zona.*strategi/.test(h0) ? 'sec3' : /^order$/.test(h0) && h.some((x) => /lot/.test(x)) ? '4b' : null;
    let j = i + 2;
    if (!kind) { while (j < lines.length && lines[j].trim().startsWith('|')) j++; i = j - 1; continue; }
    const cEntry = findCol(h, /entry/, /syarat|konfirmasi/);
    const cSl = findCol(h, /stop loss|^sl\b/, /jarak/);
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const cells = splitRow(lines[j]);
      const name = clean(cells[0]);
      const side = sideOf(name), zone = zoneOf(name);
      if (!side || cEntry < 0 || cEntry >= cells.length) continue;
      if (/tidak ada|tunggu/i.test(cells[cEntry])) { rows.push({ kind, side, zone, j, cells, cSl, entry: null }); continue; }
      const ev = nums(cells[cEntry]);
      if (!ev.length) continue;
      const lo = Math.min(...ev), hi = Math.max(...ev);
      const want = side === 'SELL' ? 'BEARISH' : 'BULLISH';
      // W1/MN hanya konteks bias/makro: TIDAK boleh membuat entry valid (hanya overlap W1/MN => order dibatalkan).
      const hits = zones.filter((z) => z.type === want && z.tf !== 'W1' && z.tf !== 'MN' && lo <= z.high + tol && hi >= z.low - tol);
      const ok = hits.length > 0;
      if (ok && kind === 'sec3') {
        // Dasar = bukti dari mesin (bukan karangan model). Zona sangat lebar (> 2.5 x ATR H1) tidak dihitung sebagai konfluensi.
        // W1/MN hanya konteks bias, bukan bukti entry; zona > 2.5 x ATR H1 tidak presisi. Tanpa fallback ke zona lebar.
        const precise = hits.filter((z) => z.tf !== 'W1' && z.tf !== 'MN' && (atrH1 > 0 ? z.high - z.low <= 2.5 * atrH1 : true));
        const basis = precise.length ? [...new Set(precise.map((z) => `${z.tf} ${z.src}`))].slice(0, 4).join(', ') : 'tidak ada bukti konfluensi presisi (zona HTF terlalu lebar / hanya W1-MN)';
        const last = cells.length - 1;
        const cur = cells[last] || '';
        if (/dasar\s*:/i.test(cur)) {
          const next = cur.replace(/(dasar\s*:\s*).*$/i, `$1${basis}`);
          if (next !== cur) { cells[last] = next; notes.push(`🧱 ${side} Zona ${zone}: "Dasar" disamakan dengan bukti mesin (${basis}); zona terlalu lebar tidak dihitung sebagai konfluensi.`); }
        } else if (!/dasar\s*:/i.test(lines[j])) {
          cells[last] = `${cur && cur !== '-' ? cur + ' · ' : ''}Dasar: ${basis}`;
        }
        lines[j] = `| ${cells.join(' | ')} |`;
      }
      if (!ok) {
        const shown = ev.length > 1 ? `${lo}–${hi}` : String(lo);
        const out = cells.map(() => '-');
        out[0] = `${cells[0]} ⛔`;
        out[cEntry] = kind === '4b' ? 'Tidak Ada Setup (Tunggu)' : 'Tidak ada level valid (tunggu)';
        lines[j] = `| ${out.join(' | ')} |`;
        neutralized.push({ kind, side, zone, name, shown });
        continue;
      }
      // Selaraskan ke kandidat server (entry di zona premium/discount, SL di luar zona) bila model menyimpang
      const cand = candidates?.[side]?.[zone];
      let entryNow = ev[0];
      if (cand && cand.sl != null) {
        const f2 = (n) => n.toFixed(priceDec(price));
        const slNow = cSl >= 0 ? nums(cells[cSl] || '')[0] : null;
        const limit = side === 'SELL' ? cand.entryLo : cand.entryHi;
        const offEntry = kind === 'sec3' ? Math.abs(lo - cand.entryLo) > tol || Math.abs(hi - cand.entryHi) > tol : Math.abs(ev[0] - limit) > tol;
        const slBad = slNow == null || (side === 'SELL' ? slNow < cand.sl - tol : slNow > cand.sl + tol);
        if (offEntry || slBad) {
          cells[cEntry] = kind === 'sec3' ? `${f2(cand.entryLo)} - ${f2(cand.entryHi)}` : f2(limit);
          if (cSl >= 0) cells[cSl] = f2(cand.sl);
          lines[j] = `| ${cells.join(' | ')} |`;
          entryNow = kind === 'sec3' ? cand.entryLo : limit;
          if (kind === '4b') snapped.push(`📐 ${side} Zona ${zone}: entry/SL diselaraskan ke struktur (limit ${f2(limit)}, SL ${f2(cand.sl)} di luar zona; sebelumnya ${ev[0]}${slNow != null ? ` / SL ${slNow}` : ''}).`);
        }
      }
      rows.push({ kind, side, zone, j, cells, cSl, entry: entryNow });
    }
    i = j - 1;
  }

  notes.push(...snapped);
  for (const side of ['SELL', 'BUY']) {
    const list = neutralized.filter((n) => n.side === side);
    if (!list.length) continue;
    const byZone = new Map();
    for (const n of list) if (!byZone.has(n.zone)) byZone.set(n.zone, n.shown);
    const txt = [...byZone.entries()].sort((a, b) => (a[0] ?? 9) - (b[0] ?? 9)).map(([z, v]) => `Zona ${z ?? '?'} (${v})`).join(', ');
    notes.push(`⛔ ${side} ${txt}: bukan OB/FVG ${side === 'SELL' ? 'bearish' : 'bullish'} fresh → order dibatalkan (tunggu zona valid).`);
  }

  // Sinkron SL Bagian 3 -> 4B (angka 4B yang dipakai menghitung risiko)
  for (const r3 of rows.filter((r) => r.kind === 'sec3' && r.entry != null && r.cSl >= 0)) {
    const r4 = rows.find((r) => r.kind === '4b' && r.side === r3.side && r.zone === r3.zone && r.entry != null && r.cSl >= 0);
    if (!r4) continue;
    const s3 = nums(r3.cells[r3.cSl])[0], s4 = nums(r4.cells[r4.cSl])[0];
    if (s3 != null && s4 != null && Math.abs(s3 - s4) > Math.pow(10, -priceDec(price)) * 0.5) { // selisih 1 tick pun disamakan (sebelumnya toleransi 0.02×ATR meloloskan SL 3605.00 vs 3605.27)
      notes.push(`🔁 ${r3.side} Zona ${r3.zone}: SL Bagian 3 (${s3}) disamakan dengan 4B (${s4}).`);
      r3.cells[r3.cSl] = r4.cells[r4.cSl];
      lines[r3.j] = `| ${r3.cells.join(' | ')} |`;
    }
  }

  // Baris "Rincian Hitung Risiko" untuk order yang dibatalkan
  const dead = new Set(neutralized.filter((n) => n.kind === '4b').map((n) => norm(n.name)));
  if (dead.size) {
    let inDetail = false;
    for (let k = 0; k < lines.length; k++) {
      const t = lines[k];
      if (/rincian hitung risiko/i.test(t)) { inDetail = true; continue; }
      if (!inDetail) continue;
      if (/^\s*#{1,6}\s/.test(t) || /^\s*\|/.test(t)) { inDetail = false; continue; }
      const m = t.match(/^(\s*[-*]\s+)(.+?):\s*\d/);
      if (m && dead.has(norm(m[2]))) lines[k] = `${m[1]}${m[2]}: tidak ada order (tunggu zona SMC fresh)`;
    }
  }

  const waitSides = [];
  for (const side of ['SELL', 'BUY']) {
    const all = neutralized.filter((n) => n.side === side && n.kind === '4b');
    const alive = rows.filter((r) => r.kind === '4b' && r.side === side && r.entry != null);
    if (all.length && !alive.length) { waitSides.push(side); notes.push(`⏸ ${side}: tidak ada zona valid → WAIT, tidak ada pending order ${side}.`); }
  }
  if (waitSides.length) {
    let inScen = false;
    for (let k = 0; k < lines.length; k++) {
      const t = lines[k];
      if (/skenario batal/i.test(t)) { inScen = true; continue; }
      if (inScen && (/^\s*#{1,6}\s/.test(t) || /^\s*\*\*(?!Skenario)/.test(t))) inScen = false;
      if (inScen) {
        for (const sd of waitSides) {
          const w = sd === 'SELL' ? 'sell' : 'buy';
          if (new RegExp(`^\\s*[-*]\\s*(setup\\s+)?${w}\\b`, 'i').test(t)) lines[k] = `- Setup ${sd === 'SELL' ? 'Sell' : 'Buy'}: tidak ada order (WAIT, tidak ada zona valid).`;
        }
      }
      if (/level kunci/i.test(t) && /^\s*>/.test(t)) {
        let u = t;
        for (const sd of waitSides) {
          const key = sd === 'BUY' ? '(?:Support|Demand)' : '(?:Resist(?:an)?ce|Resistansi|Supply)';
          u = u.replace(new RegExp(`[,;/]?\\s*${key}\\s*:?\\s*\\d[\\d.,]*(?:\\s*[-–]\\s*\\d[\\d.,]*)?(?:\\s*\\([^)]*\\))?`, 'gi'), '');
        }
        if (u !== t) { lines[k] = u.replace(/:\s*[,;/]\s*/, ': ').replace(/\s+$/, ''); notes.push(`🧹 Level kunci arah ${waitSides.join('/')} yang dibatalkan dihapus dari Ringkasan Cepat.`); }
      }
    }
  }

  // Level Kunci Bagian 2: angka harus level SMC (event struktur, swing, tepi zona), bukan harga close/angka sumbu
  const refPrice = price || (analyses || []).find((a) => a.status === 'OK')?.lastPrice || 0;
  const byTf = new Map((analyses || []).filter((a) => a.status === 'OK').map((a) => [a.timeframe, a]));
  let fixedKeys = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSep(lines[i + 1])) continue;
    const h = splitRow(lines[i]).map((x) => x.toLowerCase());
    const cLv = h.findIndex((x) => /level kunci/.test(x));
    let j = i + 2;
    if (cLv >= 0 && /timeframe/.test(h[0] || '')) {
      for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
        const cells = splitRow(lines[j]);
        const a = byTf.get(clean(cells[0]).toUpperCase());
        if (!a || cLv >= cells.length) continue;
        const V = [...(a.structureEvents || []).map((e) => e.level), ...(a.swings || []).map((x) => x.price), ...(a.zones || []).flatMap((z) => [z.low, z.high]), ...(a.supports || []).map((x) => x.price), ...(a.resistances || []).map((x) => x.price)].filter((v) => v > 0);
        if (!V.length || !refPrice) continue;
        const tolV = refPrice * 0.0004;
        cells[cLv] = cells[cLv].replace(/\s*\([^)]*\b[A-Z]\d{1,2},?\d{3}[^)]*\)/g, '').replace(/\s*\((?:harga\s+)?close[^)]*\)/gi, '');
        const present = [];
        let changed = false;
        // Hanya angka berdiri sendiri yang masuk akal sebagai harga: nama TF (H4, M15, D1, W1) dan angka kecil lain tidak disentuh
        cells[cLv] = cells[cLv].replace(/(?<![A-Za-z0-9.,])\d[\d,]*(?:\.\d+)?/g, (tok, off, whole) => {
          const n = parseFloat(tok.replace(/,/g, ''));
          if (!(n > 0)) return tok;
          if (n < refPrice * 0.5 || n > refPrice * 1.5) return tok;
          if (present.some((p) => Math.abs(p - n) <= tolV)) {
            // Tepi bersama dua rentang ("3614.73-3627.55; 3627.55-3645.89") sah: jangan dihapus (meninggalkan "-" menggantung)
            const prev = whole.slice(Math.max(0, off - 2), off), next = whole.slice(off + tok.length, off + tok.length + 2);
            if (/[-–]\s*$/.test(prev) || /^\s*[-–]/.test(next)) return tok;
            changed = true; return '\u0000';
          }
          if (V.some((v) => Math.abs(v - n) <= tolV)) { present.push(n); return tok; }
          const cand = V.filter((v) => !present.some((p) => Math.abs(p - v) <= tolV)).sort((x, y) => Math.abs(x - n) - Math.abs(y - n))[0];
          if (cand == null) return tok;
          present.push(cand);
          changed = true;
          fixedKeys++;
          const dec = (tok.split('.')[1] || '').length;
          return cand.toFixed(dec);
        });
        if (changed) { cells[cLv] = cells[cLv].replace(/,?\s*\$?\u0000(?:\s*\([^)]*\))?/g, '').replace(/^\s*,\s*/, '').replace(/([;,]\s*)[-–]\s*(?=\d)/g, '$1').replace(/\s*[-–]\s*(?=[;,]|$)/g, ''); lines[j] = `| ${cells.join(' | ')} |`; }
      }
    } else { while (j < lines.length && lines[j].trim().startsWith('|')) j++; }
    i = j - 1;
  }
  if (fixedKeys) notes.push(`🧭 Level Kunci Bagian 2: ${fixedKeys} angka bukan level SMC (harga close/angka sumbu) diganti level struktur terdekat dari candle.`);
  return { markdown: lines.join('\n'), notes, neutralized };
}

/**
 * Sinkron target (TP) dari struktur: TP1/TP2 yang buruk (hilang, salah arah, atau R:R < 1.2) diganti.
 * Target = level struktur terdekat searah (swing utuh / tepi zona fresh lawan) dengan jarak >= 1.5R (TP1) dan >= 2.5R (TP2);
 * tanpa level struktur dipakai kelipatan R (1.5R / 3R). Entry & SL tidak diubah. Dipanggil SEBELUM verifikasi risiko (R:R dihitung ulang di sana).
 */
export function syncTargets(markdown, { analyses, atrH1 = 0, price = 0, priceRe = /\d+(?:\.\d+)?/ } = {}) {
  const ok = (analyses || []).filter((a) => a.status === 'OK' && ['M15', 'H1', 'H4', 'D1', 'W1', 'MN'].includes(a.timeframe));
  if (!ok.length) return { markdown, notes: [] };
  const buf = atrH1 > 0 ? atrH1 * 0.1 : price * 0.001;
  const re = new RegExp(priceRe.source, 'g');
  const nums = (cell) => (String(cell).replace(/,/g, '').match(re) || []).map(parseFloat).filter((n) => n > 0);
  const fmtN = (n) => n.toFixed(priceDec(price));
  const lines = markdown.split('\n');
  const rows = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSep(lines[i + 1])) continue;
    const h = splitRow(lines[i]).map((x) => x.toLowerCase());
    const h0 = h[0] || '';
    const kind = /zona.*strategi/.test(h0) ? 'sec3' : /^order$/.test(h0) && h.some((x) => /lot/.test(x)) ? '4b' : null;
    let j = i + 2;
    if (!kind) { while (j < lines.length && lines[j].trim().startsWith('|')) j++; i = j - 1; continue; }
    const cEntry = findCol(h, /entry/, /syarat|konfirmasi/);
    const cSl = findCol(h, /stop loss|^sl\b/, /jarak/);
    const cTp1 = kind === 'sec3' ? findCol(h, /take profit 1|tp1/) : findCol(h, /take profit|^tp\b/);
    const cTp2 = kind === 'sec3' ? findCol(h, /take profit 2|tp2/) : -1;
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const cells = splitRow(lines[j]);
      const name = clean(cells[0]);
      const side = sideOf(name), zone = zoneOf(name);
      if (!side || !zone || cEntry < 0 || cSl < 0 || cTp1 < 0 || cTp1 >= cells.length) continue;
      if (/tidak ada|tunggu|terpasang/i.test(cells[cEntry])) continue;
      const ev = nums(cells[cEntry]);
      const sl = nums(cells[cSl])[0];
      if (!ev.length || sl == null) continue;
      const e = kind === '4b' ? ev[0] : side === 'SELL' ? Math.min(...ev) : Math.max(...ev);
      rows.push({ kind, side, zone, j, cells, cTp1, cTp2, e, sl, tp1: nums(cells[cTp1])[0] ?? null, tp2: cTp2 >= 0 ? nums(cells[cTp2] || '')[0] ?? null : null });
    }
    i = j - 1;
  }
  const notes = [];
  const done = new Map();
  const levelsFor = (side, e) => {
    const out = [];
    for (const a of ok) {
      if (side === 'SELL') {
        for (const s of a.supports || []) if (s.price < e && s.price < price) out.push(s.price);
        for (const z of a.zones || []) if (z.type === 'BULLISH' && z.high < e && z.high < price) out.push(z.high);
      } else {
        for (const s of a.resistances || []) if (s.price > e && s.price > price) out.push(s.price);
        for (const z of a.zones || []) if (z.type === 'BEARISH' && z.low > e && z.low > price) out.push(z.low);
      }
    }
    return out;
  };
  for (const key of new Set(rows.map((r) => `${r.side}|${r.zone}`))) {
    const grp = rows.filter((r) => `${r.side}|${r.zone}` === key);
    const base = grp.find((r) => r.kind === '4b') || grp[0];
    const { side, e, sl } = base;
    const R = Math.abs(sl - e);
    if (!(R > 0)) continue;
    const dir = side === 'SELL' ? -1 : 1;
    const dist = (tp) => dir * (tp - e); // positif = searah profit
    const canon = grp.find((r) => r.kind === 'sec3' && r.tp1 != null) || base; // TP1 resmi = Bagian 3; kolom TP 4B harus sama
    const cur1 = canon.tp1;
    const capZ = { 1: 2.5, 2: 3, 3: 5 }[base.zone] || 3;
    const tooFar = cur1 != null && dist(cur1) > capZ * R;
    const lv = levelsFor(side, e).map((p) => ({ raw: p, tp: p - dir * buf })).filter((x) => dist(x.tp) > 0).sort((a, b) => dist(a.tp) - dist(b.tp));
    const cap1 = { 1: 2.5, 2: 3, 3: 5 }[base.zone] || 3, cap2 = { 1: 4, 2: 5, 3: 8 }[base.zone] || 5; // batas target sesuai gaya zona
    const pick = (minD, maxD, after) => lv.find((x) => dist(x.tp) >= minD && dist(x.tp) <= maxD && (after == null || dist(x.tp) > dist(after) + 0.5 * R));
    // TP terlalu jauh hanya diganti bila ada level struktur dalam batas gaya zona
    // TP1 yang sama dengan harga sekarang bukan level struktur (target sudah "di pasar"): ganti dengan level nyata.
    const atPrice = cur1 != null && price > 0 && Math.abs(cur1 - price) <= Math.max(buf, price * 0.0001);
    const bad1 = cur1 == null || dist(cur1) <= 0 || dist(cur1) < 1.5 * R || atPrice || (tooFar && !!pick(1.5 * R, capZ * R));
    let tp1 = cur1;
    if (bad1) { const p = pick(1.5 * R, cap1 * R); tp1 = p ? p.tp : e + dir * 1.5 * R; }
    const cur2 = base.tp2 ?? grp.find((r) => r.tp2 != null)?.tp2 ?? null;
    const hasTp2 = grp.some((r) => r.cTp2 >= 0);
    let tp2 = cur2;
    if (hasTp2 && (cur2 == null || dist(cur2) < dist(tp1) + 0.5 * R)) { const p = pick(2 * R, cap2 * R, tp1); tp2 = p ? p.tp : e + dir * Math.max(2.5 * R, dist(tp1) + R); }
    const tp2Changed = tp2 !== cur2;
    const mismatch = !bad1 && tp1 != null && grp.some((r) => r.tp1 != null && fmtN(r.tp1) !== fmtN(tp1));
    if (!bad1 && !tp2Changed && !mismatch) continue;
    done.set(key, { tp1, tp2, changed1: bad1, old1: bad1 ? cur1 : null });
    for (const r of grp) {
      let touched = false;
      if (bad1 || r.tp1 == null || (tp1 != null && fmtN(r.tp1) !== fmtN(tp1))) { r.cells[r.cTp1] = fmtN(tp1); touched = true; }
      if (r.cTp2 >= 0 && tp2 != null && tp2Changed) { r.cells[r.cTp2] = fmtN(tp2); touched = true; }
      if (touched) lines[r.j] = `| ${r.cells.join(' | ')} |`;
    }
    notes.push(`🎯 ${side} Zona ${base.zone}: ${bad1 ? `TP disesuaikan (TP1 ${cur1 == null ? '-' : fmtN(cur1)} → ${fmtN(tp1)}, R:R ${(dist(tp1) / R).toFixed(1)})` : mismatch && !tp2Changed ? `TP 4B disamakan dengan TP1 Bagian 3 (${fmtN(tp1)})` : mismatch ? `TP 4B disamakan dengan TP1 Bagian 3 (${fmtN(tp1)}), TP2 disusun ulang` : 'TP2 disusun ulang'}${tp2 != null ? `, TP2 ${fmtN(tp2)}` : ''} dari level struktur/kelipatan R.`);
  }
  // Teks bebas (mis. Manajemen Posisi "TP1 (1.09662)") ikut disesuaikan bila TP1 berubah dan angka lamanya tidak ambigu
  const map = new Map();
  for (const v of done.values()) {
    if (v.old1 == null || v.old1 === v.tp1) continue;
    const o = fmtN(v.old1), n = fmtN(v.tp1);
    if (map.has(o) && map.get(o) !== n) map.set(o, null); else if (!map.has(o)) map.set(o, n);
  }
  for (const [o, n] of map) {
    if (!n) continue;
    const re2 = new RegExp(`(TP\\s*1[^0-9\\n|]{0,8})${o.replace(/\./g, '\\.')}(?!\\d)`, 'g');
    for (let k = 0; k < lines.length; k++) if (!lines[k].trim().startsWith('|')) lines[k] = lines[k].replace(re2, `$1${n}`);
  }
  return { markdown: lines.join('\n'), notes };
}
