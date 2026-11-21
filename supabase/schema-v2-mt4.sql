-- Jalankan sebagai project owner di Supabase SQL Editor.
create table if not exists public.mt4_market_snapshots (
  symbol text not null, timeframe text not null, bars jsonb not null,
  bid double precision, ask double precision, digits integer,
  source text not null default 'MT4_EA', received_at timestamptz not null default now(),
  primary key(symbol,timeframe)
);
alter table public.mt4_market_snapshots enable row level security;
revoke all on public.mt4_market_snapshots from anon, authenticated;
grant select,insert,update on public.mt4_market_snapshots to service_role;
create index if not exists mt4_market_received_idx on public.mt4_market_snapshots(received_at desc);
