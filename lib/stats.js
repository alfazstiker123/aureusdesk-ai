// Filter periode (WIB), statistik rekap, dan export CSV untuk Riwayat.

const TZ = 'Asia/Jakarta';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dowFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });

export const wibDay = (d) => dayFmt.format(d instanceof Date ? d : new Date(d)); // 'YYYY-MM-DD'

export const PERIODS = [
  { key: 'today', label: 'Hari Ini' },
  { key: 'week', label: 'Minggu Ini' },
  { key: 'month', label: 'Bulan Ini' },
  { key: 'year', label: 'Tahun Ini' },
  { key: 'all', label: 'Semua Waktu' },
  { key: 'custom', label: 'Pilih Periode' },
];

export const OUTCOME_META = {
  PENDING: { label: '⏳ Pending', cls: 'border-line bg-panel text-muted' },
  WIN: { label: '✅ Hit TP', cls: 'border-up/40 bg-up/10 text-up' },
  LOSS: { label: '❌ Hit SL', cls: 'border-down/40 bg-down/10 text-down' },
  BEP: { label: '➖ BEP', cls: 'border-gold/40 bg-gold/10 text-gold' },
  CANCEL: { label: '🚫 Cancel', cls: 'border-line bg-panel text-muted' },
};

const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};

/** Rentang [from, to] sebagai string 'YYYY-MM-DD' (WIB, inklusif). null = tanpa batas. */
export function periodRange(key, custom = {}, now = new Date()) {
  const today = wibDay(now);
  if (key === 'today') return { from: today, to: today };
  if (key === 'week') {
    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(dowFmt.format(now)); // Senin=0
    const from = addDays(today, -dow);
    return { from, to: addDays(from, 6) };
  }
  if (key === 'month') {
    const [y, m] = today.split('-');
    const last = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
    return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, '0')}` };
  }
  if (key === 'year') {
    const y = today.slice(0, 4);
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  if (key === 'custom') {
    let from = custom.from || null;
    let to = custom.to || null;
    if (from && to && from > to) [from, to] = [to, from];
    return { from, to };
  }
  return { from: null, to: null };
}

export function filterByPeriod(items, key, custom, now = new Date()) {
  const { from, to } = periodRange(key, custom, now);
  if (!from && !to) return items;
  return items.filter((it) => {
    const d = wibDay(it.created_at);
    return (!from || d >= from) && (!to || d <= to);
  });
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function bucket() {
  return { total: 0, win: 0, loss: 0, bep: 0, cancel: 0, pending: 0, pnl: 0 };
}
function add(b, it) {
  b.total++;
  const o = it.outcome || 'PENDING';
  if (o === 'WIN') b.win++;
  else if (o === 'LOSS') b.loss++;
  else if (o === 'BEP') b.bep++;
  else if (o === 'CANCEL') b.cancel++;
  else b.pending++;
  b.pnl += num(it.pnl_usd);
}
const winRate = (b) => (b.win + b.loss > 0 ? (b.win / (b.win + b.loss)) * 100 : null);

export function computeStats(items) {
  const all = bucket();
  const bySession = {};
  const byPair = {};
  for (const it of items) {
    add(all, it);
    const s = it.session_label || 'Tanpa sesi';
    add((bySession[s] ||= bucket()), it);
    const p = it.pair || '-';
    add((byPair[p] ||= bucket()), it);
  }
  const rows = (obj) =>
    Object.entries(obj)
      .map(([name, b]) => ({ name, ...b, winRate: winRate(b) }))
      .sort((a, b) => b.pnl - a.pnl || b.win - a.win);
  const sessions = rows(bySession);
  const pairs = rows(byPair);
  const evaluated = all.win + all.loss + all.bep + all.cancel;
  // sesi terbaik hanya bila ada yang sudah dievaluasi
  const bestSession = sessions.find((s) => s.win + s.loss + s.bep > 0) || null;
  return {
    total: all.total,
    evaluated,
    pending: all.pending,
    win: all.win,
    loss: all.loss,
    bep: all.bep,
    cancel: all.cancel,
    winRate: winRate(all),
    pnl: Math.round(all.pnl * 100) / 100,
    sessions,
    pairs,
    bestSession,
  };
}

// ---------- CSV ----------
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`; // cegah formula injection di Excel
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(items) {
  const head = ['Tanggal (WIB)', 'Jam (WIB)', 'Pair', 'Sesi', 'Bias', 'Saldo ($)', 'Risiko (%)', 'Status', 'PnL (USD)', 'Catatan'];
  const tFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const rows = items.map((it) => [
    wibDay(it.created_at),
    tFmt.format(new Date(it.created_at)),
    it.pair,
    it.session_label,
    it.summary_bias,
    it.account_balance,
    it.risk_percent,
    it.outcome || 'PENDING',
    num(it.pnl_usd).toFixed(2),
    it.eval_notes,
  ]);
  // BOM agar Excel membaca UTF-8; pemisah koma
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
