import { NextResponse } from 'next/server';
import { getSupabase, TABLE, BUCKET } from '@/lib/supabase';
import { GEMINI_MODEL } from '@/lib/prompt';
import { requirePin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/health            -> cek env + Supabase (tabel & bucket)
// GET /api/health?gemini=1   -> + uji panggilan Gemini dengan Google Search
export async function GET(req) {
  const out = {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
    },
    supabase: { table: null, bucket: null },
    gemini: null,
  };

  try {
    const sb = getSupabase();
    const { error } = await sb.from(TABLE).select('id', { count: 'exact', head: true });
    out.supabase.table = error ? `ERROR: ${error.message}` : 'OK';
    const { error: bErr } = await sb.storage.from(BUCKET).list('', { limit: 1 });
    out.supabase.bucket = bErr ? `ERROR: ${bErr.message}` : 'OK';
  } catch (e) {
    out.supabase.table = `ERROR: ${e.message}`;
  }

  const { searchParams } = new URL(req.url);
  if (searchParams.get('gemini') === '1') {
    const denied = requirePin(req); // uji Gemini memakai kuota -> wajib PIN
    if (denied) return denied;
  }
  if (searchParams.get('gemini') === '1' && process.env.GEMINI_API_KEY) {
    // ?model=... untuk menguji model fallback (hanya model yang diizinkan)
    const allowed = [GEMINI_MODEL, 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-flash-lite-latest'];
    const testModel = allowed.includes(searchParams.get('model')) ? searchParams.get('model') : GEMINI_MODEL;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${testModel}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Sebutkan harga spot emas XAU/USD terbaru dalam 1 kalimat singkat.' }] }],
            ...(searchParams.get('search') === '0' ? {} : { tools: [{ googleSearch: {} }] }),
            generationConfig: { maxOutputTokens: 200 },
          }),
          cache: 'no-store',
        }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        out.gemini = `ERROR ${res.status}: ${j?.error?.message || 'unknown'}`;
      } else {
        const cand = j?.candidates?.[0];
        const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
        out.gemini = {
          status: 'OK',
          model: testModel,
          grounded: Boolean(cand?.groundingMetadata?.groundingChunks?.length),
          sample: text.slice(0, 300),
        };
      }
    } catch (e) {
      out.gemini = `ERROR: ${e.message}`;
    }
  }

  const ok =
    out.env.NEXT_PUBLIC_SUPABASE_URL &&
    out.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    out.supabase.table === 'OK' &&
    out.supabase.bucket === 'OK';

  return NextResponse.json({ ok, ...out }, { status: ok ? 200 : 500 });
}
