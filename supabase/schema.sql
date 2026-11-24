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

-- Evaluasi hasil trading (fitur Rekap Performa)
alter table public.trading_analyses
  add column if not exists outcome    text    not null default 'PENDING',
  add column if not exists pnl_usd    numeric not null default 0,
  add column if not exists eval_notes text;

alter table public.trading_analyses drop constraint if exists trading_analyses_outcome_check;
alter table public.trading_analyses
  add constraint trading_analyses_outcome_check
  check (outcome in ('PENDING','WIN','LOSS','BEP','CANCEL'));

create index if not exists trading_analyses_outcome_idx
  on public.trading_analyses (outcome);

create index if not exists trading_analyses_created_at_idx
  on public.trading_analyses (created_at desc);

-- 2) ROW LEVEL SECURITY ----------------------------------------------
-- Aplikasi ini single-user tanpa login, jadi role anon diizinkan
-- membaca, menambah, mengubah (kolom evaluasi saja), dan menghapus. (Lihat README bagian Keamanan.)
alter table public.trading_analyses enable row level security;

drop policy if exists "aureus_select" on public.trading_analyses;
drop policy if exists "aureus_insert" on public.trading_analyses;
drop policy if exists "aureus_delete" on public.trading_analyses;
drop policy if exists "aureus_update" on public.trading_analyses;

create policy "aureus_select" on public.trading_analyses
  for select to anon, authenticated using (true);

create policy "aureus_insert" on public.trading_analyses
  for insert to anon, authenticated with check (true);

create policy "aureus_delete" on public.trading_analyses
  for delete to anon, authenticated using (true);

create policy "aureus_update" on public.trading_analyses
  for update to anon, authenticated using (true) with check (true);

-- UPDATE dibatasi hanya ke kolom evaluasi (markdown/pair/dll tidak bisa diubah)
revoke update on public.trading_analyses from anon, authenticated;
grant update (outcome, pnl_usd, eval_notes) on public.trading_analyses to anon, authenticated;

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

-- v3: candle untuk peta zona (opsional)
alter table public.trading_analyses add column if not exists candles jsonb;

-- v4: hasil per order 4B (Hit TP/SL, Cut Profit/Loss, Expired) untuk evaluasi & rekap
alter table public.trading_analyses add column if not exists order_results jsonb not null default '{}'::jsonb;
grant update (order_results) on public.trading_analyses to anon, authenticated;
