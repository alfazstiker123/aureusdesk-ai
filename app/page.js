'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Uploader, { guessLabel, TIMEFRAMES } from '@/components/Uploader';
import HistoryPanel, { biasTone, toneClass, formatWIB } from '@/components/HistoryPanel';
import MarkdownView from '@/components/MarkdownView';
import PinGate from '@/components/PinGate';
import CalendarWidget from '@/components/CalendarWidget';
import { compressImage, makeThumbnail, formatKB } from '@/lib/imageCompress';
import { PAIR_OPTIONS } from '@/lib/pairs';

const SESSIONS = ['Sesi Asia', 'Sesi Eropa', 'Sesi New York'];
const MAX_IMAGES = 12;
const MAX_PAYLOAD = 4_000_000; // byte base64, di bawah limit 4.5MB Vercel

const STAGES = [
  { key: 'compress', label: 'Mengompresi chart...' },
  { key: 'search', label: 'Memuat kalender ekonomi live & menganalisa chart...' },
  { key: 'save', label: 'Menyusun setup teknikal & menyimpan ke Supabase...' },
];

const LS = {
  key: 'aureus_gemini_key',
  balance: 'aureus_balance',
  risk: 'aureus_risk',
  pin: 'aureus_pin',
  pair: 'aureus_pair',
};

function detectSession() {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(new Date())
  );
  if (h >= 6 && h < 14) return 'Sesi Asia';
  if (h >= 14 && h < 19) return 'Sesi Eropa';
  return 'Sesi New York';
}

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 413) return { error: 'Payload terlalu besar (limit Vercel 4.5MB). Kurangi jumlah gambar.' };
    if (res.status === 504) return { error: 'Timeout server. Coba kurangi jumlah gambar lalu ulangi.' };
    return { error: text?.slice(0, 200) || `HTTP ${res.status}` };
  }
}

function tfOrder(label) {
  const i = TIMEFRAMES.indexOf(label);
  return i === -1 ? 99 : i;
}

