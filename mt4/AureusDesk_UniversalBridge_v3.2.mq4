//+------------------------------------------------------------------+
//| AureusDesk_UniversalBridge_v3.2.mq4  v3.2 (Universal Broker, MT4)         |
//| Mengirim OHLC candle TERTUTUP dari server broker ke AureusDesk AI.|
//| TIDAK ADA fungsi trading: tanpa OrderSend/OrderClose/OrderModify. |
//+------------------------------------------------------------------+
#property strict
#property version     "3.20"
#property description "AureusDesk Universal Bridge v3.2 - pengirim OHLC candle tertutup (read-only). Tidak membuka/menutup transaksi."

//--- koneksi
input string ApiBaseUrl          = "https://aureusdesk-ai.vercel.app"; // domain production AureusDesk
input string BridgeSecret        = "PASTE_MT4_BRIDGE_SECRET_HERE";     // harus sama dengan MT4_BRIDGE_SECRET di Vercel
//--- simbol
input string SymbolOverride      = "";      // kosong = simbol chart tempat EA dipasang (mis. XAUUSD, XAUUSDm, EURUSD.pro, USTEC)
input string RequireSymbolContains = "";    // opsional pengaman: bila diisi, EA hanya jalan di simbol yang mengandung teks ini. Default kosong (semua instrumen)
input string ConnectionSalt      = "";      // opsional: teks rahasia tambahan untuk ID koneksi (agar ID tidak bisa ditebak dari nomor akun)
//--- data
input int    BarsToSend          = 180;     // 30..500
input int    SendEverySeconds    = 60;      // interval pengecekan (detik, min 10)
input int    HeartbeatSeconds    = 240;     // kirim ulang walau candle belum berganti (jaga data tetap "fresh")
input bool   SendM5=true, SendM15=true, SendH1=true, SendH4=true, SendD1=true, SendW1=true;
//--- sinkronisasi waktu (server broker -> UTC)
input bool   AutoUtcOffset       = true;    // hitung selisih TimeCurrent()-TimeGMT() saat pasar buka
input int    ManualUtcOffsetHours = 2;      // cadangan saat pasar tutup / auto tidak valid (cek di status AureusDesk)
//--- pengaman harga
input double MaxBidCloseDiffPct  = 3.0;     // BATAS KERAS bid vs close (anti salah simbol). Toleransi sebenarnya adaptif: max(4xATR14, 10xspread, 0.05%)
input bool   ShowStatusOnChart   = true;
//--- diagnostik (verifikasi data vs chart MT4)
input bool   DiagnosticLog       = true;    // log SHIFT 0 (berjalan) & SHIFT 1 (selesai) tiap TF di tab Experts, saat init & tiap kirim

#define TF_COUNT 6
int      g_periods[TF_COUNT] = {PERIOD_M5, PERIOD_M15, PERIOD_H1, PERIOD_H4, PERIOD_D1, PERIOD_W1};
string   g_names[TF_COUNT]   = {"M5", "M15", "H1", "H4", "D1", "W1"};
datetime g_lastBar[TF_COUNT];      // candle terakhir yang sukses terkirim (waktu UTC)
datetime g_lastUpload[TF_COUNT];   // waktu LOKAL PC saat terakhir sukses (timer tetap jalan walau tanpa tick)
string   g_status[TF_COUNT];
string   g_sym = "";
int      g_lastGoodOffset = 0;
bool     g_haveGoodOffset = false;
int      g_offsetUsed = 0;
string   g_offsetMode = "";

bool Enabled(int i)
{
   switch(i)
   {
      case 0: return SendM5;
      case 1: return SendM15;
      case 2: return SendH1;
      case 3: return SendH4;
      case 4: return SendD1;
   }
   return SendW1;
}

string EscapeJson(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return s;
}

//--- selisih waktu server broker terhadap UTC (detik).
//    Valid bila tick masih baru: selisih mendekati kelipatan 15 menit (toleransi 90 dtk).
int ServerUtcOffsetSec()
{
   int manual = ManualUtcOffsetHours * 3600;
   if(!AutoUtcOffset)
   {
      g_offsetMode = "manual";
      return manual;
   }
   int raw     = (int)(TimeCurrent() - TimeGMT());
   int rounded = (int)MathRound(raw / 900.0) * 900;
   if(MathAbs(raw - rounded) <= 90 && rounded >= -12 * 3600 && rounded <= 14 * 3600)
   {
      g_lastGoodOffset = rounded;
      g_haveGoodOffset = true;
      g_offsetMode = "auto";
      return rounded;
   }
   if(g_haveGoodOffset)
   {
      g_offsetMode = "auto(tersimpan)";
      return g_lastGoodOffset;
   }
   g_offsetMode = "manual(pasar tutup)";
   return manual;
}

