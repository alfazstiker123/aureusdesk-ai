// Angka "Actual" rilis berita secara real-time. Feed ForexFactory (JSON gratis) TIDAK memuat field actual,
// jadi untuk rilis yang sudah lewat jadwal, angka dicari lewat Gemini + Google Search (grounding).
// Hasil divalidasi ketat (format angka saja) dan hanya dipakai bila ditemukan; selain itu tetap "belum tersedia".
const MODEL = 'gemini-flash-latest';
const FOUND_TTL = 6 * 60 * 60 * 1000;
const MISS_TTL = 3 * 60 * 1000; // coba lagi tiap 3 menit sampai angka muncul
const TIMEOUT_MS = 9000;

export const ACTUAL_RE = /^[-+]?\d[\d.,]*\s?[%KMBTkmbt]?$/;

const cache = new Map(); // key -> { actual|null, at }
let inflight = null;

function parseJsonArray(text) {
  const m = String(text || '').match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const a = JSON.parse(m[0]);
    return Array.isArray(a) ? a : null;
  } catch {
    return null;
  }
}

/**
 * @param {Array<{key:string,title:string,currency:string,timeWIB:string,forecast:string,previous:string}>} items
 * @returns {Promise<Map<string,string>>} key -> actual (hanya yang ditemukan)
 */
export async function lookupActuals(items, apiKey, now = Date.now()) {
  const out = new Map();
  if (!apiKey || !items.length) return out;

  const need = [];
  for (const it of items) {
    const c = cache.get(it.key);
    if (c && now - c.at < (c.actual ? FOUND_TTL : MISS_TTL)) {
      if (c.actual) out.set(it.key, c.actual);
    } else need.push(it);
  }
  if (!need.length) return out;

  if (!inflight) {
    const batch = need.slice(0, 5);
    const list = batch
      .map((it, i) => `${i}. ${it.timeWIB} WIB | ${it.currency} | ${it.title} | Forecast: ${it.forecast || '-'} | Previous: ${it.previous || '-'}`)
      .join('\n');
    const prompt = `Tanggal sekarang (WIB): ${new Date(now + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')}.
Cari di web hasil rilis TERBARU (angka "Actual") untuk event kalender ekonomi berikut (jam WIB):
${list}

Jawab HANYA dengan JSON array, tanpa teks lain, contoh: [{"i":0,"actual":"51.3"},{"i":1,"actual":null}]
Aturan: isi "actual" hanya jika Anda menemukan angka rilis aktual yang tepat untuk event & periode itu dari sumber berita/data tepercaya. Jika belum dirilis, tidak ditemukan, atau ragu, isi null. DILARANG menebak dan DILARANG menyalin Forecast/Previous sebagai Actual. Tulis angka apa adanya beserta satuan singkat bila ada (contoh 51.3, 4.5%, 225K).`;
    inflight = fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0, maxOutputTokens: 400 },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        const text = (j?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
        const arr = r.ok ? parseJsonArray(text) : null;
        const found = new Map();
        for (const row of arr || []) {
          const it = batch[Number(row?.i)];
          const v = String(row?.actual ?? '').trim();
          if (it && v && v.length <= 12 && ACTUAL_RE.test(v)) found.set(it.key, v);
        }
        const t = Date.now();
        for (const it of batch) cache.set(it.key, { actual: found.get(it.key) || null, at: t });
      })
      .catch(() => {
        const t = Date.now();
        for (const it of batch) if (!cache.has(it.key)) cache.set(it.key, { actual: null, at: t });
      })
      .finally(() => {
        inflight = null;
      });
  }
  await inflight;
  for (const it of items) {
    const c = cache.get(it.key);
    if (c?.actual) out.set(it.key, c.actual);
  }
  return out;
}
