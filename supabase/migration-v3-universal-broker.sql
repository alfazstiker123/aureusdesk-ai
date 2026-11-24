-- AureusDesk Universal Broker V2 (MT4) — isolasi data per koneksi broker + spesifikasi kontrak.
-- Aman dijalankan ulang (idempotent). Baris lama otomatis menjadi connection_id = 'legacy' (fallback lama tetap jalan).
alter table public.mt4_market_snapshots add column if not exists connection_id text not null default 'legacy';
alter table public.mt4_market_snapshots add column if not exists platform text not null default 'MT4';
alter table public.mt4_market_snapshots add column if not exists broker text;
alter table public.mt4_market_snapshots add column if not exists server text;
alter table public.mt4_market_snapshots add column if not exists account_currency text;
alter table public.mt4_market_snapshots add column if not exists account_mask text;      -- mis. ****1234 (bukan nomor lengkap)
alter table public.mt4_market_snapshots add column if not exists canonical_symbol text;  -- mis. XAUUSD untuk broker symbol XAUUSDm
alter table public.mt4_market_snapshots add column if not exists spec jsonb;             -- MarketInfo: lotsize,tickvalue,ticksize,digits,point,minlot,maxlot,lotstep,stoplevel,freezelevel,spread

do $$
begin
  if exists (select 1 from pg_constraint where conrelid='public.mt4_market_snapshots'::regclass and conname='mt4_market_snapshots_pkey'
             and pg_get_constraintdef(oid) not like '%connection_id%') then
    alter table public.mt4_market_snapshots drop constraint mt4_market_snapshots_pkey;
    alter table public.mt4_market_snapshots add primary key (connection_id, symbol, timeframe);
  end if;
end $$;

create index if not exists mt4_market_conn_idx on public.mt4_market_snapshots(connection_id, received_at desc);
create index if not exists mt4_market_canon_idx on public.mt4_market_snapshots(canonical_symbol, received_at desc);
