//+------------------------------------------------------------------+
//| AureusDesk_MarketBridge.mq4  v3.0 (Headway / XAUUSD production)   |
//| Mengirim OHLC candle TERTUTUP dari server broker ke AureusDesk AI.|
//| TIDAK ADA fungsi trading: tanpa OrderSend/OrderClose/OrderModify. |
//+------------------------------------------------------------------+
#property strict
#property version     "3.00"
#property description "AureusDesk AI: pengirim OHLC candle tertutup (read-only). Tidak membuka/menutup transaksi."

//--- koneksi
input string ApiBaseUrl          = "https://aureusdesk-ai.vercel.app"; // domain production AureusDesk
input string BridgeSecret        = "PASTE_MT4_BRIDGE_SECRET_HERE";     // harus sama dengan MT4_BRIDGE_SECRET di Vercel
//--- simbol
input string SymbolOverride      = "";      // kosong = simbol chart tempat EA dipasang (Headway: XAUUSD)
input string RequireSymbolContains = "XAU"; // pengaman: EA menolak jalan di simbol lain. Kosongkan untuk menonaktifkan
//--- data
input int    BarsToSend          = 180;     // 30..500
input int    SendEverySeconds    = 60;      // interval pengecekan (detik, min 10)
input int    HeartbeatSeconds    = 240;     // kirim ulang walau candle belum berganti (jaga data tetap "fresh")
input bool   SendM5=true, SendM15=true, SendH1=true, SendH4=true, SendD1=true, SendW1=true;
//--- sinkronisasi waktu (server broker -> UTC)
input bool   AutoUtcOffset       = true;    // hitung selisih TimeCurrent()-TimeGMT() saat pasar buka
input int    ManualUtcOffsetHours = 2;      // cadangan saat pasar tutup / auto tidak valid (cek di status AureusDesk)
//--- pengaman harga
input double MaxBidCloseDiffPct  = 3.0;     // bid vs close candle tertutup (M5/M15/H1); lebih besar = PRICE MISMATCH, tidak dikirim
input bool   ShowStatusOnChart   = true;

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
   string t = "AureusDesk Bridge v3.0 | " + g_sym + " | UTC offset server " + IntegerToString(g_offsetUsed / 3600) + "j (" + g_offsetMode + ")\n";
   bool anyOk = false, anyEnabled = false;
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

   // PRICE MISMATCH: harga bid harus dekat dengan close candle tertutup (hanya TF pendek)
   if(i <= 2 && bid > 0 && lastClose > 0 && MathAbs(bid - lastClose) / lastClose * 100.0 > MaxBidCloseDiffPct)
   {
      SetStatus(i, "PRICE MISMATCH: bid " + DoubleToString(bid, digits) + " vs close " + DoubleToString(lastClose, digits) + " (tidak dikirim)");
      Print("AureusDesk PRICE MISMATCH ", g_sym, " ", g_names[i], " bid=", bid, " close=", lastClose);
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
                  + ",\"digits\":" + IntegerToString(digits) + ",\"bars\":" + bars + "}";

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
      SetStatus(i, "OK " + IntegerToString(copied) + " bar, close " + DoubleToString(lastClose, digits) + ", candle UTC " + TimeToString(newestUtc, TIME_DATE | TIME_MINUTES));
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
         Alert("AureusDesk: simbol '", g_sym, "' tidak mengandung '", RequireSymbolContains, "'. Pasang EA di chart XAUUSD Headway.");
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
   Print("AureusDesk bridge v3.0 aktif: ", g_sym, ", offset server ", g_offsetUsed / 3600, "j (", g_offsetMode, "), tanpa fungsi trading.");
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
