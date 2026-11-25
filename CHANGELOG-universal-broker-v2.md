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

## Hotfix #8.1 — parser invalidation tidak mengenali kalimat tanpa titik dua (laporan live 24 Nov 2026 15:05 WIB)
- Akar masalah: `syncInvalidation` hanya memproses baris berformat "Sell Zona 2: …" (titik dua wajib). Gemini menulis "Sell Zona 2 batal jika H1 close di atas 3662.61, …"; baris itu dilewati sehingga SL (3662.61 / 3606.82) tetap tampil sebagai invalidation. Tes Audit #8 memakai format bertitik dua sehingga tidak menangkapnya.
- Perbaikan: pengenalan baris tidak lagi bergantung pada titik dua. Dikenali: "Buy Zona 1: …", "Buy Zona 1 batal jika …", "SELL Z2 invalid jika …", "Sell Limit Zona 2 batal apabila …", bold, bullet "-"/"*", pemisah ":" "-" "–". Sisi dan nomor zona tetap diambil dari rujukan zona (satu rujukan per baris; baris multi-zona tidak ditulis ulang); label hasil dinormalisasi ("Sell Zona 2: SL … = batas risiko posisi …").
- Hasil pada kasus live: Sell Zona 2 — 3662.61 = SL dibuang; 3646.46 adalah tepi atas zona entry (bukan di luar zona) dibuang → "Invalidation struktural belum terdefinisi — perlu evaluasi manual". Buy Zona 1 — 3606.82 = SL dibuang; server tidak memilihkan level pengganti (walau 3600.40 ada di mesin) → "belum terdefinisi". Baris WAIT / NO TRADE dan "Hapus pending …" tidak berubah.
- Tes: 232/232 lulus (8 tes hotfix baru; 5 di antaranya gagal pada parser lama): variasi format tanpa titik dua, integrasi dua kalimat live persis, BUY & SELL, level struktur valid tetap dipertahankan, Entry/SL/TP/lot/risiko/koordinat zona identik sebelum-sesudah, idempotensi, WAIT / NO TRADE tidak rusak.
- Tidak diubah: mesin SMC, BOS/CHoCH, OB/FVG, koordinat zona, aturan R:R, kalkulasi risiko. Belum diuji live.

## Audit #9 — total risiko 3 kategori, invalidation lintas zona, overlap OB/FVG (audit live pasca c5ea4e8)
Catatan jujur: laporan mentah audit ini tidak ikut terlampir (hanya ringkasan audit). Fixture tes direkonstruksi dari angka audit (BUY Z1 $5.33, BUY Z3 $16.45, SELL Z2 $19.89, kandidat awal SELL Z3 $17.69 / BUY Z2 $26.20, total lama $37.58 / $47.98). Letak persis kalimat lama di laporan asli diasumsikan di bagian Rincian Hitung Risiko; perbaikannya juga menyapu bagian lain.
- **P0 total risiko.** Akar masalah: sapuan baris total lepas di `finalizeOrders` melewati seluruh isi "Rincian Hitung Risiko" (`inDetail → continue`), sedangkan penulisan ulang di `riskCheck` hanya menangkap baris berawalan "Total BUY/SELL" (bukan "Total risiko SELL …", "Kombinasi …", "… yang lolos validator"). Perbaikan: di dalam Rincian hanya baris hitung per order dan baris "tidak ada order" yang dibiarkan; baris total/kombinasi lama diganti satu baris total final. Blok risiko kini tiga kategori terpisah: (1) kandidat awal sebelum validator (risiko per order, BUKAN total, dari `riskCheck.candidates`), (2) dibatalkan validator + alasan, (3) lolos validator (total akhir per arah, semuanya CANDIDATE saat WAIT & SEE). Blok disisipkan setelah Rincian bila Gemini tidak menulisnya. Alasan penolakan juga dibaca dari "Tidak Dipasang (…)" buatan model.
- **P0 invalidation lintas zona.** Akar masalah: baris dengan dua rujukan zona dilewati (`refs.length !== 1`) dan `syncNarrative` tidak memetakan angka ke satu zona. Perbaikan: kalimat lintas zona dipecah per zona (satu baris = satu sisi + satu nomor zona); zona batal → "WAIT / NO TRADE — … tidak ada order", zona aktif dinilai sendiri (SL tidak pernah jadi invalidation, tanpa level struktur valid → "Invalidation struktural belum terdefinisi — perlu evaluasi manual"). Kalimat umum tanpa sisi/zona ("Semua order batal bila struktur H1 berubah arah") dihapus; "Hapus pending jika TP1 tersentuh …" dipertahankan.
- **P1 overlap OB/FVG.** Baru `lib/overlap.js`: irisan aktual zona entry Bagian 3 dengan OB/FVG fresh searah per TF (W1/MN tidak dihitung). Penyebab label menyesatkan: "Dasar" dari guard menghitung dasar yang hanya menyentuh zona (toleransi 0.1×ATR). Kini dasar yang hanya sebagian kecil zona diberi keterangan ("H4 FVG (hanya 10% zona: 3542.22–3543.56)"), zona multi-dasar dengan irisan bersama < 50% diberi tanda "🧩 KONFLUENSI PARSIAL", dan catatan memuat irisan penuh antar dasar. BUY Zona 3 (3529.96–3543.56): H1 FVG mencakup seluruh zona; H4 FVG hanya 10%. Catatan: irisan penuh H1∩H4 tanpa batas zona yang dihitung server = 3542.22–3568.22 (karena ada dua H1 FVG fresh: 3529.96–3557.16 dan 3538.39–3568.22), bukan 3542.22–3557.16. Koordinat zona tidak diubah. Belum: pengelompokan zona yang berasal dari struktur sama sebagai satu eksposur.
- Tes: 249/249 lulus (17 baru; 8 di antaranya gagal pada kode lama). Tidak diubah: mesin SMC, BOS/CHoCH, algoritma OB/FVG, koordinat zona, aturan R:R, kalkulasi risiko. Belum diuji live.

