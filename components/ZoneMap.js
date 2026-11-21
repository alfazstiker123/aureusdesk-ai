'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const FILTERS = [
  ['ALL', 'Semua Zona'],
  ['SELL', 'SELL'],
  ['BUY', 'BUY'],
  ['Z1', 'Zona 1'],
  ['Z2', 'Zona 2'],
  ['Z3', 'Zona 3'],
];

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// EMA dihitung dari close candle feed (bukan data buatan).
export function emaSeries(closes, period = 20) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = null;
  for (const c of closes) {
    prev = prev === null ? c : c * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

// Menggambar peta level (zona entry, SL, TP, harga terakhir). Hanya level dari hasil analisa;
// tidak ada candle buatan. Label di sumbu kanan disusun agar tidak saling menimpa.
export function drawZoneMap(canvas, W, H, dpr, { zones, price, dec, pair, bias, filter, candles = null, tfLabel = '', ema = null, events = null }) {
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#081226');
  g.addColorStop(1, '#040914');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const all = zones.filter((z) => z.valid);
  const picked = all.filter((z) => {
    if (filter === 'ALL') return true;
    if (filter === 'BUY' || filter === 'SELL') return z.side === filter;
    return `Z${z.zone}` === filter;
  });
  const act = picked.length ? picked : all;

  const prices = [];
  if (Number.isFinite(price)) prices.push(price);
  act.forEach((z) => {
    prices.push(z.low, z.high);
    [z.slVal, z.tp1Val, z.tp2Val].forEach((v) => Number.isFinite(v) && prices.push(v));
  });
  const cs = Array.isArray(candles) ? candles.filter((c) => c.length >= 5 && c.slice(1, 5).every(Number.isFinite)) : [];
  cs.forEach((c) => prices.push(c[2], c[3]));
  ctx.textAlign = 'left';
  if (!prices.length) {
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Belum ada level harga valid untuk dipetakan.', W / 2, H / 2);
    return;
  }
  let minP = Math.min(...prices);
  let maxP = Math.max(...prices);
  if (maxP - minP < 1e-9) {
    minP *= 0.995;
    maxP *= 1.005;
  }
  const pad = (maxP - minP) * 0.14;
  minP -= pad;
  maxP += pad;

  const compact = W < 480;
  const fs = compact ? 9.5 : 11;
  ctx.font = `700 ${fs}px "JetBrains Mono", ui-monospace, monospace`;
  const tagW = compact ? 28 : 34;
  const axisW = Math.ceil(tagW + ctx.measureText(maxP.toFixed(dec)).width + 24);
  const padL = compact ? 10 : 16;
  const padT = 30;
  const padB = 22;
  const plotW = Math.max(120, W - padL - axisW - 8);
  const plotH = Math.max(120, H - padT - padB);
  const yOf = (p) => padT + ((maxP - p) / (maxP - minP)) * plotH;

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `800 ${compact ? 11 : 13}px Inter, sans-serif`;
  ctx.fillText(`${pair} · PETA ZONA SMC (${(bias || 'NETRAL').split(/[ -]/)[0]})`, padL, 19);

  ctx.strokeStyle = 'rgba(30,49,84,0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const gy = padT + (plotH * i) / 5;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(padL + plotW, gy);
    ctx.stroke();
    ctx.fillStyle = 'rgba(148,163,184,0.45)';
    ctx.font = `500 ${compact ? 8.5 : 9.5}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.fillText((maxP - ((maxP - minP) * i) / 5).toFixed(dec), padL + plotW + 6, gy + 3);
  }

  const labels = [];
  const dash = (y, color, pattern) => {
    ctx.save();
    ctx.setLineDash(pattern);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.restore();
  };

  if (Number.isFinite(price)) {
    dash(yOf(price), '#F5C451', [4, 4]);
    labels.push({ y: yOf(price), tag: 'REF', price: price.toFixed(dec), color: '#F5C451', dark: true });
  }

  act.forEach((z, i) => {
    const buy = z.side === 'BUY';
    const yTop = yOf(z.high);
    const yBot = yOf(z.low);
    const h = Math.max(10, yBot - yTop);
    ctx.fillStyle = buy ? 'rgba(34,197,94,0.20)' : 'rgba(244,63,94,0.20)';
    ctx.strokeStyle = buy ? '#22C55E' : '#F43F5E';
    ctx.lineWidth = 1.4;
    ctx.fillRect(padL, yTop, plotW, h);
    ctx.strokeRect(padL, yTop, plotW, h);
    ctx.fillStyle = buy ? '#86EFAC' : '#FDA4AF';
    ctx.font = `800 ${compact ? 8.5 : 10}px Inter, sans-serif`;
    ctx.fillText(`${z.side} Z${z.zone ?? i + 1}`, padL + 6, yTop + Math.min(13, h / 2 + 3.5));

    if (i === 0 || act.length === 1) {
      if (Number.isFinite(z.slVal)) {
        dash(yOf(z.slVal), '#F43F5E', [3, 3]);
        labels.push({ y: yOf(z.slVal), tag: 'SL', price: z.slVal.toFixed(dec), color: '#F43F5E', dark: false });
      }
      if (Number.isFinite(z.tp1Val)) {
        dash(yOf(z.tp1Val), '#38BDF8', [5, 3]);
        labels.push({ y: yOf(z.tp1Val), tag: 'TP1', price: z.tp1Val.toFixed(dec), color: '#38BDF8', dark: true });
      }
      if (Number.isFinite(z.tp2Val)) {
        dash(yOf(z.tp2Val), '#22C55E', [5, 3]);
        labels.push({ y: yOf(z.tp2Val), tag: 'TP2', price: z.tp2Val.toFixed(dec), color: '#22C55E', dark: true });
      }
    }
  });

  // Candle nyata dari data feed server (kiri); zona & garis di atasnya
  if (cs.length) {
    const cw = plotW * 0.56;
    const step = cw / cs.length;
    const bw = Math.max(2, step * 0.62);
    cs.forEach((c, i) => {
      const cx = padL + i * step + step / 2;
      const up = c[4] >= c[1];
      const col = up ? 'rgba(34,197,94,0.9)' : 'rgba(244,63,94,0.9)';
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, yOf(c[2]));
      ctx.lineTo(cx, yOf(c[3]));
      ctx.stroke();
      const top = yOf(Math.max(c[1], c[4]));
      const bot = yOf(Math.min(c[1], c[4]));
      ctx.fillRect(cx - bw / 2, top, bw, Math.max(1.2, bot - top));
    });
    if (tfLabel) {
      ctx.fillStyle = 'rgba(148,163,184,0.8)';
      ctx.font = `600 ${compact ? 8.5 : 9.5}px Inter, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(`Candle ${tfLabel} (data feed)`, padL + 4, padT + plotH - 6);
    }
  }

  const cwAll = plotW * 0.56;

  // EMA 20 dari close candle feed
  if (cs.length && Array.isArray(ema) && ema.length === cs.length && cs.length > 3) {
    const step = cwAll / cs.length;
    ctx.save();
    ctx.strokeStyle = 'rgba(192,132,252,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ema.forEach((v, i) => {
      const x = padL + i * step + step / 2;
      if (i === 0) ctx.moveTo(x, yOf(v));
      else ctx.lineTo(x, yOf(v));
    });
    ctx.stroke();
    ctx.restore();
  }

  // BOS / CHoCH asli dari mesin SMC (garis pendek di candle yang menembus level)
  if (cs.length && Array.isArray(events) && events.length) {
    const step = cwAll / cs.length;
    const t0 = cs[0][0];
    const tN = cs[cs.length - 1][0];
    const span = cs.length > 1 ? (tN - t0) / (cs.length - 1) : 0;
    events.forEach(([type, dir, level, time]) => {
      if (!(level >= minP && level <= maxP) || !(span > 0) || time < t0 - span / 2 || time > tN + span / 2) return;
      const idx = Math.max(0, Math.min(cs.length - 1, Math.round((time - t0) / span)));
      const x1 = padL + idx * step;
      const x2 = Math.min(padL + cwAll, x1 + step * 9);
      const y = yOf(level);
      const col = type === 'CHoCH' ? '#FBBF24' : 'rgba(203,213,225,0.8)';
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      ctx.font = `800 ${compact ? 8 : 9}px Inter, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(`${type} ${dir === 'BULLISH' ? '▲' : '▼'}`, x1 + 2, y + (dir === 'BULLISH' ? 10 : -4));
      ctx.restore();
    });
  }

  // Kotak R:R zona utama: dihitung dari level entry (tengah zona), SL, dan TP pada tabel; ini bukan prediksi harga
  if (cs.length && act[0]) {
    const z = act[0];
    const entry = (z.low + z.high) / 2;
    const tp = Number.isFinite(z.tp2Val) ? z.tp2Val : z.tp1Val;
    const bx = padL + cwAll + 6;
    const bw2 = padL + plotW - bx - 2;
    if (bw2 > 30) {
      const ye = yOf(entry);
      if (Number.isFinite(z.slVal)) {
        ctx.fillStyle = 'rgba(244,63,94,0.13)';
        const ys = yOf(z.slVal);
        ctx.fillRect(bx, Math.min(ye, ys), bw2, Math.abs(ys - ye));
      }
      if (Number.isFinite(tp)) {
        ctx.fillStyle = 'rgba(34,197,94,0.12)';
        const yt = yOf(tp);
        ctx.fillRect(bx, Math.min(ye, yt), bw2, Math.abs(yt - ye));
      }
      ctx.strokeStyle = 'rgba(248,250,252,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, ye);
      ctx.lineTo(bx + bw2, ye);
      ctx.stroke();
      if (Number.isFinite(z.slVal) && Number.isFinite(tp) && Math.abs(entry - z.slVal) > 0) {
        const r = Math.abs(tp - entry) / Math.abs(entry - z.slVal);
        ctx.fillStyle = '#F8FAFC';
        ctx.font = `800 ${compact ? 9 : 10.5}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`R:R 1:${r.toFixed(2)}`, bx + bw2 / 2, ye + (z.side === 'BUY' ? 14 : -6));
        ctx.textAlign = 'left';
      }
    }
  }

  // Hindari label saling menimpa
  const ph = compact ? 17 : 20;
  const gap = ph + 4;
  labels.sort((a, b) => a.y - b.y);
  labels.forEach((l, i) => {
    l.dy = Math.max(padT + ph / 2, Math.min(H - padB - ph / 2, l.y));
    if (i > 0 && l.dy - labels[i - 1].dy < gap) l.dy = labels[i - 1].dy + gap;
  });
  for (let i = labels.length - 1; i >= 0; i--) {
    const maxB = H - padB - ph / 2;
    if (labels[i].dy > maxB) labels[i].dy = maxB;
    if (i > 0 && labels[i].dy - labels[i - 1].dy < gap) labels[i - 1].dy = labels[i].dy - gap;
  }
  const axisX = padL + plotW + 4;
  labels.forEach((l) => {
    if (Math.abs(l.dy - l.y) > 2) {
      ctx.strokeStyle = l.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL + plotW, l.y);
      ctx.lineTo(axisX + 2, l.dy);
      ctx.stroke();
    }
    const px = axisX + 2;
    const py = l.dy - ph / 2;
    const tw = axisW - 4;
    ctx.fillStyle = '#0A1529';
    ctx.strokeStyle = l.color;
    ctx.lineWidth = 1.2;
    rr(ctx, px, py, tw, ph, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = l.color;
    rr(ctx, px, py, tagW, ph, 3);
    ctx.fill();
    ctx.fillStyle = l.dark ? '#041220' : '#FFFFFF';
    ctx.font = `800 ${compact ? 8.5 : 9.5}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(l.tag, px + tagW / 2, l.dy + 3.2);
    ctx.fillStyle = '#F8FAFC';
    ctx.font = `700 ${fs}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(l.price, px + tw - 5, l.dy + 3.5);
    ctx.textAlign = 'left';
  });
}

