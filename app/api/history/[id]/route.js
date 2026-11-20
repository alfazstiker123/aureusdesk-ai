import { NextResponse } from 'next/server';
import { getSupabase, TABLE, BUCKET } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/history/:id -> detail lengkap (termasuk markdown)
export async function GET(_req, { params }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'ID tidak valid.' }, { status: 400 });

    const sb = getSupabase();
    const { data, error } = await sb.from(TABLE).select('*').eq('id', id).single();
    if (error) throw error;
    return NextResponse.json({ item: data });
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Analisa tidak ditemukan.' }, { status: 404 });
  }
}

// DELETE /api/history/:id -> hapus baris + thumbnail di Storage
export async function DELETE(_req, { params }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'ID tidak valid.' }, { status: 400 });

    const sb = getSupabase();
    const { data: row } = await sb.from(TABLE).select('thumbnails').eq('id', id).single();

    const paths = (row?.thumbnails || []).map((t) => t.path).filter(Boolean);
    if (paths.length) {
      await sb.storage.from(BUCKET).remove(paths);
    }

    const { error } = await sb.from(TABLE).delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Gagal menghapus.' }, { status: 500 });
  }
}
