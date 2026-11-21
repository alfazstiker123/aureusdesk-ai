// Konfigurasi multi-pair: pengali risiko, desimal, pola harga, profil zona.
// Rumus: Risiko ($) = Lot x Jarak_SL (selisih harga) x mult

const MAJOR_RE = /\d\.\d{3,5}/;
const JPY_RE = /\d{2,3}\.\d{1,3}/;
const GOLD_RE = /\d{3,5}(?:\.\d+)?/;
const BTC_RE = /\d{4,7}(?:\.\d+)?/;
const XAG_RE = /\d{1,3}\.\d{2,3}/;

// atr = ATR cadangan (% dari harga) bila ATR tidak terbaca dari chart. Angka tipikal, bukan data live.
// priceRange = rentang harga wajar (cek kewajaran "HARGA TERAKHIR").

const gold = {
  group: 'gold', quote: 'USD', mult: 100, multText: '100', priceRange: [500, 20000], atr: { h1Pct: 0.3, h4Pct: 0.7 }, dec: 2, priceRe: GOLD_RE,
  unit: 'poin (1 poin = $1.00 pergerakan harga)',
  zone1: '$8-$32 (80-320 pips)', zone1Legacy: '10-25 poin ($10-$25)', zone2: '$32-$80 (320-800 pips)', zr: { z1: [8, 32], z2: [32, 80] }, pip: 0.1, tolV: 5, tol: '5 poin ($5.00)', example: '0.02 lot x 10 poin x 100 = $20.00',
  fundamental: 'The Fed, ekspektasi suku bunga (CME FedWatch), DXY, imbal hasil US Treasury 10Y, geopolitik/safe haven',
};
const major = {
  group: 'major', quote: 'USD', mult: 100000, multText: '100000', priceRange: [0.3, 3], atr: { h1Pct: 0.1, h4Pct: 0.22 }, dec: 5, priceRe: MAJOR_RE,
  unit: 'pip (1 pip = 0.00010); Jarak SL ditulis sebagai selisih harga',
  zone1: '15-60 pip (0.00150-0.00600)', zone1Legacy: '10-25 pip (0.00100-0.00250)', zone2: '60-150 pip (0.00600-0.01500)', zr: { z1: [0.0015, 0.006], z2: [0.006, 0.015] }, pip: 0.0001, tolV: 0.0005, tol: '5 pip (0.00050)', example: '0.10 lot x 0.00500 x 100000 = $50.00',
  fundamental: 'bank sentral kedua mata uang (Fed/ECB/BoE/RBA), DXY, yield US vs mata uang lawan, data CPI/NFP/PMI',
};
const jpy = {
  // Kuotasi JPY: nilai 1 lot (100.000 unit) per 1.000 selisih harga = 100000 JPY -> dibagi kurs USDJPY agar jadi USD.
  group: 'jpy', quote: 'JPY', mult: 1000, multText: '100000 / kurs USDJPY (≈645 bila USDJPY 155)', priceRange: [50, 400], atr: { h1Pct: 0.1, h4Pct: 0.23 }, dec: 3, priceRe: JPY_RE,
  unit: 'pip (1 pip = 0.01); Jarak SL ditulis sebagai selisih harga',
  zone1: '20-80 pip (0.200-0.800)', zone1Legacy: '10-25 pip (0.100-0.250)', zone2: '80-200 pip (0.800-2.000)', zr: { z1: [0.2, 0.8], z2: [0.8, 2.0] }, pip: 0.01, tolV: 0.05, tol: '5 pip (0.050)', example: '0.10 lot x 0.500 x 100000 / 155 = $32.26',
  fundamental: 'BoJ vs Fed/BoE, selisih yield US-Jepang, intervensi MoF Jepang, risk sentiment, CPI/NFP',
};
const btc = {
  group: 'btc', quote: 'USD', open24x7: true, mult: 1, multText: '1', priceRange: [5000, 10000000], atr: { h1Pct: 0.6, h4Pct: 1.3 }, dec: 2, priceRe: BTC_RE,
  unit: 'dolar (1 poin = $1.00 pergerakan harga)',
  zone1: '0.5%-2% dari harga', zone1Legacy: '$100-$300', zone2: '2%-8% dari harga', zrPct: { z1: [0.5, 2], z2: [2, 8] }, pip: 1, tolV: 50, tol: '$50', example: '0.10 lot x 500 x 1 = $50.00',
  fundamental: 'arus ETF Bitcoin spot, regulasi/SEC, likuiditas global & Fed, DXY, sentimen risk-on/off, funding rate/likuidasi',
};

