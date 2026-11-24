import { NextResponse } from 'next/server';
import { getSupabase, TABLE, BUCKET } from '@/lib/supabase';
import { requirePin } from '@/lib/auth';
import { isOrderKey, sanitizeResult } from '@/lib/orderResults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/history/:id -> detail lengkap (termasuk markdown)
export async function GET(req, { params }) {
  const denied = requirePin(req);
  if (denied) return denied;
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
export async function DELETE(req, { params }) {
  const denied = requirePin(req);
  if (denied) return denied;
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

const OUTCOMES = ['PENDING', 'WIN', 'LOSS', 'BEP', 'CANCEL'];

// PATCH /api/history/:id  body: { outcome, pnl_usd?, eval_notes? } -> simpan evaluasi hasil trading
export async function PATCH(req, { params }) {
  const denied = requirePin(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'ID tidak valid.' }, { status: 400 });

    const body = await req.json().catch(() => null);

    // Hasil per order 4B (Hit TP/SL, Cut, Expired): body { order_key: 'SELL-Z1', result: {...} | null (hapus) }
    if (body && body.order_key !== undefined) {
      if (!isOrderKey(body.order_key)) return NextResponse.json({ error: 'Kunci order tidak valid.' }, { status: 400 });
      let clean = null;
      if (body.result) {
        try { clean = sanitizeResult(body.result); } catch (e) { return NextResponse.json({ error: e.message }, { status: 400 }); }
      }
      const sb = getSupabase();
      const { data: cur, error: gErr } = await sb.from(TABLE).select('order_results').eq('id', id).single();
      if (gErr) throw gErr;
      const next = { ...(cur?.order_results || {}) };
      if (clean) next[body.order_key] = clean; else delete next[body.order_key];
      const { data, error } = await sb.from(TABLE).update({ order_results: next }).eq('id', id).select('id, order_results').single();
      if (error) throw error;
      return NextResponse.json({ item: data });
    }

    const outcome = String(body?.outcome || '').toUpperCase();
    if (!OUTCOMES.includes(outcome)) {
      return NextResponse.json({ error: 'Outcome tidak valid.' }, { status: 400 });
    }

    // Nominal: boleh kosong -> 0. BEP/CANCEL/PENDING selalu 0 kecuali user mengisi (mis. biaya)
    let pnl = 0;
    if (body?.pnl_usd !== undefined && body.pnl_usd !== null && String(body.pnl_usd).trim() !== '') {
      pnl = Number(String(body.pnl_usd).replace(/,/g, '').replace(/\s|\$/g, ''));
      if (!Number.isFinite(pnl) || Math.abs(pnl) > 1e9) {
        return NextResponse.json({ error: 'Nominal PnL tidak valid.' }, { status: 400 });
      }
    }
    // Konsistensi tanda: WIN -> positif, LOSS -> negatif (user boleh mengetik tanpa tanda)
    if (outcome === 'WIN') pnl = Math.abs(pnl);
    if (outcome === 'LOSS') pnl = -Math.abs(pnl);
    if (outcome === 'PENDING' || outcome === 'CANCEL') pnl = 0;
    pnl = Math.round(pnl * 100) / 100;

    const notes = String(body?.eval_notes ?? '').trim().slice(0, 500) || null;

    const sb = getSupabase();
    const { data, error } = await sb
      .from(TABLE)
      .update({ outcome, pnl_usd: pnl, eval_notes: notes })
      .eq('id', id)
      .select('id, outcome, pnl_usd, eval_notes')
      .single();
    if (error) throw error;
    return NextResponse.json({ item: data });
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Gagal menyimpan evaluasi.' }, { status: 500 });
  }
}
