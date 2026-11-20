'use client';

import { useEffect, useState } from 'react';

export default function CalendarWidget({ pair, apiFetch }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await apiFetch(`/api/calendar?pair=${encodeURIComponent(pair)}`, { cache: 'no-store' });
        const j = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        setData(j);
        setErr('');
      } catch (e) {
        if (alive) setErr(e.message || 'Gagal memuat kalender.');
      }
    }
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair]);

  return (
    <div className="card p-4 print:hidden">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-sm font-bold">📅 Jadwal Berita High-Impact Hari Ini (Live WIB)</h2>
        {data?.currencies && (
          <span className="flex-none rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">
            {data.currencies.join(' · ')}
          </span>
        )}
      </div>

      {!data && !err && <p className="text-xs text-muted">Memuat jadwal...</p>}
      {err && <p className="text-xs text-down">{err}</p>}

      {data?.offline && (
        <p className="rounded-md border border-line bg-panel2 px-3 py-2 text-xs text-muted">
          ⚠️ Jadwal berita sedang offline (feed ForexFactory tidak bisa diakses). Cek kalender ekonomi manual.
        </p>
      )}

      {data && !data.offline && data.events.length === 0 && (
        <p className="text-xs text-muted">Tidak ada berita High/Medium-Impact hari ini untuk {data.currencies?.join(', ')}.</p>
      )}

      {data?.onlyMedium && (
        <p className="mb-2 text-[11px] text-muted">Tidak ada High-Impact hari ini — menampilkan Medium-Impact.</p>
      )}

      {data?.events?.length > 0 && (
        <ul className="space-y-1.5">
          {data.events.map((e, i) => (
            <li
              key={`${e.time}-${e.title}-${i}`}
              className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${
                e.impact === 'High' ? 'border-down/40 bg-down/5' : 'border-line bg-panel2'
              } ${e.passed ? 'opacity-60' : ''}`}
            >
              <span
                className={`mt-1 h-2.5 w-2.5 flex-none rounded-full ${e.impact === 'High' ? 'bg-down' : 'bg-gold'}`}
                title={`${e.impact} impact`}
              />
              <div className="min-w-0 flex-1">
                <p className="break-words font-semibold">
                  <span className="font-mono text-gold">{e.time} WIB</span> · {e.currency} · {e.title}
                  {e.passed ? <span className="ml-1 text-[10px] font-normal text-muted">(sudah lewat)</span> : null}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  Forecast {e.forecast} · Previous {e.previous}
                  {e.actual ? <> · <span className="font-semibold text-ink">Actual {e.actual}{e.live ? ' (live)' : ''}</span></> : e.passed ? <> · <span className="text-gold">Actual: mencari…</span></> : null}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && !data.offline && (
        <p className="mt-2 text-[10px] text-muted">
          Sumber: ForexFactory · {data.stale ? 'data tersimpan (feed gagal diperbarui) · ' : ''}
          {data.totalHigh > 5 ? `menampilkan 5 dari ${data.totalHigh} High-Impact · ` : ''}
          No-Trade Zone ±15 menit dari rilis.
        </p>
      )}
    </div>
  );
}
