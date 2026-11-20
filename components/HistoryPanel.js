'use client';

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

export default function HistoryPanel({ items, loading, error, activeId, onOpen, onDelete, onRefresh, busyId }) {
  return (
    <div className="card flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-bold">📒 Riwayat Jurnal</h2>
          <p className="text-[11px] text-muted">{items.length} analisa tersimpan di Supabase</p>
        </div>
        <button type="button" onClick={onRefresh} className="btn-ghost px-3 py-1.5 text-xs" disabled={loading}>
          {loading ? 'Memuat…' : '↻ Refresh'}
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3 lg:max-h-[calc(100vh-170px)]">
        {error && <p className="rounded-lg border border-down/40 bg-down/10 p-3 text-xs text-down">{error}</p>}

        {loading && !items.length &&
          [0, 1, 2].map((i) => <div key={i} className="shimmer h-20 rounded-lg" />)}

        {!loading && !error && !items.length && (
          <p className="py-10 text-center text-xs text-muted">Belum ada analisa. Generate analisa pertama Anda.</p>
        )}

        {items.map((it) => {
          const tone = biasTone(it.summary_bias || '');
          const active = it.id === activeId;
          const thumbs = Array.isArray(it.thumbnails) ? it.thumbnails : [];
          return (
            <div
              key={it.id}
              className={`rounded-lg border p-3 transition ${
                active ? 'border-gold bg-gold/5' : 'border-line bg-panel2 hover:border-gold/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink">{formatWIB(it.created_at)}</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {it.pair} · {it.session_label || '-'} · ${Number(it.account_balance || 0).toLocaleString('en-US')} · {it.risk_percent}%
                  </p>
                </div>
              </div>

              <span className={`mt-2 inline-block rounded-md border px-2 py-0.5 text-[11px] font-bold ${toneClass[tone]}`}>
                {it.summary_bias || 'NETRAL'}
              </span>

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
