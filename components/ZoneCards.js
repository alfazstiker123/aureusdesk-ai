'use client';

import { useRef, useState } from 'react';
import CandleSvg, { detectPattern } from '@/components/CandleSvg';

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// Angka harga yang disalin: koma ribuan dibuang, desimal opsional (null = apa adanya)
export function copyValue(raw, decimals) {
  const v = String(raw ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!v) return '';
  if (decimals != null && Number.isFinite(Number(v[0]))) return Number(v[0]).toFixed(decimals);
  return v[0];
}

function Copy({ value, label, decimals }) {
  const [ok, setOk] = useState(false);
  const t = useRef(null);
  const v = copyValue(value, decimals);
  if (!v) return null;
  const go = async () => {
    const done = await copyText(v);
    try {
      if (done && navigator.vibrate) navigator.vibrate(15);
    } catch {}
    setOk(done);
    clearTimeout(t.current);
    t.current = setTimeout(() => setOk(false), 1400);
  };
  return (
    <button type="button" onClick={go} title={`Salin ${v}`} aria-label={`Salin ${v}`} className={`zcopy font-mono ${ok ? 'is-ok' : ''}`}>
      <span aria-hidden="true">{ok ? '✓' : '📋'}</span>
      {label ? <span>{ok ? 'Tersalin' : label}</span> : ok ? <span>Tersalin</span> : null}
    </button>
  );
}

function Tile({ cls, title, titleCls, value, decimals }) {
  return (
    <div className={`metric-tile ${cls} flex items-center justify-between gap-2`}>
      <div className="min-w-0">
        <div className={`text-[10px] font-bold ${titleCls}`}>{title}</div>
        <div className="truncate font-mono text-xs font-extrabold text-strong sm:text-sm">{value || '-'}</div>
      </div>
      <Copy value={value} decimals={decimals} />
    </div>
  );
}

