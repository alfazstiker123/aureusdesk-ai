// Model cadangan kadang menulis angka format Indonesia (56.964,10) padahal validator membaca format
// internasional (56,964.10). Mengubahnya sebelum validasi mencegah angka terbaca salah (mis. SL 5000 / entry 96410).
// Hanya dipakai untuk pair berharga >= 500 (BTC, emas, indeks) karena "1.085" pada forex adalah desimal.
export function normalizeIdNumbers(markdown = '') {
  let n = 0;
  let out = String(markdown).replace(/(?<![\d.,])\d{1,3}(?:\.\d{3})+(?:,\d{1,8})?(?!\d)/g, (m) => { n++; return m.replace(/\./g, '').replace(',', '.'); });
  out = out.replace(/(?<![\d.,])(\d{3,}),(\d{1,2})(?![\d,])/g, (m, a, b) => { n++; return `${a}.${b}`; });
  return { markdown: out, changed: n };
}
