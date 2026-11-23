# Panduan Produksi: AureusDesk Bridge (Headway MT4, XAUUSD)

EA hanya MENGIRIM OHLC candle tertutup. Tidak ada OrderSend/OrderClose/OrderModify (tidak ada trading otomatis).

## A. Sekali saja (server)
1. Supabase: tabel `mt4_market_snapshots` sudah dibuat.
2. Vercel > Settings > Environment Variables: tambahkan `SUPABASE_SERVICE_ROLE_KEY` (Supabase > Project Settings > API > service_role). Tipe Sensitive. Lalu Redeploy.
3. `MT4_BRIDGE_SECRET`, `DISABLE_CLOUD_PROXY=1`, `MT4_SYMBOL_MAP` sudah diset.
4. Di app: Sumber Data = "MT4 EA".

## B. Pasang EA di MT4 Headway
1. File > Open Data Folder > MQL4 > Experts: salin `AureusDesk_MarketBridge.mq4`.
2. Buka MetaEditor (F4), buka file, tekan F7 (Compile). Harus 0 errors. Hasil: `.ex4`.
3. MT4: Tools > Options > Expert Advisors > centang "Allow WebRequest for listed URL", tambah `https://aureusdesk-ai.vercel.app`. Aktifkan tombol Algo/AutoTrading hanya untuk EA ini (EA tidak trading).
4. Pastikan XAUUSD ada di Market Watch (nama persis, mis. XAUUSD). Buka chart XAUUSD, drag EA ke chart.
5. Input: BridgeSecret = isi file MT4_BRIDGE_SECRET.txt. ManualUtcOffsetHours: Headway biasanya +2 (musim dingin) / +3 (musim panas AS). Biarkan AutoUtcOffset=true.

## C. Uji koneksi
1. Pojok kiri atas chart: tiap TF harus "OK ... bar, close ..., candle UTC ...". Tab Experts: "AureusDesk bridge OK".
2. Buka di browser/HTTP dengan header `x-app-pin`: `GET https://aureusdesk-ai.vercel.app/api/mt4/status?pair=XAUUSD`. Bandingkan `close` tiap TF dengan candle TERTUTUP terakhir di chart Headway (Data Window). Harus sama. `lastCandleUtc` = waktu chart dikurangi offset server.
3. Jalankan analisis dengan Sumber Data "MT4 EA". Harga harus sama dengan chart.
4. Uji gagal: matikan internet 10 menit -> di chart muncul "DATA TIDAK CUKUP"; di app, status per TF "DATA TIDAK CUKUP" dan keputusan INSUFFICIENT_DATA.

## D. Pesan error
- HTTP 401: BridgeSecret salah. err 4060: URL belum di Allow WebRequest. "PRICE MISMATCH": bid beda jauh dari close melebihi toleransi adaptif ATR/spread (maks 3%; cek simbol). "DATA TIDAK CUKUP ... UTC": offset waktu salah, atur ManualUtcOffsetHours dan AutoUtcOffset=false.
- Akhir pekan: data Jumat tetap diterima saat pasar tutup.


## Verifikasi data v3.1 (diagnostik shift 0 / shift 1)
Setelah compile (F7) dan pasang EA, buka tab **Experts**. Tiap TF (M5, M15, H1, H4, D1, W1) mencetak dua baris `AureusDesk DIAG`:
- `shift=0 (BERJALAN, tidak dikirim)` = candle yang sedang terbentuk, harus sama dengan candle paling kanan di chart.
- `shift=1 (SELESAI, dikirim)` = candle tertutup terakhir, harus sama dengan candle tepat di kirinya.
Isi baris: symbol, TF, shift, waktu bar (server dan UTC), O/H/L/C. Cocokkan dengan Data Window (Ctrl+D) di MT4.
Status per TF di chart/log: `DATA_VALID` (lolos, dikirim), `DATA_STALE` (candle kedaluwarsa, tidak dikirim), `DATA_MISMATCH` (data EA tidak cocok dengan pembacaan MT4 atau payload, tidak dikirim).
Matikan log dengan input `DiagnosticLog=false`.
