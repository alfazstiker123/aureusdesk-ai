// Sumber OHLC Cloud GRATIS tanpa kunci (server-only): Kraken / Binance market-data.
// BTCUSD = BTC spot. XAUUSD = PAXG (token emas 1 troy oz) sebagai PROKSI. Forex = pasangan FX spot Kraken
// (EURUSD, GBPUSD, USDJPY, EURJPY; EURUSD cadangan Binance EURUSDT). Pair ber-sesi (emas/forex): candle di luar
// jam pasar dibuang, dan seluruh harga digeser (basis) agar sama dengan harga broker di screenshot (applyBasis).
import { metalsClosed, lastMetalsOpenSec } from './marketTime.js';
const TF = [
  { key: 'M5', min: 5, bin: '5m', seconds: 300, maxAgeMin: 25 },
  { key: 'M15', min: 15, bin: '15m', seconds: 900, maxAgeMin: 70 },
  { key: 'H1', min: 60, bin: '1h', seconds: 3600, maxAgeMin: 240 },
  { key: 'H4', min: 240, bin: '4h', seconds: 14400, maxAgeMin: 780 },
  { key: 'D1', min: 1440, bin: '1d', seconds: 86400, maxAgeMin: 4320 },
  { key: 'W1', min: 10080, bin: '1w', seconds: 604800, maxAgeMin: 20160 },
];
const REQUIRED = new Set(['M15', 'H1', 'H4']);
const KEEP_BARS = 180;
const CACHE_MS = 60_000;

// pair aplikasi -> simbol sumber. Tambah di sini bila sumber gratis lain terverifikasi.
const SUPPORTED = {
  BTCUSD: { kraken: 'XBTUSD', binance: 'BTCUSDT', label: 'BTC/USD', order: ['KRAKEN', 'BINANCE'] },
  // PAXG paling likuid di Binance; Kraken cadangan. session 'market' = ikuti jam buka emas.
  XAUUSD: { kraken: 'PAXGUSD', binance: 'PAXGUSDT', label: 'PAXG (proksi XAU/USD)', order: ['BINANCE', 'KRAKEN'], session: 'market', proxy: 'PAXG', proxyDesc: 'PAXG (token emas, bukan harga broker)', maxBasisPct: 1.5 },
  // FX spot Kraken (terverifikasi dari pengumuman Kraken; simbol API belum dicoba langsung dari sini). Pair AUD/NZD/XAG tidak ada di sumber gratis.
  EURUSD: { kraken: 'EURUSD', binance: 'EURUSDT', label: 'EUR/USD', order: ['KRAKEN', 'BINANCE'], session: 'market', proxy: 'FX', proxyDesc: 'feed FX spot bursa (Kraken/Binance), bukan harga broker', maxBasisPct: 0.5 },
  GBPUSD: { kraken: 'GBPUSD', label: 'GBP/USD', order: ['KRAKEN'], session: 'market', proxy: 'FX', proxyDesc: 'feed FX spot Kraken, bukan harga broker', maxBasisPct: 0.5 },
  USDJPY: { kraken: 'USDJPY', label: 'USD/JPY', order: ['KRAKEN'], session: 'market', proxy: 'FX', proxyDesc: 'feed FX spot Kraken, bukan harga broker', maxBasisPct: 0.5 },
  EURJPY: { kraken: 'EURJPY', label: 'EUR/JPY', order: ['KRAKEN'], session: 'market', proxy: 'FX', proxyDesc: 'feed FX spot Kraken, bukan harga broker', maxBasisPct: 0.5 },
};

export function cloudProxyOf(pairId) {
  return SUPPORTED[String(pairId || '').toUpperCase()]?.proxy || null;
}

export function cloudSupports(pairId) {
  return Object.prototype.hasOwnProperty.call(SUPPORTED, String(pairId || '').toUpperCase());
}

const cache = new Map(); // key -> { at, value } | { at, promise }
export function _clearCloudCache() { cache.clear(); }
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise ? hit.promise : hit.value;
  const promise = fn().then(
    (value) => { cache.set(key, { at: Date.now(), value }); return value; },
    (e) => { cache.delete(key); throw e; }
  );
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

