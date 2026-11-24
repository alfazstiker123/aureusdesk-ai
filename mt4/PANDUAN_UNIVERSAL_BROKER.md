# Panduan EA AureusDesk Bridge v3.2 (Universal Broker, MT4)

EA ini READ-ONLY: tidak ada OrderSend/OrderClose/OrderModify, tidak mengirim password trading. Setelah mengganti file, WAJIB compile ulang (F7 di MetaEditor).

## Pasang (Headway / Exness / FBS / broker MT4 lain)
1. Salin `AureusDesk_UniversalBridge_v3.2.mq4` ke `MQL4/Experts`, compile (F7), restart/refresh Navigator.
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

## Uji verifikasi spesifikasi (WAJIB sebelum memakai angka lot)
1. Compile EA (F7), pasang di chart Headway XAUUSD. Buka tab Experts: cari baris `AureusDesk SPEC ...`.
2. Klik kanan simbol di Market Watch > Specification. Cocokkan: contract size, tick value, tick size, point, lot min/max/step, mata uang akun.
3. Cek angka "tickvalue/ticksize": untuk akun USD dan kuotasi USD harus sama dengan contract size (XAUUSD 100, EURUSD 100000). Jika tidak sama, server menandai spesifikasi TIDAK VALID dan menampilkan peringatan (angka lot jadi perkiraan).
4. Pengaturan → Koneksi Broker MT4 → Muat: harus tampil "spek ✓".
5. Ulangi untuk EURUSD, lalu instrumen lain di akun demo.
Catatan satuan: dokumentasi MQL4 lama menulis MODE_TICKSIZE "in points", tetapi di terminal nyata nilainya umumnya dalam HARGA (mis. 0.00001, 0.01, indeks 0.5). Server memakai satuan harga dan memverifikasinya terhadap contract size; kalau di Headway ternyata berbeda, kirim baris `AureusDesk SPEC` dari tab Experts agar bisa dikoreksi.

## Lot di bawah minimum broker
Jika anggaran risiko tidak cukup untuk lot minimum broker, order DIBATALKAN (NO TRADE), tidak dinaikkan ke lot minimum.
