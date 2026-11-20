// Kalender ekonomi live (ForexFactory JSON feed) + headline Finnhub opsional.
// Semua jam dikonversi ke WIB (Asia/Jakarta). Cache di memori server agar tidak kena rate-limit.

const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const FF_TTL = 30 * 60 * 1000; // TTL normal
const FF_TTL_ACTIVE = 3 * 60 * 1000; // TTL singkat bila ada rilis yang 'Actual'-nya belum muncul di feed
const ACTUAL_WATCH_MS = 120 * 60 * 1000; // pantau Actual sampai 2 jam setelah jadwal rilis
const FF_RETRY_AFTER_FAIL = 3 * 60 * 1000; // jangan menggempur feed setelah gagal
const NEWS_TTL = 15 * 60 * 1000;
const TZ = 'Asia/Jakarta';

let ffCache = { events: null, at: 0, failAt: 0, error: null };
let ffInflight = null;
let newsCache = { items: null, at: 0 };

// ---------- util WIB ----------
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const wibDay = (d) => dayFmt.format(d);
export const wibTime = (d) => timeFmt.format(d);
const wibStamp = (d) => `${wibDay(d)} ${wibTime(d)} WIB`;

export const eventKey = (e) => `${e.time.toISOString()}|${e.currency}|${e.title}`;

/** Ada event High/Medium yang sudah lewat jadwal rilis (<=2 jam) tetapi Actual masih kosong di feed? */
export function hasPendingActual(events, now = Date.now()) {
  return (events || []).some(
    (e) => (e.impact === 'High' || e.impact === 'Medium') && !e.actual && e.time.getTime() <= now && now - e.time.getTime() <= ACTUAL_WATCH_MS
  );
}

const MANUAL_RE = /^[-+]?\d[\d.,]*\s?[%KMBTkmbt]?$/;
/** Validasi Actual manual dari UI: hanya untuk event yang memang ada di kalender, format angka sederhana. */
export function cleanManualActuals(input, events) {
  const out = new Map();
  if (!input || typeof input !== 'object') return out;
  const known = new Set((events || []).map(eventKey));
  for (const [k, v] of Object.entries(input).slice(0, 40)) {
    const val = String(v ?? '').trim();
    if (known.has(k) && val.length <= 12 && MANUAL_RE.test(val)) out.set(k, val);
  }
  return out;
}

