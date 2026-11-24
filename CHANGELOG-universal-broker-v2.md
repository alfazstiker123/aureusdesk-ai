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

## Audit #6 — order gagal validator tidak boleh tampil sebagai order layak (kasus live XAUUSD 24 Nov 14:05 WIB)
- P0 R:R: R:R TP1 di bawah standar zona (Zona 3 Swing < 1:2.0; zona lain < 1:1.5) kini = order GAGAL: baris 4B jadi "Tidak Ada Setup (R:R Di Bawah Standar: Tidak Dipasang)", Bagian 3 ikut batal, Rincian Hitung Risiko "tidak ada order (R:R di bawah standar)", dan TIDAK masuk total risiko / batas per arah (sebelumnya hanya peringatan: BUY Z3 1:1.92 tetap tampil dengan risiko $16.54 dan ikut total $20.49).
- P0 WAIT & SEE vs 4B: setelah keputusan server, tiap order 4B diberi status — "✅ VALIDATED ORDER" (lolos validator & searah bias saat keputusan TRADE) atau "⏳ CANDIDATE (belum boleh dipasang)" (WAIT & SEE / countertrend / NO TRADE). Ada banner status di atas tabel 4B. Server tidak pernah mengklaim "ACTIVE SETUP" karena tidak membaca konfirmasi candle; itu keputusan trader.
- "Aturan Pasang" dibuat ulang server dari tabel final (tidak lagi memakai total/saran pasang karangan Gemini); catatan "Total risiko bila semua order baru terisi" dihitung ulang hanya dari order aktif ($3.95 + $24.07, bukan $20.49 + $24.07).
- P1 BUY Zona 2: catatan guard lama yang menyebut zona yang akhirnya batal (mis. "entry 3545.95 berjarak $75.89") dibuang; koordinat zona lama dihapus dari nama baris yang batal; klausa Skenario Batal yang memuat beberapa zona mati ("Buy Z2 dan Buy Z3 batal bila…") menjadi WAIT / NO TRADE; Lampiran kandidat mesin menandai zona yang dibatalkan validator. Daftar kandidat mesin itu sendiri tidak diubah.
- Tes: 186/186 lulus (11 tes baru `tests/order-status.test.mjs` memakai kasus live: R:R 1.92 vs 2.00, tidak masuk 4B/total risiko, WAIT tanpa pemasangan aktif, konsistensi BUY Zona 2, total dihitung ulang setelah pembatalan). Satu fixture lama (consistency) disesuaikan karena kini R:R < standar = NO TRADE.
- Tidak diubah: mesin SMC, BOS/CHoCH, koordinat zona, auto-trading.

## Audit #7 — Catatan Kepatuhan Risiko memakai angka sebelum pembatalan (kasus live XAUUSD 24 Nov 14:27 WIB)
- Akar masalah: `finalizeOrders` hanya menulis ulang blok berjudul "Aturan Pasang"; Gemini kali ini memakai judul "⚠️ Catatan Kepatuhan Risiko" sehingga narasi lama (Total SELL $37.76, Total BUY $46.77, "pilih HANYA SATU zona", "kombinasi yang PAS") lolos.
- Perbaikan: blok berjudul Aturan Pasang / Catatan Kepatuhan Risiko / Kepatuhan Risiko / Aturan Risiko / Ringkasan Risiko selalu dibuang dan dibangun ulang dari order 4B yang lolos validator (BUY $20.48, SELL $19.98, batas per arah, daftar order yang dibatalkan beserta alasannya). Baris lepas di luar blok yang menyebut "Total BUY/SELL … $x" dihitung ulang; baris yang menyarankan memasang/memilih order saat WAIT & SEE / NO TRADE (termasuk "Rencana" di Ringkasan Cepat) diganti pernyataan bahwa order hanya berstatus CANDIDATE. Saat keputusan TRADE saran Gemini tidak dihapus.
- Catatan verifikasi: "Total risiko per arah (hanya order lolos validator): BUY $x | SELL $y" menggantikan format penjumlahan BUY+SELL yang menyesatkan terhadap batas per arah.
- Temuan tambahan dari fixture live: teks R:R Bagian 3 bergaya "R:R ±1:1,5" (tanda ±, koma desimal) tidak ikut disinkronkan (SELL Zona 2 tertulis 1:1,5 padahal final 1:2.02). Pola R:R diperluas ke "±".
- Tes: 193/193 lulus (7 tes baru `tests/risk-notes.test.mjs` dari kasus live ini). Tidak diubah: mesin SMC, BOS/CHoCH, koordinat zona, aturan R:R, auto-trading.
- Belum (daftar audit berikutnya): overlap BUY Zona 2 & Zona 3 (FVG H1/H4 berdekatan) belum dihitung sebagai satu struktur; timestamp harga ref vs chart manual.

