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
- Uji properti (400 kombinasi acak, 4 profil lot) untuk batas risiko per arah: total risiko order aktif tidak melebihi batas, semua lot aktif valid. Menemukan & memperbaiki bug tampilan: lot 0.625 (step 0.125) tertulis 0.63; kini tampilan memakai presisi step.

## Audit #3 — konsistensi keputusan (tanpa mengubah mesin SMC)
- Akar masalah: headline "NETRAL … (H1/H4 BULLISH, M5/M15 BEARISH)" memuat kata BULLISH & BEARISH → dianggap tanpa arah → bias mesin (BULLISH) menang → "SETUP UTAMA BUY". Perbaikan: `isNeutralHeadline` + status baru WAIT & SEE (zona hanya kandidat, bukan eksekusi).
- Zona di bawah standar R:R (Zona 3 < 1:2.0, Zona 1/2 < 1:1.5) tidak lagi jadi setup utama.
- Peringatan zona searah yang tumpang tindih / SL sama (mis. BUY Zona 2 & 3) → jangan dihitung sebagai eksposur terpisah.
- Peringatan bila snapshot antar timeframe berselisih > 6 menit (`snapshotSpreadMinutes`).
- Tes: 144/144 lulus. BOS/CHoCH, koordinat zona, auto-trading tidak disentuh.
- Belum dikerjakan: pemetaan overlap OB/FVG, penurunan status berdasar MN/W1/D1 vs gaya trading, sinkron Bagian 3 vs 4B.

## Audit #4 — sumber tunggal angka zona (Bagian 3 = 4B = Rincian Risiko)
- Akar masalah SL 3605.00 vs 3605.27: sinkron SL Bagian 3→4B memakai toleransi 0.02×ATR H1 (± $0.3 pada emas), sehingga selisih kecil lolos; teks "R:R ~1:2.0" di kolom konfirmasi Bagian 3 juga tidak pernah dihitung ulang.
- Baru `lib/finalSync.js`: baris 4B = sumber final Entry/SL/TP1. Tahap 1 (sebelum validator risiko): Bagian 3 mengikuti 4B; setup yang tak bisa diselaraskan dibatalkan di KEDUA tabel (entry 4B di luar zona Bagian 3, hanya satu tabel punya setup, TP/SL hilang atau salah arah) → WAIT / NO TRADE. Tahap 2 (setelah validator): Jarak SL, R:R, Risiko, teks R:R Bagian 3 dan Rincian Hitung Risiko dihitung ulang dari angka final; audit akhir membatalkan zona yang masih tidak selaras. TP2 yang tidak lebih jauh dari TP1 dikosongkan.
- Toleransi sinkron SL di `enforceSmcZones` diperketat ke 1 tick.
- Zona yang ditolak validator (lot < minimum / batas risiko) sekarang juga dikosongkan di Bagian 3 (tidak ada zona "hidup" tanpa order).
- Tes: 160/160 lulus (16 baru: SL, TP1, TP2, entry, lot, risiko, R:R, rincian, SELL, fuzz 300 kasus, integrasi dengan validator risiko, urutan di route). Tes SL gagal pada kode lama.
- Tidak diubah: mesin SMC, BOS/CHoCH, koordinat zona, auto-trading. Catatan: Ringkasan Cepat/Skenario Batal berupa teks bebas Gemini; angka zona di sana belum disinkronkan.

## Audit #5 — tutup celah finalSync + sinkron teks bebas
- P0-A: zona aktif yang hanya ada di satu tabel (tanpa baris pasangan) tidak lagi dilewati: dibatalkan di Bagian 3/4B dan rincian risiko; audit menandainya (`pasangan`).
- P0-B: toleransi entry diperketat dari 0.1×ATR H1 menjadi 1 tick pembulatan. Opsi `entryTol` dihapus dari route dan diabaikan di modul; entry di luar zona Bagian 3 → setup dibatalkan.
- Teks bebas (Ringkasan Cepat, Skenario Batal, Manajemen Posisi, kesimpulan): `syncNarrative` menulis ulang Entry/SL/TP1/TP2/R:R/lot/risiko berlabel dari tabel final, mengganti angka lama yang diubah server (mis. SL 3605.00 → 3605.27), dan mengubah rujukan zona yang batal/tidak punya setup menjadi "WAIT / NO TRADE". Klausa yang memuat dua zona dengan angka berlabel diganti rujukan ke tabel. Tabel, blok kode, dan catatan "Verifikasi risiko otomatis" tidak disentuh. Idempoten + audit (`auditNarrative`).
- Tes: 175/175 lulus (31 tes finalSync, termasuk fuzz 300 + 200 kasus dan integrasi dengan validator risiko).
- Tidak diubah: mesin SMC, BOS/CHoCH, koordinat zona, auto-trading. Belum: pemetaan overlap OB/FVG (tahap 3), konteks MN/W1/D1 menurut gaya trading (tahap 4). Batasan: angka tanpa label (mis. "close di bawah 3605.00") hanya diganti bila sama dengan angka lama yang diubah server.
