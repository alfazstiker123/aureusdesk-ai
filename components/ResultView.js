'use client';

import { useMemo, useState } from 'react';
import SectionNav from '@/components/SectionNav';
import ZoneMap from '@/components/ZoneMap';
import { CandleGuideModal } from '@/components/CandleSvg';
import { biasTone, toneClass } from '@/components/HistoryPanel';
import { segmentSection, parseMeta } from '@/lib/zoneParse';
import { fixInlineTables } from '@/lib/markdownFix';
import { resolvePair } from '@/lib/pairs';
import { parseBiasBlock } from '@/lib/biasFinal';
import { configDiff } from '@/lib/configDiff';

// Ringkasan (hero) + peta zona + bagian 1-4 bergaya kartu.
export default function ResultView({ content, priceDecimals, mode, pairId, onToast, candles = null, orderCtx = null, audit = null, configNow = null }) {
  const [guide, setGuide] = useState(false);
  const info = useMemo(() => {
    const md = fixInlineTables(content || '');
    const meta = parseMeta(md);
    const segs = segmentSection(md);
    const exec = segs.find((s) => s.type === 'exec')?.rows || [];
    const pend = segs.find((s) => s.type === 'pending')?.rows || [];
    const dm = md.match(/^> (🎯|⛔|⚠️) \*\*KEPUTUSAN SERVER — ([^:*]+):\*\*\s*(.*)$/mu);
    const decision = dm ? { icon: dm[1], title: dm[2].trim(), text: dm[3].trim() } : null;
    return { meta, exec, pend, decision, biasPanel: parseBiasBlock(md) };
  }, [content]);

  const { meta, exec, pend, decision, biasPanel } = info;
  // Peringatan saja (tanpa sinkronisasi): konfigurasi analisa tersimpan vs pengaturan perangkat ini
  const diffs = useMemo(() => (audit?.config && configNow ? configDiff(audit.config, configNow) : []), [audit, configNow]);
  const pair = meta.pair || pairId || '';
  const dec = resolvePair(pair)?.dec ?? (Number.isFinite(meta.price) && meta.price < 20 ? 5 : 2);
  const tone = biasTone(meta.bias || '');
  const validExec = exec.filter((r) => r.valid).length;
  const validPend = pend.filter((r) => r.valid).length;

  return (
    <div className="space-y-5">
      {(meta.bias || exec.length > 0) && (
        <div className={`relative overflow-hidden rounded-3xl border p-4 shadow-xl sm:p-5 print:hidden ${tone === 'up' ? 'border-up/30 bg-gradient-to-br from-up/10 via-panel to-night' : tone === 'down' ? 'border-down/30 bg-gradient-to-br from-down/10 via-panel to-night' : 'border-gold/30 bg-gradient-to-br from-gold/10 via-panel to-night'}`}>
          <div aria-hidden="true" className={`pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-30 blur-3xl ${tone === 'up' ? 'bg-up' : tone === 'down' ? 'bg-down' : 'bg-gold'}`} />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-2xl font-black tracking-tight text-strong sm:text-3xl">{pair || '—'}</span>
                {meta.bias && (
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${toneClass[tone]}`}>{tone === 'up' ? '▲ ' : tone === 'down' ? '▼ ' : '◆ '}{meta.bias}</span>
                )}
              </div>
              <div className="font-mono text-3xl font-black leading-none tracking-tight text-aurum sm:text-4xl">{meta.last || '-'}<span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wider text-muted">harga terakhir</span></div>
              {meta.atr && <p className="font-mono text-[11px] text-muted">ATR · {meta.atr}</p>}
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2 sm:gap-2.5 lg:w-[260px]">
              <div className="rounded-2xl border border-line/80 bg-night/60 p-2.5 text-center backdrop-blur">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Zona aktif</div>
                <div className="mt-0.5 font-mono text-base font-extrabold text-gold">{validExec}<span className="text-muted"> / {exec.length || '-'}</span></div>
              </div>
              <div className="rounded-2xl border border-line/80 bg-night/60 p-2.5 text-center backdrop-blur">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Order baru</div>
                <div className="mt-0.5 font-mono text-base font-extrabold text-up">{validPend}<span className="text-muted"> / {pend.length || '-'}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {decision && (() => {
        const t = decision.text || '';
        const g = (re) => { const m = re.exec(t); return m ? m[1].trim() : null; };
        const entry = g(/\)\s*([\d.,]+\s*[–-]\s*[\d.,]+)\s*,/);
        const sl = g(/\bSL\s+([\d.,]+)/);
        const tp1 = g(/\bTP1\s+([\d.,]+)/);
        const skor = g(/\bskor\s+([\d.,]+)/);
        const head = g(/^([^:]+):/);
        const chips = [['Entry', entry], ['SL', sl], ['TP1', tp1], ['Skor', skor]].filter(([, v]) => v);
        const ok = decision.icon === '🎯';
        const bad = decision.icon === '⛔';
        return (
          <div className={`rounded-3xl border p-4 print:hidden ${ok ? 'border-up/40 bg-gradient-to-br from-up/10 to-panel' : bad ? 'border-down/40 bg-gradient-to-br from-down/10 to-panel' : 'border-amber-400/40 bg-gradient-to-br from-amber-400/10 to-panel'}`}>
            <div className="flex items-center gap-2">
              <span className={`flex h-8 w-8 items-center justify-center rounded-xl text-base ${ok ? 'bg-up/20' : bad ? 'bg-down/20' : 'bg-amber-400/20'}`} aria-hidden="true">{decision.icon}</span>
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Keputusan server</div>
                <div className="text-sm font-extrabold leading-tight text-strong sm:text-base">{decision.title}</div>
              </div>
            </div>
            {chips.length >= 2 ? (
              <>
                {head && <p className="mt-2.5 text-xs leading-relaxed text-soft">{head.replace(/^Setup utama\s*/i, '')}</p>}
                <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {chips.map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-line/80 bg-night/60 px-2.5 py-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{k}</div>
                      <div className="font-mono text-[13px] font-extrabold text-strong">{v}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-muted">Skor = heuristik konfluensi mesin, bukan probabilitas profit.</p>
              </>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-soft sm:text-sm">{t}</p>
            )}
          </div>
        );
      })()}

      {biasPanel && (() => {
        const tf = (v) => { const u = String(v || '').toUpperCase(); return /BULL/.test(u) && !/BEAR/.test(u) ? 'text-up' : /BEAR/.test(u) && !/BULL/.test(u) ? 'text-down' : 'text-soft'; };
        const note = biasPanel.note ? biasPanel.note.replace(/^KONFLIK BIAS:\s*/, '') : '';
        return (
          <div className={`rounded-3xl border p-4 print:hidden ${biasPanel.conflict ? 'border-amber-400/40 bg-amber-400/5' : 'border-line bg-panel2/60'}`}>
            <div className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-muted">🧭 Bias: model · struktur · final</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl border border-line/80 bg-night/60 p-2">
                <div className="text-[10px] font-semibold text-muted">Model</div>
                <div className={`mt-0.5 break-words font-mono text-[11px] font-extrabold sm:text-xs ${tf(biasPanel.model)}`}>{biasPanel.model}</div>
              </div>
              <div className="rounded-2xl border border-line/80 bg-night/60 p-2">
                <div className="text-[10px] font-semibold text-muted">Struktur {biasPanel.structureTf}</div>
                <div className={`mt-0.5 break-words font-mono text-[11px] font-extrabold sm:text-xs ${tf(biasPanel.structure)}`}>{biasPanel.structure}</div>
              </div>
              <div className="rounded-2xl border border-gold/50 bg-gold/5 p-2">
                <div className="text-[10px] font-semibold text-gold">Final</div>
                <div className={`mt-0.5 break-words font-mono text-[11px] font-extrabold sm:text-xs ${tf(biasPanel.final)}`}>{biasPanel.final}</div>
              </div>
            </div>
            {biasPanel.conflict ? (
              <details className="mt-2.5 rounded-xl border border-amber-400/40 bg-amber-400/10">
                <summary className="flex min-h-[40px] cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-bold text-strong">
                  <span>⚠️ Konflik: server memakai struktur {biasPanel.structureTf} ({biasPanel.structure})</span>
                  <span className="shrink-0 text-[10px] font-semibold text-muted">detail ▸</span>
                </summary>
                <p className="border-t border-amber-400/30 px-3 py-2 text-[11px] leading-relaxed text-soft">{note}</p>
              </details>
            ) : (
              <p className="mt-2.5 text-[11px] font-semibold text-up">✅ Model dan struktur selaras</p>
            )}
          </div>
        );
      })()}

      {diffs.length > 0 && (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs leading-relaxed text-soft sm:text-sm print:hidden">
          <div className="mb-1 font-extrabold text-strong">⚙️ Konfigurasi analisa ini berbeda dari pengaturan perangkat ini</div>
          <ul className="list-disc space-y-0.5 pl-4">
            {diffs.map((d) => <li key={d.key}>{d.label}: analisa <b>{d.saved}</b> · perangkat ini <b>{d.now}</b></li>)}
          </ul>
          <p className="mt-1 text-[11px] text-muted">Hasil bisa berbeda walau snapshot sama (mis. batas risiko atau Zona 1). Pengaturan tidak disinkronkan antar perangkat.{audit?.configHash ? ` Konfigurasi analisa #${audit.configHash}.` : ''}</p>
        </div>
      )}

      <ZoneMap zones={exec} price={meta.price} dec={dec} pair={pair} bias={meta.bias} onToast={onToast} candles={candles} />

      <SectionNav content={content} priceDecimals={priceDecimals} mode={mode} onGuide={() => setGuide(true)} orderCtx={orderCtx} />

      <CandleGuideModal open={guide} onClose={() => setGuide(false)} />
    </div>
  );
}
