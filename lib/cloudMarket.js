// Sumber OHLC Cloud GRATIS tanpa kunci (server-only): Kraken (utama) -> Binance market-data (cadangan).
// Saat ini hanya BTC. Pair lain -> error "belum didukung" sehingga analisa memakai screenshot.
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
const SUPPORTED = { BTCUSD: { kraken: 'XBTUSD', binance: 'BTCUSDT', label: 'BTC/USD' } };

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

function cleanBars(rows, nowSec, tf) {
  const bars = rows
    .map((r) => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: Math.max(0, r.volume || 0) }))
    .filter((b) => [b.time, b.open, b.high, b.low, b.close].every(Number.isFinite) && b.time > 0 && b.open > 0 &&
      b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close, b.high))
    .sort((a, b) => a.time - b.time)
    .filter((b, i, a) => i === 0 || b.time > a[i - 1].time)
    .filter((b) => b.time + tf.seconds <= nowSec) // buang candle yang belum tutup
    .slice(-KEEP_BARS);
  if (bars.length < 35) throw new Error(`${tf.key}: candle tertutup kurang dari 35`);
  const ageMin = (nowSec - bars.at(-1).time) / 60;
  if (ageMin > tf.maxAgeMin) throw new Error(`${tf.key}: data terakhir berumur ${Math.round(ageMin)} menit`);
  return bars;
}

async function krakenTf(sym, tf, nowSec) {
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
  return cleanBars(rows, nowSec, tf);
}

async function binanceTf(sym, tf, nowSec) {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=${tf.bin}&limit=200`;
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(json)) throw new Error(`${tf.key}: ${String(json?.msg || `HTTP ${res.status}`).slice(0, 100)}`);
  const rows = json.map((c) => ({
    time: Math.floor(Number(c[0]) / 1000), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]), volume: Number(c[5]),
  }));
  return cleanBars(rows, nowSec, tf);
}

async function fetchSet(provider, fetchTf, sym, nowSec) {
  // jeda kecil antar permintaan agar tidak memicu rate limit publik
  const results = await Promise.allSettled(
    TF.map(async (tf, i) => {
      await new Promise((r) => setTimeout(r, i * 180));
      return { tf, bars: await fetchTf(sym, tf, nowSec) };
    })
  );
  const snapshots = [];
  const failures = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      snapshots.push({ symbol: sym, timeframe: r.value.tf.key, bars: r.value.bars, bid: null, ask: null, digits: null,
        received_at: new Date().toISOString(), source: provider.id, providerSymbol: sym });
    } else failures.push(String(r.reason?.message || r.reason).slice(0, 120));
  });
  const present = new Set(snapshots.map((s) => s.timeframe));
  const missing = [...REQUIRED].filter((k) => !present.has(k));
  if (missing.length) throw new Error(`${provider.label}: data belum cukup (${missing.join(', ')}); ${failures[0] || 'tanpa detail'}`);
  return { snapshots, symbol: sym, provider: provider.label, warnings: failures };
}

export async function getCloudMarketSnapshots(pairId) {
  const id = String(pairId || '').toUpperCase();
  const cfg = SUPPORTED[id];
  if (!cfg) throw new Error(`Pair ${id || '?'} belum punya sumber data gratis; memakai screenshot`);
  return cached(`set:${id}`, async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const errors = [];
    try {
      return await fetchSet({ id: 'KRAKEN', label: 'Kraken' }, krakenTf, cfg.kraken, nowSec);
    } catch (e) { errors.push(e.message); }
    try {
      return await fetchSet({ id: 'BINANCE', label: 'Binance (BTCUSDT)' }, binanceTf, cfg.binance, nowSec);
    } catch (e) { errors.push(e.message); }
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
