// Konfigurasi multi-pair: pengali risiko, desimal, pola harga, profil zona.
// Rumus: Risiko ($) = Lot x Jarak_SL (selisih harga) x mult

const MAJOR_RE = /\d\.\d{3,5}/;
const JPY_RE = /\d{2,3}\.\d{1,3}/;
const GOLD_RE = /\d{3,5}(?:\.\d+)?/;
const BTC_RE = /\d{4,7}(?:\.\d+)?/;

const gold = {
  group: 'gold', mult: 100, dec: 2, priceRe: GOLD_RE,
  unit: 'poin (1 poin = $1.00 pergerakan harga)',
  zone1: '$8-$32 (80-320 pips)', zone2: '$32-$80 (320-800 pips)', zr: { z1: [8, 32], z2: [32, 80] }, pip: 0.1, tol: '5 poin ($5.00)', example: '0.02 lot x 10 poin x 100 = $20.00',
  fundamental: 'The Fed, ekspektasi suku bunga (CME FedWatch), DXY, imbal hasil US Treasury 10Y, geopolitik/safe haven',
};
const major = {
  group: 'major', mult: 100000, dec: 5, priceRe: MAJOR_RE,
  unit: 'pip (1 pip = 0.00010); Jarak SL ditulis sebagai selisih harga',
  zone1: '15-60 pip (0.00150-0.00600)', zone2: '60-150 pip (0.00600-0.01500)', zr: { z1: [0.0015, 0.006], z2: [0.006, 0.015] }, pip: 0.0001, tol: '5 pip (0.00050)', example: '0.10 lot x 0.00500 x 100000 = $50.00',
  fundamental: 'bank sentral kedua mata uang (Fed/ECB/BoE/RBA), DXY, yield US vs mata uang lawan, data CPI/NFP/PMI',
};
const jpy = {
  group: 'jpy', mult: 1000, dec: 3, priceRe: JPY_RE,
  unit: 'pip (1 pip = 0.01); Jarak SL ditulis sebagai selisih harga',
  zone1: '20-80 pip (0.200-0.800)', zone2: '80-200 pip (0.800-2.000)', zr: { z1: [0.2, 0.8], z2: [0.8, 2.0] }, pip: 0.01, tol: '5 pip (0.050)', example: '0.10 lot x 0.500 x 1000 = $50.00',
  fundamental: 'BoJ vs Fed/BoE, selisih yield US-Jepang, intervensi MoF Jepang, risk sentiment, CPI/NFP',
};
const btc = {
  group: 'btc', mult: 1, dec: 2, priceRe: BTC_RE,
  unit: 'dolar (1 poin = $1.00 pergerakan harga)',
  zone1: '0.5%-2% dari harga', zone2: '2%-5% dari harga', zrPct: { z1: [0.5, 2], z2: [2, 5] }, pip: 1, tol: '$50', example: '0.10 lot x 500 x 1 = $50.00',
  fundamental: 'arus ETF Bitcoin spot, regulasi/SEC, likuiditas global & Fed, DXY, sentimen risk-on/off, funding rate/likuidasi',
};

export const PAIRS = {
  XAUUSD: { id: 'XAUUSD', name: 'XAU/USD (Gold)', ...gold },
  EURUSD: { id: 'EURUSD', name: 'EUR/USD', ...major },
  GBPUSD: { id: 'GBPUSD', name: 'GBP/USD', ...major },
  AUDUSD: { id: 'AUDUSD', name: 'AUD/USD', ...major },
  USDJPY: { id: 'USDJPY', name: 'USD/JPY', ...jpy },
  GBPJPY: { id: 'GBPJPY', name: 'GBP/JPY', ...jpy },
  BTCUSD: { id: 'BTCUSD', name: 'BTC/USD', ...btc },
};

