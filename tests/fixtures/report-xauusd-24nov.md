> **Catatan sistem**
> - 💱 Harga acuan zona: Bid 3618.85 / Ask 3619.21 (spread 0.36), kuotasi EA 22:00:28 WIB. Struktur SMC dari candle tertutup (close M5 3622.17).
> - 📡 OHLC ONLY (tanpa screenshot) aktif: OHLC MT4 EA diterima dan lolos pemeriksaan. SMC dihitung deterministik dari candle tertutup; bukan probabilitas profit.
> - 🧭 Gaya zona: 3 zona (Scalping/Intraday/Swing).
> - 🔌 Data dari Jarocel (Pty) Ltd / Headway-Real (simbol XAUUSD).
> - ✅ Lot/risiko dihitung dari spesifikasi broker (tickValue 1 / tickSize 0.01, akun USD; lot 0.01–1000 step 0.01).
> - 🔢 2 angka berformat Indonesia (56.964,10) diubah ke format standar sebelum validasi (model cadangan mengabaikan format).
> - 🧪 Tanpa screenshot: model `mimo-v2.5-pro` menulis analisa langsung dari OHLC MT4 (38 dtk). Validator & keputusan server tetap berlaku.
> - 📏 Pedoman jarak zona dari 3618.85 (ATR H1 17.77 / H4 46.47, sumber: dihitung dari candle OHLC provider): Zona 1 Scalping $3.26 (33 pips) - $13.04 (130 pips), Zona 2 Intraday $10.66 (107 pips) - $44.42 (444 pips), Zona 3 Swing $46.47 (465 pips) - $139.40 (1394 pips). Struktur tetap lebih penting daripada jarak.
> - 🏷️ 8 nama zona di tabel disamakan dengan label resmi mode 3 zona (BUY Zona 1: Intraday→Scalping; BUY Zona 2: Swing→Intraday; SELL Zona 1: Intraday→Scalping; SELL Zona 2: Swing→Intraday; …).
> - 🔒 Angka order (Entry/SL/TP/lot/zona terisi) ditetapkan mesin server; 11 baris tabel menyimpang dari tulisan model dan ditimpa.
> - 🎯 BUY Zona 3: tidak ada target struktural valid (tidak ada level struktur dengan R:R >= 1:2.0 dalam batas 5R) → NO TRADE untuk zona ini (evaluasi manual; server tidak membuat TP pengganti).
> - 🎯 SELL Zona 1: tidak ada target struktural valid (tidak ada level struktur dengan R:R >= 1:1.5 dalam batas 2.5R) → NO TRADE untuk zona ini (evaluasi manual; server tidak membuat TP pengganti).
> - 🎯 SELL Zona 3: tidak ada target struktural valid (tidak ada level struktur dengan R:R >= 1:2.0 dalam batas 5R) → NO TRADE untuk zona ini (evaluasi manual; server tidak membuat TP pengganti).
> - 🧭 KONFLIK BIAS: model menulis BEARISH, struktur H4 mesin BULLISH; bias final server = BULLISH (rincian di panel Bias).
> - 🧭 4 label Searah Bias / Counter-Trend di Bagian 3 disamakan dengan bias BULLISH dari mesin SMC.
> - 🧭 6 nama Level Kunci Bagian 2 diganti deskripsi dari mesin SMC (BOS/CHoCH/OB/FVG/swing).
> - 🔁 SELL Zona 2: teks R:R Bagian 3 disamakan dengan R:R final 1:1.68.
> - ⛔ BUY Zona 2: Bagian 3 memuat zona tetapi 4B tidak punya order (dibatalkan/ditolak validator) → setup dibatalkan di Bagian 3 dan 4B (WAIT / NO TRADE).
> - 📝 3 baris teks bebas disamakan dengan tabel final (Entry/SL/TP/R:R/lot/risiko).
> - 🧭 Skenario Batal Sell Zona 2: SL dipisah dari invalidation; level 3643.50 (bukan level struktur) tidak dipakai sebagai invalidation; tidak ada level struktur valid → belum terdefinisi.
> - 🔎 Jejak audit: konfigurasi #ed69120ebd2d (saldo $1,300, risiko 2%, Zona 1/2/3 ON/ON/ON, 3 zona) · snapshot #dbfc8c088592 (D1 15:00:29Z, H1 15:00:28Z, H4 15:00:28Z, M15 15:00:28Z, M5 15:00:28Z, W1 15:00:29Z) · model 2tahap:mimo-v2.5-pro · deploy b01fc28 · smc-validators/2026-11-24.labels1.

> 📡 **V2 — OHLC MT4 + SMC**
> Sumber: MT4 EA. Cocokkan harga dengan chart broker sebelum menggunakan level.

| TF | Bias | ATR | Zona fresh terdekat di ATAS | Zona fresh terdekat di BAWAH | Support swing utuh |
|---|---|---|---|---|---|
| M5 | BULLISH | 6.67 | FVG 3624.75–3626.73 | OB 3613.48–3618.41 | Swing low 3613.48 |
| M15 | BEARISH | 10.87 | FVG 3632.58–3640.36 | — | Swing low 3613.22 |
| H1 | BEARISH | 17.77 | OB 3710.52–3721.63 | FVG 3538.39–3568.22 | Swing low 3607.35 |
| H4 | BULLISH | 46.47 | FVG 3717.15–3725.36 | FVG 3542.22–3575.28 | Swing low 3502.82 |
| D1 | BEARISH | 109 | FVG 3758.27–3836.56 | — | — |
| W1 | BEARISH | 221 | — | FVG 3378.79–3437.12 | Swing low 3311.55 |

