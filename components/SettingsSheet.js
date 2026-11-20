'use client';

import { useEffect, useRef, useState } from 'react';
import { THEMES } from '@/lib/themes';
import { NAV_MODES } from '@/lib/sections';

// Panel Pengaturan: bottom-sheet di HP, dialog di tablet/desktop. Berisi Tema & API Key.
export default function SettingsSheet({ open, onClose, theme, onTheme, navMode, onNavMode, apiKey, onApiKey }) {
  const [showKey, setShowKey] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // cegah halaman di belakang ikut bergulir
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 print:hidden" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-3xl border border-line bg-panel p-5 outline-none sm:rounded-2xl"
        style={{ boxShadow: 'var(--shadow-card)', paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
        <div className="mb-4 flex items-center justify-between">
          <h2 id="settings-title" className="text-base font-bold">⚙️ Pengaturan</h2>
          <button type="button" onClick={onClose} className="btn-ghost h-9 w-9 !p-0" aria-label="Tutup pengaturan">
            ✕
          </button>
        </div>

        <section className="mb-5">
          <h3 className="field-label">Tema Tampilan</h3>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tema tampilan">
            {THEMES.map((t) => {
              const on = theme === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  title={t.hint || t.label}
                  onClick={() => onTheme(t.key)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-[11px] font-semibold transition ${
                    on ? 'border-gold bg-gold/10 text-ink ring-1 ring-gold/50' : 'border-line bg-panel2 text-muted hover:border-gold/40'
                  }`}
                >
                  <span className="flex -space-x-1.5">
                    {t.swatch.map((c, i) => (
                      <span key={i} className="h-4 w-4 rounded-full border border-black/20" style={{ background: c }} />
                    ))}
                  </span>
                  {t.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="mb-5">
          <h3 className="field-label">Navigasi Cepat Hasil Analisa</h3>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Mode navigasi cepat">
            {NAV_MODES.map((m) => {
              const on = navMode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onNavMode(m.key)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition ${
                    on ? 'border-gold bg-gold/10 ring-1 ring-gold/50' : 'border-line bg-panel2 hover:border-gold/40'
                  }`}
                >
                  <span className="block text-xs font-semibold">{m.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted">{m.hint}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <label className="field-label" htmlFor="apikey">
            Gemini API Key (opsional)
          </label>
          <div className="flex gap-2">
            <input
              id="apikey"
              type={showKey ? 'text' : 'password'}
              className="input font-mono"
              placeholder="Kosongkan = pakai key dari server"
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => onApiKey(e.target.value)}
            />
            <button type="button" className="btn-ghost px-3" onClick={() => setShowKey((s) => !s)}>
              {showKey ? 'Sembunyi' : 'Lihat'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Menimpa GEMINI_API_KEY di server. Disimpan hanya di browser ini (localStorage), tidak masuk ke riwayat.
          </p>
        </section>

        <button type="button" onClick={onClose} className="btn-gold mt-6 w-full">
          Selesai
        </button>
      </div>
    </div>
  );
}
