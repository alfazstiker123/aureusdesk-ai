// Memecah hasil analisa menjadi: pembuka (sebelum Bagian 1) + Bagian 1–4.
// Pemecahan hanya berdasarkan baris heading "### 1." … "### 4."; isi tidak diubah sama sekali.
export const SECTION_META = {
  1: { icon: '📰', short: 'Fundamental' },
  2: { icon: '📈', short: 'Teknikal' },
  3: { icon: '🎯', short: 'Eksekusi' },
  4: { icon: '🧾', short: 'Pending' },
};

export const NAV_MODES = [
  { key: 'jump', label: 'Lompat', hint: 'Semua bagian tampil; tombol meluncur ke bagian yang dipilih' },
  { key: 'tab', label: 'Tab', hint: 'Hanya satu bagian tampil; pilih tombol untuk berpindah' },
  { key: 'accordion', label: 'Lipat', hint: 'Bagian bisa dibuka/ditutup; tombol membuka & meluncur' },
  { key: 'off', label: 'Mati', hint: 'Tanpa tombol navigasi, tampilan penuh seperti biasa' },
];
export const NAV_KEY = 'aureus_navmode';
export const NAV_DEFAULT = 'jump';

const HEAD = /^#{2,4}[ \t]*\**[ \t]*([1-4])[.)][ \t]+(.*)$/;

export function splitSections(markdown) {
  const lines = String(markdown || '').split('\n');
  const marks = []; // {idx, n, title}
  let fence = false;
  lines.forEach((ln, i) => {
    if (/^\s*```/.test(ln)) fence = !fence;
    if (fence) return;
    const m = HEAD.exec(ln);
    if (m) marks.push({ idx: i, n: Number(m[1]), title: m[2].replace(/\*+/g, '').trim() });
  });
  // butuh urutan menaik & tanpa duplikat, minimal 2 bagian; selain itu jangan dipecah
  const seen = new Set();
  const ok = marks.filter((m) => (seen.has(m.n) ? false : (seen.add(m.n), true)));
  if (ok.length < 2 || ok.some((m, i) => i > 0 && m.n < ok[i - 1].n)) return null;
  const intro = lines.slice(0, ok[0].idx).join('\n');
  const sections = ok.map((m, i) => ({
    n: m.n,
    title: m.title,
    body: lines.slice(m.idx, i + 1 < ok.length ? ok[i + 1].idx : lines.length).join('\n'),
  }));
  return { intro, sections };
}