Alignment H4/H1/M15: **CAMPURAN** (H4 BULLISH, H1 BEARISH, M15 BEARISH)

---

> 🧮 **TRANSPARANSI RISIKO — order ditolak karena batas risiko**
> - Buy Z2: risiko lot minimum $26.01 (lot 0.01), batas risiko per arah $26.00, kelebihan $0.01 → NO TRADE. Alasan: anggaran risiko tidak cukup untuk lot minimum broker; server tidak menaikkan lot/batas atau menggeser SL.
>   Dampak: keputusan final = HANYA COUNTERTREND. Zona ini SEARAH bias final BULLISH; tidak ada setup searah lain yang lolos. Informasi: order ini lolos bila batas risiko ≥ $26.01 (saldo ≥ $1,300.5 pada risiko 2%); ini bukan saran menaikkan risiko.

**BIAS UTAMA:** BULLISH - FOKUS BUY

> 🧭 **BIAS** | Model Gemini: BEARISH (campuran) | Struktur H4 mesin: BULLISH | Final server: BULLISH
> ⚠️ KONFLIK BIAS: Model menulis BEARISH (teks memuat BULLISH dan BEARISH sekaligus; arah pertama dibaca sebagai arah model), struktur H4 mesin BULLISH. Aturan server: arah ditentukan struktur mesin; narasi model tidak membalik arah. Bias final = BULLISH.
> Teks asli model: "BEARISH - FOKUS SELL (HATI-HATI: H4 MASIH BULLISH)"
> Keputusan server memakai bias final yang sama: HANYA COUNTERTREND.
**PAIR:** XAUUSD
**HARGA TERAKHIR:** 3618.85
**ATR:** H1 17.77 | H4 46.47

Harga terakhir 3618.85 (Bid feed MT4, Ask 3619.21), waktu server 22:00 WIB, sesi New York, keyakinan Sedang (timeframe campuran + No-Trade Zone aktif).

> ⚠️ **KEPUTUSAN SERVER — HANYA COUNTERTREND:** Tidak ada setup searah bias BULLISH. Hanya countertrend (SELL Zona 2): risiko lebih tinggi, wajib konfirmasi ekstra; tidak trading adalah opsi yang sah.
> ⚠️ Alignment CAMPURAN (H4 BULLISH, H1 BEARISH, M15 BEARISH): timeframe belum searah; tunggu konfirmasi sebelum entry.
> ⚠️ Bias BULLISH (H4/H1) MELAWAN D1 & W1 (BEARISH/BEARISH): setup searah bias ini pullback melawan tren besar. Keyakinan dibatasi Sedang; kurangi ukuran dan wajib konfirmasi ekstra. Setup SELL justru searah D1/W1.

> **Ringkasan Cepat**
> - Rencana: Jangan buka order baru sekarang (masih di dalam No-Trade Zone). Tunggu 22:15 WIB, lalu siapkan Sell Limit di supply terdekat.
> - Level kunci: 3624.75-3626.73 (supply M5), 3613.48 (support), 3643.50 (invalidasi bearish)
> - Hindari trading: 21:45-22:15 WIB (CB Consumer Confidence, sedang aktif) dan 25 Nov 20:15-20:45 WIB
> - Masa Berlaku Sinyal: Zona 1 valid sampai 25 Nov 2026 03.00 WIB; Zona 2 valid sampai Daily Close 25 Nov 2026 05.00 WIB. Segera hapus pending order bila harga menyentuh TP lebih dulu sebelum menjemput order.

### 1. Analisa Fundamental (Sentimen Makro Terkini)

Sumber kalender: biquote (pihak ketiga gratis, belum terverifikasi resmi) — angka Actual perlu dicek ke sumber resmi.

**Jadwal Berita (WIB)**

| Jam (WIB) | Mata Uang | Event | Impact | Forecast | Previous | Actual |
|---|---|---|---|---|---|---|
| 24 Nov 22:00 | USD | CB Consumer Confidence Index | High | 91.5 | 91.7 | sudah lewat jadwal, belum terisi di sumber (tidak ditebak) |
| 25 Nov 20:30 | USD | Core PCE Price Index m/m | High | 0.3 | 0.3 | Belum Rilis |
| 25 Nov 20:30 | USD | Core PCE Price Index y/y | High | 3.1 | 3.1 | Belum Rilis |
| 25 Nov 20:30 | USD | GDP q/q | High | 3.4 | 3.4 | Belum Rilis |
| 25 Nov 20:30 | USD | Durable Goods Orders m/m | High | -0.7 | 1.8 | Belum Rilis |
| 25 Nov 22:00 | USD | New Home Sales | High | 0739 | 0676 | Belum Rilis |

