// Status alignment multi-timeframe (H4, H1, M15). Hanya label/peringatan: tidak menyentuh deteksi BOS/CHoCH/OB/FVG.
// SELARAS   : H4, H1, M15 valid dan semuanya sama.
// CAMPURAN  : ada timeframe berbeda (data valid yang tersedia sudah saling bertentangan).
// TIDAK DAPAT DINILAI : data tidak cukup untuk membandingkan (mis. TF hilang/UNKNOWN dan yang tersedia tidak bertentangan).
// M5 tidak termasuk definisi (hanya konfirmasi momentum, bukan alignment utama).
export const ALIGN_TFS = ['H4', 'H1', 'M15'];

export function alignmentOf(analyses = []) {
  const items = ALIGN_TFS.map((tf) => {
    const a = (analyses || []).find((x) => x?.timeframe === tf && x?.status === 'OK');
    const b = a?.bias === 'BULLISH' || a?.bias === 'BEARISH' ? a.bias : null;
    return { tf, bias: b };
  });
  const known = items.filter((x) => x.bias);
  const distinct = new Set(known.map((x) => x.bias));
  let status;
  if (known.length === ALIGN_TFS.length) status = distinct.size === 1 ? 'SELARAS' : 'CAMPURAN';
  else if (distinct.size > 1) status = 'CAMPURAN';
  else status = 'TIDAK DAPAT DINILAI';
  const detail = items.map((x) => `${x.tf} ${x.bias || 'tidak tersedia'}`).join(', ');
  const alignment = status === 'SELARAS' ? true : status === 'CAMPURAN' ? false : null; // kompatibel dengan consumer lama
  const warning = status === 'CAMPURAN' ? `Alignment CAMPURAN (${detail}): timeframe belum searah; tunggu konfirmasi sebelum entry.` : null;
  return { status, alignment, detail, items, warning };
}
