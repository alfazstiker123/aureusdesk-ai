import { NextResponse } from 'next/server';
import { pinMatches } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Pembatas percobaan sederhana per IP (best-effort pada serverless)
const fails = new Map();
const MAX_FAILS = 5;
const WINDOW_MS = 60_000;

export async function POST(req) {
  const ip = (req.headers.get('x-forwarded-for') || 'x').split(',')[0].trim();
  const now = Date.now();
  const rec = fails.get(ip);
  if (rec && rec.count >= MAX_FAILS && now - rec.first < WINDOW_MS) {
    return NextResponse.json({ error: 'Terlalu banyak percobaan. Coba lagi 1 menit lagi.' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  if (pinMatches(String(body?.pin || ''))) {
    fails.delete(ip);
    return NextResponse.json({ ok: true });
  }

  const cur = rec && now - rec.first < WINDOW_MS ? rec : { count: 0, first: now };
  cur.count += 1;
  fails.set(ip, cur);
  await new Promise((r) => setTimeout(r, 600)); // perlambat brute-force
  return NextResponse.json({ error: 'PIN salah.' }, { status: 401 });
}