- Consumer Confidence: forecast 91.5 sedikit di bawah previous 91.7. Actual belum terisi, jadi arah belum bisa dipastikan.
- Skenario: actual di bawah 91.5 = USD lemah = emas cenderung naik. Actual di atas 91.5 = USD kuat = emas tertekan.
- Besok 20:30 WIB paket besar (Core PCE + GDP + Durable Goods). Core PCE forecast 0.3 sama dengan previous = pasar belum melihat inflasi mereda; angka lebih tinggi dari 0.3 berisiko tekan emas.
- Dampak bersih hari ini: Campuran / belum jelas sampai Actual keluar.

⚠️ **No-Trade Zone:** 21:45-22:15 WIB (CB Consumer Confidence) — SEKARANG 22:00 WIB, masih di dalam jendela. DILARANG membuka order baru sampai 22:15 WIB. Besok: 20:15-20:45 WIB (PCE/GDP/Claims) dan 21:45-22:15 WIB (New Home Sales), serta 22:15-22:45 WIB (EIA).

### 2. Analisa Teknikal Price Action Terbaru

**Struktur Top-Down (dari OHLC tertutup)**

| Timeframe | Struktur/Trend | Level Kunci | Catatan |
|---|---|---|---|
| W1 | Bearish (BOS bearish 3942.54, 24 Okt) | 3311.55 (Swing Low utuh W1) | Tren besar masih turun, harga jauh di bawah supply 4066.07-4207.58 |
| D1 | Bearish (CHoCH bearish 3869.95, 15 Nov) | 3758.27-3836.56 (FVG Bearish D1 fresh, tepi atas) | Belum ada CHoCH bullish D1 |
| H4 | Bullish (CHoCH bullish 3595.13, 22 Nov) | 3717.15-3725.36 (FVG Bearish H4 fresh, tepi atas) | Support besar 3502.82; struktur naik tapi tertahan supply |
| H1 | Bearish (CHoCH bearish 3619.80, 24 Nov 15:00 WIB) | 3710.52-3721.63 (OB Bearish H1 fresh, tepi atas) | Resistance 3646.62; support 3607.35 |
| M15 | Bearish (CHoCH bearish 3621.66, 24 Nov 20:30 WIB) | 3632.58-3640.36 (FVG Bearish M15 fresh, tepi atas) | Ada juga FVG bearish fresh 3647.31-3650.48 |
| M5 | Bullish (CHoCH bullish 3620.69, 24 Nov 21:35 WIB) | 3613.48-3618.41 (OB Bullish M5 fresh, tepi atas) | FVG bearish fresh 3624.75-3626.73 tepat di atas harga |

- Zona Supply/Demand terpakai: supply M5 3624.75-3626.73, supply M15 3632.58-3640.36, demand H1 3529.96-3557.16, demand H4 3542.22-3575.28.
- Struktur terbaru: harga naik ke 3646.62 lalu ditolak; CHoCH bearish M15 di 3621.66 = tekanan jual kembali dominan jangka pendek.
- Candle terakhir: close 3622.17 setelah gagal di 3631.65 (rejection), masih di atas support 3613.22.
- Catatan: OB bull M5 3613.48-3618.41 fresh tapi sudah ditempati harga, jadi tidak ada ruang untuk buy limit baru.
- **Hasil Pemindaian Order:** Tidak ada data order (mode tanpa screenshot).

### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)

| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 1 - Scalping (RBS / Demand Dekat) - Dasar: M5 OB bullish sudah ditempati harga, tidak ada ruang limit (Searah Bias) | Tidak ada level valid (tunggu) | - | - | - | - |
| BUY Zona 2 - Intraday (Demand H1-H4) - Dasar: H1 FVG bullish fresh, H4 FVG bullish fresh (Searah Bias) ⛔ | Tidak ada level valid (tunggu) | - | - | - | - |
| BUY Zona 3 - Swing | Tidak ada level valid (tunggu) — tidak ada target struktural valid | - | - | - | - |
| SELL Zona 1 - Scalping (Supply / Resistance Dekat) - Dasar: M5 FVG bearish fresh, rejection wick dari (Counter-Trend - Wajib Konfirmasi Ekstra) | Tidak ada level valid (tunggu) — tidak ada target struktural valid | - | - | - | - |
| SELL Zona 2 - Intraday (Supply / Resistance Kuat H1-H4) - Dasar: M15 FVG bearish fresh 3632.58-3640.36 (area supply H1 3628.31-3640.39) (Counter-Trend - Wajib Konfirmasi Ekstra) | 3632.58 - 3640.36 | 3643.03 | 3615.00 | 3609.13 | Tunggu sentuh zona + bearish close M15 di bawah 3632.58; R:R ±1:1.68 |
| SELL Zona 3 - Swing | Tidak ada level valid (tunggu) — tidak ada target struktural valid | - | - | - | - |

### 4. Rekomendasi Susunan Pending Order

**4A. Audit Posisi & Pending Order User**

Tidak ada data order terpasang (mode tanpa screenshot).

**4B. KANDIDAT ORDER — BELUM BOLEH DIPASANG**