## UI #10 — Navigasi cepat hasil analisa
- `components/SectionNav.js`: tombol melayang (⇈ paling atas, ↑ bagian sebelumnya, ↓ bagian berikutnya, ⇊ paling bawah) muncul setelah scroll >400px; tab bagian ikut menyala sesuai bagian yang sedang dibaca (scroll-spy). Hanya UI; logika analisa tidak disentuh. Disembunyikan saat cetak/PDF.
- Belum diuji di perangkat nyata (tidak ada build lokal); verifikasi lewat build Vercel + cek manual user.

## Audit #10 — Bias final server, jejak audit, transparansi risiko (BELUM DEPLOY, menunggu persetujuan)
Akar masalah (audit PC 16.13 vs HP 16.14, snapshot sama): (1) saldo & Zona 1 berbeda antar perangkat (localStorage); (2) risiko Buy Z2 $26.13–26.14 di lot minimum tepat di ambang batas $26 vs $28; (3) `resolveBias` lama tidak menimpa header bila teks model memuat BEARISH dan BULLISH sekaligus, sehingga header mengikuti kata-kata model, sementara keputusan server memakai struktur H4.
- `lib/biasFinal.js` (baru): `decideBias` — satu keputusan bias: Model Gemini / Struktur H4 mesin / Final server; konflik + alasan; header ditulis ulang hanya saat override dan teks asli model tetap ditampilkan; model NETRAL tidak lagi ditimpa (aturan lama bisa menimpa "NETRAL … (BEARISH …)" jadi BULLISH-FOKUS BUY). Panel 🧭 di Markdown + 3 kartu di UI.
- `lib/auditTrail.js`, `lib/configDiff.js` (baru): audit per analisa = hash konfigurasi, saldo/risiko, status Zona 1/2/3, mode zona, digit, model, deployment (VERCEL_GIT_COMMIT_SHA), versi mesin, harga/sumber, snapshot per TF (id, received_at, hash isi candle). Disimpan ke kolom `audit_meta` (migrasi `supabase/migration-v4-audit-trail.sql`, aditif; riwayat lama tetap NULL). Peringatan UI bila konfigurasi analisa ≠ pengaturan perangkat (tanpa sinkronisasi).
- `lib/riskTransparency.js` (baru): blok "TRANSPARANSI RISIKO" (risiko lot minimum, batas, kelebihan, NO TRADE, alasan, dampak ke keputusan). `lib/riskCheck.js`: hanya menambah pencatatan (`candidates[].drop`, `maxRiskUsd`); hitungan tidak berubah (uji diferensial 1.768 kasus lama vs baru: 0 beda).
- `app/api/analyze/route.js`: bias dihitung sekali (`biasInfo`) dari teks asli model + struktur mesin dan dipakai header, label arah, keputusan server, status 4B; respons membawa `audit`. `app/api/history/route.js`: simpan `audit_meta` (fallback aman bila kolom belum ada). `lib/mt4Market.js`: ikut membaca kolom `id` snapshot.
- Tidak diubah: SMC engine, BOS/CHoCH, OB/FVG, koordinat zona, Entry/SL/TP, lot, rumus risiko, R:R, auto-trading (tidak ada).
- Tes: 269/269 (249 lama + 20 baru). Belum diuji live; build production Vercel baru bisa diverifikasi setelah deploy.

