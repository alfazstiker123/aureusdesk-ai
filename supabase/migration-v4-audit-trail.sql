-- v4: jejak audit per analisa (konfigurasi, snapshot per timeframe, model, versi). Aditif; riwayat lama tidak diubah (kolom NULL).
alter table public.trading_analyses add column if not exists audit_meta jsonb;
comment on column public.trading_analyses.audit_meta is 'Jejak audit analisa: configHash, snapshot (id, received_at, barsSha) per TF, model, deployment, engineVersion, bias. Disalin saat analisa dibuat; tidak ikut berubah ketika snapshot MT4 terbaru masuk.';
