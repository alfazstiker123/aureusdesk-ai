'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import MarkdownView from '@/components/MarkdownView';
import { splitSections, SECTION_META } from '@/lib/sections';
import { segmentSection } from '@/lib/zoneParse';
import { fixInlineTables } from '@/lib/markdownFix';
import { ExecCards, PendingCards } from '@/components/ZoneCards';

// Bagian 3 & 4: tabel zona/order ditampilkan sebagai kartu; teks lain tetap Markdown.
// Tabel asli tetap bisa dibuka (lipatan) sebagai cadangan.
function SectionBody({ body, n, priceDecimals, onGuide, orderCtx }) {
  const segs = useMemo(() => (n === 3 || n === 4 ? segmentSection(fixInlineTables(body || '')) : null), [body, n]);
  if (!segs || !segs.some((x) => x.type === 'exec' || x.type === 'pending')) {
    return <MarkdownView content={body} priceDecimals={priceDecimals} />;
  }
  return (
    <>
      {segs.map((x, i) => {
        if (x.type === 'exec' || x.type === 'pending') {
          return (
            <div key={i}>
              {x.type === 'exec' ? (
                <ExecCards rows={x.rows} decimals={priceDecimals} onGuide={onGuide} />
              ) : (
                <PendingCards rows={x.rows} decimals={priceDecimals} analysisId={orderCtx?.analysisId} orderResults={orderCtx?.orderResults} onSaveOrder={orderCtx?.onSaveOrder} />
              )}
              <details className="mb-3 print:hidden">
                <summary className="cursor-pointer text-[11px] text-muted hover:text-ink">Lihat tabel asli</summary>
                <MarkdownView content={x.raw} priceDecimals={priceDecimals} />
              </details>
            </div>
          );
        }
        const text = x.type === 'table' ? x.raw : x.text;
        return text.trim() ? <MarkdownView key={i} content={text} priceDecimals={priceDecimals} /> : null;
      })}
    </>
  );
}

