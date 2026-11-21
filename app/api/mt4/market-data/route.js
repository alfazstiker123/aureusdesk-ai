import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { validateMarketPayload, storeMarketSnapshot } from "@/lib/mt4Market";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req) {
  const secret=String(process.env.MT4_BRIDGE_SECRET||"");
  const supplied=String(req.headers.get("authorization")||"").replace(/^Bearer\s+/i, "");
  const a=Buffer.from(secret), b=Buffer.from(supplied);
  if(!secret || a.length!==b.length || !timingSafeEqual(a,b))
    return NextResponse.json({error:"Unauthorized bridge."},{status:401});
  try {
    const size=Number(req.headers.get("content-length")||0);
    if(size>2_000_000) return NextResponse.json({error:"Payload terlalu besar."},{status:413});
    const raw=await req.text();
    if(raw.length>2_000_000) return NextResponse.json({error:"Payload terlalu besar."},{status:413});
    const snapshot=validateMarketPayload(JSON.parse(raw)); await storeMarketSnapshot(snapshot);
    return NextResponse.json({ok:true,symbol:snapshot.symbol,timeframe:snapshot.timeframe,bars:snapshot.bars.length});
  } catch(e) { return NextResponse.json({error:e.message||"Payload ditolak."},{status:400}); }
}
