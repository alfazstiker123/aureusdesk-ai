#property strict
#property version "2.0"
#property description "AureusDesk AI closed-candle OHLC bridge; does not place trades"
input string ApiBaseUrl="https://YOUR-STAGING-DOMAIN.vercel.app";
input string BridgeSecret="CHANGE_TO_LONG_RANDOM_SECRET";
input int BarsToSend=180;
input int SendEverySeconds=60;
input bool SendM5=true,SendM15=true,SendH1=true,SendH4=true,SendD1=true,SendW1=true;
datetime lastSent[6];
datetime lastUpload[6];
int periods[6]={PERIOD_M5,PERIOD_M15,PERIOD_H1,PERIOD_H4,PERIOD_D1,PERIOD_W1};
string names[6]={"M5","M15","H1","H4","D1","W1"};
bool Enabled(int i){if(i==0)return SendM5;if(i==1)return SendM15;if(i==2)return SendH1;if(i==3)return SendH4;if(i==4)return SendD1;return SendW1;}
string EscapeJson(string s){StringReplace(s,"\\","\\\\");StringReplace(s,"\"","\\\"");return s;}
void SendTf(int i){
 if(!Enabled(i))return;
 MqlRates rates[];ArraySetAsSeries(rates,false);
 int copied=CopyRates(Symbol(),periods[i],1,MathMin(BarsToSend,500),rates); // shift 1: candle tertutup
 if(copied<30)return;datetime newest=rates[copied-1].time;
 // Kirim heartbeat berkala meski candle H4/D1/W1 belum berganti agar snapshot tetap fresh.
 if(newest==lastSent[i] && (TimeCurrent()-lastUpload[i])<300)return;
 string bars="[";
 for(int j=0;j<copied;j++){if(j>0)bars+=",";
  bars+="{\"time\":"+IntegerToString((int)rates[j].time)+",\"open\":"+DoubleToString(rates[j].open,Digits)
   +",\"high\":"+DoubleToString(rates[j].high,Digits)+",\"low\":"+DoubleToString(rates[j].low,Digits)
   +",\"close\":"+DoubleToString(rates[j].close,Digits)+",\"volume\":"+IntegerToString((int)rates[j].tick_volume)+"}";}
 bars+="]";
 string payload="{\"symbol\":\""+EscapeJson(Symbol())+"\",\"timeframe\":\""+names[i]+"\",\"bid\":"+DoubleToString(Bid,Digits)
  +",\"ask\":"+DoubleToString(Ask,Digits)+",\"digits\":"+IntegerToString(Digits)+",\"bars\":"+bars+"}";
 char data[],result[];string headers="Content-Type: application/json\r\nAuthorization: Bearer "+BridgeSecret+"\r\n";
 StringToCharArray(payload,data,0,WHOLE_ARRAY,CP_UTF8);ArrayResize(data,ArraySize(data)-1);
 string responseHeaders;int code=WebRequest("POST",ApiBaseUrl+"/api/mt4/market-data",headers,15000,data,result,responseHeaders);
 if(code==200){lastSent[i]=newest;lastUpload[i]=TimeCurrent();Print("AureusDesk bridge OK ",Symbol()," ",names[i]," bars=",copied);}
 else Print("AureusDesk bridge HTTP=",code," err=",GetLastError()," response=",CharArrayToString(result));
}
int OnInit(){if(StringFind(ApiBaseUrl,"https://")!=0)return INIT_PARAMETERS_INCORRECT;EventSetTimer(MathMax(10,SendEverySeconds));return INIT_SUCCEEDED;}
void OnDeinit(const int reason){EventKillTimer();}
void OnTimer(){for(int i=0;i<6;i++)SendTf(i);}
void OnTick(){/* timer-based uploader; no trading operations */}
