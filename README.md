# AureusDesk AI 🟡

Analisa Trading Emas (XAU/USD) Multi-Timeframe berbasis AI — **Next.js 14 (App Router) + Tailwind CSS + Supabase + Google Gemini `gemini-flash-latest`** dengan **Kalender Ekonomi Live ForexFactory** (jam WIB, Actual/Forecast/Previous, No-Trade Zone) disuntik server ke prompt — tanpa Google Search Grounding (bebas limit 429 search).

---

## 1. Struktur Folder

```
aureusdesk-ai/
├── app/
│   ├── api/
│   │   ├── analyze/route.js        # POST: kirim gambar -> Gemini + kalender live
│   │   └── history/
│   │       ├── route.js            # GET daftar riwayat · POST simpan (+ upload thumbnail)
│   │       └── [id]/route.js       # GET detail · DELETE hapus (+ hapus thumbnail)
│   ├── globals.css                 # Tema trading gelap, styling markdown & print
│   ├── layout.js
│   └── page.js                     # UI utama
├── components/
│   ├── HistoryPanel.js             # Sidebar/tab riwayat jurnal
│   ├── MarkdownView.js             # react-markdown + remark-gfm (tabel responsif)
│   └── Uploader.js                 # Drag & drop multi-gambar + label timeframe
├── lib/
│   ├── imageCompress.js            # Kompresi di browser (maks 1280px) + thumbnail
│   ├── prompt.js                   # System instruction & format output wajib
│   └── supabase.js                 # Supabase client
├── supabase/schema.sql             # Query SQL tabel + RLS + Storage bucket
├── .env.example
├── jsconfig.json
├── next.config.mjs
├── package.json
├── postcss.config.js
└── tailwind.config.js
```

## 2. Alur Kerja Aplikasi

1. **Mengompresi chart...** — semua screenshot di-resize ke maks 1280px (JPEG) di browser + thumbnail 360px. Total dicek < 4MB (limit Vercel 4.5MB).
2. **Mencari berita fundamental The Fed...** — `/api/analyze` mengambil kalender ForexFactory (cache 45 menit) lalu memanggil Gemini (tanpa tool search) dengan data itu dan semua gambar sebagai `inlineData` dalam satu request. Gambar otomatis diurutkan Top-Down (W1 → M1 → Tab Trade).
3. **Menyusun setup teknikal & menyimpan ke Supabase...** — `/api/history` meng-upload thumbnail ke bucket `chart-screenshots` lalu menyimpan baris ke tabel `trading_analyses`.

Lot dihitung dengan standar XAU/USD: **1 lot = 100 oz → $1 pergerakan = $100/lot**.
`Lot Aman = (Saldo × Risiko%) / (Jarak SL $ × 100)`, dibulatkan ke bawah 0.01.

---

## 3. Setup Supabase

1. Buka <https://supabase.com> → **New project** (pilih region Singapore agar cepat dari Indonesia).
2. Masuk ke **SQL Editor → New query**, tempel seluruh isi `supabase/schema.sql`, klik **Run**.
   Ini membuat tabel `trading_analyses`, RLS policy, dan bucket Storage `chart-screenshots`.
3. Buka **Project Settings → API** (atau **Data API / API Keys**), salin:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 4. Gemini API Key

1. Buka <https://aistudio.google.com/apikey> → **Create API key**.
2. Salin key → `GEMINI_API_KEY`.
3. Simpan key HANYA di Environment Variables (Vercel / `.env.local`), jangan di dalam kode atau repo GitHub.

## 5. Jalankan Lokal (opsional)

```bash
npm install
cp .env.example .env.local   # lalu isi 3 variabel
npm run dev                  # buka http://localhost:3000
```

---

## 6. Deploy ke Vercel (langkah demi langkah)

1. **Upload ke GitHub**
   - Buat repo baru di <https://github.com/new> (boleh Private).
   - Upload semua file project ini (tanpa `node_modules` dan tanpa `.env.local`).
     Lewat terminal:
     ```bash
     git init && git add . && git commit -m "AureusDesk AI"
     git branch -M main
     git remote add origin https://github.com/USERNAME/aureusdesk-ai.git
     git push -u origin main
     ```
     Atau lewat web GitHub: **Add file → Upload files**, lalu drag seluruh isi folder.
