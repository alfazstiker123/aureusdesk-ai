// Ringkasan Cepat "Rencana" mengikuti status keputusan server (Audit #13). Tanpa import alias supaya bisa diuji dengan node.
// Bila keputusan BUKAN TRADE dan kalimat Rencana dari model menyuruh menyiapkan/memasang order, baris itu diganti kalimat server.
// Rencana yang hanya berisi tunggu/jangan trading dibiarkan (narasi tetap alami).
import { ledgerOf } from './finalSync.js';

const LINE = /^(\s*>\s*(?:-\s*)?(?:[^\w\s|*]{1,3}\s*)?)(Rencana)\s*:\s*([^\n]*)$/i;
const ACTION = /\b(siapkan|menyiapkan|pasang|memasang|pasangkan|buka\s+(?:order|posisi|buy|sell)|sell\s*limit|buy\s*limit|entry|masuk)\b/i;
const NEG = /\b(jangan|tidak|belum|hindari|dilarang|batal)\b/i;

/** Klausa yang menyuruh bertindak (tanpa penyangkalan) di kalimat Rencana model. */
export function hasActionClause(text = '') {
  return String(text).split(/[.;]|\blalu\b|\bkemudian\b|\blalu\s+/i).some((c) => ACTION.test(c) && !NEG.test(c));
}

export function syncSummaryPlan(markdown = '', { status = 'NO_TRADE', bias = '' } = {}) {
  const out = { markdown, changed: false, notes: [] };
  if (status === 'TRADE') return out;
  const lines = String(markdown).split('\n');
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { fence = !fence; continue; }
    if (fence) continue;
    const m = LINE.exec(lines[i]);
    if (!m || !hasActionClause(m[3])) continue;
    const orig = m[3];
    const led = ledgerOf(markdown);
    const cand = [...led.values()].filter((l) => l.active).map((l) => `${l.side === 'SELL' ? 'Sell' : 'Buy'} Zona ${l.zone}`);
    const hasNtz = /no[- ]?trade/i.test(orig);
    const t = /(?:tunggu|hingga|sampai)\s+(\d{1,2}[:.]\d{2})\s*WIB/i.exec(orig);
    const wait = hasNtz && t ? `No-Trade Zone aktif hingga ${t[1].replace('.', ':')} WIB; ` : '';
    let txt;
    if (status === 'COUNTERTREND_ONLY') {
      txt = `Keputusan server: HANYA COUNTERTREND${bias ? ` (bias ${bias})` : ''}. ${wait}${cand.length ? `${cand.join(' & ')} hanya berstatus CANDIDATE: belum boleh dipasang.` : 'Tidak ada order yang boleh dipasang.'} Evaluasi ulang setelah keputusan server berubah; tidak trading adalah pilihan yang sah.`;
    } else if (status === 'WAIT') {
      txt = `Keputusan server: WAIT. ${wait}Jangan membuka order baru sekarang; evaluasi ulang setelah keputusan server berubah.`;
    } else {
      txt = `Keputusan server: NO TRADE. ${wait}Tidak ada setup yang lolos validator; jangan membuka order.`;
    }
    lines[i] = `${m[1]}${m[2]}: ${txt}`;
    out.changed = true;
    out.notes.push('🧭 Rencana di Ringkasan Cepat diganti kalimat server karena menyuruh menyiapkan order saat keputusan server bukan setup utama (TRADE).');
    break;
  }
  out.markdown = lines.join('\n');
  return out;
}
