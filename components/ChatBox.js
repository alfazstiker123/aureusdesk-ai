'use client';

import { useEffect, useRef, useState } from 'react';
import MarkdownView from '@/components/MarkdownView';

const QUICK = [
  ['🎯 Zona paling aman?', 'Zona mana yang paling aman untuk entry saat ini dan kenapa?'],
  ['⚖️ Hitung lot 1%', 'Hitung ulang lot semua order baru jika risiko saya ubah jadi 1% saja.'],
  ['🕯️ Konfirmasi candle', 'Jelaskan cara baca konfirmasi candle sebelum entry pada zona yang aktif.'],
];

const HELLO = 'Halo Trader! 👋 Saya Mentor SMC. Tanyakan soal setup, hitung ulang lot, konfirmasi candle, atau skenario batal dari analisa aktif Anda.';

export default function ChatBox({ apiFetch, apiKey, context, pair, balance, risk, gwModel, engine = 'gemini', geminiModel = '', open, onToggle }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [withCtx, setWithCtx] = useState(true);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs, busy, open]);

  async function send(raw) {
    const q = String(raw ?? text).trim();
    if (!q || busy) return;
    const next = [...msgs, { role: 'user', content: q }];
    setMsgs(next);
    setText('');
    setBusy(true);
    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey?.trim() ? { 'x-gemini-key': apiKey.trim() } : {}) },
        body: JSON.stringify({
          messages: next.filter((m) => !m.error),
          context: withCtx && context ? context : '',
          pair,
          balance: Number(balance),
          risk: Number(risk),
          gwModel,
          engine,
          geminiModel,
        }),
      });
      const raw2 = await res.text();
      let data = {};
      try {
        data = JSON.parse(raw2);
      } catch {
        data = { error: raw2.slice(0, 160) || `HTTP ${res.status}` };
      }
      if (!res.ok) throw new Error(data.error || 'Gagal.');
      setMsgs((m) => [...m, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `⚠️ ${e.message || 'Gagal menghubungi AI.'}`, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed left-3.5 z-40 print:hidden sm:left-5" style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      {!open && (
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 rounded-full bg-gradient-to-r from-gold to-gold/80 px-4 py-3 text-xs font-extrabold text-night shadow-xl shadow-gold/35 transition hover:brightness-110 active:scale-95 sm:text-sm"
        >
          <span className="text-base leading-none">💬</span>
          <span>Konsultasi AI</span>
        </button>
      )}
      {open && (
        <div className="flex h-[72vh] max-h-[560px] w-[calc(100vw-1.75rem)] flex-col overflow-hidden rounded-2xl border border-gold/35 bg-panel shadow-2xl shadow-black/80 sm:w-[400px]">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-panel2 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 flex-none items-center justify-center rounded-xl border border-gold/40 bg-gold/20 text-sm">🤖</div>
              <div className="min-w-0">
                <h3 className="truncate text-xs font-extrabold text-strong sm:text-sm">Konsultasi Mentor SMC</h3>
                <p className="truncate text-[10px] text-gold">Gemini · lewat server Anda</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="flex cursor-pointer select-none items-center gap-1 rounded-lg border border-line bg-night px-2 py-1 text-[10px] font-bold text-soft">
                <input type="checkbox" checked={withCtx} onChange={(e) => setWithCtx(e.target.checked)} className="accent-[#46C3FF]" />
                <span>Bawa Analisa</span>
              </label>
              <button type="button" onClick={onToggle} aria-label="Tutup chat" className="h-7 w-7 rounded-lg bg-night text-xs font-bold text-soft hover:bg-panel2">✕</button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3.5 text-xs sm:text-sm">
            <div className="rounded-2xl rounded-tl-sm border border-line bg-panel2 p-3 leading-relaxed text-ink">{HELLO}</div>
            {withCtx && !context && (
              <p className="text-center text-[10px] text-muted">Belum ada analisa aktif — jawaban bersifat umum.</p>
            )}
            {msgs.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="ml-8 whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-gold/20 p-3 leading-relaxed text-strong">{m.content}</div>
              ) : (
                <div key={i} className={`mr-4 rounded-2xl rounded-tl-sm border p-3 ${m.error ? 'border-down/40 bg-down/10 text-down' : 'border-line bg-panel2 text-ink'}`}>
                  {m.error ? m.content : <MarkdownView content={m.content} />}
                </div>
              )
            )}
            {busy && <div className="mr-4 w-20 rounded-2xl border border-line bg-panel2 p-3 text-center text-muted">• • •</div>}
            <div ref={endRef} />
          </div>

          <div className="flex gap-1.5 overflow-x-auto border-t border-line/70 bg-night/60 px-3 py-1.5">
            {QUICK.map(([l, q]) => (
              <button key={l} type="button" disabled={busy} onClick={() => send(q)} className="flex-none rounded-full border border-line bg-panel2 px-2.5 py-1 text-[10px] font-semibold text-soft hover:text-strong disabled:opacity-50">
                {l}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-center gap-2 border-t border-line bg-night p-2.5"
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1500}
              autoComplete="off"
              placeholder="Tulis pertanyaan trading Anda..."
              className="input flex-1 !py-2 text-xs sm:text-sm"
            />
            <button type="submit" disabled={busy || !text.trim()} className="btn-gold !px-3.5 !py-2 text-xs">Kirim</button>
          </form>
        </div>
      )}
    </div>
  );
}
