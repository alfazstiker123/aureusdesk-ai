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

// ───────────── Lot manual (Lot Mode MANUAL): validasi terhadap spesifikasi broker; rumus risiko tidak berubah ─────────────
const MAX_MANUAL_LOT = 1000000;
/**
 * Baca input lot manual apa adanya (tanpa pembulatan). Terima angka atau teks ("0.10", "0,10").
 * Tolak: kosong, bukan angka, nol, negatif, notasi ilmiah, > 6 desimal, tak hingga.
 * @returns {{ok:boolean, value:number|null, reason:string|null}}
 */
export function parseManualLot(input) {
  if (input === null || input === undefined || (typeof input === 'string' && !input.trim())) return { ok: false, value: null, reason: 'lot manual belum diisi' };
  let s;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, value: null, reason: 'lot manual bukan angka yang valid' };
    s = String(input);
  } else if (typeof input === 'string') s = input.trim().replace(',', '.');
  else return { ok: false, value: null, reason: 'lot manual bukan angka yang valid' };
  if (!/^\d+(?:\.\d+)?$/.test(s)) return { ok: false, value: null, reason: 'lot manual harus berupa angka positif (contoh 0.01)' };
  const dec = (s.split('.')[1] || '').length;
  if (dec > 6) return { ok: false, value: null, reason: 'lot manual memiliki terlalu banyak desimal (maks 6)' };
  const v = Number(s);
  if (!Number.isFinite(v) || v <= 0) return { ok: false, value: null, reason: 'lot manual harus lebih besar dari 0' };
  if (v > MAX_MANUAL_LOT) return { ok: false, value: null, reason: 'lot manual tidak wajar' };
  return { ok: true, value: v, reason: null };
}

/** Teks lot manual: desimal minimal 2, tanpa membulatkan angka input. */
export function fmtLot(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  const s = String(Number(n.toFixed(6)));
  const d = (s.split('.')[1] || '').length;
  return d >= 2 ? s : n.toFixed(2);
}

const specLotOk = (sp) => !!sp && sp.minlot > 0 && sp.maxlot > 0 && sp.lotstep > 0;

/**
 * Validasi lot manual terhadap spesifikasi broker (min/maks/step). Tanpa spesifikasi: UNAVAILABLE (tidak menebak).
 * @returns {{status:'VALID'|'INVALID'|'UNAVAILABLE', code:string|null, reason:string|null}}
 */
export function validateManualLot(input, spec) {
  const p = parseManualLot(input);
  if (!p.ok) return { status: 'INVALID', code: 'FORMAT', reason: p.reason };
  if (!specLotOk(spec)) return { status: 'UNAVAILABLE', code: 'NO_SPEC', reason: 'lot minimum/maksimum/step broker tidak tersedia, jadi lot tidak bisa divalidasi' };
  const lot = p.value;
  if (lot < spec.minlot - 1e-9) return { status: 'INVALID', code: 'BELOW_MIN', reason: `lot ${fmtLot(lot)} di bawah lot minimum broker ${spec.minlot}` };
  if (lot > spec.maxlot + 1e-9) return { status: 'INVALID', code: 'ABOVE_MAX', reason: `lot ${fmtLot(lot)} di atas lot maksimum broker ${spec.maxlot}` };
  const units = lot / spec.lotstep;
  if (Math.abs(units - Math.round(units)) > 1e-6 * Math.max(1, units)) return { status: 'INVALID', code: 'STEP', reason: `lot ${fmtLot(lot)} bukan kelipatan lot step broker ${spec.lotstep}` };
  return { status: 'VALID', code: null, reason: null };
}

export const STATUS = {
  OK: 'OK',
  OVER_RISK: 'OVER_RISK',
  LOT_INVALID: 'LOT_INVALID',
  SL_INVALID: 'SL_INVALID',
  RISK_UNAVAILABLE: 'RISK_UNAVAILABLE',
};

export const STATUS_LABEL = {
  OK: 'LOT VALID · DALAM BATAS RISIKO',
  OVER_RISK: 'OVER RISK',
  LOT_INVALID: 'LOT TIDAK VALID',
  SL_INVALID: 'SL TIDAK VALID · lot tidak tervalidasi',
  RISK_UNAVAILABLE: 'RISK CALCULATION UNAVAILABLE',
};

/**
 * Nilai satu order MANUAL. Rumus risiko = lot x jarak x mult (mult = tickValue/tickSize dari spesifikasi broker valid).
 * @param {{lot:any, entry:number|null, sl:number|null, mult:number|null, specOk:boolean, spec?:object|null, maxRiskUsd:number, balance?:number}} p
 * @returns {{status:string, label:string, lot:number|null, dist:number|null, risk:number|null, riskPct:number|null, over:number, reason:string|null}}
 */
export function evaluateManualOrder({ lot, entry = null, sl = null, mult = null, specOk = false, spec = null, maxRiskUsd = 0, balance = 0 } = {}) {
  const out = (status, extra = {}) => ({ status, label: STATUS_LABEL[status], lot: null, dist: null, risk: null, riskPct: null, over: 0, reason: null, ...extra });
  const v = validateManualLot(lot, specOk ? spec : null);
  const p = parseManualLot(lot);
  if (v.status === 'INVALID') return out(STATUS.LOT_INVALID, { lot: p.value, reason: v.reason });
  const e = Number(entry), s = Number(sl);
  const slOk = entry != null && sl != null && Number.isFinite(e) && Number.isFinite(s) && Math.abs(e - s) > 0;
  const dist = slOk ? Math.abs(e - s) : null;
  if (!slOk) return out(STATUS.SL_INVALID, { lot: p.value, reason: 'Entry/Stop Loss tidak tersedia atau jarak SL nol, risiko tidak bisa dihitung' });
  if (v.status === 'UNAVAILABLE') return out(STATUS.RISK_UNAVAILABLE, { lot: p.value, dist, reason: v.reason });
  if (!specOk || !(mult > 0)) return out(STATUS.RISK_UNAVAILABLE, { lot: p.value, dist, reason: 'spesifikasi kontrak broker (tick value/tick size) tidak valid atau tidak tersedia; risiko uang tidak dihitung dari tebakan' });
  if (!(maxRiskUsd > 0)) return out(STATUS.RISK_UNAVAILABLE, { lot: p.value, dist, reason: 'batas risiko (saldo × risiko %) belum diisi, jadi kepatuhan risiko tidak bisa dinyatakan' });
  const risk = p.value * dist * mult;
  const riskPct = balance > 0 ? (risk / balance) * 100 : null;
  if (risk > maxRiskUsd + 0.005) return out(STATUS.OVER_RISK, { lot: p.value, dist, risk, riskPct, over: risk - maxRiskUsd, reason: `risiko melebihi batas risiko` });
  return out(STATUS.OK, { lot: p.value, dist, risk, riskPct });
}
