import { NextResponse } from 'next/server';
import { requirePin } from '@/lib/auth';
import { gatewayChat, gwConfigured, gwModelOf } from '@/lib/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const CHAT_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
const MAX_MSGS = 12;
const MAX_MSG_CHARS = 2000;
const MAX_CONTEXT_CHARS = 14000;

const SYSTEM = `Anda "Mentor SMC" di aplikasi AureusDesk AI: asisten trading Smart Money Concepts untuk trader ritel Indonesia.
Aturan:
- Jawab dalam Bahasa Indonesia, ringkas (maksimal ~180 kata), kalimat pendek, boleh bullet.
- Jika ada "ANALISA AKTIF", jadikan itu satu-satunya sumber level harga, bias, lot, dan risiko. Jangan mengarang level, harga live, atau data yang tidak ada di analisa.
- Bila diminta hitung ulang lot: pakai rumus Risiko($) = Lot x Jarak SL x pengali, dengan pengali dan jarak yang tertulis di analisa; tampilkan angka dan hasilnya, bulatkan lot ke bawah 2 desimal.
- Jangan menjanjikan profit atau memberi kepastian arah. Ingatkan bahwa ini bukan nasihat keuangan hanya bila relevan.
- Bila pertanyaan di luar trading/analisa ini, jawab singkat dan arahkan kembali.`;

function cleanMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_MSGS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }));
}

export async function POST(req) {
  const denied = requirePin(req);
  if (denied) return denied;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body tidak valid.' }, { status: 400 });
  }
  const msgs = cleanMessages(body.messages);
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Pesan kosong.' }, { status: 400 });
  }

  const ctx = typeof body.context === 'string' ? body.context.slice(0, MAX_CONTEXT_CHARS) : '';
  const params = [];
  if (Number(body.balance) > 0) params.push(`Saldo akun: $${Number(body.balance)}`);
  if (Number(body.risk) > 0) params.push(`Risiko per arah: ${Number(body.risk)}%`);
  if (body.pair && /^[A-Z0-9]{3,10}$/.test(String(body.pair))) params.push(`Pair: ${body.pair}`);
  const system = `${SYSTEM}\n${params.length ? `\nParameter trader: ${params.join(' | ')}\n` : ''}${
    ctx ? `\nANALISA AKTIF (hasil server, sumber kebenaran):\n${ctx}` : '\n(Tidak ada analisa aktif; jawab secara konsep umum.)'
  }`;

  const apiKey = (req.headers.get('x-gemini-key') || '').trim() || process.env.GEMINI_API_KEY;
  let lastErr = '';
  const gwFirst = body.engine === 'gateway' && gwConfigured();
  let gwTried = false;
  const tryGateway = async () => {
    gwTried = true;
    const hist = msgs.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
    return gatewayChat({ model: gwModelOf(body.gwModel), system, user: msgs[msgs.length - 1].content, history: hist, maxTokens: 1200, timeoutMs: 20000, temperature: 0.4 });
  };
  if (gwFirst) {
    const g = await tryGateway();
    if (g.ok) return NextResponse.json({ reply: g.text, model: g.model || gwModelOf(body.gwModel) });
    lastErr = `gateway: ${g.error}`;
  }
  const userGem = /^[A-Za-z0-9._:\/-]{2,80}$/.test(String(body.geminiModel || '').trim()) ? String(body.geminiModel).trim() : null;
  const chatModels = userGem ? [userGem, ...CHAT_MODELS.filter((m) => m !== userGem)] : CHAT_MODELS;

  if (apiKey) {
    const payload = {
      systemInstruction: { parts: [{ text: system }] },
      contents: msgs.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
    };
    for (const model of chatModels) {
      try {
        const r = await fetch(`${BASE}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(payload),
          cache: 'no-store',
          signal: AbortSignal.timeout(14000),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          lastErr = String(j?.error?.message || `HTTP ${r.status}`).slice(0, 160);
          if (r.status === 400 || r.status === 403) break; // key/permintaan salah: model lain tidak membantu
          continue;
        }
        const text = (j?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
        if (text) return NextResponse.json({ reply: text, model });
        lastErr = 'Respons kosong.';
      } catch (e) {
        lastErr = e?.name === 'TimeoutError' ? 'timeout' : String(e?.message || e).slice(0, 120);
      }
    }
  } else {
    lastErr = 'Gemini API Key belum diatur.';
  }

  // Cadangan: gateway OpenAI-compatible bila sudah dikonfigurasi di env
  if (gwConfigured() && !gwTried) {
    const hist = msgs.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
    const g = await gatewayChat({
      model: gwModelOf(body.gwModel),
      system,
      user: msgs[msgs.length - 1].content,
      history: hist,
      maxTokens: 1200,
      timeoutMs: 12000,
      temperature: 0.4,
    });
    if (g.ok) return NextResponse.json({ reply: g.text, model: g.model || 'gateway' });
    lastErr = `${lastErr} | gateway: ${g.error}`;
  }

  return NextResponse.json({ error: `Chat gagal: ${lastErr || 'tidak ada respons'}` }, { status: 502 });
}
