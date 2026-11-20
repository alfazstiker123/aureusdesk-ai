// biquote.io - kalender ekonomi gratis tanpa key (Actual/Forecast/Previous). Pihak ketiga: akurasi & syarat belum terverifikasi.
// Waktu UTC. Dipakai hanya jika FMP tidak tersedia.
const URL_ = 'https://biquote.io/api/calendar';
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.+-]/g, ''));
  return Number.isNaN(n) ? null : n;
};
const str = (v) => (v === null || v === undefined ? '' : String(v));
const imp = (v) => {
  const c = String(v || '').trim().toLowerCase()[0];
  return c === 'h' || c === '3' ? 'High' : c === 'm' || c === '2' ? 'Medium' : c === 'l' || c === '1' ? 'Low' : 'None';
};
const ymd = (d) => d.toISOString().slice(0, 10);

export async function fetchBiquote(now = new Date()) {
  const from = ymd(new Date(now.getTime() - 24 * 3600e3));
  const to = ymd(new Date(now.getTime() + 6 * 24 * 3600e3));
  const res = await fetch(`${URL_}?from=${from}&to=${to}&importance=high&importance=medium`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(7000) });
  const body = await res.text();
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {}
  const arr = Array.isArray(json) ? json : Array.isArray(json?.events) ? json.events : Array.isArray(json?.data) ? json.data : null;
  if (!res.ok || !arr) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return arr
    .filter((e) => !e.timeMode || e.timeMode === 'exact')
    .map((e) => {
      const n = { actual: num(e.actual), estimate: num(e.forecast), previous: num(e.previous) };
      const u = e.unit && /^(%|K|M|B|T)$/i.test(String(e.unit).trim()) ? String(e.unit).trim() : '';
      return {
        title: str(e.name).trim(),
        currency: str(e.currency).toUpperCase(),
        impact: imp(e.importance),
        forecast: n.estimate === null ? '' : `${str(e.forecast)}`.replace(/(\d)$/, `$1${u}`),
        previous: n.previous === null ? '' : `${str(e.previous)}`.replace(/(\d)$/, `$1${u}`),
        actual: n.actual === null ? '' : `${str(e.actual)}`.replace(/(\d)$/, `$1${u}`),
        nums: n,
        time: new Date(str(e.time)),
      };
    })
    .filter((e) => e.title && e.currency && !Number.isNaN(e.time.getTime()))
    .sort((a, b) => a.time - b.time);
}
