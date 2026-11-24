import { NextResponse } from "next/server";
import { requirePin } from "@/lib/auth";
import { marketStatus, mt4SymbolForPair } from "@/lib/mt4Market";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/mt4/status?pair=XAUUSD  (header x-app-pin). Bandingkan angka ini dengan chart Headway.
export async function GET(req) {
  const denied = requirePin(req);
  if (denied) return denied;
  const pair = String(new URL(req.url).searchParams.get("pair") || "XAUUSD").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  const symbol = mt4SymbolForPair(pair);
  const st = await marketStatus(symbol, pair);
  return NextResponse.json({ symbol, cloudProxyDisabled: process.env.DISABLE_CLOUD_PROXY === "1", ...st });
}
