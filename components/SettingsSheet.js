'use client';

import { useEffect, useRef, useState } from 'react';
import { THEMES } from '@/lib/themes';
import { NAV_MODES } from '@/lib/sections';
import { GATEWAY_MODELS, GATEWAY_PRESETS } from '@/lib/modelPresets';

// Panel Pengaturan: bottom-sheet di HP, dialog di tablet/desktop. Berisi Tema & API Key.
export default function SettingsSheet({ open, onClose, theme, onTheme, navMode, onNavMode, apiKey, onApiKey, aiModel, onAiModel, apiFetch }) {
  const [showKey, setShowKey] = useState(false);
  const [gw, setGw] = useState(null); // hasil Tes Koneksi gateway
  const [testing, setTesting] = useState(false);

  async function testGateway() {
    setTesting(true);
    setGw(null);
    try {
      const res = await apiFetch('/api/health?gateway=1', { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      setGw(j.gateway || { ok: false, error: j.error || `HTTP ${res.status}` });
    } catch (e) {
      setGw({ ok: false, error: e.message || 'Gagal menghubungi server.' });
    }
    setTesting(false);
  }

  const gwModels = [...new Set([...(gw?.models || []), ...GATEWAY_PRESETS])];
  const isPreset = aiModel === 'auto' || /^gemini/i.test(aiModel) || gwModels.includes(aiModel);
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
          <h3 className="field-label">Model AI</h3>
          <select className="input" value={isPreset ? aiModel : '__custom'} onChange={(e) => onAiModel(e.target.value === '__custom' ? '' : e.target.value)} aria-label="Model AI">
            <option value="auto">Otomatis (bawaan server)</option>
            <optgroup label="Google Gemini">
              <option value="gemini-flash-lite-latest">gemini-flash-lite-latest</option>
              <option value="gemini-flash-latest">gemini-flash-latest</option>
            </optgroup>
            <optgroup label="Gateway (OpenAI-compatible)">
              {GATEWAY_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.guess ? ' (id perkiraan)' : ''}
                </option>
              ))}
              {(gw?.models || [])
                .filter((id) => !GATEWAY_PRESETS.includes(id))
                .map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
            </optgroup>
            <option value="__custom">Model lain (ketik manual)…</option>
          </select>
          {!isPreset && (
            <input
              className="input mt-2 font-mono"
              placeholder="id model persis seperti di gateway"
              value={aiModel}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => onAiModel(e.target.value.trim())}
            />
          )}
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Analisa membaca screenshot chart, jadi model gateway harus mendukung gambar (vision). Jika model gagal/tidak mendukung gambar, aplikasi otomatis
            memakai Gemini sebagai cadangan. Kredensial gateway diatur di Vercel (OPENAI_COMPAT_BASE_URL &amp; OPENAI_COMPAT_API_KEY), bukan di sini.
          </p>
          <button type="button" className="btn-ghost mt-2 w-full text-xs" onClick={testGateway} disabled={testing}>
            {testing ? 'Menguji…' : '🔌 Tes Koneksi Gateway'}
          </button>
          {gw && (
            <p className={`mt-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${gw.ok ? 'border-up/40 text-up' : 'border-down/40 text-down'}`}>
              {gw.ok
                ? `✅ Terhubung. ${gw.total} model terdaftar di gateway (ditambahkan ke daftar di atas).`
                : `❌ ${gw.error || 'Gagal'}${gw.status ? ` (HTTP ${gw.status})` : ''}`}
            </p>
          )}
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
