// Spesifikasi kontrak dari MarketInfo MT4 (dikirim EA). Sumber kebenaran untuk lot/risiko bila valid.
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

export const SPEC_FIELDS = ['lotsize', 'tickvalue', 'ticksize', 'digits', 'point', 'minlot', 'maxlot', 'lotstep'];

/** Rapikan + validasi spesifikasi mentah. @returns {{valid:boolean, missing:string[], problems:string[], spec:object|null}} */
export function normalizeSpec(raw, { payloadDigits = null } = {}) {
  if (!raw || typeof raw !== 'object') return { valid: false, missing: [...SPEC_FIELDS], problems: [], spec: null };
  const s = {
    lotsize: num(raw.lotsize), tickvalue: num(raw.tickvalue), ticksize: num(raw.ticksize), digits: num(raw.digits), point: num(raw.point),
    minlot: num(raw.minlot), maxlot: num(raw.maxlot), lotstep: num(raw.lotstep), stoplevel: num(raw.stoplevel), freezelevel: num(raw.freezelevel),
    spread: num(raw.spread), accountCurrency: raw.accountCurrency ? String(raw.accountCurrency).toUpperCase().slice(0, 6) : null,
    profitCurrency: raw.profitCurrency ? String(raw.profitCurrency).toUpperCase().slice(0, 6) : null,
  };
  const missing = SPEC_FIELDS.filter((k) => !(s[k] > 0) && !(k === 'digits' && s.digits === 0));
  const problems = [];
  if (!missing.includes('digits') && (!Number.isInteger(s.digits) || s.digits < 0 || s.digits > 8)) problems.push('digits tidak wajar');
  if (s.minlot > 0 && s.maxlot > 0 && s.maxlot < s.minlot) problems.push('maxlot < minlot');
  if (s.lotstep > 0 && s.minlot > 0 && s.lotstep > s.minlot * 100) problems.push('lotstep tidak wajar');
  if (s.ticksize > 0 && s.point > 0 && s.ticksize < s.point * 0.999) problems.push('ticksize < point');
  if (payloadDigits != null && Number.isInteger(s.digits) && s.digits !== payloadDigits) problems.push(`digits spesifikasi (${s.digits}) ≠ digits harga (${payloadDigits})`);
  const valid = missing.length === 0 && problems.length === 0;
  return { valid, missing, problems, spec: s };
}

/** Pengali risiko: nilai uang (mata uang akun) per 1.0 pergerakan harga per 1 lot = tickValue / tickSize. */
export const specMult = (spec) => (spec && spec.tickvalue > 0 && spec.ticksize > 0 ? spec.tickvalue / spec.ticksize : null);

/** Bulatkan lot ke bawah sesuai lotStep, dibatasi minLot..maxLot. Tanpa spesifikasi: langkah 0.01. */
export function lotFloorSpec(x, spec) {
  const step = spec?.lotstep > 0 ? spec.lotstep : 0.01;
  const min = spec?.minlot > 0 ? spec.minlot : 0.01;
  const max = spec?.maxlot > 0 ? spec.maxlot : Infinity;
  const v = Math.floor(x / step + 1e-9) * step;
  const dp = Math.min(8, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
  return Math.min(max, Math.max(min, Number(v.toFixed(dp))));
}

/** Blok prompt: spesifikasi kontrak broker (atau peringatan bila tidak tersedia). */
export function specPromptBlock(spec, why) {
  if (!spec) return `\n\nSPESIFIKASI KONTRAK BROKER: TIDAK TERSEDIA${why ? ` (${why})` : ''}. Lot & risiko hanya perkiraan dari profil bawaan — JANGAN klaim kalkulasi lot akurat; tulis peringatan bahwa nilai kontrak harus diverifikasi di MT4.`;
  return `\n\nSPESIFIKASI KONTRAK BROKER (dari MarketInfo MT4, valid): contract size ${spec.lotsize}; tickValue ${spec.tickvalue}${spec.accountCurrency ? ' ' + spec.accountCurrency : ''}; tickSize ${spec.ticksize}; digits ${spec.digits}; point ${spec.point}; lot min ${spec.minlot} / max ${spec.maxlot} / step ${spec.lotstep}; stoplevel ${spec.stoplevel ?? 'n/a'} point; spread ${spec.spread ?? 'n/a'} point. Risiko($) = Lot × Jarak SL × (tickValue/tickSize) = Lot × Jarak × ${+(spec.tickvalue / spec.ticksize).toPrecision(7)}. Lot harus kelipatan ${spec.lotstep}, antara ${spec.minlot} dan ${spec.maxlot}. SL/TP/entry pending minimal ${spec.stoplevel ?? 0} point dari harga.`;
}

/** Pesan UI (satu baris) tentang status spesifikasi. */
export function specNotice(spec, why) {
  if (!spec) return `⚠️ SPESIFIKASI BROKER TIDAK TERSEDIA${why ? ` (${why})` : ''}: lot & risiko hanya PERKIRAAN, bukan akurat. Cek nilai kontrak/tick value di MT4.`;
  return `✅ Lot/risiko dihitung dari spesifikasi broker (tickValue ${spec.tickvalue} / tickSize ${spec.ticksize}${spec.accountCurrency ? ', akun ' + spec.accountCurrency : ''}; lot ${spec.minlot}–${spec.maxlot} step ${spec.lotstep}).`;
}
