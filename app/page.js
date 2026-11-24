'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Uploader, { guessLabel, TIMEFRAMES } from '@/components/Uploader';
import HistoryPanel, { biasTone, toneClass, formatWIB } from '@/components/HistoryPanel';
import PinGate from '@/components/PinGate';
import CalendarWidget from '@/components/CalendarWidget';
import SettingsSheet from '@/components/SettingsSheet';
import ResultView from '@/components/ResultView';
import PairPicker, { QuickPairs, pairLabel } from '@/components/PairPicker';
import { CandleGuideModal } from '@/components/CandleSvg';
import ChatBox from '@/components/ChatBox';
import { drawZoneMap } from '@/components/ZoneMap';
import { buildPdf, loadJsPdf } from '@/lib/pdfReport';
import { segmentSection, parseMeta } from '@/lib/zoneParse';
import { fixInlineTables } from '@/lib/markdownFix';
import { NAV_KEY, NAV_DEFAULT, NAV_MODES } from '@/lib/sections';
import { compressImage, makeThumbnail, formatKB } from '@/lib/imageCompress';
import { PAIR_OPTIONS, resolvePair } from '@/lib/pairs';
import { THEMES, THEME_KEY, THEME_META, resolveTheme } from '@/lib/themes';

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
  copyFmt: 'aureus_copyfmt',
  strict: 'aureus_strict',
  mode: 'aureus_mode',
  gwModel: 'aureus_gwmodel',
  engine: 'aureus_engine',
  geminiModel: 'aureus_geminimodel',
  marketSource: 'aureus_market_source',
  zoneStyle: 'aureus_zone_style',
  skipZone1: 'aureus_skip_zone1',
  connectionId: 'aureus_mt4_conn',
};

// Format digit tombol salin harga. 'ASLI' = apa adanya dari hasil analisa (bawaan).
const COPY_FORMATS = [
  { key: 'ASLI', label: 'Asli', hint: 'Salin persis seperti tertulis di tabel' },
  { key: 'AUTO', label: 'Auto', hint: 'Digit mengikuti pair hasil analisa' },
  { key: 'GOLD', label: 'Emas 2', hint: 'XAUUSD: 2 digit desimal (3584.74)', dec: 2 },
  { key: 'FX5', label: 'Forex 5', hint: 'EURUSD/GBPUSD/AUDUSD: 5 digit (1.09835)', dec: 5 },
  { key: 'JPY3', label: 'JPY 3', hint: 'USDJPY/GBPJPY: 3 digit (157.250)', dec: 3 },
];

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

// Jam WIB + label sesi pasar (hanya tampilan; tidak memengaruhi analisa)
function deskClock() {
  const now = new Date();
  const hm = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hourCycle: 'h23' }).format(now));
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', weekday: 'short' }).format(now);
  let label;
  let dot;
  if (day === 'Sat' || (day === 'Sun' && h < 4)) {
    label = 'Akhir Pekan (Forex Tutup · Kripto Aktif)';
    dot = 'bg-aurum';
  } else if (h >= 19 && h <= 23) {
    label = 'Overlap London–New York (Volatilitas Tinggi)';
    dot = 'bg-up animate-pulse';
  } else if (h >= 14 && h < 19) {
    label = 'Sesi London Aktif';
    dot = 'bg-gold animate-pulse';
  } else if (h >= 6 && h < 14) {
    label = 'Sesi Asia / Tokyo Aktif';
    dot = 'bg-sky-400';
  } else {
    label = 'Sesi New York Late / Sydney';
    dot = 'bg-indigo-400';
  }
  return { hm: `${hm.replace('.', ':')} WIB`, label, dot };
}

function tfOrder(label) {
  const i = TIMEFRAMES.indexOf(label);
  return i === -1 ? 99 : i;
}

