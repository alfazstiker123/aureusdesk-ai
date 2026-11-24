import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const d = mkdtempSync(join(tmpdir(), "mt4-"));
cpSync("lib/mt4Market.js", join(d, "mt4Market.js"));
cpSync("lib/instruments.js", join(d, "instruments.js"));
cpSync("lib/brokerSpec.js", join(d, "brokerSpec.js"));
cpSync("lib/pairs.js", join(d, "pairs.js"));
cpSync("lib/marketTime.js", join(d, "marketTime.js"));
cpSync("lib/marketTime.js", join(d, "marketTime.js"));
const { validateMarketPayload, summarizeSnapshots } = await import(pathToFileURL(join(d, "mt4Market.js")).href);

// Selasa 2026-06-02 10:00 UTC: pasar logam buka
const OPEN = Date.UTC(2026, 5, 2, 10, 5);
const SAT = Date.UTC(2026, 5, 6, 12, 0); // Sabtu siang: tutup
function mk(endMs, step, close = 4000) {
  const bars = [];
  for (let i = 0; i < 40; i++) {
    const t = Math.floor(endMs / 1000) - (39 - i) * step;
    bars.push({ time: t, open: close, high: close + 2, low: close - 2, close, volume: 5 });
  }
  return bars;
}
function withNow(ms, fn) {
  const real = Date.now; Date.now = () => ms;
  try { return fn(); } finally { Date.now = real; }
}

test("payload segar + bid dekat close diterima", () => {
  withNow(OPEN, () => {
    const r = validateMarketPayload({ symbol: "XAUUSD", timeframe: "M5", bid: 4001, ask: 4001.3, digits: 2, bars: mk(OPEN - 300000, 300) });
    assert.equal(r.symbol, "XAUUSD");
  });
});
test("PRICE MISMATCH ditolak", () => {
  withNow(OPEN, () => {
    assert.throws(() => validateMarketPayload({ symbol: "XAUUSD", timeframe: "M15", bid: 4300, bars: mk(OPEN - 900000, 900) }), /PRICE MISMATCH/);
  });
});
test("waktu server (UTC+3 tanpa konversi) ditolak sebagai masa depan", () => {
  withNow(OPEN, () => {
    assert.throws(() => validateMarketPayload({ symbol: "XAUUSD", timeframe: "M5", bid: 4000, bars: mk(OPEN - 300000 + 3 * 3600e3, 300) }), /DATA TIDAK CUKUP/);
  });
});
test("candle basi saat pasar buka ditolak", () => {
  withNow(OPEN, () => {
    assert.throws(() => validateMarketPayload({ symbol: "XAUUSD", timeframe: "M5", bars: mk(OPEN - 3 * 3600e3, 300) }), /DATA TIDAK CUKUP/);
  });
});
test("akhir pekan: candle Jumat tetap diterima untuk XAUUSD, tidak untuk simbol lain", () => {
  const fri = Date.UTC(2026, 5, 5, 21, 0);
  withNow(SAT, () => {
    assert.ok(validateMarketPayload({ symbol: "XAUUSD", timeframe: "M5", bid: 4000, bars: mk(fri, 300) }));
    assert.throws(() => validateMarketPayload({ symbol: "BTCUSD", timeframe: "M5", bars: mk(fri, 300) }), /DATA TIDAK CUKUP/);
  });
});
test("summarizeSnapshots menandai kiriman terhenti", () => {
  const now = Date.now();
  const rows = summarizeSnapshots([
    { timeframe: "H1", bars: mk(now, 3600), bid: 1, ask: 1, received_at: new Date(now - 60e3).toISOString() },
    { timeframe: "M5", bars: mk(now, 300), bid: 1, ask: 1, received_at: new Date(now - 40 * 60e3).toISOString() },
  ], now);
  assert.equal(rows[0].timeframe, "M5");
  assert.match(rows[0].status, /DATA TIDAK CUKUP/);
  assert.equal(rows[1].status, "OK");
});
