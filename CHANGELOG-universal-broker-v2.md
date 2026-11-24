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

## Revisi audit (P0/P1)
- P0 lot < minLot: `lotFloorSpec` kini mengembalikan 0 (tidak dinaikkan); order dibatalkan dengan pesan NO TRADE.
- P0 satuan tick: validasi ticksize kelipatan point + tickValue/tickSize harus cocok contract size (kuotasi USD & akun USD); EA mencetak baris `AureusDesk SPEC` untuk verifikasi manual di Headway. BELUM diverifikasi dengan nilai Headway nyata.
- P1 lot step pecahan (0.25/0.125) kelipatan step, presisi dari step sebenarnya.
- Audit lanjutan: lot hasil AI < minLot broker kini langsung NO TRADE (baris dibatalkan, tidak dinaikkan, tidak dipertahankan), baik dengan/tanpa batas risiko user; lot > maxLot dipotong ke maxLot; lot dibulatkan ke kelipatan step. Berlaku juga di jalur batas risiko per arah.
