// Bias final = keputusan SERVER (bukan narasi Gemini). Tiga lapis ditampilkan terpisah:
//   1) Bias Model Gemini  - apa yang ditulis model di baris "BIAS UTAMA"
//   2) Bias Struktur      - struktur H4 mesin SMC (cadangan H1) = higherBias
//   3) Bias Final Server  - hasil aturan di bawah; dipakai header, keputusan server, 4B, dan kesimpulan
// Aturan tetap (tidak bergantung pilihan kata model):
//   - model menyatakan NETRAL / WAIT / NO TRADE  -> final NETRAL (server tidak memaksa arah); struktur tetap ditampilkan
//   - ada struktur mesin                          -> arah final = struktur mesin; bila model berbeda, KONFLIK ditampilkan + alasan
//   - tanpa struktur mesin (screenshot saja)      -> arah model bila jelas, selain itu NETRAL
// Tanpa import alias supaya bisa diuji dengan node.
import { isNeutralHeadline } from './consistency.js';

const LABEL = { BULLISH: 'BULLISH - FOKUS BUY', BEARISH: 'BEARISH - FOKUS SELL' };
export const BIAS_MARK = '🧭 **BIAS**';

/** Arah dari teks headline model. mixed=true bila kedua arah disebut (mis. "BEARISH ... H4 MASIH BULLISH"); arah utama = kata arah pertama. */
export function classifyModelBias(headline = '') {
  const h = String(headline || '').toUpperCase();
  if (!h.trim()) return { kind: 'UNKNOWN', direction: null, mixed: false };
  if (isNeutralHeadline(h)) return { kind: 'NEUTRAL', direction: null, mixed: false };
  const hasBear = /BEARISH|\bSELL\b/.test(h), hasBull = /BULLISH|\bBUY\b/.test(h);
  if (!hasBear && !hasBull) return { kind: 'UNKNOWN', direction: null, mixed: false };
  const first = h.search(/BULLISH|BEARISH|\bBUY\b|\bSELL\b/);
  const lead = /^(BULLISH|BUY)/.test(h.slice(first)) ? 'BULLISH' : 'BEARISH';
  return { kind: lead, direction: lead, mixed: hasBear && hasBull };
}

const engineDir = (b = '') => (/BULL/i.test(b) ? 'BULLISH' : /BEAR/i.test(b) ? 'BEARISH' : null);

/**
 * @param {{modelHeadline:string, engineBias?:string, structureTf?:string}} p
 * @returns {{model:object, modelText:string, structure:string|null, structureTf:string, final:string, direction:string|null,
 *           neutral:boolean, conflict:'none'|'direction'|'mixed'|'neutral'|'no_structure', override:boolean, reason:string, finalLabel:string}}
 *   direction = arah dasar untuk mesin keputusan (struktur mesin; cadangan arah model) - sama dengan perilaku lama resolveBias
 */
export function decideBias({ modelHeadline = '', engineBias = '', structureTf = 'H4' } = {}) {
  const model = classifyModelBias(modelHeadline);
  const structure = engineDir(engineBias);
  const modelText = String(modelHeadline || '').trim();
  let direction, neutral = false, conflict = 'none', override = false, reason;

  if (structure) {
    direction = structure;
    if (model.kind === 'NEUTRAL') {
      neutral = true; conflict = 'neutral';
      reason = `Model menyatakan WAIT / NETRAL, sedangkan struktur ${structureTf} mesin ${structure}. Server mempertahankan WAIT & SEE (tidak memaksa arah); kandidat zona hanya referensi, bukan setup aktif.`;
    } else if (model.direction && model.direction !== structure) {
      conflict = model.mixed ? 'mixed' : 'direction'; override = true;
      reason = `Model menulis ${model.direction}${model.mixed ? ' (teks memuat BULLISH dan BEARISH sekaligus; arah pertama dibaca sebagai arah model)' : ''}, struktur ${structureTf} mesin ${structure}. Aturan server: arah ditentukan struktur mesin; narasi model tidak membalik arah. Bias final = ${structure}.`;
    } else if (model.direction === structure) {
      reason = `Model dan struktur ${structureTf} mesin sama-sama ${structure}.`;
    } else {
      reason = `Model tidak menyebut arah yang jelas; bias final mengikuti struktur ${structureTf} mesin (${structure}).`;
      override = !!modelText && model.kind === 'UNKNOWN';
      conflict = override ? 'direction' : 'none';
    }
  } else if (model.kind === 'NEUTRAL') {
    direction = null; neutral = true; conflict = 'no_structure';
    reason = 'Tidak ada struktur mesin (analisa dari screenshot saja); model menyatakan WAIT / NETRAL → final NETRAL.';
  } else if (model.direction && !model.mixed) {
    direction = model.direction; conflict = 'no_structure';
    reason = `Tidak ada struktur mesin (screenshot saja): bias final mengikuti tulisan model (${model.direction}) dan BELUM diverifikasi struktur.`;
  } else {
    direction = null; conflict = 'no_structure';
    reason = 'Tidak ada struktur mesin dan arah model tidak jelas → final NETRAL.';
  }
  const final = neutral || !direction ? 'NETRAL' : direction;
  return { model, modelText, structure, structureTf, final, direction, neutral, conflict, override, reason, finalLabel: LABEL[final] || 'NETRAL - WAIT & SEE' };
}

