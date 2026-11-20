-- =====================================================================
-- AureusDesk AI - Skema Supabase
-- Jalankan seluruh isi file ini di Supabase Dashboard > SQL Editor > Run
-- Aman dijalankan ulang (idempotent).
-- =====================================================================

-- 1) TABEL RIWAYAT ANALISA -------------------------------------------
create table if not exists public.trading_analyses (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  pair              text not null default 'XAUUSD',
  account_balance   numeric,
  risk_percent      numeric,
  session_label     text,                       -- 'Sesi Asia' | 'Sesi Eropa' | 'Sesi New York'
  summary_bias      text,                       -- contoh: 'BEARISH - FOKUS SELL'
  analysis_markdown text,                       -- hasil lengkap analisa AI
  thumbnails        jsonb not null default '[]'::jsonb  -- [{label, path, url}] thumbnail di Storage
);

-- Jika tabel sudah pernah dibuat tanpa kolom thumbnails:
alter table public.trading_analyses
  add column if not exists thumbnails jsonb not null default '[]'::jsonb;

create index if not exists trading_analyses_created_at_idx
  on public.trading_analyses (created_at desc);

-- 2) ROW LEVEL SECURITY ----------------------------------------------
-- Aplikasi ini single-user tanpa login, jadi role anon diizinkan
-- membaca, menambah, dan menghapus. (Lihat README bagian Keamanan.)
alter table public.trading_analyses enable row level security;

drop policy if exists "aureus_select" on public.trading_analyses;
drop policy if exists "aureus_insert" on public.trading_analyses;
drop policy if exists "aureus_delete" on public.trading_analyses;

create policy "aureus_select" on public.trading_analyses
  for select to anon, authenticated using (true);

create policy "aureus_insert" on public.trading_analyses
  for insert to anon, authenticated with check (true);

create policy "aureus_delete" on public.trading_analyses
  for delete to anon, authenticated using (true);

-- 3) STORAGE BUCKET UNTUK THUMBNAIL CHART ---------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chart-screenshots', 'chart-screenshots', true, 1048576,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 1048576,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "aureus_storage_select" on storage.objects;
drop policy if exists "aureus_storage_insert" on storage.objects;
drop policy if exists "aureus_storage_delete" on storage.objects;

create policy "aureus_storage_select" on storage.objects
  for select to anon, authenticated using (bucket_id = 'chart-screenshots');

create policy "aureus_storage_insert" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'chart-screenshots');

create policy "aureus_storage_delete" on storage.objects
  for delete to anon, authenticated using (bucket_id = 'chart-screenshots');