const silver = {
  // XAG/USD: 1 lot standar = 5000 troy oz -> $0.01 pergerakan = $50/lot (cek spesifikasi kontrak broker Anda).
  group: 'silver', quote: 'USD', mult: 5000, multText: '5000', priceRange: [5, 300], atr: { h1Pct: 0.5, h4Pct: 1.1 },
  dec: 3, priceRe: XAG_RE,
  unit: 'dolar (selisih harga; 1 lot = 5000 oz)',
  zone1: '0.2%-1.2% dari harga', zone1Legacy: '0.2%-0.6% dari harga', zone2: '1.2%-3.3% dari harga', zrPct: { z1: [0.2, 1.2], z2: [1.2, 3.3] }, pip: 0.01, tolV: 0.03, tol: '$0.030', example: '0.01 lot x 0.300 x 5000 = $15.00',
  fundamental: 'The Fed, DXY, yield riil US, permintaan industri (panel surya/elektronik), rasio emas/perak, sentimen safe haven',
};

export const PAIRS = {
  XAUUSD: { id: 'XAUUSD', name: 'XAU/USD (Gold)', ...gold },
  EURUSD: { id: 'EURUSD', name: 'EUR/USD', ...major },
  GBPUSD: { id: 'GBPUSD', name: 'GBP/USD', ...major },
  AUDUSD: { id: 'AUDUSD', name: 'AUD/USD', ...major },
  NZDUSD: { id: 'NZDUSD', name: 'NZD/USD', ...major },
  USDJPY: { id: 'USDJPY', name: 'USD/JPY', ...jpy },
  GBPJPY: { id: 'GBPJPY', name: 'GBP/JPY', ...jpy },
  EURJPY: { id: 'EURJPY', name: 'EUR/JPY', ...jpy },
  AUDJPY: { id: 'AUDJPY', name: 'AUD/JPY', ...jpy },
  CADJPY: { id: 'CADJPY', name: 'CAD/JPY', ...jpy },
  CHFJPY: { id: 'CHFJPY', name: 'CHF/JPY', ...jpy },
  NZDJPY: { id: 'NZDJPY', name: 'NZD/JPY', ...jpy },
  BTCUSD: { id: 'BTCUSD', name: 'BTC/USD', ...btc },
  XAGUSD: { id: 'XAGUSD', name: 'XAG/USD (Silver)', ...silver },
};

// Opsi dropdown (value 'AUTO' = deteksi dari chart)
export const PAIR_OPTIONS = [
  { group: null, value: 'AUTO', label: 'Auto-Detect dari Chart (default)' },
  { group: 'Emas', value: 'XAUUSD', label: 'XAUUSD (Gold)' },
  { group: 'Emas', value: 'XAGUSD', label: 'XAGUSD (Silver)' },
  { group: 'Major XXX/USD', value: 'EURUSD', label: 'EURUSD' },
  { group: 'Major XXX/USD', value: 'GBPUSD', label: 'GBPUSD' },
  { group: 'Major XXX/USD', value: 'AUDUSD', label: 'AUDUSD' },
  { group: 'Major XXX/USD', value: 'NZDUSD', label: 'NZDUSD' },
  { group: 'JPY Pairs', value: 'USDJPY', label: 'USDJPY' },
  { group: 'JPY Pairs', value: 'EURJPY', label: 'EURJPY' },
  { group: 'JPY Pairs', value: 'GBPJPY', label: 'GBPJPY' },
  { group: 'JPY Pairs', value: 'AUDJPY', label: 'AUDJPY' },
  { group: 'JPY Pairs', value: 'CADJPY', label: 'CADJPY' },
  { group: 'JPY Pairs', value: 'CHFJPY', label: 'CHFJPY' },
  { group: 'JPY Pairs', value: 'NZDJPY', label: 'NZDJPY' },
  { group: 'Crypto', value: 'BTCUSD', label: 'BTCUSD' },
];

