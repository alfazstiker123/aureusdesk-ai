const TF_ORDER = ['M5', 'M15', 'H1', 'H4', 'D1', 'W1'];
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

function analyzeTimeframe(tf, source) {
  const bars = (Array.isArray(source) ? source : []).map((b) => ({ ...b, time: Number(b.time) })).sort((a, b) => a.time - b.time);
  if (bars.length < 30) return { timeframe: tf, status: 'INSUFFICIENT_DATA', bars: bars.length };
  const ps = findPivots(bars), structure = findStructure(bars, ps), fvgs = findFvgs(bars);
  const sweeps = findSweeps(bars, ps), obs = findOrderBlocks(bars, structure), last = bars.at(-1);
  const zones = [
    ...obs.filter((x) => x.status === 'FRESH').map((x) => ({ ...x, source: 'ORDER_BLOCK' })),
    ...fvgs.filter((x) => x.status === 'FRESH').map((x) => ({ ...x, source: 'FVG' })),
  ];
  return { timeframe: tf, status: 'OK', bars: bars.length, lastPrice: last.close, lastBarTime: last.time, atr14: calculateAtr(bars, 14),
    bias: structure.bias, structureEvents: structure.events.map((e) => ({ ...e, level: round(e.level) })),
    swings: structure.swings.map((x) => ({ ...x, price: round(x.price) })),
    liquiditySweeps: sweeps.map((x) => ({ ...x, level: round(x.level) })),
    orderBlocks: obs.map((x) => ({ ...x, low: round(x.low), high: round(x.high) })),
    fvgs: fvgs.slice(-8).map((x) => ({ ...x, low: round(x.low), high: round(x.high) })),
    zones: zones.map((x) => ({ ...x, low: round(x.low), high: round(x.high) })) };
}

export function buildSmcReport(input) {
  const byTf = new Map();
  if (Array.isArray(input)) for (const b of input) { if (!byTf.has(b.timeframe)) byTf.set(b.timeframe, []); byTf.get(b.timeframe).push(b); }
  else if (input && typeof input === 'object') for (const [tf, bars] of Object.entries(input)) if (Array.isArray(bars)) byTf.set(tf, bars);
  const analyses = TF_ORDER.filter((tf) => byTf.has(tf)).map((tf) => analyzeTimeframe(tf, byTf.get(tf)));
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
    if (a.zones.length) lines.push('Zona fresh: ' + a.zones.map((z) => `${z.source} ${z.type} ${z.low}-${z.high}`).join(' | '));
  }
  lines.push(`\nAlignment H4/H1 ke M15: ${alignment === null ? 'BELUM CUKUP DATA' : alignment ? 'SELARAS' : 'TIDAK SELARAS'}.`);
  lines.push('OB/FVG invalidated atau mitigated tidak dipromosikan sebagai zona fresh. Validasi harga broker tetap wajib.');
  // Ringkasan ringkas untuk tampilan (tabel); detail penuh tetap di promptBlock.
  const fmt = (z) => (z ? `${z.source === 'FVG' ? 'FVG' : 'OB'} ${z.low}–${z.high}` : '—');
  const rows = valid.map((a) => {
    const px = a.lastPrice;
    const above = a.zones.filter((z) => z.low > px).sort((x, y) => x.low - y.low)[0];
    const below = a.zones.filter((z) => z.high < px).sort((x, y) => y.high - x.high)[0];
    const inside = a.zones.find((z) => z.low <= px && z.high >= px);
    return `| ${a.timeframe} | ${a.bias} | ${a.atr14 ? Math.round(a.atr14) : '—'} | ${inside ? `${fmt(inside)} (harga di dalam)` : fmt(above)} | ${fmt(below)} |`;
  });
  const compactBlock = ['| TF | Bias | ATR | Zona fresh terdekat di ATAS | Zona fresh terdekat di BAWAH |', '|---|---|---|---|---|', ...rows,
    '', `Alignment H4/H1 ke M15: **${alignment === null ? 'belum cukup data' : alignment ? 'selaras' : 'tidak selaras'}**`].join('\n');
  return { analyses, alignment, higherBias, promptBlock: lines.join('\n'), compactBlock };
}
