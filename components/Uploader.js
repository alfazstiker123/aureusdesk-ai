'use client';

import { useRef, useState } from 'react';

export const TIMEFRAMES = ['W1', 'D1', 'H4', 'H1', 'M15', 'M5', 'M1', 'Tab Trade MT4', 'Tab Riwayat MT4', 'Lainnya'];
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

export function guessLabel(name = '') {
  const n = name.toLowerCase();
  if (/(trade|posisi|position|order)/.test(n)) return 'Tab Trade MT4';
  if (/(history|riwayat|histori)/.test(n)) return 'Tab Riwayat MT4';
  const m = n.match(/(^|[^a-z0-9])(w1|d1|h4|h1|m15|m5|m1|weekly|daily)([^a-z0-9]|$)/);
  if (m) {
    const k = m[2];
    if (k === 'weekly') return 'W1';
    if (k === 'daily') return 'D1';
    return k.toUpperCase();
  }
  return 'Lainnya';
}

export default function Uploader({ images, onAdd, onRemove, onLabel, onClear, disabled }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);

  const handleFiles = (fileList) => {
    const files = Array.from(fileList || []).filter((f) => ACCEPT.includes(f.type));
    if (files.length) onAdd(files);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!disabled) handleFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
          drag ? 'border-gold bg-gold/5' : 'border-line hover:border-gold/50 bg-night/40'
        } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
      >
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" className="mb-2 text-gold">
          <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-sm font-semibold">Tarik & lepas screenshot di sini, atau ketuk untuk memilih</p>
        <p className="mt-1 text-xs text-muted">
          W1 · D1 · H4 · H1 · M15 · M5 · M1 · Tab Trade/Riwayat MT4 — JPG, PNG, WEBP (bisa banyak sekaligus)
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {images.length > 0 && (
        <>
          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <span>{images.length} gambar dipilih — urutkan label timeframe agar AI membaca Top-Down</span>
            <button type="button" onClick={onClear} disabled={disabled} className="text-down hover:underline disabled:opacity-50">
              Hapus semua
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {images.map((img) => (
              <div key={img.id} className="group relative overflow-hidden rounded-lg border border-line bg-night">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.preview} alt={img.label} className="h-24 w-full object-cover" />
                <button
                  type="button"
                  aria-label="Hapus gambar"
                  disabled={disabled}
                  onClick={() => onRemove(img.id)}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-night/80 text-xs text-ink hover:bg-down"
                >
                  ✕
                </button>
                <div className="p-1.5">
                  <select
                    value={img.label}
                    disabled={disabled}
                    onChange={(e) => onLabel(img.id, e.target.value)}
                    className="w-full rounded-md border border-line bg-panel px-1.5 py-1 text-xs text-gold outline-none focus:border-gold"
                  >
                    {TIMEFRAMES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 truncate text-[10px] text-muted" title={img.file.name}>
                    {img.file.name}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
