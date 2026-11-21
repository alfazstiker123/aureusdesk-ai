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
