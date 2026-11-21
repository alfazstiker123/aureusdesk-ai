// Tahap 1 (Gemini vision -> JSON terstruktur) + penyusun kandidat level untuk tahap 2.
import { zoneRange } from '@/lib/pairs';

export const EXTRACT_SYSTEM = `Anda adalah mesin ekstraksi data dari screenshot chart MT4. JANGAN menganalisa atau memberi saran. Hanya salin apa yang TERLIHAT.
Aturan:
- Angka harus persis seperti tampak di gambar; bila tidak terbaca JANGAN menebak (kosongkan/null).
- axisTicks = SEMUA angka label skala harga di sumbu kanan (bukan level pasar).
- swingHighs/swingLows = harga puncak/lembah candle yang jelas terlihat (ujung sumbu candle), bukan label sumbu.
- supply/demand = zona/kotak/garis horizontal yang digambar pengguna atau area penolakan jelas; tulis [bawah, atas].
- orders = garis order/posisi MT4 (tipe, harga, SL, TP, lot) bila terlihat; jika tidak ada, array kosong.
- lastPrice dari garis harga/label harga berjalan; phoneTime = jam di chart/ponsel bila terlihat.
Keluaran HANYA JSON sesuai skema.`;

const NUM = { type: 'NUMBER' };
const NUMS = { type: 'ARRAY', items: NUM };
export const EXTRACT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    pair: { type: 'STRING' },
    lastPrice: NUM,
    bid: NUM,
    ask: NUM,
    phoneTime: { type: 'STRING' },
    timeframes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tf: { type: 'STRING' },
          trend: { type: 'STRING' },
          axisTicks: NUMS,
          swingHighs: NUMS,
          swingLows: NUMS,
          supply: { type: 'ARRAY', items: NUMS },
          demand: { type: 'ARRAY', items: NUMS },
          notes: { type: 'STRING' },
        },
        required: ['tf'],
      },
    },
    orders: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { type: { type: 'STRING' }, price: NUM, sl: NUM, tp: NUM, lot: NUM },
      },
    },
    notes: { type: 'STRING' },
  },
  required: ['timeframes'],
};

const n = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const arr = (v) => (Array.isArray(v) ? v.map(n).filter((x) => x !== null) : []);

/** Rapikan JSON mentah dari tahap 1; lempar error bila tak layak pakai. */
export function normalizeExtract(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('JSON ekstraksi kosong');
  const tfs = (Array.isArray(raw.timeframes) ? raw.timeframes : []).map((t) => ({
    tf: String(t?.tf || '?').slice(0, 8),
    trend: String(t?.trend || '').slice(0, 80),
    axisTicks: arr(t?.axisTicks),
    swingHighs: arr(t?.swingHighs),
    swingLows: arr(t?.swingLows),
    supply: (Array.isArray(t?.supply) ? t.supply : []).map(arr).filter((z) => z.length >= 1),
    demand: (Array.isArray(t?.demand) ? t.demand : []).map(arr).filter((z) => z.length >= 1),
    notes: String(t?.notes || '').slice(0, 300),
  }));
  const d = {
    pair: String(raw.pair || '').slice(0, 20),
    lastPrice: n(raw.lastPrice),
    bid: n(raw.bid),
    ask: n(raw.ask),
    phoneTime: String(raw.phoneTime || '').slice(0, 40),
    timeframes: tfs,
    orders: (Array.isArray(raw.orders) ? raw.orders : []).map((o) => ({
      type: String(o?.type || '').slice(0, 20), price: n(o?.price), sl: n(o?.sl), tp: n(o?.tp), lot: n(o?.lot),
    })),
    notes: String(raw.notes || '').slice(0, 400),
  };
  if (!tfs.length) throw new Error('Tidak ada timeframe terbaca');
  return d;
}

/**
 * Kandidat level: swing & batas zona, dibuang bila sama dengan angka sumbu (axisTicks),
 * diberi jarak/% dari harga terakhir dan label rentang zona.
 */
