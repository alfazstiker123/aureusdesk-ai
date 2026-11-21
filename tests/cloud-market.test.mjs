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
    assert.equal(cloudSupports('AUDUSD'), false);
    await assert.rejects(() => getCloudMarketSnapshots('AUDUSD'), /belum punya sumber data gratis/);
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

test('XAUUSD via PAXG: candle akhir pekan dibuang, umur dihitung dari close Jumat, basis menggeser harga', async () => {
  const { applyBasis, cloudProxyOf } = await import('../lib/cloudMarket.js');
  _clearCloudCache();
  const oldFetch = globalThis.fetch;
  const oldNow = Date.now;
  const NOW = Date.UTC(2026, 10, 21, 6, 30); // Sabtu 13:30 WIB, pasar emas tutup
  Date.now = () => NOW;
  const step = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    assert.equal(u.hostname, 'data-api.binance.vision', 'PAXG memakai Binance lebih dulu');
    assert.equal(u.searchParams.get('symbol'), 'PAXGUSDT');
    const iv = u.searchParams.get('interval');
    const now = Math.floor(NOW / 1000);
    if (iv === '1M') {
      const rows = Array.from({ length: 30 }, (_, i) => { const d = Date.UTC(2024, 4 + i, 1); return [d, '4000', '4100', '3900', '4050', '10']; });
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    const st = step[iv];
    const n = Number(u.searchParams.get('limit'));
    const last = Math.floor(now / st) * st;
    const rows = Array.from({ length: n }, (_, i) => {
      const t = last - (n - 1 - i) * st;
      const p = 4000 + (i % 50);
      return [t * 1000, String(p), String(p + 3), String(p - 3), String(p + 1), '5'];
    });
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  try {
    assert.equal(cloudSupports('XAUUSD'), true);
    assert.equal(cloudProxyOf('XAUUSD'), 'PAXG');
    const r = await getCloudMarketSnapshots('XAUUSD');
    assert.match(r.provider, /Binance \(PAXGUSDT\)/);
    const m5 = r.snapshots.find((s) => s.timeframe === 'M5');
    // Jumat 20 Nov 2026 17:00 NY (EST) = 22:00 UTC -> candle M5 terakhir mulai 21:55 UTC
    assert.equal(new Date(m5.bars.at(-1).time * 1000).toISOString(), '2026-11-20T21:55:00.000Z');
    const d1 = r.snapshots.find((s) => s.timeframe === 'D1');
    assert.ok(d1.bars.every((b) => ![0, 6].includes(new Date(b.time * 1000).getUTCDay())), 'D1 Sabtu/Minggu dibuang');
    assert.ok(r.snapshots.some((s) => s.timeframe === 'MN'));
    const ref = m5.bars.at(-1).close;
    const b = applyBasis(r.snapshots, ref + 12.5);
    assert.equal(b.basis.offset, 12.5);
    assert.equal(b.snapshots.find((s) => s.timeframe === 'M5').bars.at(-1).close, ref + 12.5);
    assert.equal(b.snapshots.find((s) => s.timeframe === 'H4').bars[0].high, r.snapshots.find((s) => s.timeframe === 'H4').bars[0].high + 12.5);
    const bad = applyBasis(r.snapshots, ref * 1.05);
    assert.equal(bad.basis, null);
    assert.match(bad.note, /terlalu jauh/);
    assert.equal(applyBasis(r.snapshots, 0).basis, null);
  } finally { globalThis.fetch = oldFetch; Date.now = oldNow; _clearCloudCache(); }
});

test('Forex (USDJPY) via Kraken: akhir pekan dibuang, MN dari harian hari kerja, tanpa Binance, basis 3 desimal', async () => {
  const { applyBasis } = await import('../lib/cloudMarket.js');
  _clearCloudCache();
  const oldFetch = globalThis.fetch; const oldNow = Date.now;
  const NOW = Date.UTC(2026, 10, 21, 6, 30); // Sabtu 13:30 WIB
  Date.now = () => NOW;
  const now = Math.floor(NOW / 1000);
  const hosts = new Set();
  globalThis.fetch = async (url) => {
    const u = new URL(url); hosts.add(u.hostname);
    assert.equal(u.hostname, 'api.kraken.com', 'USDJPY tidak punya cadangan Binance');
    assert.equal(u.searchParams.get('pair'), 'USDJPY');
    const min = Number(u.searchParams.get('interval')); const st = intervals[min];
    const n = 720; const last = Math.floor(now / st) * st;
    const rows = Array.from({ length: n }, (_, i) => { const t = last - (n - 1 - i) * st; const p = 150 + ((i * 7) % 40) / 10; return [t, p.toFixed(3), (p + 0.05).toFixed(3), (p - 0.05).toFixed(3), (p + 0.01).toFixed(3), p.toFixed(3), '1', 5]; });
    return new Response(JSON.stringify({ error: [], result: { USDJPY: rows, last: now } }), { status: 200 });
  };
  try {
    const r = await getCloudMarketSnapshots('USDJPY');
    assert.equal(r.proxy, 'FX');
    assert.ok(!hosts.has('data-api.binance.vision'));
    const m5 = r.snapshots.find((s) => s.timeframe === 'M5');
    assert.equal(new Date(m5.bars.at(-1).time * 1000).toISOString(), '2026-11-20T21:55:00.000Z');
    const mn = r.snapshots.find((s) => s.timeframe === 'MN');
    assert.ok(mn && mn.bars.length >= 18, `MN dari Kraken harian: ${mn?.bars.length}`);
    assert.equal(mn.source, 'KRAKEN');
    const ref = m5.bars.at(-1).close;
    const b = applyBasis(r.snapshots, ref + 0.042, { dec: 3, maxPct: r.maxBasisPct });
    assert.equal(b.basis.offset, 0.042);
    assert.equal(b.snapshots.find((s) => s.timeframe === 'M5').bars.at(-1).close, Math.round((ref + 0.042) * 1000) / 1000);
    assert.equal(applyBasis(r.snapshots, ref * 1.02, { dec: 3, maxPct: r.maxBasisPct }).basis, null, 'selisih 2% ditolak untuk forex');
  } finally { globalThis.fetch = oldFetch; Date.now = oldNow; _clearCloudCache(); }
});

test('EURUSD: Kraken gagal -> cadangan Binance EURUSDT', async () => {
  _clearCloudCache();
  const oldFetch = globalThis.fetch; const oldNow = Date.now;
  const NOW = Date.UTC(2026, 10, 23, 12, 0); // Senin, pasar buka
  Date.now = () => NOW; const now = Math.floor(NOW / 1000);
  const step = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'api.kraken.com') return new Response(JSON.stringify({ error: ['EQuery:Unknown asset pair'] }), { status: 200 });
    assert.equal(u.searchParams.get('symbol'), 'EURUSDT');
    const iv = u.searchParams.get('interval');
    if (iv === '1M') return new Response(JSON.stringify([]), { status: 200 });
    const st = step[iv]; const n = Number(u.searchParams.get('limit')); const last = Math.floor(now / st) * st;
    return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => { const p = 1.08 + (i % 30) / 10000; return [(last - (n - 1 - i) * st) * 1000, p.toFixed(5), (p + 0.0004).toFixed(5), (p - 0.0004).toFixed(5), (p + 0.0001).toFixed(5), '5']; })), { status: 200 });
  };
  try {
    const r = await getCloudMarketSnapshots('EURUSD');
    assert.match(r.provider, /Binance \(EURUSDT\)/);
    assert.ok(r.snapshots.find((s) => s.timeframe === 'H1').bars.length >= 35);
  } finally { globalThis.fetch = oldFetch; Date.now = oldNow; _clearCloudCache(); }
});
