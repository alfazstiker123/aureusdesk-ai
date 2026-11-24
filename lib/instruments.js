// Registry instrumen + normalisasi simbol broker (suffix/prefix). Menambah instrumen = tambah entri di sini, tanpa menyentuh mesin SMC.
// Prinsip: simbol yang tidak dikenal DITOLAK (tidak ditebak dari magnitudo harga).
import { PAIRS } from './pairs.js';

const CCY = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'];

// Alias nama broker -> id kanonik. Kunci sudah dibersihkan (A-Z0-9 saja).
const ALIASES = {
  GOLD: 'XAUUSD', XAUUSD: 'XAUUSD', GOLDUSD: 'XAUUSD',
  SILVER: 'XAGUSD', XAGUSD: 'XAGUSD', SILVERUSD: 'XAGUSD',
  NAS100: 'NAS100', USTEC: 'NAS100', US100: 'NAS100', NDX100: 'NAS100', NASDAQ: 'NAS100', NQ100: 'NAS100', USTECH100: 'NAS100',
  US30: 'US30', DJ30: 'US30', DJI30: 'US30', WS30: 'US30', DOW30: 'US30', USA30: 'US30',
  US500: 'US500', SPX500: 'US500', SP500: 'US500', SPX: 'US500', USA500: 'US500',
  USOIL: 'USOIL', WTI: 'USOIL', XTIUSD: 'USOIL', WTIUSD: 'USOIL', CRUDEOIL: 'USOIL', USOUSD: 'USOIL',
  UKOIL: 'UKOIL', BRENT: 'UKOIL', XBRUSD: 'UKOIL', BRENTUSD: 'UKOIL', UKOUSD: 'UKOIL',
  BTCUSD: 'BTCUSD', XBTUSD: 'BTCUSD', BTCUSDT: 'BTCUSD',
  ETHUSD: 'ETHUSD', ETHUSDT: 'ETHUSD',
};
// Suffix/prefix umum broker (Exness: m/c/z/zero/pro/raw; FBS: .., Headway: pro/.. dll). Hanya dibuang bila sisanya dikenal registry.
const SUFFIXES = ['PRO', 'RAW', 'ECN', 'ZERO', 'MICRO', 'STD', 'CENT', 'M', 'C', 'Z', 'I', 'F', 'R', 'X', 'A', 'B', 'S', 'E', 'P'];
const PREFIXES = ['FX', 'CFD', 'M', 'C', 'I', 'E'];

/** Profil forex generik untuk pair dari 8 mata uang utama. Mult hanya perkiraan USD; nilai akurat wajib dari spesifikasi broker. */
function fxProfile(base, quote) {
  const id = base + quote;
  if (PAIRS[id]) return PAIRS[id];
  const tpl = quote === 'JPY' ? PAIRS.USDJPY : PAIRS.EURUSD;
  const nonUsdQuote = quote !== 'USD' && quote !== 'JPY';
  return { ...tpl, id, name: `${base}/${quote}`, quote, contractVaries: nonUsdQuote, crossApprox: nonUsdQuote };
}

export function getProfile(id) {
  if (!id) return null;
  if (PAIRS[id]) return PAIRS[id];
  if (/^[A-Z]{6}$/.test(id) && CCY.includes(id.slice(0, 3)) && CCY.includes(id.slice(3)) && id.slice(0, 3) !== id.slice(3)) return fxProfile(id.slice(0, 3), id.slice(3));
  return null;
}

const clean = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function lookup(core) {
  if (ALIASES[core]) return ALIASES[core];
  return getProfile(core) ? core : null;
}

/**
 * Simbol broker (mis. "XAUUSDm", "EURUSD.pro", "GOLD", "FX.EURUSD", "USTEC") -> id kanonik registry.
 * @returns {{canonical:string, profile:object, via:string}|null}  null = tidak dikenal (JANGAN ditebak).
 */
export function normalizeSymbol(brokerSymbol, { map } = {}) {
  const raw = String(brokerSymbol || '').trim();
  if (!raw) return null;
  // 1) pemetaan eksplisit (env MT4_SYMBOL_MAP: kanonik -> simbol broker)
  let m = map;
  if (!m) { try { m = JSON.parse(process.env.MT4_SYMBOL_MAP || '{}'); } catch { m = {}; } }
  for (const [canon, bs] of Object.entries(m || {})) if (clean(bs) === clean(raw) && getProfile(clean(canon))) return { canonical: clean(canon), profile: getProfile(clean(canon)), via: 'map' };
  // 2) pemisah (. _ # - !) memisahkan awalan/akhiran: ambil bagian yang dikenal
  const parts = raw.toUpperCase().split(/[.\-_#!/]+/).filter(Boolean);
  for (const p of parts) { const c = lookup(clean(p)); if (c) return { canonical: c, profile: getProfile(c), via: parts.length > 1 ? 'separator' : 'exact' }; }
  const whole = clean(raw);
  let c = lookup(whole);
  if (c) return { canonical: c, profile: getProfile(c), via: 'exact' };
  // 3) buang suffix/prefix umum bila sisanya dikenal
  for (const s of SUFFIXES) if (whole.endsWith(s) && whole.length > s.length) { c = lookup(whole.slice(0, -s.length)); if (c) return { canonical: c, profile: getProfile(c), via: `suffix:${s}` }; }
  for (const p of PREFIXES) if (whole.startsWith(p) && whole.length > p.length) { c = lookup(whole.slice(p.length)); if (c) return { canonical: c, profile: getProfile(c), via: `prefix:${p}` }; }
  for (const p of PREFIXES) for (const s of SUFFIXES) if (whole.startsWith(p) && whole.endsWith(s) && whole.length > p.length + s.length) { c = lookup(whole.slice(p.length, -s.length)); if (c) return { canonical: c, profile: getProfile(c), via: `prefix:${p}+suffix:${s}` }; }
  return null;
}

export const REGISTRY_IDS = () => Object.keys(PAIRS);
