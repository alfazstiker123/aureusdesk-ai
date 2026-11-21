import { NextResponse } from 'next/server';
import { GEMINI_MODEL, GEMINI_FALLBACK_MODELS, buildSystemInstruction, buildUserPrompt, extractBias } from '@/lib/prompt';
import { PAIRS, PAIR_ID_OK, extractPair, guessPairByPrice, resolvePair, parseATR, zoneRange, rangeText } from '@/lib/pairs';
import { gatewayChat, gwConfigured, gwModelOf } from '@/lib/gateway';
import { EXTRACT_SYSTEM, EXTRACT_SCHEMA, normalizeExtract, buildCandidates, formatDataBlock, STAGE2_ADDENDUM } from '@/lib/extract';
import { requirePin } from '@/lib/auth';
import { fixInlineTables } from '@/lib/markdownFix';
import { buildFundamentalBlock } from '@/lib/calendar';
import { verifyRiskTables } from '@/lib/riskCheck';
import { applyOrderGuard, parseLastPrice } from '@/lib/zoneCheck';
import { getMarketSnapshots, marketContext, mt4SymbolForPair } from '@/lib/mt4Market';
import { getCloudMarketSnapshots, cloudMarketContext } from '@/lib/cloudMarket';
import { buildSmcReport, buildZoneCandidates } from '@/lib/smc/engine';
import { enforceSmcZones } from '@/lib/smc/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // detik (batas aman Vercel Hobby)

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGES = 12;
const BUDGET_MS = 52_000; // total waktu semua percobaan (di bawah maxDuration)

// Urutan percobaan (tanpa Google Search): Flash (utama) -> cadangan -> Lite (terakhir, paling murah tapi paling lemah membaca angka).
const ATTEMPTS = [{ model: GEMINI_MODEL }, ...GEMINI_FALLBACK_MODELS.map((model) => ({ model }))];