2. **Import ke Vercel**
   - Login <https://vercel.com> dengan akun GitHub → **Add New… → Project** → pilih repo `aureusdesk-ai` → **Import**.
   - Framework Preset otomatis **Next.js**. Biarkan Build Command & Output default.
3. **Isi Environment Variables** (di halaman import, bagian *Environment Variables*, atau nanti di **Project → Settings → Environment Variables**):

   | Key | Value | Environment |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` | Production, Preview, Development |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOi...` | Production, Preview, Development |
   | `GEMINI_API_KEY` | key dari Google AI Studio | Production, Preview, Development |

   Ketik nama Key persis (huruf besar, garis bawah), tempel Value tanpa spasi/tanda kutip, klik **Add** untuk tiap variabel.
4. Klik **Deploy**. Tunggu ±1–2 menit → buka URL `https://aureusdesk-ai-xxxx.vercel.app`.
5. **Jika mengubah env var setelah deploy:** buka tab **Deployments** → titik tiga pada deployment terbaru → **Redeploy** (env baru hanya berlaku setelah redeploy).

---

## 7. Troubleshooting

| Gejala | Solusi |
|---|---|
| `Gemini API: API key not valid` | Cek `GEMINI_API_KEY` di Vercel / input UI, lalu Redeploy. |
| `Gemini API: models/... is not found` | Nama model berubah di Google. Ganti `GEMINI_MODEL` di `lib/prompt.js` (mis. `gemini-flash-latest`). |
| `Gemini API: ... quota / 429` | Kuota gratis Gemini habis. Tunggu reset atau aktifkan billing. |
| `Supabase belum dikonfigurasi` | Env Supabase belum diisi / belum Redeploy. |
| `new row violates row-level security` | SQL `schema.sql` belum dijalankan lengkap. Jalankan ulang. |
| `Payload terlalu besar` / 413 | Kurangi jumlah screenshot (idealnya 4–8 gambar). |
| Timeout 504 | Kurangi gambar. Analisa dibatasi 60 detik (`maxDuration`). |

## 8. Keamanan

- Gemini API Key hanya dipakai di server (`/api/analyze`). Key dari input UI disimpan di `localStorage` browser Anda sendiri.
- Policy RLS di `schema.sql` mengizinkan role `anon` membaca/menambah/menghapus agar aplikasi langsung jalan tanpa login. Artinya **siapa pun yang tahu URL aplikasi Anda bisa melihat & menghapus jurnal**. Jangan bagikan URL secara publik, atau tambahkan Supabase Auth / Vercel Password Protection bila diperlukan.

> AureusDesk AI adalah alat bantu analisa, **bukan saran keuangan**. Trading emas berisiko tinggi.


## Variabel Opsional
- `APP_PIN` — PIN akses (default `123456`; ganti!).
- `FINNHUB_API_KEY` — headline pasar forex Finnhub sebagai konteks sentimen tambahan (opsional).

## Pembaruan Audit (Nov 2026)

1. **Validasi arah SL/TP & R:R** — BUY wajib SL di bawah / TP di atas entry (SELL kebalikannya) di Bagian 3 dan 4B. Order yang terbalik ditandai 🚫 dan memicu satu kali generate ulang. R:R dihitung ulang dari angka entry/SL/TP; R:R < 1:1 diberi peringatan.
2. **Batas risiko per arah** — total risiko BUY Zona 1 + Zona 2 (dan SELL) ≤ batas risiko user; lot diperkecil proporsional. Kirim `riskCap: "order"` di body `/api/analyze` untuk kembali ke batas per order.
3. **Zona berbasis ATR** — rentang tipikal Zona 1 = 0.6–2.5× ATR H1, Zona 2 = 1–3× ATR H4. ATR dibaca AI dari chart (baris `**ATR:**`), dicek kewajarannya, dan memakai ATR profil pair jika tidak wajar. Rentang hanya **pedoman**: level di luar rentang diberi catatan ℹ️, tidak lagi dipaksa pindah lewat retry.
4. **AI Vision** — model utama `gemini-flash-latest` (Lite hanya cadangan terakhir), thinking budget 1024 token, screenshot dikirim lossless (PNG/WebP) bila muat, JPEG kualitas tinggi sebagai cadangan. Mode 2 tahap kini mengekstrak urutan swing (HH/HL/LH/LL), struktur terakhir, dan ATR.
5. **Kontrak & waktu** — pair JPY: Risiko = Lot × Jarak × 100000 / USDJPY. Profil XAGUSD ditambahkan (1 lot = 5000 oz). Daily Close & batas akhir pekan mengikuti DST New York (05:00 / Sabtu 04:00 WIB saat musim dingin AS, 04:00 / 03:00 saat musim panas). Waktu Berakhir 4B ditambah padanan **jam server MT4**.