// Pair ber-sesi (emas/forex): buang candle intraday yang mulai saat pasar tutup, dan candle D1 Sabtu/Minggu (UTC).
function inSession(b, tf, session) {
  if (!session) return true;
  if (tf.seconds < 86400) return !metalsClosed(b.time * 1000);
  if (tf.seconds === 86400) { const dow = new Date(b.time * 1000).getUTCDay(); return dow !== 6 && dow !== 0; }
  return true;
}

function cleanBars(rows, nowSec, tf, session = null) {
  const bars = rows
    .map((r) => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: Math.max(0, r.volume || 0) }))
    .filter((b) => [b.time, b.open, b.high, b.low, b.close].every(Number.isFinite) && b.time > 0 && b.open > 0 &&
      b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close, b.high))
    .sort((a, b) => a.time - b.time)
    .filter((b, i, a) => i === 0 || b.time > a[i - 1].time)
    .filter((b) => b.time + tf.seconds <= nowSec) // buang candle yang belum tutup
    .filter((b) => inSession(b, tf, session))
    .slice(-KEEP_BARS);
  if (bars.length < 35) throw new Error(`${tf.key}: candle tertutup kurang dari 35`);
  // saat pasar emas tutup, umur data dihitung dari saat terakhir pasar buka (close Jumat)
  const refSec = session ? lastMetalsOpenSec(nowSec) : nowSec;
  const ageMin = (refSec - bars.at(-1).time) / 60;
  if (ageMin > tf.maxAgeMin) throw new Error(`${tf.key}: data terakhir berumur ${Math.round(ageMin)} menit`);
  return bars;
}

async function krakenTf(sym, tf, nowSec, session) {
  const url = `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(sym)}&interval=${tf.min}`;
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (Array.isArray(json.error) && json.error.length)) {
    throw new Error(`${tf.key}: ${String((json.error && json.error[0]) || `HTTP ${res.status}`).slice(0, 100)}`);
  }
  const key = Object.keys(json.result || {}).find((k) => k !== 'last');
  const rows = (json.result?.[key] || []).map((c) => ({
    time: Number(c[0]), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]), volume: Number(c[6]),
  }));
  return cleanBars(rows, nowSec, tf, session);
}

async function binanceTf(sym, tf, nowSec, session) {
  // sesi logam: ambil lebih banyak candle agar akhir pekan (yang dibuang) tidak menghabiskan jendela M5/M15
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=${tf.bin}&limit=${session ? 1000 : 200}`;
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(json)) throw new Error(`${tf.key}: ${String(json?.msg || `HTTP ${res.status}`).slice(0, 100)}`);
  const rows = json.map((c) => ({
    time: Math.floor(Number(c[0]) / 1000), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]), volume: Number(c[5]),
  }));
  return cleanBars(rows, nowSec, tf, session);
}

const monthStart = (t) => { const d = new Date(t * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000; };
const monthEnd = (t) => { const d = new Date(t * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000; };
const daysIn = (t) => Math.round((monthEnd(t) - monthStart(t)) / 86400);

function finalizeMonthly(rows, nowSec) {
  const bars = rows
    .filter((b) => [b.time, b.open, b.high, b.low, b.close].every(Number.isFinite) && b.open > 0 && b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close, b.high))
    .sort((a, b) => a.time - b.time)
    .filter((b) => monthEnd(b.time) <= nowSec) // bulan berjalan belum tutup
    .slice(-KEEP_BARS);
  if (bars.length < 18) throw new Error(`MN: candle bulanan tertutup kurang dari 18 (${bars.length})`);
  return bars;
}

// Kraken tidak punya interval bulanan: susun dari candle harian (maks ~720 hari). Bulan yang tidak lengkap dibuang.
async function krakenMonthly(sym, nowSec, session = null) {
  const url = `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(sym)}&interval=1440`;
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (Array.isArray(json.error) && json.error.length)) throw new Error(`MN: ${String((json.error && json.error[0]) || `HTTP ${res.status}`).slice(0, 100)}`);
  const key = Object.keys(json.result || {}).find((k) => k !== 'last');
  const daily = (json.result?.[key] || []).map((c) => ({ time: Number(c[0]), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]), volume: Number(c[6]) }))
    .filter((b) => Number.isFinite(b.time) && b.time > 0 && (!session || ![0, 6].includes(new Date(b.time * 1000).getUTCDay()))).sort((a, b) => a.time - b.time);
  const map = new Map();
  for (const b of daily) {
    const k = monthStart(b.time);
    const m = map.get(k);
    if (!m) map.set(k, { time: k, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0, n: 1 });
    else { m.high = Math.max(m.high, b.high); m.low = Math.min(m.low, b.low); m.close = b.close; m.volume += b.volume || 0; m.n++; }
  }
  // pair ber-sesi: hanya hari kerja; bulan dianggap lengkap bila hari kerjanya terisi (toleransi 2 hari libur)
  const weekdays = (t) => { let c = 0; for (let d = monthStart(t); d < monthEnd(t); d += 86400) { const w = new Date(d * 1000).getUTCDay(); if (w !== 0 && w !== 6) c++; } return c; };
  const rows = [...map.values()].filter((m) => (session ? m.n >= weekdays(m.time) - 2 : m.n >= daysIn(m.time))).map(({ n, ...r }) => r);
  return finalizeMonthly(rows, nowSec);
}

async function binanceMonthly(sym, nowSec) {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=1M&limit=200`;
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(json)) throw new Error(`MN: ${String(json?.msg || `HTTP ${res.status}`).slice(0, 100)}`);
  return finalizeMonthly(json.map((c) => ({ time: Math.floor(Number(c[0]) / 1000), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]), volume: Number(c[5]) })), nowSec);
}