export default function Home() {
  // Pengaturan
  const [apiKey, setApiKey] = useState('');
  const [balance, setBalance] = useState('1000');
  const [risk, setRisk] = useState('2');
  const [session, setSession] = useState('Sesi Asia');
  const [pair, setPair] = useState('AUTO');
  const [copyFmt, setCopyFmt] = useState('ASLI');
  const [theme, setTheme] = useState('desk');
  const [navMode, setNavMode] = useState(NAV_DEFAULT);
  const [strict, setStrict] = useState(true);
  const [mode, setMode] = useState('single');
  const [gwModel, setGwModel] = useState('kimi-k2.7-code-highspeed');
  const [engine, setEngine] = useState('gemini'); // 'gemini' | 'gateway'
  const [geminiModel, setGeminiModel] = useState('');
  const [marketSource, setMarketSource] = useState('cloud');
  const [zoneStyle, setZoneStyle] = useState('two');
  const [skipZone1, setSkipZone1] = useState(false); // Zona 1 (Scalping) mati; hanya berlaku di mode 3 zona
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionId, setConnectionId] = useState(''); // '' = otomatis (koneksi broker terbaru)
  const [connList, setConnList] = useState(null); // daftar koneksi broker aktif untuk pair terpilih


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
  const [pairOpen, setPairOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [clock, setClock] = useState(null);
  const resultRef = useRef(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  useEffect(() => {
    const tick = () => setClock(deskClock());
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, []);

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
      const th = localStorage.getItem(THEME_KEY);
      if (th && THEMES.some((t) => t.key === th)) setTheme(th);
      const nm = localStorage.getItem(NAV_KEY);
      if (nm && NAV_MODES.some((m) => m.key === nm)) setNavMode(nm);
      if (localStorage.getItem(LS.strict) === 'off') setStrict(false);
      if (localStorage.getItem(LS.mode) === '2stage') setMode('2stage');
      if (localStorage.getItem(LS.zoneStyle) === 'three') setZoneStyle('three');
      if (localStorage.getItem(LS.skipZone1) === '1') setSkipZone1(true);
      { const c = localStorage.getItem(LS.connectionId); if (c && /^[a-z0-9]{8,48}$/.test(c)) setConnectionId(c); }
      const ms = localStorage.getItem(LS.marketSource);
      if (ms && ['cloud', 'mt4', 'auto', 'screenshot'].includes(ms)) setMarketSource(ms);
      const gm = localStorage.getItem(LS.gwModel);
      if (gm && /^[A-Za-z0-9._:\/-]{2,80}$/.test(gm)) setGwModel(gm);
      if (localStorage.getItem(LS.engine) === 'gateway') setEngine('gateway');
      const gem = localStorage.getItem(LS.geminiModel);
      if (gem && /^[A-Za-z0-9._:\/-]{2,80}$/.test(gem)) setGeminiModel(gem);
      const cf = localStorage.getItem(LS.copyFmt);
      if (cf && COPY_FORMATS.some((f) => f.key === cf)) setCopyFmt(cf);
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

  // Terapkan tema (dan ikuti mode gelap/terang perangkat bila 'Auto')
  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    const apply = () => {
      const t = resolveTheme(theme, Boolean(mq && mq.matches));
      document.documentElement.setAttribute('data-theme', t);
      const m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', THEME_META[t] || '#0B0E11');
    };
    apply();
    if (theme === 'auto' && mq) {
      mq.addEventListener?.('change', apply);
      return () => mq.removeEventListener?.('change', apply);
    }
  }, [theme]);

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
        candles: it.candles || null,
        audit: it.audit_meta || null,
        orderResults: it.order_results || {},
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

  // Simpan/hapus hasil satu order 4B (Hit TP/SL, Cut, Expired) pada analisa yang sedang dibuka
  async function saveOrderResult(orderKey, result) {
    if (!activeId) { showToast('Simpan analisa ke Riwayat dulu.'); return false; }
    try {
      const res = await apiFetch(`/api/history/${activeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_key: orderKey, result }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setResult((r) => (r ? { ...r, orderResults: data.item.order_results || {} } : r));
      setHistory((h) => h.map((x) => (x.id === activeId ? { ...x, order_results: data.item.order_results || {} } : x)));
      showToast(result ? '✅ Hasil order tersimpan' : 'Hasil order dihapus');
      return true;
    } catch (e) {
      showToast(e.message || 'Gagal menyimpan hasil order.');
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

  // hapus banyak: ids = array (pilih sendiri) atau null = semua riwayat
  async function bulkDeleteHistory(ids) {
    const all = !ids;
    setBusyId('bulk');
    try {
      const res = await apiFetch('/api/history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(all ? { all: true, confirm: 'HAPUS' } : { ids }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      const gone = all ? null : new Set(ids);
      setHistory((h) => (all ? [] : h.filter((x) => !gone.has(x.id))));
      if (all || gone.has(activeId)) {
        setActiveId(null);
        setResult(null);
      }
      showToast(all ? 'Semua riwayat dihapus.' : `${data.deleted ?? ids.length} riwayat dihapus.`);
      return true;
    } catch (e) {
      showToast(e.message || 'Gagal menghapus.');
      return false;
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
    const noShotOk = marketSource === 'mt4' && pair !== 'AUTO';
    if (!images.length && !noShotOk) {
      setError('Upload minimal 1 screenshot chart. Tanpa screenshot hanya bisa bila Sumber Data = MT4 EA, pair dipilih manual (bukan AUTO).');
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
      const perImgBytes = Math.min(1_300_000, Math.floor((MAX_PAYLOAD * 0.75 * 0.97) / Math.max(1, ordered.length)));
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
        body: JSON.stringify({ images: compressed, balance: Number(balance), risk: Number(risk), session, pair, strict, mode, gwModel, engine, geminiModel, marketSource, zoneStyle, skipZone1: zoneStyle === 'three' && skipZone1, connectionId: connectionId || undefined, copyFmt }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Gagal menganalisa.');

      const createdAt = new Date().toISOString();
      setResult({
        markdown: data.markdown,
        bias: data.bias,
        meta: { created_at: createdAt, session, balance: Number(balance), risk: Number(risk), pair: data.pair || (pair !== 'AUTO' ? pair : null) },
        thumbnails: [],
        candles: data.candles || null,
        audit: data.audit || null,
        orderResults: {},
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
          candles: data.candles || null,
          audit: data.audit || null,
        }),
      });
      const saved = await safeJson(saveRes);
      if (!saveRes.ok) {
        showToast(`Analisa selesai, tapi gagal disimpan: ${saved.error}`);
      } else {
        setActiveId(saved.item.id);
        setHistory((h) => [saved.item, ...h]);
        setResult((r) => (r ? { ...r, thumbnails: saved.item.thumbnails || [] } : r));
        showToast(saved.storageWarning ? `Tersimpan (thumbnail gagal: ${saved.storageWarning})` : saved.auditWarning ? `Tersimpan, tetapi ${saved.auditWarning}` : '✅ Tersimpan ke jurnal Supabase');
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

  async function downloadPdf() {
    if (!result?.markdown || pdfBusy) return;
    setPdfBusy(true);
    try {
      const JsPDF = await loadJsPdf();
      const md = fixInlineTables(result.markdown);
      const meta = parseMeta(md);
      const exec = segmentSection(md).find((x) => x.type === 'exec')?.rows || [];
      let chartDataUrl = '';
      if (exec.some((r) => r.valid)) {
        const cv = document.createElement('canvas');
        const pid = meta.pair || result.meta?.pair || '';
        drawZoneMap(cv, 1200, 620, 1, {
          zones: exec,
          price: meta.price,
          dec: resolvePair(pid)?.dec ?? 5,
          pair: pid,
          bias: meta.bias,
          filter: 'ALL',
          candles: result.candles?.bars?.H1?.slice(-64) || null,
          tfLabel: result.candles?.bars?.H1 ? 'H1' : '',
        });
        chartDataUrl = cv.toDataURL('image/png');
      }
      const { doc, filename } = buildPdf(JsPDF, {
        markdown: result.markdown,
        pair: result.meta?.pair || '',
        createdAt: result.meta?.created_at || '',
        chartDataUrl,
        maxRiskUsd: (((Number(result.meta?.balance) || 0) * (Number(result.meta?.risk) || 0)) / 100).toFixed(2),
      });
      doc.save(filename);
      showToast('📄 PDF diunduh.');
    } catch (e) {
      showToast(`Gagal membuat PDF: ${e?.message || e}`);
    } finally {
      setPdfBusy(false);
    }
  }

  // Digit desimal untuk tombol salin harga (null = apa adanya)
  const fmtDef = COPY_FORMATS.find((f) => f.key === copyFmt);
  const priceDecimals =
    copyFmt === 'AUTO' ? resolvePair(result?.meta?.pair)?.dec ?? null : fmtDef?.dec ?? null;

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
      <header className="app-header sticky top-0 z-30 border-b border-line/70 bg-night/80 backdrop-blur-xl print:hidden">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="h-10 w-10 flex-none rounded-xl bg-gradient-to-br from-amber-200 via-aurum to-amber-600 p-[1.5px] shadow-md shadow-amber-500/20" aria-hidden="true">
              <div className="flex h-full w-full flex-col items-center justify-center rounded-[10px] bg-[#090F1D] leading-none">
                <span className="bg-gradient-to-b from-amber-200 to-amber-500 bg-clip-text text-base font-black text-transparent">A</span>
                <span className="-mt-0.5 text-[6px] font-bold uppercase tracking-wider text-amber-300/90">Aureus</span>
              </div>
            </div>
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
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="btn btn-ghost relative h-10 w-10 !p-0 text-lg leading-none"
                aria-label="Menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                ⋮
                {apiKey.trim() ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-gold" title="API key kustom aktif" /> : null}
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
                  <div
                    role="menu"
                    className="card absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden p-1.5"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-panel2"
                      onClick={() => {
                        setMenuOpen(false);
                        setSettingsOpen(true);
                      }}
                    >
                      <span aria-hidden="true">⚙️</span>
                      <span className="flex-1">Pengaturan</span>
                      <span className="text-[10px] text-muted">Tema · API</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-panel2"
                      onClick={() => {
                        setMenuOpen(false);
                        lockApp();
                      }}
                    >
                      <span aria-hidden="true">🔒</span>
                      <span className="flex-1">Kunci Aplikasi</span>
                    </button>
                    <p className="mt-1 border-t border-line px-3 pb-1.5 pt-2 font-mono text-[10px] text-muted">gemini-flash-lite-latest</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tab mobile */}
        <div className="mx-auto flex max-w-[1680px] gap-1 px-4 pb-2 sm:px-6 lg:px-8">
          <div className="grid w-full grid-cols-2 gap-1.5 rounded-2xl border border-line/90 bg-panel p-1 lg:w-[320px]">
          {[
            ['analisa', '📈 Analisa'],
            ['riwayat', `📒 Riwayat (${history.length})`],
          ].map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition sm:text-sm ${
                tab === k ? 'bg-gradient-to-b from-gold to-gold/80 font-extrabold text-night shadow-md shadow-gold/30' : 'text-muted hover:text-ink'
              }`}
            >
              {l}
            </button>
          ))}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1680px] grid-cols-1 gap-4 px-4 py-4 sm:px-6 lg:px-8">
        {/* KOLOM UTAMA */}
        <section className={`min-w-0 space-y-4 ${tab === 'analisa' ? '' : 'hidden'} print:block`}>
          {/* PENGATURAN */}
          <div className="card p-4 print:hidden">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line/70 pb-3">
              <div className="flex items-center gap-2 text-xs">
                <span className={`h-2.5 w-2.5 rounded-full ${clock?.dot || 'bg-line'}`} />
                <span className="font-bold text-ink">{clock?.label || 'Memuat sesi...'}</span>
                <span className="rounded-md border border-line bg-night px-2 py-0.5 font-mono text-[11px] text-gold">{clock?.hm || '--:-- WIB'}</span>
              </div>
              <button
                type="button"
                onClick={() => setGuideOpen(true)}
                className="flex items-center gap-1 rounded-lg border border-line bg-night px-2.5 py-1 text-[11px] font-bold text-gold transition hover:bg-panel2"
              >
                🕯️ Pola Candle
              </button>
            </div>
            <h2 className="mb-3 text-sm font-bold">🎛️ Parameter Analisa</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2 lg:col-span-4">
                <label className="field-label" htmlFor="pair">Instrumen / Pair</label>
                <button
                  id="pair"
                  type="button"
                  onClick={() => setPairOpen(true)}
                  className="flex w-full items-center justify-between rounded-xl border border-line bg-night px-3.5 py-2.5 text-left transition hover:border-gold"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="font-mono text-sm font-extrabold text-strong sm:text-base">{pair === 'AUTO' ? 'AUTO' : pair}</span>
                    <span className="truncate text-xs text-muted">{pairLabel(pair)}</span>
                  </span>
                  <span className="flex-none text-xs font-bold text-gold">🔍 Pilih ▾</span>
                </button>
                <div className="mt-2">
                  <QuickPairs
                    value={pair}
                    onPick={(v) => {
                      setPair(v);
                      persist(LS.pair, v);
                    }}
                  />
                </div>
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
                  <button type="button" onClick={downloadPdf} disabled={pdfBusy} className="btn-gold text-xs">
                    {pdfBusy ? '⏳ Menyusun PDF...' : '📄 Unduh PDF'}
                  </button>
                  <button type="button" onClick={() => window.print()} className="btn-ghost text-xs">🖨️ Print</button>
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

              <div className="mb-3 flex flex-wrap items-center gap-1.5 print:hidden">
                <span className="text-[11px] text-muted">Digit tombol salin:</span>
                {COPY_FORMATS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    title={f.hint}
                    onClick={() => {
                      setCopyFmt(f.key);
                      persist(LS.copyFmt, f.key);
                    }}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                      copyFmt === f.key ? 'bg-gold text-night' : 'bg-panel2 text-muted hover:text-ink'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <ResultView audit={result.audit || null} configNow={{ balance: Number(balance), risk: Number(risk), zoneMode: zoneStyle === 'three' ? 'tiga' : 'dua', zone1: zoneStyle === 'three' && skipZone1 ? 'OFF' : 'ON', strict, mode: mode === '2stage' ? '2tahap' : 'single', engine, geminiModel: geminiModel || undefined, marketSource, digits: copyFmt }} candles={result.candles} content={result.markdown} priceDecimals={priceDecimals} mode={navMode} pairId={result.meta?.pair} onToast={showToast} orderCtx={{ analysisId: activeId, orderResults: result.orderResults || {}, onSaveOrder: saveOrderResult }} />
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
        <aside className={`min-w-0 ${tab === 'riwayat' ? '' : 'hidden'} print:hidden`}>
          <HistoryPanel
            items={history}
            loading={histLoading}
            error={histError}
            activeId={activeId}
            busyId={busyId}
            onOpen={openHistory}
            onDelete={deleteHistory}
            onBulkDelete={bulkDeleteHistory}
            onEvaluate={evaluateHistory}
            onRefresh={loadHistory}
          />
        </aside>
      </main>

      <SettingsSheet
        connectionId={connectionId}
        connList={connList}
        onLoadConnections={async () => {
          try {
            const r = await apiFetch(`/api/mt4/status?pair=${encodeURIComponent(pair === 'AUTO' ? 'XAUUSD' : pair)}`);
            const j = await r.json();
            setConnList(Array.isArray(j.connections) ? j.connections : []);
          } catch { setConnList([]); }
        }}
        onConnectionId={(v) => {
          setConnectionId(v);
          persist(LS.connectionId, v);
        }}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onTheme={(k) => {
          setTheme(k);
          persist(THEME_KEY, k);
        }}
        skipZone1={skipZone1}
        onSkipZone1={(v) => {
          setSkipZone1(v);
          persist(LS.skipZone1, v ? '1' : '');
        }}
        zoneStyle={zoneStyle}
        onZoneStyle={(v) => {
          setZoneStyle(v);
          persist(LS.zoneStyle, v === 'three' ? 'three' : '');
        }}
        marketSource={marketSource}
        onMarketSource={(v) => {
          setMarketSource(v);
          persist(LS.marketSource, v);
        }}
        mode={mode}
        onMode={(v) => {
          setMode(v);
          persist(LS.mode, v === '2stage' ? '2stage' : '');
        }}
        engine={engine}
        onEngine={(v) => {
          setEngine(v);
          persist(LS.engine, v === 'gateway' ? 'gateway' : '');
        }}
        geminiModel={geminiModel}
        onGeminiModel={(v) => {
          setGeminiModel(v);
          persist(LS.geminiModel, v);
        }}
        gwModel={gwModel}
        onGwModel={(v) => {
          setGwModel(v);
          persist(LS.gwModel, v);
        }}
        onLoadModels={async () => {
          try {
            const r = await apiFetch('/api/health?gateway=1&models=1');
            const j = await r.json().catch(() => ({}));
            return j.gatewayModels || { ok: false, error: r.status === 401 ? 'PIN salah' : `HTTP ${r.status}` };
          } catch (e) {
            return { ok: false, error: e?.message || 'jaringan' };
          }
        }}
        onTestGateway={async () => {
          try {
            const r = await apiFetch(`/api/health?gateway=1&probe=1&model=${encodeURIComponent(gwModel)}`);
            const j = await r.json().catch(() => ({}));
            return typeof j.gateway === 'string' ? j.gateway : j.gateway ? `OK (${j.gateway.ms} ms): ${j.gateway.sample}` : r.status === 401 ? 'PIN salah/belum diisi' : `Tidak ada hasil (HTTP ${r.status})`;
          } catch (e) {
            return `ERROR: ${e?.message || 'jaringan'}`;
          }
        }}
        strict={strict}
        onStrict={(v) => {
          setStrict(v);
          persist(LS.strict, v ? '' : 'off');
        }}
        navMode={navMode}
        onNavMode={(k) => {
          setNavMode(k);
          persist(NAV_KEY, k);
        }}
        apiKey={apiKey}
        onApiKey={(v) => {
          setApiKey(v);
          persist(LS.key, v.trim());
        }}
      />

      <PairPicker
        open={pairOpen}
        value={pair}
        onPick={(v) => {
          setPair(v);
          persist(LS.pair, v);
        }}
        onClose={() => setPairOpen(false)}
      />
      <CandleGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
      <ChatBox
        apiFetch={apiFetch}
        apiKey={apiKey}
        context={result?.markdown || ''}
        pair={result?.meta?.pair || (pair !== 'AUTO' ? pair : '')}
        balance={balance}
        risk={risk}
        gwModel={gwModel}
        engine={engine}
        geminiModel={geminiModel}
        open={chatOpen}
        onToggle={() => setChatOpen((o) => !o)}
      />

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
