import { NextResponse } from 'next/server';
import { getSupabase, TABLE, BUCKET } from '@/lib/supabase';
import { GEMINI_MODEL } from '@/lib/prompt';
import { requirePin } from '@/lib/auth';
import { getCalendar, calendarDebug } from '@/lib/calendar';
import { gatewayChat, gatewayModels, gwConfigured, gwModelOf } from '@/lib/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/health            -> cek env + Supabase (tabel & bucket)
// GET /api/health?gemini=1   -> + uji panggilan Gemini (tanpa search); ?calendar=1 uji feed kalender
export async function GET(req) {
  const out = {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
    },
    supabase: { table: null, bucket: null },
    gemini: null,
    calendar: null,
    gateway: null,
    marketData: { provider: 'Kraken (cadangan: Binance market-data)', keyless: true, pairs: ['BTCUSD', 'XAUUSD (proksi PAXG)'], mode: 'cloud' },
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
  if (searchParams.get('calendar') === '1') {
    const c = await getCalendar();
    out.calendar = { source: c.source, events: c.events.length, withActual: c.events.filter((e) => e.actual).length, fetchedAt: c.fetchedAt, stale: c.stale, error: c.error, fmpError: c.fmpError, fmp: calendarDebug() };
  }
  if (searchParams.get('gateway') === '1') {
    const denied = requirePin(req);
    if (denied) return denied;
    if (searchParams.get('models') === '1') {
      out.gatewayModels = await gatewayModels();
    } else if (!gwConfigured()) {
      out.gateway = 'ERROR: env OPENAI_COMPAT_BASE_URL / OPENAI_COMPAT_API_KEY belum diisi';
    } else {
      const g = await gatewayChat({ model: gwModelOf(searchParams.get('model')), user: 'Balas satu kata: OK', maxTokens: 20, timeoutMs: 25000 });
      out.gateway = g.ok ? { status: 'OK', model: gwModelOf(searchParams.get('model')), ms: g.ms, sample: g.text.slice(0, 80) } : `ERROR${g.status ? ' ' + g.status : ''}: ${g.error} (${g.ms}ms)`;
    }
  }
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
