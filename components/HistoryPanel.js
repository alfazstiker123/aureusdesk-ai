'use client';

import { useMemo, useState } from 'react';
import { PERIODS, OUTCOME_META, periodRange, filterByPeriod, computeStats, toCSV } from '@/lib/stats';

export function biasTone(bias = '') {
  const b = bias.toUpperCase();
  if (/BEAR|SELL/.test(b) && !/BULL|BUY/.test(b)) return 'down';
  if (/BULL|BUY/.test(b) && !/BEAR|SELL/.test(b)) return 'up';
  return 'gold';
}

export const toneClass = {
  up: 'border-up/40 bg-up/10 text-up',
  down: 'border-down/40 bg-down/10 text-down',
  gold: 'border-gold/40 bg-gold/10 text-gold',
};

export function formatWIB(iso) {
  if (!iso) return '-';
  return (
    new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso)) + ' WIB'
  );
}

const fmtUsd = (n) => `${n > 0 ? '+' : n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
const pnlCls = (n) => (n > 0 ? 'text-up' : n < 0 ? 'text-down' : 'text-ink');

function Stat({ label, children, sub, className = '' }) {
  return (
    <div className={`rounded-lg border border-line bg-panel2 px-3 py-2 ${className}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <div className="mt-0.5 text-lg font-extrabold leading-tight">{children}</div>
      {sub ? <p className="mt-0.5 text-[10px] leading-snug text-muted">{sub}</p> : null}
    </div>
  );
}

