// Financial Modeling Prep - Economic Calendar (sumber utama: punya Actual/Estimate/Previous/Impact).
// API key HANYA dari env server FMP_API_KEY (tidak pernah ke browser). Waktu FMP = UTC.
const FMP_URL = 'https://financialmodelingprep.com/stable/economic-calendar';

export const fmpKey = () => (process.env.FMP_API_KEY || '').trim();

const CC = { US: 'USD', EU: 'EUR', EMU: 'EUR', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', GB: 'GBP', UK: 'GBP', JP: 'JPY', AU: 'AUD', NZ: 'NZD', CA: 'CAD', CH: 'CHF', CN: 'CNY' };

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const fmtNum = (n, unit) => {
  if (n === null) return '';
  const s = String(Math.round(n * 10000) / 10000);
  return unit && /^(%|K|M|B|T)$/i.test(String(unit).trim()) ? `${s}${String(unit).trim()}` : s;
};
const impactOf = (v) => {
  const s = String(v || '').toLowerCase();
  return s === 'high' ? 'High' : s === 'medium' ? 'Medium' : s === 'low' ? 'Low' : 'None';
};
const ymd = (d) => d.toISOString().slice(0, 10);

/** Ambil 1 request untuk rentang [hari-1, hari+6] (hemat kuota). Lempar Error bertanda status bila gagal. */
export async function fetchFMP(now = new Date()) {
  const key = fmpKey();
  if (!key) throw Object.assign(new Error('FMP_API_KEY belum diatur'), { status: 0 });
  const from = ymd(new Date(now.getTime() - 24 * 3600e3));
  const to = ymd(new Date(now.getTime() + 6 * 24 * 3600e3));
  const url = `${FMP_URL}?from=${from}&to=${to}&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(7000) });
  const body = await res.text();
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {}
  if (!res.ok || !Array.isArray(json)) {
    // jangan pernah membocorkan key: pesan dibersihkan
    const msg = String((json && (json['Error Message'] || json.message || json.error)) || `HTTP ${res.status}`).replace(key, '***').slice(0, 160);
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return json
    .map((e) => {
      const unit = e.unit ?? '';
      const actual = num(e.actual);
      const estimate = num(e.estimate);
      const previous = num(e.previous);
      const time = new Date(String(e.date || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(e.date)) ? '' : 'Z'));
      return {
        title: String(e.event || '').trim(),
        currency: String(e.currency || CC[String(e.country || '').toUpperCase()] || '').toUpperCase(),
        impact: impactOf(e.impact),
        forecast: fmtNum(estimate, unit),
        previous: fmtNum(previous, unit),
        actual: fmtNum(actual, unit),
        nums: { actual, estimate, previous },
        time,
      };
    })
    .filter((e) => e.title && e.currency && !Number.isNaN(e.time.getTime()))
    .sort((a, b) => a.time - b.time);
}

const word = (d) => (Math.abs(d) < 1e-9 ? 'sesuai' : d > 0 ? 'di atas' : 'di bawah');
const fd = (d) => String(Math.round(Math.abs(d) * 10000) / 10000);

/** Perbandingan singkat netral: "vs Forecast 51.7: di bawah (0.4); vs Previous 51.0: di atas (0.3)". */
export function compareText(e) {
  const n = e.nums;
  if (!n || n.actual === null) return '';
  const parts = [];
  if (n.estimate !== null) parts.push(`vs Forecast ${e.forecast}: ${word(n.actual - n.estimate)}${Math.abs(n.actual - n.estimate) < 1e-9 ? '' : ` (${fd(n.actual - n.estimate)})`}`);
  if (n.previous !== null) parts.push(`vs Previous ${e.previous}: ${word(n.actual - n.previous)}${Math.abs(n.actual - n.previous) < 1e-9 ? '' : ` (${fd(n.actual - n.previous)})`}`);
  return parts.length ? `(${parts.join('; ')})` : '';
}
