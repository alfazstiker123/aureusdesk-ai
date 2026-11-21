const TF_ORDER = ['M5', 'M15', 'H1', 'H4', 'D1', 'W1', 'MN'];
const round = (n, d = 5) => Number(Number(n).toFixed(d));
const near = (a, b, eps = 1e-8) => Math.abs(a - b) <= Math.max(eps, Math.max(Math.abs(a), Math.abs(b)) * 1e-8);

// Confirmed pivots only. Equal-high/low plateaus are represented once at their midpoint.
export function findPivots(bars, left = 2, right = 2) {
  const raw = [];
  for (let i = left; i < bars.length - right; i++) {
    const b = bars[i];
    const window = bars.slice(i - left, i + right + 1).filter((_, j) => j !== left);
    const isHigh = window.every((x) => x.high <= b.high) && window.some((x) => x.high < b.high);
    const isLow = window.every((x) => x.low >= b.low) && window.some((x) => x.low > b.low);
    if (isHigh) raw.push({ type: 'H', price: b.high, index: i, time: b.time });
    if (isLow) raw.push({ type: 'L', price: b.low, index: i, time: b.time });
  }
  raw.sort((a, b) => a.index - b.index || a.type.localeCompare(b.type));
  const out = [];
  for (const p of raw) {
    const prev = out.at(-1);
    if (prev && prev.type === p.type && near(prev.price, p.price) && p.index - prev.index <= left + right) {
      // Keep the middle representative of an equal-price plateau.
      if (Math.abs(p.index - Math.floor((prev.index + p.index) / 2)) < Math.abs(prev.index - Math.floor((prev.index + p.index) / 2))) out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

function findFvgs(bars) {
  const out = [];
  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 2], c = bars[i];
    if (c.low > a.high) out.push({ type: 'BULLISH', low: a.high, high: c.low, index: i, time: c.time, status: 'FRESH' });
    if (c.high < a.low) out.push({ type: 'BEARISH', low: c.high, high: a.low, index: i, time: c.time, status: 'FRESH' });
  }
  return out.slice(-16).map((z) => {
    const later = bars.slice(z.index + 1);
    const partial = z.type === 'BULLISH'
      ? later.some((b) => b.low < z.high)
      : later.some((b) => b.high > z.low);
    const full = z.type === 'BULLISH'
      ? later.some((b) => b.low <= z.low)
      : later.some((b) => b.high >= z.high);
    return { ...z, status: full ? 'MITIGATED' : partial ? 'PARTIALLY_MITIGATED' : 'FRESH' };
  });
}

function findSweeps(bars, ps, right = 2) {
  const out = [];
  const seen = new Set();
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const prior = ps.filter((p) => p.index + right < i).slice(-12);
    const h = prior.filter((p) => p.type === 'H').at(-1);
    const l = prior.filter((p) => p.type === 'L').at(-1);
    if (h && b.high > h.price && b.close < h.price) {
      const key = `H:${h.index}:${round(h.price, 8)}`;
      if (!seen.has(key)) { seen.add(key); out.push({ side: 'SELL', level: h.price, time: b.time, pivotTime: h.time, kind: 'BUY-SIDE LIQUIDITY SWEEP' }); }
    }
    if (l && b.low < l.price && b.close > l.price) {
      const key = `L:${l.index}:${round(l.price, 8)}`;
      if (!seen.has(key)) { seen.add(key); out.push({ side: 'BUY', level: l.price, time: b.time, pivotTime: l.time, kind: 'SELL-SIDE LIQUIDITY SWEEP' }); }
    }
  }
  return out.slice(-8);
}

