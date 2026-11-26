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

// Ringkasan Cepat: baris ikon + label + isi, ukuran kecil dan lega.
function RingkasCard({ rows }) {
  return (
    <div className="my-2 rounded-2xl border border-gold/30 bg-panel2/60 p-3 print:hidden">
      <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wide text-gold">⚡ Ringkasan cepat</div>
      <dl className="space-y-2.5">
        {rows.map((r, i) => {
          const chips = /^Level kunci/i.test(r.label) ? r.value.split(/\s*\|\s*/).filter(Boolean) : null;
          const lines = /^Masa Berlaku/i.test(r.label) ? r.value.split(/\s*;\s*/).filter(Boolean) : null;
          return (
            <div key={i} className="flex gap-2.5">
              <span className="mt-0.5 w-5 shrink-0 text-center text-base leading-none" aria-hidden="true">{r.icon}</span>
              <div className="min-w-0 flex-1">
                <dt className="text-[11px] font-bold text-muted">{r.label}</dt>
                <dd className="mt-0.5 text-[13px] leading-relaxed text-ink">
                  {chips ? (
                    <span className="flex flex-wrap gap-1.5">
                      {chips.map((c, k) => <span key={k} className="rounded-lg border border-line bg-night/70 px-2 py-0.5 font-mono text-[11px] text-strong">{c}</span>)}
                    </span>
                  ) : lines ? (
                    <ul className="space-y-0.5">{lines.map((l, k) => <li key={k}>{l.replace(/\.$/, '')}</li>)}</ul>
                  ) : r.value}
                </dd>
              </div>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

// Aturan Pasang: hanya hasil akhir per arah; kandidat & pembatalan dilipat. Peringatan (⛔/⚠️) tetap tampil.
function RulesCard({ seg }) {
  return (
    <div className="my-2 rounded-2xl border border-line bg-panel2/60 p-3 text-xs sm:text-sm print:hidden">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-extrabold text-strong">🛡️ Aturan pasang</span>
        {seg.cap && <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">batas {seg.cap}/arah</span>}
      </div>
      <ul className="mt-2 space-y-1.5">
        {seg.results.map((r, i) => {
          const none = /tidak ada order valid/i.test(r.text);
          return (
            <li key={i} className="flex items-start gap-2 rounded-xl border border-line bg-night/60 px-2.5 py-2">
              <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${r.side === 'BUY' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{r.side}</span>
              <span className={`min-w-0 leading-relaxed ${none ? 'text-muted' : 'font-semibold text-strong'}`}>{r.text.replace(/\.$/, '')}</span>
            </li>
          );
        })}
      </ul>
      {seg.tips.map((t, i) => (
        <p key={i} className={`mt-2 rounded-xl px-2.5 py-1.5 leading-relaxed ${/^(⛔|⚠️)/u.test(t) ? 'border border-down/40 bg-down/10 text-strong' : 'text-soft'}`}>{t}</p>
      ))}
      {seg.detail.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-[11px] text-muted hover:text-ink">ⓘ Kandidat awal & pembatalan validator</summary>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted">
            {seg.detail.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

// Struktur Top-Down: satu kartu, satu baris per timeframe (tren berwarna, level sebagai chip).
function TfCard({ seg }) {
  const tone = (t) => { const u = String(t || '').toUpperCase(); return /BULL/.test(u) && !/BEAR/.test(u) ? 'up' : /BEAR/.test(u) && !/BULL/.test(u) ? 'down' : 'flat'; };
  const cnt = { up: 0, down: 0, flat: 0 };
  seg.rows.forEach((r) => { cnt[tone(r.trend)] += 1; });
  return (
    <div className="my-2 rounded-3xl border border-line bg-panel2/50 p-3 print:hidden">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-gold">📈 Struktur top-down</span>
        <span className="text-[11px] text-muted">{cnt.up ? `▲ ${cnt.up} bullish` : ''}{cnt.up && cnt.down ? ' · ' : ''}{cnt.down ? `▼ ${cnt.down} bearish` : ''}</span>
      </div>
      <ul className="space-y-2">
        {seg.rows.map((r, i) => {
          const t = tone(r.trend);
          return (
            <li key={i} className="rounded-2xl border border-line/80 bg-night/60 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-lg bg-panel2 px-2 py-0.5 font-mono text-xs font-black text-strong">{r.tf}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${t === 'up' ? 'bg-up/15 text-up' : t === 'down' ? 'bg-down/15 text-down' : 'bg-gold/15 text-gold'}`}>{t === 'up' ? '▲ ' : t === 'down' ? '▼ ' : '◆ '}{r.trend}</span>
              </div>
              {r.levels.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.levels.map((l, k) => (
                    <span key={k} className="rounded-lg border border-line bg-panel2/70 px-2 py-1 text-[11px] leading-tight">
                      <span className="font-mono font-bold text-strong">{l.price}</span>
                      {l.label && <span className="ml-1 text-muted">{l.label}</span>}
                    </span>
                  ))}
                </div>
              )}
              {r.note && <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{r.note}</p>}
            </li>
          );
        })}
      </ul>
      <details className="mt-2">
        <summary className="cursor-pointer list-none text-[11px] text-muted hover:text-ink">Lihat tabel asli</summary>
        <MarkdownView content={seg.raw} />
      </details>
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
        if (s.type === 'ringkas') return <RingkasCard key={i} rows={s.rows} />;
        if (s.type === 'rules') return <RulesCard key={i} seg={s} />;
        if (s.type === 'tftable') return <TfCard key={i} seg={s} />;
        return <MarkdownView key={i} content={s.text} priceDecimals={priceDecimals} />;
      })}
    </>
  );
}