### Variabel opsional baru
- `GEMINI_THINKING_BUDGET` — token thinking (default `1024`, `0` = mati).
- `USDJPY_RATE` — kurs USDJPY untuk konversi risiko pair cross JPY (default 155).
- `MT4_SERVER_UTC_OFFSET` — offset jam server broker (default otomatis: GMT+2 musim dingin / GMT+3 musim panas).


---

## 9. AureusDesk AI V2 — MT4 OHLC + SMC (Staging)

Patch V2 ini bersifat **aditif**: seluruh alur screenshot, Gemini, mode 2 tahap, kalender, validasi risiko/order, riwayat, dashboard, dan fitur UI lama tetap dipertahankan. Bridge MT4 hanya mengirim data; **tidak pernah membuka/menutup order**.

### 9.1 Cara kerja
1. EA `mt4/AureusDesk_UniversalBridge_v3.2.mq4` mengirim maksimal 180 candle **tertutup** untuk M5/M15/H1/H4/D1/W1 ke endpoint `/api/mt4/market-data`.
2. Endpoint memeriksa secret, simbol, timeframe, integritas OHLC, jumlah candle, timestamp, lalu menyimpan snapshot terbaru per symbol/timeframe ke tabel `mt4_market_snapshots`.
3. `/api/analyze` mengambil feed untuk pair manual, pair hasil ekstraksi AUTO, atau pair hasil ekstraksi mode 2 tahap; OHLC dan ringkasan struktur swing/BOS, CHoCH, liquidity sweep, OB, FVG menjadi bukti ke prompt Gemini. Screenshot tetap dipakai untuk konteks visual/indikator.
4. Reviewer OpenAI tidak dijalankan pada jalur live V2 agar tidak menambah timeout; file reviewer lama tetap ada sebagai modul terpisah, tetapi tidak dipanggil.
5. Jika feed tidak ada atau tidak fresh, alur lama tetap berjalan dan hasil diberi peringatan **VISUAL ONLY — CONFIDENCE TERBATAS**.

> Catatan: deteksi SMC pada patch ini adalah primitive deterministik awal untuk membantu audit. Ia bukan mesin trading final dan tidak menyatakan probabilitas menang. Periksa hasil pada akun demo sebelum dipakai mengambil keputusan.

### 9.2 Setup Supabase (Staging)
1. Buat project Supabase terpisah untuk staging atau gunakan schema project yang memang ditujukan untuk staging.
2. SQL Editor → jalankan seluruh `supabase/schema-v2-mt4.sql`.
3. Project Settings → API → salin **service_role key**. Simpan hanya di environment server Vercel. Jangan pernah memakai prefix `NEXT_PUBLIC_`.

### 9.3 Environment Variables staging
Tambahkan di Vercel → Project staging → Settings → Environment Variables (Preview/Staging):

| Variable | Isi |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL project Supabase staging |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key Supabase staging |
| `MT4_BRIDGE_SECRET` | random secret panjang, minimal 32 karakter |
| `MT4_SYMBOL_MAP` | JSON mapping pair aplikasi ke simbol broker |
| `GEMINI_API_KEY` | key Gemini yang sudah digunakan |

Contoh mapping: `{ "XAUUSD": "XAUUSDm", "EURUSD": "EURUSD.a" }`. Nama harus sama persis dengan Market Watch MT4. Jangan menganggap semua broker memakai suffix yang sama.