void SetStatus(int i, string s)
{
   g_status[i] = s;
}

void ShowStatus()
{
   if(!ShowStatusOnChart) return;
   string t = "AureusDesk Universal Bridge v3.2 | " + g_sym + " | UTC offset server " + IntegerToString(g_offsetUsed / 3600) + "j (" + g_offsetMode + ")\n";
   bool anyOk = false, anyEnabled = false;
   // Diagnostik spesifikasi: cocokkan dengan Specification simbol di MT4 (klik kanan Market Watch > Specification)
   {
      double dTv = MarketInfo(g_sym, MODE_TICKVALUE), dTs = MarketInfo(g_sym, MODE_TICKSIZE);
      string implied = (dTs > 0) ? DoubleToString(dTv / dTs, 4) : "n/a";
      Print("AureusDesk SPEC ", g_sym, " | akun ", AccountCurrency(), " | lotsize=", DoubleToString(MarketInfo(g_sym, MODE_LOTSIZE), 2),
            " tickvalue=", DoubleToString(dTv, 8), " ticksize=", DoubleToString(dTs, 8), " point=", DoubleToString(MarketInfo(g_sym, MODE_POINT), 8),
            " digits=", (int)MarketInfo(g_sym, MODE_DIGITS), " minlot=", DoubleToString(MarketInfo(g_sym, MODE_MINLOT), 4),
            " maxlot=", DoubleToString(MarketInfo(g_sym, MODE_MAXLOT), 2), " lotstep=", DoubleToString(MarketInfo(g_sym, MODE_LOTSTEP), 4),
            " | nilai per 1.0 harga per lot (tickvalue/ticksize)=", implied);
   }
   for(int i = 0; i < TF_COUNT; i++)
   {
      if(!Enabled(i)) continue;
      anyEnabled = true;
      if(g_lastUpload[i] > 0 && (TimeLocal() - g_lastUpload[i]) <= 3 * MathMax(HeartbeatSeconds, SendEverySeconds)) anyOk = true;
      t += g_names[i] + ": " + g_status[i] + "\n";
   }
   if(anyEnabled && !anyOk) t += ">>> DATA TIDAK CUKUP: tidak ada kiriman sukses baru (cek koneksi / Allow WebRequest / secret).\n";
   Comment(t);
}


//--- ATR(14) dari candle tertutup yang sudah disalin (urutan lama -> baru)
double Atr14(MqlRates &r[], int n)
{
   if(n < 15) return 0;
   double sum = 0;
   for(int k = n - 14; k < n; k++)
      sum += MathMax(r[k].high - r[k].low, MathMax(MathAbs(r[k].high - r[k-1].close), MathAbs(r[k].low - r[k-1].close)));
   return sum / 14.0;
}

//--- toleransi |bid - close tertutup| (satuan harga): adaptif ATR + spread, dibatasi MaxBidCloseDiffPct
double BidCloseTolerance(MqlRates &r[], int n, double bid, double ask, int tfIdx)
{
   double close  = r[n - 1].close;
   double spread = (ask >= bid && bid > 0) ? ask - bid : 0;
   double tol    = MathMax(4.0 * Atr14(r, n), MathMax(10.0 * spread, close * 0.05 / 100.0));
   double tfSec  = PeriodSeconds(g_periods[tfIdx]);
   double ageSec = (double)(TimeCurrent() - r[n - 1].time);
   double f      = ageSec / tfSec / 2.0;
   if(f > 1.0) tol *= MathSqrt(f);
   return MathMin(tol, close * MaxBidCloseDiffPct / 100.0);
}


//=== DIAGNOSTIK & VERIFIKASI DATA ==================================
//    SHIFT 0 = candle berjalan (TIDAK dikirim). SHIFT 1 = candle terakhir yang sudah selesai (dikirim).
//    Dibaca lewat iTime/iOpen/iHigh/iLow/iClose = sumber INDEPEN dari CopyRates yang dipakai untuk payload,
//    sehingga selisih keduanya terdeteksi sebagai DATA_MISMATCH.
#define DATA_VALID    "DATA_VALID"
#define DATA_STALE    "DATA_STALE"
#define DATA_MISMATCH "DATA_MISMATCH"