export function ExecCards({ rows, decimals, onGuide }) {
  return (
    <div className="my-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
      {rows.map((r, i) => {
        const buy = r.side === 'BUY';
        const card = buy ? 'zone-card-buy' : 'zone-card-sell';
        const tc = buy ? 'text-up' : 'text-down';
        const pill = buy ? 'bg-up/15 text-up border-up/30' : 'bg-down/15 text-down border-down/30';
        if (!r.valid) {
          return (
            <div key={i} className={`${card} p-4 opacity-80`}>
              <div className="flex items-center justify-between gap-2 border-b border-line/60 pb-2.5">
                <span className="text-[11px] font-bold text-gold">Zona & Strategi</span>
                <span className={`text-right text-xs font-extrabold sm:text-sm ${tc}`}>{r.title}</span>
              </div>
              <div className="flex items-center justify-between py-3 text-xs">
                <span className="font-semibold text-muted">Zona Entry</span>
                <span className="font-semibold text-soft">{r.entryZone || 'Tidak ada level valid (tunggu)'}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-muted">
                <div className="metric-tile">SL: -</div>
                <div className="metric-tile">TP1: -</div>
                <div className="metric-tile">TP2: -</div>
              </div>
            </div>
          );
        }
        const pat = detectPattern(r.confirmation, buy);
        return (
          <div key={i} className={`${card} flex flex-col`}>
            <div className="flex items-center justify-between gap-2 border-b border-line/70 bg-white/[0.02] px-4 py-3">
              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-extrabold ${pill}`}>{r.side}</span>
              <span className={`text-right text-xs font-extrabold leading-tight sm:text-sm ${tc}`}>{r.title}</span>
            </div>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-col justify-between gap-2 border-b border-line/60 pb-2.5 sm:flex-row sm:items-center">
                <div>
                  <div className="text-[11px] font-bold text-gold">Zona Entry</div>
                  <div className="mt-0.5 font-mono text-sm font-extrabold text-strong">{r.entryZone}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.entryRaw.map((n) => (
                    <Copy key={n} value={n} label={copyValue(n, decimals)} decimals={decimals} />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Tile cls="metric-tile-sl" title="Stop Loss (SL)" titleCls="text-down" value={r.sl} decimals={decimals} />
                <Tile cls="metric-tile-tp1" title="Take Profit 1" titleCls="text-gold" value={r.tp1} decimals={decimals} />
                <Tile cls="metric-tile-tp2" title="Take Profit 2" titleCls="text-up" value={r.tp2} decimals={decimals} />
              </div>
              <div className="flex flex-col gap-2.5 rounded-xl border border-line/80 bg-night/80 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-gold">🕯️ Syarat Konfirmasi Candlestick</span>
                  <button type="button" onClick={onGuide} className="text-[10px] font-bold text-aurum hover:underline">Lihat Semua</button>
                </div>
                <p className="text-xs leading-relaxed text-soft">{r.confirmation || '-'}</p>
                <div className="flex flex-col items-center rounded-lg border border-line/70 bg-night p-2">
                  <div className="mb-1 text-[10px] font-bold text-muted">
                    Contoh Visual: <span className={tc}>{pat.label}</span>
                  </div>
                  <CandleSvg type={pat.type} isBuy={buy} />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PendingCards({ rows, decimals }) {
  return (
    <div className="my-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
      {rows.map((r, i) => {
        const buy = r.side === 'BUY';
        const card = buy ? 'zone-card-buy' : 'zone-card-sell';
        const tc = buy ? 'text-up' : 'text-down';
        if (!r.valid) {
          return (
            <div key={i} className={`${card} p-4 opacity-80`}>
              <div className="flex items-center justify-between gap-2 border-b border-line/60 pb-2">
                <span className="text-[11px] font-bold text-gold">Order</span>
                <span className={`text-right text-xs font-extrabold sm:text-sm ${tc}`}>{r.title}</span>
              </div>
              <div className="flex items-center justify-between pt-2.5 text-xs">
                <span className="font-semibold text-muted">Harga Entry</span>
                <span className="font-semibold text-soft">{r.entry || 'Tidak Ada Setup (Tunggu)'}</span>
              </div>
            </div>
          );
        }
        return (
          <div key={i} className={`${card} flex flex-col gap-2.5 p-4`}>
            <div className="flex items-center justify-between gap-2 border-b border-line/70 pb-2">
              <span className="text-[11px] font-bold text-gold">Order</span>
              <span className={`text-right text-xs font-extrabold sm:text-sm ${tc}`}>{r.title}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Tile cls="" title="Harga Entry" titleCls="text-gold" value={r.entry} decimals={decimals} />
              <Tile cls="metric-tile-sl" title="Stop Loss" titleCls="text-down" value={r.sl} decimals={decimals} />
              <Tile cls="metric-tile-tp2" title="Take Profit" titleCls="text-up" value={r.tp} decimals={decimals} />
              <div className="metric-tile flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold text-aurum">Lot Aman</div>
                  <div className="truncate font-mono text-xs font-extrabold text-aurum sm:text-sm">{r.lot || '-'}</div>
                </div>
                <Copy value={r.lot} decimals={null} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-line/60 bg-night/70 p-2 text-center text-[11px]">
              <div><div className="text-muted">Jarak SL</div><div className="font-mono font-bold text-ink">{r.slDist || '-'}</div></div>
              <div><div className="text-muted">Risiko ($)</div><div className="font-mono font-bold text-down">{r.risk || '-'}</div></div>
              <div><div className="text-muted">R:R</div><div className="font-mono font-bold text-up">{r.rr || '-'}</div></div>
            </div>
            <div className="flex items-start justify-between gap-2 border-t border-line/50 pt-1 text-[11px]">
              <span className="flex-none font-semibold text-gold">Waktu Berakhir</span>
              <span className="text-right text-soft">{r.expiry || '-'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
