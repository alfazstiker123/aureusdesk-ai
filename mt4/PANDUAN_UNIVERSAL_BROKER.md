# Panduan EA AureusDesk Bridge v3.2 (Universal Broker, MT4)

EA ini READ-ONLY: tidak ada OrderSend/OrderClose/OrderModify, tidak mengirim password trading. Setelah mengganti file, WAJIB compile ulang (F7 di MetaEditor).

## Pasang (Headway / Exness / FBS / broker MT4 lain)
1. Salin `AureusDesk_MarketBridge.mq4` ke `MQL4/Experts`, compile (F7), restart/refresh Navigator.
2. Tools > Options > Expert Advisors > Allow WebRequest: tambahkan `https://aureusdesk-ai.vercel.app`.
3. Pasang EA di chart instrumen yang ingin dianalisis. **Simbol default = simbol chart** (XAUUSD, XAUUSDm, EURUSD.pro, USTEC, dst). Tidak ada lagi default XAU.
4. Isi `BridgeSecret` (sama dengan MT4_BRIDGE_SECRET di Vercel). Satu chart = satu instrumen; pasang di beberapa chart untuk beberapa instrumen.
5. Dua broker: jalankan MT4 masing-masing dengan EA yang sama. Data tersimpan terpisah per koneksi broker; pilih di Pengaturan → Koneksi Broker MT4 (default: kiriman terbaru).

## Yang dikirim EA
- Candle TERTUTUP OHLC, Bid/Ask/Digits.
- Koneksi: nama broker, server, mata uang akun, ID koneksi (hash dari broker|server|nomor akun|ConnectionSalt) dan 4 digit akhir akun. Nomor akun lengkap tidak dikirim.
- Spesifikasi kontrak (MarketInfo): LOTSIZE, TICKVALUE, TICKSIZE, DIGITS, POINT, MINLOT, MAXLOT, LOTSTEP, STOPLEVEL, FREEZELEVEL, SPREAD.

## Simbol tidak dikenal
Server menolak simbol yang tidak ada di registry (tidak menebak dari harga). Tambahkan lewat env Vercel `MT4_SYMBOL_MAP` = `{"XAUUSD":"GOLD.xyz"}` (kanonik → simbol broker).

## Batasan jujur
- Lot/risiko memakai spesifikasi broker hanya bila lengkap & konsisten. Jika tidak, UI menampilkan "SPESIFIKASI BROKER TIDAK TERSEDIA" dan angka hanya perkiraan.
- Akun non-USD: angka "$" = nilai dalam mata uang akun.
- Kompatibilitas Exness/FBS BELUM diuji di broker nyata; baru diuji dengan data simulasi. Uji dulu di akun demo.
- MT5: fase berikutnya.