export function buildCandidates(data, pair) {
  const last = data.lastPrice;
  const dec = pair?.dec ?? 2;
  const R = pair && last ? zoneRange(pair, last) : null;
  const tickEps = last ? Math.abs(last) * 1e-7 : 1e-9;
  const seen = new Set();
  const out = [];
  let dropped = 0;
  for (const t of data.timeframes) {
    const ticks = new Set(t.axisTicks.map((x) => x.toFixed(dec)));
    const push = (price, kind) => {
      if (price === null) return;
      if (ticks.has(price.toFixed(dec)) || t.axisTicks.some((x) => Math.abs(x - price) <= tickEps)) { dropped++; return; }
      const key = `${price.toFixed(dec)}|${kind}`;
      if (seen.has(key)) return;
      seen.add(key);
      const dist = last ? price - last : null;
      let zone = '';
      if (R && dist !== null) {
        const a = Math.abs(dist);
        zone = a >= R.z1[0] && a <= R.z1[1] ? 'Z1' : a >= R.z2[0] && a <= R.z2[1] ? 'Z2' : a < R.z1[0] ? 'terlalu dekat' : 'terlalu jauh';
      }
      out.push({ price, kind, tf: t.tf, dist, pct: last ? (dist / last) * 100 : null, zone });
    };
    t.swingHighs.forEach((p) => push(p, 'swing high'));
    t.swingLows.forEach((p) => push(p, 'swing low'));
    t.supply.forEach((z) => { push(z[0], 'supply'); if (z.length > 1) push(z[z.length - 1], 'supply'); });
    t.demand.forEach((z) => { push(z[0], 'demand'); if (z.length > 1) push(z[z.length - 1], 'demand'); });
  }
  out.sort((a, b) => a.price - b.price);
  return { candidates: out, dropped };
}

export function formatDataBlock(data, pair, built) {
  const dec = pair?.dec ?? 2;
  const f = (x) => (x === null || x === undefined ? '-' : Number(x).toFixed(dec));
  const L = ['=== DATA CHART TEREKSTRAKSI (tahap 1, dari screenshot) ==='];
  L.push(`Pair: ${data.pair || pair?.id || '?'} | Harga terakhir: ${f(data.lastPrice)} | Bid/Ask: ${f(data.bid)}/${f(data.ask)} | Jam chart: ${data.phoneTime || '-'}`);
  data.timeframes.forEach((t) => L.push(`- ${t.tf}: tren ${t.trend || '-'}${t.notes ? ` | ${t.notes}` : ''}`));
  L.push(data.orders.length ? 'Order terlihat: ' + data.orders.map((o) => `${o.type || '?'} @${f(o.price)} SL ${f(o.sl)} TP ${f(o.tp)} lot ${o.lot ?? '-'}`).join('; ') : 'Order terlihat: TIDAK ADA');
  if (data.notes) L.push(`Catatan: ${data.notes}`);
  L.push('', 'KANDIDAT LEVEL (urut harga; angka sumbu sudah dibuang; jarak dari harga terakhir):');
  if (!built.candidates.length) L.push('(tidak ada kandidat)');
  built.candidates.forEach((c) => {
    L.push(`- ${f(c.price)} | ${c.kind} ${c.tf} | ${c.dist === null ? '' : (c.dist >= 0 ? '+' : '') + c.dist.toFixed(dec)} (${c.pct === null ? '' : c.pct.toFixed(2) + '%'}) | ${c.zone || '-'}`);
  });
  L.push('=== AKHIR DATA CHART ===');
  return L.join('\n');
}

export const STAGE2_ADDENDUM = `
MODE 2 TAHAP: Anda TIDAK melihat gambar. Satu-satunya sumber level adalah blok "DATA CHART TEREKSTRAKSI" / "KANDIDAT LEVEL".
- Entry, Level Kunci, SL, TP HANYA boleh memakai harga dari daftar kandidat (boleh SL/TP sedikit di luar kandidat bila perlu buffer, tetapi tidak boleh angka sumbu).
- Pilih kandidat Z1 untuk Zona 1 dan Z2 untuk Zona 2 sesuai arah. Bila tidak ada kandidat valid di rentang zona itu, tulis zona tersebut "Tidak ada level valid (tunggu)" - JANGAN mengarang.
- Jangan menyebut bahwa Anda melihat gambar; rujuk "data chart".`;
