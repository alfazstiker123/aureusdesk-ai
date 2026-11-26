'use client';

import { useMemo, useState } from 'react';
import MarkdownView from '@/components/MarkdownView';
import { foldMarkdown } from '@/lib/viewFold';

// Tampilan ringkas (hanya presentasi): bagian panjang dilipat, ketuk untuk membuka.
// Isi lipatan = teks asli markdown, tidak diubah. Data tersimpan/PDF/riwayat tidak terpengaruh.
function Fold({ seg, priceDecimals }) {
  const [open, setOpen] = useState(false);
  const warn = seg.kind === 'notes' && /peringatan/.test(seg.hint);
  return (
    <details
      className={`fold group my-2 rounded-xl border print:hidden ${warn ? 'border-amber-400/40 bg-amber-400/5' : 'border-line bg-panel2/40'}`}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-soft sm:text-sm">
        <span className="min-w-0 truncate">
          <span aria-hidden="true">{seg.icon}</span> {seg.title}
          {seg.hint ? <span className={`ml-1.5 font-normal ${warn ? 'text-amber-300' : 'text-muted'}`}>· {seg.hint}</span> : null}
        </span>
        <span className="shrink-0 text-muted transition group-open:rotate-90" aria-hidden="true">▸</span>
      </summary>
      {open && (
        <div className="border-t border-line px-3 pb-2 pt-1">
          <MarkdownView content={seg.text} priceDecimals={priceDecimals} />
        </div>
      )}
    </details>
  );
}

// Kartu Lot Mode. Baris order SELALU tampil (termasuk OVER RISK / ditolak); hanya penjelasan yang dilipat.
function LotCard({ card }) {
  const manual = card.mode === 'MANUAL';
  const anyBad = card.items.some((x) => x.bad);
  return (
    <div className={`my-2 rounded-2xl border p-3 text-xs sm:text-sm print:hidden ${anyBad ? 'border-down/50 bg-down/5' : manual ? 'border-gold/40 bg-gold/5' : 'border-line bg-panel2/60'}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-extrabold text-strong">💼 Lot {manual ? 'MANUAL' : 'Otomatis'}{manual && card.lot ? ` ${card.lot}` : ''}</span>
        {card.cap && <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">batas {card.cap}/arah</span>}
      </div>
      {card.empty ? (
        <p className="mt-1.5 text-soft">{card.emptyText || 'Tidak ada order baru yang lolos validator.'}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {card.items.map((it, i) => (
            <li key={i} className={`rounded-xl border px-2.5 py-2 ${it.bad ? 'border-down/40 bg-down/10' : 'border-line bg-night/60'}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                <span className="font-bold text-strong">{it.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${it.bad ? 'bg-down/20 text-down' : 'bg-up/15 text-up'}`}>{it.bad ? '⛔' : '✅'} {it.rejected ? 'TIDAK DIPASANG' : it.status.replace(/\s*·\s*DALAM BATAS RISIKO/, '').replace(/^LOT VALID$/, 'Lot valid · dalam batas')}</span>
              </div>
              {it.rejected ? (
                <p className="mt-1 text-[11px] leading-relaxed text-soft">{it.status}</p>
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-soft sm:text-xs">
                  <span>{it.lot} lot</span>
                  <span>{it.entry} → SL {it.sl}</span>
                  {it.risk && <span className="font-bold text-strong">{it.risk}{it.pct ? ` (${it.pct})` : ''}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {(card.explain || card.foot || card.notes.length > 0) && (
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-[11px] text-muted hover:text-ink">ⓘ Penjelasan mode lot</summary>
          <div className="mt-1 space-y-1 text-[11px] leading-relaxed text-muted">
            {card.explain && <p>{card.explain}</p>}
            {card.notes.map((n, i) => <p key={i}>{n}</p>)}
            {card.foot && <p>{card.foot}</p>}
          </div>
        </details>
      )}
    </div>
  );
}

export default function FoldedMarkdown({ content, priceDecimals = null }) {
  const segs = useMemo(() => foldMarkdown(content), [content]);
  return (
    <>
      {segs.map((s, i) => {
        if (s.type === 'fold') return <Fold key={i} seg={s} priceDecimals={priceDecimals} />;
        if (s.type === 'lot') return <LotCard key={i} card={s.card} />;
        return <MarkdownView key={i} content={s.text} priceDecimals={priceDecimals} />;
      })}
    </>
  );
}