function findStructure(bars, ps, right = 2) {
  if (bars.length < 10) return { bias: 'UNKNOWN', events: [], swings: ps.slice(-8) };
  const events = [];
  const broken = new Set();
  let bias = 'UNKNOWN';
  for (let i = 1; i < bars.length; i++) {
    // A pivot is usable only after its right-side confirmation bars have closed.
    const confirmed = ps.filter((p) => p.index + right < i);
    const ph = confirmed.filter((p) => p.type === 'H').at(-1);
    const pl = confirmed.filter((p) => p.type === 'L').at(-1);
    const prev = bars[i - 1], cur = bars[i];
    const up = ph && !broken.has(`H:${ph.index}`) && prev.close <= ph.price && cur.close > ph.price;
    const down = pl && !broken.has(`L:${pl.index}`) && prev.close >= pl.price && cur.close < pl.price;
    if (up && down) {
      // An outside candle can sweep both sides. Do not infer direction from wick order.
      const bullish = cur.close >= cur.open;
      const p = bullish ? ph : pl;
      const dir = bullish ? 'BULLISH' : 'BEARISH';
      broken.add(`${bullish ? 'H' : 'L'}:${p.index}`);
      events.push({ type: bias !== 'UNKNOWN' && bias !== dir ? 'CHoCH' : 'BOS', direction: dir, level: p.price, time: cur.time, index: i });
      bias = dir;
    } else if (up) {
      broken.add(`H:${ph.index}`);
      events.push({ type: bias === 'BEARISH' ? 'CHoCH' : 'BOS', direction: 'BULLISH', level: ph.price, time: cur.time, index: i });
      bias = 'BULLISH';
    } else if (down) {
      broken.add(`L:${pl.index}`);
      events.push({ type: bias === 'BULLISH' ? 'CHoCH' : 'BOS', direction: 'BEARISH', level: pl.price, time: cur.time, index: i });
      bias = 'BEARISH';
    }
  }
  return { bias, events: events.slice(-8), swings: ps.slice(-10) };
}

function findOrderBlocks(bars, structure) {
  const out = [];
  for (const ev of structure.events.filter((e) => e.type === 'BOS' || e.type === 'CHoCH')) {
    let ob = null;
    for (let i = ev.index - 1; i >= Math.max(0, ev.index - 12); i--) {
      const b = bars[i];
      const opposite = ev.direction === 'BULLISH' ? b.close < b.open : b.close > b.open;
      if (opposite) { ob = { candle: b, index: i }; break; }
    }
    if (!ob) continue;
    // Only candles AFTER the structure break can mitigate/invalidate the OB.
    const later = bars.slice(ev.index + 1);
    const b = ob.candle;
    const invalid = ev.direction === 'BULLISH'
      ? later.some((x) => x.close < b.low)
      : later.some((x) => x.close > b.high);
    const retested = ev.direction === 'BULLISH'
      ? later.some((x) => x.low <= b.high && x.high >= b.low)
      : later.some((x) => x.high >= b.low && x.low <= b.high);
    out.push({ type: ev.direction, low: b.low, high: b.high, time: b.time, index: ob.index,
      status: invalid ? 'INVALIDATED' : retested ? 'MITIGATED' : 'FRESH', confirmedBy: ev.type, breakTime: ev.time });
  }
  return out.slice(-8);
}

function calculateAtr(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < period + 1) return null;
  const ranges = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], prev = bars[i - 1];
    ranges.push(Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close)));
  }
  const recent = ranges.slice(-period);
  return recent.length === period ? recent.reduce((sum, value) => sum + value, 0) / period : null;
}

