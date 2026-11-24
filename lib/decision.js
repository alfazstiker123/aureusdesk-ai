// Mesin keputusan server: satu setup utama searah bias, countertrend hanya alternatif, atau NO TRADE.
// Dihitung deterministik dari tabel final (setelah semua validator) dan skor kandidat mesin SMC; Gemini tidak ikut menentukan.
// Skor = heuristik konfluensi (bukan probabilitas profit); belum dikalibrasi dengan backtest.
import { splitTables, tableKind, parseExecRows, parsePendingRows, zoneNum, priceNumbers } from './zoneParse.js';

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
const MIN_RR = (zone) => (zone === 3 ? 2.0 : 1.5); // sama dengan standar validator risiko (Zona 3 Swing 1:2, lainnya 1:1.5)
const rrOf = (txt = '') => { const m = /1\s*:\s*([\d.]+)/.exec(String(txt)); return m ? Number(m[1]) : null; };

export function buildDecision({ markdown = '', bias = 'NETRAL', zoneRes = null, alignment = null, alignmentWarning = null, htf = {}, atrM5 = 0, neutral = false } = {}) {
  const tables = splitTables(markdown).filter((t) => t.type === 'table');
  const exec = tables.filter((t) => tableKind(t.headers) === 'exec').flatMap(parseExecRows);
  const pend = tables.filter((t) => tableKind(t.headers) === 'pending').flatMap(parsePendingRows);
  const dir = bias === 'BULLISH' ? 'BUY' : bias === 'BEARISH' ? 'SELL' : null;
  const warnings = [];
  if (alignment === false) warnings.push(alignmentWarning || 'M15 belum selaras dengan H4/H1: tunggu konfirmasi sebelum entry.');
  // Bias H4/H1 melawan timeframe besar (D1/W1): setup searah bias adalah pullback melawan tren besar.
  const against = dir ? Object.entries(htf || {}).filter(([, b]) => (b === 'BULLISH' || b === 'BEARISH') && b !== bias).map(([tf]) => tf) : [];
  const htfConflict = against.length > 0;
  if (htfConflict) warnings.push(`Bias ${bias} (H4/H1) MELAWAN ${against.join(' & ')} (${against.map((tf) => htf[tf]).join('/')}): setup searah bias ini pullback melawan tren besar. Keyakinan dibatasi Sedang; kurangi ukuran dan wajib konfirmasi ekstra. Setup ${dir === 'BUY' ? 'SELL' : 'BUY'} justru searah ${against.join('/')}.`);

  // Zona berlabel Scalping dengan SL jauh lebih lebar dari ATR M5 bukan scalping sempit.
  if (atrM5 > 0) {
    for (const r of exec.filter((x) => x.valid && /scalp/i.test(x.title || '') && Number.isFinite(x.slVal))) {
      const d = r.side === 'BUY' ? r.high - r.slVal : r.slVal - r.low;
      if (d > 3 * atrM5) warnings.push(`${r.side} Zona ${r.zone} (Scalping): jarak SL ${d.toFixed(2)} = ${(d / atrM5).toFixed(1)}× ATR M5 (${atrM5.toFixed(2)}): terlalu lebar untuk scalping, perlakukan setara intraday.`);
    }
  }

  const rows = exec.filter((r) => r.valid && r.zone).map((r) => {
    const p = pend.find((x) => x.side === r.side && zoneNum(x.title) === r.zone);
    const status = pendingStatus(p);
    const score = zoneRes?.[r.side]?.[r.zone]?.score;
    const rr = rrOf(p?.rr);
    return { side: r.side, zone: r.zone, style: NAME[r.zone] || '', low: r.low, high: r.high, sl: r.slVal, tp1: r.tp1Val,
      score: Number.isFinite(score) ? score : null, status, aligned: dir ? r.side === dir : null,
      rr, belowRR: rr != null && rr < MIN_RR(r.zone) - 0.005, slOrder: p ? priceNumbers(p.sl)[0]?.val ?? NaN : NaN };
  });
  // Zona searah yang tumpang tindih (area entry beririsan / SL sama) = eksposur ganda pada struktur yang sama
  for (const side of ['BUY', 'SELL']) {
    const rs = rows.filter((r) => r.side === side).sort((a, b) => a.zone - b.zone);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      const lo = Math.max(a.low, b.low), hi = Math.min(a.high, b.high);
      const sameSl = Number.isFinite(a.slOrder) && Number.isFinite(b.slOrder) && Math.abs(a.slOrder - b.slOrder) < 0.005;
      if (lo <= hi || sameSl) {
        const both = a.status !== 'none' && b.status !== 'none';
        warnings.push(`${side} Zona ${a.zone} & Zona ${b.zone} ${lo <= hi ? `tumpang tindih (${lo}–${hi})` : 'memakai SL yang sama'}${sameSl && lo <= hi ? ' dan SL sama' : ''}: berasal dari struktur yang sama.${both ? ' Jangan pasang keduanya sekaligus (eksposur dan risiko ganda); pilih salah satu.' : ' Hanya satu yang lolos sebagai order; jangan dianggap dua peluang berbeda.'}`);
      }
    }
  }
  const usable = rows.filter((r) => r.status !== 'none'); // zona tanpa order baru (batas risiko / tidak ada setup) tidak bisa jadi setup
  const rank = (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.zone - b.zone;
  const aligned = usable.filter((r) => r.aligned === true).sort(rank);
  const counter = usable.filter((r) => r.aligned === false).sort(rank);
  const rrTag = (r) => (r.belowRR ? ` [R:R 1:${r.rr} < standar 1:${MIN_RR(r.zone).toFixed(1)} — belum valid]` : '');
  const f = (r) => `${r.side} Zona ${r.zone} (${r.style}) ${r.low}${r.high !== r.low ? `–${r.high}` : ''}, SL ${r.sl}${Number.isFinite(r.tp1) ? `, TP1 ${r.tp1}` : ''}${r.score != null ? `, skor ${r.score}` : ''}${r.status === 'placed' ? ' [sudah terpasang]' : ''}${rrTag(r)}`;
  const note = 'skor = heuristik konfluensi mesin, bukan probabilitas profit';
  const validAligned = aligned.filter((r) => !r.belowRR); // setup utama hanya dari zona yang memenuhi R:R standar

  let status, primary = null, reason, waitLines = [];
  const candList = () => {
    const out = [];
    if (aligned.length) out.push(`Kandidat searah struktur H4/H1 (${bias}): ${aligned.map(f).join('; ')}.`);
    if (counter.length) out.push(`Kandidat searah arah lain${against.length ? ` (${against.join('/')})` : ''}: ${counter.map(f).join('; ')}.`);
    return out;
  };
  if (neutral && dir && usable.length) {
    status = 'WAIT';
    reason = `Bias utama NETRAL / WAIT & SEE: konfirmasi entry belum terpenuhi, tidak ada setup utama aktif (${note}). Daftar di bawah hanya KANDIDAT zona, bukan rekomendasi eksekusi.`;
    waitLines = candList();
  } else if (!dir) {
    status = 'NO_TRADE';
    reason = 'Bias utama netral/tidak jelas: tunggu struktur searah terbentuk.';
    waitLines = usable.length ? candList().map((x) => x.replace(/^Kandidat searah struktur H4\/H1 \(NETRAL\)/, 'Kandidat')) : [];
  } else if (validAligned.length) {
    status = 'TRADE';
    primary = validAligned[0];
    reason = `Setup utama searah bias ${bias}: ${f(primary)} (${note}).`;
  } else if (aligned.length) {
    status = 'WAIT';
    reason = `Zona searah bias ${bias} ada, tetapi belum memenuhi R:R standar sehingga BELUM valid sebagai setup utama (${note}).`;
    waitLines = candList();
  } else if (counter.length) {
    status = 'COUNTERTREND_ONLY';
    reason = `Tidak ada setup searah bias ${bias}. Hanya countertrend (${counter.map((r) => `${r.side} Zona ${r.zone}`).join(', ')}): risiko lebih tinggi, wajib konfirmasi ekstra; tidak trading adalah opsi yang sah.`;
  } else {
    status = 'NO_TRADE';
    reason = 'Tidak ada zona OB/FVG fresh yang lolos validasi (atau order melebihi batas risiko).';
  }
  const alts = status === 'TRADE' ? [...validAligned.slice(1), ...aligned.filter((r) => r.belowRR), ...counter] : [];
  const icon = status === 'TRADE' ? '🎯' : status === 'NO_TRADE' ? '⛔' : status === 'WAIT' ? '⏳' : '⚠️';
  const title = status === 'TRADE' ? `SETUP UTAMA ${primary.side} Zona ${primary.zone}` : status === 'NO_TRADE' ? 'NO TRADE' : status === 'WAIT' ? 'WAIT & SEE — BELUM ADA SETUP AKTIF' : 'HANYA COUNTERTREND';
  const lines = [`> ${icon} **KEPUTUSAN SERVER — ${title}:** ${reason}`];
  for (const w of waitLines) lines.push(`> ${w}`);
  if (alts.length) {
    lines.push(`> Alternatif: ${alts.map((r) => `${r.aligned ? '' : '(countertrend, konfirmasi ekstra) '}${r.side} Zona ${r.zone}${r.score != null ? ` skor ${r.score}` : ''}${r.belowRR ? ` (R:R 1:${r.rr} < standar, belum valid)` : ''}`).join('; ')}.`);
  }
  for (const w of warnings) lines.push(`> ⚠️ ${w}`);
  return { status, primary, alternatives: alts, reason, warnings, htfConflict, text: lines.join('\n') };
}

/** Sisipkan blok keputusan sebelum "Ringkasan Cepat"; bila tidak ada, setelah baris BIAS UTAMA / harga. */
export function insertDecision(markdown = '', decisionText = '') {
  const md = String(markdown).replace(/^> [🎯⛔⚠️⏳] \*\*KEPUTUSAN SERVER[^\n]*\n(?:> [^\n]*\n)*\n?/gmu, '');
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
