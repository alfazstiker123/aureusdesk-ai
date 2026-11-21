'use client';

import { useMemo, useState } from 'react';
import SectionNav from '@/components/SectionNav';
import ZoneMap from '@/components/ZoneMap';
import { CandleGuideModal } from '@/components/CandleSvg';
import { biasTone, toneClass } from '@/components/HistoryPanel';
import { segmentSection, parseMeta } from '@/lib/zoneParse';
import { fixInlineTables } from '@/lib/markdownFix';
import { resolvePair } from '@/lib/pairs';

// Ringkasan (hero) + peta zona + bagian 1-4 bergaya kartu.
export default function ResultView({ content, priceDecimals, mode, pairId, onToast }) {
  const [guide, setGuide] = useState(false);
  const info = useMemo(() => {
    const md = fixInlineTables(content || '');
    const meta = parseMeta(md);
    const segs = segmentSection(md);
    const exec = segs.find((s) => s.type === 'exec')?.rows || [];
    const pend = segs.find((s) => s.type === 'pending')?.rows || [];
    return { meta, exec, pend };
  }, [content]);

  const { meta, exec, pend } = info;
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

      <ZoneMap zones={exec} price={meta.price} dec={dec} pair={pair} bias={meta.bias} onToast={onToast} />

      <SectionNav content={content} priceDecimals={priceDecimals} mode={mode} onGuide={() => setGuide(true)} />

      <CandleGuideModal open={guide} onClose={() => setGuide(false)} />
    </div>
  );
}
