'use client';

import { useEffect, useRef, useState } from 'react';
import { THEMES } from '@/lib/themes';
import { NAV_MODES } from '@/lib/sections';

// Panel Pengaturan: bottom-sheet di HP, dialog di tablet/desktop. Berisi Tema & API Key.
export default function SettingsSheet({ open, onClose, theme, onTheme, navMode, onNavMode, apiKey, onApiKey, strict, onStrict, mode, onMode, gwModel, onGwModel, engine = 'gemini', onEngine, geminiModel = '', onGeminiModel, onTestGateway, onLoadModels, marketSource = 'cloud', onMarketSource, zoneStyle = 'two', onZoneStyle, skipZone1 = false, onSkipZone1, connectionId = '', onConnectionId, connList = null, onLoadConnections, balance = '', onBalance, risk = '', onRisk, session = '', onSession, sessions = [], riskUsd = 0 }) {
  const [showKey, setShowKey] = useState(false);
  const riskNum = Number(risk) || 0;
  const SRC = { cloud: 'Cloud', mt4: 'MT4 EA', auto: 'Cloud→MT4', screenshot: 'Screenshot' };
  const chips = [
    { k: 'Data', v: SRC[marketSource] || marketSource },
    { k: 'Zona', v: zoneStyle === 'three' ? (skipZone1 ? '3 (Z1 mati)' : '3') : '2' },
    { k: 'Mode', v: mode === '2stage' ? '2 tahap' : 'Langsung' },
    { k: 'Risiko', v: `${risk || '-'}%` },
    { k: 'Validator', v: strict ? 'ON' : 'OFF' },
    { k: 'AI', v: engine === 'gateway' ? 'Gateway' : 'Gemini' },
  ];
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
        <div className="sticky -top-5 z-10 -mx-5 mb-4 flex items-center justify-between border-b border-line bg-panel px-5 py-3">
          <h2 id="settings-title" className="text-base font-bold">⚙️ Pengaturan</h2>
          <button type="button" onClick={onClose} className="btn-ghost h-9 w-9 !p-0" aria-label="Tutup pengaturan">
            ✕
          </button>
        </div>
        <div className="mb-4 flex flex-wrap gap-1.5" aria-label="Ringkasan setelan aktif">
          {chips.map((c) => (
            <span key={c.k} className="rounded-full border border-line bg-panel2 px-2.5 py-1 text-[10px] font-semibold text-muted">{c.k}: <span className="text-ink">{c.v}</span></span>
          ))}
        </div>
        <Group title="Akun & Risiko" icon="💰" defaultOpen>
        <section className="mb-4 last:mb-0">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="s-balance">Saldo Akun (USD)</label>
              <input id="s-balance" type="number" inputMode="decimal" min="0" step="any" className="input" value={balance} onChange={(e) => onBalance?.(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="s-risk">Risiko per Trade (%)</label>
              <input id="s-risk" type="number" inputMode="decimal" min="0.1" max="100" step="0.1" className="input" value={risk} onChange={(e) => onRisk?.(e.target.value)} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Preset risiko">
            {['0.5', '1', '2'].map((v) => (
              <button key={v} type="button" onClick={() => onRisk?.(v)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${String(risk) === v ? 'border-gold bg-gold/10 ring-1 ring-gold/50' : 'border-line bg-panel2 hover:border-gold/40'}`}>
                {v}%
              </button>
            ))}
            <span className="ml-auto rounded-lg border border-gold/30 bg-gold/5 px-3 py-1.5 text-xs">
              Maks. risiko <b className="text-gold">${Number(riskUsd || 0).toFixed(2)}</b>
            </span>
          </div>
          {riskNum > 2 && (
            <p className={`mt-2 text-[11px] leading-snug ${riskNum > 5 ? 'text-down' : 'text-gold'}`} role="status">
              {riskNum > 5 ? 'Risiko di atas 5% per trade sangat agresif; satu rangkaian loss bisa menggerus akun dengan cepat.' : 'Risiko di atas 2% per trade tergolong agresif. Banyak trader memakai 0,5–1%.'}
            </p>
          )}
          <div className="mt-3">
            <label className="field-label" htmlFor="s-session">Sesi Trading</label>
            <select id="s-session" className="input" value={session} onChange={(e) => onSession?.(e.target.value)}>
              {(sessions || []).map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </div>
          <p className="mt-2 text-[10px] leading-snug text-muted">Pengaturan ini sama dengan kolom di form analisis (satu sumber data); mengubahnya di sini langsung berlaku di sana.</p>
        </section>
        </Group>
        <Group title="Data & Broker" icon="📡" defaultOpen>
        <section className="mb-4 last:mb-0">
          <h3 className="field-label">Sumber Data Candle</h3>
          <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="Sumber data candle">
            {[
              { k: 'cloud', t: 'Cloud Data (gratis, disarankan)', d: 'OHLC dari feed publik exchange (Kraken/Binance), tanpa kunci & tanpa PC. Saat ini hanya BTCUSD; pair lain otomatis screenshot saja.' },
              { k: 'mt4', t: 'MT4 EA (PC/VPS) · Disarankan', d: 'Memakai candle broker dari EA MT4 yang berjalan di desktop/VPS.' },
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
        <section className="mb-4 last:mb-0">
          <h3 className="field-label">Koneksi Broker MT4</h3>
          <p className="mb-2 text-[10px] leading-snug text-muted">Data tiap broker disimpan terpisah (tidak dicampur). Otomatis = koneksi dengan kiriman EA terbaru untuk pair terpilih.</p>
          <div className="flex gap-2">
            <select
              value={connectionId}
              onChange={(e) => onConnectionId && onConnectionId(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-line bg-panel2 px-3 py-2 text-xs"
            >
              <option value="">Otomatis (terbaru)</option>
              {connectionId && !(connList || []).some((c) => c.connectionId === connectionId) && <option value={connectionId}>{connectionId.slice(0, 8)}… (tersimpan)</option>}
              {(connList || []).map((c) => (
                <option key={c.connectionId} value={c.connectionId}>
                  {(c.broker || 'Broker lama')} {c.server ? `· ${c.server}` : ''} · {c.symbol}{c.spec ? (c.spec.valid ? ' · spek ✓' : ' · spek ⚠') : ' · tanpa spek'}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => onLoadConnections && onLoadConnections()} className="flex-none rounded-xl border border-line bg-panel2 px-3 py-2 text-xs font-semibold">Muat</button>
          </div>
          {connList && connList.length === 0 && <p className="mt-1 text-[10px] text-down">Belum ada data EA yang fresh untuk pair ini.</p>}
        </section>
        </Group>
        <Group title="Analisis" icon="🧠" defaultOpen>
        <section className="mb-4 last:mb-0">
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
        </section>
        <section className="mb-4 last:mb-0">
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
          {zoneStyle === 'three' && (
            <button
              type="button"
              role="switch"
              aria-checked={!skipZone1}
              onClick={() => onSkipZone1 && onSkipZone1(!skipZone1)}
              className={`mt-2 flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                skipZone1 ? 'border-line bg-panel2' : 'border-gold bg-gold/10 ring-1 ring-gold/50'
              }`}
            >
              <span>
                <span className="block text-xs font-semibold">Zona 1 (Scalping): {skipZone1 ? 'MATI' : 'AKTIF'}</span>
                <span className="mt-0.5 block text-[10px] leading-snug text-muted">
                  {skipZone1 ? 'Hanya Zona 2 (Intraday) dan Zona 3 (Swing) yang dianalisis. Baris Zona 1 selalu dikosongkan oleh server.' : 'Matikan agar hanya Zona 2 dan Zona 3 yang muncul.'}
                </span>
              </span>
              <span className={`ml-3 flex-none rounded-full px-2 py-0.5 text-[10px] font-bold ${skipZone1 ? 'bg-down/15 text-down' : 'bg-up/15 text-up'}`}>{skipZone1 ? 'OFF' : 'ON'}</span>
            </button>
          )}
        </section>
        <section className="mb-4 last:mb-0">
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
        </Group>
        <Group title="Model AI & Kunci" icon="🤖">
        <section className="mb-4 last:mb-0">
          <h3 className="field-label">Model AI</h3>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Mesin AI">
            {[
              { k: 'gemini', t: 'Gemini', d: 'Model Gemini (bisa baca gambar).' },
              { k: 'gateway', t: 'Model saya (gateway)', d: 'Model gateway menulis analisa & chat. Bila ada screenshot, Gemini hanya membaca gambar dulu.' },
            ].map((m) => {
              const on = engine === m.k;
              return (
                <button key={m.k} type="button" role="radio" aria-checked={on} onClick={() => onEngine?.(m.k)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition ${on ? 'border-gold bg-gold/10 ring-1 ring-gold/50' : 'border-line bg-panel2 hover:border-gold/40'}`}>
                  <span className="block text-sm font-semibold">{m.t}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted">{m.d}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2">
            <label className="field-label" htmlFor="gemmodel">Model Gemini (kosong = default)</label>
            <input id="gemmodel" value={geminiModel} placeholder="gemini-flash-latest" onChange={(e) => onGeminiModel?.(e.target.value.trim())}
              autoCapitalize="off" autoCorrect="off" spellCheck={false} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 text-sm" />
          </div>
          <div className="mt-2">
            <label className="field-label" htmlFor="gwmodel">Model gateway (nama bebas)</label>
            <input id="gwmodel" value={gwModel} onChange={(e) => onGwModel(e.target.value.trim())}
              autoCapitalize="off" autoCorrect="off" spellCheck={false} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 text-sm" />
            <GatewayTest onTest={onTestGateway} />
            <ModelPicker onLoad={onLoadModels} current={gwModel} onPick={onGwModel} />
          </div>
          <p className="mt-2 text-[10px] leading-snug text-muted">Berlaku untuk analisis dan chat. Pembacaan cepat pair/harga dari gambar tetap memakai Gemini Flash-Lite. Model gateway tidak bisa melihat gambar, jadi tanpa screenshot ia bekerja murni dari OHLC MT4. Jika model gagal, analisis menampilkan error (gateway) atau pindah ke model Gemini cadangan.</p>
        </section>
        <section className="mb-4 last:mb-0">
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
        </Group>
        <Group title="Tampilan & Navigasi" icon="🎨">
        <section className="mb-4 last:mb-0">
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
        <section className="mb-4 last:mb-0">
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
        </Group>

        <button type="button" onClick={onClose} className="btn-gold sticky bottom-0 mt-6 w-full">
          Selesai
        </button>
      </div>
    </div>
  );
}

function Group({ title, icon, defaultOpen = false, children }) {
  return (
    <details open={defaultOpen} className="group mb-3 rounded-2xl border border-line bg-panel2/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold select-none [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true">{icon}</span>
        <span className="flex-1">{title}</span>
        <span className="text-xs text-muted transition group-open:rotate-180" aria-hidden="true">▾</span>
      </summary>
      <div className="px-4 pb-4 pt-1">{children}</div>
    </details>
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
        {busy ? 'Menguji (±20 dtk)…' : 'Uji Gateway + Batas Prompt'}
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
// Daftar model gateway milik user (ID persis, kelas & pengali biaya dari dashboard gateway).
const MY_MODELS = [
  ['deepseek-v4-pro', 'A', 1.15], ['deepseek-v4-flash', 'A', 2], ['deepseek-v4-flash-0731', 'A', 2], ['deepseek-v4-flash-vision-exp', 'A', 2.5], ['deepseek-v4-mod', 'A', 3],
  ['deepseek-v4.1-flash', 'A', 2.56], ['deepseek-v4.1-flash-1017', 'A', 3], ['deepseek-v4.1-flash-1017-mod', 'A', 3.5], ['deepseek-v4.1-flash-mod', 'A', 3.2],
  ['glm-5.2', 'B', 1.25], ['glm-5.2-mod', 'B', 3], ['glm-5.3', 'B', 2], ['glm-5.3-flash', 'B', 2], ['glm-5.3-flash-mod', 'B', 3.5],
  ['kimi-k2.7-code', 'B', 1], ['kimi-k2.7-code-highspeed', 'B', 1.5], ['kimi-k2.8', 'B', 2],
  ['mimo-v2.5-pro', 'B', 1.4], ['mimo-v2.6-flash', 'B', 2], ['mimo-v2.6-pro', 'B', 2],
];

function ModelPicker({ onLoad, current, onPick }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const models = state?.ok ? state.models : null;
  return (
    <div className="mt-2">
      <div className="mb-2 rounded-xl border border-line p-2">
        <p className="mb-1 text-[10px] text-muted">Model gateway Anda (ID persis; ×N = pengali biaya dari gateway). Ketuk untuk memilih.</p>
        <div className="mb-2 flex flex-wrap gap-1">
          {MY_MODELS.map(([id, cls, mult]) => (
            <button key={id} type="button" onClick={() => onPick(id)}
              className={`rounded-md border px-2 py-1 text-[11px] ${current === id ? 'border-gold bg-gold/10' : 'border-line bg-panel2'}`}>
              {id} <span className="text-muted">{cls} ×{mult}</span>
            </button>
          ))}
        </div>
      </div>
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