function Dashboard({ stats, period, setPeriod, custom, setCustom, rangeText, onExport, canExport }) {
  const best = stats.bestSession;
  return (
    <div className="space-y-3 border-b border-line p-3">
      <div className="flex flex-wrap gap-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
              period === p.key ? 'bg-gold text-night' : 'bg-panel2 text-muted hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {period === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="field-label" htmlFor="rf">Dari Tanggal</label>
            <input id="rf" type="date" className="input" value={custom.from} max={custom.to || undefined}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          </div>
          <div>
            <label className="field-label" htmlFor="rt">Sampai Tanggal</label>
            <input id="rt" type="date" className="input" value={custom.to} min={custom.from || undefined}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        </div>
      )}
      <p className="text-[10px] text-muted">{rangeText} · zona waktu WIB</p>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Total Setup" sub={`${stats.evaluated} dievaluasi · ${stats.pending} pending`}>
          {stats.total}
        </Stat>
        <Stat
          label="Win-Rate"
          sub={`${stats.win} Win | ${stats.loss} Loss | ${stats.bep} BEP | ${stats.cancel} Cancel`}
        >
          {stats.winRate == null ? <span className="text-muted">-</span> : (
            <span className={stats.winRate >= 50 ? 'text-up' : 'text-down'}>{stats.winRate.toFixed(1)}%</span>
          )}
        </Stat>
        <Stat label="Net PnL (USD)" className="col-span-2" sub="Akumulasi dari nominal yang Anda isi saat evaluasi">
          <span className={pnlCls(stats.pnl)}>{fmtUsd(stats.pnl)}</span>
        </Stat>
      </div>

      <div className="rounded-lg border border-line bg-panel2 p-3">
        <p className="text-[10px] uppercase tracking-wider text-muted">Performa per Sesi</p>
        {best ? (
          <p className="mt-1 text-xs">
            🏆 Paling profitabel: <span className="font-bold text-gold">{best.name}</span>{' '}
            <span className={pnlCls(best.pnl)}>({fmtUsd(best.pnl)})</span>
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">Belum ada setup yang dievaluasi pada periode ini.</p>
        )}
        {stats.sessions.length > 0 && (
          <ul className="mt-2 space-y-1">
            {stats.sessions.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="min-w-0 truncate text-muted">{s.name}</span>
                <span className="flex-none text-muted">
                  {s.win}W/{s.loss}L{s.winRate != null ? ` · ${s.winRate.toFixed(0)}%` : ''}
                </span>
                <span className={`w-20 flex-none text-right font-semibold ${pnlCls(s.pnl)}`}>{fmtUsd(s.pnl)}</span>
              </li>
            ))}
          </ul>
        )}
        {stats.pairs.length > 1 && (
          <>
            <p className="mt-3 text-[10px] uppercase tracking-wider text-muted">Performa per Pair</p>
            <ul className="mt-1 space-y-1">
              {stats.pairs.map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="min-w-0 truncate text-muted">{s.name}</span>
                  <span className="flex-none text-muted">
                    {s.win}W/{s.loss}L{s.winRate != null ? ` · ${s.winRate.toFixed(0)}%` : ''}
                  </span>
                  <span className={`w-20 flex-none text-right font-semibold ${pnlCls(s.pnl)}`}>{fmtUsd(s.pnl)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <button type="button" onClick={onExport} disabled={!canExport} className="btn-ghost w-full px-3 py-2 text-xs">
        ⬇️ Export Rekap ke CSV / Excel
      </button>
    </div>
  );
}

function EvalControls({ it, onEvaluate }) {
  const [mode, setMode] = useState(null); // 'WIN' | 'LOSS' | null
  const [pnl, setPnl] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const current = it.outcome || 'PENDING';

  function open(o) {
    setMode(o);
    setPnl(current === o && Number(it.pnl_usd) ? String(Math.abs(Number(it.pnl_usd))) : '');
    setNotes(current === o ? it.eval_notes || '' : '');
  }

  async function save(outcome, withInputs) {
    setSaving(true);
    const ok = await onEvaluate(it, {
      outcome,
      pnl_usd: withInputs ? pnl : 0,
      eval_notes: withInputs ? notes : it.eval_notes || '',
    });
    setSaving(false);
    if (ok) setMode(null);
  }

  const btn = (o, label, cls) => (
    <button
      type="button"
      disabled={saving}
      onClick={() => (o === 'WIN' || o === 'LOSS' ? open(o) : save(o, false))}
      className={`rounded-md border px-1.5 py-1.5 text-[11px] font-semibold transition ${cls} ${
        current === o ? 'ring-1 ring-gold' : ''
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-4 gap-1">
        {btn('WIN', '✅ Hit TP', 'border-up/40 text-up hover:bg-up/10')}
        {btn('LOSS', '❌ Hit SL', 'border-down/40 text-down hover:bg-down/10')}
        {btn('BEP', '➖ BEP', 'border-gold/40 text-gold hover:bg-gold/10')}
        {btn('CANCEL', '🚫 Cancel', 'border-line text-muted hover:bg-panel')}
      </div>

      {mode && (
        <div className="space-y-2 rounded-lg border border-line bg-panel p-2.5">
          <p className="text-[11px] font-semibold">
            {mode === 'WIN' ? '✅ Hit TP' : '❌ Hit SL'} - isi nominal (opsional)
          </p>
          <input
            type="text"
            inputMode="decimal"
            className="input"
            placeholder={mode === 'WIN' ? 'Profit $ (mis. 31.00)' : 'Loss $ (mis. 13.02)'}
            value={pnl}
            onChange={(e) => setPnl(e.target.value)}
            aria-label="Nominal profit atau loss dalam USD"
          />
          <input
            type="text"
            className="input"
            placeholder="Catatan singkat (opsional)"
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="Catatan evaluasi"
          />
          <p className="text-[10px] text-muted">Tanda +/- otomatis: Hit TP = profit, Hit SL = loss. Kosong = $0.</p>
          <div className="flex gap-2">
            <button type="button" disabled={saving} onClick={() => save(mode, true)} className="btn btn-gold flex-1 px-3 py-1.5 text-xs">
              {saving ? 'Menyimpan…' : 'Simpan Evaluasi'}
            </button>
            <button type="button" disabled={saving} onClick={() => setMode(null)} className="btn-ghost px-3 py-1.5 text-xs">
              Batal
            </button>
          </div>
        </div>
      )}

      {current !== 'PENDING' && !mode && (
        <button
          type="button"
          disabled={saving}
          onClick={() => save('PENDING', false)}
          className="text-[10px] text-muted underline decoration-dotted hover:text-ink"
        >
          ↺ Kembalikan ke Pending
        </button>
      )}
    </div>
  );
}

export default function HistoryPanel({ items, loading, error, activeId, onOpen, onDelete, onRefresh, busyId, onEvaluate }) {
  const [period, setPeriod] = useState('all');
  const [custom, setCustom] = useState({ from: '', to: '' });

  const [pairFilter, setPairFilter] = useState('ALL');

  const periodItems = useMemo(() => filterByPeriod(items, period, custom), [items, period, custom]);
  // daftar pair dari seluruh riwayat; angka = jumlah pada periode terpilih
  const pairChips = useMemo(() => {
    const all = [...new Set(items.map((i) => i.pair).filter(Boolean))].sort();
    return all.map((p) => ({ pair: p, count: periodItems.filter((i) => i.pair === p).length }));
  }, [items, periodItems]);
  const activePair = pairChips.some((c) => c.pair === pairFilter) ? pairFilter : 'ALL';
  const filtered = useMemo(
    () => (activePair === 'ALL' ? periodItems : periodItems.filter((i) => i.pair === activePair)),
    [periodItems, activePair]
  );
  const stats = useMemo(() => computeStats(filtered), [filtered]);
  const range = periodRange(period, custom);
  const rangeText =
    !range.from && !range.to
      ? 'Semua data'
      : period === 'custom' && (!range.from || !range.to)
        ? `${range.from || '...'} s/d ${range.to || '...'}`
        : range.from === range.to
          ? range.from
          : `${range.from} s/d ${range.to}`;

  function exportCsv() {
    const blob = new Blob([toCSV(filtered)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const tag = period === 'custom' ? `${range.from || 'awal'}_${range.to || 'akhir'}` : period;
    a.download = `aureusdesk-rekap-${activePair === 'ALL' ? '' : activePair + '-'}${tag}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  return (
    <div className="card flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-bold">📒 Riwayat Jurnal</h2>
          <p className="text-[11px] text-muted">
            {filtered.length} dari {items.length} analisa{activePair !== 'ALL' ? ` · ${activePair}` : ''} · Supabase
          </p>
        </div>
        <button type="button" onClick={onRefresh} className="btn-ghost px-3 py-1.5 text-xs" disabled={loading}>
          {loading ? 'Memuat…' : '↻ Refresh'}
        </button>
      </div>

      <Dashboard
        stats={stats}
        period={period}
        setPeriod={setPeriod}
        custom={custom}
        setCustom={setCustom}
        rangeText={rangeText}
        onExport={exportCsv}
        canExport={filtered.length > 0}
      />

      {pairChips.length > 1 && (
        <div className="border-b border-line px-3 py-2.5">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Filter Pair</p>
          <div className="chip-row" role="tablist" aria-label="Filter pair">
            {[{ pair: 'ALL', count: periodItems.length }, ...pairChips].map((c) => {
              const on = activePair === c.pair;
              return (
                <button
                  key={c.pair}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setPairFilter(c.pair)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    on
                      ? 'border-gold bg-gold text-night'
                      : 'border-line bg-panel2 text-muted hover:border-gold/50 hover:text-ink'
                  }`}
                >
                  {c.pair === 'ALL' ? 'Semua Pair' : c.pair}
                  <span className={`rounded-full px-1.5 text-[10px] ${on ? 'bg-night/20' : 'bg-night/60 text-muted'}`}>
                    {c.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto p-3 lg:max-h-[calc(100vh-170px)]">
        {error && <p className="rounded-lg border border-down/40 bg-down/10 p-3 text-xs text-down">{error}</p>}

        {loading && !items.length &&
          [0, 1, 2].map((i) => <div key={i} className="shimmer h-20 rounded-lg" />)}

        {!loading && !error && !items.length && (
          <p className="py-10 text-center text-xs text-muted">Belum ada analisa. Generate analisa pertama Anda.</p>
        )}
        {!loading && !error && items.length > 0 && !filtered.length && (
          <p className="py-8 text-center text-xs text-muted">Tidak ada analisa pada periode ini.</p>
        )}

        {filtered.map((it) => {
          const tone = biasTone(it.summary_bias || '');
          const active = it.id === activeId;
          const thumbs = Array.isArray(it.thumbnails) ? it.thumbnails : [];
          const om = OUTCOME_META[it.outcome || 'PENDING'] || OUTCOME_META.PENDING;
          const pnl = Number(it.pnl_usd) || 0;
          return (
            <div
              key={it.id}
              className={`rounded-xl border border-l-4 p-3 transition ${
                tone === 'up' ? 'border-l-up' : tone === 'down' ? 'border-l-down' : 'border-l-gold'
              } ${active ? 'border-gold bg-gold/5' : 'border-line bg-panel2 hover:border-gold/40'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink">{formatWIB(it.created_at)}</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {it.pair} · {it.session_label || '-'} · ${Number(it.account_balance || 0).toLocaleString('en-US')} · {it.risk_percent}%
                  </p>
                </div>
                <span className={`flex-none rounded-md border px-2 py-0.5 text-[11px] font-bold ${om.cls}`}>{om.label}</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-bold ${toneClass[tone]}`}>
                  {it.summary_bias || 'NETRAL'}
                </span>
                {(it.outcome === 'WIN' || it.outcome === 'LOSS' || pnl !== 0) && (
                  <span className={`text-[11px] font-bold ${pnlCls(pnl)}`}>{fmtUsd(pnl)}</span>
                )}
              </div>
              {it.eval_notes ? <p className="mt-1 break-words text-[11px] italic text-muted">“{it.eval_notes}”</p> : null}

              {thumbs.length > 0 && (
                <div className="mt-2 flex gap-1 overflow-hidden">
                  {thumbs.slice(0, 5).map((t) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={t.path}
                      src={t.url}
                      alt={t.label}
                      title={t.label}
                      loading="lazy"
                      className="h-10 w-14 flex-none rounded border border-line object-cover"
                    />
                  ))}
                  {thumbs.length > 5 && (
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded border border-line text-[10px] text-muted">
                      +{thumbs.length - 5}
                    </span>
                  )}
                </div>
              )}

              {onEvaluate && <EvalControls it={it} onEvaluate={onEvaluate} />}

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(it)}
                  disabled={busyId === it.id}
                  className="btn-ghost flex-1 px-2 py-1.5 text-xs"
                >
                  {busyId === it.id ? 'Membuka…' : 'Buka'}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(it)}
                  disabled={busyId === it.id}
                  className="btn border border-down/40 px-3 py-1.5 text-xs text-down hover:bg-down/10"
                >
                  Hapus
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