int MaxAgeMinutes(int i)
{
   switch(i)
   {
      case 0: return 20;      // M5
      case 1: return 45;      // M15
      case 2: return 180;     // H1
      case 3: return 600;     // H4
      case 4: return 7200;    // D1
   }
   return 21600;              // W1 (sama dengan server: lib/mt4Market.js)
}

void LogShift(int i, int shift, datetime t, double o, double h, double l, double c, int digits, int off)
{
   Print("AureusDesk DIAG | symbol=", g_sym, " | tf=", g_names[i], " | shift=", shift, (shift == 0 ? " (BERJALAN, tidak dikirim)" : " (SELESAI, dikirim)"),
         " | bar=", TimeToString(t, TIME_DATE | TIME_SECONDS), " server / ", TimeToString(t - off, TIME_DATE | TIME_SECONDS), " UTC",
         " | O=", DoubleToString(o, digits), " H=", DoubleToString(h, digits), " L=", DoubleToString(l, digits), " C=", DoubleToString(c, digits));
}

string BarFragment(datetime tUtc, double o, double h, double l, double c, int digits)
{
   return "{\"time\":" + IntegerToString((int)tUtc) + ",\"open\":" + DoubleToString(o, digits) + ",\"high\":" + DoubleToString(h, digits)
        + ",\"low\":" + DoubleToString(l, digits) + ",\"close\":" + DoubleToString(c, digits) + ",";
}

//--- verifikasi satu TF. r[] = hasil CopyRates (lama -> baru, mulai shift 1). Mengembalikan DATA_VALID / DATA_STALE / DATA_MISMATCH.
//    D1/W1: tidak membandingkan close antar-TF; hanya timestamp & OHLC candle masing-masing.
string DiagCheck(int i, MqlRates &r[], int n, int off, int digits, string &detail)
{
   int per = g_periods[i];
   detail = "";
   datetime t0 = iTime(g_sym, per, 0), t1 = iTime(g_sym, per, 1);
   double o0 = iOpen(g_sym, per, 0), h0 = iHigh(g_sym, per, 0), l0 = iLow(g_sym, per, 0), c0 = iClose(g_sym, per, 0);
   double o1 = iOpen(g_sym, per, 1), h1 = iHigh(g_sym, per, 1), l1 = iLow(g_sym, per, 1), c1 = iClose(g_sym, per, 1);
   if(DiagnosticLog)
   {
      LogShift(i, 0, t0, o0, h0, l0, c0, digits, off);
      LogShift(i, 1, t1, o1, h1, l1, c1, digits, off);
   }
   double eps = MathPow(10.0, -digits) * 0.5;
   if(t0 <= 0 || t1 <= 0) detail = "iTime kosong (riwayat belum termuat)";
   else if(t0 <= t1) detail = "timestamp shift0 <= shift1";
   else if(n < 1 || r[n - 1].time != t1) detail = "CopyRates terbaru (" + TimeToString(r[n - 1].time, TIME_DATE | TIME_MINUTES) + ") != iTime shift1 (" + TimeToString(t1, TIME_DATE | TIME_MINUTES) + ")";
   else if(r[n - 1].time >= t0) detail = "candle berjalan ikut terbaca di data kirim";
   else if(MathAbs(r[n - 1].open - o1) > eps || MathAbs(r[n - 1].high - h1) > eps || MathAbs(r[n - 1].low - l1) > eps || MathAbs(r[n - 1].close - c1) > eps)
      detail = "OHLC CopyRates != iOpen/iHigh/iLow/iClose shift1";
   else if(h1 < MathMax(o1, MathMax(c1, l1)) - eps || l1 > MathMin(o1, MathMin(c1, h1)) + eps || MathMin(MathMin(o1, h1), MathMin(l1, c1)) <= 0)
      detail = "integritas OHLC shift1 gagal";
   if(detail != "") { if(DiagnosticLog) Print("AureusDesk DIAG | ", g_names[i], " ", DATA_MISMATCH, ": ", detail); return DATA_MISMATCH; }

   // kedaluwarsa: sama dengan server (umur dihitung dari jam NYATA, bukan TimeCurrent yang beku saat pasar tutup)
   datetime nowSrv = TimeGMT() + off;
   long ageMin = (long)(nowSrv - t1) / 60;
   long maxAge = MaxAgeMinutes(i);
   bool quietMarket = (nowSrv - TimeCurrent()) > 600; // tidak ada tick baru >10 menit: pasar tutup / jeda
   if(quietMarket && (StringFind(g_sym, "XAU") == 0 || StringFind(g_sym, "XAG") == 0)) maxAge = MathMax(maxAge, 80 * 60);
   if(ageMin > maxAge || ageMin < -5)
   {
      detail = "umur candle shift1 " + IntegerToString((int)ageMin) + " mnt > batas " + IntegerToString((int)maxAge) + " mnt";
      if(DiagnosticLog) Print("AureusDesk DIAG | ", g_names[i], " ", DATA_STALE, ": ", detail);
      return DATA_STALE;
   }
   return DATA_VALID;
}

