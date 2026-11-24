# Universal Broker V2 (MT4) — changelog
Migrasi: `supabase/migration-v3-universal-broker.sql` (sudah diterapkan di project produksi; idempotent).
- DB: `mt4_market_snapshots` PK → (connection_id, symbol, timeframe); kolom broker/server/platform/account_currency/account_mask/canonical_symbol/spec. Baris lama = connection_id `legacy` (fallback tetap jalan).
- `lib/instruments.js`: registry + normalisasi simbol (suffix/prefix/alias). Simbol tak dikenal ditolak.
- `lib/pairs.js`: profil baru NAS100, US30, US500, USOIL, UKOIL, ETHUSD, USDCAD, USDCHF, EURGBP, EURAUD, GBPAUD; `riskMult` memakai tickValue/tickSize bila spek valid.
- `lib/brokerSpec.js`: validasi spek, lot min/max/step.
- `lib/riskCheck.js`: lot/risiko sesuai spek; peringatan bila spek tak tersedia; catatan mata uang akun.
- `lib/mt4Market.js` + route: isolasi per koneksi, pemilihan koneksi, validasi simbol/harga/ask-bid.
- `app/api/analyze`: connectionId, blok spek di prompt, notice koneksi/spek. Mesin SMC & rumus zona TIDAK diubah.
- UI: Pengaturan → Koneksi Broker MT4.
- EA v3.2: default simbol = chart, kirim spek + koneksi, tetap read-only.
Env baru: tidak wajib (opsional `MT4_SYMBOL_MAP` seperti sebelumnya).