## Audit #8 — invalidation vs SL, spread vs lebar zona, judul/status 4B (kasus live XAUUSD 24 Nov 14:45 WIB)
- **P0 Invalidation vs SL.** Akar masalah: "Skenario Batal" adalah teks bebas Gemini; server hanya menyamakan angka berlabel SL/TP di sana dan tidak pernah memeriksa asal level invalidation. Akibatnya level invalidation bisa sama dengan SL (SELL Z2: 3662.70), level lain tidak diverifikasi (3600.40, 3678.03), dan kolom konfirmasi Bagian 3 memakai SL ("tidak ada close di bawah 3605.20") sedangkan Skenario Batal memakai level lain.
  - Baru `lib/invalidation.js`. Tiap klausa Skenario Batal dinilai terhadap level struktur dari mesin SMC (swing utuh, BOS/CHoCH, tepi OB/FVG, semua TF OK). Level struktur di sisi benar (BUY di bawah zona, SELL di atas zona) dipertahankan; level = SL (bukan struktur), level karangan, dan level di sisi salah dibuang. Server tidak membuat level baru.
  - Baris ditulis ulang: "SL x = batas risiko posisi … Invalidation struktural: candle <TF> close di bawah/atas <level> (<dasar struktur>; <relasi ke SL>)". Relasi: di luar SL → SL biasanya kena lebih dulu; di dalam jarak SL → setup batal lebih dulu (cabut pending bila belum terisi, evaluasi manual bila sudah terisi).
  - Level struktur tanpa TF/kondisi candle ditandai "TF & kondisi candle konfirmasi belum ditentukan" (kondisi candle tidak dikarang). Tanpa level struktur valid atau tanpa baris sama sekali: "Invalidation struktural belum terdefinisi — perlu evaluasi manual". Tanpa data mesin (mode screenshot): teks tidak ditulis ulang, hanya diberi catatan "tidak diverifikasi".
  - Kolom konfirmasi Bagian 3: level "close di bawah/atas X" yang sama dengan SL diberi label "(= SL, batas risiko)"; level lain yang berbeda dari SL dan invalidation dicatat sebagai peringatan (tidak diubah). Idempoten.
- **P1 Spread vs lebar zona.** Akar masalah: satu-satunya peringatan zona sempit memakai 0.08×ATR H1 dan tidak membaca spread.
  - Baru `lib/spreadCheck.js`: spread = Ask − Bid dari kuotasi EA (bukan angka tetap). Rasio spread / lebar zona ≥ 0.25 (heuristik kualitas eksekusi, belum di-backtest) → tanda "⚠️ ZONA SEMPIT — RENTAN SPREAD & SLIPPAGE" di baris Bagian 3 dan 4B plus catatan. BUY: limit terisi saat Ask ≤ entry (Bid ≈ entry − spread) sehingga lebar efektif = lebar − spread; SELL terisi di Bid, tetapi SL SELL terpicu oleh Ask.
  - Hanya peringatan: Entry/SL/TP/lot/risiko tidak diubah, zona tidak dibatalkan. Kuotasi tidak ada, Ask < Bid, spread 0, atau spread > 1% harga → "Spread belum terverifikasi". Generik semua instrumen (rasio, bukan angka per pair).
  - Aturan lama ATR di `zoneCheck` kini hanya cadangan saat spread belum terverifikasi (`spreadVerified`), jadi tidak ada validator ganda.
- **P1 Judul & status 4B.** `finalizeOrders`: selama tidak ada VALIDATED ORDER (WAIT & SEE, NO TRADE, countertrend, atau TRADE tanpa order searah bias) judul menjadi "4B. KANDIDAT ORDER — BELUM BOLEH DIPASANG"; "Order Baru yang Disarankan" hanya bila ada VALIDATED ORDER. Banner WAIT kini "Jangan memasang pending order apa pun selama keputusan server belum berubah…" (kalimat lama "boleh dipasang setelah … setup aktif" dihapus). Banner TRADE menegaskan VALIDATED ORDER ≠ ACTIVE SETUP (server tidak membaca candle/harga aktual).
- Blok risiko berjudul "Catatan batas risiko (per arah …)" (tanpa bold) juga dibangun ulang dari order final (sebelumnya hanya baris total yang diganti).
- Tes: 224/224 lulus (31 tes baru `tests/invalidation-spread.test.mjs`: unit tiap temuan, integrasi Gemini → finalSync → validator risiko → invalidation/spread → status order → laporan, BUY & SELL, XAUUSD & EURUSD, spread normal/tinggi/tidak tersedia, WAIT & TRADE, idempotensi, tabel Entry/SL/TP/R:R/lot/risiko identik dengan jalur tanpa validator baru).
- Tidak diubah: mesin SMC, BOS/CHoCH, deteksi OB/FVG, koordinat zona, Entry/SL/TP, aturan R:R, kalkulasi risiko, auto-trading. Belum diuji live. Batasan: klausa Skenario Batal tanpa angka harga (mis. "CHoCH bullish M15 tertutup") dibiarkan; baris yang menyebut dua zona sekaligus tidak ditulis ulang.
