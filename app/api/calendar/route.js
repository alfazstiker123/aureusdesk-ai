import { NextResponse } from 'next/server';
import { requirePin } from '@/lib/auth';
import { todayHighlights } from '@/lib/calendar';
import { PAIR_ID_OK } from '@/lib/pairs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/calendar?pair=EURUSD  -> berita High-Impact hari ini (WIB) untuk widget
export async function GET(req) {
  const denied = requirePin(req);
  if (denied) return denied;
  const p = new URL(req.url).searchParams.get('pair') || 'AUTO';
  const pair = PAIR_ID_OK(p) && p !== 'AUTO' ? p : null;
  try {
    return NextResponse.json(await todayHighlights(pair));
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Gagal memuat kalender.' }, { status: 500 });
  }
}