> 🏷️ **Status order 4B:** ⏳ Keputusan server = HANYA COUNTERTREND. Semua order di tabel ini berstatus **CANDIDATE ORDER** (kandidat untuk perencanaan, BELUM boleh dipasang). Jangan memasang pending order apa pun selama keputusan server belum berubah menjadi setup utama; "ACTIVE SETUP" butuh konfirmasi harga/candle aktual yang belum dinilai validator.

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 1 (Scalping Resistance / Supply Terdekat) (Counter-Trend - Wajib Konfirmasi Ekstra) | Tidak Ada Setup (Tidak Ada Target Struktural Valid: Tidak Dipasang) | - | - | - | - | - | - | - |
| Sell Limit Zona 2 (Intraday Supply / Resistance Kuat H1-D1) (Counter-Trend - Wajib Konfirmasi Ekstra) — ⏳ CANDIDATE (belum boleh dipasang) | 3632.58 | 3643.03 | 3615.00 | 10.45 | 0.02 | $20.90 | 1:1.68 | 25 Nov 2026, 05.00 WIB (MT4 server GMT+2: 25 Nov 2026, 00.00) |
| Sell Limit Zona 3 (Swing) | Tidak Ada Setup (Tidak Ada Target Struktural Valid: Tidak Dipasang) | - | - | - | - | - | - | - |
| Buy Limit Zona 1 (Scalping Support / RBS Terdekat) | Tidak Ada Setup (Tunggu) | - | - | - | - | - | - | - |
| Buy Limit Zona 2 (Intraday Demand / Support Kuat H1-D1) (Searah Bias) | Tidak Ada Setup (Batas Risiko: Tidak Dipasang) | - | - | - | - | - | - | - |
| Buy Limit Zona 3 (Swing) | Tidak Ada Setup (Tidak Ada Target Struktural Valid: Tidak Dipasang) | - | - | - | - | - | - | - |

**Rincian Hitung Risiko**
- Sell Limit Zona 1: tidak ada order (tidak ada target struktural valid (tidak ada level struktur dengan R:R >= 1:1.5 dalam batas 2.5R))
- Sell Limit Zona 2: 0.02 lot x 10.45 x 100 (tickValue 1 / tickSize 0.01, USD) = $20.90
- Buy Limit Zona 2: tidak ada order (melebihi batas risiko)
- Total risiko arah SELL = $18.62 (batas $26.00, aman). Total arah BUY = $16.56 (aman).

**Aturan Pasang (batas risiko $26.00 per arah; dihitung ulang server dari order yang lolos validator):**

- Kandidat awal sebelum validator (risiko per order, BUKAN total dan bukan order aktif): Sell Z2 $20.90, Buy Z2 $26.01.
- Dibatalkan validator (tidak dihitung): Sell Z1 (Tidak Ada Target Struktural Valid), Sell Z3 (Tidak Ada Target Struktural Valid), Buy Z2 (Batas Risiko), Buy Z3 (Tidak Ada Target Struktural Valid).
- Lolos validator (total akhir; batas $26.00 per arah; semuanya hanya CANDIDATE):
- SELL: Sell Z2 = $20.90 (di bawah batas $26.00 per arah) — CANDIDATE, belum boleh dipasang.
- BUY: tidak ada order valid (WAIT / NO TRADE).
- ⏳ HANYA COUNTERTREND: jangan memasang order apa pun sebelum konfirmasi entry terpenuhi.

**Skenario Batal (Invalidation Level)**
- WAIT / NO TRADE — Sell Zona 1: tidak ada order (setup dibatalkan / belum valid; lihat Bagian 3 dan 4B)
- Sell Zona 2: SL 3643.03 = batas risiko posisi (kena SL → posisi keluar). Invalidation struktural belum terdefinisi — perlu evaluasi manual.
- WAIT / NO TRADE — Buy Zona 2: tidak ada order (setup dibatalkan / belum valid; lihat Bagian 3 dan 4B)

**Manajemen Posisi**
- angka final tiap zona: lihat tabel Bagian 3 dan 4B
- Ambil partial 50% di TP1, sisanya trailing ke TP2.
- Ingat: kolom "Waktu berakhir" di MT4 memakai JAM SERVER BROKER, bukan WIB. Jam WIB di tabel 4B adalah konversi; samakan dengan offset server broker Anda sebelum memasang order.

_Bukan saran keuangan. Selalu gunakan manajemen risiko._

> 🧮 **Verifikasi risiko otomatis** (XAUUSD: Risiko = Lot × Jarak SL × 100 (tickValue 1 / tickSize 0.01, USD)) catatan:
> - Sell Limit Zona 2 (Intraday Supply / Resistance Kuat H1-D1) (Searah Bias): Risiko dikoreksi - -> $20.90 (0.02 x 10.45 x 100 (tickValue 1 / tickSize 0.01, USD))
> - 🚫 Buy Limit Zona 2 (Intraday Demand / Support Kuat H1-D1) (Counter-Trend): NO TRADE — risiko $26.01 pada lot minimum broker 0.01 melebihi batas $26.00 (anggaran tidak cukup untuk lot minimum) → order TIDAK DIPASANG (perkecil jarak SL atau naikkan batas risiko).
> - ℹ️ Total risiko per arah (hanya order lolos validator): BUY $0.00 | SELL $20.90 (batas $26.00 per arah).


