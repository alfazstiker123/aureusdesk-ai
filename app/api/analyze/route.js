import { NextResponse } from 'next/server';
import { GEMINI_MODEL, buildSystemInstruction, buildUserPrompt, extractBias } from '@/lib/prompt';
import { PAIRS, PAIR_ID_OK, extractPair, guessPairByPrice, resolvePair } from '@/lib/pairs';
import { gatewayChat, gwConfigured, gwModelOf } from '@/lib/gateway';
import { EXTRACT_SYSTEM, EXTRACT_SCHEMA, normalizeExtract, buildCandidates, formatDataBlock, STAGE2_ADDENDUM } from '@/lib/extract';
import { requirePin } from '@/lib/auth';
import { fixInlineTables } from '@/lib/markdownFix';
import { buildFundamentalBlock } from '@/lib/calendar';
import { verifyRiskTables } from '@/lib/riskCheck';
import { applyOrderGuard } from '@/lib/zoneCheck';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // detik (batas aman Vercel Hobby)

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGES = 12;
const BUDGET_MS = 52_000; // total waktu semua percobaan (di bawah maxDuration)

// Urutan percobaan (tanpa Google Search): model utama -> model cadangan.
// (gemini-2.5-flash & gemini-2.0-flash sudah dihentikan Google -> 404, jadi tidak dipakai.)
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-3.8-flash'];
const ATTEMPTS = [{ model: GEMINI_MODEL }, ...FALLBACK_MODELS.map((model) => ({ model }))];

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

    // Kalender ekonomi live (ForexFactory) + Finnhub opsional; gagal -> tetap lanjut dengan catatan offline
    const fundamental = await buildFundamentalBlock(fixedPair ? fixedPair.id : null).catch((e) => ({
      text: `=== DATA FUNDAMENTAL LIVE ===\nSTATUS KALENDER: OFFLINE (${e?.message || 'error'}). Jadwal berita TIDAK tersedia.\n=== AKHIR DATA FUNDAMENTAL ===`,
      offline: true,
    }));

    const parts = [{ text: buildUserPrompt({ balance, risk, session, labels, pair: fixedPair, fundamental: fundamental.text, strict }) }];
    images.forEach((img, i) => {
      parts.push({ text: `Gambar ${i + 1} — ${labels[i]}` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    });

    const basePayload = {
      systemInstruction: { parts: [{ text: buildSystemInstruction(fixedPair, strict) }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.3,
        topP: 0.9,
        maxOutputTokens: 8192,
      },
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
          for (const m of ['gemini-flash-latest', GEMINI_MODEL]) {
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
          const p2 = fixedPair || resolvePair(data.pair) || (data.lastPrice ? guessPairByPrice(data.lastPrice) : null);
          const built = buildCandidates(data, p2);
          twoSystem = buildSystemInstruction(fixedPair || p2, strict) + '\n' + STAGE2_ADDENDUM;
          twoUser =
            buildUserPrompt({ balance, risk, session, labels, pair: fixedPair || p2, fundamental: fundamental.text, strict }) +
            '\n\n' + formatDataBlock(data, p2, built);
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
        const r = await fetch(`${BASE}/${attempt.model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(basePayload),
          cache: 'no-store',
          signal: AbortSignal.timeout(Math.max(8_000, remaining)),
        });
        const j = await r.json().catch(() => ({}));
        log.push(`${attempt.model}: ${r.status}`);
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

    if (!text) {
      const reason =
        json?.promptFeedback?.blockReason || candidate?.finishReason || 'Respons kosong dari model.';
      return NextResponse.json({ error: `AI tidak menghasilkan analisa (${reason}).`, attempts: log }, { status: 502 });
    }

    // Verifikasi rumus risiko: Risiko = Lot x Jarak SL x 100 (koreksi angka karangan AI)
    // Pair: pilihan user, atau hasil deteksi AI (baris **PAIR:**), cadangan tebakan dari harga terakhir
    let pairCfg = fixedPair || extractPair(text);
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
    // Rangkaian validator: koreksi risiko -> validator zona & konflik (angka entry/SL/TP/lot tidak diubah)
    const runChecks = (txt) => {
      const c = pairCfg ? verifyRiskTables(txt, riskUsd, pairCfg) : { markdown: txt, notes: [], tablesChecked: 0 };
      let md = c.markdown;
      let g = { notes: [], flags: { cancel: [], shift: [], fix: [] }, skipped: null };
      if (strict && pairCfg) {
        try {
          g = applyOrderGuard(md, { pair: pairCfg, bias: extractBias(txt) });
          md = g.markdown;
        } catch (e) {
          console.error('[analyze] orderGuard error:', e);
        }
      }
      return { checked: c, markdown: md, guard: g };
    };
    let { checked, markdown, guard } = runChecks(text);
    let finalText = text;
    let retried = false;

    // Ulang SATU kali bila ada entry di luar rentang zona / arah salah (hanya bila waktu cukup)
    const fixes = guard.flags?.fix || [];
    if (fixes.length && used && BUDGET_MS - (Date.now() - t0) > 24_000) {
      retried = true;
      try {
        const corr =
          'KOREKSI WAJIB: validator menemukan entry di luar rentang zona. Tulis ULANG analisa lengkap (format sama persis) dengan memperbaiki HANYA hal berikut; pilih level struktur nyata di dalam rentang, hitung ulang SL, TP, lot, risiko, R:R, dan samakan Bagian 3 dengan 4B:\n- ' +
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
        const rr = await fetch(`${BASE}/${used.model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(retryPayload),
          cache: 'no-store',
          signal: AbortSignal.timeout(Math.max(8_000, BUDGET_MS - (Date.now() - t0))),
        });
        const rj = await rr.json().catch(() => ({}));
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
          if ((r2.guard.flags?.fix || []).length < fixes.length) {
            ({ checked, markdown, guard } = r2);
            finalText = t2;
          }
        }
      } catch (e) {
        log.push(`retry-zona: ${e?.name === 'TimeoutError' ? 'timeout' : e?.message}`);
      }
    }

    const notices = [];
    if (pairNote) notices.push(pairNote);
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
      zoneRetry: retried,
      orderGuard: { notes: guard.notes.length, cancel: guard.flags.cancel.length, shift: guard.flags.shift.length, skipped: guard.skipped },
      attempts: log,
    });
  } catch (err) {
    console.error('[analyze] error:', err);
    return NextResponse.json({ error: err?.message || 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
