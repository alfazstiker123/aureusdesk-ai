// Mesin keputusan server: satu setup utama searah bias, countertrend hanya alternatif, atau NO TRADE.
// Dihitung deterministik dari tabel final (setelah semua validator) dan skor kandidat mesin SMC; Gemini tidak ikut menentukan.
// Skor = heuristik konfluensi (bukan probabilitas profit); belum dikalibrasi dengan backtest.
import { splitTables, tableKind, parseExecRows, parsePendingRows, zoneNum } from './zoneParse.js';

const NAME = { 1: 'Scalping', 2: 'Intraday', 3: 'Swing' };

function pendingStatus(row) {
  const t = String(row?.entry || '');
  if (!row) return 'none';
  if (/terpasang/i.test(t)) return 'placed';
  if (row.valid) return 'new';
  return 'none'; // Tidak Ada Setup / Batas Risiko / kosong
}

/**
 * @param {{markdown:string, bias:'BULLISH'|'BEARISH'|string, zoneRes?:object, alignment?:boolean|null}} p
 * zoneRes = { SELL: {1:{score,...},...}, BUY: {...} } dari buildZoneCandidates(3)
 */
export function buildDecision({ markdown = '', bias = 'NETRAL', zoneRes = null, alignment = null } = {}) {
  const tables = splitTables(markdown).filter((t) => t.type === 'table');
  const exec = tables.filter((t) => tableKind(t.headers) === 'exec').flatMap(parseExecRows);
  const pend = tables.filter((t) => tableKind(t.headers) === 'pending').flatMap(parsePendingRows);
  const dir = bias === 'BULLISH' ? 'BUY' : bias === 'BEARISH' ? 'SELL' : null;
  const warnings = [];
  if (alignment === false) warnings.push('M15 belum selaras dengan H4/H1: tunggu konfirmasi sebelum entry.');

  const rows = exec.filter((r) => r.valid && r.zone).map((r) => {
    const p = pend.find((x) => x.side === r.side && zoneNum(x.title) === r.zone);
    const status = pendingStatus(p);
    const score = zoneRes?.[r.side]?.[r.zone]?.score;
    return { side: r.side, zone: r.zone, style: NAME[r.zone] || '', low: r.low, high: r.high, sl: r.slVal, tp1: r.tp1Val,
      score: Number.isFinite(score) ? score : null, status, aligned: dir ? r.side === dir : null };
  });
  const usable = rows.filter((r) => r.status !== 'none'); // zona tanpa order baru (batas risiko / tidak ada setup) tidak bisa jadi setup
  const rank = (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.zone - b.zone;
  const aligned = usable.filter((r) => r.aligned === true).sort(rank);
  const counter = usable.filter((r) => r.aligned === false).sort(rank);
  const f = (r) => `${r.side} Zona ${r.zone} (${r.style}) ${r.low}${r.high !== r.low ? `–${r.high}` : ''}, SL ${r.sl}${Number.isFinite(r.tp1) ? `, TP1 ${r.tp1}` : ''}${r.score != null ? `, skor ${r.score}` : ''}${r.status === 'placed' ? ' [sudah terpasang]' : ''}`;
  const note = 'skor = heuristik konfluensi mesin, bukan probabilitas profit';

  let status, primary = null, reason;
  if (!dir) {
    status = 'NO_TRADE';
    reason = 'Bias utama netral/tidak jelas: tunggu struktur searah terbentuk.';
  } else if (aligned.length) {
    status = 'TRADE';
    primary = aligned[0];
    reason = `Setup utama searah bias ${bias}: ${f(primary)} (${note}).`;
  } else if (counter.length) {
    status = 'COUNTERTREND_ONLY';
    reason = `Tidak ada setup searah bias ${bias}. Hanya countertrend (${counter.map((r) => `${r.side} Zona ${r.zone}`).join(', ')}): risiko lebih tinggi, wajib konfirmasi ekstra; tidak trading adalah opsi yang sah.`;
  } else {
    status = 'NO_TRADE';
    reason = 'Tidak ada zona OB/FVG fresh yang lolos validasi (atau order melebihi batas risiko).';
  }
  const alts = status === 'TRADE' ? [...aligned.slice(1), ...counter] : [];
  const icon = status === 'TRADE' ? '🎯' : status === 'NO_TRADE' ? '⛔' : '⚠️';
  const title = status === 'TRADE' ? `SETUP UTAMA ${primary.side} Zona ${primary.zone}` : status === 'NO_TRADE' ? 'NO TRADE' : 'HANYA COUNTERTREND';
  const lines = [`> ${icon} **KEPUTUSAN SERVER — ${title}:** ${reason}`];
  if (alts.length) {
    lines.push(`> Alternatif: ${alts.map((r) => `${r.aligned ? '' : '(countertrend, konfirmasi ekstra) '}${r.side} Zona ${r.zone}${r.score != null ? ` skor ${r.score}` : ''}`).join('; ')}.`);
  }
  for (const w of warnings) lines.push(`> ⚠️ ${w}`);
  return { status, primary, alternatives: alts, reason, warnings, text: lines.join('\n') };
}

/** Sisipkan blok keputusan sebelum "Ringkasan Cepat"; bila tidak ada, setelah baris BIAS UTAMA / harga. */
export function insertDecision(markdown = '', decisionText = '') {
  const md = String(markdown).replace(/^> [🎯⛔⚠️] \*\*KEPUTUSAN SERVER[^\n]*\n(?:> [^\n]*\n)*\n?/gmu, '');
  const m = md.match(/^> \*\*Ringkasan Cepat\*\*/m);
  if (m) return `${md.slice(0, m.index)}${decisionText}\n\n${md.slice(m.index)}`;
  const b = md.match(/^.*BIAS\s*UTAMA.*$/m);
  if (b) { const at = md.indexOf(b[0]) + b[0].length; return `${md.slice(0, at)}\n\n${decisionText}${md.slice(at)}`; }
  return `${decisionText}\n\n${md}`;
}

/** Data tidak cukup untuk memvalidasi setup: JANGAN dibaca sebagai "tidak ada peluang". */
export function insufficientDecision(reason) {
  const text = `> ⚠️ **KEPUTUSAN SERVER — DATA TIDAK CUKUP:** ${reason} Setup di bawah belum divalidasi mesin SMC; perlakukan sebagai bacaan screenshot saja, bukan sinyal.`;
  return { status: 'INSUFFICIENT_DATA', primary: null, alternatives: [], reason, warnings: [], text };
}

/** Cek kecukupan data OHLC: perlu M15, H1, dan H4 berstatus OK. */
export function dataGap({ hasSnapshots = false, analyses = [], priceMismatch = false } = {}) {
  if (!hasSnapshots) return 'OHLC feed tidak tersedia (analisa hanya dari screenshot).';
  if (priceMismatch) return 'Harga screenshot dan feed berbeda jauh (PRICE MISMATCH); level feed tidak bisa dipakai.';
  const ok = new Set((analyses || []).filter((a) => a.status === 'OK').map((a) => a.timeframe));
  const missing = ['M15', 'H1', 'H4'].filter((t) => !ok.has(t));
  return missing.length ? `Data OHLC timeframe ${missing.join(', ')} tidak cukup untuk validasi struktur.` : null;
}
