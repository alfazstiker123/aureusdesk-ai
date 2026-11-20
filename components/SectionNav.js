'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import MarkdownView from '@/components/MarkdownView';
import { splitSections, SECTION_META } from '@/lib/sections';

// Navigasi cepat antar bagian hasil analisa. mode: jump | tab | accordion | off
export default function SectionNav({ content, priceDecimals, mode = 'jump' }) {
  const parts = useMemo(() => splitSections(content), [content]);
  const [active, setActive] = useState(null); // bagian aktif (tab) / terakhir dipilih
  const [open, setOpen] = useState({}); // accordion
  const [flash, setFlash] = useState(null);
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

  if (!parts || mode === 'off') return <MarkdownView content={content} priceDecimals={priceDecimals} />;

  const { intro, sections } = parts;
  const first = sections[0].n;
  const cur = active ?? first;

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
            const on = active !== null && cur === s.n;
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
              <MarkdownView content={s.body} priceDecimals={priceDecimals} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
