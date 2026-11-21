'use client';

import { useMemo, useState } from 'react';
import { PAIR_OPTIONS } from '@/lib/pairs';

const ALIAS = { emas: 'xau', perak: 'xag', minyak: 'oil', yen: 'jpy', pound: 'gbp', euro: 'eur', bitcoin: 'btc' };
export const QUICK_PAIRS = ['AUTO', 'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'GBPJPY', 'BTCUSD'];

export function pairLabel(value) {
  const o = PAIR_OPTIONS.find((p) => p.value === value);
  return o ? o.label : value;
}

export function QuickPairs({ value, onPick }) {
  const list = QUICK_PAIRS.filter((v) => PAIR_OPTIONS.some((o) => o.value === v));
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold transition ${
            value === v ? 'border-gold bg-gold/20 text-gold shadow-sm shadow-gold/20' : 'border-line bg-night text-soft hover:border-muted'
          }`}
        >
          {v === 'AUTO' ? 'AUTO' : v}
        </button>
      ))}
    </div>
  );
}

export default function PairPicker({ open, value, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Semua');
  const cats = useMemo(() => ['Semua', ...new Set(PAIR_OPTIONS.map((o) => o.group || 'Otomatis'))], []);
  const list = useMemo(() => {
    const raw = q.trim().toLowerCase();
    const mq = ALIAS[raw] || raw;
    return PAIR_OPTIONS.filter((o) => {
      const g = o.group || 'Otomatis';
      return (cat === 'Semua' || g === cat) && (!mq || o.value.toLowerCase().includes(mq) || o.label.toLowerCase().includes(mq) || g.toLowerCase().includes(mq));
    });
  }, [q, cat]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-line p-4">
          <div>
            <h3 className="text-sm font-extrabold text-strong sm:text-base">Pilih Instrumen / Pair</h3>
            <p className="text-[11px] text-muted">{PAIR_OPTIONS.length - 1} instrumen yang didukung aplikasi + Auto-Detect</p>
          </div>
          <button type="button" onClick={onClose} className="h-8 w-8 rounded-xl bg-night font-bold text-soft hover:text-strong" aria-label="Tutup">✕</button>
        </div>
        <div className="flex flex-col gap-2.5 border-b border-line/70 bg-night/60 p-3.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari pair... mis. emas, eur, yen, btc"
            className="input"
            autoFocus
          />
          <div className="flex flex-wrap gap-1.5">
            {cats.map((c) => (
              <button key={c} type="button" onClick={() => setCat(c)} className={`tf-chip ${cat === c ? 'active' : ''}`}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 overflow-y-auto p-3.5 sm:grid-cols-2">
          {list.length === 0 && <div className="col-span-full py-8 text-center text-xs text-muted">Pair tidak ditemukan.</div>}
          {list.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onPick(o.value);
                onClose();
              }}
              className={`flex items-center justify-between gap-2 rounded-xl border p-3 text-left transition ${
                value === o.value ? 'border-gold bg-gold/15' : 'border-line bg-night/80 hover:border-gold/50 hover:bg-panel2'
              }`}
            >
              <div className="min-w-0">
                <div className="font-mono text-sm font-extrabold text-strong">{o.value}</div>
                <div className="truncate text-[11px] text-muted">{o.label}</div>
              </div>
              <span className="flex-none rounded-md border border-line bg-panel px-2 py-0.5 text-[10px] font-bold text-gold">{o.group || 'Auto'}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