export default function ZoneMap({ zones, price, dec = 5, pair = '', bias = '', onToast, candles = null }) {
  const wrap = useRef(null);
  const cv = useRef(null);
  const [filter, setFilter] = useState('ALL');
  const tfs = candles?.bars ? ['M15', 'H1', 'H4'].filter((t) => candles.bars[t]?.length) : [];
  const [tf, setTf] = useState('H1');
  const useTf = tfs.includes(tf) ? tf : tfs[0] || '';
  const nShow = typeof window !== 'undefined' && window.innerWidth < 480 ? 36 : 56;
  const cdl = useTf ? candles.bars[useTf].slice(-nShow) : null;
  const emaOf = (n) => (useTf ? emaSeries(candles.bars[useTf].map((b) => b[4])).slice(-n) : null);
  const evs = useTf ? candles?.events?.[useTf] || null : null;
  const [modalUrl, setModalUrl] = useState('');

  const paint = useCallback(() => {
    if (!wrap.current || !cv.current) return;
    const r = wrap.current.getBoundingClientRect();
    const W = Math.max(300, Math.round(r.width));
    const H = Math.max(260, Math.round(r.height));
    drawZoneMap(cv.current, W, H, Math.min(window.devicePixelRatio || 1, 2), { zones, price, dec, pair, bias, filter, candles: cdl, tfLabel: useTf, ema: emaOf(nShow), events: evs });
  }, [zones, price, dec, pair, bias, filter, candles, useTf]);

  useEffect(() => {
    paint();
    if (!window.ResizeObserver || !wrap.current) return undefined;
    const ro = new ResizeObserver(() => requestAnimationFrame(paint));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [paint]);

  const openExport = () => {
    const off = document.createElement('canvas');
    drawZoneMap(off, 1200, 675, 1, { zones, price, dec, pair, bias, filter, candles: useTf ? candles.bars[useTf].slice(-64) : null, tfLabel: useTf, ema: emaOf(64), events: evs });
    setModalUrl(off.toDataURL('image/png'));
  };

  const saveOrShare = async () => {
    try {
      const blob = await (await fetch(modalUrl)).blob();
      const name = `AureusDesk_${pair || 'SMC'}_Peta_Zona.png`;
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      onToast?.('PNG diunduh');
    } catch {
      onToast?.('Tekan lama gambar untuk menyimpan');
    }
  };

  if (!zones.some((z) => z.valid)) return null;

  return (
    <section className="rounded-2xl border border-line/90 bg-night/50 p-3.5 shadow-lg sm:p-4 print:hidden">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-strong sm:text-base">🗺️ Peta Visual Zona SMC</h2>
          <p className="text-[11px] text-muted">Level dari tabel Bagian 3 · label SL / TP tidak saling menimpa</p>
        </div>
        <button type="button" onClick={openExport} className="rounded-lg border border-gold/40 bg-gold/15 px-2.5 py-1.5 text-[11px] font-bold text-gold transition hover:bg-gold/25">
          🖼️ Perbesar / Simpan PNG
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`tf-chip ${filter === k ? 'active' : ''}`}>
            {label}
          </button>
        ))}
      </div>
      {tfs.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">Candle:</span>
          {tfs.map((t) => (
            <button key={t} type="button" onClick={() => setTf(t)} className={`tf-chip ${useTf === t ? 'active' : ''}`}>{t}</button>
          ))}
        </div>
      )}
      <div ref={wrap} className="relative h-[320px] w-full overflow-hidden rounded-xl border border-line/90 bg-[#060C19] shadow-inner sm:h-[390px] lg:h-[440px]">
        <canvas ref={cv} className="block h-full w-full" />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-up bg-up/40" />Zona BUY</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-down bg-down/40" />Zona SELL</span>
        <span className="flex items-center gap-1.5"><span className="h-[2px] w-3 bg-aurum" />Harga terakhir</span>
        <span className="flex items-center gap-1.5"><span className="h-[2px] w-3 bg-gold" />TP1</span>
        {tfs.length > 0 && <span className="flex items-center gap-1.5"><span className="h-[2px] w-3" style={{ background: '#C084FC' }} />EMA 20</span>}
        {tfs.length > 0 && <span className="flex items-center gap-1.5"><span className="h-[2px] w-3 border-t border-dashed" style={{ borderColor: '#FBBF24' }} />BOS / CHoCH</span>}
        {tfs.length > 0 ? (
          <span className="basis-full">Candle, EMA 20, dan BOS/CHoCH berasal dari data feed server (bukan dari piksel screenshot). Kotak R:R dihitung dari entry (tengah zona), SL, dan TP di tabel, bukan prediksi harga.</span>
        ) : (
          <span className="basis-full">Tanpa candle: pair/analisa ini tidak memakai data feed server (hanya screenshot) atau dibuka dari riwayat.</span>
        )}
      </div>

      {modalUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-md sm:p-5" onClick={() => setModalUrl('')}>
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gold/35 bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="text-sm font-extrabold text-strong">🗺️ Pratinjau HD Peta Zona</h3>
              <button type="button" onClick={() => setModalUrl('')} className="h-8 w-8 rounded-xl bg-night font-bold text-soft hover:text-strong" aria-label="Tutup">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto bg-[#050A14] p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={modalUrl} alt="Peta zona SMC" className="h-auto w-full rounded-xl border border-line" />
            </div>
            <div className="flex justify-end border-t border-line bg-panel p-3.5">
              <button type="button" onClick={saveOrShare} className="btn-gold px-4 py-2 text-xs">⬇️ Simpan / Bagikan PNG</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