function analyzeTimeframe(tf, source, live = 0) {
  const bars = (Array.isArray(source) ? source : []).map((b) => ({ ...b, time: Number(b.time) })).sort((a, b) => a.time - b.time);
  if (bars.length < (tf === 'MN' ? 18 : 30)) return { timeframe: tf, status: 'INSUFFICIENT_DATA', bars: bars.length };
  const ps = findPivots(bars), structure = findStructure(bars, ps), fvgs = findFvgs(bars);
  const sweeps = findSweeps(bars, ps), obs = findOrderBlocks(bars, structure), last = bars.at(-1);
  // Swing utuh: pivot low di bawah harga yang belum ditembus (support) dan pivot high di atas harga yang belum ditembus (resistance)
  const ref = live > 0 ? live : last.close; // harga live (M5/M15 terakhir) agar level yang sudah ditembus candle berjalan tidak dianggap utuh
  const intactLow = (p) => p.type === 'L' && p.price < ref && !bars.slice(p.index + 1).some((x) => x.low < p.price);
  const intactHigh = (p) => p.type === 'H' && p.price > ref && !bars.slice(p.index + 1).some((x) => x.high > p.price);
  const supports = ps.filter(intactLow).sort((a, b) => b.price - a.price).slice(0, 3).map((p) => ({ price: round(p.price), time: p.time }));
  const lastL = [...ps].reverse().find((p) => p.type === 'L'), lastH = [...ps].reverse().find((p) => p.type === 'H');
  const liveNote = structure.bias === 'BULLISH' && lastL && ref < lastL.price ? `harga live ${round(ref)} sudah di bawah swing low ${round(lastL.price)} (kemungkinan CHoCH bearish bila candle ${tf} ditutup di bawahnya)`
    : structure.bias === 'BEARISH' && lastH && ref > lastH.price ? `harga live ${round(ref)} sudah di atas swing high ${round(lastH.price)} (kemungkinan CHoCH bullish bila candle ${tf} ditutup di atasnya)` : '';
  const resistances = ps.filter(intactHigh).sort((a, b) => a.price - b.price).slice(0, 3).map((p) => ({ price: round(p.price), time: p.time }));
  const atrTf = calculateAtr(bars, 14) || 0;
  const liveRef = live > 0 ? live : last.close;
  // FVG terlalu tipis (< 0.08 x ATR TF) = noise; zona yang sudah ditembus harga live (belum close) tidak dianggap fresh
  const liveBroken = (z) => (z.type === 'BULLISH' ? liveRef < z.low : liveRef > z.high);
  const zones = [
    ...obs.filter((x) => x.status === 'FRESH').map((x) => ({ ...x, source: 'ORDER_BLOCK' })),
    ...fvgs.filter((x) => x.status === 'FRESH' && !(atrTf > 0 && x.high - x.low < 0.08 * atrTf)).map((x) => ({ ...x, source: 'FVG' })),
  ].filter((z) => !liveBroken(z));
  return { timeframe: tf, status: 'OK', bars: bars.length, lastPrice: last.close, lastBarTime: last.time, atr14: calculateAtr(bars, 14),
    bias: structure.bias, structureEvents: structure.events.map((e) => ({ ...e, level: round(e.level) })),
    swings: structure.swings.map((x) => ({ ...x, price: round(x.price) })), supports, resistances, refPrice: ref, liveNote,
    liquiditySweeps: sweeps.map((x) => ({ ...x, level: round(x.level) })),
    orderBlocks: obs.map((x) => ({ ...x, low: round(x.low), high: round(x.high) })),
    fvgs: fvgs.slice(-8).map((x) => ({ ...x, low: round(x.low), high: round(x.high) })),
    zones: zones.map((x) => ({ ...x, low: round(x.low), high: round(x.high) })) };
}

