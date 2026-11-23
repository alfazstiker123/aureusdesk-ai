import { metalsClosed } from "./marketTime.js";

const ALLOWED_TF = new Set(["M5", "M15", "H1", "H4", "D1", "W1"]);
const MAX_BARS = 500;
export const MAX_BID_CLOSE_PCT = 3;

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
  let tfMaxAge = { M5: 20, M15: 45, H1: 180, H4: 600, D1: 7200, W1: 21600 }[timeframe] * 60 * 1000;
  // Logam (XAU/XAG): saat pasar tutup (akhir pekan/jeda harian) candle terakhir wajar lama.
  if (/^(XAU|XAG)/.test(symbol) && metalsClosed(now)) tfMaxAge = Math.max(tfMaxAge, 80 * 3600 * 1000);
  const last = bars[bars.length - 1];
  const age = now - last.time * 1000;
  if (age > tfMaxAge || age < -5 * 60 * 1000)
    throw new Error("DATA TIDAK CUKUP: candle kedaluwarsa atau timestamp di masa depan (cek konversi UTC EA).");
  // PRICE MISMATCH: bid harus dekat dengan close candle tertutup (TF pendek saja).
  const bidN = Number(input.bid);
  if (["M5", "M15", "H1"].includes(timeframe) && Number.isFinite(bidN) && bidN > 0) {
    const diffPct = Math.abs(bidN - last.close) / last.close * 100;
    if (diffPct > MAX_BID_CLOSE_PCT)
      throw new Error(`PRICE MISMATCH: bid ${bidN} vs close ${last.close} (${diffPct.toFixed(2)}% > ${MAX_BID_CLOSE_PCT}%).`);
  }
  return { symbol, timeframe, bars, bid: Number.isFinite(Number(input.bid)) ? Number(input.bid) : null,
    ask: Number.isFinite(Number(input.ask)) ? Number(input.ask) : null,
    digits: Number.isInteger(Number(input.digits)) ? Number(input.digits) : null,
    received_at: new Date().toISOString(), source: "MT4_EA" };
}

export async function storeMarketSnapshot(snapshot) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role belum dikonfigurasi.");
  const r = await fetch(`${url}/rest/v1/mt4_market_snapshots?on_conflict=symbol,timeframe`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(snapshot), cache: "no-store" });
  if (!r.ok) throw new Error(`Penyimpanan OHLC gagal (${r.status}).`);
}

export async function getMarketSnapshots(symbol) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  const q = new URLSearchParams({ select: "symbol,timeframe,bars,bid,ask,digits,received_at", symbol: `eq.${symbol}` });
  const r = await fetch(`${url}/rest/v1/mt4_market_snapshots?${q}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" });
  if (!r.ok) throw new Error(`Tidak dapat membaca OHLC (${r.status}).`);
  return (await r.json()).filter((x) => Date.now() - new Date(x.received_at).getTime() < 20 * 60 * 1000);
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
export async function marketStatus(symbol) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY belum diset di Vercel." };
  const q = new URLSearchParams({ select: "symbol,timeframe,bars,bid,ask,digits,received_at", symbol: `eq.${symbol}` });
  const r = await fetch(`${url}/rest/v1/mt4_market_snapshots?${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" });
  if (!r.ok) return { ok: false, error: `Tabel snapshot tidak terbaca (${r.status}).` };
  return { ok: true, rows: summarizeSnapshots(await r.json()) };
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
