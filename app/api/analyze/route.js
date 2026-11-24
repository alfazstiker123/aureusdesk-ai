import { NextResponse } from 'next/server';
import { GEMINI_MODEL, GEMINI_FALLBACK_MODELS, buildSystemInstruction, buildUserPrompt, extractBias, zoneStyleAddendum, ZONE1_OFF_SYSTEM, OHLC_ONLY_SYSTEM } from '@/lib/prompt';
import { PAIRS, PAIR_ID_OK, extractPair, guessPairByPrice, resolvePair, parseATR, zoneRange, zoneRange3, rangeText } from '@/lib/pairs';
import { gatewayChat, gwConfigured, gwModelOf, looksLikeAnalysis } from '@/lib/gateway';
import { EXTRACT_SYSTEM, EXTRACT_SCHEMA, normalizeExtract, buildCandidates, formatDataBlock, STAGE2_ADDENDUM } from '@/lib/extract';
import { requirePin } from '@/lib/auth';
import { fixInlineTables } from '@/lib/markdownFix';
import { buildFundamentalBlock } from '@/lib/calendar';
import { verifyRiskTables, fixDailyClose } from '@/lib/riskCheck';
import { applyOrderGuard, parseLastPrice } from '@/lib/zoneCheck';
import { syncInvalidation, labelConfirmationLevels } from '@/lib/invalidation';
import { spreadInfo, spreadWarnings } from '@/lib/spreadCheck';
import { zoneOverlap } from '@/lib/overlap';
import { decideBias, structureTfOf, syncHeadline, insertBiasBlock } from '@/lib/biasFinal';
import { buildAudit, buildConfig, auditLine } from '@/lib/auditTrail';
import { riskTransparency, insertRiskTransparency } from '@/lib/riskTransparency';
import { buildDecision, insertDecision, insufficientDecision, dataGap } from '@/lib/decision';
import { isNeutralHeadline, syncBiasLabels, syncTfBias, syncLevelLabels, syncSummaryLevels, syncExpiry } from '@/lib/consistency';
import { getConnectionSnapshots, marketContext, mt4SymbolForPair, snapshotSpreadMinutes } from '@/lib/mt4Market';
import { specPromptBlock, specNotice } from '@/lib/brokerSpec';
import { getCloudMarketSnapshots, cloudMarketContext, cloudProxyOf, applyBasis } from '@/lib/cloudMarket';
import { metalsWeekendClosed, fmtMt4 } from '@/lib/marketTime';
import { buildSmcReport, buildZoneCandidates, buildZoneCandidates3 } from '@/lib/smc/engine';
import { enforceSmcZones, syncTargets, disableZoneRows } from '@/lib/smc/guard';
import { reconcileZones, cancelMismatched, syncNarrative, deadKeys, pruneNotes, finalizeOrders } from '@/lib/finalSync';
import { normalizeIdNumbers } from '@/lib/numFormat';
import { fixWeekendExpiry, nextOpenMs } from '@/lib/weekendExpiry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // detik (batas aman Vercel Hobby)

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGES = 12;
const BUDGET_MS = 52_000; // total waktu semua percobaan (di bawah maxDuration)

// Urutan percobaan (tanpa Google Search): Flash (utama) -> cadangan -> Lite (terakhir, paling murah tapi paling lemah membaca angka).
const GEM_RE = /^[A-Za-z0-9._:\/-]{2,80}$/;
const attemptsFor = (primary) => [primary, ...GEMINI_FALLBACK_MODELS.filter((m) => m !== primary)].map((model) => ({ model }));

const SMC_SYSTEM_ADDENDUM = `
ATURAN V2 SMC — PRIORITAS SAAT OHLC CLOUD/MT4 TERSEDIA:
- FORMAT ANGKA WAJIB: semua harga ditulis dengan titik sebagai desimal dan TANPA pemisah ribuan, contoh 56964.10 (bukan 56.964,10 dan bukan 56,964.10). Level Kunci/zona/SL/TP hanya boleh angka dari blok SMC/KANDIDAT; jangan menulis harga close atau angka sumbu chart sebagai level.
- Jangan menyalin angka atau tanda baca ke tabel dengan gabungan (mis. "57,740.000,60,500"); satu sel = satu angka atau satu rentang "A - B".
- Jangan memaksakan empat pending order BUY/SELL jika struktur tidak membuktikan zona yang layak. Boleh tulis NO TRADE / WAIT untuk arah tanpa bukti.
- Zona entry harus berakar pada OB atau FVG yang fresh dan terkait displacement/BOS; tandai POI, trigger konfirmasi, dan entry sebagai tiga hal berbeda.
- BOS/CHoCH hanya valid dari candle tertutup; candle berjalan tidak boleh menjadi konfirmasi.
- Sweep harus menembus liquidity level lalu candle tertutup kembali melewati level; wick saja tanpa close-back bukan sweep terkonfirmasi.
- OB yang invalidated dan FVG yang fully mitigated tidak boleh dipakai sebagai zona fresh.
- ATR(14) H1/H4 dari OHLC adalah sumber utama untuk volatilitas; jangan menggantinya dengan tebakan atau ATR profil bila tersedia.
- Gunakan hierarchy W1/D1 konteks, H4/H1 struktur, M15/M5 setup; timeframe rendah tidak boleh membatalkan struktur lebih tinggi tanpa CHoCH valid.
- Kolom "Level Kunci" Bagian 2 HANYA boleh berisi level dari blok SMC (level BOS/CHoCH, tepi OB/FVG fresh, swing). DILARANG memakai angka label sumbu harga di screenshot atau harga close sebagai level.
- Order (Bagian 3/4B) hanya boleh di dalam OB/FVG fresh searah dari blok SMC; arah tanpa zona valid = tulis "Tidak ada level valid (tunggu)" dan 4B "Tidak Ada Setup (Tunggu)". Server membatalkan order di luar zona SMC fresh.
- Jika data OHLC tidak lengkap, stale, atau pair tidak cocok, nyatakan VISUAL ONLY — CONFIDENCE TERBATAS dan jangan klaim konfirmasi OHLC.`;