export function buildSmcReport(input) {
  const byTf = new Map();
  if (Array.isArray(input)) for (const b of input) { if (!byTf.has(b.timeframe)) byTf.set(b.timeframe, []); byTf.get(b.timeframe).push(b); }
  else if (input && typeof input === 'object') for (const [tf, bars] of Object.entries(input)) if (Array.isArray(bars)) byTf.set(tf, bars);
  const liveBars = byTf.get('M5')?.length ? byTf.get('M5') : byTf.get('M15');
  const live = Array.isArray(liveBars) && liveBars.length ? Number([...liveBars].sort((a, b) => a.time - b.time).at(-1).close) : 0;
  const analyses = TF_ORDER.filter((tf) => byTf.has(tf)).map((tf) => analyzeTimeframe(tf, byTf.get(tf), live));
  const valid = analyses.filter((x) => x.status === 'OK');
  const h4 = valid.find((x) => x.timeframe === 'H4'), h1 = valid.find((x) => x.timeframe === 'H1'), m15 = valid.find((x) => x.timeframe === 'M15');
  const higherBias = h4?.bias && h4.bias !== 'UNKNOWN' ? h4.bias : h1?.bias;
  const alignment = m15?.bias && higherBias && m15.bias !== 'UNKNOWN' ? m15.bias === higherBias : null;
  const lines = ['=== HASIL SMC DETERMINISTIK DARI OHLC TERTUTUP ===', 'BOS/CHoCH memakai close candle setelah swing terkonfirmasi; sweep unik per pivot; OB mitigasi hanya dihitung setelah break; hasil bukan probabilitas profit.'];
  for (const a of analyses) {
    lines.push(`\n[${a.timeframe}] status=${a.status}; bars=${a.bars}${a.lastPrice ? `; close terakhir=${a.lastPrice}` : ''}`);
    if (a.status !== 'OK') continue;
    lines.push(`Bias struktur: ${a.bias}${a.atr14 ? ` | ATR(14) OHLC=${round(a.atr14, 6)}` : ''}`);
    if (a.structureEvents.length) lines.push('Event: ' + a.structureEvents.map((e) => `${e.type} ${e.direction} @ ${e.level} (${new Date(e.time * 1000).toISOString()})`).join(' | '));
    if (a.liquiditySweeps.length) lines.push('Liquidity sweep: ' + a.liquiditySweeps.map((x) => `${x.kind} @ ${x.level}`).join(' | '));
    if (a.orderBlocks.length) lines.push('Order Block: ' + a.orderBlocks.map((x) => `${x.type} ${x.low}-${x.high} (${x.status})`).join(' | '));
    if (a.fvgs.length) lines.push('FVG: ' + a.fvgs.map((x) => `${x.type} ${x.low}-${x.high} (${x.status})`).join(' | '));
    if (a.liveNote) lines.push('Catatan live: ' + a.liveNote);
    if (a.supports?.length) lines.push('Support swing utuh di bawah harga (pivot low belum ditembus): ' + a.supports.map((x) => x.price).join(' | '));
    if (a.resistances?.length) lines.push('Resistance swing utuh di atas harga (pivot high belum ditembus): ' + a.resistances.map((x) => x.price).join(' | '));
    if (a.zones.length) lines.push('Zona fresh: ' + a.zones.map((z) => `${z.source} ${z.type} ${z.low}-${z.high}`).join(' | '));
  }
  lines.push(`\nAlignment H4/H1 ke M15: ${alignment === null ? 'BELUM CUKUP DATA' : alignment ? 'SELARAS' : 'TIDAK SELARAS'}.`);
  lines.push('OB/FVG invalidated atau mitigated tidak dipromosikan sebagai zona fresh. Validasi harga broker tetap wajib.');
  // Ringkasan ringkas untuk tampilan (tabel); detail penuh tetap di promptBlock.
  const fmt = (z) => (z ? `${z.source === 'FVG' ? 'FVG' : 'OB'} ${z.low}–${z.high}` : '—');
  const rows = valid.map((a) => {
    const px = a.refPrice || a.lastPrice;
    const above = a.zones.filter((z) => z.low > px).sort((x, y) => x.low - y.low)[0];
    const below = a.zones.filter((z) => z.high < px).sort((x, y) => y.high - x.high)[0];
    const inside = a.zones.find((z) => z.low <= px && z.high >= px);
    const sup = a.supports?.[0] ? `Swing low ${a.supports[0].price}` : '—';
    return `| ${a.timeframe} | ${a.bias}${a.liveNote ? ' ⚠️ live menembus swing' : ''} | ${a.atr14 ? Math.round(a.atr14) : '—'} | ${inside ? `${fmt(inside)} (harga di dalam)` : fmt(above)} | ${fmt(below)} | ${sup} |`;
  });
  const compactBlock = ['| TF | Bias | ATR | Zona fresh terdekat di ATAS | Zona fresh terdekat di BAWAH | Support swing utuh |', '|---|---|---|---|---|---|', ...rows,
    '', `Alignment H4/H1 ke M15: **${alignment === null ? 'belum cukup data' : alignment ? 'selaras' : 'tidak selaras'}**`].join('\n');
  return { analyses, alignment, higherBias, promptBlock: lines.join('\n'), compactBlock };
}

