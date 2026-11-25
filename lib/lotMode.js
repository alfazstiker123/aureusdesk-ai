// Lot Mode: AUTOMATIC (bawaan, perilaku production) atau MANUAL (lot dari input pengguna).
// Modul murni (tanpa alias import) agar bisa dites langsung. TIDAK mengubah rumus risiko:
// Risiko = Lot x Jarak SL x (tickValue / tickSize) tetap dihitung riskCheck/riskMult.
//
// Aturan keselamatan mode MANUAL:
//  - lot tidak pernah dikurangi/dinaikkan diam-diam (tanpa pembulatan, tanpa naik ke lot minimum broker);
//  - lot tidak valid (format, min, maks, step)            -> kandidat ditolak;
//  - SL tidak ada / tidak valid                            -> lot tidak dianggap tervalidasi, kandidat ditolak;
//  - spesifikasi broker valid / batas risiko tidak ada     -> RISK CALCULATION UNAVAILABLE, kandidat ditolak (tidak menebak);
//  - risiko > batas risiko (batas yang SAMA dengan mode otomatis) -> OVER RISK, kandidat ditolak.
import { parseManualLot, validateManualLot, evaluateManualOrder, fmtLot, STATUS, STATUS_LABEL } from './brokerSpec.js';
import { segmentSection } from './zoneParse.js';

export { parseManualLot, validateManualLot, evaluateManualOrder, fmtLot, STATUS, STATUS_LABEL };

export const LOT_AUTO = 'AUTOMATIC';
export const LOT_MANUAL = 'MANUAL';

/** Nilai selain "MANUAL" (termasuk kosong/undefined/rusak) = AUTOMATIC: pengguna lama tidak berubah. */
export function normalizeLotMode(v) {
  return String(v == null ? '' : v).trim().toUpperCase() === LOT_MANUAL ? LOT_MANUAL : LOT_AUTO;
}