// MN opsional: Binance 1M (riwayat panjang) dulu, lalu susunan dari harian Kraken.
async function monthlySnapshot(cfg, nowSec) {
  const errs = [];
  if (cfg.binance) { try { return { bars: await binanceMonthly(cfg.binance, nowSec), source: 'BINANCE', sym: cfg.binance }; } catch (e) { errs.push(e.message); } }
  try { return { bars: await krakenMonthly(cfg.kraken, nowSec, cfg.session || null), source: 'KRAKEN', sym: cfg.kraken }; } catch (e) { errs.push(e.message); }
  throw new Error(errs.join(' / '));
}

async function fetchSet(provider, fetchTf, sym, nowSec, cfg) {
  // jeda kecil antar permintaan agar tidak memicu rate limit publik
  const results = await Promise.allSettled([
    ...TF.map(async (tf, i) => {
      await new Promise((r) => setTimeout(r, i * 180));
      return { tf, bars: await fetchTf(sym, tf, nowSec, cfg.session || null) };
    }),
    (async () => {
      await new Promise((r) => setTimeout(r, TF.length * 180));
      const m = await monthlySnapshot(cfg, nowSec);
      return { tf: { key: 'MN' }, bars: m.bars, source: m.source, sym: m.sym };
    })(),
  ]);
  const snapshots = [];
  const failures = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      snapshots.push({ symbol: sym, timeframe: r.value.tf.key, bars: r.value.bars, bid: null, ask: null, digits: null,
        received_at: new Date().toISOString(), source: r.value.source || provider.id, providerSymbol: r.value.sym || sym });
    } else failures.push(String(r.reason?.message || r.reason).slice(0, 120));
  });
  const present = new Set(snapshots.map((s) => s.timeframe));
  const missing = [...REQUIRED].filter((k) => !present.has(k));
  if (missing.length) throw new Error(`${provider.label}: data belum cukup (${missing.join(', ')}); ${failures[0] || 'tanpa detail'}`);
  return { snapshots, symbol: sym, provider: provider.label, warnings: failures, proxy: cfg.proxy || null, proxyDesc: cfg.proxyDesc || null, maxBasisPct: cfg.maxBasisPct || 1.5, session: cfg.session || null };
}