/**
 * Kandidat zona Z1/Z2 per sisi dari OB/FVG fresh (semua TF). Tanpa penggabungan zona raksasa:
 * tiap zona dinilai sendiri (bobot TF + konfluensi dengan zona searah yang tumpang tindih),
 * lalu bagian masuk (proximal) dipotong maks 0.75 x ATR H1. Zona dekat tidak dibuang oleh rentang jarak.
 * range = { z1:[min,max], z2:[min,max] } (jarak dari harga) hanya batas atas pencarian.
 */

// Bagian entry + SL dari satu zona. Zona sempit (<= cap): seluruh zona, SL di luar tepi distal.
// Zona lebar: entry mulai dari 50% (consequent encroachment) ke arah distal, SL tetap DI LUAR zona
// (bukan di tengah imbalance) dengan jarak entry->SL maks ~1.35 unit ATR.
export function zoneEntry(side, z, cap, unit, mates = []) {
  const w = z.high - z.low, buf = 0.15 * unit;
  // zona searah yang menempel di sisi distal (<= 0.5 unit) ikut dilewati SL, supaya SL tidak jatuh di dalam imbalance tetangga
  const ext = side === 'SELL'
    ? Math.max(z.high, ...mates.filter((m) => m.low <= z.high && m.high > z.high && m.high - z.high <= 0.5 * unit).map((m) => m.high))
    : Math.min(z.low, ...mates.filter((m) => m.high >= z.low && m.low < z.low && z.low - m.low <= 0.5 * unit).map((m) => m.low));
  if (w <= cap) return side === 'SELL' ? { entryLo: z.low, entryHi: z.high, sl: ext + buf } : { entryLo: z.low, entryHi: z.high, sl: ext - buf };
  const ce = (z.low + z.high) / 2;
  if (side === 'SELL') { const lo = Math.max(ce, z.high - 1.2 * unit); return { entryLo: lo, entryHi: Math.min(z.high, lo + cap), sl: ext + buf }; }
  const hi = Math.min(ce, z.low + 1.2 * unit); return { entryLo: Math.max(z.low, hi - cap), entryHi: hi, sl: ext - buf };
}

