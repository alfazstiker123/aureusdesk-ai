import { metalsClosed } from "./marketTime.js";
import { normalizeSymbol } from "./instruments.js";
import { normalizeSpec } from "./brokerSpec.js";

const ALLOWED_TF = new Set(["M5", "M15", "H1", "H4", "D1", "W1"]);
const MAX_BARS = 500;
export const MAX_BID_CLOSE_PCT = 3; // batas keras (anti salah simbol); toleransi sebenarnya adaptif (ATR + spread)
const TF_MS = { M5: 5, M15: 15, H1: 60, H4: 240, D1: 1440, W1: 10080 };
const MIN_BID_TOL_PCT = 0.05; // lantai kecil agar feed sepi tidak terlalu ketat

/** ATR(14) sederhana (Wilder tidak perlu; cukup rata-rata True Range 14 candle terakhir). */
export function atr14(bars) {
  if (!Array.isArray(bars) || bars.length < 15) return 0;
  const n = bars.length;
  let sum = 0;
  for (let i = n - 14; i < n; i++) sum += Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
  return sum / 14;
}

/**
 * Toleransi selisih |Bid - close candle tertutup| yang masih wajar (satuan harga).
 * = max(4 x ATR14 TF itu, 10 x spread, 0.05% harga), dilebarkan sqrt(umur candle / durasi TF) bila candle sudah lama
 * (mis. setelah jeda/gap pasar), lalu dibatasi MAX_BID_CLOSE_PCT. Selisih karena candle tertutup vs harga berjalan bukan "data rusak".
 */
export function bidCloseTolerance({ bars, bid, ask, timeframe, ageMs = 0 }) {
  const close = bars?.at(-1)?.close || bid || 0;
  const spread = Number(ask) > 0 && Number(bid) > 0 && ask >= bid ? ask - bid : 0;
  let tol = Math.max(4 * atr14(bars), 10 * spread, close * MIN_BID_TOL_PCT / 100);
  const tfMs = (TF_MS[timeframe] || 5) * 60000;
  tol *= Math.sqrt(Math.max(1, ageMs / tfMs / 2));
  return Math.min(tol, close * MAX_BID_CLOSE_PCT / 100);
}

export function validateMarketPayload(input) {
  if (!input || typeof input !== "object") throw new Error("Payload MT4 tidak valid.");
  const symbol = String(input.symbol || "").toUpperCase().replace(/[^A-Z0-9._-]/g, "");
  const timeframe = String(input.timeframe || "").toUpperCase();
  if (!symbol || symbol.length > 24) throw new Error("Symbol MT4 tidak valid.");
  if (!ALLOWED_TF.has(timeframe)) throw new Error("Timeframe tidak didukung.");
  if (!Array.isArray(input.bars) || input.bars.length < 30 || input.bars.length > MAX_BARS)
    throw new Error(`Jumlah candle harus 30-${MAX_BARS}.`);
  const bars = input.bars.map((b) => {
    const time = Number(b.time), open = Number(b.open), high = Number(b.high), low = Number(b.low), close = Number(b.close);
    if (![time, open, high, low, close].every(Number.isFinite) || time <= 0 || Math.min(open, high, low, close) <= 0)
      throw new Error("OHLC berisi angka tidak valid.");
    if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) throw new Error("Integritas OHLC gagal.");
    return { time: Math.floor(time), open, high, low, close, volume: Math.max(0, Number(b.volume) || 0) };
  }).sort((a, b) => a.time - b.time);
  for (let i = 1; i < bars.length; i++) if (bars[i].time <= bars[i - 1].time) throw new Error("Timestamp candle duplikat.");
  const now = Date.now();
  const norm0 = normalizeSymbol(symbol);
  let tfMaxAge = { M5: 20, M15: 45, H1: 180, H4: 600, D1: 7200, W1: 21600 }[timeframe] * 60 * 1000;
  // Logam (XAU/XAG): saat pasar tutup (akhir pekan/jeda harian) candle terakhir wajar lama.
  if (/^(XAU|XAG)/.test(norm0?.canonical || symbol) && metalsClosed(now)) tfMaxAge = Math.max(tfMaxAge, 80 * 3600 * 1000);
  const last = bars[bars.length - 1];
  const age = now - last.time * 1000;
  if (age > tfMaxAge || age < -5 * 60 * 1000)
    throw new Error("DATA TIDAK CUKUP: candle kedaluwarsa atau timestamp di masa depan (cek konversi UTC EA).");
  // PRICE MISMATCH: bid harus dekat dengan close candle tertutup (TF pendek saja); toleransi adaptif ATR + spread.
  const bidN = Number(input.bid);
  if (["M5", "M15", "H1"].includes(timeframe) && Number.isFinite(bidN) && bidN > 0) {
    const diff = Math.abs(bidN - last.close);
    const tol = bidCloseTolerance({ bars, bid: bidN, ask: Number(input.ask), timeframe, ageMs: Math.max(0, age) });
    if (diff > tol)
      throw new Error(`PRICE MISMATCH: bid ${bidN} vs close ${last.close} (selisih ${diff.toFixed(Number(input.digits) || 2)} > toleransi adaptif ${tol.toFixed(Number(input.digits) || 2)} = ATR/spread).`);
  }
  const digits = Number.isInteger(Number(input.digits)) ? Number(input.digits) : null;
  const bid = Number.isFinite(Number(input.bid)) ? Number(input.bid) : null;
  const ask = Number.isFinite(Number(input.ask)) ? Number(input.ask) : null;
  if (bid > 0 && ask > 0 && ask < bid) throw new Error("Bid/Ask tidak konsisten (ask < bid).");
  // Koneksi broker (EA v3.2+). Tanpa blok conn = jalur lama ('legacy'), tetap diterima agar EA lama tidak putus.
  const c = input.conn && typeof input.conn === "object" ? input.conn : null;
  const connection_id = c && /^[a-zA-Z0-9]{8,48}$/.test(String(c.id || "")) ? String(c.id).toLowerCase() : "legacy";
  const clip = (v, n) => (v == null || v === "" ? null : String(v).replace(/[\u0000-\u001f<>]/g, "").slice(0, n));
  let canonical_symbol = null, spec = null, specStatus = null;
  const norm = normalizeSymbol(symbol);
  if (connection_id !== "legacy") {
    if (!norm) throw new Error(`Simbol "${symbol}" tidak ada di registry instrumen. Tambahkan mapping (env MT4_SYMBOL_MAP) atau gunakan simbol yang didukung; server tidak menebak dari harga.`);
    // harga harus wajar untuk instrumen kanonik (anti salah simbol/mapping)
    const pr = norm.profile?.priceRange, ref = bid || last.close;
    if (pr && ref && (ref < pr[0] || ref > pr[1])) throw new Error(`Harga ${ref} di luar rentang wajar ${norm.canonical} (${pr[0]}-${pr[1]}); periksa simbol/mapping.`);
  }
  if (norm) canonical_symbol = norm.canonical;
  if (input.spec) {
    const n = normalizeSpec({ ...input.spec, accountCurrency: input.spec.accountCurrency || c?.ccy, profitCurrency: input.spec.profitCurrency }, { payloadDigits: digits });
    spec = { ...n.spec, valid: n.valid, missing: n.missing, problems: n.problems };
    specStatus = n.valid ? "VALID" : "INCOMPLETE";
  }
  return { symbol, timeframe, bars, bid, ask, digits, connection_id, platform: clip(c?.platform || "MT4", 8),
    broker: clip(c?.broker, 64), server: clip(c?.server, 64), account_currency: clip(c?.ccy, 6)?.toUpperCase() || null,
    account_mask: clip(c?.mask, 12), canonical_symbol, spec, received_at: new Date().toISOString(), source: "MT4_EA" };
}

