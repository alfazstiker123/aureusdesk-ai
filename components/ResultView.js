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
        <div className="rounded-2xl border border-gold/30 bg-gradient-to-br from-panel2 via-panel to-night p-4 shadow-xl sm:p-5 print:hidden">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xl font-black tracking-tight text-strong sm:text-2xl">{pair || '—'}</span>
                {meta.bias && (
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold ${toneClass[tone]}`}>{meta.bias}</span>
                )}
              </div>
              {meta.atr && <p className="font-mono text-[11px] text-muted">ATR · {meta.atr}</p>}
            </div>
            <div className="grid shrink-0 grid-cols-3 gap-2 sm:gap-2.5 lg:w-[370px]">
              <div className="rounded-xl border border-line bg-night/80 p-2.5 text-center">
                <div className="text-[10px] font-semibold text-muted">Harga Terakhir</div>
                <div className="mt-0.5 truncate font-mono text-xs font-extrabold text-aurum sm:text-sm">{meta.last || '-'}</div>
              </div>
              <div className="rounded-xl border border-line bg-night/80 p-2.5 text-center">
                <div className="text-[10px] font-semibold text-muted">Zona Aktif</div>
                <div className="mt-0.5 font-mono text-xs font-extrabold text-gold sm:text-sm">{validExec} / {exec.length || '-'}</div>
              </div>
              <div className="rounded-xl border border-line bg-night/80 p-2.5 text-center">
                <div className="text-[10px] font-semibold text-muted">Order Baru</div>
                <div className="mt-0.5 font-mono text-xs font-extrabold text-up sm:text-sm">{validPend} / {pend.length || '-'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {decision && (
        <div className={`rounded-2xl border p-3.5 text-xs leading-relaxed sm:text-sm print:hidden ${decision.icon === '🎯' ? 'border-up/40 bg-up/10 text-strong' : decision.icon === '⛔' ? 'border-down/40 bg-down/10 text-strong' : 'border-amber-400/40 bg-amber-400/10 text-strong'}`}>
          <div className="mb-1 font-extrabold">{decision.icon} Keputusan server: {decision.title}</div>
          <p className="text-soft">{decision.text}</p>
        </div>
      )}


      {biasPanel && (
        <div className={`rounded-2xl border p-3 text-xs sm:text-sm print:hidden ${biasPanel.conflict ? 'border-amber-400/50 bg-amber-400/10' : 'border-line bg-panel2'}`}>
          <div className="mb-2 font-extrabold text-strong">🧭 Bias: model vs struktur vs final</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-line bg-night/70 p-2"><div className="text-[10px] font-semibold text-muted">Model Gemini</div><div className="mt-0.5 break-words font-mono text-[11px] font-extrabold text-soft sm:text-xs">{biasPanel.model}</div></div>
            <div className="rounded-xl border border-line bg-night/70 p-2"><div className="text-[10px] font-semibold text-muted">Struktur {biasPanel.structureTf} mesin</div><div className="mt-0.5 break-words font-mono text-[11px] font-extrabold text-soft sm:text-xs">{biasPanel.structure}</div></div>
            <div className="rounded-xl border border-gold/40 bg-night/70 p-2"><div className="text-[10px] font-semibold text-gold">Final server</div><div className="mt-0.5 break-words font-mono text-[11px] font-extrabold text-strong sm:text-xs">{biasPanel.final}</div></div>
          </div>
          {biasPanel.note && <p className="mt-2 leading-relaxed text-soft">{biasPanel.conflict ? '⚠️ Konflik: ' : ''}{biasPanel.note.replace(/^KONFLIK BIAS:\s*/, '')}</p>}
        </div>
      )}

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