// ---------- ForexFactory ----------
async function fetchFF() {
  const res = await fetch(FF_URL, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 AureusDeskAI' },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error('format feed tidak dikenal');
  return json
    .map((e) => ({
      title: String(e.title || '').trim(),
      currency: String(e.country || '').toUpperCase(),
      impact: String(e.impact || ''),
      forecast: String(e.forecast ?? '').trim(),
      previous: String(e.previous ?? '').trim(),
      actual: String(e.actual ?? '').trim(),
      time: new Date(e.date),
    }))
    .filter((e) => e.title && !Number.isNaN(e.time.getTime()))
    .sort((a, b) => a.time - b.time);
}

/** @returns {{events:Array, fetchedAt:number|null, stale:boolean, error:string|null}} */
export async function getCalendar() {
  const now = Date.now();
  // TTL singkat bila ada rilis yang Actual-nya belum tercatat (paksa refresh); selain itu TTL normal
  const ttl = ffCache.events && hasPendingActual(ffCache.events, now) ? FF_TTL_ACTIVE : FF_TTL;
  if (ffCache.events && now - ffCache.at < ttl) {
    return { events: ffCache.events, fetchedAt: ffCache.at, stale: false, error: null };
  }
  // baru saja gagal -> pakai data lama (jika ada) tanpa mencoba lagi
  if (ffCache.failAt && now - ffCache.failAt < FF_RETRY_AFTER_FAIL) {
    return { events: ffCache.events || [], fetchedAt: ffCache.events ? ffCache.at : null, stale: Boolean(ffCache.events), error: ffCache.error };
  }
  if (!ffInflight) {
    ffInflight = fetchFF()
      .then((events) => {
        ffCache = { events, at: Date.now(), failAt: 0, error: null };
      })
      .catch((e) => {
        ffCache = { ...ffCache, failAt: Date.now(), error: e?.name === 'TimeoutError' ? 'timeout' : e?.message || 'gagal' };
      })
      .finally(() => {
        ffInflight = null;
      });
  }
  await ffInflight;
  const ok = ffCache.events && !ffCache.failAt;
  return {
    events: ffCache.events || [],
    fetchedAt: ffCache.events ? ffCache.at : null,
    stale: Boolean(ffCache.events) && !ok,
    error: ok ? null : ffCache.error,
  };
}

// ---------- pair -> mata uang ----------
const AUTO_CCY = ['USD', 'EUR', 'GBP', 'JPY', 'AUD'];
export function currenciesFor(pairId) {
  if (!pairId) return AUTO_CCY;
  const id = String(pairId).toUpperCase();
  if (id === 'XAUUSD' || id === 'BTCUSD') return ['USD'];
  if (id.length === 6) return [...new Set([id.slice(0, 3), id.slice(3)])].concat(id.includes('USD') ? [] : ['USD']);
  return ['USD'];
}

// ---------- seleksi & format ----------
function pick(cal, { currencies, impacts, now = new Date(), days = ['today', 'tomorrow'] }) {
  const today = wibDay(now);
  const tomorrow = wibDay(new Date(now.getTime() + 24 * 3600 * 1000));
  const want = new Set(days.map((d) => (d === 'today' ? today : tomorrow)));
  return cal.events.filter(
    (e) => currencies.includes(e.currency) && impacts.includes(e.impact) && want.has(wibDay(e.time))
  );
}

function released(e, now) {
  return e.time.getTime() <= now.getTime();
}

function actualText(e, now, manual) {
  const m = manual?.get(eventKey(e));
  if (m) return `${m} [DIISI MANUAL OLEH USER - acuan tertinggi${e.actual ? `; feed: ${e.actual}` : ''}]`;
  if (e.actual) return e.actual;
  return released(e, now) ? 'SUDAH RILIS, angka Actual BELUM tersedia di feed (jangan menebak)' : 'belum rilis';
}

/** Data ringkas untuk widget UI: berita High-Impact hari ini (WIB). */
export async function todayHighlights(pairId, now = new Date()) {
  const cal = await getCalendar();
  const currencies = currenciesFor(pairId);
  const high = pick(cal, { currencies, impacts: ['High'], now, days: ['today'] });
  const list = (high.length ? high : pick(cal, { currencies, impacts: ['Medium'], now, days: ['today'] }))
    .slice(0, 5)
    .map((e) => ({
      time: wibTime(e.time),
      currency: e.currency,
      title: e.title,
      impact: e.impact,
      forecast: e.forecast || '-',
      previous: e.previous || '-',
      actual: e.actual || null,
      passed: released(e, now),
    }));
  const manualList = pick(cal, { currencies, impacts: ['High', 'Medium'], now, days: ['today'] })
    .filter((e) => released(e, now))
    .map((e) => ({
      key: eventKey(e),
      time: wibTime(e.time),
      currency: e.currency,
      title: e.title,
      impact: e.impact,
      forecast: e.forecast || '-',
      feedActual: e.actual || null,
    }));
  return {
    events: list,
    manualList,
    pendingActual: hasPendingActual(cal.events, now.getTime()),
    onlyMedium: !high.length && list.length > 0,
    currencies,
    offline: Boolean(cal.error) && !cal.fetchedAt,
    stale: cal.stale,
    fetchedAt: cal.fetchedAt,
    totalHigh: high.length,
    now: wibStamp(now),
  };
}

// ---------- Finnhub (opsional) ----------
export async function getFinnhubNews() {
  const key = (process.env.FINNHUB_API_KEY || '').trim();
  if (!key) return { enabled: false, items: [] };
  const now = Date.now();
  if (newsCache.items && now - newsCache.at < NEWS_TTL) return { enabled: true, items: newsCache.items };
  try {
    const res = await fetch('https://finnhub.io/api/v1/news?category=forex', {
      headers: { 'X-Finnhub-Token': key },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.json();
    const items = (Array.isArray(arr) ? arr : [])
      .sort((a, b) => (b.datetime || 0) - (a.datetime || 0))
      .slice(0, 8)
      .map((n) => ({
        headline: String(n.headline || '').slice(0, 200),
        source: String(n.source || ''),
        time: n.datetime ? wibStamp(new Date(n.datetime * 1000)) : '',
      }))
      .filter((n) => n.headline);
    newsCache = { items, at: now };
    return { enabled: true, items };
  } catch (e) {
    return { enabled: true, items: newsCache.items || [], error: e?.message || 'gagal' };
  }
}

// ---------- blok fundamental untuk prompt ----------
export async function buildFundamentalBlock(pairId, now = new Date(), manualInput = null) {
  const [cal, news] = await Promise.all([getCalendar(), getFinnhubNews()]);
  const currencies = currenciesFor(pairId);
  const manual = cleanManualActuals(manualInput, cal.events);
  const L = [];
  L.push(`=== DATA FUNDAMENTAL LIVE (disuntikkan server; satu-satunya sumber Bagian 1) ===`);
  L.push(`Waktu sekarang: ${wibStamp(now)}. Mata uang relevan: ${currencies.join(', ')}${pairId ? '' : ' (Auto-Detect: pilih yang sesuai pair terdeteksi)'}.`);

  let offline = false;
  if (!cal.fetchedAt) {
    offline = true;
    L.push(`STATUS KALENDER: OFFLINE (${cal.error || 'tidak diketahui'}). Jadwal berita TIDAK tersedia.`);
  } else {
    const ageMin = Math.round((now.getTime() - cal.fetchedAt) / 60000);
    L.push(
      `STATUS KALENDER: ${cal.stale ? `DATA LAMA (feed gagal diperbarui: ${cal.error}), ` : ''}ForexFactory, diambil ${ageMin} menit lalu.`
    );
    const rows = (days, label) => {
      const evs = pick(cal, { currencies, impacts: ['High', 'Medium'], now, days });
      L.push(`\n${label} (WIB):`);
      if (!evs.length) {
        L.push('- (tidak ada event High/Medium untuk mata uang relevan)');
        return evs;
      }
      for (const e of evs) {
        L.push(
          `- ${wibDay(e.time)} ${wibTime(e.time)} WIB | ${e.currency} | ${e.impact.toUpperCase()} | ${e.title} | Forecast: ${e.forecast || '-'} | Previous: ${e.previous || '-'} | Actual: ${actualText(e, now, manual)}`
        );
      }
      return evs;
    };
    const today = rows(['today'], 'HARI INI');
    rows(['tomorrow'], 'BESOK');

    // No-Trade Zone: 15 menit sebelum & sesudah rilis High-Impact (hari ini)
    const highToday = today.filter((e) => e.impact === 'High');
    L.push('\nNO-TRADE ZONE (±15 menit High-Impact hari ini, WIB):');
    if (!highToday.length) L.push('- (tidak ada High-Impact hari ini)');
    for (const e of highToday) {
      const from = new Date(e.time.getTime() - 15 * 60000);
      const to = new Date(e.time.getTime() + 15 * 60000);
      const active = now >= from && now <= to;
      L.push(`- ${e.currency} ${e.title}: ${wibTime(from)}-${wibTime(to)} WIB${active ? '  <== SEDANG AKTIF SEKARANG' : ''}`);
    }
  }

  if (news.enabled) {
    L.push('\nHEADLINE PASAR FOREX (Finnhub, hanya konteks sentimen tambahan):');
    if (news.items.length) news.items.forEach((n) => L.push(`- [${n.time}] ${n.headline} (${n.source})`));
    else L.push(`- (tidak tersedia${news.error ? `: ${news.error}` : ''})`);
  }
  L.push('=== AKHIR DATA FUNDAMENTAL ===');
  return {
    text: L.join('\n'),
    offline,
    stale: cal.stale,
    error: cal.error,
    fetchedAt: cal.fetchedAt,
    newsUsed: news.enabled && news.items.length > 0,
    manualCount: manual.size,
    pendingActual: hasPendingActual(cal.events, now.getTime()),
  };
}
