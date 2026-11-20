import { NextResponse } from 'next/server';
import { getSupabase, TABLE, BUCKET } from '@/lib/supabase';
import { requirePin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIST_COLUMNS =
  'id, created_at, pair, account_balance, risk_percent, session_label, summary_bias, thumbnails, outcome, pnl_usd, eval_notes';

// GET /api/history -> daftar riwayat (tanpa markdown agar ringan)
export async function GET(req) {
  const denied = requirePin(req);
  if (denied) return denied;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from(TABLE)
      .select(LIST_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) throw error;
    return NextResponse.json({ items: data || [] });
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Gagal memuat riwayat.' }, { status: 500 });
  }
}

function slug(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 30) || 'chart';
}

// POST /api/history -> simpan analisa + upload thumbnail ke Storage
export async function POST(req) {
  const denied = requirePin(req);
  if (denied) return denied;
  try {
    const body = await req.json().catch(() => null);
    if (!body?.markdown) {
      return NextResponse.json({ error: 'Tidak ada hasil analisa untuk disimpan.' }, { status: 400 });
    }

    const sb = getSupabase();
    const id = crypto.randomUUID();
    const thumbs = [];
    let storageWarning = null;

    const list = Array.isArray(body.thumbnails) ? body.thumbnails.slice(0, 12) : [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t?.data) continue;
      const path = `${id}/${String(i + 1).padStart(2, '0')}-${slug(t.label)}.jpg`;
      const { error } = await sb.storage
        .from(BUCKET)
        .upload(path, Buffer.from(t.data, 'base64'), { contentType: 'image/jpeg', upsert: true });
      if (error) {
        storageWarning = error.message;
        continue;
      }
      const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
      thumbs.push({ label: t.label || 'Chart', path, url: data.publicUrl });
    }

    const row = {
      id,
      pair: /^[A-Z0-9]{3,12}$/.test(String(body.pair || '')) ? body.pair : 'XAUUSD',
      account_balance: Number(body.balance) || 0,
      risk_percent: Number(body.risk) || 0,
      session_label: body.session || null,
      summary_bias: body.bias || null,
      analysis_markdown: body.markdown,
      thumbnails: thumbs,
    };

    const { data, error } = await sb.from(TABLE).insert(row).select(LIST_COLUMNS).single();
    if (error) throw error;

    return NextResponse.json({ item: data, storageWarning });
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Gagal menyimpan ke Supabase.' }, { status: 500 });
  }
}