async function loadMt4Context(pairId, zones = 2, opts = {}) {
  if (!pairId || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { text: '', snapshots: [], smc: null, source: 'NONE' };
  try {
    const symbol = mt4SymbolForPair(pairId);
    const conn = await getConnectionSnapshots(pairId, { connectionId: opts.connectionId || null, legacySymbol: symbol });
    if (conn.missing) throw new Error(`Koneksi broker "${opts.connectionId}" tidak punya data fresh untuk ${pairId}.`);
    const snapshots = conn.chosen?.rows || [];
    if (!snapshots.length) throw new Error('Feed MT4 belum tersedia/fresh.');
    const connInfo = { id: conn.chosen.connectionId, broker: conn.chosen.broker, server: conn.chosen.server, platform: conn.chosen.platform, accountCurrency: conn.chosen.accountCurrency, brokerSymbol: conn.chosen.symbol, others: conn.others.map((o) => ({ id: o.connectionId, broker: o.broker, server: o.server })) };
    const brokerSpec = conn.chosen.spec && conn.chosen.spec.valid ? conn.chosen.spec : null;
    const specWhy = brokerSpec ? null : conn.chosen.spec ? `spesifikasi tidak lengkap: ${[...(conn.chosen.spec.missing || []), ...(conn.chosen.spec.problems || [])].join(', ') || 'tidak valid'}` : conn.chosen.connectionId === 'legacy' ? 'EA lama (v3.1) tidak mengirim spesifikasi — update ke v3.2' : 'EA tidak mengirim spesifikasi kontrak';
    const connNotice = [`🔌 Data dari ${connInfo.broker || 'broker'}${connInfo.server ? ' / ' + connInfo.server : ''} (simbol ${connInfo.brokerSymbol}${connInfo.id === 'legacy' ? ', koneksi lama' : ''}).`,
      connInfo.others.length ? `Ada ${connInfo.others.length} koneksi broker lain aktif untuk ${pairId}; data TIDAK dicampur.` : null,
      snapshotSpreadMinutes(snapshots) > 6 ? `⏱ Snapshot antar timeframe berselisih ${snapshotSpreadMinutes(snapshots).toFixed(1)} menit (bukan satu siklus kiriman EA): cocokkan harga dengan chart sebelum memakai level.` : null].filter(Boolean).join(' ');
    const quoteSnap = snapshots.find((x) => x.timeframe === 'M5') || snapshots.find((x) => x.timeframe === 'M15');
    const quotePrice = Number(quoteSnap?.bid || quoteSnap?.ask || quoteSnap?.bars?.at(-1)?.close || 0);
    const profile = PAIRS[pairId] || resolvePair(pairId);
    if (quotePrice && profile?.priceRange && (quotePrice < profile.priceRange[0] || quotePrice > profile.priceRange[1]))
      throw new Error(`Harga feed ${quotePrice} di luar rentang profil ${pairId}; periksa MT4_SYMBOL_MAP.`);
    if (quoteSnap?.bid && quoteSnap?.ask && quoteSnap.ask < quoteSnap.bid) throw new Error('Bid/Ask MT4 tidak konsisten.');
    const byTf = Object.fromEntries(snapshots.map((x) => [x.timeframe, x.bars]));
    const smc = buildSmcReport(byTf);
    const report = smc?.analyses?.length ? `\n\nRINGKASAN SMC DETERMINISTIK (hasil kalkulasi candle tertutup; bukti, bukan sinyal otomatis):\n${smc.promptBlock}` : '';
    const feed = feedPriceInfo(snapshots);
    const zcd = zoneCandidateData(smc, profile, feed.price || quotePrice, zones, opts.zonesOff || []);
    const zc = zcd.text;
    return { text: marketContext(snapshots) + specPromptBlock(brokerSpec, specWhy) + report + feed.line + (zc ? `\n\n${zc}` : ''), zoneCandidates: zc, zoneRes: zcd.res, feedPrice: feed.price, quote: feed.quote, snapshots, smc, source: 'MT4_EA', warnings: [], connection: connInfo, brokerSpec, specWhy, connNotice, specNotice: specNotice(brokerSpec, specWhy) };
  } catch (e) {
    return { text: `DATA OHLC MT4 tidak dapat diverifikasi (${e.message}).`, snapshots: [], smc: null, source: 'NONE', error: e.message };
  }
}


const QUOTE_SYSTEM = 'Baca dari screenshot chart MT4: (1) nama pair/instrumen pada judul chart (mis. BTCUSD, XAUUSD, EURUSD); (2) harga terakhir = label harga BID yang disorot di sumbu kanan (garis harga sekarang), BUKAN angka sumbu biasa dan BUKAN jam. Tulis harga dengan titik desimal tanpa pemisah ribuan (contoh 4065.32). Jangan menebak; kosongkan pair atau isi price 0 bila tidak terbaca.';
const QUOTE_GEN = { temperature: 0, maxOutputTokens: 160, responseMimeType: 'application/json',
  responseSchema: { type: 'OBJECT', properties: { pair: { type: 'STRING' }, price: { type: 'NUMBER' } }, required: ['pair', 'price'] } };

/** Panggilan ringan: baca harga broker terakhir dari screenshot pertama (kalibrasi proksi). 0 bila gagal. */
async function readChartPrice(images, apiKey, t0) {
  // Coba gambar pertama lalu terakhir, flash-lite lalu model utama; harga harus lolos parse JSON.
  const tries = [images?.[0], ...(images?.length > 1 ? [images[images.length - 1]] : [])].filter(Boolean);
  for (const img of tries) {
    const payload = {
      systemInstruction: { parts: [{ text: QUOTE_SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: 'Pair apa pada chart ini, dan berapa harga terakhirnya?' }, { inlineData: { mimeType: img.mimeType, data: img.data } }] }],
      generationConfig: QUOTE_GEN,
    };
    for (const m of ['gemini-flash-lite-latest', GEMINI_MODEL]) {
      if (BUDGET_MS - (Date.now() - t0) < 40_000) return 0;
      try {
        const r = await fetch(`${BASE}/${m}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(payload), cache: 'no-store', signal: AbortSignal.timeout(9000),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) continue;
        const txt = (j?.candidates?.[0]?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || '').join('').trim();
        const px = Number(JSON.parse(txt.replace(/^```(?:json)?|```$/g, '').trim())?.price) || 0;
        if (px > 0) return px;
      } catch { /* coba berikutnya */ }
    }
  }
  return 0;
}

/** Blok prompt "mapping akhir pekan" untuk pair yang tutup Sabtu-Minggu (emas/forex). '' bila pasar buka / 24 jam. */
function weekendMappingBlock(pair, now = Date.now()) {
  if (pair?.open24x7 || !metalsWeekendClosed(now)) return '';
  const label = pair?.id || 'FOREX/EMAS';
  const open = nextOpenMs(pair, now);
  const openTxt = `sekitar ${fmtMt4(open, 7)} WIB`; // jam buka tepat tergantung broker (forex 17:00 NY, emas CME 18:00 NY)
  return `\n\n=== MODE MAPPING AKHIR PEKAN (PASAR ${label} TUTUP) ===
${pair ? '' : '- (Abaikan seluruh blok ini bila instrumen pada chart adalah BTC/kripto: pasar kripto buka 24 jam.)\n'}- Pasar sedang tutup. Analisa ini adalah PETA untuk sesi berikutnya yang buka ${openTxt}. "Harga Terakhir" = harga close Jumat di screenshot; JANGAN sebut screenshot basi karena pasar tutup.
- Semua order adalah Pending Order yang dipasang SETELAH pasar buka. Waktu Berakhir dihitung dari jam buka ${openTxt} (bukan dari jam sekarang): zona jangka pendek (Scalping) = buka + 2 jam, Intraday = buka + 6 jam, Swing = Daily Close hari berikutnya (sesuaikan dengan gaya zona aktif). Semua Waktu Berakhir wajib SETELAH ${openTxt}.
- Jadwal berita: tulis event pada hari buka berikutnya (Senin) dan Selasa dari data kalender, BUKAN event hari ini; tulis "Hindari trading" untuk jendela rilis di sesi buka tersebut.
- Wajib sebut risiko GAP pembukaan: bila harga buka melompat melewati/menembus zona, order zona itu batal (jangan dikejar). Sarankan menunggu 15-30 menit setelah buka sebelum memasang order Scalping.
=== AKHIR MODE MAPPING ===`;
}

// Candle terakhir (sudah dikalibrasi ke harga broker bila proksi) untuk digambar di peta zona.
function candlePack(ctx) {
  const snaps = ctx?.snapshots;
  if (!snaps?.length) return null;
  const bars = {};
  for (const tf of ['M15', 'H1', 'H4']) {
    const sn = snaps.find((x) => x.timeframe === tf);
    if (sn?.bars?.length) bars[tf] = sn.bars.slice(-72).map((b) => [b.time, b.open, b.high, b.low, b.close]);
  }
  // Event BOS/CHoCH asli dari mesin SMC (candle tertutup), per TF: [type, direction, level, time]
  const events = {};
  for (const tf of Object.keys(bars)) {
    const a = ctx.smc?.analyses?.find((x) => x.timeframe === tf && x.status === 'OK');
    const first = bars[tf][0]?.[0];
    const evs = (a?.structureEvents || []).filter((e) => Number.isFinite(Number(e.level)) && Number(e.time) >= Number(first)).slice(-6);
    if (evs.length) events[tf] = evs.map((e) => [e.type, e.direction, Number(e.level), Number(e.time)]);
  }
  return Object.keys(bars).length ? { source: ctx.source || '', provider: ctx.provider || '', bars, events } : null;
}

function feedPriceInfo(snapshots) {
  const q = snapshots?.find((x) => x.timeframe === 'M5') || snapshots?.find((x) => x.timeframe === 'M15');
  const bar = q?.bars?.at(-1);
  const close = Number(bar?.close || 0);
  if (!(close > 0)) return { price: 0, line: '', quote: null };
  const wib = bar.time ? new Date((Number(bar.time) + 300) * 1000 + 7 * 3600 * 1000).toISOString().slice(11, 16) : '';
  // Harga acuan jarak zona = BID terbaru dari EA (bukan close candle tertutup). Struktur SMC tetap dari candle tertutup.
  const bid = Number(q?.bid || 0), ask = Number(q?.ask || 0);
  if (bid > 0 && !(ask > 0 && ask < bid)) {
    const spread = ask > 0 ? ask - bid : null;
    const at = q.received_at ? new Date(q.received_at) : null;
    const atWib = at && !Number.isNaN(at.getTime()) ? new Date(at.getTime() + 7 * 3600 * 1000).toISOString().slice(11, 19) : '';
    const quote = { price: bid, bid, ask: ask > 0 ? ask : null, spread, receivedAt: q.received_at || null, atWib, closeRef: close, closeTf: q.timeframe };
    return { price: bid, quote, line: `\n\nHARGA FEED TERKINI (Bid MT4${atWib ? `, kuotasi ${atWib} WIB` : ''}): ${bid}${ask > 0 ? ` | Ask ${ask} | spread ${Number(spread.toFixed(5))}` : ''}. Close candle ${q.timeframe} tertutup terakhir${wib ? ` (±${wib} WIB)` : ''} = ${close} (hanya referensi struktur). Jarak zona dihitung dari Bid; order BUY terisi di Ask (Bid + spread), order SELL di Bid. Jika harga di screenshot berbeda >0.15% dari Bid ini, screenshot basi: tulis "Harga Terakhir" = Bid ini dan sebut singkat bahwa screenshot lebih lama.` };
  }
  return { price: close, quote: null, line: `\n\nHARGA FEED TERKINI (close candle ${q.timeframe} tertutup terakhir${wib ? `, ±${wib} WIB` : ''}): ${close}. Jika harga di screenshot berbeda >0.15% dari angka ini, screenshot basi: tulis "Harga Terakhir" = harga feed ini dan sebut singkat bahwa screenshot lebih lama.` };
}

function zoneCandidateData(smc, profile, price, zones = 2, skip = []) {
  try {
    const at = (tf) => smc?.analyses?.find((x) => x.timeframe === tf && x.status === 'OK')?.atr14;
    const h1 = at('H1'), h4 = at('H4'), m15 = at('M15');
    const atr = h1 > 0 && h4 > 0 ? { h1, h4, m15: m15 > 0 ? m15 : undefined, src: 'OHLC' } : null;
    if (zones === 3) {
      const R3 = zoneRange3(profile, price, atr);
      const c = R3 ? buildZoneCandidates3(smc?.analyses, price, R3, { h1: h1 || R3.atr.h1, m15: R3.atr.m15 }, 0.15, skip) : null;
      return { text: c?.text || '', res: c?.res || null };
    }
    const R = zoneRange(profile, price, atr);
    const c = buildZoneCandidates(smc?.analyses, price, R, h1 || 0);
    return { text: c?.text || '', res: c ? { SELL: { 1: c.res.SELL.z1, 2: c.res.SELL.z2 }, BUY: { 1: c.res.BUY.z1, 2: c.res.BUY.z2 } } : null };
  } catch { return { text: '', res: null }; }
}

async function loadMarketContext(pairId, sourceMode = 'cloud', zones = 2, opts = {}) {
  // Produksi Headway: pair berproxy (XAUUSD) tidak boleh memakai Binance PAXG; paksa OHLC EA MT4.
  if (process.env.DISABLE_CLOUD_PROXY === '1' && pairId && cloudProxyOf(pairId) && (sourceMode === 'cloud' || sourceMode === 'auto')) sourceMode = 'mt4';
  if (!pairId || sourceMode === 'screenshot') return { text: '', snapshots: [], smc: null, source: 'SCREENSHOT' };
  if (sourceMode === 'mt4') return loadMt4Context(pairId, zones, opts);
  if (sourceMode === 'auto') {
    const cloud = await loadMarketContext(pairId, 'cloud', zones, opts);
    if (cloud.snapshots?.length) return cloud;
    const mt4 = await loadMt4Context(pairId, zones, opts);
    if (mt4.snapshots?.length) return mt4;
    return { ...cloud, error: [cloud.error, mt4.error].filter(Boolean).join(' | ') };
  }
  try {
    const result = await getCloudMarketSnapshots(pairId);
    let snapshots = result.snapshots;
    const profile = PAIRS[pairId] || resolvePair(pairId);
    // Proksi (PAXG untuk XAUUSD): geser seluruh candle ke harga broker yang terbaca dari screenshot.
    let proxyLine = '';
    let proxyNote = '';
    if (result.proxy) {
      const b = applyBasis(snapshots, opts.brokerPrice, { dec: profile?.dec ?? 2, maxPct: result.maxBasisPct || 1.5 });
      snapshots = b.snapshots;
      if (b.basis) {
        proxyLine = `\n\nCATATAN PROKSI: candle berasal dari ${result.proxyDesc || result.proxy} dan SUDAH digeser ${b.basis.offset >= 0 ? '+' : ''}${b.basis.offset} agar sama dengan harga broker di screenshot (${b.basis.broker}). Semua level di data ini sudah dalam harga broker. Candle saat pasar tutup (akhir pekan/jeda harian) sudah dibuang.`;
        proxyNote = `🪙 Data ${pairId} dari ${result.provider} (${result.proxyDesc || result.proxy}), digeser ${b.basis.offset >= 0 ? '+' : ''}${b.basis.offset} ke harga broker ${b.basis.broker} (feed ${b.basis.ref}). Selisih broker vs feed bisa berubah; cocokkan level dengan chart MT4.`;
      } else {
        proxyLine = `\n\nCATATAN PROKSI: candle berasal dari ${result.proxyDesc || result.proxy}, TIDAK dikalibrasi ke broker (${b.note}). Harganya bisa selisih dari harga broker.`;
        proxyNote = `⚠️ Data ${pairId} dari ${result.provider} TANPA kalibrasi ke broker (${b.note}). Level zona dalam harga feed: geser manual sebesar selisih harga broker − feed sebelum memasang order.`;
      }
    }
    const quoteSnap = snapshots.find((x) => x.timeframe === 'M5') || snapshots.find((x) => x.timeframe === 'M15');
    const quotePrice = Number(quoteSnap?.bars?.at(-1)?.close || 0);
    if (quotePrice && profile?.priceRange && (quotePrice < profile.priceRange[0] || quotePrice > profile.priceRange[1]))
      throw new Error(`Harga Cloud ${quotePrice} di luar rentang profil ${pairId}; periksa CLOUD_SYMBOL_MAP.`);
    const byTf = Object.fromEntries(snapshots.map((x) => [x.timeframe, x.bars]));
    const smc = buildSmcReport(byTf, { minFvgAtr: result.proxy === 'FX' ? 0.25 : 0.08 }); // forex: FVG mikro dari last-trade = noise
    const report = smc?.analyses?.length ? `\n\nRINGKASAN SMC DETERMINISTIK DARI CLOUD (candle tertutup; bukan sinyal otomatis):\n${smc.promptBlock}` : '';
    const feed = feedPriceInfo(snapshots);
    const zcd = zoneCandidateData(smc, profile, feed.price || quotePrice, zones, opts.zonesOff || []);
    const zc = zcd.text;
    return { text: cloudMarketContext(snapshots, result.warnings, result.provider) + proxyLine + report + feed.line + (zc ? `\n\n${zc}` : ''), zoneCandidates: zc, zoneRes: zcd.res, feedPrice: feed.price, snapshots, smc, source: 'CLOUD', provider: result.provider, warnings: result.warnings, proxyNote, scrub: result.scrub || {} };
  } catch (e) {
    return { text: `DATA OHLC CLOUD TIDAK TERSEDIA/VALID (${String(e.message || e).slice(0, 220)}). Gunakan screenshot saja dan jangan klaim konfirmasi OHLC.`, snapshots: [], smc: null, source: 'NONE', error: String(e.message || e) };
  }
}

// "Thinking" untuk penalaran struktur bertahap. GEMINI_THINKING_BUDGET=0 mematikan. Model yang menolak -> dicoba ulang tanpa thinking.
const THINKING_BUDGET = (() => {
  const v = Number(process.env.GEMINI_THINKING_BUDGET);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 1024;
})();
const withThinking = (gen) => (THINKING_BUDGET > 0 ? { ...gen, thinkingConfig: { thinkingBudget: THINKING_BUDGET } } : gen);
const stripThinking = (payload) => {
  const { thinkingConfig, ...gen } = payload.generationConfig || {};
  return { ...payload, generationConfig: gen };
};
const thinkingRejected = (status, json) => status === 400 && /thinking/i.test(json?.error?.message || '');

// Error yang layak dicoba ulang dengan model/mode lain (kuota, overload, model tidak ada, tool search ditolak)
function shouldFallback(status, json) {
  if ([404, 429, 500, 502, 503, 504].includes(status)) return true;
  const msg = (json?.error?.message || '').toLowerCase();
  const st = json?.error?.status || '';
  return (
    st === 'RESOURCE_EXHAUSTED' ||
    st === 'UNAVAILABLE' ||
    /quota|rate.?limit|exhausted|overload|unavailable|google.?search|grounding|tool/.test(msg)
  );
}

// Lampiran kandidat mesin: zona yang dibatalkan validator diberi tanda agar tidak terbaca sebagai setup
function markDeadCandidates(zc, dead = []) {
  if (!zc || !dead.length) return zc;
  return String(zc).split('\n').map((l) => {
    const m = /^-\s*(BUY|SELL)\s+Zona\s*(\d)\b/i.exec(l);
    return m && dead.includes(`${m[1].toUpperCase()}${m[2]}`) && !/⛔/.test(l) ? `${l}  ⛔ [kandidat mesin; DIBATALKAN validator server (R:R/risiko/lot/zona) - bukan setup]` : l;
  }).join('\n');
}

// Arah bias final (BUY/SELL/null) dari keputusan bias server (lib/biasFinal): dipakai menandai order VALIDATED vs CANDIDATE
function rb0Dir(info) {
  if (!info || info.neutral) return null;
  return info.direction === 'BULLISH' ? 'BUY' : info.direction === 'BEARISH' ? 'SELL' : null;
}

export async function POST(req) {
  const denied = requirePin(req);
  if (denied) return denied;
  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Body request tidak valid.' }, { status: 400 });
    }

    const { images = [], balance = 0, risk = 2 } = body;
    // Sesi dihitung dari jam WIB server (bukan isian UI yang bisa basi): 06-14 Asia, 14-19 Eropa, selebihnya New York.
    const wibHour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(new Date()));
    const session = wibHour >= 6 && wibHour < 14 ? 'Sesi Asia' : wibHour >= 14 && wibHour < 19 ? 'Sesi Eropa' : 'Sesi New York';
    const sessionUi = String(body.session || '').trim();
    const pairChoice = PAIR_ID_OK(body.pair) ? body.pair : 'AUTO';
    const connectionId = typeof body.connectionId === 'string' ? (body.connectionId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48) || null) : null;
    const fixedPair = pairChoice === 'AUTO' ? null : PAIRS[pairChoice];
    const strict = body.strict !== false; // Validator Zona & Konflik Order (Pengaturan), default ON
    const zones = body.zoneStyle === 'three' ? 3 : 2;
    const zonesOff = zones === 3 && body.skipZone1 === true ? [1] : []; // Zona 1 (Scalping) dimatikan user (hanya mode 3 zona) // Gaya Zona: 2 zona (lama) atau 3 zona (Scalp/Intraday/Swing)
    // Pilihan mesin dari Pengaturan: 'gateway' = model gateway menulis analisa (Gemini hanya membaca gambar bila ada).
    const engineGw = body.engine === 'gateway';
    const wantTwoStage = body.mode === '2stage' || engineGw;
    const geminiModel = GEM_RE.test(String(body.geminiModel || '').trim()) ? String(body.geminiModel).trim() : GEMINI_MODEL;
    const ATTEMPTS = attemptsFor(geminiModel);
    const marketSource = ['cloud', 'mt4', 'auto', 'screenshot'].includes(body.marketSource) ? body.marketSource : 'cloud';
    const gwModel = gwModelOf(body.gwModel);

    // Prioritas: key dari UI (header) -> env Vercel
    const apiKey = (req.headers.get('x-gemini-key') || '').trim() || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Gemini API Key belum diatur. Isi di pengaturan atau set GEMINI_API_KEY di Vercel.' },
        { status: 400 }
      );
    }

    // Tanpa screenshot hanya untuk Sumber Data = MT4 EA dengan pair tetap (bukan AUTO) dan bukan mode 2-tahap.
    const noShot = Array.isArray(images) && images.length === 0 && marketSource === 'mt4' && !!fixedPair;
    if (!Array.isArray(images) || (images.length === 0 && !noShot)) {
      return NextResponse.json({ error: 'Upload minimal 1 screenshot chart. (Tanpa screenshot hanya untuk Sumber Data MT4 EA + pair dipilih manual, bukan AUTO.)' }, { status: 400 });
    }
    if (images.length > MAX_IMAGES) {
      return NextResponse.json({ error: `Maksimal ${MAX_IMAGES} gambar per analisa.` }, { status: 400 });
    }
    for (const img of images) {
      if (!img?.data || typeof img.data !== 'string') {
        return NextResponse.json({ error: 'Data gambar kosong/rusak.' }, { status: 400 });
      }
      if (!ALLOWED_MIME.includes(img.mimeType)) {
        return NextResponse.json({ error: `Format gambar tidak didukung: ${img.mimeType}` }, { status: 400 });
      }
    }

    const labels = images.map((img) => img.label || 'Chart');
    const riskUsd = ((Number(balance) || 0) * (Number(risk) || 0)) / 100;
    let resolvedPair = fixedPair;
    let autoPairNote = '';
    let chartPrice = 0; // harga broker terakhir dari screenshot (untuk kalibrasi proksi PAXG)

    // AUTO + Gemini langsung: ekstrak pair secara ringan terlebih dahulu agar Cloud OHLC
    // dapat dimuat sebelum analisa final. Jika ekstraksi gagal, V1 screenshot-flow tetap berjalan.
    if (!resolvedPair && !wantTwoStage && marketSource !== 'screenshot') {
      try {
        // Ringan: satu gambar + skema kecil (pair + harga). Flash-lite dulu (hemat kuota), lalu model utama; gambar pertama lalu terakhir.
        const tries = [images[0], ...(images.length > 1 ? [images[images.length - 1]] : [])];
        const why = [];
        for (const img of tries) {
          const pairPayload = {
            systemInstruction: { parts: [{ text: QUOTE_SYSTEM }] },
            contents: [{ role: 'user', parts: [{ text: 'Pair apa pada chart ini, dan berapa harga terakhirnya?' }, { inlineData: { mimeType: img.mimeType, data: img.data } }] }],
            generationConfig: QUOTE_GEN,
          };
          for (const m of ['gemini-flash-lite-latest', GEMINI_MODEL]) {
            if (BUDGET_MS - (Date.now() - t0) < 40_000) { why.push('waktu habis'); break; }
            try {
              const exRes = await fetch(`${BASE}/${m}:generateContent`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify(pairPayload), cache: 'no-store', signal: AbortSignal.timeout(12000),
              });
              const exJson = await exRes.json().catch(() => ({}));
              if (!exRes.ok) { why.push(`${m.replace('gemini-', '').replace('-latest', '')} HTTP ${exRes.status}`); continue; }
              const txt = (exJson?.candidates?.[0]?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || '').join('').trim();
              const q = JSON.parse(txt.replace(/^```(?:json)?|```$/g, '').trim());
              const rp = resolvePair(q?.pair);
              if (rp) { resolvedPair = rp; chartPrice = Number(q?.price) || 0; break; }
              why.push(`${m.replace('gemini-', '').replace('-latest', '')} pair kosong`);
            } catch (e) { why.push(`${m.replace('gemini-', '').replace('-latest', '')} ${e?.name === 'TimeoutError' ? 'timeout' : 'respons tak terbaca'}`); }
          }
          if (resolvedPair) break;
        }
        if (!resolvedPair) autoPairNote = `Pair AUTO tidak terbaca dari screenshot (${why.slice(0, 4).join('; ') || 'tanpa detail'}); analisis berjalan tanpa OHLC Cloud. Pilih pair manual di Pengaturan agar data candle dipakai.`;
      } catch (e) {
        autoPairNote = 'Ekstraksi pair AUTO gagal; analisis berjalan dengan screenshot saja. Pilih pair manual agar data candle dipakai.';
      }
    }

    // Kalender ekonomi live (ForexFactory) + Finnhub opsional; gagal -> tetap lanjut dengan catatan offline
    const fundamental = await buildFundamentalBlock((resolvedPair || fixedPair)?.id || null).catch((e) => ({
      text: `=== DATA FUNDAMENTAL LIVE ===\nSTATUS KALENDER: OFFLINE (${e?.message || 'error'}). Jadwal berita TIDAK tersedia.\n=== AKHIR DATA FUNDAMENTAL ===`,
      offline: true,
    }));

    if (resolvedPair && !chartPrice && marketSource !== 'screenshot' && marketSource !== 'mt4' && cloudProxyOf(resolvedPair.id) && process.env.DISABLE_CLOUD_PROXY !== '1') {
      chartPrice = await readChartPrice(images, apiKey, t0).catch(() => 0);
    }
    const sane = (px, p) => (px > 0 && (!p?.priceRange || (px >= p.priceRange[0] && px <= p.priceRange[1])) ? px : 0);
    chartPrice = sane(chartPrice, resolvedPair);
    const marketInitial = resolvedPair ? await loadMarketContext(resolvedPair.id, marketSource, zones, { brokerPrice: chartPrice, zonesOff, connectionId }) : { text: '', snapshots: [], smc: null, source: 'NONE' };
    let mt4ContextUsed = marketInitial;
    if (noShot && !(marketInitial.snapshots?.length)) {
      return NextResponse.json({
        error: `DATA TIDAK CUKUP: tanpa screenshot butuh OHLC MT4 yang segar (maks 20 menit). Pastikan EA AureusDesk Bridge menyala di MT4 Headway.${marketInitial.error ? ' Detail: ' + marketInitial.error : ''}`,
        code: 'INSUFFICIENT_DATA',
      }, { status: 422 });
    }
    const weekendMap = weekendMappingBlock(resolvedPair || fixedPair);
    const parts = [{ text: buildUserPrompt({ balance, risk, session, labels, pair: resolvedPair || fixedPair, fundamental: fundamental.text, strict }) +
      weekendMap + (marketInitial.text ? `\n\n${marketInitial.text}` : '') }];
    images.forEach((img, i) => {
      parts.push({ text: `Gambar ${i + 1} — ${labels[i]}` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    });

    const basePayload = {
      systemInstruction: { parts: [{ text: buildSystemInstruction(resolvedPair || fixedPair, strict) + (zones === 3 ? zoneStyleAddendum(resolvedPair || fixedPair) + (zonesOff.length ? ZONE1_OFF_SYSTEM : '') : '') + (marketInitial.snapshots?.length ? SMC_SYSTEM_ADDENDUM : '') + (noShot ? OHLC_ONLY_SYSTEM : '') }] },
      contents: [{ role: 'user', parts }],
      generationConfig: withThinking({
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 12288, // termasuk token thinking
      }),
    };
    const noThinkModels = new Set(); // model yang menolak thinkingConfig
    const payloadFor = (model, p) => (noThinkModels.has(model) ? stripThinking(p) : p);
    const callGemini = async (model, p, timeoutMs) => {
      const go = async (body) => {
        const r = await fetch(`${BASE}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs),
        });
        return { r, j: await r.json().catch(() => ({})) };
      };
      let out = await go(payloadFor(model, p));
      if (thinkingRejected(out.r.status, out.j) && !noThinkModels.has(model)) {
        noThinkModels.add(model);
        out = await go(stripThinking(p));
      }
      return out;
    };

    // ---- Mode 2 tahap (opsional): Gemini ekstrak JSON -> gateway menulis analisa ----
    let gwDiag = '';
    let two = null; // {text, model, ms1, ms2, dropped, cands}
    let twoNote = '';
    let twoSystem = '';
    let twoUser = '';
    const log = [];
    if (wantTwoStage && noShot) {
      // Tanpa screenshot: model gateway menulis analisa langsung dari OHLC MT4 (tidak ada tahap ekstraksi gambar).
      if (!gwConfigured()) {
        return NextResponse.json({ error: 'Model gateway belum dikonfigurasi di server (OPENAI_COMPAT_*). Matikan mode 2 tahap untuk memakai Gemini.' }, { status: 400 });
      }
      const pNo = fixedPair;
      twoSystem = buildSystemInstruction(pNo, strict) + (zones === 3 ? zoneStyleAddendum(pNo) + (zonesOff.length ? ZONE1_OFF_SYSTEM : '') : '') + SMC_SYSTEM_ADDENDUM + OHLC_ONLY_SYSTEM;
      twoUser = buildUserPrompt({ balance, risk, session, labels, pair: pNo, fundamental: fundamental.text, strict }) +
        weekendMappingBlock(pNo) + `\n\n${marketInitial.text}`;
      const g = await gatewayChat({ model: gwModel, system: twoSystem, user: twoUser, timeoutMs: BUDGET_MS - (Date.now() - t0) - 2_000 });
      log.push(`oneshot-gateway ${gwModel}: ${g.ok ? 'ok ' + g.ms + 'ms' : g.error}`);
      if (!g.ok) {
        return NextResponse.json({ error: `Model ${gwModel} gagal: ${g.error}. Matikan mode 2 tahap untuk memakai Gemini.` }, { status: 502 });
      }
      let gOut = g;
      if (!looksLikeAnalysis(gOut.text)) {
        // Sebagian gateway mengabaikan role system / membalas basa-basi: coba sekali lagi dengan instruksi digabung ke pesan user.
        const merged = `${twoSystem}\n\n=====\nTUGAS (ikuti FORMAT OUTPUT di atas, tulis analisa lengkap, bukan basa-basi):\n${twoUser}`;
        const g2 = await gatewayChat({ model: gwModel, system: '', user: merged, timeoutMs: Math.max(5_000, BUDGET_MS - (Date.now() - t0) - 2_000) });
        log.push(`oneshot-gateway-merged ${gwModel}: ${g2.ok ? 'ok ' + g2.ms + 'ms' : g2.error}`);
        if (g2.ok && looksLikeAnalysis(g2.text)) gOut = g2;
        else gwDiag = `diag: kirim ${g.sent} char, prompt_tokens=${g.usage?.prompt ?? '?'}, completion_tokens=${g.usage?.completion ?? '?'}, finish=${g.finish ?? '?'}`;
      }
      two = { text: gOut.text, model: gwModel, exModel: null, ms1: 0, ms2: gOut.ms, dropped: 0, cands: 0, noShot: true };
    } else if (wantTwoStage) {
      if (!gwConfigured()) {
        twoNote = 'Mode 2 tahap diminta, tetapi gateway belum dikonfigurasi di server; dijalankan dengan Gemini langsung.';
      } else {
        try {
          const exParts = [{ text: 'Ekstrak data dari screenshot berikut sesuai skema.' }];
          images.forEach((img, i) => {
            exParts.push({ text: `Gambar ${i + 1} — ${labels[i]}` });
            exParts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
          });
          const exPayload = {
            systemInstruction: { parts: [{ text: EXTRACT_SYSTEM }] },
            contents: [{ role: 'user', parts: exParts }],
            generationConfig: { temperature: 0, maxOutputTokens: 6144, responseMimeType: 'application/json', responseSchema: EXTRACT_SCHEMA },
          };
          let data = null;
          let exModel = null;
          for (const m of [geminiModel, ...GEMINI_FALLBACK_MODELS.filter((x) => x !== geminiModel).slice(0, 1)]) {
            const left = BUDGET_MS - (Date.now() - t0);
            if (left < 30_000) break;
            try {
              const r = await fetch(`${BASE}/${m}:generateContent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify(exPayload),
                cache: 'no-store',
                signal: AbortSignal.timeout(Math.min(25_000, left - 20_000)),
              });
              const j = await r.json().catch(() => ({}));
              log.push(`tahap1 ${m}: ${r.status}`);
              if (!r.ok) continue;
              const raw = (j?.candidates?.[0]?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || '').join('').trim();
              data = normalizeExtract(JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim()));
              exModel = m;
              break;
            } catch (e) {
              log.push(`tahap1 ${m}: ${e?.name === 'TimeoutError' ? 'timeout' : e?.message}`);
            }
          }
          const ms1 = Date.now() - t0;
          if (!data) throw new Error('ekstraksi gagal');
          const p2 = fixedPair || resolvedPair || resolvePair(data.pair) || (data.lastPrice ? guessPairByPrice(data.lastPrice) : null);
          const built = buildCandidates(data, p2);
          const mt4Two = await loadMarketContext((fixedPair || p2)?.id, marketSource, zones, { brokerPrice: Number(data.lastPrice) || chartPrice, zonesOff, connectionId });
          twoSystem = buildSystemInstruction(fixedPair || resolvedPair || p2, strict) + (zones === 3 ? zoneStyleAddendum(fixedPair || resolvedPair || p2) + (zonesOff.length ? ZONE1_OFF_SYSTEM : '') : '') + '\n' + STAGE2_ADDENDUM + (mt4Two.snapshots?.length ? SMC_SYSTEM_ADDENDUM : '');
          if (mt4Two.snapshots?.length) mt4ContextUsed = mt4Two;
          twoUser =
            buildUserPrompt({ balance, risk, session, labels, pair: fixedPair || resolvedPair || p2, fundamental: fundamental.text, strict }) +
            weekendMappingBlock(fixedPair || resolvedPair || p2) + '\n\n' + formatDataBlock(data, p2, built) + (mt4Two.text ? `\n\n${mt4Two.text}` : '');
          const left2 = BUDGET_MS - (Date.now() - t0);
          const g = await gatewayChat({ model: gwModel, system: twoSystem, user: twoUser, timeoutMs: left2 - 2_000 });
          log.push(`tahap2 ${gwModel}: ${g.ok ? 'ok ' + g.ms + 'ms' : g.error}`);
          if (!g.ok) throw new Error(`gateway: ${g.error}`);
          two = { text: g.text, model: gwModel, exModel, ms1, ms2: g.ms, dropped: built.dropped, cands: built.candidates.length };
        } catch (e) {
          twoNote = `Mode 2 tahap gagal (${String(e?.message || e).slice(0, 120)}); otomatis memakai Gemini langsung.`;
        }
      }
    }

    // ---- Jalankan rantai percobaan ----
    let res = null;
    let json = {};
    let used = null;

    // Jika AUTO terdeteksi di tahap ekstraksi tetapi gateway tahap 2 gagal, fallback Gemini langsung juga harus menerima OHLC yang sama
    // (harus dikirim SEBELUM percobaan pertama, bukan sesudahnya).
    if (!two && !resolvedPair && mt4ContextUsed?.snapshots?.length && mt4ContextUsed.text) {
      parts.push({ text: mt4ContextUsed.text });
      if (!marketInitial.snapshots?.length && basePayload.systemInstruction?.parts?.[0]) basePayload.systemInstruction.parts[0].text += SMC_SYSTEM_ADDENDUM;
    }
    for (const attempt of two ? [] : ATTEMPTS) {
      const elapsed = Date.now() - t0;
      const remaining = BUDGET_MS - elapsed;
      if (used === null && log.length > 0 && remaining < 8_000) break; // sisa waktu terlalu sedikit

      try {
        const { r, j } = await callGemini(attempt.model, basePayload, Math.max(8_000, remaining));
        log.push(`${attempt.model}: ${r.status}${noThinkModels.has(attempt.model) ? ' (tanpa thinking)' : ''}`);
        res = r;
        json = j;
        if (r.ok) {
          used = attempt;
          break;
        }
        if (!shouldFallback(r.status, j)) break; // mis. API key salah -> tidak ada gunanya mencoba lagi
      } catch (e) {
        log.push(`${attempt.model}: ${e?.name === 'TimeoutError' ? 'timeout' : e?.message}`);
        res = null;
      }
    }

    if (two) used = { model: `2tahap:${two.model}` };
    if (!used) {
      const status = res?.status || 504;
      let msg = json?.error?.message || (res ? `HTTP ${status}` : 'Waktu habis menunggu Gemini.');
      if (status === 429) {
        msg =
          'Kuota Gemini API habis di semua model (429). Tunggu reset kuota, aktifkan billing di Google AI Studio, atau isi API Key lain di pengaturan. Detail: ' +
          msg;
      }
      console.error('[analyze] semua percobaan gagal:', log.join(' | '));
      return NextResponse.json({ error: `Gemini API: ${msg}`, attempts: log }, { status });
    }

    const candidate = json?.candidates?.[0];
    const text = two
      ? fixInlineTables(two.text)
      : fixInlineTables(
          (candidate?.content?.parts || [])
            .filter((p) => !p.thought)
            .map((p) => p.text || '')
            .join('')
            .trim()
        );

    // Model gateway kadang membalas sembarang teks (mis. kutipan/basa-basi). Tolak bila format analisa wajib tidak ada,
    // agar tidak diubah validator menjadi "NO TRADE" palsu.
    if (two && text) {
      if (!looksLikeAnalysis(text)) {
        return NextResponse.json({
          error: `Model ${two.model} tidak menghasilkan format analisa yang wajib (tanpa BIAS UTAMA/tabel). Cuplikan balasan: "${text.replace(/\s+/g, ' ').slice(0, 120)}". ${gwDiag ? ' ' + gwDiag + '.' : ''} Coba model lain atau pilih mesin Gemini di Pengaturan.`,
          code: 'BAD_MODEL_OUTPUT',
          attempts: log,
        }, { status: 502 });
      }
    }

    if (!text) {
      const reason =
        json?.promptFeedback?.blockReason || candidate?.finishReason || 'Respons kosong dari model.';
      return NextResponse.json({ error: `AI tidak menghasilkan analisa (${reason}).`, attempts: log }, { status: 502 });
    }

    // Verifikasi rumus risiko: Risiko = Lot x Jarak SL x 100 (koreksi angka karangan AI)
    // Pair: pilihan user, atau hasil deteksi AI (baris **PAIR:**), cadangan tebakan dari harga terakhir
    let pairCfg = fixedPair || resolvedPair || extractPair(text);
    let pairNote = '';
    if (!pairCfg) {
      const m = text.match(/harga\s+terakhir[^0-9]{0,30}([\d.,]+)/i);
      const g = m ? guessPairByPrice(parseFloat(m[1].replace(/,/g, ''))) : null;
      if (g) {
        pairCfg = g;
        pairNote = `ℹ️ Nama pair tidak terbaca jelas; validator memakai profil ${g.id} berdasarkan level harga. Pilih pair manual di Pengaturan bila salah.`;
      }
    }
    if (!pairCfg) {
      pairNote = '⚠️ Pair tidak terdeteksi / belum didukung validator - angka risiko TIDAK diverifikasi otomatis. Hitung manual atau pilih pair di Pengaturan.';
    }
    // ATR(14) dihitung dari OHLC provider bila tersedia; profil pair hanya fallback terakhir.
    const smcAnalysesForAtr = mt4ContextUsed?.smc?.analyses || [];
    const h1Atr = smcAnalysesForAtr.find((x) => x.timeframe === 'H1' && x.status === 'OK')?.atr14;
    const h4Atr = smcAnalysesForAtr.find((x) => x.timeframe === 'H4' && x.status === 'OK')?.atr14;
    const m15Atr = smcAnalysesForAtr.find((x) => x.timeframe === 'M15' && x.status === 'OK')?.atr14;
    const marketAtr = h1Atr > 0 && h4Atr > 0 ? { h1: h1Atr, h4: h4Atr, m15: m15Atr > 0 ? m15Atr : undefined, src: `${mt4ContextUsed.source}_OHLC` } : null;

    // Rangkaian validator: koreksi risiko -> validator zona & konflik (angka entry/SL/TP/lot tidak diubah)
    const capPerDirection = body.riskCap !== 'order'; // 'order' = batas lama (per order saja)
    const smcAnalyses = mt4ContextUsed?.snapshots?.length ? mt4ContextUsed?.smc?.analyses : null;
    let idNumNote = '';
    const runChecks = (rawIn) => {
      const idFix = pairCfg && pairCfg.priceRange?.[0] >= 500 ? normalizeIdNumbers(rawIn) : { markdown: rawIn, changed: 0 };
      if (idFix.changed) idNumNote = `🔢 ${idFix.changed} angka berformat Indonesia (56.964,10) diubah ke format standar sebelum validasi (model cadangan mengabaikan format).`;
      const dcFix = fixDailyClose(idFix.markdown, new Date());
      const wkFix = fixWeekendExpiry(dcFix.markdown, new Date(), pairCfg);
      const z1Off = disableZoneRows(wkFix.markdown, zonesOff);
      const rawTxt = z1Off.markdown;
      let txt = rawTxt;
      // Bias final ditentukan SATU kali dari teks asli model + struktur mesin; dipakai header, label arah, keputusan server, 4B.
      const biasInfo = decideBias({ modelHeadline: extractBias(rawTxt), engineBias: mt4ContextUsed?.smc?.higherBias, structureTf: structureTfOf(mt4ContextUsed?.smc?.analyses) });
      let smcNotes = [];
      if (pairCfg && smcAnalyses?.length) {
        try {
          const feedPx = Number(mt4ContextUsed.feedPrice || 0);
          const e = enforceSmcZones(rawTxt, { analyses: smcAnalyses, atrH1: smcAnalyses.find((x) => x.timeframe === 'H1' && x.status === 'OK')?.atr14 || 0, price: feedPx || parseLastPrice(rawTxt, pairCfg) || 0, priceRe: pairCfg.priceRe, candidates: mt4ContextUsed.zoneRes || null });
          txt = e.markdown;
          smcNotes = e.notes;
          const atrH1v = smcAnalyses.find((x) => x.timeframe === 'H1' && x.status === 'OK')?.atr14 || 0;
          const tpFix = syncTargets(txt, { analyses: smcAnalyses, atrH1: atrH1v, price: feedPx || parseLastPrice(rawTxt, pairCfg) || 0, priceRe: pairCfg.priceRe });
          txt = tpFix.markdown;
          smcNotes = [...smcNotes, ...tpFix.notes];
          // Konsistensi narasi vs mesin: bias, label arah, bias TF, nama Level Kunci, Waktu Berakhir (server menang atas Gemini)
          if (biasInfo.override) {
            txt = syncHeadline(txt, biasInfo);
            smcNotes.push(`🧭 KONFLIK BIAS: model menulis ${biasInfo.model.direction || 'arah tidak jelas'}, struktur ${biasInfo.structureTf} mesin ${biasInfo.structure}; bias final server = ${biasInfo.final} (rincian di panel Bias).`);
          }
          for (const fix of [
            (m) => syncBiasLabels(m, biasInfo.final),
            (m) => syncTfBias(m, smcAnalyses),
            (m) => syncLevelLabels(m, smcAnalyses, feedPx),
            (m) => syncSummaryLevels(m, smcAnalyses, feedPx),
            (m) => syncExpiry(m, new Date(), pairCfg),
          ]) {
            const r = fix(txt);
            txt = r.markdown;
            smcNotes = [...smcNotes, ...r.notes];
          }
        } catch (err) {
          console.error('[analyze] smcGuard error:', err);
        }
      }
      // Sumber tunggal angka zona, tahap 1: samakan Entry/SL/TP1 Bagian 3 dengan 4B; setup yang tak bisa diselaraskan dibatalkan SEBELUM lot/risiko dihitung
      let staleChanges = [];
      if (pairCfg) {
        const rc1 = reconcileZones(txt, { dec: pairCfg.dec });
        txt = rc1.markdown;
        staleChanges = rc1.changes;
        smcNotes = [...smcNotes, ...rc1.notes];
      }
      const last = pairCfg ? parseLastPrice(txt, pairCfg) : null;
      const atr = pairCfg && last ? (marketAtr || parseATR(txt, pairCfg, last)) : null;
      const c = pairCfg
        ? verifyRiskTables(txt, riskUsd, pairCfg, new Date(), { last, capPerDirection, zones, spec: mt4ContextUsed?.brokerSpec || null, requireSpec: true, specWhy: mt4ContextUsed?.brokerSpec ? null : (mt4ContextUsed?.specWhy || 'sumber data bukan EA MT4 v3.2') })
        : { markdown: txt, notes: [], fixes: [], tablesChecked: 0 };
      let md = c.markdown;
      let g = { notes: [], flags: { cancel: [], shift: [], fix: [] }, skipped: null, atr };
      if (strict && pairCfg) {
        try {
          g = applyOrderGuard(md, { pair: pairCfg, bias: extractBias(txt), atr, zones, spreadVerified: spreadInfo(mt4ContextUsed?.quote).valid });
          md = g.markdown;
        } catch (e) {
          console.error('[analyze] orderGuard error:', e);
        }
      }
      // Tahap 2 (setelah validator & guard): hitung ulang turunan (jarak, R:R, risiko, rincian) dari angka final 4B, audit, batalkan bila masih tak selaras
      if (pairCfg && c.tablesChecked) {
        const rc2 = reconcileZones(md, { dec: pairCfg.dec, mult: c.mult });
        md = rc2.markdown;
        smcNotes = [...smcNotes, ...rc2.notes];
        if (rc2.mismatches.length) {
          const cm = cancelMismatched(md, rc2.mismatches);
          md = cm.markdown;
          smcNotes = [...smcNotes, ...cm.notes];
        }
        // Teks bebas (Ringkasan Cepat, Skenario Batal, Manajemen Posisi, kesimpulan) mengikuti angka final; zona batal -> WAIT / NO TRADE
        const nr = syncNarrative(md, { dec: pairCfg.dec, stale: [...staleChanges, ...rc2.changes] });
        md = nr.markdown;
        if (nr.notes.length) smcNotes = [...smcNotes, `📝 ${nr.notes.length} baris teks bebas disamakan dengan tabel final (Entry/SL/TP/R:R/lot/risiko).`];
        if (nr.mismatches.length) smcNotes = [...smcNotes, `⚠️ ${nr.mismatches.length} baris teks bebas masih memuat angka yang tidak bisa dipetakan ke satu zona: ikuti tabel Bagian 3/4B.`];
        // Pembatalan karena 4B sudah menolak order (batas risiko / R:R / lot) tidak mengubah total; hanya pembatalan lain yang perlu catatan
        if (rc2.cancelled.some((x) => !/tidak punya order/.test(x.why)) || rc2.mismatches.length) smcNotes = [...smcNotes, '⚠️ Ada setup dibatalkan pada tahap akhir: "Total risiko" di catatan verifikasi dihitung ulang dari order yang aktif.'];
      }
      // Invalidation (struktur) dipisah dari SL (batas risiko) dan diverifikasi terhadap level mesin SMC; peringatan zona sempit vs spread broker (hanya peringatan)
      if (pairCfg && c.tablesChecked) {
        const inv = syncInvalidation(md, { analyses: smcAnalyses, dec: pairCfg.dec });
        md = inv.markdown;
        const lab = labelConfirmationLevels(md, { dec: pairCfg.dec, items: inv.items });
        md = lab.markdown;
        const sp = spreadWarnings(md, { quote: mt4ContextUsed?.quote || null, dec: pairCfg.dec });
        md = sp.markdown;
        const ov = zoneOverlap(md, { analyses: smcAnalyses, dec: pairCfg.dec });
        md = ov.markdown;
        smcNotes = [...smcNotes, ...inv.notes, ...lab.notes, ...sp.notes, ...ov.notes];
      }
      // Catatan lama yang menyebut zona yang akhirnya batal (mis. "entry 3545.95 berjarak ...") dibuang agar tidak ada angka usang
      const dead = pairCfg ? deadKeys(md, { dec: pairCfg.dec }) : [];
      smcNotes = pruneNotes(smcNotes, dead);
      g = { ...g, notes: pruneNotes(g.notes || [], dead) };
      // error yang layak generate ulang: arah entry salah (guard) + arah SL/TP salah (guard Bagian 3, riskCheck 4B)
      const fixes = [...(g.flags?.fix || []), ...(c.fixes || [])];
      if (z1Off.notes.length) smcNotes = [...smcNotes, ...z1Off.notes];
      if (wkFix.notes.length) smcNotes = [...smcNotes, `🗓️ ${wkFix.notes[0]}`];
      if (dcFix.notes.length) smcNotes = [...smcNotes, `🕓 ${dcFix.notes[0]}${dcFix.notes.length > 1 ? ` (+${dcFix.notes.length - 1} baris)` : ''}.`];
      if (smcNotes.length) g = { ...g, notes: [...smcNotes, ...(g.notes || [])] };
      return { checked: c, markdown: md, guard: g, fixes, last, atr, dead, biasInfo };
    };
    let { checked, markdown, guard, fixes, last: lastPx, atr: atrUsed, dead: deadZones, biasInfo } = runChecks(text);
    let finalText = text;
    let retried = false;

    // Ulang SATU kali hanya bila ada ARAH yang salah (entry/SL/TP). Jarak di luar rentang tipikal TIDAK memicu ulang
    // (agar AI tidak dipaksa mencari level asal jaraknya pas).
    if (fixes.length && used && BUDGET_MS - (Date.now() - t0) > 24_000) {
      retried = true;
      try {
        const corr =
          'KOREKSI WAJIB: validator menemukan ARAH yang salah (entry/SL/TP). Tulis ULANG analisa lengkap (format sama persis) dengan memperbaiki HANYA hal berikut. Tetap pakai level struktur nyata dari candle (jangan mengarang level demi jarak), hitung ulang SL, TP, lot, risiko, R:R, dan samakan Bagian 3 dengan 4B:\n- ' +
          fixes.join('\n- ');
        let t2 = '';
        if (two) {
          const g2 = await gatewayChat({
            model: two.model, system: twoSystem, user: corr,
            history: [{ role: 'user', content: twoUser }, { role: 'assistant', content: text }],
            timeoutMs: BUDGET_MS - (Date.now() - t0) - 1_000,
          });
          log.push(`retry-zona ${two.model}: ${g2.ok ? 'ok' : g2.error}`);
          if (g2.ok) t2 = fixInlineTables(g2.text);
        } else {
        const retryPayload = {
          ...basePayload,
          contents: [
            ...basePayload.contents,
            { role: 'model', parts: [{ text }] },
            { role: 'user', parts: [{ text: corr }] },
          ],
        };
        const { r: rr, j: rj } = await callGemini(used.model, retryPayload, Math.max(8_000, BUDGET_MS - (Date.now() - t0)));
        log.push(`retry-zona ${used.model}: ${rr.status}`);
        if (rr.ok) {
          t2 = fixInlineTables(
            (rj?.candidates?.[0]?.content?.parts || [])
              .filter((p) => !p.thought)
              .map((p) => p.text || '')
              .join('')
              .trim()
          );
        }
        }
        if (t2) {
          const r2 = runChecks(t2);
          // pakai hasil ulang hanya jika lebih baik (lebih sedikit pelanggaran)
          if (r2.fixes.length < fixes.length) {
            ({ checked, markdown, guard, fixes, last: lastPx, atr: atrUsed, dead: deadZones, biasInfo } = r2);
            finalText = t2;
          }
        }
      } catch (e) {
        log.push(`retry-zona: ${e?.name === 'TimeoutError' ? 'timeout' : e?.message}`);
      }
    }

    let mt4Status = mt4ContextUsed?.snapshots?.length ? (noShot ? 'OHLC_ONLY' : 'OHLC_HYBRID') : 'SCREENSHOT_ONLY';
    const mt4Report = mt4ContextUsed?.smc || null;
    let mt4PriceDeltaPct = null;
    if (mt4Status === 'OHLC_HYBRID' && pairCfg && lastPx) {
      const q = mt4ContextUsed.snapshots.find((x) => x.timeframe === 'M5') || mt4ContextUsed.snapshots.find((x) => x.timeframe === 'M15');
      const ref = Number(q?.bid || q?.ask || q?.bars?.at(-1)?.close || 0);
      if (ref > 0) {
        mt4PriceDeltaPct = Math.abs(ref - lastPx) / lastPx * 100;
        const maxDelta = pairCfg.group === 'btc' ? 1.5 : pairCfg.group === 'gold' ? 1.0 : 0.6;
        if (mt4PriceDeltaPct > maxDelta) mt4Status = 'PRICE_MISMATCH';
      }
    }
    // Keputusan server (dari tabel final + skor mesin): TRADE / COUNTERTREND_ONLY / NO_TRADE; data kurang = INSUFFICIENT_DATA (bukan "tidak ada peluang")
    let decision = null;
    let htfNote = '';
    if (markdown) {
      try {
        const gap = dataGap({ hasSnapshots: !!mt4ContextUsed?.snapshots?.length, analyses: mt4ContextUsed?.smc?.analyses, priceMismatch: mt4Status === 'PRICE_MISMATCH' });
        if (gap) decision = insufficientDecision(gap);
        else {
          const anl = mt4ContextUsed.smc?.analyses || [];
          const biasOf = (tf) => anl.find((x) => x.timeframe === tf && x.status === 'OK')?.bias;
          decision = buildDecision({ markdown, bias: biasInfo.direction || 'NETRAL', neutral: biasInfo.neutral, zoneRes: mt4ContextUsed.zoneRes, alignment: mt4ContextUsed.smc?.alignment ?? null,
            htf: { D1: biasOf('D1'), W1: biasOf('W1') }, atrM5: Number(anl.find((x) => x.timeframe === 'M5' && x.status === 'OK')?.atr14) || 0 });
          if (decision.htfConflict) {
            const before = markdown;
            markdown = markdown.replace(/(keyakinan\s*:?\s*\**\s*)(?:Sedang\s*-\s*Tinggi|Tinggi)/gi, '$1Sedang');
            if (markdown !== before) htfNote = '🎚 Keyakinan diturunkan ke Sedang: bias H4/H1 melawan D1/W1.';
          }
        }
        // Status tiap order 4B (CANDIDATE / VALIDATED) + Aturan Pasang & total risiko dari tabel final, sesuai keputusan server
        if (pairCfg) {
          const fo = finalizeOrders(markdown, { status: decision.status, dir: rb0Dir(biasInfo), maxRiskUsd: riskUsd, dec: pairCfg.dec, candidates: checked?.candidates || [] });
          markdown = fo.markdown;
        }
        markdown = insertDecision(markdown, decision.text);
        // Transparansi risiko (order ditolak karena batas) + panel Bias 3 lapis; keduanya membaca hasil validator, tidak mengubah angka
        try {
          const rt = riskTransparency({ candidates: checked?.candidates || [], maxRiskUsd: riskUsd, riskPct: Number(risk) || 0, final: biasInfo.final, decision });
          markdown = insertRiskTransparency(markdown, rt.text);
          const dt = /KEPUTUSAN SERVER — ([^:*]+):/.exec(decision.text)?.[1]?.trim() || '';
          markdown = insertBiasBlock(markdown, biasInfo, { decisionTitle: dt });
        } catch (e2) { console.error('[analyze] bias/risk block error:', e2); }
      } catch (e) {
        console.error('[analyze] decision error:', e);
      }
    }
    // Reviewer OpenAI sengaja tidak dijalankan pada jalur live V2: menjaga batas waktu dan fokus pada validator deterministik.

    const notices = [];
    if (htfNote) notices.push(htfNote);
    { const qt = mt4ContextUsed?.quote; if (qt) notices.push(`💱 Harga acuan zona: Bid ${qt.bid}${qt.ask ? ` / Ask ${qt.ask} (spread ${Number(qt.spread.toFixed(5))})` : ''}${qt.atWib ? `, kuotasi EA ${qt.atWib} WIB` : ''}. Struktur SMC dari candle tertutup (close ${qt.closeTf} ${qt.closeRef}).`); }
    if ((mt4Status === 'OHLC_HYBRID' || mt4Status === 'OHLC_ONLY') && mt4Report?.analyses?.length) {
      notices.push(`${mt4Status === 'OHLC_ONLY' ? '📡 OHLC ONLY (tanpa screenshot) aktif' : '📡 Data Hybrid aktif'}: OHLC ${mt4ContextUsed.source === 'CLOUD' ? 'Cloud' : 'MT4 EA'} diterima dan lolos pemeriksaan. SMC dihitung deterministik dari candle tertutup; bukan probabilitas profit.`);
      markdown = `> 📡 **V2 — OHLC ${mt4ContextUsed.source === 'CLOUD' ? 'CLOUD' : 'MT4'} + SMC**\n> Sumber: ${mt4ContextUsed.source === 'CLOUD' ? `${mt4ContextUsed.provider || 'Cloud'} (feed exchange publik, bukan broker Anda)` : 'MT4 EA'}. Cocokkan harga dengan chart broker sebelum menggunakan level.\n\n${mt4Report.compactBlock}\n\n---\n\n${markdown}\n\n---\n\n### Lampiran: Detail SMC dari candle (referensi)\n\n\`\`\`text\n${mt4ContextUsed.zoneCandidates ? markDeadCandidates(mt4ContextUsed.zoneCandidates, deadZones) + '\n\n' : ''}${mt4Report.promptBlock}\n\`\`\``;
    } else if (mt4Status === 'PRICE_MISMATCH') {
      notices.push(`🚫 PRICE MISMATCH: harga screenshot dan feed pasar berbeda ${mt4PriceDeltaPct?.toFixed(2)}%. Jangan gunakan level entry dari analisa ini sebelum simbol/instrumen, waktu screenshot, dan chart diperiksa ulang.`);
    } else if (pairCfg) {
      if (marketSource !== 'screenshot') notices.push(`⚠️ Analisis berjalan tanpa OHLC Cloud/MT4${mt4ContextUsed?.error ? `: ${mt4ContextUsed.error}` : ''}. Hasil ini SCREENSHOT ONLY; jangan anggap SMC terkonfirmasi dari candle.`);
    }
    if (mt4Status === 'OHLC_HYBRID' && mt4PriceDeltaPct != null && mt4PriceDeltaPct > 0.3) {
      notices.push(`⏱ Screenshot kemungkinan basi: harga screenshot berbeda ${mt4PriceDeltaPct.toFixed(2)}% dari feed terbaru. Ambil screenshot ulang sebelum memasang order.`);
    }
    if (zones === 3 && !strict) notices.push('🧭 Gaya zona: 3 zona (Scalping/Intraday/Swing). ⚠️ Validator Zona MATI: zona/arah order tidak dicek server — aktifkan di Pengaturan agar order di luar OB/FVG dibatalkan.');
    else notices.push(`🧭 Gaya zona: ${zones === 3 ? (zonesOff.length ? '3 zona, Zona 1 (Scalping) MATI → hanya Zona 2 Intraday + Zona 3 Swing' : '3 zona (Scalping/Intraday/Swing)') : '2 zona (Intraday/Swing) — ubah di Pengaturan → Gaya Zona'}.`);
    if (sessionUi && sessionUi !== session) notices.push(`🕒 Sesi dihitung dari jam server WIB (${session}); isian Sesi di UI (${sessionUi}) diabaikan.`);
    if (mt4ContextUsed?.proxyNote) notices.push(mt4ContextUsed.proxyNote);
    if (mt4ContextUsed?.connNotice) notices.push(mt4ContextUsed.connNotice);
    if (mt4ContextUsed?.specNotice) notices.push(mt4ContextUsed.specNotice);
    { const sc = Object.entries(mt4ContextUsed?.scrub || {}); if (sc.length) notices.push(`🧹 Feed data: candle outlier dibersihkan sebelum SMC/ATR (${sc.map(([k, v]) => `${k}: ${v.dropped ? v.dropped + ' dibuang' : ''}${v.dropped && v.clamped ? ', ' : ''}${v.clamped ? v.clamped + ' wick dipotong' : ''}`).join('; ')}).`); }
    if (weekendMap && !pairCfg?.open24x7) notices.push(`🗓️ Pasar ${(resolvedPair || fixedPair)?.id || pairCfg?.id || 'forex/emas'} sedang tutup akhir pekan: ini MAPPING untuk pembukaan ${fmtMt4(nextOpenMs(pairCfg || resolvedPair || fixedPair, Date.now()), 7)} WIB. Harga Terakhir = close Jumat; cek gap pembukaan sebelum memasang order.`);
    if (idNumNote) notices.push(idNumNote);
    if (pairNote) notices.push(pairNote);
    if (autoPairNote) notices.push(autoPairNote);
    if (two) {
      if (two.noShot) notices.push(`🧪 Tanpa screenshot: model \`${two.model}\` menulis analisa langsung dari OHLC MT4 (${Math.round(two.ms2 / 1000)} dtk). Validator & keputusan server tetap berlaku.`);
      else notices.push(`🧪 Mode 2 tahap: Gemini membaca gambar (${two.cands} kandidat level, ${two.dropped} angka sumbu dibuang) → \`${two.model}\` menulis analisa (${Math.round((two.ms1 + two.ms2) / 1000)} dtk). Eksperimental — bandingkan dengan mode Gemini langsung.`);
    } else if (twoNote) {
      notices.push(`⚠️ ${twoNote}`);
    }
    if (!two && used.model !== geminiModel) {
      notices.push(`ℹ️ Kuota model utama habis, dijalankan otomatis dengan \`${used.model}\`.`);
    }
    if (fundamental.offline) {
      notices.push('📅 Jadwal berita sedang offline — Bagian 1 tanpa jadwal. Cek kalender ekonomi secara manual.');
    } else if (fundamental.stale) {
      notices.push('📅 Kalender memakai data tersimpan (sumber gagal diperbarui). Verifikasi jam rilis terbaru.');
    }
    if (pairCfg && lastPx) {
      const R3 = zones === 3 ? zoneRange3(pairCfg, lastPx, atrUsed) : null;
      const R = R3 || zoneRange(pairCfg, lastPx, atrUsed);
      if (R) {
        const a = R.atr;
        const f = (x) => Number(x).toFixed(pairCfg.dec);
        notices.push(
          `📏 Pedoman jarak zona dari ${f(lastPx)} (ATR H1 ${f(a.h1)} / H4 ${f(a.h4)}, sumber: ${String(a.src || '').includes('_OHLC') ? 'dihitung dari candle OHLC provider' : a.src === 'chart' ? 'dibaca dari chart' : a.src === 'campuran' ? 'sebagian dari chart' : 'profil pair (fallback)'}): ${R3 ? `Zona 1 Scalping ${rangeText(pairCfg, R3.z1)}, Zona 2 Intraday ${rangeText(pairCfg, R3.z2)}, Zona 3 Swing ${rangeText(pairCfg, R3.z3)}` : `Zona 1 ${rangeText(pairCfg, R.z1)}, Zona 2 ${rangeText(pairCfg, R.z2)}`}. Struktur tetap lebih penting daripada jarak.`
        );
      }
    }
    if (fixes.length) notices.push(`🚫 Masih ada ${fixes.length} kesalahan arah setelah validasi — jangan pasang order yang ditandai 🚫.`);
    guard.notes.forEach((n) => notices.push(n));
    const degraded = (mt4PriceDeltaPct != null && mt4PriceDeltaPct > 0.3) || (!two && used?.model && used.model !== geminiModel);
    if (degraded && /Keyakinan\s*:?\s*\**\s*Tinggi/i.test(markdown)) {
      markdown = markdown.replace(/(Keyakinan\s*:?\s*\**\s*)Tinggi/i, '$1Sedang');
      notices.push('🎚 Keyakinan diturunkan ke Sedang (screenshot basi atau model cadangan).');
    }
    // Jejak audit: konfigurasi + snapshot per timeframe + model + versi; disalin ke riwayat (tidak berubah saat snapshot baru masuk)
    let audit = null;
    try {
      const cfg = buildConfig({ balance, risk, riskUsd, zones, zonesOff, capPerDirection, strict, mode: wantTwoStage ? '2stage' : 'single', engine: engineGw ? 'gateway' : 'gemini', geminiModel, gwModel, marketSource, pairChoice, connectionId, copyFmt: body.copyFmt });
      audit = buildAudit({ config: cfg, ctx: mt4ContextUsed, usedModel: used?.model || '', requestedModel: engineGw ? gwModel : geminiModel, bias: biasInfo, decision });
      notices.push(auditLine(audit));
    } catch (e) { console.error('[analyze] audit error:', e); }
    if (notices.length > 2) {
      markdown = `> **Catatan sistem**\n${notices.map((n) => `> - ${n}`).join('\n')}\n\n` + markdown;
    } else if (notices.length) {
      markdown = notices.map((n) => `> ${n}`).join('\n>\n') + '\n\n' + markdown;
    }

    if (!fundamental.offline) {
      markdown += `\n\n---\n\n_Sumber fundamental: kalender ekonomi ${fundamental.source === 'FMP' ? 'Financial Modeling Prep' : fundamental.source === 'biquote' ? 'biquote.io (pihak ketiga, belum terverifikasi)' : 'ForexFactory (faireconomy feed, tanpa Actual)'}${fundamental.newsUsed ? ' + headline Finnhub' : ''}, jam dikonversi ke WIB._`;
    }

    return NextResponse.json({
      markdown,
      bias: extractBias(markdown),
      pair: pairCfg ? pairCfg.id : null,
      model: used.model,
      calendarOffline: Boolean(fundamental.offline),
      riskCorrections: checked.notes.length,
      strict,
      mode: two ? '2stage' : 'single',
      marketDataMode: mt4Status,
      mt4PriceDeltaPct,
      openaiReview: { skipped: true, reason: 'disabled_in_live_v2' },
      smcTimeframes: mt4Report?.analyses?.map((x) => x.timeframe) || [],
      marketDataSource: mt4ContextUsed?.source || 'NONE',
      candles: candlePack(mt4ContextUsed),
      audit,
      zoneRetry: retried,
      directionErrors: fixes.length,
      orderGuard: { notes: guard.notes.length, cancel: guard.flags.cancel.length, shift: guard.flags.shift.length, skipped: guard.skipped },
      attempts: log,
    });
  } catch (err) {
    console.error('[analyze] error:', err);
    return NextResponse.json({ error: err?.message || 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