---

### Lampiran: Detail SMC dari candle (referensi)

```text
KANDIDAT ZONA DARI SMC — MODE 3 ZONA (harga feed 3618.85):
- SELL Zona 1 (Scalping): entry 3624.75–3626.73 (jarak zona 5.9, limit 3624.75; dasar: M5 FVG; SL minimal ≥ 3628.36, di luar zona)  ⛔ [kandidat mesin; DIBATALKAN validator server (R:R/risiko/lot/zona) - bukan setup]
- SELL Zona 2 (Intraday): entry 3632.58–3640.36 (jarak zona 13.73, limit 3632.58; dasar: M15 FVG; SL minimal ≥ 3643.03, di luar zona)
- SELL Zona 3 (Swing): entry 3710.52–3721.63 (jarak zona 91.67, limit 3710.52; dasar: H1 OB, H4 FVG; SL minimal ≥ 3728.03, di luar zona)  ⛔ [kandidat mesin; DIBATALKAN validator server (R:R/risiko/lot/zona) - bukan setup]
- BUY Zona 1 (Scalping): Tidak ada level valid (tunggu)  ⛔ [kandidat mesin; DIBATALKAN validator server (R:R/risiko/lot/zona) - bukan setup]
- BUY Zona 2 (Intraday): entry 3539.98–3553.31 (jarak zona 50.63, limit 3553.31; dasar: H1 FVG, H4 FVG; SL minimal ≤ 3527.29, di luar zona)  ⛔ [kandidat mesin; DIBATALKAN validator server (R:R/risiko/lot/zona) - bukan setup]
- BUY Zona 3 (Swing): entry 3530.23–3543.56 (jarak zona 61.69, limit 3543.56; dasar: H1 FVG, H4 FVG; SL minimal ≤ 3527.29, di luar zona)  ⛔ [kandidat mesin; DIBATALKAN validator server (R:R/risiko/lot/zona) - bukan setup]
ATURAN: entry HARUS di dalam OB/FVG fresh searah (kandidat diutamakan). "Tidak ada level valid" = tulis "Tidak ada level valid (tunggu)" dan 4B "Tidak Ada Setup (Tunggu)". Server MEMBATALKAN order di luar zona SMC fresh.

=== HASIL SMC DETERMINISTIK DARI OHLC TERTUTUP ===
BOS/CHoCH memakai close candle setelah swing terkonfirmasi; sweep unik per pivot; OB mitigasi hanya dihitung setelah break; hasil bukan probabilitas profit.

[M5] status=OK; bars=180; close terakhir=3622.17
Bias struktur: BULLISH | ATR(14) OHLC=6.672143
Event: CHoCH BULLISH @ 3624.86 (2026-11-24T10:30:00.000Z) | BOS BULLISH @ 3626.86 (2026-11-24T10:55:00.000Z) | BOS BULLISH @ 3630.1 (2026-11-24T11:40:00.000Z) | BOS BULLISH @ 3635.09 (2026-11-24T11:55:00.000Z) | CHoCH BEARISH @ 3622.71 (2026-11-24T12:10:00.000Z) | CHoCH BULLISH @ 3637.34 (2026-11-24T12:40:00.000Z) | CHoCH BEARISH @ 3625.49 (2026-11-24T13:30:00.000Z) | CHoCH BULLISH @ 3620.69 (2026-11-24T14:35:00.000Z)
Liquidity sweep: BUY-SIDE LIQUIDITY SWEEP @ 3624.86 | BUY-SIDE LIQUIDITY SWEEP @ 3626.86 | BUY-SIDE LIQUIDITY SWEEP @ 3630.1 | BUY-SIDE LIQUIDITY SWEEP @ 3635.09 | SELL-SIDE LIQUIDITY SWEEP @ 3622.71 | BUY-SIDE LIQUIDITY SWEEP @ 3637.34 | SELL-SIDE LIQUIDITY SWEEP @ 3625.49 | BUY-SIDE LIQUIDITY SWEEP @ 3620.69
Order Block: BULLISH 3617.61-3623.76 (INVALIDATED) | BULLISH 3622-3624.93 (INVALIDATED) | BULLISH 3627.49-3631.04 (INVALIDATED) | BULLISH 3632-3634.71 (INVALIDATED) | BEARISH 3634.04-3637.34 (INVALIDATED) | BULLISH 3621.79-3623.69 (INVALIDATED) | BEARISH 3627.21-3632.13 (MITIGATED) | BULLISH 3613.48-3618.41 (FRESH)
FVG: BULLISH 3623.69-3624.19 (MITIGATED) | BULLISH 3627.75-3630.22 (MITIGATED) | BULLISH 3632.06-3632.23 (MITIGATED) | BULLISH 3637.41-3640.36 (MITIGATED) | BEARISH 3642.44-3642.72 (FRESH) | BEARISH 3636.85-3641.64 (PARTIALLY_MITIGATED) | BULLISH 3621.69-3624.56 (MITIGATED) | BEARISH 3624.75-3626.73 (FRESH)
Support swing utuh di bawah harga (pivot low belum ditembus): 3613.48 | 3613.22 | 3607.35
Resistance swing utuh di atas harga (pivot high belum ditembus): 3631.89 | 3646.62 | 3660.54
Zona fresh: ORDER_BLOCK BULLISH 3613.48-3618.41 | FVG BEARISH 3624.75-3626.73

[M15] status=OK; bars=180; close terakhir=3622.17
Bias struktur: BEARISH | ATR(14) OHLC=10.87
Event: CHoCH BULLISH @ 3637.37 (2026-11-24T00:15:00.000Z) | CHoCH BEARISH @ 3645.07 (2026-11-24T02:45:00.000Z) | BOS BEARISH @ 3628.72 (2026-11-24T04:15:00.000Z) | BOS BEARISH @ 3624.26 (2026-11-24T06:15:00.000Z) | BOS BEARISH @ 3615.08 (2026-11-24T08:15:00.000Z) | CHoCH BULLISH @ 3625.4 (2026-11-24T10:45:00.000Z) | BOS BULLISH @ 3637.34 (2026-11-24T12:30:00.000Z) | CHoCH BEARISH @ 3621.66 (2026-11-24T13:30:00.000Z)
Liquidity sweep: BUY-SIDE LIQUIDITY SWEEP @ 3637.37 | SELL-SIDE LIQUIDITY SWEEP @ 3628.72 | SELL-SIDE LIQUIDITY SWEEP @ 3624.26 | SELL-SIDE LIQUIDITY SWEEP @ 3615.08 | BUY-SIDE LIQUIDITY SWEEP @ 3628.58 | BUY-SIDE LIQUIDITY SWEEP @ 3625.4 | BUY-SIDE LIQUIDITY SWEEP @ 3637.34 | SELL-SIDE LIQUIDITY SWEEP @ 3621.66
Order Block: BULLISH 3627.27-3637.03 (INVALIDATED) | BEARISH 3645.07-3659.76 (MITIGATED) | BEARISH 3629.23-3634.94 (INVALIDATED) | BEARISH 3628.31-3640.07 (INVALIDATED) | BEARISH 3615.08-3625.46 (INVALIDATED) | BULLISH 3617.51-3624.86 (INVALIDATED) | BULLISH 3621.79-3635.61 (INVALIDATED) | BEARISH 3625.62-3643.76 (MITIGATED)
FVG: BEARISH 3659.76-3662.53 (PARTIALLY_MITIGATED) | BEARISH 3647.31-3650.48 (FRESH) | BEARISH 3642.72-3646.46 (MITIGATED) | BULLISH 3630.55-3632 (MITIGATED) | BEARISH 3627.75-3632 (MITIGATED) | BULLISH 3627.75-3640.36 (MITIGATED) | BEARISH 3632.58-3640.36 (FRESH) | BEARISH 3622.95-3624.4 (MITIGATED)
Support swing utuh di bawah harga (pivot low belum ditembus): 3613.22 | 3607.35 | 3600.4
Resistance swing utuh di atas harga (pivot high belum ditembus): 3646.62 | 3678.03 | 3681.21
Zona fresh: FVG BEARISH 3647.31-3650.48 | FVG BEARISH 3632.58-3640.36

[H1] status=OK; bars=180; close terakhir=3622.17
Bias struktur: BEARISH | ATR(14) OHLC=17.768571
Event: CHoCH BEARISH @ 3841.46 (2026-11-18T00:00:00.000Z) | BOS BEARISH @ 3757.15 (2026-11-18T12:00:00.000Z) | BOS BEARISH @ 3742.4 (2026-11-18T17:00:00.000Z) | BOS BEARISH @ 3719.78 (2026-11-19T02:00:00.000Z) | BOS BEARISH @ 3693.36 (2026-11-19T15:00:00.000Z) | CHoCH BULLISH @ 3586.18 (2026-11-23T01:00:00.000Z) | BOS BULLISH @ 3627.11 (2026-11-23T13:00:00.000Z) | CHoCH BEARISH @ 3619.8 (2026-11-24T08:00:00.000Z)
Liquidity sweep: BUY-SIDE LIQUIDITY SWEEP @ 3786.43 | SELL-SIDE LIQUIDITY SWEEP @ 3757.15 | SELL-SIDE LIQUIDITY SWEEP @ 3742.4 | SELL-SIDE LIQUIDITY SWEEP @ 3719.78 | SELL-SIDE LIQUIDITY SWEEP @ 3514.82 | BUY-SIDE LIQUIDITY SWEEP @ 3586.18 | BUY-SIDE LIQUIDITY SWEEP @ 3630.4 | SELL-SIDE LIQUIDITY SWEEP @ 3619.8
Order Block: BEARISH 3845.67-3857.87 (FRESH) | BEARISH 3765.58-3786.43 (MITIGATED) | BEARISH 3743.2-3790.4 (MITIGATED) | BEARISH 3737.79-3758.27 (MITIGATED) | BEARISH 3710.52-3721.63 (FRESH) | BULLISH 3568.22-3585.15 (MITIGATED) | BULLISH 3612.59-3623.17 (MITIGATED) | BEARISH 3628.31-3640.39 (INVALIDATED)
FVG: BEARISH 3558.07-3563.31 (MITIGATED) | BULLISH 3529.96-3557.16 (FRESH) | BULLISH 3538.39-3568.22 (FRESH) | BULLISH 3623.17-3645.89 (MITIGATED) | BEARISH 3638.05-3638.52 (MITIGATED) | BULLISH 3637.37-3652.99 (MITIGATED) | BEARISH 3642.72-3652.99 (PARTIALLY_MITIGATED) | BEARISH 3625.46-3628.31 (MITIGATED)
Support swing utuh di bawah harga (pivot low belum ditembus): 3607.35 | 3600.4 | 3502.82
Resistance swing utuh di atas harga (pivot high belum ditembus): 3646.62 | 3678.03 | 3689.62
Zona fresh: ORDER_BLOCK BEARISH 3845.67-3857.87 | ORDER_BLOCK BEARISH 3710.52-3721.63 | FVG BULLISH 3529.96-3557.16 | FVG BULLISH 3538.39-3568.22

[H4] status=OK; bars=180; close terakhir=3614.8
Bias struktur: BULLISH | ATR(14) OHLC=46.465714
Event: CHoCH BULLISH @ 3971.22 (2026-11-04T02:00:00.000Z) | BOS BULLISH @ 4134.12 (2026-11-09T18:00:00.000Z) | CHoCH BEARISH @ 4024.77 (2026-11-10T14:00:00.000Z) | BOS BEARISH @ 4013.28 (2026-11-11T14:00:00.000Z) | BOS BEARISH @ 3852.36 (2026-11-16T02:00:00.000Z) | BOS BEARISH @ 3836.56 (2026-11-17T22:00:00.000Z) | BOS BEARISH @ 3693.36 (2026-11-19T14:00:00.000Z) | CHoCH BULLISH @ 3595.13 (2026-11-22T22:00:00.000Z)
Liquidity sweep: SELL-SIDE LIQUIDITY SWEEP @ 4028.01 | BUY-SIDE LIQUIDITY SWEEP @ 3970.22 | BUY-SIDE LIQUIDITY SWEEP @ 4134.12 | SELL-SIDE LIQUIDITY SWEEP @ 4024.77 | SELL-SIDE LIQUIDITY SWEEP @ 3852.36 | SELL-SIDE LIQUIDITY SWEEP @ 3841 | BUY-SIDE LIQUIDITY SWEEP @ 3886.79 | SELL-SIDE LIQUIDITY SWEEP @ 3514.82
Order Block: BULLISH 3917.45-3934.92 (INVALIDATED) | BULLISH 4100.83-4130.95 (INVALIDATED) | BEARISH 4100.52-4148.46 (FRESH) | BEARISH 4039.34-4065.7 (FRESH) | BEARISH 3867.47-3899.49 (MITIGATED) | BEARISH 3850.64-3890.81 (FRESH) | BEARISH 3728.06-3758.27 (FRESH) | BULLISH 3520.38-3586.18 (MITIGATED)
FVG: BEARISH 3789.06-3805.35 (PARTIALLY_MITIGATED) | BEARISH 3717.15-3725.36 (FRESH) | BEARISH 3687.11-3710.52 (PARTIALLY_MITIGATED) | BEARISH 3635.21-3666.98 (MITIGATED) | BEARISH 3561.3-3619.35 (MITIGATED) | BEARISH 3542.22-3553.11 (MITIGATED) | BULLISH 3542.22-3575.28 (FRESH) | BULLISH 3636.97-3645.89 (MITIGATED)
Support swing utuh di bawah harga (pivot low belum ditembus): 3502.82
Resistance swing utuh di atas harga (pivot high belum ditembus): 3689.62 | 3890.81 | 3900.79
Zona fresh: ORDER_BLOCK BEARISH 4100.52-4148.46 | ORDER_BLOCK BEARISH 4039.34-4065.7 | ORDER_BLOCK BEARISH 3850.64-3890.81 | ORDER_BLOCK BEARISH 3728.06-3758.27 | FVG BEARISH 4038.17-4046.31 | FVG BEARISH 3955.27-3969.29 | FVG BEARISH 3809.78-3841.46 | FVG BEARISH 3717.15-3725.36 | FVG BULLISH 3542.22-3575.28

[D1] status=OK; bars=180; close terakhir=3634.52
Bias struktur: BEARISH | ATR(14) OHLC=108.554286
Event: BOS BULLISH @ 4449.63 (2026-08-18T22:00:00.000Z) | CHoCH BEARISH @ 4283.35 (2026-09-15T22:00:00.000Z) | BOS BEARISH @ 4234.94 (2026-09-27T22:00:00.000Z) | BOS BEARISH @ 4109.72 (2026-10-06T22:00:00.000Z) | BOS BEARISH @ 4072.96 (2026-10-21T22:00:00.000Z) | BOS BEARISH @ 3975.07 (2026-10-29T22:00:00.000Z) | CHoCH BULLISH @ 4082.47 (2026-11-04T22:00:00.000Z) | CHoCH BEARISH @ 3869.95 (2026-11-15T22:00:00.000Z)
Liquidity sweep: BUY-SIDE LIQUIDITY SWEEP @ 4580.5 | SELL-SIDE LIQUIDITY SWEEP @ 4023.74 | SELL-SIDE LIQUIDITY SWEEP @ 3958.96 | SELL-SIDE LIQUIDITY SWEEP @ 4021.54 | SELL-SIDE LIQUIDITY SWEEP @ 4283.35 | SELL-SIDE LIQUIDITY SWEEP @ 4109.72 | BUY-SIDE LIQUIDITY SWEEP @ 4082.47 | SELL-SIDE LIQUIDITY SWEEP @ 3869.95
Order Block: BULLISH 4328.56-4435.99 (INVALIDATED) | BEARISH 4288.41-4402.43 (MITIGATED) | BEARISH 4254.16-4315.76 (FRESH) | BEARISH 4100.31-4184.17 (INVALIDATED) | BEARISH 4104.55-4141.96 (MITIGATED) | BEARISH 4024.4-4082.47 (INVALIDATED) | BULLISH 3894.6-3971.22 (INVALIDATED) | BEARISH 3867.47-3922.55 (MITIGATED)
FVG: BULLISH 4145.94-4154.46 (MITIGATED) | BEARISH 4033.8-4104.55 (MITIGATED) | BEARISH 3970.22-4004.62 (MITIGATED) | BULLISH 3971.22-4057.79 (MITIGATED) | BEARISH 4000.07-4013.28 (FRESH) | BEARISH 3922.55-3982.37 (FRESH) | BEARISH 3758.27-3836.56 (FRESH) | BEARISH 3635.21-3719.78 (PARTIALLY_MITIGATED)
Resistance swing utuh di atas harga (pivot high belum ditembus): 4148.46 | 4198.89 | 4217.01
Zona fresh: ORDER_BLOCK BEARISH 4254.16-4315.76 | FVG BEARISH 4000.07-4013.28 | FVG BEARISH 3922.55-3982.37 | FVG BEARISH 3758.27-3836.56

[W1] status=OK; bars=180; close terakhir=3538.19
Bias struktur: BEARISH | ATR(14) OHLC=221.332857
Event: BOS BULLISH @ 2685.44 (2024-10-12T22:00:00.000Z) | CHoCH BEARISH @ 2604.77 (2024-11-09T22:00:00.000Z) | CHoCH BULLISH @ 2726.15 (2025-01-18T22:00:00.000Z) | BOS BULLISH @ 3438.77 (2025-08-23T22:00:00.000Z) | BOS BULLISH @ 4245.39 (2025-12-06T22:00:00.000Z) | BOS BULLISH @ 4549.92 (2026-01-10T22:00:00.000Z) | CHoCH BEARISH @ 4098.53 (2026-06-20T22:00:00.000Z) | BOS BEARISH @ 3942.54 (2026-10-24T22:00:00.000Z)
Liquidity sweep: BUY-SIDE LIQUIDITY SWEEP @ 2431.44 | BUY-SIDE LIQUIDITY SWEEP @ 2450.07 | BUY-SIDE LIQUIDITY SWEEP @ 2685.44 | SELL-SIDE LIQUIDITY SWEEP @ 2604.77 | BUY-SIDE LIQUIDITY SWEEP @ 4245.39 | SELL-SIDE LIQUIDITY SWEEP @ 4402.14 | SELL-SIDE LIQUIDITY SWEEP @ 4098.53 | SELL-SIDE LIQUIDITY SWEEP @ 3942.54
Order Block: BULLISH 2624.59-2673.04 (INVALIDATED) | BEARISH 2724.72-2790.09 (INVALIDATED) | BULLISH 2582.92-2664.23 (FRESH) | BULLISH 3329.85-3401.85 (FRESH) | BULLISH 4163.43-4264.63 (INVALIDATED) | BULLISH 4274.49-4530.37 (INVALIDATED) | BEARISH 4366.52-4595.18 (INVALIDATED) | BEARISH 4066.07-4207.58 (MITIGATED)
FVG: BULLISH 4264.63-4271.54 (MITIGATED) | BULLISH 4517.2-4621.06 (MITIGATED) | BULLISH 4642.91-4682.18 (MITIGATED) | BEARISH 4602.46-5009.66 (PARTIALLY_MITIGATED) | BEARISH 4363.5-4366.52 (MITIGATED) | BULLISH 4120.4-4310.22 (MITIGATED) | BEARISH 4442.68-4445.14 (FRESH) | BEARISH 4207.58-4243.69 (PARTIALLY_MITIGATED)
Support swing utuh di bawah harga (pivot low belum ditembus): 3311.55 | 3268.17 | 3248.48
Resistance swing utuh di atas harga (pivot high belum ditembus): 4696.84 | 4773.42 | 4889.64
Zona fresh: ORDER_BLOCK BULLISH 2582.92-2664.23 | ORDER_BLOCK BULLISH 3329.85-3401.85 | FVG BULLISH 3378.79-3437.12

Alignment H4/H1/M15: CAMPURAN (H4 BULLISH, H1 BEARISH, M15 BEARISH).
OB/FVG invalidated atau mitigated tidak dipromosikan sebagai zona fresh. Validasi harga broker tetap wajib.
```

---

_Sumber fundamental: kalender ekonomi biquote.io (pihak ketiga, belum terverifikasi), jam dikonversi ke WIB._