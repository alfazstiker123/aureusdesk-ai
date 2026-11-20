// Verifikasi otomatis tabel Pending Order hasil AI.
// Rumus XAU/USD:  Risiko ($) = Lot x Jarak_SL (poin, 1 poin = $1.00) x 100
// Jarak_SL = |Entry - SL|.  Angka yang salah dikoreksi agar tidak ada risiko "karangan".

const money = (n) => `$${n.toFixed(2)}`;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

const isSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

// Ambil angka harga (3-5 digit) pertama dari sel
function firstPrice(cell = '') {
  const m = cell.replace(/,/g, '').match(/\d{3,5}(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function firstNumber(cell = '') {
  const m = cell.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function findCol(headers, test, exclude) {
  return headers.findIndex((h) => test.test(h) && !(exclude && exclude.test(h)));
}

export function verifyRiskTables(markdown = '', maxRiskUsd = 0) {
  const lines = markdown.split('\n');
  const notes = [];
  let tablesChecked = 0;

  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !isSeparator(lines[i + 1])) continue;

    const headers = splitRow(lines[i]).map((h) => h.toLowerCase());
    // Entry: "Harga Entry" (tabel order) atau "Harga" (tabel audit order terpasang)
    let cEntry = findCol(headers, /entry/, /zona/);
    if (cEntry < 0) cEntry = findCol(headers, /^harga\b/, /terakhir|zona|jarak/);
    const cSl = findCol(headers, /stop loss|^sl\b/, /jarak/);
    // Hanya kolom "Jarak SL"; "Jarak dari Harga Terakhir" (tabel audit) BUKAN jarak SL
    const cJarak = findCol(headers, /jarak.*sl|sl.*jarak/);
    const auditTable = cJarak < 0;
    const cLot = findCol(headers, /\blot\b/);
    const cRisk = findCol(headers, /risiko/);
    const cName = 0;

    let j = i + 2;
    const isTarget = cLot >= 0 && cRisk >= 0 && cSl >= 0 && cEntry >= 0;
    if (!isTarget) {
      i = j - 1;
      continue;
    }
    tablesChecked++;

    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const cells = splitRow(lines[j]);
      if (cells.length <= Math.max(cLot, cRisk, cSl, cEntry, cJarak)) continue;
      const name = (cells[cName] || 'Order').replace(/\*+/g, '').trim();

      let lot = firstNumber(cells[cLot]);
      let dist = auditTable ? null : firstNumber(cells[cJarak]);
      const entry = cEntry >= 0 ? firstPrice(cells[cEntry]) : null;
      const sl = cSl >= 0 ? firstPrice(cells[cSl]) : null;
      if (lot == null) continue; // mis. "Sudah terpasang - lihat Audit"

      // 1) Jarak SL harus = |Entry - SL|
      if (entry != null && sl != null) {
        const real = Math.abs(entry - sl);
        if (auditTable) {
          dist = real; // order terpasang: hanya hitung ulang risiko, tidak mengubah lot user
        } else if (dist == null || Math.abs(real - dist) > 0.05) {
          notes.push(`${name}: Jarak SL dikoreksi ${dist == null ? '-' : money(dist)} -> ${money(real)} (|${entry.toFixed(2)} - ${sl.toFixed(2)}|)`);
          dist = real;
          cells[cJarak] = money(real);
        }
      }
      if (dist == null || dist <= 0) continue;

      // 2) Lot tidak boleh membuat risiko melebihi batas user
      if (!auditTable && maxRiskUsd > 0 && lot * dist * 100 > maxRiskUsd + 0.005) {
        const safe = Math.max(0.01, Math.floor((maxRiskUsd / (dist * 100)) * 100 + 1e-9) / 100);
        if (safe < lot) {
          notes.push(`${name}: Lot diturunkan ${lot.toFixed(2)} -> ${safe.toFixed(2)} agar risiko <= ${money(maxRiskUsd)}`);
          lot = safe;
          cells[cLot] = lot.toFixed(2);
        }
      }

      // 3) Risiko = Lot x Jarak x 100
      const risk = lot * dist * 100;
      const shown = firstNumber(cells[cRisk]);
      if (shown == null || Math.abs(shown - risk) > 0.02) {
        notes.push(`${name}: Risiko dikoreksi ${shown == null ? '-' : money(shown)} -> ${money(risk)} (${lot.toFixed(2)} x ${dist.toFixed(2)} x 100)`);
        cells[cRisk] = money(risk);
      }
      if (maxRiskUsd > 0 && risk > maxRiskUsd + 0.005) {
        notes.push(
          auditTable
            ? `⚠️ ${name}: risiko order terpasang ${money(risk)} melebihi batas ${money(maxRiskUsd)}.`
            : `⚠️ ${name}: lot minimum 0.01 pun berisiko ${money(risk)} (> batas ${money(maxRiskUsd)}). Perkecil jarak SL.`
        );
      }

      lines[j] = `| ${cells.join(' | ')} |`;
    }
    i = j - 1;
  }

  let out = markdown;
  if (tablesChecked) {
    out = lines.join('\n');
    const head = notes.length
      ? `> 🧮 **Verifikasi risiko otomatis** (Risiko = Lot × Jarak SL × 100) mengoreksi angka AI:\n${notes.map((n) => `> - ${n}`).join('\n')}`
      : '> 🧮 **Verifikasi risiko otomatis:** semua angka Risiko ($) sudah sesuai rumus Lot × Jarak SL × 100.';
    out = `${out.trimEnd()}\n\n${head}\n`;
  }
  return { markdown: out, notes, tablesChecked };
}
