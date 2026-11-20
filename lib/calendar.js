// Kalender ekonomi live: FMP (utama, ada Actual) -> ForexFactory JSON feed (cadangan, tanpa Actual) + headline Finnhub opsional.
// Semua jam dikonversi ke WIB (Asia/Jakarta). Cache di memori server agar tidak kena rate-limit.

const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const FF_TTL = 45 * 60 * 1000; // 45 menit
const FF_RETRY_AFTER_FAIL = 3 * 60 * 1000; // jangan menggempur feed setelah gagal
const NEWS_TTL = 15 * 60 * 1000;
const TZ = 'Asia/Jakarta';

import { fetchFMP, fmpKey, compareText } from '@/lib/fmp';

// ---- FMP: hemat kuota (paket 250 req/hari) ----
const FMP_TTL_IDLE = 30 * 60 * 1000; // tidak ada rilis menunggu Actual
const FMP_TTL_ACTIVE = 5 * 60 * 1000; // ada rilis (<=90 mnt lalu) yang Actual-nya belum terisi
const FMP_DAILY_CAP = 200; // batas pengaman per instance server
const ACTUAL_WATCH_MS = 90 * 60 * 1000;
let fmpCache = { events: null, at: 0, failAt: 0, error: null, status: null, disabledUntil: 0, day: '', used: 0 };
let fmpInflight = null;

let ffCache = { events: null, at: 0, failAt: 0, error: null };
let ffInflight = null;
let newsCache = { items: null, at: 0 };

// ---------- util WIB ----------
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const wibDay = (d) => dayFmt.format(d);
export const wibTime = (d) => timeFmt.format(d);
const wibStamp = (d) => `${wibDay(d)} ${wibTime(d)} WIB`;

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
async function getFFCalendar() {
  const now = Date.now();
  if (ffCache.events && now - ffCache.at < FF_TTL) {
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

/** Rilis data (punya forecast/previous) yang sudah lewat jadwal <=90 menit tetapi Actual masih kosong. */
export function pendingActual(events, now = Date.now()) {
  return (events || []).some(
    (e) =>
      (e.impact === 'High' || e.impact === 'Medium') &&
      !e.actual &&
      (e.forecast || e.previous) &&
      e.time.getTime() <= now &&
      now - e.time.getTime() <= ACTUAL_WATCH_MS
  );
}

async function getFMPCalendar() {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (fmpCache.day !== today) fmpCache = { ...fmpCache, day: today, used: 0 };
  const ttl = fmpCache.events && pendingActual(fmpCache.events, now) ? FMP_TTL_ACTIVE : FMP_TTL_IDLE;
  const fresh = fmpCache.events && now - fmpCache.at < ttl;
  const blocked = now < fmpCache.disabledUntil || (fmpCache.failAt && now - fmpCache.failAt < 60 * 1000) || fmpCache.used >= FMP_DAILY_CAP;
  if (!fresh && !blocked) {
    if (!fmpInflight) {
      fmpCache.used += 1;
      fmpInflight = fetchFMP(new Date())
        .then((events) => {
          fmpCache = { ...fmpCache, events, at: Date.now(), failAt: 0, error: null, status: 200 };
        })
        .catch((e) => {
          const st = e?.status ?? 0;
          // 401/402/403 = key/paket tidak berhak -> berhenti mencoba 1 jam; 429 = kena limit -> 10 menit
          const off = st === 401 || st === 402 || st === 403 ? 60 * 60e3 : st === 429 ? 10 * 60e3 : 0;
          fmpCache = { ...fmpCache, failAt: Date.now(), error: e?.name === 'TimeoutError' ? 'timeout' : e?.message || 'gagal', status: st, disabledUntil: off ? Date.now() + off : 0 };
        })
        .finally(() => {
          fmpInflight = null;
        });
    }
    await fmpInflight;
  }
  const ok = fmpCache.events && !fmpCache.failAt;
  return {
    events: fmpCache.events || [],
    fetchedAt: fmpCache.events ? fmpCache.at : null,
    stale: Boolean(fmpCache.events) && !ok,
    error: ok ? null : fmpCache.error,
  };
}

/** Sumber utama FMP (Actual/Estimate/Previous/Impact); jika key kosong / gagal / kosong -> ForexFactory (tanpa Actual). */
export async function getCalendar() {
  let fmpErr = null;
  if (fmpKey()) {
    const f = await getFMPCalendar();
    if (f.events.length) return { ...f, source: 'FMP', fmpError: f.stale ? f.error : null };
    fmpErr = f.error || 'FMP tidak mengembalikan event';
  }
  const ff = await getFFCalendar();
  return { ...ff, source: 'ForexFactory', fmpError: fmpErr };
}

export function calendarDebug() {
  return { hasKey: Boolean(fmpKey()), cached: fmpCache.events?.length || 0, status: fmpCache.status, error: fmpCache.error, usedToday: fmpCache.used, disabledUntil: fmpCache.disabledUntil || null };
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

function actualText(e, now) {
  if (e.actual) return `${e.actual} ${compareText(e)}`.trim();
  return released(e, now) ? 'sudah lewat jadwal, belum terisi di sumber data (jangan menebak)' : 'Belum Rilis';
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
  return {
    events: list,
    onlyMedium: !high.length && list.length > 0,
    currencies,
    offline: Boolean(cal.error) && !cal.fetchedAt,
    stale: cal.stale,
    source: cal.source,
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
export async function buildFundamentalBlock(pairId, now = new Date()) {
  const [cal, news] = await Promise.all([getCalendar(), getFinnhubNews()]);
  const currencies = currenciesFor(pairId);
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
      `STATUS KALENDER: ${cal.stale ? `DATA LAMA (sumber gagal diperbarui: ${cal.error}), ` : ''}sumber ${cal.source}${cal.source === 'ForexFactory' ? ' (TANPA angka Actual)' : ' (ada Actual/Forecast/Previous)'}, diambil ${ageMin} menit lalu.`
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
          `- ${wibDay(e.time)} ${wibTime(e.time)} WIB | ${e.currency} | ${e.impact.toUpperCase()} | ${e.title} | Forecast: ${e.forecast || '-'} | Previous: ${e.previous || '-'} | Actual: ${actualText(e, now)}`
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
    source: cal.source,
    newsUsed: news.enabled && news.items.length > 0,
  };
}