export async function getCloudMarketSnapshots(pairId) {
  const id = String(pairId || '').toUpperCase();
  const cfg = SUPPORTED[id];
  if (!cfg) throw new Error(`Pair ${id || '?'} belum punya sumber data gratis; memakai screenshot`);
  return cached(`set:${id}`, async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const errors = [];
    const P = {
      KRAKEN: () => fetchSet({ id: 'KRAKEN', label: cfg.proxy ? `Kraken (${cfg.kraken})` : 'Kraken' }, krakenTf, cfg.kraken, nowSec, cfg),
      BINANCE: () => (cfg.binance ? fetchSet({ id: 'BINANCE', label: `Binance (${cfg.binance})` }, binanceTf, cfg.binance, nowSec, cfg) : Promise.reject(new Error('tanpa cadangan Binance'))),
    };
    for (const id of cfg.order || ['KRAKEN', 'BINANCE']) {
      try { return await P[id](); } catch (e) { errors.push(e.message); }
    }
    throw new Error(errors.join(' → ').slice(0, 260));
  });
}

export function cloudMarketContext(snapshots, warnings = [], providerLabel = 'Cloud') {
  const lines = [
    `=== DATA OHLC CLOUD (${String(providerLabel).toUpperCase()}) — SUMBER CANDLE TERUKUR ===`,
    'Data OHLC berasal dari feed publik exchange, bukan harga broker pengguna. Candle tersusun lama ke baru; semua candle yang disertakan sudah ditutup.',
    'Gunakan ini untuk struktur/ATR/SMC. Harga entry aktual tetap perlu dicocokkan dengan broker pada screenshot.',
  ];
  for (const s of snapshots) {
    const last = s.bars.at(-1);
    lines.push(`\n[${s.symbol} ${s.timeframe}] provider=${s.source}; bars=${s.bars.length}; lastClose=${last?.close}; lastBarUTC=${last ? new Date(last.time * 1000).toISOString() : '-'}; fetched=${s.received_at}`);
    lines.push(s.bars.slice(-28).map((b) => `${b.time},${b.open},${b.high},${b.low},${b.close}`).join('\n'));
  }
  if (warnings.length) lines.push(`\nTimeframe opsional tidak tersedia: ${warnings.join(' | ')}`);
  lines.push('Jangan mengklaim harga feed ini identik dengan broker. Jika screenshot dan feed berbeda material, nyatakan PRICE MISMATCH dan jangan memaksakan entry.', `=== AKHIR DATA OHLC CLOUD ===`);
  return lines.join('\n');
}

/**
 * Geser semua OHLC proksi (PAXG) sebesar selisih harga broker - harga proksi terakhir, agar level zona
 * langsung dalam harga broker. Ditolak bila selisih > maxPct (salah baca harga / instrumen lain).
 * @returns {{snapshots, basis: {offset, ref, broker} | null, note: string}}
 */
export function applyBasis(snapshots = [], brokerPrice, { maxPct = 1.5, dec = 2 } = {}) {
  const q = snapshots.find((x) => x.timeframe === 'M5') || snapshots.find((x) => x.timeframe === 'M15');
  const ref = Number(q?.bars?.at(-1)?.close || 0);
  const broker = Number(brokerPrice || 0);
  if (!(ref > 0) || !(broker > 0)) return { snapshots, basis: null, note: 'harga broker tidak terbaca dari screenshot' };
  const pct = Math.abs(broker - ref) / ref * 100;
  if (pct > maxPct) return { snapshots, basis: null, note: `harga screenshot ${broker} terlalu jauh dari proksi ${ref} (${pct.toFixed(2)}%)` };
  const f = 10 ** dec;
  const offset = Math.round((broker - ref) * f) / f;
  if (offset === 0) return { snapshots, basis: { offset: 0, ref, broker }, note: '' };
  const sh = (v) => Math.round((v + offset) * f) / f;
  const out = snapshots.map((s) => ({ ...s, basisOffset: offset,
    bars: s.bars.map((b) => ({ ...b, open: sh(b.open), high: sh(b.high), low: sh(b.low), close: sh(b.close) })) }));
  return { snapshots: out, basis: { offset, ref, broker }, note: '' };
}