// Opsi dropdown (value 'AUTO' = deteksi dari chart)
export const PAIR_OPTIONS = [
  { group: null, value: 'AUTO', label: 'Auto-Detect dari Chart (default)' },
  { group: 'Emas', value: 'XAUUSD', label: 'XAUUSD (Gold)' },
  { group: 'Major XXX/USD', value: 'EURUSD', label: 'EURUSD' },
  { group: 'Major XXX/USD', value: 'GBPUSD', label: 'GBPUSD' },
  { group: 'Major XXX/USD', value: 'AUDUSD', label: 'AUDUSD' },
  { group: 'JPY Pairs', value: 'USDJPY', label: 'USDJPY' },
  { group: 'JPY Pairs', value: 'GBPJPY', label: 'GBPJPY' },
  { group: 'Crypto', value: 'BTCUSD', label: 'BTCUSD' },
];

/** Normalisasi teks nama pair -> konfigurasi, atau null jika tidak dikenal. */
export function resolvePair(input) {
  if (!input) return null;
  const raw = String(input).toUpperCase();
  if (/GOLD|XAU/.test(raw)) return PAIRS.XAUUSD;
  const s = raw.replace(/[^A-Z]/g, '');
  if (PAIRS[s]) return PAIRS[s];
  if (/^(BTC|XBT)/.test(s) && /(USD|USDT)$/.test(s)) return PAIRS.BTCUSD;
  // pair lain dengan struktur sama (ekstra): XXXJPY, XXXUSD
  if (s.length === 6 && s.endsWith('JPY')) return { ...jpy, id: s, name: `${s.slice(0, 3)}/JPY` };
  if (s.length === 6 && s.endsWith('USD') && !s.startsWith('USD')) return { ...major, id: s, name: `${s.slice(0, 3)}/USD` };
  return null;
}

/** Cadangan: tebak dari magnitudo harga bila nama pair tidak terbaca. */
export function guessPairByPrice(n) {
  if (!(n > 0)) return null;
  if (n < 10) return PAIRS.EURUSD;
  if (n < 400) return PAIRS.USDJPY;
  if (n < 10000) return PAIRS.XAUUSD;
  return PAIRS.BTCUSD;
}

/** Baca baris "**PAIR:** XAUUSD" dari hasil AI. */
export function extractPair(markdown = '') {
  const m = markdown.match(/\*{0,2}PAIR(?:\s+TERDETEKSI)?\s*[:：]\s*\**\s*([A-Za-z0-9\/\-_ ()]{3,24})/i);
  return m ? resolvePair(m[1]) : null;
}

export const PAIR_ID_OK = (v) => v === 'AUTO' || Object.prototype.hasOwnProperty.call(PAIRS, v);


/**
 * Batas jarak zona (selisih harga, satuan harga) dari HARGA TERAKHIR.
 * Zona 1 = Intraday/agresif, Zona 2 = Swing/konservatif (lebih jauh).
 * Pair berbasis persen (BTC) dihitung dari harga terakhir.
 */
export function zoneRange(pair, lastPrice) {
  if (!pair) return null;
  if (pair.zr) return { z1: pair.zr.z1, z2: pair.zr.z2 };
  if (pair.zrPct && lastPrice > 0) {
    const f = (r) => [(lastPrice * r[0]) / 100, (lastPrice * r[1]) / 100];
    return { z1: f(pair.zrPct.z1), z2: f(pair.zrPct.z2) };
  }
  return null;
}

/** Jarak harga -> teks "$53.24 (532 pips)" / "0.00520 (52 pip)" sesuai pair. */
export function fmtDistance(pair, d) {
  const a = Math.abs(d);
  const dec = pair?.dec ?? 2;
  if (!pair || !pair.pip || pair.pip === 1) return `${a.toFixed(dec)}`;
  const pips = Math.round(a / pair.pip);
  return pair.id === 'XAUUSD' ? `$${a.toFixed(2)} (${pips} pips)` : `${a.toFixed(dec)} (${Math.round(a / (pair.pip))} pip)`;
}