export default function Home() {
  // Pengaturan
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [balance, setBalance] = useState('1000');
  const [risk, setRisk] = useState('2');
  const [session, setSession] = useState('Sesi Asia');
  const [pair, setPair] = useState('AUTO');

  // Kunci PIN: 'checking' | 'locked' | 'open'
  const [auth, setAuth] = useState('checking');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const pinRef = useRef('');

  // Upload & proses
  const [images, setImages] = useState([]);
  const [stage, setStage] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [activeId, setActiveId] = useState(null);

  // Riwayat
  const [history, setHistory] = useState([]);
  const [histLoading, setHistLoading] = useState(true);
  const [histError, setHistError] = useState('');
  const [busyId, setBusyId] = useState(null);

  // UI
  const [tab, setTab] = useState('analisa'); // mobile
  const [toast, setToast] = useState('');
  const resultRef = useRef(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const loading = stage !== null;
  const riskUsd = ((Number(balance) || 0) * (Number(risk) || 0)) / 100;

  // ---- init dari localStorage
  useEffect(() => {
    try {
      setApiKey(localStorage.getItem(LS.key) || '');
      const b = localStorage.getItem(LS.balance);
      const r = localStorage.getItem(LS.risk);
      if (b) setBalance(b);
      if (r) setRisk(r);
      const sp = localStorage.getItem(LS.pair);
      if (sp && PAIR_OPTIONS.some((o) => o.value === sp)) setPair(sp);
    } catch {}
    setSession(detectSession());
    checkStoredPin();
    return () => imagesRef.current.forEach((i) => URL.revokeObjectURL(i.preview));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (k, v) => {
    try {
      if (v) localStorage.setItem(k, v);
      else localStorage.removeItem(k);
    } catch {}
  };

  useEffect(() => {
    if (auth === 'open') loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  // ---- timer loading
  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [loading]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3200);
  }, []);

  // ---- PIN
  async function verifyPin(pin) {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    const data = await safeJson(res);
    return { ok: res.ok, error: data.error };
  }

  async function checkStoredPin() {
    let stored = '';
    try {
      stored = localStorage.getItem(LS.pin) || '';
    } catch {}
    if (!stored) {
      setAuth('locked');
      return;
    }
    try {
      const r = await verifyPin(stored);
      if (r.ok) {
        pinRef.current = stored;
        setAuth('open');
      } else {
        persist(LS.pin, '');
        setAuth('locked');
      }
    } catch {
      setAuth('locked');
      setAuthError('Tidak bisa menghubungi server. Cek koneksi lalu masukkan PIN.');
    }
  }

  async function submitPin(pin) {
    setAuthBusy(true);
    setAuthError('');
    try {
      const r = await verifyPin(pin);
      if (!r.ok) {
        setAuthError(r.error || 'PIN salah.');
        return;
      }
      pinRef.current = pin;
      persist(LS.pin, pin);
      setAuth('open');
    } catch {
      setAuthError('Tidak bisa menghubungi server.');
    } finally {
      setAuthBusy(false);
    }
  }

  function lockApp() {
    pinRef.current = '';
    persist(LS.pin, '');
    setHistory([]);
    setResult(null);
    setActiveId(null);
    setAuthError('');
    setAuth('locked');
  }

  // fetch ke API internal dengan PIN; 401 -> kunci ulang
  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: { ...(opts.headers || {}), 'x-app-pin': pinRef.current },
    });
    if (res.status === 401) {
      lockApp();
      setAuthError('PIN tidak valid lagi. Masukkan ulang.');
    }
    return res;
  }

  // ---- riwayat
  async function loadHistory() {
    setHistLoading(true);
    setHistError('');
    try {
      const res = await apiFetch('/api/history', { cache: 'no-store' });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setHistory(data.items || []);
    } catch (e) {
      setHistError(e.message || 'Gagal memuat riwayat.');
    } finally {
      setHistLoading(false);
    }
  }

  async function openHistory(item) {
    setBusyId(item.id);
    try {
      const res = await apiFetch(`/api/history/${item.id}`, { cache: 'no-store' });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      const it = data.item;
      setResult({
        markdown: it.analysis_markdown,
        bias: it.summary_bias,
        meta: {
          created_at: it.created_at,
          session: it.session_label,
          balance: it.account_balance,
          risk: it.risk_percent,
          pair: it.pair,
        },
        thumbnails: it.thumbnails || [],
      });
      setActiveId(it.id);
      setError('');
      setTab('analisa');
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (e) {
      showToast(e.message || 'Gagal membuka analisa.');
    } finally {
      setBusyId(null);
    }
  }

  // Simpan evaluasi (Hit TP / Hit SL / BEP / Cancel) -> PATCH ke Supabase, rekap ikut terhitung ulang
  async function evaluateHistory(item, payload) {
    try {
      const res = await apiFetch(`/api/history/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setHistory((h) => h.map((x) => (x.id === item.id ? { ...x, ...data.item } : x)));
      showToast('✅ Evaluasi tersimpan');
      return true;
    } catch (e) {
      showToast(e.message || 'Gagal menyimpan evaluasi.');
      return false;
    }
  }

  async function deleteHistory(item) {
    if (!window.confirm(`Hapus analisa ${formatWIB(item.created_at)}?`)) return;
    setBusyId(item.id);
    try {
      const res = await apiFetch(`/api/history/${item.id}`, { method: 'DELETE' });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setHistory((h) => h.filter((x) => x.id !== item.id));
      if (activeId === item.id) {
        setActiveId(null);
        setResult(null);
      }
      showToast('Analisa dihapus.');
    } catch (e) {
      showToast(e.message || 'Gagal menghapus.');
    } finally {
      setBusyId(null);
    }
  }

  // ---- upload
  function addFiles(files) {
    setImages((prev) => {
      const room = MAX_IMAGES - prev.length;
      if (room <= 0) {
        showToast(`Maksimal ${MAX_IMAGES} gambar.`);
        return prev;
      }
      const next = files.slice(0, room).map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        label: guessLabel(file.name),
        preview: URL.createObjectURL(file),
      }));
      if (files.length > room) showToast(`Hanya ${room} gambar ditambahkan (maks ${MAX_IMAGES}).`);
      return [...prev, ...next];
    });
  }

  function removeImage(id) {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.preview);
      return prev.filter((i) => i.id !== id);
    });
  }

  function clearImages() {
    images.forEach((i) => URL.revokeObjectURL(i.preview));
    setImages([]);
  }

  // ---- generate
  async function handleGenerate() {
    setError('');
    if (!images.length) {
      setError('Upload minimal 1 screenshot chart terlebih dahulu.');
      return;
    }
    if (!(Number(balance) > 0)) {
      setError('Isi Saldo Akun (USD) dengan angka lebih dari 0.');
      return;
    }
    if (!(Number(risk) > 0 && Number(risk) <= 100)) {
      setError('Persentase risiko harus di antara 0 - 100.');
      return;
    }

    setResult(null);
    setActiveId(null);

    try {
      // 1) Kompres (urut Top-Down sesuai label)
      setStage('compress');
      const ordered = [...images].sort((a, b) => tfOrder(a.label) - tfOrder(b.label));
      const compressed = [];
      const thumbs = [];
      // Anggaran adaptif: sedikit gambar -> lebih tajam; banyak gambar -> dikecilkan agar muat
      const perImgBytes = Math.min(1_300_000, Math.floor((MAX_PAYLOAD * 0.75 * 0.97) / ordered.length));
      const maxWidth = ordered.length <= 3 ? 1920 : ordered.length <= 6 ? 1600 : 1280;
      for (const img of ordered) {
        const c = await compressImage(img.file, { maxWidth, maxBytes: perImgBytes });
        compressed.push({ label: img.label, mimeType: c.mimeType, data: c.base64 });
        const t = await makeThumbnail(img.file);
        thumbs.push({ label: img.label, data: t.base64 });
      }
      const total = compressed.reduce((s, c) => s + c.data.length, 0);
      if (total > MAX_PAYLOAD) {
        throw new Error(
          `Total gambar setelah kompresi ${formatKB(total)} masih melebihi batas 4MB. Kurangi jumlah screenshot.`
        );
      }

      // 2) Gemini + kalender ekonomi live (disuntik server)
      setStage('search');
      const res = await apiFetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey.trim() ? { 'x-gemini-key': apiKey.trim() } : {}),
        },
        body: JSON.stringify({ images: compressed, balance: Number(balance), risk: Number(risk), session, pair }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Gagal menganalisa.');

      const createdAt = new Date().toISOString();
      setResult({
        markdown: data.markdown,
        bias: data.bias,
        meta: { created_at: createdAt, session, balance: Number(balance), risk: Number(risk), pair: data.pair || (pair !== 'AUTO' ? pair : null) },
        thumbnails: [],
      });
      setTab('analisa');

      // 3) Simpan ke Supabase
      setStage('save');
      const saveRes = await apiFetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown: data.markdown,
          bias: data.bias,
          pair: data.pair || (pair !== 'AUTO' ? pair : 'XAUUSD'),
          balance: Number(balance),
          risk: Number(risk),
          session,
          thumbnails: thumbs,
        }),
      });
      const saved = await safeJson(saveRes);
      if (!saveRes.ok) {
        showToast(`Analisa selesai, tapi gagal disimpan: ${saved.error}`);
      } else {
        setActiveId(saved.item.id);
        setHistory((h) => [saved.item, ...h]);
        setResult((r) => (r ? { ...r, thumbnails: saved.item.thumbnails || [] } : r));
        showToast(saved.storageWarning ? `Tersimpan (thumbnail gagal: ${saved.storageWarning})` : '✅ Tersimpan ke jurnal Supabase');
      }
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (e) {
      setError(e.message || 'Terjadi kesalahan.');
    } finally {
      setStage(null);
    }
  }

  // ---- aksi hasil
  async function copyResult() {
    if (!result?.markdown) return;
    try {
      await navigator.clipboard.writeText(result.markdown);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = result.markdown;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    showToast('📋 Hasil analisa disalin.');
  }

  if (auth !== 'open') {
    if (auth === 'checking') {
      return <div className="flex min-h-screen items-center justify-center text-xs text-muted">Memeriksa akses...</div>;
    }
    return <PinGate onSubmit={submitPin} error={authError} busy={authBusy} />;
  }

  const stageIndex = STAGES.findIndex((s) => s.key === stage);
  const tone = biasTone(result?.bias || '');

  return (
    <div className="min-h-screen">
      {/* HEADER */}
      <header className="app-header sticky top-0 z-30 border-b border-line bg-night/90 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="AureusDesk AI" width="36" height="36" className="h-9 w-9 flex-none rounded-lg" />
            <div className="min-w-0">
              <h1 className="text-base font-extrabold leading-tight tracking-tight">
                AureusDesk <span className="text-gold">AI</span>
              </h1>
              <p className="truncate text-[11px] text-muted">Multi-Pair · Multi-Timeframe · Gemini + Kalender Live</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-md border border-line bg-panel px-2 py-1 font-mono text-[11px] text-muted sm:block">
              gemini-flash-lite-latest
            </span>
            <button type="button" onClick={lockApp} className="btn btn-ghost px-3 py-1.5 text-xs" title="Kunci aplikasi">
              🔒 Kunci
            </button>
          </div>
        </div>

        {/* Tab mobile */}
        <div className="mx-auto flex max-w-7xl gap-1 px-4 pb-2 lg:hidden">
          {[
            ['analisa', '📈 Analisa'],
            ['riwayat', `📒 Riwayat (${history.length})`],
          ].map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                tab === k ? 'bg-gold text-night' : 'bg-panel text-muted'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* KOLOM UTAMA */}
        <section className={`min-w-0 space-y-4 ${tab === 'analisa' ? '' : 'hidden lg:block'} print:block`}>
          {/* PENGATURAN */}
          <div className="card p-4 print:hidden">
            <h2 className="mb-3 text-sm font-bold">⚙️ Pengaturan Akun & API</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2 lg:col-span-4">
                <label className="field-label" htmlFor="apikey">
                  Gemini API Key (opsional — override GEMINI_API_KEY Vercel)
                </label>
                <div className="flex gap-2">
                  <input
                    id="apikey"
                    type={showKey ? 'text' : 'password'}
                    className="input font-mono"
                    placeholder="Kosongkan untuk memakai key dari server (.env)"
                    value={apiKey}
                    autoComplete="off"
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      persist(LS.key, e.target.value.trim());
                    }}
                  />
                  <button type="button" className="btn-ghost px-3" onClick={() => setShowKey((s) => !s)}>
                    {showKey ? 'Sembunyi' : 'Lihat'}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-muted">Disimpan hanya di localStorage browser ini.</p>
              </div>

              <div className="sm:col-span-2 lg:col-span-4">
                <label className="field-label" htmlFor="pair">Instrumen / Pair</label>
                <select
                  id="pair"
                  className="input"
                  value={pair}
                  onChange={(e) => {
                    setPair(e.target.value);
                    persist(LS.pair, e.target.value);
                  }}
                >
                  {PAIR_OPTIONS.filter((o) => !o.group).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                  {[...new Set(PAIR_OPTIONS.filter((o) => o.group).map((o) => o.group))].map((g) => (
                    <optgroup key={g} label={g}>
                      {PAIR_OPTIONS.filter((o) => o.group === g).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-muted">
                  {pair === 'AUTO'
                    ? 'AI membaca nama pair di pojok kiri atas chart, lalu memakai pengali risiko pair itu.'
                    : 'Rumus risiko dikunci sesuai pair yang dipilih.'}
                </p>
              </div>

              <div>
                <label className="field-label" htmlFor="balance">Saldo Akun (USD)</label>
                <input
                  id="balance"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  className="input"
                  value={balance}
                  onChange={(e) => {
                    setBalance(e.target.value);
                    persist(LS.balance, e.target.value);
                  }}
                />
              </div>

              <div>
                <label className="field-label" htmlFor="risk">Risiko per Trade (%)</label>
                <input
                  id="risk"
                  type="number"
                  inputMode="decimal"
                  min="0.1"
                  max="100"
                  step="0.1"
                  className="input"
                  value={risk}
                  onChange={(e) => {
                    setRisk(e.target.value);
                    persist(LS.risk, e.target.value);
                  }}
                />
              </div>

              <div>
                <label className="field-label" htmlFor="session">Sesi Trading</label>
                <select id="session" className="input" value={session} onChange={(e) => setSession(e.target.value)}>
                  {SESSIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col justify-end">
                <div className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted">Maks. Risiko</p>
                  <p className="text-lg font-bold text-gold">${riskUsd.toFixed(2)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* KALENDER EKONOMI LIVE */}
          <CalendarWidget pair={pair} apiFetch={apiFetch} />

          {/* UPLOADER */}
          <div className="card p-4 print:hidden">
            <h2 className="mb-3 text-sm font-bold">🖼️ Screenshot Chart Multi-Timeframe</h2>
            <Uploader
              images={images}
              onAdd={addFiles}
              onRemove={removeImage}
              onClear={clearImages}
              onLabel={(id, label) => setImages((prev) => prev.map((i) => (i.id === id ? { ...i, label } : i)))}
              disabled={loading}
            />

            <button type="button" onClick={handleGenerate} disabled={loading} className="btn-gold mt-4 w-full py-3.5 text-base">
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-night border-t-transparent" />
                  Memproses… {elapsed}s
                </>
              ) : (
                '⚡ Generate & Simpan Analisa'
              )}
            </button>

            {loading && (
              <ol className="mt-4 space-y-2">
                {STAGES.map((s, i) => {
                  const done = i < stageIndex;
                  const now = i === stageIndex;
                  return (
                    <li
                      key={s.key}
                      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs transition ${
                        now ? 'border-gold/50 bg-gold/5 text-ink' : done ? 'border-up/30 text-up' : 'border-line text-muted'
                      }`}
                    >
                      <span className="flex h-5 w-5 flex-none items-center justify-center">
                        {done ? '✓' : now ? (
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gold border-t-transparent" />
                        ) : (
                          <span className="h-2 w-2 rounded-full bg-line" />
                        )}
                      </span>
                      {s.label}
                      {now && s.key === 'search' && elapsed > 12 && (
                        <span className="ml-auto text-[10px] text-muted">AI membaca struktur chart…</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {error && (
              <div className="mt-4 rounded-lg border border-down/40 bg-down/10 p-3 text-sm text-down">⚠️ {error}</div>
            )}
          </div>

          {/* HASIL */}
          {loading && !result && (
            <div className="card space-y-3 p-4 print:hidden">
              <div className="shimmer h-6 w-1/2 rounded" />
              <div className="shimmer h-4 w-full rounded" />
              <div className="shimmer h-4 w-5/6 rounded" />
              <div className="shimmer h-32 w-full rounded" />
            </div>
          )}

          {result && (
            <div ref={resultRef} className="card print-area min-w-0 scroll-mt-28 p-4 sm:p-6">
              <div className="mb-4 flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted">Hasil Analisa {result.meta?.pair || ''}</p>
                  <span className={`mt-1 inline-block rounded-md border px-2.5 py-1 text-sm font-extrabold ${toneClass[tone]}`}>
                    {result.bias}
                  </span>
                  <p className="mt-2 text-xs text-muted">
                    {formatWIB(result.meta?.created_at)} · {result.meta?.session} · Saldo $
                    {Number(result.meta?.balance || 0).toLocaleString('en-US')} · Risiko {result.meta?.risk}%
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 print:hidden">
                  <button type="button" onClick={copyResult} className="btn-ghost text-xs">📋 Copy Hasil Analisa</button>
                  <button type="button" onClick={() => window.print()} className="btn-ghost text-xs">🖨️ Print / Save PDF</button>
                </div>
              </div>

              {result.thumbnails?.length > 0 && (
                <div className="mb-4 flex gap-2 overflow-x-auto pb-1 print:hidden">
                  {result.thumbnails.map((t) => (
                    <a key={t.path} href={t.url} target="_blank" rel="noopener noreferrer" className="flex-none">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t.url} alt={t.label} className="h-16 w-24 rounded border border-line object-cover" />
                      <p className="mt-0.5 text-center text-[10px] text-gold">{t.label}</p>
                    </a>
                  ))}
                </div>
              )}

              <MarkdownView content={result.markdown} />
            </div>
          )}

          {!result && !loading && (
            <div className="card p-8 text-center text-sm text-muted print:hidden">
              Upload screenshot W1 → M1 (dan tab Trade MT4 bila ada), lalu tekan <b className="text-gold">Generate</b>.
            </div>
          )}

          <p className="pb-6 text-center text-[11px] text-muted print:hidden">
            AureusDesk AI adalah alat bantu analisa, bukan saran keuangan. Trading emas berisiko tinggi.
          </p>
        </section>

        {/* SIDEBAR RIWAYAT */}
        <aside className={`min-w-0 ${tab === 'riwayat' ? '' : 'hidden lg:block'} lg:sticky lg:top-20 lg:self-start print:hidden`}>
          <HistoryPanel
            items={history}
            loading={histLoading}
            error={histError}
            activeId={activeId}
            busyId={busyId}
            onOpen={openHistory}
            onDelete={deleteHistory}
            onEvaluate={evaluateHistory}
            onRefresh={loadHistory}
          />
        </aside>
      </main>

      {toast && (
        <div
          style={{ bottom: 'max(1.25rem, calc(env(safe-area-inset-bottom) + 0.75rem))' }}
          className="fixed left-1/2 z-50 w-max max-w-[92vw] -translate-x-1/2 rounded-lg border border-line bg-panel2 px-4 py-2.5 text-center text-sm shadow-2xl print:hidden"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
