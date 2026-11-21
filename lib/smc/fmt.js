// Jumlah desimal tampilan harga menurut besaran harga (BTC 1, emas 2, JPY/perak 3, forex 5).
export function priceDec(price) {
  const p = Math.abs(Number(price) || 0);
  if (p >= 10000) return 1;
  if (p >= 1000) return 2;
  if (p >= 10) return 3;
  return 5;
}
export const roundTo = (n, d) => { const f = 10 ** d; return Math.round(Number(n) * f) / f; };
