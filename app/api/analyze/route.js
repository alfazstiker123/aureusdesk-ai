import { NextResponse } from 'next/server';
import { GEMINI_MODEL, SYSTEM_INSTRUCTION, buildUserPrompt, extractBias } from '@/lib/prompt';
import { verifyRiskTables } from '@/lib/riskCheck';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // detik (batas aman Vercel Hobby)

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGES = 12;
const BUDGET_MS = 52_000; // total waktu semua percobaan (di bawah maxDuration)

// Urutan percobaan: model utama + Google Search -> model dengan kuota search lebih stabil
// -> baru jatuh ke mode tanpa Google Search.
const ATTEMPTS = [
  { model: GEMINI_MODEL, search: true },
  { model: 'gemini-2.5-flash', search: true },
  { model: 'gemini-2.0-flash', search: true },
  { model: GEMINI_MODEL, search: false },
  { model: 'gemini-2.5-flash', search: false },
];

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

function buildPayload(base, { model, search }) {
  const payload = JSON.parse(JSON.stringify(base));
  if (search) payload.tools = [{ googleSearch: {} }];
  // Model 2.5 "berpikir": batasi budget agar token output tidak habis untuk berpikir
  if (/^gemini-2\.5/.test(model)) {
    payload.generationConfig.thinkingConfig = { thinkingBudget: 1024 };
  }
  return payload;
}

export async function POST(req) {
  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Body request tidak valid.' }, { status: 400 });
    }

    const { images = [], balance = 0, risk = 2, session = '' } = body;

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

    const parts = [{ text: buildUserPrompt({ balance, risk, session, labels }) }];
    images.forEach((img, i) => {
      parts.push({ text: `Gambar ${i + 1} — ${labels[i]}` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    });

    const basePayload = {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.3,
        topP: 0.9,
        maxOutputTokens: 8192,
      },
    };

    // ---- Jalankan rantai percobaan ----
    let res = null;
    let json = {};
    let used = null;
    const log = [];

    for (const attempt of ATTEMPTS) {
      const elapsed = Date.now() - t0;
      const remaining = BUDGET_MS - elapsed;
      if (used === null && log.length > 0 && remaining < 8_000) break; // sisa waktu terlalu sedikit

      try {
        const r = await fetch(`${BASE}/${attempt.model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(buildPayload(basePayload, attempt)),
          cache: 'no-store',
          signal: AbortSignal.timeout(Math.max(8_000, remaining)),
        });
        const j = await r.json().catch(() => ({}));
        log.push(`${attempt.model}${attempt.search ? '+search' : ''}: ${r.status}`);
        res = r;
        json = j;
        if (r.ok) {
          used = attempt;
          break;
        }
        if (!shouldFallback(r.status, j)) break; // mis. API key salah -> tidak ada gunanya mencoba lagi
      } catch (e) {
        log.push(`${attempt.model}${attempt.search ? '+search' : ''}: ${e?.name === 'TimeoutError' ? 'timeout' : e?.message}`);
        res = null;
      }
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
    const text = (candidate?.content?.parts || [])
      .filter((p) => !p.thought)
      .map((p) => p.text || '')
      .join('')
      .trim();

    if (!text) {
      const reason =
        json?.promptFeedback?.blockReason || candidate?.finishReason || 'Respons kosong dari model.';
      return NextResponse.json({ error: `AI tidak menghasilkan analisa (${reason}).`, attempts: log }, { status: 502 });
    }

    // Sumber dari Google Search Grounding
    const gm = candidate?.groundingMetadata || {};
    const seen = new Set();
    const sources = [];
    for (const ch of gm.groundingChunks || []) {
      const uri = ch?.web?.uri;
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      sources.push({ title: ch.web.title || uri, uri });
    }
    const queries = gm.webSearchQueries || [];

    // Verifikasi rumus risiko: Risiko = Lot x Jarak SL x 100 (koreksi angka karangan AI)
    const checked = verifyRiskTables(text, riskUsd);
    let markdown = checked.markdown;

    const notices = [];
    if (used.model !== GEMINI_MODEL) {
      notices.push(`ℹ️ Kuota model utama habis, dijalankan otomatis dengan \`${used.model}\`.`);
    }
    if (!used.search) {
      notices.push('⚠️ **Kuota Google Search habis** — analisa fundamental disusun TANPA berita live. Verifikasi kalender ekonomi secara manual.');
    }
    if (notices.length) {
      markdown = notices.map((n) => `> ${n}`).join('\n>\n') + '\n\n' + markdown;
    }

    if (sources.length) {
      markdown +=
        '\n\n---\n\n#### 🔎 Sumber Berita (Google Search Live)\n' +
        sources.map((s, i) => `${i + 1}. [${s.title}](${s.uri})`).join('\n');
    }
    if (queries.length) {
      markdown += `\n\n_Kata kunci pencarian: ${queries.join(' · ')}_`;
    }

    return NextResponse.json({
      markdown,
      bias: extractBias(text),
      sources,
      model: used.model,
      searchUsed: used.search,
      riskCorrections: checked.notes.length,
      attempts: log,
    });
  } catch (err) {
    console.error('[analyze] error:', err);
    return NextResponse.json({ error: err?.message || 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
