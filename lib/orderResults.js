// Hasil per order 4B (Hit TP / Hit SL / Cut Profit / Cut Loss / Expired / Masih jalan) untuk evaluasi & rekap.
// Modul murni (tanpa React/Supabase) agar bisa diuji. Tidak mengubah mesin SMC maupun formula risiko.

export const ORDER_STATUS = {
  RUNNING: { label: '🟡 Masih jalan', short: 'Jalan', cls: 'border-gold/40 bg-gold/10 text-gold', sign: 0 },
  TP: { label: '✅ Hit TP', short: 'Hit TP', cls: 'border-up/40 bg-up/10 text-up', sign: 1 },
  CUT_PROFIT: { label: '✂️ Cut Profit', short: 'Cut Profit', cls: 'border-up/40 bg-up/10 text-up', sign: 1 },
  SL: { label: '❌ Hit SL', short: 'Hit SL', cls: 'border-down/40 bg-down/10 text-down', sign: -1 },
  CUT_LOSS: { label: '✂️ Cut Loss', short: 'Cut Loss', cls: 'border-down/40 bg-down/10 text-down', sign: -1 },
  EXPIRED: { label: '⌛ Expired', short: 'Expired', cls: 'border-line bg-panel text-muted', sign: 0 },
};
export const ORDER_STATUS_KEYS = Object.keys(ORDER_STATUS);

const KEY_RE = /^(BUY|SELL)-Z[1-9]$/;
export const isOrderKey = (k) => KEY_RE.test(String(k));

/** Kunci order stabil dari baris 4B: "SELL-Z1". null bila arah/zona tidak terbaca. */
export function orderKey(row) {
  const side = row?.side === 'BUY' || row?.side === 'SELL' ? row.side : null;
  const m = /zona\s*(\d)/i.exec(row?.title || '');
  return side && m && m[1] !== '0' ? `${side}-Z${m[1]}` : null;
}