export function buildZoneCandidates(analyses, price, range, atrH1 = 0, tol = 0.15) {
  if (!(price > 0) || !range) return null;
  const W = { H4: 4, H1: 3, M15: 2, M5: 1 };
  const all = [];
  for (const a of analyses || []) {
    if (a.status !== 'OK' || !W[a.timeframe]) continue;
    for (const z of a.zones || []) {
      if (all.some((x) => x.tf === a.timeframe && x.low === z.low && x.high === z.high && x.type === z.type)) continue;
      all.push({ low: z.low, high: z.high, type: z.type, tf: a.timeframe, kind: z.source === 'FVG' ? 'FVG' : 'OB', w: W[a.timeframe] });
    }
  }
  const overlap = (a, b) => a.low <= b.high && a.high >= b.low;
  const a1 = atrH1 > 0 ? atrH1 : price * 0.01;
  const dmin = 0.2 * a1;
  const cap = 0.75 * a1;
  const res = {};
  for (const side of ['SELL', 'BUY']) {
    const same = all.filter((z) => (side === 'SELL' ? z.type === 'BEARISH' : z.type === 'BULLISH'));
    const cl = same
      .filter((z) => (side === 'SELL' ? z.low > price : z.high < price))
      .map((z) => {
        const mates = same.filter((o) => o !== z && overlap(z, o));
        const d = side === 'SELL' ? z.low - price : price - z.high;
        const { entryLo, entryHi, sl } = zoneEntry(side, z, cap, a1, mates);
        return { low: z.low, high: z.high, entryLo, entryHi, sl, d, tfs: [z.tf, ...mates.map((m) => m.tf)],
          score: z.w + mates.reduce((s, m) => s + m.w, 0),
          src: [...new Set([z, ...mates].map((m) => `${m.tf} ${m.kind}`))].join(', ') };
      });
    const z1 = cl.filter((c) => c.d >= dmin && c.d <= range.z1[1] * (1 + tol) && c.score >= 3).sort((x, y) => x.d - y.d)[0] || null;
    const minD2 = z1 ? z1.d + 0.5 * a1 : range.z2[0] * (1 - tol);
    const z2 = cl.filter((c) => c !== z1 && c.d >= minD2 && c.d <= range.z2[1] * (1 + tol) && c.score >= 5 && c.tfs.some((t) => t === 'H1' || t === 'H4'))
      .sort((x, y) => y.score - x.score || x.d - y.d)[0] || null;
    res[side] = { z1, z2 };
  }
  const f = (n) => (Math.abs(n) >= 100 ? Math.round(n * 10) / 10 : Math.round(n * 1e5) / 1e5);
  const line = (side, name, c) => c
    ? `- ${side} ${name}: entry ${f(c.entryLo)}–${f(c.entryHi)} (jarak ${f(c.d)} dari harga; dasar: ${c.src}; SL minimal ${side === 'SELL' ? '≥' : '≤'} ${f(c.sl)}, di luar zona)`
    : `- ${side} ${name}: Tidak ada level valid (tunggu)`;
  const lines = [`KANDIDAT ZONA DARI SMC (dihitung server dari OB/FVG fresh; harga feed ${f(price)}):`,
    line('SELL', 'Zona 1', res.SELL.z1), line('SELL', 'Zona 2', res.SELL.z2), line('BUY', 'Zona 1', res.BUY.z1), line('BUY', 'Zona 2', res.BUY.z2)];
  for (const side of ['SELL', 'BUY']) if (!res[side].z1 && !res[side].z2) lines.push(`→ ${side}: WAIT (tidak ada zona ${side === 'SELL' ? 'bearish' : 'bullish'} fresh yang layak)`);
  lines.push('ATURAN: entry HARUS berada di dalam OB/FVG fresh searah (kandidat di atas diutamakan). Jika tertulis "Tidak ada level valid", tulis "Tidak ada level valid (tunggu)" dan 4B "Tidak Ada Setup (Tunggu)"; jangan mengarang level. Server akan MEMBATALKAN order yang entry-nya di luar zona SMC fresh.');
  return { text: lines.join('\n'), res };
}

/**
 * Mode 3 zona: Zona 1 Scalping (OB/FVG M5-M15, jarak ~0.3-1.2 x ATR M15), Zona 2 Intraday (M5-H1, rentang intraday),
 * Zona 3 Swing (M15-H4, rentang swing). ranges = { z1, z2, z3 } jarak dari harga. Zona kosong = "Tidak ada level valid (tunggu)".
 */
