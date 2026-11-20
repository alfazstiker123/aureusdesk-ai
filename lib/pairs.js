// Konfigurasi multi-pair: pengali risiko, desimal, pola harga, profil zona.
// Rumus: Risiko ($) = Lot x Jarak_SL (selisih harga) x mult

const MAJOR_RE = /\d\.\d{3,5}/;
const JPY_RE = /\d{2,3}\.\d{2,3}/;
const GOLD_RE = /\d{3,5}(?:\.\d+)?/;
const BTC_RE = /\d{4,7}(?:\.\d+)?/;

const gold = {
  group: 'gold', mult: 100, dec: 2, priceRe: GOLD_RE,
  unit: 'poin (1 poin = $1.00 pergerakan harga)',
  zone1: '10-25 poin ($10-$25)', tol: '5 poin ($5.00)', example: '0.02 lot x 10 poin x 100 = $20.00',
  fundamental: 'The Fed, ekspektasi suku bunga (CME FedWatch), DXY, imbal hasil US Treasury 10Y, geopolitik/safe haven',
};
const major = {
  group: 'major', mult: 100000, dec: 5, priceRe: MAJOR_RE,
  unit: 'pip (1 pip = 0.00010); Jarak SL ditulis sebagai selisih harga',
  zone1: '10-25 pip (0.00100-0.00250)', tol: '5 pip (0.00050)', example: '0.10 lot x 0.00500 x 100000 = $50.00',
  fundamental: 'bank sentral kedua mata uang (Fed/ECB/BoE/RBA), DXY, yield US vs mata uang lawan, data CPI/NFP/PMI',
};
const jpy = {
  group: 'jpy', mult: 1000, dec: 3, priceRe: JPY_RE,
  unit: 'pip (1 pip = 0.01); Jarak SL ditulis sebagai selisih harga',
  zone1: '10-25 pip (0.100-0.250)', tol: '5 pip (0.050)', example: '0.10 lot x 0.500 x 1000 = $50.00',
  fundamental: 'BoJ vs Fed/BoE, selisih yield US-Jepang, intervensi MoF Jepang, risk sentiment, CPI/NFP',
};
const btc = {
  group: 'btc', mult: 1, dec: 2, priceRe: BTC_RE,
  unit: 'dolar (1 poin = $1.00 pergerakan harga)',
  zone1: '$100-$300', tol: '$50', example: '0.10 lot x 500 x 1 = $50.00',
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
