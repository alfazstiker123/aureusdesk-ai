'use client';

import { useEffect, useRef, useState } from 'react';
import { THEMES } from '@/lib/themes';
import { NAV_MODES } from '@/lib/sections';

// Panel Pengaturan: bottom-sheet di HP, dialog di tablet/desktop. Berisi Tema & API Key.
export default function SettingsSheet({ open, onClose, theme, onTheme, navMode, onNavMode, apiKey, onApiKey, strict, onStrict, mode, onMode, gwModel, onGwModel, onTestGateway, onLoadModels, marketSource = 'cloud', onMarketSource, zoneStyle = 'two', onZoneStyle }) {
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
          <h3 className="field-label">Sumber Data Candle</h3>
          <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="Sumber data candle">
            {[
              { k: 'cloud', t: 'Cloud Data (gratis, disarankan)', d: 'OHLC dari feed publik exchange (Kraken/Binance), tanpa kunci & tanpa PC. Saat ini hanya BTCUSD; pair lain otomatis screenshot saja.' },
              { k: 'mt4', t: 'MT4 EA (PC/VPS)', d: 'Memakai candle broker dari EA MT4 yang berjalan di desktop/VPS.' },
              { k: 'auto', t: 'Cloud lalu MT4', d: 'Cloud sebagai utama; mencoba MT4 bila Cloud tidak tersedia.' },
              { k: 'screenshot', t: 'Screenshot saja', d: 'Mode lama V1 tanpa OHLC Cloud/MT4.' },
            ].map((m) => {
              const on = marketSource === m.k;
              return (
                <button key={m.k} type="button" role="radio" aria-checked={on} onClick={() => onMarketSource?.(m.k)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition ${on ? 'border-gold bg-gold/10 ring-1 ring-gold/50' : 'border-line bg-panel2 hover:border-gold/40'}`}>
                  <span className="block text-sm font-semibold">{m.t}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted">{m.d}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] leading-snug text-muted">Kunci API data pasar hanya disimpan di server Vercel. Provider Cloud bukan harga broker; cocokkan selisih harga sebelum memakai level.</p>
        </section>

        <section className="mb-5">
          <h3 className="field-label">Mode Analisis</h3>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Mode analisis">
            {[
              { k: 'single', t: 'Gemini langsung', d: 'Default. Satu panggilan, paling cepat & stabil.' },
              { k: '2stage', t: '2 tahap (eksperimen)', d: 'Gemini baca gambar → model gateway menulis analisa.' },
            ].map((m) => {
              const on = mode === m.k;
              return (
                <button
                  key={m.k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onMode(m.k)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition ${on ? 'border-gold bg-gold/10 ring-1 ring-gold/50' : 'border-line bg-panel2 hover:border-gold/40'}`}
                >
                  <span className="block text-sm font-semibold">{m.t}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted">{m.d}</span>
                </button>
              );
            })}
          </div>
          {mode === '2stage' ? (
            <div className="mt-2">
              <label className="field-label" htmlFor="gwmodel">Model tahap 2 (gateway)</label>
              <input
                id="gwmodel"
                value={gwModel}
                onChange={(e) => onGwModel(e.target.value.trim())}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 text-sm"
              />
              <GatewayTest onTest={onTestGateway} />
              <ModelPicker onLoad={onLoadModels} current={gwModel} onPick={onGwModel} />
              <p className="mt-1 text-[11px] leading-snug text-muted">Bila tahap 1/2 gagal, otomatis kembali ke Gemini langsung. Lebih lambat (2 panggilan).</p>
            </div>
          ) : null}
        </section>

        <section className="mb-5">
          <h3 className="field-label">Gaya Zona</h3>
          <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="Gaya zona">
            {[
              { k: 'two', t: '2 Zona (Intraday + Swing) — bawaan', d: 'Zona 1 Intraday, Zona 2 Swing. 4 order maksimal (2 per arah).' },
              { k: 'three', t: '3 Zona (Scalping + Intraday + Swing)', d: 'Zona 1 Scalping (dekat, 1–2 jam), Zona 2 Intraday (4–6 jam), Zona 3 Swing (sampai Daily Close). 6 order maksimal; batas risiko tetap per arah. Butuh Validator Zona AKTIF.' },
            ].map((o) => {
              const on = zoneStyle === o.k;
              return (
                <button
                  key={o.k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onZoneStyle && onZoneStyle(o.k)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition ${
                    on ? 'border-gold bg-gold/10 ring-1 ring-gold/50' : 'border-line bg-panel2 hover:border-gold/40'
                  }`}
                >
                  <span className="block text-xs font-semibold">{o.t}</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted">{o.d}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mb-5">
          <h3 className="field-label">Validator Zona &amp; Konflik Order</h3>
          <button
            type="button"
            role="switch"
            aria-checked={strict}
            onClick={() => onStrict(!strict)}
            className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition ${
              strict ? 'border-gold bg-gold/10' : 'border-line bg-panel2'
            }`}
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{strict ? 'AKTIF' : 'MATI'}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                Batas jarak Zona 1/2 per pair, deteksi order melawan bias (DISARANKAN BATALKAN) dan terlalu jauh (DISARANKAN GESER), plus peringatan di Ringkasan
                Cepat. Mati = perilaku prompt lama.
              </span>
            </span>
            <span className={`relative h-6 w-11 flex-none rounded-full transition ${strict ? 'bg-gold' : 'bg-line'}`} aria-hidden="true">
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${strict ? 'left-[22px]' : 'left-0.5'}`} />
            </span>
          </button>
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

function GatewayTest({ onTest }) {
  const [res, setRes] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setRes('');
          setRes(await onTest());
          setBusy(false);
        }}
        className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
      >
        {busy ? 'Menguji…' : 'Uji Gateway'}
      </button>
      {res ? <p className="mt-1 break-words text-[11px] text-muted">{res}</p> : null}
    </div>
  );
}

const PRESETS = [
  ['DeepSeek V4.1 Flash', 1], ['DeepSeek V4 Flash', 1], ['GLM-5.3 Flash', 1], ['MiMo V2.6 Flash', 1],
  ['Kimi K2.7 Code Highspeed', 2], ['Kimi K2.7 Code', 2], ['GLM-5.2', 2], ['GLM-5.3', 2], ['MiMo V2.5 Pro', 2], ['MiMo V2.6 Pro', 2], ['DeepSeek V4 Pro', 2],
  ['Kimi K2.8', 3], ['GPT-6 Luna', 3],
];
const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
const slug = (x) => String(x).toLowerCase().replace(/[^a-z0-9.]+/g, '-');
// Cocokkan nama tampilan dengan ID asli gateway bila daftar sudah dimuat; kalau tidak, pakai tebakan slug.
function resolveId(name, models) {
  const n = norm(name);
  const hit = (models || []).find((m) => norm(m.id) === n);
  return hit ? hit.id : slug(name);
}
const TIER = { 1: 'Murah / cepat', 2: 'Menengah', 3: 'Tertinggi' };
function ModelPicker({ onLoad, current, onPick }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const models = state?.ok ? state.models : null;
  return (
    <div className="mt-2">
      <div className="mb-2 rounded-xl border border-line p-2">
        <p className="mb-1 text-[10px] text-muted">Pilihan cepat (murah → tertinggi, urutan perkiraan). ID ditebak dari nama; bila gagal, muat daftar model lalu pilih ID aslinya.</p>
        {[1, 2, 3].map((t) => (
          <div key={t} className="mb-1.5">
            <div className="text-[11px] font-semibold text-gold">{t}. {TIER[t]}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {PRESETS.filter((x) => x[1] === t).map(([name]) => {
                const id = resolveId(name, models);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => onPick(id)}
                    className={`rounded-md border px-2 py-1 text-[11px] ${current === id ? 'border-gold bg-gold/10' : 'border-line bg-panel2'}`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setState(await onLoad());
          setBusy(false);
        }}
        className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
      >
        {busy ? 'Memuat…' : 'Muat Daftar Model'}
      </button>
      {state && !state.ok ? <p className="mt-1 text-[11px] text-muted">Gagal: {state.error}</p> : null}
      {state?.ok ? (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-line p-2">
          <p className="mb-1 text-[10px] text-muted">Kasta = perkiraan dari nama model, bukan harga resmi. Cek harga di dashboard gateway.</p>
          {[1, 2, 3].map((t) => {
            const list = state.models.filter((m) => m.tier === t);
            if (!list.length) return null;
            return (
              <div key={t} className="mb-2">
                <div className="text-[11px] font-semibold text-gold">{t}. {TIER[t]} ({list.length})</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {list.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onPick(m.id)}
                      className={`rounded-md border px-2 py-1 text-[11px] ${current === m.id ? 'border-gold bg-gold/10' : 'border-line bg-panel2'}`}
                    >
                      {m.id}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
