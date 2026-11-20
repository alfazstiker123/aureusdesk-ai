import { NextResponse } from 'next/server';
import { GEMINI_MODEL, SYSTEM_INSTRUCTION, buildUserPrompt, extractBias } from '@/lib/prompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // detik (batas aman Vercel Hobby)

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGES = 12;

export async function POST(req) {
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

    const parts = [{ text: buildUserPrompt({ balance, risk, session, labels }) }];
    images.forEach((img, i) => {
      parts.push({ text: `Gambar ${i + 1} — ${labels[i]}` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    });

    const payload = {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts }],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        temperature: 0.4,
        topP: 0.9,
        maxOutputTokens: 8192,
      },
    };

    const callGemini = async (body) => {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      return { res: r, json: await r.json().catch(() => ({})) };
    };

    let { res, json } = await callGemini(payload);
    let searchDisabled = false;

    // Kuota Google Search grounding habis (429) -> ulangi tanpa pencarian live
    if (res.status === 429) {
      const { tools, ...noSearch } = payload;
      const retry = await callGemini(noSearch);
      if (retry.res.ok) {
        res = retry.res;
        json = retry.json;
        searchDisabled = true;
      }
    }

    if (!res.ok) {
      let msg = json?.error?.message || `HTTP ${res.status}`;
      if (res.status === 429) {
        msg =
          'Kuota Gemini API habis (429). Tunggu reset kuota (harian/per menit), aktifkan billing di Google AI Studio, atau isi API Key lain di pengaturan. Detail: ' +
          msg;
      }
      return NextResponse.json({ error: `Gemini API: ${msg}` }, { status: res.status });
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
      return NextResponse.json({ error: `AI tidak menghasilkan analisa (${reason}).` }, { status: 502 });
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

    let markdown = text;
    if (searchDisabled) {
      markdown =
        '> ⚠️ **Kuota Google Search habis** — analisa fundamental disusun TANPA berita live. Verifikasi kalender ekonomi secara manual.\n\n' +
        markdown;
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
      model: GEMINI_MODEL,
    });
  } catch (err) {
    console.error('[analyze] error:', err);
    return NextResponse.json({ error: err?.message || 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
