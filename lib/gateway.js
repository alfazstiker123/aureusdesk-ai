// Gateway OpenAI-compatible (chat/completions). Kredensial HANYA dari env server:
//   OPENAI_COMPAT_BASE_URL (mis. https://host/v1) dan OPENAI_COMPAT_API_KEY. Tidak pernah dikirim ke/dari browser.

export function gatewayConfig() {
  const raw = (process.env.OPENAI_COMPAT_BASE_URL || '').trim().replace(/\/+$/, '');
  const key = (process.env.OPENAI_COMPAT_API_KEY || '').trim();
  if (!raw || !key || !/^https:\/\//i.test(raw)) return null;
  return { base: raw, key };
}

// Nama model dari klien harus berbentuk id sederhana (cegah karakter aneh).
export const MODEL_ID_OK = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:\-/]{1,80}$/.test(v);
export const isGeminiModel = (m) => /^gemini/i.test(m || '');

export { GATEWAY_PRESETS } from '@/lib/modelPresets';

/** Panggil chat/completions dengan gambar (data URI). @returns {{ok, status, text, error}} */
export async function callGateway({ model, system, userText, images, labels, timeoutMs, maxTokens = 8192 }) {
  const cfg = gatewayConfig();
  if (!cfg) return { ok: false, status: 0, text: '', error: 'gateway belum dikonfigurasi' };
  const content = [{ type: 'text', text: userText }];
  images.forEach((img, i) => {
    content.push({ type: 'text', text: `Gambar ${i + 1} — ${labels[i]}` });
    content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
  });
  try {
    const r = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(5_000, timeoutMs)),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message || j?.message || `HTTP ${r.status}`;
      return { ok: false, status: r.status, text: '', error: String(msg).slice(0, 200) };
    }
    const c = j?.choices?.[0]?.message?.content;
    const text = Array.isArray(c) ? c.map((p) => p?.text || '').join('') : String(c || '');
    return { ok: true, status: r.status, text: text.trim(), error: null, finish: j?.choices?.[0]?.finish_reason };
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e?.name === 'TimeoutError' ? 'timeout' : String(e?.message || 'gagal').slice(0, 200) };
  }
}

/** Daftar id model dari GET {base}/models (untuk tombol Tes). */
export async function listGatewayModels() {
  const cfg = gatewayConfig();
  if (!cfg) return { ok: false, error: 'OPENAI_COMPAT_BASE_URL / OPENAI_COMPAT_API_KEY belum diatur di Vercel.' };
  try {
    const r = await fetch(`${cfg.base}/models`, {
      headers: { Authorization: `Bearer ${cfg.key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: String(j?.error?.message || `HTTP ${r.status}`).slice(0, 200) };
    const ids = (Array.isArray(j?.data) ? j.data : []).map((m) => String(m?.id || '')).filter((x) => MODEL_ID_OK(x));
    return { ok: true, status: r.status, models: ids.slice(0, 80), total: ids.length };
  } catch (e) {
    return { ok: false, error: e?.name === 'TimeoutError' ? 'timeout' : String(e?.message || 'gagal').slice(0, 200) };
  }
}
