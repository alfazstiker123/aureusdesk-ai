// Klien gateway OpenAI-compatible (chat/completions). Kunci hanya dari env server.
export const GW_DEFAULT_MODEL = 'kimi-k2.7-code-highspeed';
export const GW_MODEL_RE = /^[A-Za-z0-9._:\/-]{2,80}$/;

export function gwModelOf(v) {
  const s = String(v || '').trim();
  return GW_MODEL_RE.test(s) ? s : GW_DEFAULT_MODEL;
}

export function gwConfigured() {
  return Boolean(process.env.OPENAI_COMPAT_API_KEY && process.env.OPENAI_COMPAT_BASE_URL);
}

function baseUrl() {
  return String(process.env.OPENAI_COMPAT_BASE_URL || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

function scrub(s) {
  const k = process.env.OPENAI_COMPAT_API_KEY;
  let out = String(s ?? '');
  if (k) out = out.split(k).join('***');
  return out.slice(0, 300);
}

/** @returns {{ok:boolean,text?:string,status?:number,error?:string,ms:number}} */
export async function gatewayChat({ model, system, user, history = [], maxTokens = 8000, timeoutMs = 30000, temperature = 0.3 }) {
  const t0 = Date.now();
  if (!gwConfigured()) return { ok: false, error: 'Gateway belum dikonfigurasi (env OPENAI_COMPAT_*).', ms: 0 };
  try {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push(...history, { role: 'user', content: user });
    const r = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_COMPAT_API_KEY}` },
      body: JSON.stringify({ model: gwModelOf(model), messages, temperature, max_tokens: maxTokens, stream: false }),
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(3000, timeoutMs)),
    });
    const j = await r.json().catch(() => ({}));
    const ms = Date.now() - t0;
    if (!r.ok) return { ok: false, status: r.status, error: scrub(j?.error?.message || j?.message || `HTTP ${r.status}`), ms };
    const msg = j?.choices?.[0]?.message;
    const text = (typeof msg?.content === 'string' ? msg.content : '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (!text) return { ok: false, status: r.status, error: 'Respons kosong dari gateway.', ms };
    return { ok: true, text, ms, model: j?.model, finish: j?.choices?.[0]?.finish_reason, usage: j?.usage ? { prompt: j.usage.prompt_tokens, completion: j.usage.completion_tokens } : undefined, sent: JSON.stringify(messages).length };
  } catch (e) {
    return { ok: false, error: e?.name === 'TimeoutError' ? 'timeout' : scrub(e?.message), ms: Date.now() - t0 };
  }
}

/** Daftar model dari gateway (GET /models), diurutkan perkiraan kasta dari NAMA (bukan harga resmi). */
export function tierOf(id) {
  const s = String(id).toLowerCase();
  if (/opus|ultra|max|\bo1\b|\bo3\b|thinking|reason|gpt-5(?!.*(mini|nano))|pro-?max|fable|mythos/.test(s)) return 3;
  if (/pro|sonnet|k2|gpt-4(?!.*mini)|large|plus|deepseek|qwen.*(72|max)|405|70b|gemini.*pro/.test(s)) return 2;
  return 1; // flash/mini/lite/haiku/nano/small & lainnya
}
export async function gatewayModels(timeoutMs = 15000) {
  if (!gwConfigured()) return { ok: false, error: 'Gateway belum dikonfigurasi.' };
  try {
    const r = await fetch(`${baseUrl()}/models`, { headers: { Authorization: `Bearer ${process.env.OPENAI_COMPAT_API_KEY}` }, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: scrub(j?.error?.message || `HTTP ${r.status}`) };
    const ids = (Array.isArray(j?.data) ? j.data : []).map((m) => m?.id).filter((x) => typeof x === 'string' && GW_MODEL_RE.test(x));
    const models = ids.map((id) => ({ id, tier: tierOf(id) })).sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: e?.name === 'TimeoutError' ? 'timeout' : scrub(e?.message) };
  }
}

/** Apakah teks memuat format analisa wajib (BIAS UTAMA + tabel)? */
export function looksLikeAnalysis(text = '') {
  const rows = (String(text).match(/^\s*\|.*\|\s*$/gm) || []).length;
  return /BIAS\s*UTAMA/i.test(text) && rows >= 6;
}