//--- payload harus memuat persis candle shift1 hasil iXxx (dan TIDAK memuat candle shift0)
string PayloadCheck(int i, string payload, int off, int digits)
{
   int per = g_periods[i];
   datetime t0 = iTime(g_sym, per, 0), t1 = iTime(g_sym, per, 1);
   string want = BarFragment(t1 - off, iOpen(g_sym, per, 1), iHigh(g_sym, per, 1), iLow(g_sym, per, 1), iClose(g_sym, per, 1), digits);
   if(StringFind(payload, want) < 0) return "payload tidak memuat candle shift1 persis seperti dibaca EA";
   if(StringFind(payload, "{\"time\":" + IntegerToString((int)(t0 - off)) + ",") >= 0) return "payload memuat candle berjalan (shift0)";
   if(StringFind(payload, "\"timeframe\":\"" + g_names[i] + "\"") < 0) return "timeframe payload salah";
   return "";
}

//--- kirim satu timeframe. Mengembalikan true bila sukses.
bool SendTf(int i)
{
   if(!Enabled(i)) return true;

   int want = MathMax(30, MathMin(BarsToSend, 500));
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(g_sym, g_periods[i], 1, want, rates); // mulai shift 1 = hanya candle TERTUTUP
   if(copied < 30)
   {
      SetStatus(i, "riwayat belum cukup (" + IntegerToString(copied) + " bar). Buka chart TF ini sekali agar MT4 mengunduh riwayat.");
      Print("AureusDesk ", g_names[i], ": CopyRates=", copied, " err=", GetLastError());
      return false;
   }

   int      off       = g_offsetUsed;
   datetime newestUtc = rates[copied - 1].time - off;
   if(newestUtc == g_lastBar[i] && (TimeLocal() - g_lastUpload[i]) < HeartbeatSeconds) return true; // belum perlu kirim ulang

   int    digits = (int)MarketInfo(g_sym, MODE_DIGITS);
   double bid    = MarketInfo(g_sym, MODE_BID);
   double ask    = MarketInfo(g_sym, MODE_ASK);
   double lastClose = rates[copied - 1].close;

   // Verifikasi data (shift0/shift1) sebelum kirim; MISMATCH/STALE tidak dikirim
   string vDetail = "";
   string verdict = DiagCheck(i, rates, copied, off, digits, vDetail);
   if(verdict != DATA_VALID)
   {
      SetStatus(i, verdict + ": " + vDetail + " (tidak dikirim)");
      Print("AureusDesk ", verdict, " ", g_sym, " ", g_names[i], ": ", vDetail);
      return false;
   }

   // PRICE MISMATCH: harga bid harus dekat dengan close candle tertutup (hanya TF pendek)
   double tolPx = (i <= 2 && bid > 0 && lastClose > 0) ? BidCloseTolerance(rates, copied, bid, ask, i) : 0;
   if(tolPx > 0 && MathAbs(bid - lastClose) > tolPx)
   {
      SetStatus(i, "PRICE MISMATCH: bid " + DoubleToString(bid, digits) + " vs close " + DoubleToString(lastClose, digits) + " (selisih > toleransi ATR/spread " + DoubleToString(tolPx, digits) + ", tidak dikirim)");
      Print("AureusDesk PRICE MISMATCH ", g_sym, " ", g_names[i], " bid=", bid, " close=", lastClose, " tol=", tolPx);
      return false;
   }

   string bars = "[";
   for(int j = 0; j < copied; j++)
   {
      if(j > 0) bars += ",";
      bars += "{\"time\":" + IntegerToString((int)(rates[j].time - off))
           + ",\"open\":"   + DoubleToString(rates[j].open, digits)
           + ",\"high\":"   + DoubleToString(rates[j].high, digits)
           + ",\"low\":"    + DoubleToString(rates[j].low, digits)
           + ",\"close\":"  + DoubleToString(rates[j].close, digits)
           + ",\"volume\":" + IntegerToString((int)rates[j].tick_volume) + "}";
   }
   bars += "]";

   string payload = "{\"symbol\":\"" + EscapeJson(g_sym) + "\",\"timeframe\":\"" + g_names[i] + "\""
                  + ",\"bid\":" + DoubleToString(bid, digits) + ",\"ask\":" + DoubleToString(ask, digits)
                  + ",\"digits\":" + IntegerToString(digits) + ",\"conn\":" + ConnJson() + ",\"spec\":" + SpecJson() + ",\"bars\":" + bars + "}";

   string pErr = PayloadCheck(i, payload, off, digits);
   if(pErr != "")
   {
      SetStatus(i, DATA_MISMATCH + ": " + pErr + " (tidak dikirim)");
      Print("AureusDesk ", DATA_MISMATCH, " ", g_sym, " ", g_names[i], ": ", pErr);
      return false;
   }

   char   data[], result[];
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + BridgeSecret + "\r\n";
   StringToCharArray(payload, data, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(data, ArraySize(data) - 1); // buang terminator null
   string responseHeaders;
   ResetLastError();
   int code = WebRequest("POST", ApiBaseUrl + "/api/mt4/market-data", headers, 15000, data, result, responseHeaders);
   if(code == 200)
   {
      g_lastBar[i]    = newestUtc;
      g_lastUpload[i] = TimeLocal();
      SetStatus(i, DATA_VALID + " | OK " + IntegerToString(copied) + " bar, close " + DoubleToString(lastClose, digits) + ", candle UTC " + TimeToString(newestUtc, TIME_DATE | TIME_MINUTES));
      Print("AureusDesk bridge OK ", g_sym, " ", g_names[i], " bars=", copied, " lastClose=", DoubleToString(lastClose, digits));
      return true;
   }
   int err = GetLastError();
   string body = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(code == -1 && err == 4060)
      SetStatus(i, "URL belum diizinkan: Tools > Options > Expert Advisors > Allow WebRequest, tambahkan " + ApiBaseUrl);
   else if(code == 401)
      SetStatus(i, "HTTP 401: BridgeSecret tidak sama dengan MT4_BRIDGE_SECRET di Vercel");
   else
      SetStatus(i, "GAGAL HTTP=" + IntegerToString(code) + " err=" + IntegerToString(err) + " " + StringSubstr(body, 0, 120));
   Print("AureusDesk bridge GAGAL ", g_sym, " ", g_names[i], " HTTP=", code, " err=", err, " response=", body);
   return false;
}

void SendAll()
{
   g_offsetUsed = ServerUtcOffsetSec();
   for(int i = 0; i < TF_COUNT; i++) SendTf(i);
   ShowStatus();
}

//--- Universal Broker: identitas koneksi aman + spesifikasi kontrak (hanya MarketInfo/Account info; TIDAK pernah mengirim password)
string Hash64(string t)
{
   uint h1 = 5381, h2 = 52711;
   for(int k = 0; k < StringLen(t); k++)
   {
      uint ch = (uint)StringGetChar(t, k);
      h1 = h1 * 33 + ch;
      h2 = (h2 * 31) ^ (ch + (uint)k);
   }
   return StringFormat("%08x%08x", h1, h2);
}
string ConnJson();
string SpecJson();
string g_connJson = "";
string ConnJson()
{
   if(g_connJson != "") return g_connJson;
   string acc = IntegerToString(AccountNumber());
   string mask = (StringLen(acc) > 4) ? "****" + StringSubstr(acc, StringLen(acc) - 4) : "****";
   string id = Hash64(AccountCompany() + "|" + AccountServer() + "|" + acc + "|" + ConnectionSalt) + Hash64(ConnectionSalt + "#" + acc + "#" + AccountServer());
   g_connJson = "{\"id\":\"" + id + "\",\"broker\":\"" + EscapeJson(AccountCompany()) + "\",\"server\":\"" + EscapeJson(AccountServer())
              + "\",\"ccy\":\"" + EscapeJson(AccountCurrency()) + "\",\"platform\":\"MT4\",\"mask\":\"" + mask + "\"}";
   return g_connJson;
}
string SpecJson()
{
   int dg = (int)MarketInfo(g_sym, MODE_DIGITS);
   return "{\"lotsize\":" + DoubleToString(MarketInfo(g_sym, MODE_LOTSIZE), 2)
        + ",\"tickvalue\":" + DoubleToString(MarketInfo(g_sym, MODE_TICKVALUE), 8)
        + ",\"ticksize\":" + DoubleToString(MarketInfo(g_sym, MODE_TICKSIZE), 8)
        + ",\"digits\":" + IntegerToString(dg)
        + ",\"point\":" + DoubleToString(MarketInfo(g_sym, MODE_POINT), 8)
        + ",\"minlot\":" + DoubleToString(MarketInfo(g_sym, MODE_MINLOT), 4)
        + ",\"maxlot\":" + DoubleToString(MarketInfo(g_sym, MODE_MAXLOT), 2)
        + ",\"lotstep\":" + DoubleToString(MarketInfo(g_sym, MODE_LOTSTEP), 4)
        + ",\"stoplevel\":" + DoubleToString(MarketInfo(g_sym, MODE_STOPLEVEL), 0)
        + ",\"freezelevel\":" + DoubleToString(MarketInfo(g_sym, MODE_FREEZELEVEL), 0)
        + ",\"spread\":" + DoubleToString(MarketInfo(g_sym, MODE_SPREAD), 0)
        + ",\"accountCurrency\":\"" + EscapeJson(AccountCurrency()) + "\"}";
}

int OnInit()
{
   if(StringFind(ApiBaseUrl, "https://") != 0)
   {
      Alert("AureusDesk: ApiBaseUrl harus diawali https://");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(StringLen(BridgeSecret) < 16 || StringFind(BridgeSecret, "PASTE_") == 0)
   {
      Alert("AureusDesk: isi BridgeSecret dengan nilai MT4_BRIDGE_SECRET dari Vercel.");
      return INIT_PARAMETERS_INCORRECT;
   }
   g_sym = (StringLen(SymbolOverride) > 0) ? SymbolOverride : Symbol();
   if(StringLen(RequireSymbolContains) > 0)
   {
      string up = g_sym;
      StringToUpper(up);
      string need = RequireSymbolContains;
      StringToUpper(need);
      if(StringFind(up, need) < 0)
      {
         Alert("AureusDesk: simbol '", g_sym, "' tidak mengandung '", RequireSymbolContains, "'. Pasang EA di chart instrumen yang sesuai.");
         return INIT_PARAMETERS_INCORRECT;
      }
   }
   if(!SymbolSelect(g_sym, true) || MarketInfo(g_sym, MODE_BID) <= 0)
      Print("AureusDesk PERINGATAN: simbol ", g_sym, " belum punya harga di Market Watch (pasar tutup atau nama simbol salah).");
   for(int i = 0; i < TF_COUNT; i++)
   {
      g_lastBar[i] = 0;
      g_lastUpload[i] = 0;
      g_status[i] = "menunggu pengiriman pertama";
   }
   g_offsetUsed = ServerUtcOffsetSec();
   EventSetTimer(MathMax(10, SendEverySeconds));
   if(DiagnosticLog)
   {
      for(int k = 0; k < TF_COUNT; k++)
      {
         if(!Enabled(k)) continue;
         MqlRates rr[];
         ArraySetAsSeries(rr, false);
         int cc = CopyRates(g_sym, g_periods[k], 1, 40, rr);
         int dg = (int)MarketInfo(g_sym, MODE_DIGITS);
         string dd = "";
         if(cc >= 1)
         {
            string vv = DiagCheck(k, rr, cc, g_offsetUsed, dg, dd);
            Print("AureusDesk DIAG INIT | ", g_names[k], " => ", vv, (dd != "" ? " (" + dd + ")" : ""));
         }
         else Print("AureusDesk DIAG INIT | ", g_names[k], ": CopyRates=", cc, " (buka chart TF ini sekali agar riwayat termuat)");
      }
   }
   Print("AureusDesk Universal Bridge v3.2 aktif: ", g_sym, ", offset server ", g_offsetUsed / 3600, "j (", g_offsetMode, "), tanpa fungsi trading.");
   ShowStatus();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}

void OnTimer()
{
   SendAll();
}

void OnTick()
{
   // Sengaja kosong: pengiriman berbasis timer. Tidak ada operasi trading.
}
