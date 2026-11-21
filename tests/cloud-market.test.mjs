import test from 'node:test';
import assert from 'node:assert/strict';
import { getCloudMarketSnapshots, cloudSupports, _clearCloudCache } from '../lib/cloudMarket.js';

const intervals = { 5: 300, 15: 900, 60: 3600, 240: 14400, 1440: 86400, 10080: 604800 };

function krakenRows(min, now, withOpen = true) {
  const step = intervals[min];
  const last = Math.floor(now / step) * step; // candle berjalan (belum tutup)
  const rows = Array.from({ length: 60 }, (_, i) => {
    const t = last - (59 - i) * step;
    const p = 60000 + i * 5;
    return [t, String(p), String(p + 20), String(p - 20), String(p + 10), String(p), '1.5', 10];
  });
  return rows;
}

test('Kraken: normalisasi, buang candle berjalan, wajib M15/H1/H4', async () => {
  const oldFetch = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    assert.equal(u.hostname, 'api.kraken.com');
    const min = Number(u.searchParams.get('interval'));
    return new Response(JSON.stringify({ error: [], result: { XXBTZUSD: krakenRows(min, now), last: now } }), { status: 200 });
  };
  try {
    const r = await getCloudMarketSnapshots('BTCUSD');
    assert.equal(r.provider, 'Kraken');
    const tfs = new Set(r.snapshots.map((s) => s.timeframe));
    for (const k of ['M15', 'H1', 'H4']) assert.ok(tfs.has(k));
    for (const s of r.snapshots) {
      const step = intervals[{ M5: 5, M15: 15, H1: 60, H4: 240, D1: 1440, W1: 10080 }[s.timeframe]];
      assert.ok(s.bars.every((b, i, a) => i === 0 || b.time > a[i - 1].time));
      assert.ok(s.bars.at(-1).time + step <= now, 'candle terakhir harus sudah tutup');
      assert.equal(s.source, 'KRAKEN');
    }
  } finally { globalThis.fetch = oldFetch; }
});

test('Kraken gagal -> cadangan Binance; pair tak didukung ditolak jelas', async () => {
  const oldFetch = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const bin = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.kraken.com') return new Response(JSON.stringify({ error: ['EService:Unavailable'] }), { status: 200 });
    const step = bin[u.searchParams.get('interval')];
    const last = Math.floor(now / step) * step;
    const rows = Array.from({ length: 80 }, (_, i) => {
      const t = (last - (79 - i) * step) * 1000, p = 60000 + i;
      return [t, String(p), String(p + 9), String(p - 9), String(p + 3), '2'];
    });
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  try {
    // cache set sebelumnya berlaku 60 dtk; pakai pair yang sama hanya lewat jam baru -> panggil dengan cache bersih
    _clearCloudCache();
    const r = await getCloudMarketSnapshots('BTCUSD');
    assert.ok(r.provider.startsWith('Binance'));
    assert.ok(r.snapshots.every((s) => s.source === 'BINANCE'));
    // cache 60 detik: panggilan kedua tidak memukul jaringan lagi
    let calls = 0; const f = globalThis.fetch; globalThis.fetch = async (...a) => { calls++; return f(...a); };
    await getCloudMarketSnapshots('BTCUSD'); assert.equal(calls, 0);
    assert.equal(cloudSupports('XAUUSD'), false);
    await assert.rejects(() => getCloudMarketSnapshots('XAUUSD'), /belum punya sumber data gratis/);
  } finally { globalThis.fetch = oldFetch; }
});

test('MN: disusun dari candle harian Kraken, bulan tidak lengkap dan bulan berjalan dibuang', async () => {
  const oldFetch = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname !== 'api.kraken.com') return new Response('x', { status: 500 });
    const min = Number(u.searchParams.get('interval'));
    const step = intervals[min];
    const last = Math.floor(now / step) * step;
    const n = min === 1440 ? 720 : 60;
    const rows = Array.from({ length: n }, (_, i) => { const t = last - (n - 1 - i) * step, p = 50000 + i * 3; return [t, String(p), String(p + 20), String(p - 20), String(p + 10), String(p), '1.5', 10]; });
    return new Response(JSON.stringify({ error: [], result: { XXBTZUSD: rows, last: now } }), { status: 200 });
  };
  try {
    _clearCloudCache();
    const r = await getCloudMarketSnapshots('BTCUSD');
    const mn = r.snapshots.find((s) => s.timeframe === 'MN');
    assert.ok(mn, 'MN harus ada');
    assert.ok(mn.bars.length >= 18 && mn.bars.length <= 24);
    const d = (t) => new Date(t * 1000);
    for (const b of mn.bars) assert.equal(d(b.time).getUTCDate(), 1);
    const lastB = d(mn.bars.at(-1).time);
    const cur = new Date();
    assert.ok(lastB.getUTCFullYear() * 12 + lastB.getUTCMonth() < cur.getUTCFullYear() * 12 + cur.getUTCMonth(), 'bulan berjalan tidak boleh ikut');
  } finally { globalThis.fetch = oldFetch; }
});