const SMC_SYSTEM_ADDENDUM = `
ATURAN V2 SMC — PRIORITAS SAAT OHLC CLOUD/MT4 TERSEDIA:
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

async function loadMt4Context(pairId) {
  if (!pairId || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { text: '', snapshots: [], smc: null, source: 'NONE' };
  try {
    const symbol = mt4SymbolForPair(pairId);
    const snapshots = await getMarketSnapshots(symbol);
    if (!snapshots.length) throw new Error('Feed MT4 belum tersedia/fresh.');
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
    const zc = zoneCandidateText(smc, profile, feed.price || quotePrice);
    return { text: marketContext(snapshots) + report + feed.line + (zc ? `\n\n${zc}` : ''), zoneCandidates: zc, feedPrice: feed.price, snapshots, smc, source: 'MT4_EA', warnings: [] };
  } catch (e) {
    return { text: `DATA OHLC MT4 tidak dapat diverifikasi (${e.message}).`, snapshots: [], smc: null, source: 'NONE', error: e.message };
  }
}


function feedPriceInfo(snapshots) {
  const q = snapshots?.find((x) => x.timeframe === 'M5') || snapshots?.find((x) => x.timeframe === 'M15');
  const bar = q?.bars?.at(-1);
  const price = Number(bar?.close || 0);
  if (!(price > 0)) return { price: 0, line: '' };
  const wib = bar.time ? new Date((Number(bar.time) + 300) * 1000 + 7 * 3600 * 1000).toISOString().slice(11, 16) : '';
  return { price, line: `\n\nHARGA FEED TERKINI (close candle ${q.timeframe} tertutup terakhir${wib ? `, ±${wib} WIB` : ''}): ${price}. Jika harga di screenshot berbeda >0.15% dari angka ini, screenshot basi: tulis "Harga Terakhir" = harga feed ini dan sebut singkat bahwa screenshot lebih lama.` };
}

function zoneCandidateText(smc, profile, price) {
  try {
    const h1 = smc?.analyses?.find((x) => x.timeframe === 'H1' && x.status === 'OK')?.atr14;
    const h4 = smc?.analyses?.find((x) => x.timeframe === 'H4' && x.status === 'OK')?.atr14;
    const R = zoneRange(profile, price, h1 > 0 && h4 > 0 ? { h1, h4, src: 'OHLC' } : null);
    return buildZoneCandidates(smc?.analyses, price, R, h1 || 0)?.text || '';
  } catch { return ''; }
}

async function loadMarketContext(pairId, sourceMode = 'cloud') {
  if (!pairId || sourceMode === 'screenshot') return { text: '', snapshots: [], smc: null, source: 'SCREENSHOT' };
  if (sourceMode === 'mt4') return loadMt4Context(pairId);
  if (sourceMode === 'auto') {
    const cloud = await loadMarketContext(pairId, 'cloud');
    if (cloud.snapshots?.length) return cloud;
    const mt4 = await loadMt4Context(pairId);
    if (mt4.snapshots?.length) return mt4;
    return { ...cloud, error: [cloud.error, mt4.error].filter(Boolean).join(' | ') };
  }
  try {
    const result = await getCloudMarketSnapshots(pairId);
    const snapshots = result.snapshots;
    const profile = PAIRS[pairId] || resolvePair(pairId);
    const quoteSnap = snapshots.find((x) => x.timeframe === 'M5') || snapshots.find((x) => x.timeframe === 'M15');
    const quotePrice = Number(quoteSnap?.bars?.at(-1)?.close || 0);
    if (quotePrice && profile?.priceRange && (quotePrice < profile.priceRange[0] || quotePrice > profile.priceRange[1]))
      throw new Error(`Harga Cloud ${quotePrice} di luar rentang profil ${pairId}; periksa CLOUD_SYMBOL_MAP.`);
    const byTf = Object.fromEntries(snapshots.map((x) => [x.timeframe, x.bars]));
    const smc = buildSmcReport(byTf);
    const report = smc?.analyses?.length ? `\n\nRINGKASAN SMC DETERMINISTIK DARI CLOUD (candle tertutup; bukan sinyal otomatis):\n${smc.promptBlock}` : '';
    const feed = feedPriceInfo(snapshots);
    const zc = zoneCandidateText(smc, profile, feed.price || quotePrice);
    return { text: cloudMarketContext(snapshots, result.warnings, result.provider) + report + feed.line + (zc ? `\n\n${zc}` : ''), zoneCandidates: zc, feedPrice: feed.price, snapshots, smc, source: 'CLOUD', provider: result.provider, warnings: result.warnings };
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

export async function POST(req) {
  const denied = requirePin(req);
  if (denied) return denied;
  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Body request tidak valid.' }, { status: 400 });
    }

    const { images = [], balance = 0, risk = 2, session = '' } = body;
    const pairChoice = PAIR_ID_OK(body.pair) ? body.pair : 'AUTO';
    const fixedPair = pairChoice === 'AUTO' ? null : PAIRS[pairChoice];
    const strict = body.strict !== false; // Validator Zona & Konflik Order (Pengaturan), default ON
    const wantTwoStage = body.mode === '2stage';
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

    if (!Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: 'Upload minimal 1 screenshot chart.' }, { status: 400 });
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

    // AUTO + Gemini langsung: ekstrak pair secara ringan terlebih dahulu agar Cloud OHLC
    // dapat dimuat sebelum analisa final. Jika ekstraksi gagal, V1 screenshot-flow tetap berjalan.
    if (!resolvedPair && !wantTwoStage && marketSource !== 'screenshot') {
      try {
        // Ringan: hanya gambar pertama + skema kecil (pair saja), dengan model cadangan.
        const first = images[0];
        const pairPayload = {
          systemInstruction: { parts: [{ text: 'Baca nama pair/instrumen pada judul chart MT4 (mis. BTCUSD, XAUUSD, EURUSD). Jangan menebak; kosongkan bila tidak terbaca.' }] },
          contents: [{ role: 'user', parts: [{ text: 'Pair apa pada chart ini?' }, { inlineData: { mimeType: first.mimeType, data: first.data } }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 120, responseMimeType: 'application/json',
            responseSchema: { type: 'OBJECT', properties: { pair: { type: 'STRING' } }, required: ['pair'] } },
        };
        let pairText = '';
        for (const m of [GEMINI_MODEL, 'gemini-flash-latest', 'gemini-flash-lite-latest']) {
          if (BUDGET_MS - (Date.now() - t0) < 40_000) break;
          try {
            const exRes = await fetch(`${BASE}/${m}:generateContent`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
              body: JSON.stringify(pairPayload), cache: 'no-store', signal: AbortSignal.timeout(7000),
            });
            const exJson = await exRes.json().catch(() => ({}));
            if (!exRes.ok) continue;
            pairText = (exJson?.candidates?.[0]?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || '').join('').trim();
            if (pairText) break;
          } catch { /* coba model berikutnya */ }
        }
        if (pairText) {
          try { resolvedPair = resolvePair(JSON.parse(pairText.replace(/^```(?:json)?|```$/g, '').trim())?.pair); } catch { resolvedPair = null; }
        }
        if (!resolvedPair) autoPairNote = 'Pair AUTO tidak terbaca dari screenshot; analisis berjalan tanpa OHLC Cloud. Pilih pair manual di Pengaturan agar data candle dipakai.';
      } catch (e) {
        autoPairNote = 'Ekstraksi pair AUTO gagal; analisis berjalan dengan screenshot saja. Pilih pair manual agar data candle dipakai.';
      }
    }

    // Kalender ekonomi live (ForexFactory) + Finnhub opsional; gagal -> tetap lanjut dengan catatan offline
    const fundamental = await buildFundamentalBlock((resolvedPair || fixedPair)?.id || null).catch((e) => ({
      text: `=== DATA FUNDAMENTAL LIVE ===\nSTATUS KALENDER: OFFLINE (${e?.message || 'error'}). Jadwal berita TIDAK tersedia.\n=== AKHIR DATA FUNDAMENTAL ===`,
      offline: true,
    }));

    const marketInitial = resolvedPair ? await loadMarketContext(resolvedPair.id, marketSource) : { text: '', snapshots: [], smc: null, source: 'NONE' };
    let mt4ContextUsed = marketInitial;
    const parts = [{ text: buildUserPrompt({ balance, risk, session, labels, pair: resolvedPair || fixedPair, fundamental: fundamental.text, strict }) +
      (marketInitial.text ? `\n\n${marketInitial.text}` : '') }];
    images.forEach((img, i) => {
      parts.push({ text: `Gambar ${i + 1} — ${labels[i]}` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    });

    const basePayload = {
      systemInstruction: { parts: [{ text: buildSystemInstruction(resolvedPair || fixedPair, strict) + (marketInitial.snapshots?.length ? SMC_SYSTEM_ADDENDUM : '') }] },
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
    let two = null; // {text, model, ms1, ms2, dropped, cands}
    let twoNote = '';
    let twoSystem = '';
    let twoUser = '';
    const log = [];
    if (wantTwoStage) {
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
          for (const m of [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS.slice(0, 1)]) {
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
          const mt4Two = await loadMarketContext((fixedPair || p2)?.id, marketSource);
          twoSystem = buildSystemInstruction(fixedPair || resolvedPair || p2, strict) + '\n' + STAGE2_ADDENDUM + (mt4Two.snapshots?.length ? SMC_SYSTEM_ADDENDUM : '');
          if (mt4Two.snapshots?.length) mt4ContextUsed = mt4Two;
          twoUser =
            buildUserPrompt({ balance, risk, session, labels, pair: fixedPair || resolvedPair || p2, fundamental: fundamental.text, strict }) +
            '\n\n' + formatDataBlock(data, p2, built) + (mt4Two.text ? `\n\n${mt4Two.text}` : '');
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
    // Jika AUTO terdeteksi di tahap ekstraksi tetapi gateway tahap 2 gagal, pastikan fallback Gemini langsung juga menerima OHLC yang sama.
    if (!two && !resolvedPair && mt4ContextUsed?.snapshots?.length && mt4ContextUsed.text) {
      parts.push({ text: mt4ContextUsed.text });
    }
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
    const marketAtr = h1Atr > 0 && h4Atr > 0 ? { h1: h1Atr, h4: h4Atr, src: `${mt4ContextUsed.source}_OHLC` } : null;

    // Rangkaian validator: koreksi risiko -> validator zona & konflik (angka entry/SL/TP/lot tidak diubah)
    const capPerDirection = body.riskCap !== 'order'; // 'order' = batas lama (per order saja)
    const smcAnalyses = mt4ContextUsed?.snapshots?.length ? mt4ContextUsed?.smc?.analyses : null;
    const runChecks = (rawTxt) => {
      let txt = rawTxt;
      let smcNotes = [];
      if (pairCfg && smcAnalyses?.length) {
        try {
          const feedPx = Number(mt4ContextUsed.feedPrice || 0);
          const e = enforceSmcZones(rawTxt, { analyses: smcAnalyses, atrH1: smcAnalyses.find((x) => x.timeframe === 'H1' && x.status === 'OK')?.atr14 || 0, price: feedPx || parseLastPrice(rawTxt, pairCfg) || 0, priceRe: pairCfg.priceRe });
          txt = e.markdown;
          smcNotes = e.notes;
        } catch (err) {
          console.error('[analyze] smcGuard error:', err);
        }
      }
      const last = pairCfg ? parseLastPrice(txt, pairCfg) : null;
      const atr = pairCfg && last ? (marketAtr || parseATR(txt, pairCfg, last)) : null;
      const c = pairCfg
        ? verifyRiskTables(txt, riskUsd, pairCfg, new Date(), { last, capPerDirection })
        : { markdown: txt, notes: [], fixes: [], tablesChecked: 0 };
      let md = c.markdown;
      let g = { notes: [], flags: { cancel: [], shift: [], fix: [] }, skipped: null, atr };
      if (strict && pairCfg) {
        try {
          g = applyOrderGuard(md, { pair: pairCfg, bias: extractBias(txt), atr });
          md = g.markdown;
        } catch (e) {
          console.error('[analyze] orderGuard error:', e);
        }
      }
      // error yang layak generate ulang: arah entry salah (guard) + arah SL/TP salah (guard Bagian 3, riskCheck 4B)
      const fixes = [...(g.flags?.fix || []), ...(c.fixes || [])];
      if (smcNotes.length) g = { ...g, notes: [...smcNotes, ...(g.notes || [])] };
      return { checked: c, markdown: md, guard: g, fixes, last, atr };
    };
    let { checked, markdown, guard, fixes, last: lastPx, atr: atrUsed } = runChecks(text);
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
            ({ checked, markdown, guard, fixes, last: lastPx, atr: atrUsed } = r2);
            finalText = t2;
          }
        }
      } catch (e) {
        log.push(`retry-zona: ${e?.name === 'TimeoutError' ? 'timeout' : e?.message}`);
      }
    }

    let mt4Status = mt4ContextUsed?.snapshots?.length ? 'OHLC_HYBRID' : 'SCREENSHOT_ONLY';
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
    // Reviewer OpenAI sengaja tidak dijalankan pada jalur live V2: menjaga batas waktu dan fokus pada validator deterministik.

    const notices = [];
    if (mt4Status === 'OHLC_HYBRID' && mt4Report?.analyses?.length) {
      notices.push(`📡 Data Hybrid aktif: OHLC ${mt4ContextUsed.source === 'CLOUD' ? 'Cloud' : 'MT4 EA'} diterima dan lolos pemeriksaan. SMC dihitung deterministik dari candle tertutup; bukan probabilitas profit.`);
      markdown = `> 📡 **V2 — OHLC ${mt4ContextUsed.source === 'CLOUD' ? 'CLOUD' : 'MT4'} + SMC**\n> Sumber: ${mt4ContextUsed.source === 'CLOUD' ? `${mt4ContextUsed.provider || 'Cloud'} (feed exchange publik, bukan broker Anda)` : 'MT4 EA'}. Cocokkan harga dengan chart broker sebelum menggunakan level.\n\n${mt4Report.compactBlock}\n\n---\n\n${markdown}\n\n---\n\n### Lampiran: Detail SMC dari candle (referensi)\n\n\`\`\`text\n${mt4ContextUsed.zoneCandidates ? mt4ContextUsed.zoneCandidates + '\n\n' : ''}${mt4Report.promptBlock}\n\`\`\``;
    } else if (mt4Status === 'PRICE_MISMATCH') {
      notices.push(`🚫 PRICE MISMATCH: harga screenshot dan feed pasar berbeda ${mt4PriceDeltaPct?.toFixed(2)}%. Jangan gunakan level entry dari analisa ini sebelum simbol/instrumen, waktu screenshot, dan chart diperiksa ulang.`);
    } else if (pairCfg) {
      if (marketSource !== 'screenshot') notices.push(`⚠️ Analisis berjalan tanpa OHLC Cloud/MT4${mt4ContextUsed?.error ? `: ${mt4ContextUsed.error}` : ''}. Hasil ini SCREENSHOT ONLY; jangan anggap SMC terkonfirmasi dari candle.`);
    }
    if (mt4Status === 'OHLC_HYBRID' && mt4PriceDeltaPct != null && mt4PriceDeltaPct > 0.3) {
      notices.push(`⏱ Screenshot kemungkinan basi: harga screenshot berbeda ${mt4PriceDeltaPct.toFixed(2)}% dari feed terbaru. Ambil screenshot ulang sebelum memasang order.`);
    }
    if (pairNote) notices.push(pairNote);
    if (autoPairNote) notices.push(autoPairNote);
    if (two) {
      notices.push(`🧪 Mode 2 tahap: Gemini membaca gambar (${two.cands} kandidat level, ${two.dropped} angka sumbu dibuang) → \`${two.model}\` menulis analisa (${Math.round((two.ms1 + two.ms2) / 1000)} dtk). Eksperimental — bandingkan dengan mode Gemini langsung.`);
    } else if (twoNote) {
      notices.push(`⚠️ ${twoNote}`);
    }
    if (!two && used.model !== GEMINI_MODEL) {
      notices.push(`ℹ️ Kuota model utama habis, dijalankan otomatis dengan \`${used.model}\`.`);
    }
    if (fundamental.offline) {
      notices.push('📅 Jadwal berita sedang offline — Bagian 1 tanpa jadwal. Cek kalender ekonomi secara manual.');
    } else if (fundamental.stale) {
      notices.push('📅 Kalender memakai data tersimpan (sumber gagal diperbarui). Verifikasi jam rilis terbaru.');
    }
    if (pairCfg && lastPx) {
      const R = zoneRange(pairCfg, lastPx, atrUsed);
      if (R) {
        const a = R.atr;
        const f = (x) => Number(x).toFixed(pairCfg.dec);
        notices.push(
          `📏 Pedoman jarak zona dari ${f(lastPx)} (ATR H1 ${f(a.h1)} / H4 ${f(a.h4)}, sumber: ${String(a.src || '').includes('_OHLC') ? 'dihitung dari candle OHLC provider' : a.src === 'chart' ? 'dibaca dari chart' : a.src === 'campuran' ? 'sebagian dari chart' : 'profil pair (fallback)'}): Zona 1 ${rangeText(pairCfg, R.z1)}, Zona 2 ${rangeText(pairCfg, R.z2)}. Struktur tetap lebih penting daripada jarak.`
        );
      }
    }
    if (fixes.length) notices.push(`🚫 Masih ada ${fixes.length} kesalahan arah setelah validasi — jangan pasang order yang ditandai 🚫.`);
    guard.notes.forEach((n) => notices.push(n));
    if (notices.length) {
      markdown = notices.map((n) => `> ${n}`).join('\n>\n') + '\n\n' + markdown;
    }

    if (!fundamental.offline) {
      markdown += `\n\n---\n\n_Sumber fundamental: kalender ekonomi ${fundamental.source === 'FMP' ? 'Financial Modeling Prep' : fundamental.source === 'biquote' ? 'biquote.io (pihak ketiga, belum terverifikasi)' : 'ForexFactory (faireconomy feed, tanpa Actual)'}${fundamental.newsUsed ? ' + headline Finnhub' : ''}, jam dikonversi ke WIB._`;
    }

    return NextResponse.json({
      markdown,
      bias: extractBias(finalText),
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