### Hotfix #10.1 — HTTP 400 "Tidak dapat membaca OHLC"
Penyebab: Audit #10 menambah kolom `id` ke select tabel `mt4_market_snapshots`, padahal tabel itu tidak punya kolom `id` (hanya `trading_analyses`). Akibatnya PostgREST 400 dan semua analisa tanpa/dengan OHLC gagal. Perbaikan: `id` dihapus dari select; identitas snapshot di audit = kunci upsert `koneksi|simbol|TF`. Tes regresi: select snapshot tidak boleh memuat `id`. 271/271.

### Hotfix #10.2 — Peringatan konfigurasi "Mode" salah (false positive)
Analisa live 16.53: mesin gateway selalu memaksa alur 2 tahap, sedangkan pilihan UI "mode" tetap `single`, sehingga kotak peringatan menuduh "analisa 2tahap · perangkat ini single". Perbaikan: `configDiff` mengabaikan Mode bila mesin = gateway; audit baru menyimpan `mode` (pilihan UI) dan `modeEffective` (dijalankan server). Beda saldo/Zona 1 tetap terdeteksi. 272/272.

### Hotfix #10.3 — label 4B ikut bias final; hash konfigurasi tanpa digit
- Analisa live 17.07/17.08 (final BULLISH): nama order di Tabel 4B masih membawa label tulisan model yang melawan bias final (Sell Z2 "Searah Bias - PRIORITAS", Buy Z3 "Counter-Trend"). `syncOrderLabels` (lib/biasFinal.js) menyamakan label 4B dengan bias final; hanya teks label, kolom lain identik (diuji).
- Digit tombol salin (tampilan) tidak lagi masuk hash konfigurasi dan tidak memicu peringatan.
- TEMUAN BELUM DIPERBAIKI: snapshot (#666b46fb088f) + konfigurasi identik menghasilkan keputusan berbeda (17.07 TRADE vs 17.08 COUNTERTREND_ONLY) karena TP1 Buy Z3 dan pengisian zona ditulis model (R:R 1:3.90 vs 1:1.94 < standar 1:2). Perlu keputusan desain; lihat laporan. 274/274.

## Audit #11 — Mesin order deterministik: angka ditentukan server, Gemini hanya menjelaskan (BELUM DEPLOY ke produksi, menunggu persetujuan)
Akar masalah (temuan #10.3): snapshot + konfigurasi identik bisa menghasilkan keputusan berbeda karena TP1 dan zona yang terisi ditulis model; `syncTargets` mempertahankan TP1 model yang "masuk akal" dan `enforceSmcZones` tidak pernah membuat baris yang model kosongkan.
- `lib/engineOrders.js` (baru, tanpa import): `structureLevels`, `selectTargets`, `buildEngineOrders`, `lockToEngine`, `clearDeadDetail`, `engineSkeleton`, `engineOrdersPrompt`, `finalTableSignature`.
  - TP1 = level struktur terdekat searah profit (swing support/resistance + tepi zona fresh lawan, M15–MN) yang berada di sisi benar dari entry, R:R ≥ 1:2.0 (Zona 3 mode 3 zona) / ≥ 1:1.5 (lainnya) dan ≤ batas jarak zona (2.5R/3R/5R). Seri jarak: TF lebih tinggi, lalu harga lebih kecil. TP2 = level berikutnya (≥2R, ≤ batas, > TP1+0.5R); tidak ada → kosong. TANPA fallback kelipatan R. TP1 tidak valid → zona NO TRADE/evaluasi manual.
  - Zona terisi = kandidat zona mesin (`zoneRes`, koordinat tidak diubah) yang lolos validator; urutan evaluasi tetap BUY Z1–Z3 lalu SELL Z1–Z3. Entry limit = tepi zona terdekat harga (konvensi lama: BUY entryHi, SELL entryLo); jarak/R:R/risiko dihitung dari entry yang sama.
  - Lot awal = porsi risiko (2 zona 40/60; 3 zona 20/35/45, dinormalkan di antara zona yang lolos) / (jarak × pengali), dibulatkan ke bawah; batas per order/per arah tetap dikerjakan `verifyRiskTables` (tidak diubah).
  - `lockToEngine` menimpa Entry/SL/TP1/TP2/Jarak/Lot/R:R di Bagian 3 dan 4B (urutan baris kanonik); yang dipertahankan dari model: nama baris, kolom konfirmasi, baris "Sudah Terpasang (Lihat 4A)", Waktu Berakhir bila valid.
- `app/api/analyze/route.js`: `computeEngine`; blok "ORDER MESIN (FINAL)" ditambahkan ke prompt; `runChecks` mengunci tabel sebelum `enforceSmcZones`; `syncTargets` tidak dijalankan bila mesin aktif; Gemini gagal / format tak terbaca / respons kosong → kerangka mesin + "NARASI AI TIDAK TERSEDIA — TABEL MESIN TETAP DITAMPILKAN" (tanpa narasi karangan, bukan konfirmasi setup aktif); audit menyimpan tanda tangan order mesin.
- `lib/auditTrail.js`: `ENGINE_VERSION` → `...orders1`; audit memuat `orders {sig, finalSig, overrides, aiAvailable}`.
- Tidak diubah (hash sama dengan fae6d5b): `lib/smc/engine.js` (BOS/CHoCH, OB/FVG, kandidat zona), `lib/riskCheck.js` (rumus risiko), `lib/smc/guard.js`, `lib/decision.js`, `lib/finalSync.js`. Tidak ada auto-trading.
- Dampak yang disengaja: setup yang dulu lolos berkat TP model/fallback kelipatan R kini bisa jadi NO TRADE.
- Batasan: jalur 4A (order user dari screenshot, `applyOrderGuard`) masih memakai teks bias model; baris "Sudah Terpasang" berasal dari bacaan screenshot Gemini. Determinisme berlaku untuk snapshot+konfigurasi identik; candle baru tentu mengubah hasil.
- Tes: 299/299 (274 lama + 25 baru: TP1 sisi benar/R:R standar/batas jarak, tanpa TP valid, 50× variasi teks Gemini → tabel final identik, klaim keputusan Gemini tak berpengaruh, kerangka saat Gemini gagal, wiring route). Belum diuji live; tidak ada `next build` lokal.

### Audit #11.1 — Audit fallback lot minimum (`lotFor`)
- `makeLotFor` dipindah ke `lib/engineOrders.js` agar bisa diuji. Anggaran < lot minimum → mengembalikan lot minimum HANYA supaya `verifyRiskTables` (tidak diubah) menolak order bila risiko pada lot minimum > batas. Fungsi itu tidak meloloskan order.
- 6 tes baru (305/305): lot 0.007→NO TRADE, 0.01 dalam batas→lolos, 0.02 step 0.01→0.02, total risiko per arah benar setelah pembatalan, tidak ada lot di luar min/step/maks di 4B (4 spesifikasi × 7 anggaran), risiko per arah ≤ batas.

## Audit #12 — Tahap 1: Alignment multi-timeframe (branch `feat/alignment-step1`, BELUM merge/deploy)
- Temuan: label "Alignment H4/H1 ke M15: SELARAS" hanya membandingkan M15 dengan H4 (fallback H1); H1 tidak ikut. Kasus 24 Nov (H4 BULLISH, H1 BEARISH, M15 BULLISH) salah ditampilkan SELARAS.
- `lib/smc/alignment.js` (baru): `alignmentOf` → SELARAS (H4, H1, M15 valid & sama) | CAMPURAN (ada yang berbeda, termasuk bila data tersedia sudah saling bertentangan) | TIDAK DAPAT DINILAI (data tidak cukup). M5/D1/W1 tidak ikut definisi.
- `lib/smc/engine.js`: hanya label alignment (import + 4 baris) — hasil `analyses` (BOS/CHoCH/OB/FVG/swing/zona/ATR) identik lama vs baru (dibuktikan). `alignment` boolean|null tetap ada untuk kompatibilitas; ditambah `alignmentInfo`.
- `lib/decision.js` + `route.js`: CAMPURAN menambah peringatan "Alignment CAMPURAN (H4 …, H1 …, M15 …): timeframe belum searah; tunggu konfirmasi sebelum entry." Status keputusan TIDAK berubah (hanya peringatan); jalur lama (`alignment:false` tanpa pesan) tetap.
- Tidak diubah: deteksi BOS/CHoCH, OB/FVG, koordinat zona, rumus risiko, standar R:R, aturan TP. Tidak ada auto-trading.
- Tes: 315/315 (305 lama + 10 baru).

## Audit #12 — Tahap 2: label zona dari konfigurasi (branch `audit12-tahap2`, BELUM merge/deploy)
- Temuan: nama/peran zona di Bagian 3 dan 4B ditulis model dan tersebar di tiga tempat (`prompt.js`, `STYLE` di `engineOrders.js`, regex `kindOf` di `consistency.js`). Di riwayat (216 baris nama yang punya config tersimpan) 32 baris di 4 analisis mode 3 zona memakai nama mode 2 zona (Zona 1 "Intraday", Zona 2 "Swing").
- `lib/zoneLabels.js` (baru, tanpa import): sumber resmi `zoneStyle/zoneRole/zoneRowName/canonicalizeName/kindFromName/auditZoneLabels`. Mode 2 zona: Z1 Intraday, Z2 Swing. Mode 3 zona: Z1 Scalping, Z2 Intraday, Z3 Swing. Zona 1 OFF: label `Dimatikan` + 🚫 (baris tetap tampil, tanpa order, status tidak berubah).
- `lib/engineOrders.js`: `STYLE` dihapus → memakai `zoneLabels`; `lockToEngine` mengunci nama baris Bagian 3 dan 4B ke label resmi (deskripsi dasar level dari model dipertahankan; "Swing High/Low" bukan gaya zona), mengembalikan `labelFixes`, menambah catatan bila ada nama yang dikoreksi. Hitungan `overrides` (penimpaan angka) tidak terpengaruh label.
- `lib/consistency.js`: `kindOf` = `kindFromName` dari sumber yang sama (perilaku identik; penyamaan Waktu Berakhir tidak berubah).
- `app/api/analyze/route.js` + `lib/auditTrail.js`: `audit_meta.labels {v, zones, zone1Off, locked, fixed[], modelMismatch[], residual[]}` (narasi model yang bentrok hanya DICATAT, tidak ditulis ulang). ENGINE_VERSION → `smc-validators/2026-11-24.labels1`.
- Tidak diubah (hash sama dengan sebelum Tahap 2): `riskCheck.js`, `smc/guard.js`, `finalSync.js`, `smc/engine.js`, `decision.js`, `smc/alignment.js`. Waktu berakhir, jarak zona, masa berlaku, rumus risiko, TP/SL/lot, keputusan: tidak berubah.
- Efek samping yang disengaja: konsumen nama baris (`riskCheck` aturan Daily Close untuk baris "Swing", `decision` peringatan "Scalping") kini menerima nama yang benar; baris yang dulu salah nama diperlakukan sesuai perannya yang sebenarnya.
- Tes: 347/347 (315 lama + 32 baru: seluruh kombinasi mode × Zona 1 ON/OFF, koreksi nama salah, angka identik nama salah vs benar, Waktu Berakhir, PDF, audit, kabel route).
- Perbaikan temuan audit Tahap 2 (jam Ringkasan Cepat mode 2 zona): `syncExpiry(markdown, now, pair, {zones, zonesOff})` memetakan segmen "Masa Berlaku Sinyal" lewat NOMOR zona menurut mode (`zoneStyle`): 2 zona Z1 Intraday/Z2 Swing; 3 zona Z1 Scalping/Z2 Intraday/Z3 Swing; tanpa nomor zona memakai kata gaya; zona yang dimatikan tidak disentuh dan tidak ikut menentukan expiry Scalping. Sebelumnya di mode 2 jam Ringkasan "Zona 2 (Swing)" mengikuti jam Intraday dan "Zona 1" tidak diselaraskan. Bawaan `zones=3` = perilaku lama (pemanggil lain/tes lama tak berubah); route meneruskan `{zones, zonesOff}`. Durasi, jendela, dan aturan expiry TIDAK diubah; tabel 4B identik dengan pemanggilan lama (diuji).
- Tes: 357/357 (347 + 10 di `tests/summary-expiry.test.mjs`: jam Ringkasan = jam 4B untuk mode 2, mode 3, mode 3 + Zona 1 OFF; bukti bug lama; nomor zona resmi menang atas gaya salah tulis; 4B identik; kabel route).

## Audit #13 — konsistensi output laporan 24 Nov (branch `audit13-output-consistency`, BELUM merge/deploy)
Sumber: laporan XAUUSD 24 Nov 22:01 (deploy b01fc28). Hanya TEKS yang diperbaiki; Entry/SL/TP/lot/R/risiko/zona SMC/keputusan mesin tidak diubah.
- Temuan 1 (total risiko): baris "Total risiko arah SELL = $18.62 … Total arah BUY = $16.56" lolos karena regex `finalizeOrders` tidak mengenali kata "arah". `lib/finalSync.js`: pola total sekarang `total (risiko)? (arah)? (buy|sell)`; baris diganti total dari order lolos validator (BUY $0.00 | SELL $20.90), sama dengan catatan verifikasi.
- Temuan 2 (Searah Bias/Counter-Trend): catatan "Verifikasi risiko otomatis" menyalin nama baris dengan label tulisan model (terbalik saat model salah bias). `lib/biasFinal.js` `syncOrderLabels`: baris catatan `> - [emoji] Buy/Sell Limit Zona N (...) (label): …` ikut bias final (satu fungsi: sisi × bias final), selain tabel 4B.
- Temuan 3 (Ringkasan Cepat): `lib/summaryPlan.js` (baru): bila keputusan ≠ TRADE dan kalimat Rencana model berisi klausa tanpa penyangkalan yang menyuruh siapkan/pasang/entry, baris Rencana diganti kalimat server per status (HANYA COUNTERTREND / WAIT / NO TRADE; kandidat disebut berstatus CANDIDATE; jam No-Trade Zone dipertahankan HANYA bila model menyebutnya). Rencana yang sudah aman tidak diubah; saat TRADE tidak disentuh. Ini langkah pengaman minimal; Ringkasan penuh bernarasi tetap Tahap 4.
- Temuan 4 (struktur basi): `lib/staleStructure.js` (baru): rentang harga yang cocok dengan OB/FVG berstatus INVALIDATED/MITIGATED di data SMC (dan tidak ada zona FRESH yang sama) diberi penanda `[⚠️ H1 OB INVALIDATED — bukan zona fresh/konfluensi aktif]`; teks tidak dihapus; blok kode & jejak audit dilewati.
- `route.js`: memanggil dua langkah itu sesudah `syncOrderLabels`; catatan masuk Catatan sistem.
- Tes: 377/377 (357 + 20 di `tests/output-consistency.test.mjs`, memakai fixture laporan nyata `tests/fixtures/report-xauusd-24nov.md`); 9 tes baru gagal bila `finalSync.js`/`biasFinal.js` dikembalikan ke versi main (kontrol negatif).
- Belum ditangani (di luar 4 temuan; tercatat): Ringkasan "Level kunci" masih menyebut 3643.50 sebagai invalidasi padahal Skenario Batal menyatakan bukan level struktur; "Masa Berlaku Sinyal … Zona 2 … Daily Close" salah menyebut Daily Close untuk zona Intraday; teks Rencana tidak mengambil jendela No-Trade Zone dari kalender server.

### Audit #13 — revisi redaksi sebelum merge (audit reviewer)
- Kalimat total risiko di catatan verifikasi: "Total risiko per arah (dihitung ulang dari order aktif)" → "Total risiko per arah (order yang lolos validator, termasuk kandidat yang belum boleh dipasang)". Hanya teks; angka, order, dan keputusan tidak berubah.
- Tes yang mengunci kalimat lama (risk-notes, invalidation-spread) disesuaikan ke kalimat baru. Total: 377/377.
- Tetap di daftar berikutnya: level invalidation 3643.50 pada Ringkasan; jam No-Trade Zone di Rencana masih dari teks model.

### Audit #13 — perbaikan kecil: baris total risiko ganda (temuan live 22:32 WIB)
- Gejala: `- Total BUY: Total risiko per arah (...)` di catatan verifikasi (analisis `9e56242`, Zona 1 OFF).
- Penyebab: `PREFIX` di `finalSync.js` menelan "Total BUY:" / "**Total BUY:**" sebagai label, lalu kalimat pengganti ditempel setelahnya. Sudah ada sebelum Audit #13 (terbukti di `b01fc28` untuk format riskCheck dan tebal); Audit #13 hanya memperluas pola yang dikenali.
- Perbaikan: bila label yang ditelan mengandung kata "total", awalan diganti awalan bullet saja. Satu pernyataan di `lib/finalSync.js`.
- Tidak berubah: angka, kalkulasi risiko, order, keputusan, bias, validator, SMC.
- Tes: +6 (5 format baris total + idempotensi). Total 383/383. Tanpa perbaikan, 3 tes baru gagal.
- Di luar pekerjaan ini: Rencana vs TRADE (masuk Tahap 4); label pada baris tanpa setup (dicatat, evaluasi lanjutan).

## Audit #13 — perbaikan penanda struktur basi: identitas zona ketat (branch `audit13-fix3-stale-identity`, dari `main`, BELUM merge/deploy)
Sumber: laporan USDJPY 25 Nov 09:29 WIB (deploy 9e56242, NO TRADE). Hanya TEKS penanda yang diperbaiki; Entry/SL/TP/lot/R/risiko/zona SMC/keputusan server tidak diubah.
- Temuan: M15 FVG fresh 159.457–159.486 diberi `[⚠️ H4 FVG MITIGATED …]` (2 baris). Sebab terbukti dari data laporan: daftar `fvgs` di hasil SMC hanya 8 entri terakhir (semua MITIGATED, FVG fresh tidak termuat), sehingga pengecekan "ada zona fresh yang cocok" gagal; lalu toleransi mutlak 0.05 (5 pip di USDJPY) membuat H4 FVG BULLISH 159.465–159.472 (selisih ujung 0.008 dan 0.014) dianggap zona yang sama.
- `lib/staleStructure.js`: (1) zona fresh diambil juga dari `zones` (daftar lengkap kandidat fresh mesin; tanpa mengubah engine) dan dari entri berstatus selain INVALIDATED/MITIGATED; (2) identitas zona = timeframe + jenis (OB/FVG) + arah + kedua batas; (3) toleransi 0.05 dihapus: opsi `tick` hanya menormalkan presisi angka (setengah tick; tanpa tick hanya 1e-9), jadi beda satu tick atau zona berdekatan = zona berbeda; (4) petunjuk konteks sempit (TF/jenis/arah yang disebut tepat sebelum rentang atau di kurung sesudahnya) hanya menyisihkan kandidat yang jelas bertentangan, tidak pernah menambah kecocokan; (5) rentang yang identitas fresh-nya ditemukan tidak pernah ditandai; bila koordinat sama persis di TF berbeda dan teks tidak membedakan, yang fresh menang (konservatif); (6) penanda lama dibuang dari jendela konteks sehingga idempoten.
- `app/api/analyze/route.js`: satu argumen, `{ tick: 10^-pairCfg.dec }` (0 bila dec tidak valid).
- Tidak diubah (hash sama dengan main): engine SMC, `decision.js`, `riskCheck.js`, `smc/guard.js`, `alignment.js`, `pairs.js`, `brokerSpec.js`, `zoneLabels.js`, `engineOrders.js`, `consistency.js`, `summaryPlan.js`, `finalSync.js`, `biasFinal.js`.
- Batasan yang diketahui: zona basi lebih lama dari 8 FVG terakhir tidak ada di data tampilan sehingga tidak ditandai (tidak ada penanda salah, hanya penanda yang terlewat). Bukan bagian perbaikan ini.
- Tes: 403/403 (377 + 26 di `tests/stale-identity.test.mjs`). Kontrol negatif: dengan kode lama 15 dari 26 tes baru gagal. Laporan USDJPY nyata (parser dari lampiran laporan): 0 penanda (sebelumnya 2), idempoten.

### Audit #13 — perbaikan A/B/C dari bukti live 24-25 Nov (branch audit13-fix2-total-label, di atas 6ac8205)
- A. Total basi lolos di Rincian Hitung Risiko bila baris ikut memuat "tidak ada order" / "WAIT / NO TRADE" (pengecualian baris Rincian). Pengecualian itu kini tidak berlaku untuk baris total. Bukti: XAUUSD 23:21 ($34.53 vs $23.62).
- B. Label arah-vs-bias di 4B tidak dikenali bila digabung gaya zona dalam satu kurung ("(Swing - Counter-Trend)"). `ORDER_LABEL_RE` kini menerima awalan gaya zona dan mempertahankannya. Bukti: XAUUSD 23:21 (Buy Counter / Sell Searah padahal BULLISH). Bagian 3 (`syncBiasLabels` di consistency.js) tidak diubah.
- C. Total "satu arah": `TOTAL_LINE_RE` menerima "Total risiko satu arah (SELL)"; label tebal yang ditelan PREFIX juga diperiksa. Bukti: USDCAD 23:29 ($34.93 vs $0).
- Tidak berubah: angka, risiko, lot, Entry/SL/TP/R:R, keputusan, bias, validator, SMC. decision.js tidak disentuh.
- Tes: +13 (396/396). Tanpa perbaikan, 9 tes baru gagal.

## Audit #13 — Tahap 3 / 3b / 3c: klasifikasi overlap, daftar FVG lengkap, tick size (branch `audit13-tahap3-overlap`, commit akhir `8e7bd01`, BELUM merge/deploy)
Hanya anotasi TEKS pada kolom "Dasar:" Bagian 3; Entry/SL/TP/lot/risiko/R:R/keputusan/SMC tidak diubah.
- Tahap 3 (`lib/overlap.js`): dasar tanpa irisan dibedakan menyentuh tepi vs terpisah jarak positif vs tanpa data fresh (sebelumnya selalu "menyentuh tepi", termasuk jarak 55 tick USDCAD); `freshByLabel` memakai `zones` (daftar fresh penuh) selain `orderBlocks`/`fvgs` (dipotong 8 terakhir).
- Tahap 3b: jumlah tick dan toleransi setengah tick memakai `brokerSpec.ticksize` yang valid (diteruskan `route.js`: satu argumen `spec`). `10^-dec` adalah presisi harga, bukan tick size.
- Tahap 3c: tanpa ticksize valid, "menyentuh tepi" hanya bila batas berimpit numerik (noise floating-point 1e-9); gap positif = "terpisah <jarak absolut> dari zona, tanpa irisan; tick size broker belum tersedia, jumlah tick tidak dihitung". Jarak absolut tidak pernah dibulatkan ke 0.
- Tes: 514 di branch aslinya (396 + 118 baru).

## Audit #13 — cabang integrasi sementara `integrasi-audit13-sementara` (BUKAN untuk merge sebelum persetujuan)
Basis `9e56242`; S1 `audit13-fix-total-line` (6ac8205), S2 `audit13-fix3-stale-identity` (82fbad0), S3 `audit13-tahap3-overlap` (8e7bd01, sudah memuat 6ac8205 dan 1f833e7). Konflik hanya CHANGELOG (kedua bagian disimpan). Ditambah `tests/integration-audit13.test.mjs` (5 tes lintas perbaikan). Fix4 (`598f317`) tidak termasuk; tersedia di `integrasi-audit13-sementara-plus-fix4`.

## Audit #13 — Fix4: label arah di Rincian Hitung Risiko + total risiko tebal tanpa bullet (branch `audit13-fix4-rincian-labels`, dari `1f833e7`, BELUM merge/deploy)
Lanjutan A/B/C. Hanya TEKS; rumus risiko, lot, SL, TP, validator, keputusan, bias, SMC tidak diubah. Sumber temuan: audit matriks 25 Nov (D1/D2/D5b) dan analisis XAUUSD 25 Nov 11:09 WIB (SELL berlabel "Searah Bias" di Rincian saat bias final BULLISH).
- Akar masalah 1: baris Rincian ("- Sell Limit Zona 2 (Searah Bias): …") dibentuk `finalizeOrders` dari nama tulisan model; `syncOrderLabels` hanya menyentuh baris tabel 4B dan catatan `> -`, jadi label model yang terbalik bertahan.
- Perbaikan 1 (`lib/biasFinal.js`): `syncOrderLabels` menambah satu putaran khusus bagian "Rincian Hitung Risiko" (baris bullet "Buy/Sell Limit Zona N (…): …", termasuk "tidak ada order (…)"); label ikut bias final memakai `relabel()` yang sama (gaya zona dalam kurung gabungan dipertahankan). Baris di luar bagian Rincian dan baris tanpa label tidak disentuh.
- Akar masalah 2: baris total tebal tanpa bullet ("**Total risiko satu arah (SELL):** $x") dianggap judul bagian oleh pemindai `finalizeOrders` (`/^\s*\*\*\S/` tanpa bullet) sehingga dilewati dan angka lama model bertahan.
- Perbaikan 2 (`lib/finalSync.js`, satu kondisi): baris tebal yang cocok `TOTAL_LINE_RE` dan memuat angka `$` tidak lagi diperlakukan sebagai judul bagian.
- `syncBiasLabels` (Bagian 3) kurung gabungan: HANYA ditambahkan skenario tes (todo): perilaku sekarang meninggalkan label lama dan menambah label baru ("(Intraday - Searah Bias) (Counter-Trend - …)"). Tidak diperbaiki di cabang ini.
- Tes: 413 total (396 lama semuanya lulus + 17 baru di `tests/rincian-labels.test.mjs`: 16 lulus, 1 todo). Kontrol negatif: pada kode 1f833e7, 9 dari 16 tes baru yang diharapkan lulus gagal. `tests/helpers/report-doc.mjs` = salinan pembangun laporan sintetis dari output-consistency.
- Tidak diubah (hash sama dengan main): decision, riskCheck, smc/*, engineOrders, zoneLabels, consistency, summaryPlan, staleStructure, overlap, pairs, brokerSpec, route.js.