export async function storeMarketSnapshot(snapshot) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role belum dikonfigurasi.");
  const r = await fetch(`${url}/rest/v1/mt4_market_snapshots?on_conflict=connection_id,symbol,timeframe`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(snapshot), cache: "no-store" });
  if (!r.ok) throw new Error(`Penyimpanan OHLC gagal (${r.status}).`);
}

const COLS = "connection_id,symbol,timeframe,bars,bid,ask,digits,received_at,platform,broker,server,account_currency,account_mask,canonical_symbol,spec";
const FRESH_MS = 20 * 60 * 1000;
const TF_ORDER = ["M5", "M15", "H1", "H4", "D1", "W1"];

/** Semua baris fresh untuk satu instrumen kanonik (+ baris legacy ber-simbol broker). */
async function fetchRows(canonical, legacySymbol) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  const since = new Date(Date.now() - FRESH_MS).toISOString();
  const or = `(canonical_symbol.eq.${canonical},and(connection_id.eq.legacy,symbol.eq.${legacySymbol}))`;
  const q = new URLSearchParams({ select: COLS, or, received_at: `gte.${since}` });
  const r = await fetch(`${url}/rest/v1/mt4_market_snapshots?${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" });
  if (!r.ok) throw new Error(`Tidak dapat membaca OHLC (${r.status}).`);
  return (await r.json()).filter((x) => Date.now() - new Date(x.received_at).getTime() < FRESH_MS);
}

/** Kelompokkan per koneksi; satu analisis HANYA memakai satu koneksi (tidak pernah mencampur broker). */
export function groupByConnection(rows) {
  const m = new Map();
  for (const x of rows || []) {
    const k = `${x.connection_id || "legacy"}|${x.symbol}`;
    if (!m.has(k)) m.set(k, { connectionId: x.connection_id || "legacy", symbol: x.symbol, rows: [], latest: 0, broker: x.broker, server: x.server, accountCurrency: x.account_currency, accountMask: x.account_mask, platform: x.platform || "MT4", spec: null });
    const g = m.get(k);
    g.rows.push(x);
    g.latest = Math.max(g.latest, new Date(x.received_at).getTime());
    if (x.spec && !g.spec) g.spec = x.spec;
  }
  return [...m.values()].sort((a, b) => b.latest - a.latest).map((g) => ({ ...g, rows: g.rows.sort((a, b) => TF_ORDER.indexOf(a.timeframe) - TF_ORDER.indexOf(b.timeframe)) }));
}

/** Pilih koneksi: connectionId eksplisit, bila tidak -> yang terbaru. Mengembalikan {chosen, others}. */
export function pickConnection(groups, connectionId = null) {
  if (!groups.length) return { chosen: null, others: [] };
  const want = connectionId ? groups.find((g) => g.connectionId === String(connectionId).toLowerCase()) : null;
  if (connectionId && !want) return { chosen: null, others: groups, missing: true };
  const chosen = want || groups[0];
  return { chosen, others: groups.filter((g) => g !== chosen) };
}

export async function getMarketSnapshots(symbol) { // kompatibel: jalur lama (legacy) per simbol broker
  const rows = await fetchRows(String(symbol).toUpperCase(), String(symbol).toUpperCase());
  const g = groupByConnection(rows.filter((x) => x.connection_id === "legacy" || x.symbol === symbol));
  return g.length ? g[0].rows : [];
}

/** Jalur baru: semua TF dari SATU koneksi untuk instrumen kanonik. */
export async function getConnectionSnapshots(canonical, { connectionId = null, legacySymbol = canonical } = {}) {
  const rows = await fetchRows(canonical, String(legacySymbol).toUpperCase());
  const groups = groupByConnection(rows);
  const { chosen, others, missing } = pickConnection(groups, connectionId);
  return { chosen, others, missing: !!missing, connections: groups.map(({ rows: r, ...rest }) => ({ ...rest, tfs: r.map((x) => x.timeframe) })) };
}

export function marketContext(snapshots) {
  if (!snapshots?.length) return "DATA OHLC MT4: tidak tersedia/fresh. Gunakan screenshot saja; tandai VISUAL ONLY — CONFIDENCE TERBATAS. Jangan klaim konfirmasi SMC dari OHLC.";
  return ["=== DATA OHLC TERSTRUKTUR DARI MT4 (SUMBER UTAMA HARGA/CANDLE) ===",
    "Candle tersusun lama ke baru; waktu Unix detik. Gunakan OHLC untuk struktur/level, screenshot hanya untuk konteks visual.",
    ...snapshots.map((s) => `${s.symbol} ${s.timeframe}; bid=${s.bid ?? "n/a"} ask=${s.ask ?? "n/a"}; received=${s.received_at}\n` +
      (s.bars || []).slice(-28).map((c) => `${c.time},${c.open},${c.high},${c.low},${c.close}`).join("\n")),
    "Jangan menyatakan BOS/CHoCH/OB/FVG terkonfirmasi bila candle tertutup tidak membuktikan. Jika symbol tidak cocok, abaikan feed.",
    "=== AKHIR DATA OHLC MT4 ==="].join("\n");
}

export function mt4SymbolForPair(pairId) {
  let map = {};
  try { map = JSON.parse(process.env.MT4_SYMBOL_MAP || "{}"); } catch {}
  return String(map[pairId] || pairId).toUpperCase();
}

/** Ringkasan snapshot terakhir per TF untuk dibandingkan manual dengan chart MT4. */
export async function marketStatus(symbol, canonical = symbol) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY belum diset di Vercel." };
  const q = new URLSearchParams({ select: COLS, or: `(canonical_symbol.eq.${canonical},symbol.eq.${symbol})` });
  const r = await fetch(`${url}/rest/v1/mt4_market_snapshots?${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" });
  if (!r.ok) return { ok: false, error: `Tabel snapshot tidak terbaca (${r.status}).` };
  const all = await r.json();
  const groups = groupByConnection(all).map((g) => ({ connectionId: g.connectionId, broker: g.broker, server: g.server, platform: g.platform, accountCurrency: g.accountCurrency, symbol: g.symbol,
    spec: g.spec ? { valid: !!g.spec.valid, missing: g.spec.missing || [], problems: g.spec.problems || [] } : null, rows: summarizeSnapshots(g.rows) }));
  return { ok: true, rows: groups[0]?.rows || [], connections: groups };
}

export function summarizeSnapshots(rows, now = Date.now()) {
  const order = ["M5", "M15", "H1", "H4", "D1", "W1"];
  return (rows || []).sort((a, b) => order.indexOf(a.timeframe) - order.indexOf(b.timeframe)).map((x) => {
    const bars = x.bars || [], last = bars[bars.length - 1] || {};
    const recvAge = Math.round((now - new Date(x.received_at).getTime()) / 60000);
    return { timeframe: x.timeframe, bars: bars.length, lastCandleUtc: last.time ? new Date(last.time * 1000).toISOString() : null,
      open: last.open, high: last.high, low: last.low, close: last.close, bid: x.bid, ask: x.ask,
      receivedMinutesAgo: recvAge, status: recvAge <= 20 ? "OK" : "DATA TIDAK CUKUP (kiriman EA terhenti)" };
  });
}
