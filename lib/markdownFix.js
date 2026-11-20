// Perbaiki tabel GFM yang "tertelan" di dalam bullet/kalimat (semua baris tabel menyatu dalam 1 baris).
// Contoh rusak:  "- Tabel jadwal: | A | B | | :--- | :--- | | x | y | | p | q |"

const SEP_RE = /\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?/;

function repairLine(line) {
  const m = line.match(SEP_RE);
  if (!m) return null;
  const trimmedStart = line.trimStart();
  if (trimmedStart.startsWith('|')) return null; // tabel normal (baris sendiri)

  const n = m[0].split('|').filter((c) => /-{3,}/.test(c)).length; // jumlah kolom dari baris pemisah
  if (n < 2) return null;

  const firstPipe = line.indexOf('|');
  if (firstPipe < 0) return null;
  const prefix = line.slice(0, firstPipe).trimEnd(); // mis. "- Tabel jadwal:"
  let tokens = line.slice(firstPipe + 1).split('|');
  if (tokens.length && tokens[tokens.length - 1].trim() === '') tokens.pop(); // penutup terakhir

  // Susunan: n sel, 1 token kosong (akhir baris + awal baris berikut), n sel, ...
  const rows = [];
  let i = 0;
  while (i < tokens.length) {
    const cells = tokens.slice(i, i + n);
    if (cells.length < n) return null; // tidak konsisten -> jangan diubah
    rows.push(cells.map((c) => c.trim()));
    i += n;
    if (i < tokens.length) {
      if (tokens[i].trim() !== '') return null;
      i += 1;
    }
  }
  if (rows.length < 3) return null; // butuh header + pemisah + minimal 1 baris
  const [header, sepRow, ...body] = rows;
  if (!sepRow.every((c) => /^:?-{3,}:?$/.test(c))) return null;

  const fmt = (r) => `| ${r.join(' | ')} |`;
  const out = [];
  const label = prefix.replace(/^[-*+]\s*/, '').replace(/[:：]\s*$/, '').replace(/\*+/g, '').trim();
  if (label) out.push(`**${label}:**`, '');
  else out.push('');
  out.push(fmt(header), `|${header.map(() => '---').join('|')}|`, ...body.map(fmt), '');
  return out;
}

export function fixInlineTables(markdown = '') {
  if (!markdown.includes('---')) return markdown;
  const out = [];
  let fixed = 0;
  for (const line of markdown.split('\n')) {
    const r = repairLine(line);
    if (r) {
      out.push(...r);
      fixed++;
    } else {
      out.push(line);
    }
  }
  return fixed ? out.join('\n').replace(/\n{3,}/g, '\n\n') : markdown;
}