/** Struktur TF mana yang dipakai engine (sama dengan lib/smc/engine.js: H4 bila ada bias, selain itu H1). */
export function structureTfOf(analyses = []) {
  const ok = (tf) => (analyses || []).find((x) => x.timeframe === tf && x.status === 'OK');
  const h4 = ok('H4');
  return h4?.bias && h4.bias !== 'UNKNOWN' ? 'H4' : 'H1';
}

const BIAS_LINE = /^\s*>?\s*[*_]*\s*BIAS\s*UTAMA\s*[:：]/i;

/** Tulis ulang baris BIAS UTAMA ke bias final BILA model berbeda dari server (override). Tidak diam-diam: panel bias selalu ditambahkan terpisah. */
export function syncHeadline(markdown, info) {
  if (!info?.override || (info.final !== 'BULLISH' && info.final !== 'BEARISH')) return String(markdown);
  return String(markdown).replace(/(BIAS\s*UTAMA\s*[:：]\s*\**\s*)[^\n*]+/i, `$1${LABEL[info.final]}`);
}

const q = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Panel 3 lapis bias (idempotent). Disisipkan tepat setelah baris BIAS UTAMA, atau di awal bila tidak ada. */
export function biasBlock(info, { decisionTitle = '' } = {}) {
  const m = info.model.direction ? `${info.model.direction}${info.model.mixed ? ' (campuran)' : ''}` : info.model.kind === 'NEUTRAL' ? 'NETRAL / WAIT' : 'TIDAK JELAS';
  const lines = [`> ${BIAS_MARK} | Model Gemini: ${m} | Struktur ${info.structureTf} mesin: ${info.structure || 'TIDAK ADA'} | Final server: ${info.final}`];
  if (info.conflict === 'none') lines.push(`> ✅ Selaras: ${info.reason}`);
  else if (info.conflict === 'neutral' || info.conflict === 'no_structure') lines.push(`> ℹ️ ${info.reason}`);
  else lines.push(`> ⚠️ KONFLIK BIAS: ${info.reason}`);
  if (info.modelText && (info.override || info.conflict !== 'none')) lines.push(`> Teks asli model: "${q(info.modelText).slice(0, 90)}"`);
  if (decisionTitle) lines.push(`> Keputusan server memakai bias final yang sama: ${decisionTitle}.`);
  return lines.join('\n');
}

export function insertBiasBlock(markdown, info, opts = {}) {
  const md = String(markdown).replace(/^> 🧭 \*\*BIAS\*\*[^\n]*\n(?:> (?:✅|ℹ️|⚠️ KONFLIK BIAS|Teks asli model|Keputusan server memakai)[^\n]*\n?)*/gmu, '');
  const block = biasBlock(info, opts);
  const lines = md.split('\n');
  const at = lines.findIndex((l) => BIAS_LINE.test(l));
  if (at >= 0) { lines.splice(at + 1, 0, '', block); return lines.join('\n').replace(/\n{3,}/g, '\n\n'); }
  return `${block}\n\n${md}`;
}

/** Parser untuk UI: {model, structure, structureTf, final, note, conflict} atau null. */
export function parseBiasBlock(markdown = '') {
  const m = /^> 🧭 \*\*BIAS\*\* \| Model Gemini: ([^|]+?) \| Struktur (\w+) mesin: ([^|]+?) \| Final server: ([^\n]+)$/mu.exec(String(markdown));
  if (!m) return null;
  const rest = String(markdown).slice(m.index + m[0].length).split('\n').slice(1, 4);
  const note = rest.find((l) => /^> (✅|ℹ️|⚠️ KONFLIK BIAS)/u.test(l)) || '';
  return { model: m[1].trim(), structureTf: m[2], structure: m[3].trim(), final: m[4].trim(), conflict: /KONFLIK BIAS/.test(note), note: note.replace(/^> (✅ |ℹ️ |⚠️ )/u, '').trim() };
}