### 9.4 Instalasi EA MT4 desktop/VPS
1. Buka MT4 → File → Open Data Folder → `MQL4/Experts`.
2. Salin `mt4/AureusDesk_UniversalBridge_v3.2.mq4` ke folder tersebut.
3. Buka MetaEditor (F4), buka file EA, tekan Compile (F7). Pastikan tidak ada error.
4. MT4 → Tools → Options → Expert Advisors → centang **Allow WebRequest for listed URL**. Tambahkan domain staging saja, misalnya `https://nama-project-staging.vercel.app` (tanpa path).
5. Pasang EA pada chart simbol yang ingin dikirim; bila ingin mengirim beberapa pair, pasang EA pada masing-masing chart. Aktifkan AutoTrading bila MT4 memerlukannya untuk menjalankan EA. EA ini tidak berisi fungsi trading.
6. Isi `ApiBaseUrl`, `BridgeSecret`, dan `BarsToSend=180`. Pastikan simbol chart sama persis dengan nilai `MT4_SYMBOL_MAP`.
7. Lihat tab Experts/Journal. Pesan `AureusDesk bridge OK` menandakan upload diterima.

### 9.5 Batasan dan cara uji
- EA dipakai hanya bila sumber MT4/Cloud-lalu-MT4 dipilih. Mode AUTO mengekstrak pair terlebih dahulu; jika pasangan belum bisa dipastikan, aplikasi tetap memakai alur screenshot.
- EA mengirim candle tertutup; interval timer dapat membuat feed beberapa menit tertinggal, terutama M5. Validasi ingest memeriksa umur candle berdasarkan timeframe (M5 20 menit, M15 45 menit, H1 3 jam, H4 10 jam, D1 3 hari, W1 15 hari). Pembacaan analisa hanya menerima snapshot yang terakhir diterima kurang dari 20 menit.
- Uji dahulu dengan XAUUSD pada akun demo: cek M5/M15/H1/H4/D1/W1 masuk ke tabel, lalu cocokkan harga candle dan bid/ask dengan MT4.
- Uji keamanan: request tanpa Bearer secret harus mendapat HTTP 401. Uji data rusak/stale harus ditolak.
- Jangan deploy ke Production sebelum build, uji staging, uji symbol mapping, dan pemeriksaan hasil SMC selesai.

### 9.6 Rollback
Untuk menonaktifkan integrasi tanpa menghapus fitur lama, hapus `SUPABASE_SERVICE_ROLE_KEY` dari environment staging atau kosongkan `MT4_SYMBOL_MAP`, lalu redeploy. Analisa screenshot lama tetap dapat digunakan.


## 10. V2 Cloud Market Data — gratis, tanpa PC

Sumber candle Cloud memakai feed publik exchange **tanpa kunci API**: Kraken (utama) dengan cadangan Binance market-data (`data-api.binance.vision`, BTCUSDT). Permintaan berjalan di server Vercel; iPhone/Android tetap dipakai seperti biasa.

### 10.1 Cakupan
- Saat ini hanya **BTCUSD**. Pair lain (emas, forex) otomatis memakai screenshot saja dengan catatan jelas.
- Tidak ada env var yang wajib. MT4 EA tetap opsional (lihat bagian 9) untuk candle broker.

### 10.2 Cara kerja
1. Pengguna mengunggah screenshot seperti V1 dan memilih pair. Untuk pair AUTO, Gemini membaca nama pair dari satu gambar (ringan, dengan model cadangan); bila gagal, analisa tetap berjalan tanpa OHLC.
2. Server mengambil candle M5/M15/H1/H4/D1/W1; M15, H1, H4 wajib. Candle yang belum tutup dibuang, data basi ditolak, hasil di-cache 60 detik per instance server.
3. Mesin SMC menghitung BOS/CHoCH, sweep, OB, FVG, dan ATR(14); ringkasannya masuk ke prompt.
4. Pengaman harga membandingkan harga screenshot dengan feed (banner PRICE MISMATCH).
5. Bila feed gagal, analisa berjalan screenshot-only dengan catatan; tidak ada entry yang dipaksakan dari data tak valid.

### 10.3 Catatan akurasi
- Feed exchange bukan harga broker; candle dan batas H4/D1/W1 dapat berbeda dari MT4 broker (mis. candle mingguan Kraken tidak sama dengan broker). Cocokkan level dengan chart broker.
- Mesin SMC deterministik, bukan strategi terbukti profit.
- Belum diuji dari server Vercel dengan data nyata sampai dijalankan oleh pengguna.