export function buildZoneCandidates3(analyses, price, ranges, atr = {}, tol = 0.15) {
  if (!(price > 0) || !ranges) return null;
  const W = { H4: 4, H1: 3, M15: 2, M5: 1 };
  const POOL = { 1: ['M5', 'M15'], 2: ['M5', 'M15', 'H1'], 3: ['M15', 'H1', 'H4'] };
  const MIN = { 1: 1, 2: 2, 3: 3 };
  const NAME = { 1: 'Zona 1 (Scalping)', 2: 'Zona 2 (Intraday)', 3: 'Zona 3 (Swing)' };
  const all = [];
  for (const a of analyses || []) {
    if (a.status !== 'OK' || !W[a.timeframe]) continue;
    for (const z of a.zones || []) {
      if (all.some((x) => x.tf === a.timeframe && x.low === z.low && x.high === z.high && x.type === z.type)) continue;
      all.push({ low: z.low, high: z.high, type: z.type, tf: a.timeframe, kind: z.source === 'FVG' ? 'FVG' : 'OB', w: W[a.timeframe] });
    }
  }
  const overlap = (a, b) => a.low <= b.high && a.high >= b.low;
  const m15 = atr.m15 > 0 ? atr.m15 : (atr.h1 > 0 ? atr.h1 / 3 : price * 0.003);
  const cap = { 1: 0.75 * m15, 2: 0.75 * (atr.h1 > 0 ? atr.h1 : price * 0.01), 3: 0.75 * (atr.h1 > 0 ? atr.h1 : price * 0.01) };
  const res = {};
  for (const side of ['SELL', 'BUY']) {
    const same = all.filter((z) => (side === 'SELL' ? z.type === 'BEARISH' : z.type === 'BULLISH'));
    const base = same.filter((z) => (side === 'SELL' ? z.low > price : z.high < price)).map((z) => {
      const mates = same.filter((o) => o !== z && overlap(z, o));
      return { z, mates, d: side === 'SELL' ? z.low - price : price - z.high, score: z.w + mates.reduce((s, m) => s + m.w, 0),
        src: [...new Set([z, ...mates].map((m) => `${m.tf} ${m.kind}`))].join(', ') };
    });
    const out = {};
    let prevD = 0;
    for (const k of [1, 2, 3]) {
      const r = ranges[`z${k}`];
      const pick = base.filter((c) => POOL[k].includes(c.z.tf) && c.d > prevD && c.d >= r[0] * (1 - tol) && c.d <= r[1] * (1 + tol) && c.score >= MIN[k])
        .sort((a, b) => (k === 3 ? b.score - a.score || a.d - b.d : a.d - b.d))[0] || null;
      if (pick) {
        const unit = k === 1 ? m15 : atr.h1 > 0 ? atr.h1 : price * 0.01;
        const ez = zoneEntry(side, pick.z, cap[k], unit, pick.mates);
        out[k] = { ...ez, d: pick.d, src: pick.src, score: pick.score };
        prevD = pick.d;
      } else out[k] = null;
    }
    res[side] = out;
  }
  const f = (n) => (Math.abs(n) >= 100 ? Math.round(n * 10) / 10 : Math.round(n * 1e5) / 1e5);
  const buf = { 1: 0.25 * m15, 2: 0.35 * (atr.h1 > 0 ? atr.h1 : price * 0.01), 3: 0.35 * (atr.h1 > 0 ? atr.h1 : price * 0.01) };
  const line = (side, k, c) => c
    ? `- ${side} ${NAME[k]}: entry ${f(c.entryLo)}–${f(c.entryHi)} (jarak zona ${f(c.d)}, limit ${f(side === 'SELL' ? c.entryLo : c.entryHi)}; dasar: ${c.src}; SL minimal ${side === 'SELL' ? '≥' : '≤'} ${f(c.sl)}, di luar zona)`
    : `- ${side} ${NAME[k]}: Tidak ada level valid (tunggu)`;
  const lines = [`KANDIDAT ZONA DARI SMC — MODE 3 ZONA (harga feed ${f(price)}):`];
  for (const side of ['SELL', 'BUY']) for (const k of [1, 2, 3]) lines.push(line(side, k, res[side][k]));
  for (const side of ['SELL', 'BUY']) if (!res[side][1] && !res[side][2] && !res[side][3]) lines.push(`→ ${side}: WAIT (tidak ada zona ${side === 'SELL' ? 'bearish' : 'bullish'} fresh yang layak)`);
  lines.push('ATURAN: entry HARUS di dalam OB/FVG fresh searah (kandidat diutamakan). "Tidak ada level valid" = tulis "Tidak ada level valid (tunggu)" dan 4B "Tidak Ada Setup (Tunggu)". Server MEMBATALKAN order di luar zona SMC fresh.');
  return { text: lines.join('\n'), res };
}
