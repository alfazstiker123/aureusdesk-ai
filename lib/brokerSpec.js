// Spesifikasi kontrak dari MarketInfo MT4 (dikirim EA). Sumber kebenaran untuk lot/risiko bila valid.
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

export const SPEC_FIELDS = ['lotsize', 'tickvalue', 'ticksize', 'digits', 'point', 'minlot', 'maxlot', 'lotstep'];

/** Rapikan + validasi spesifikasi mentah. @returns {{valid:boolean, missing:string[], problems:string[], spec:object|null}} */
export function normalizeSpec(raw, { payloadDigits = null, usdQuote = false } = {}) {
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
  // Satuan MODE_TICKSIZE/MODE_POINT di MT4 = harga (bukan 'points'). Ticksize harus kelipatan bulat point.
  if (s.ticksize > 0 && s.point > 0) {
    const ratio = s.ticksize / s.point;
    if (Math.abs(ratio - Math.round(ratio)) > 1e-3 * Math.max(1, ratio) || ratio > 1000) problems.push('ticksize bukan kelipatan point (periksa satuan)');
  }
  // Kuotasi USD + akun USD: tickValue/tickSize harus ≈ contract size. Selisih besar = satuan/mapping salah -> spesifikasi tidak dipakai.
  if (usdQuote && s.accountCurrency === 'USD' && s.lotsize > 0 && s.tickvalue > 0 && s.ticksize > 0) {
    const m = s.tickvalue / s.ticksize;
    if (Math.abs(m / s.lotsize - 1) > 0.02) problems.push(`tickValue/tickSize (${+m.toPrecision(6)}) tidak cocok dengan contract size ${s.lotsize} untuk kuotasi USD/akun USD (periksa satuan tick)`);
  }
  const valid = missing.length === 0 && problems.length === 0;
  return { valid, missing, problems, spec: s };
}

/** Pengali risiko: nilai uang (mata uang akun) per 1.0 pergerakan harga per 1 lot = tickValue / tickSize. */
export const specMult = (spec) => (spec && spec.tickvalue > 0 && spec.ticksize > 0 ? spec.tickvalue / spec.ticksize : null);

/** Jumlah desimal minimum yang membuat nilai step tepat (0.01->2, 0.25->2, 0.125->3). */
export function stepDecimals(step) {
  for (let d = 0; d <= 8; d++) if (Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) < 1e-9) return d;
  return 8;
}

/**
 * Lot hasil perhitungan risiko -> lot valid broker (kelipatan lotStep, <= maxLot).
 * Bila hasil < minLot: kembalikan 0 (TIDAK dinaikkan ke minLot; pemanggil harus menolak order / NO TRADE).
 * Tanpa spesifikasi: langkah & minimum 0.01.
 */
export function lotFloorSpec(x, spec) {
  const step = spec?.lotstep > 0 ? spec.lotstep : 0.01;
  const min = spec?.minlot > 0 ? spec.minlot : 0.01;
  const max = spec?.maxlot > 0 ? spec.maxlot : Infinity;
  const dp = stepDecimals(step);
  const units = Math.floor(Math.min(x, max) / step + 1e-9);
  const v = Number((units * step).toFixed(dp));
  return v + 1e-12 < min ? 0 : v;
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