/** Normalisasi teks nama pair -> konfigurasi, atau null jika tidak dikenal. */
export function resolvePair(input) {
  if (!input) return null;
  const raw = String(input).toUpperCase();
  if (/GOLD|XAU/.test(raw)) return PAIRS.XAUUSD;
  if (/SILVER|XAG/.test(raw)) return PAIRS.XAGUSD;
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
  // catatan: perak (XAG, puluhan) tidak bisa dibedakan dari magnitudo -> wajib dari nama pair
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


// Pengali rentang zona terhadap ATR (pedoman, bukan aturan keras).
export const ZONE_ATR_MULT = { z1: [0.6, 2.5], z2: [1.0, 3.0] };

/** ATR cadangan (satuan harga) dari profil pair. */
export function fallbackATR(pair, lastPrice) {
  if (!pair?.atr || !(lastPrice > 0)) return null;
  return { h1: (lastPrice * pair.atr.h1Pct) / 100, h4: (lastPrice * pair.atr.h4Pct) / 100, src: 'profil' };
}

/**
 * Baca baris "**ATR:** H1 12.40 | H4 28.10" dari hasil AI. Nilai diterima hanya bila wajar
 * (0.3x - 3x ATR profil); selain itu dibuang dan dipakai ATR profil.
 */
export function parseATR(markdown = '', pair, lastPrice) {
  const fb = fallbackATR(pair, lastPrice);
  if (!fb) return null;
  const line = (String(markdown).match(/\*{0,2}ATR\b[^\n]*/i) || [''])[0];
  const grab = (tf) => {
    const m = new RegExp(tf + '\\s*[:=]?\\s*\\$?\\s*([\\d][\\d.,]*)', 'i').exec(line);
    return m ? parseFloat(m[1].replace(/,/g, '').replace(/\.+$/, '')) : null;
  };
  const ok = (v, ref) => v > 0 && v >= ref * 0.3 && v <= ref * 3;
  const h1 = grab('H1');
  const h4 = grab('H4');
  const out = { h1: ok(h1, fb.h1) ? h1 : fb.h1, h4: ok(h4, fb.h4) ? h4 : fb.h4 };
  const fromChart = [ok(h1, fb.h1), ok(h4, fb.h4)];
  out.src = fromChart[0] && fromChart[1] ? 'chart' : fromChart[0] || fromChart[1] ? 'campuran' : 'profil';
  if (out.h4 < out.h1) out.h4 = out.h1 * 2; // H4 tidak mungkin lebih kecil dari H1
  return out;
}

/**
 * Rentang jarak zona (satuan harga) dari HARGA TERAKHIR berbasis ATR:
 * Zona 1 = 0.6-2.5 x ATR H1, Zona 2 = 1-3 x ATR H4. Tanpa ATR -> ATR profil pair.
 */
export function zoneRange(pair, lastPrice, atr = null) {
  if (!pair || !(lastPrice > 0)) return null;
  const a = atr && atr.h1 > 0 && atr.h4 > 0 ? atr : fallbackATR(pair, lastPrice);
  if (!a) return null;
  const z1 = [a.h1 * ZONE_ATR_MULT.z1[0], a.h1 * ZONE_ATR_MULT.z1[1]];
  const z2 = [Math.max(a.h4 * ZONE_ATR_MULT.z2[0], z1[0]), Math.max(a.h4 * ZONE_ATR_MULT.z2[1], z1[1] * 1.2)];
  return { z1, z2, atr: a };
}

/** Teks pedoman zona untuk prompt (persen harga, karena harga belum diketahui saat prompt dibuat). */
export function zoneGuideText(pair) {
  if (!pair?.atr) return '';
  const p = (x) => `${x.toFixed(2)}%`;
  const { h1Pct, h4Pct } = pair.atr;
  return `Zona 1 tipikal ${ZONE_ATR_MULT.z1[0]}-${ZONE_ATR_MULT.z1[1]} x ATR H1 (≈ ${p(h1Pct * ZONE_ATR_MULT.z1[0])}-${p(h1Pct * ZONE_ATR_MULT.z1[1])} dari harga bila ATR tipikal); Zona 2 tipikal ${ZONE_ATR_MULT.z2[0]}-${ZONE_ATR_MULT.z2[1]} x ATR H4 (≈ ${p(h4Pct * ZONE_ATR_MULT.z2[0])}-${p(h4Pct * ZONE_ATR_MULT.z2[1])})`;
}

/** Teks rentang aktual "$7.20-$30.00" dsb. */
export function rangeText(pair, r) {
  return `${fmtDistance(pair, r[0])} - ${fmtDistance(pair, r[1])}`;
}

/**
 * Pengali risiko efektif ke USD: Risiko ($) = Lot x Jarak x pengali.
 * Kuotasi JPY: 100000 / kurs USDJPY (USDJPY = harga terakhir; cross JPY = env USDJPY_RATE atau 155).
 */
export function riskMult(pair, lastPrice, fx = {}) {
  if (!pair) return null;
  if (pair.quote === 'JPY') {
    const envRate = Number(process.env.USDJPY_RATE);
    const rate =
      pair.id === 'USDJPY' && lastPrice > 50 ? lastPrice : fx.usdjpy > 50 ? fx.usdjpy : envRate > 50 ? envRate : 155;
    return { mult: 100000 / rate, text: `100000 / ${rate.toFixed(2)}`, approx: pair.id !== 'USDJPY' || !(lastPrice > 50) };
  }
  return { mult: pair.mult, text: String(pair.mult), approx: false };
}

/** Jarak harga -> teks "$53.24 (532 pips)" / "0.00520 (52 pip)" sesuai pair. */
export function fmtDistance(pair, d) {
  const a = Math.abs(d);
  const dec = pair?.dec ?? 2;
  if (!pair || !pair.pip || pair.pip === 1) return `${a.toFixed(dec)}`;
  const pips = Math.round(a / pair.pip);
  return pair.group === 'gold' ? `$${a.toFixed(2)} (${pips} pips)` : `${a.toFixed(dec)} (${Math.round(a / (pair.pip))} pip)`;
}