// ───────────────────────── blok hasil analisis ─────────────────────────
const money = (n) => `$${Number(n).toFixed(2)}`;
const BLOCK_RE = /^(?:>\n)?> 💼 \*\*LOT MODE:[^\n]*\n(?:>[^\n]*\n?)*/gmu;
const nameOf = (side, zone) => `${side === 'SELL' ? 'Sell' : 'Buy'} Z${zone}`;
const sideOf = (t = '') => { const s = t.search(/sell/i), b = t.search(/buy/i); if (s < 0 && b < 0) return null; return s >= 0 && (b < 0 || s < b) ? 'SELL' : 'BUY'; };
const zoneOf = (t = '') => Number((String(t).match(/zona\s*(\d)/i) || [])[1]) || null;
const num = (s) => { const m = String(s ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };

/** Baris order 4B dari markdown FINAL (sumber tunggal angka yang dilihat pengguna). */
export function finalOrderRows(markdown = '') {
  const segs = segmentSection(String(markdown));
  const pend = segs.find((s) => s.type === 'pending');
  if (!pend) return [];
  return pend.rows.map((r) => ({
    side: r.side, zone: zoneOf(r.title), title: r.title, active: r.valid,
    entryTxt: r.entry, entry: num(r.entry), sl: num(r.sl), slTxt: r.sl, lot: num(r.lot), lotTxt: r.lot, risk: num(r.risk), riskTxt: r.risk,
  }));
}

/**
 * Susun blok "LOT MODE" dari markdown final + kandidat validator. Tidak mengubah angka; hanya membaca.
 * AUTOMATIC: lot dari sistem (rumus lama). MANUAL: lot dari input pengguna.
 */
export function buildLotModeBlock({ markdown = '', mode = LOT_AUTO, manualLot = null, manualReason = null, candidates = [], maxRiskUsd = 0, balance = 0, riskPct = 0, mult = null, spec = null, specOk = false } = {}) {
  const manual = mode === LOT_MANUAL;
  const rows = finalOrderRows(markdown);
  const items = [];
  for (const r of rows) {
    if (!r.side) continue;
    if (r.active) {
      if (manual) {
        const ev = evaluateManualOrder({ lot: r.lot, entry: r.entry, sl: r.sl, mult, specOk, spec, maxRiskUsd, balance });
        // lot di tabel harus sama persis dengan input; bila tidak, JANGAN dinyatakan valid
        const same = manualLot != null && r.lot != null && Math.abs(r.lot - manualLot) < 1e-9;
        items.push({ name: nameOf(r.side, r.zone), active: true, ...ev, tableLot: r.lot, mismatch: !same, entry: r.entryTxt, slTxt: r.slTxt, tableRisk: r.risk });
      } else {
        const risk = r.risk;
        const over = maxRiskUsd > 0 && risk != null && risk > maxRiskUsd + 0.005;
        const status = !specOk ? 'APPROX' : over ? 'OVER_RISK' : 'OK';
        items.push({ name: nameOf(r.side, r.zone), active: true, status, lot: r.lot, risk, riskPct: balance > 0 && risk != null ? (risk / balance) * 100 : null, entry: r.entryTxt, slTxt: r.slTxt, over: over ? risk - maxRiskUsd : 0 });
      }
    }
  }
  if (manual) {
    for (const c of candidates || []) {
      if (!c.dropped || !c.lotCode) continue;
      const nm = nameOf(c.side, c.zone);
      if (items.some((x) => x.name === nm && x.active)) continue;
      items.push({ name: nm, active: false, status: c.lotCode, label: STATUS_LABEL[c.lotCode] || c.lotCode, lot: c.drop?.lot ?? manualLot, risk: c.drop?.risk ?? null, riskPct: balance > 0 && c.drop?.risk != null ? (c.drop.risk / balance) * 100 : null, over: c.drop?.risk != null && maxRiskUsd > 0 ? Math.max(0, c.drop.risk - maxRiskUsd) : 0, reason: c.lotReason || null });
    }
  }
  const lines = [];
  if (manual) {
    const lotTxt = manualLot != null ? fmtLot(manualLot) : '(tidak valid)';
    lines.push(`> 💼 **LOT MODE: MANUAL** — lot ${lotTxt} berasal dari INPUT ANDA, bukan kalkulasi sistem. Lot tidak dikurangi atau dinaikkan otomatis; batas risiko sama dengan mode otomatis (${maxRiskUsd > 0 ? `${money(maxRiskUsd)} per arah` : 'belum diisi'}).`);
    if (manualLot == null && manualReason) lines.push(`> - ⛔ Input lot manual ditolak: ${manualReason}. Semua kandidat tidak dipasang.`);
  } else {
    lines.push(`> 💼 **LOT MODE: AUTOMATIC** — lot dihitung SISTEM dari saldo × risiko ${riskPct ? `${riskPct}%` : ''}, jarak SL, dan spesifikasi kontrak broker; dibulatkan ke bawah ke lot step sehingga risiko tidak melewati batas${maxRiskUsd > 0 ? ` ${money(maxRiskUsd)} per arah` : ''}.`.replace('risiko  ', 'risiko '));
  }
  if (!items.length) lines.push('> - Tidak ada order baru yang lolos validator; tidak ada lot yang dipakai.');
  for (const it of items) {
    const pct = it.riskPct != null ? ` (${it.riskPct.toFixed(2)}% dari saldo $${Number(balance).toLocaleString('en-US')})` : '';
    if (it.active) {
      const tag = manual ? 'MANUAL' : 'OTOMATIS';
      const stat = manual ? it.label : it.status === 'APPROX' ? 'PERKIRAAN: spesifikasi broker tidak tersedia, bukan risiko akurat' : it.status === 'OVER_RISK' ? 'OVER RISK' : 'LOT VALID · DALAM BATAS RISIKO';
      const riskTxt = it.risk != null ? `Risiko ${money(it.risk)}${pct}` : 'Risiko tidak tersedia';
      const cap = maxRiskUsd > 0 && it.status === 'OK' ? ` · batas ${money(maxRiskUsd)}` : '';
      const mis = it.mismatch ? ' · ⚠️ lot di tabel berbeda dari input manual: JANGAN dipakai' : '';
      lines.push(`> - ${it.name}: Lot ${it.lot != null ? fmtLot(it.lot) : '-'} (${tag}) · Entry ${it.entry} · SL ${it.slTxt} · ${riskTxt} · ${stat}${cap}${mis}`);
    } else {
      const extra = it.status === 'OVER_RISK' && it.risk != null ? ` — lot ${fmtLot(it.lot)} berisiko ${money(it.risk)}${pct} > batas ${money(maxRiskUsd)} (lebih ${money(it.over)})` : it.reason ? ` — ${it.reason}` : '';
      lines.push(`> - ${it.name}: ⛔ ${it.label}${extra} · order TIDAK DIPASANG (lot manual tidak diubah otomatis)`);
    }
  }
  lines.push(`> _Berlaku untuk analisis ini. Ubah di ⚙️ Pengaturan → Position Sizing; perubahan hanya memengaruhi analisis berikutnya._`);
  return { items, text: lines.join('\n') };
}

/** Sisipkan blok setelah blok KEPUTUSAN SERVER; idempotent. */
export function insertLotModeBlock(markdown, text) {
  const md = String(markdown).replace(BLOCK_RE, '');
  if (!text) return md;
  const m = /^> [🎯⛔⚠️⏳] \*\*KEPUTUSAN SERVER[^\n]*\n(?:> [^\n]*\n)*/mu.exec(md);
  if (m) { const at = m.index + m[0].length; return `${md.slice(0, at)}>\n${text}\n${md.slice(at)}`.replace(/\n{3,}/g, '\n\n'); }
  return `${text}\n\n${md}`;
}

/** Mode + lot yang tercatat di markdown hasil (untuk riwayat/PDF). Tanpa blok = AUTOMATIC (analisis lama). */
export function parseLotMode(markdown = '') {
  const m = /💼 \*\*LOT MODE: (MANUAL|AUTOMATIC)\*\*(?: — lot ([\d.]+))?/u.exec(String(markdown));
  if (!m) return { mode: LOT_AUTO, lot: null, present: false };
  return { mode: m[1], lot: m[1] === LOT_MANUAL && m[2] ? Number(m[2]) : null, present: true };
}

/**
 * Konsistensi: pada mode MANUAL semua lot order aktif (tabel 4B) dan baris "Rincian Hitung Risiko" harus = input.
 * @returns {{ok:boolean, mismatches:string[]}}
 */
export function auditLotConsistency(markdown = '', manualLot = null) {
  const bad = [];
  if (!(manualLot > 0)) return { ok: true, mismatches: bad };
  for (const r of finalOrderRows(markdown)) {
    if (r.active && r.lot != null && Math.abs(r.lot - manualLot) > 1e-9) bad.push(`4B ${r.title}: lot ${r.lotTxt}`);
  }
  let inDetail = false;
  for (const ln of String(markdown).split('\n')) {
    if (/rincian hitung risiko/i.test(ln)) { inDetail = true; continue; }
    if (!inDetail) continue;
    if (/^\s*#{1,6}\s/.test(ln) || /^\s*\|/.test(ln)) { inDetail = false; continue; }
    const m = ln.match(/^\s*[-*]\s+(.+?):\s*([\d.]+)\s*(?:lot)?\s*[x×*]\s*[\d.,]+\s*[x×*]\s*[\d.]+[^=\n]*=/i);
    if (m && Math.abs(Number(m[2]) - manualLot) > 1e-9) bad.push(`Rincian ${m[1]}: lot ${m[2]}`);
  }
  return { ok: bad.length === 0, mismatches: bad };
}

/** lotFor untuk mesin order: setiap order memakai lot manual (null bila input tidak valid -> riskCheck menolak). */
export function makeManualLotFor(manualLot) {
  const f = () => (manualLot > 0 ? manualLot : 0);
  f.manual = true;
  return f;
}