// Navigasi cepat antar bagian hasil analisa. mode: jump | tab | accordion | off
export default function SectionNav({ content, priceDecimals, mode = 'jump', onGuide, orderCtx = null }) {
  const parts = useMemo(() => splitSections(content), [content]);
  const [active, setActive] = useState(null); // bagian aktif (tab) / terakhir dipilih
  const [open, setOpen] = useState({}); // accordion
  const [flash, setFlash] = useState(null);
  const [spy, setSpy] = useState(null); // bagian yang sedang terlihat saat scroll
  const [showFab, setShowFab] = useState(false);
  const refs = useRef({});

  // reset saat hasil baru muncul
  useEffect(() => {
    setActive(null);
    setOpen({});
  }, [content]);

  // tinggi header agar bar sticky & scroll tidak tertutup
  useEffect(() => {
    const set = () => {
      const h = document.querySelector('.app-header')?.offsetHeight || 60;
      document.documentElement.style.setProperty('--hdr', `${h}px`);
    };
    set();
    window.addEventListener('resize', set);
    return () => window.removeEventListener('resize', set);
  }, []);

  // scroll-spy: tandai bagian yang sedang dibaca + tampilkan tombol melayang
  const nums = parts ? parts.sections.map((x) => x.n).join(',') : '';
  useEffect(() => {
    if (!nums) return undefined;
    const list = nums.split(',').map(Number);
    let raf = 0;
    const calc = () => {
      raf = 0;
      const hdr = (document.querySelector('.app-header')?.offsetHeight || 60) + 100;
      let cur = null;
      for (const n of list) {
        const el = refs.current[n];
        if (el && el.getBoundingClientRect().top <= hdr) cur = n;
      }
      setSpy(cur);
      setShowFab(window.scrollY > 400);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(calc); };
    calc();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [nums, content, active, open]);

  if (!parts || mode === 'off') return <MarkdownView content={content} priceDecimals={priceDecimals} />;

  const { intro, sections } = parts;
  const first = sections[0].n;
  const cur = active ?? first;
  const nowN = mode === 'jump' ? spy : active;
  const order = sections.map((x) => x.n);
  const idx = nowN == null ? -1 : order.indexOf(nowN);
  const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const toTop = () => window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  const toBottom = () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduceMotion() ? 'auto' : 'smooth' });
  const step = (d) => {
    const next = order[Math.min(order.length - 1, Math.max(0, (idx < 0 ? (d > 0 ? -1 : 0) : idx) + d))];
    if (next != null) pick(next);
  };

  const scrollTo = (n) => {
    const el = refs.current[n];
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // tunggu render (tab/accordion membuka dulu) lalu geser
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        setFlash(n);
        setTimeout(() => setFlash((f) => (f === n ? null : f)), 1200);
      })
    );
  };

  const pick = (n) => {
    setActive(n);
    if (mode === 'accordion') setOpen((o) => ({ ...o, [n]: true }));
    if (mode === 'tab') {
      const bar = refs.current.bar;
      bar?.scrollIntoView?.({ behavior: 'auto', block: 'nearest' });
      scrollTo(n);
    } else scrollTo(n);
  };

  const toggle = (n) => {
    setOpen((o) => ({ ...o, [n]: !o[n] }));
    setActive(n);
  };

  const showBody = (n) => (mode === 'tab' ? cur === n : mode === 'accordion' ? !!open[n] : true);

  return (
    <div>
      {intro.trim() && <MarkdownView content={intro} priceDecimals={priceDecimals} />}

      <div
        ref={(el) => (refs.current.bar = el)}
        className="sec-nav sticky z-30 mb-3 rounded-2xl border border-line p-1.5 shadow-lg print:hidden"
        style={{ top: 'calc(var(--hdr, 60px) + 6px)' }}
        role="tablist"
        aria-label="Navigasi bagian analisa"
      >
        <div className="grid grid-cols-4 gap-1">
          {sections.map((s) => {
            const meta = SECTION_META[s.n];
            const on = mode === 'jump' ? spy === s.n : active !== null && cur === s.n;
            return (
              <button
                key={s.n}
                type="button"
                role="tab"
                aria-selected={on}
                title={s.title}
                onClick={() => pick(s.n)}
                className={`flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-semibold leading-tight transition sm:flex-row sm:gap-1.5 sm:text-xs lg:text-sm ${
                  on ? 'bg-gold text-night shadow' : 'text-muted hover:bg-panel2 hover:text-ink'
                }`}
              >
                <span className="text-base leading-none sm:text-sm" aria-hidden="true">{meta.icon}</span>
                <span className="max-w-full truncate">
                  <span className="hidden sm:inline">{s.n}. </span>
                  {meta.short}
                </span>
              </button>
            );
          })}
        </div>
        {mode === 'accordion' && (
          <button
            type="button"
            onClick={() => {
              const all = sections.every((s) => open[s.n]);
              setOpen(Object.fromEntries(sections.map((s) => [s.n, !all])));
            }}
            className="mt-1 w-full rounded-lg py-1.5 text-[11px] text-muted hover:text-ink"
          >
            {sections.every((s) => open[s.n]) ? 'Tutup semua bagian' : 'Buka semua bagian'}
          </button>
        )}
      </div>

      {sections.map((s) => {
        const visible = showBody(s.n);
        return (
          <section
            key={s.n}
            ref={(el) => (refs.current[s.n] = el)}
            className={`sec-block scroll-mt-[calc(var(--hdr,60px)+84px)] rounded-xl transition ${flash === s.n ? 'sec-flash' : ''}`}
          >
            {mode === 'accordion' && (
              <button
                type="button"
                onClick={() => toggle(s.n)}
                aria-expanded={visible}
                className="mb-1 flex w-full items-center justify-between rounded-xl border border-line bg-panel2 px-3 py-2.5 text-left text-sm font-semibold print:hidden"
              >
                <span>
                  {SECTION_META[s.n].icon} {s.n}. {s.title}
                </span>
                <span className="text-muted">{visible ? '▾' : '▸'}</span>
              </button>
            )}
            <div className={visible ? '' : 'hidden print:block'}>
              <SectionBody body={s.body} n={s.n} priceDecimals={priceDecimals} onGuide={onGuide} orderCtx={orderCtx} />
            </div>
          </section>
        );
      })}

      {showFab && (
        <div className="fixed bottom-24 right-3 z-40 flex flex-col gap-1.5 print:hidden" role="group" aria-label="Lompat cepat">
          {[
            ['⇈', 'Ke paling atas', toTop, false],
            ['↑', 'Bagian sebelumnya', () => step(-1), idx <= 0],
            ['↓', 'Bagian berikutnya', () => step(1), idx >= order.length - 1],
            ['⇊', 'Ke paling bawah', toBottom, false],
          ].map(([ic, label, fn, dis]) => (
            <button
              key={label}
              type="button"
              onClick={fn}
              disabled={dis}
              aria-label={label}
              title={label}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-panel2/95 text-lg font-bold text-gold shadow-lg backdrop-blur transition active:scale-95 disabled:opacity-30"
            >
              {ic}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