export function toNum(v) {
  if (v == null) return NaN;
  const m = String(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}
const r2 = (n) => Math.round(n * 100) / 100;

/** Rencana order dari kartu: { side, entry, sl, tp, risk, lot, mult } (angka; NaN bila tak terbaca). */
export function planOf(row) {
  const entry = toNum(row?.entry), sl = toNum(row?.sl), tp = toNum(row?.tp), risk = toNum(row?.risk), lot = toNum(row?.lot);
  const dist = Number.isFinite(toNum(row?.slDist)) ? toNum(row.slDist) : Math.abs(entry - sl);
  const mult = lot > 0 && dist > 0 && risk > 0 ? risk / (lot * dist) : NaN; // $ per 1 lot per 1 satuan harga
  return { side: row?.side, entry, sl, tp, risk, lot, mult };
}

/** Estimasi P/L ($) dari harga keluar memakai pengali implisit (risiko / (lot x jarak SL)). NaN bila tak bisa. */
export function estimatePnl(plan, exit) {
  if (!(plan.mult > 0) || !(plan.lot > 0) || !Number.isFinite(exit) || !Number.isFinite(plan.entry)) return NaN;
  const move = plan.side === 'SELL' ? plan.entry - exit : exit - plan.entry;
  return r2(move * plan.lot * plan.mult);
}

/** Tanda P/L dipaksa mengikuti status: TP/Cut Profit positif, SL/Cut Loss negatif, Jalan/Expired 0. */
export function signedPnl(status, pnl) {
  const meta = ORDER_STATUS[status];
  if (!meta) return 0;
  if (meta.sign === 0) return 0;
  const n = Number.isFinite(Number(pnl)) ? Math.abs(Number(pnl)) : 0;
  return r2(meta.sign * n);
}

/** Slippage terhadap rencana (satuan harga). Positif = lebih buruk dari rencana. Hanya untuk Hit SL / Hit TP. */
export function slippage(plan, status, exit) {
  if (!Number.isFinite(exit)) return null;
  const level = status === 'SL' ? plan.sl : status === 'TP' ? plan.tp : NaN;
  if (!Number.isFinite(level)) return null;
  const adverse = plan.side === 'SELL' ? (status === 'SL' ? exit - level : level - exit) : (status === 'SL' ? level - exit : exit - level);
  return Math.round(adverse * 100000) / 100000;
}

/** R realisasi = P/L / risiko rencana. null bila risiko tak diketahui. */
export function rMultiple(pnl, risk) {
  return Number.isFinite(pnl) && risk > 0 ? Math.round((pnl / risk) * 100) / 100 : null;
}

/** Bentuk catatan hasil yang disimpan (dipakai klien & server). */
export function buildResult({ status, exit, pnl, at, note }, plan) {
  if (!ORDER_STATUS[status]) throw new Error('Status hasil tidak valid.');
  const exitN = toNum(exit);
  let pnlN = toNum(pnl);
  if (!Number.isFinite(pnlN)) pnlN = estimatePnl(plan, exitN);
  const p = signedPnl(status, pnlN);
  return {
    status,
    exit: Number.isFinite(exitN) ? exitN : null,
    pnl: p,
    r: rMultiple(p, plan.risk),
    slip: slippage(plan, status, exitN),
    at: at || null,
    note: String(note || '').trim().slice(0, 200) || null,
  };
}

/** Validasi sisi server untuk satu catatan hasil (data dari klien dianggap tidak tepercaya). */
export function sanitizeResult(x) {
  if (!x || typeof x !== 'object' || !ORDER_STATUS[x.status]) throw new Error('Status hasil tidak valid.');
  const fin = (v, lim = 1e9) => (v == null || v === '' ? null : Number.isFinite(Number(v)) && Math.abs(Number(v)) <= lim ? Number(v) : NaN);
  const exit = fin(x.exit), pnl = fin(x.pnl), r = fin(x.r, 1e4), slip = fin(x.slip);
  if ([exit, pnl, r, slip].some((v) => Number.isNaN(v))) throw new Error('Angka hasil tidak valid.');
  let at = null;
  if (x.at) { const d = new Date(x.at); if (Number.isNaN(d.getTime())) throw new Error('Waktu hasil tidak valid.'); at = d.toISOString(); }
  return {
    status: x.status,
    exit,
    pnl: signedPnl(x.status, pnl),
    r: ORDER_STATUS[x.status].sign === 0 ? null : r,
    slip,
    at,
    note: String(x.note ?? '').trim().slice(0, 200) || null,
  };
}

/** Rekap dari daftar riwayat (item.order_results = { 'SELL-Z1': {...} }). */
export function computeOrderStats(items) {
  const mk = () => ({ n: 0, tp: 0, sl: 0, cutP: 0, cutL: 0, expired: 0, running: 0, pnl: 0, rSum: 0, rN: 0, slipSum: 0, slipN: 0 });
  const add = (b, o) => {
    b.n++;
    if (o.status === 'TP') b.tp++; else if (o.status === 'SL') b.sl++; else if (o.status === 'CUT_PROFIT') b.cutP++;
    else if (o.status === 'CUT_LOSS') b.cutL++; else if (o.status === 'EXPIRED') b.expired++; else if (o.status === 'RUNNING') b.running++;
    b.pnl += Number(o.pnl) || 0;
    if (Number.isFinite(o.r) && o.r !== null) { b.rSum += o.r; b.rN++; }
    if (o.slip != null && Number.isFinite(o.slip) && (o.status === 'SL')) { b.slipSum += o.slip; b.slipN++; }
  };
  const all = mk(), byZone = {}, bySide = {};
  for (const it of items || []) {
    for (const [k, o] of Object.entries(it.order_results || {})) {
      if (!isOrderKey(k) || !ORDER_STATUS[o?.status]) continue;
      add(all, o);
      add((byZone[`Zona ${k.slice(-1)}`] ||= mk()), o);
      add((bySide[k.split('-')[0]] ||= mk()), o);
    }
  }
  const fin = (b) => {
    const wins = b.tp + b.cutP, losses = b.sl + b.cutL, closed = wins + losses;
    return { ...b, wins, losses, closed, winRate: closed ? (wins / closed) * 100 : null, avgR: b.rN ? Math.round((b.rSum / b.rN) * 100) / 100 : null,
      expiredPct: b.n - b.running ? (b.expired / (b.n - b.running)) * 100 : null, avgSlip: b.slipN ? Math.round((b.slipSum / b.slipN) * 100) / 100 : null, pnl: r2(b.pnl) };
  };
  const rows = (o) => Object.entries(o).map(([name, b]) => ({ name, ...fin(b) })).sort((a, b) => a.name.localeCompare(b.name));
  return { all: fin(all), zones: rows(byZone), sides: rows(bySide) };
}
