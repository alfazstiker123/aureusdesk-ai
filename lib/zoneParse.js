// Mengubah tabel Markdown hasil analisa (Bagian 3 & 4B) menjadi data terstruktur
// untuk kartu zona dan peta zona. Murni teks -> data; tidak mengubah isi hasil analisa.

const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function splitCells(line) {
  let t = String(line).trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

export function cleanCell(s = '') {
  return String(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pecah markdown menjadi segmen teks dan tabel. Tabel = baris berawalan "|" + baris pemisah.
export function splitTables(markdown = '') {
  const lines = String(markdown).split('\n');
  const out = [];
  let buf = [];
  let i = 0;
  const flush = () => {
    if (buf.length) out.push({ type: 'text', text: buf.join('\n') });
    buf = [];
  };
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.trim().startsWith('|') && i + 1 < lines.length && SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith('|')) j++;
      flush();
      out.push({
        type: 'table',
        headers: splitCells(ln).map(cleanCell),
        rows: lines.slice(i + 2, j).map((r) => splitCells(r)),
        raw: lines.slice(i, j).join('\n'),
      });
      i = j;
    } else {
      buf.push(ln);
      i++;
    }
  }
  flush();
  return out;
}

export function tableKind(headers = []) {
  const h = headers.join(' | ').toLowerCase();
  if (h.includes('zona entry') && h.includes('stop loss') && h.includes('take profit 1')) return 'exec';
  if (h.includes('harga entry') && h.includes('lot aman') && h.includes('waktu berakhir')) return 'pending';
  return null;
}

const NUM = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

// Angka harga dari sel; koma ribuan dibuang. Angka kecil tanpa desimal (mis. "1" pada "Zona 1") diabaikan.
export function priceNumbers(text = '') {
  return (String(text).match(NUM) || [])
    .filter((m) => m.includes('.') || m.includes(',') || m.length >= 4)
    .map((m) => ({ raw: m.replace(/,/g, ''), val: Number(m.replace(/,/g, '')) }))
    .filter((n) => Number.isFinite(n.val));
}

function col(headers, row, re) {
  const i = headers.findIndex((h) => re.test(h.toLowerCase()));
  return i >= 0 ? cleanCell(row[i] ?? '') : '';
}

export function sideOf(text = '') {
  const t = text.toLowerCase();
  const b = t.search(/\bbuy\b/);
  const s = t.search(/\bsell\b/);
  if (b >= 0 && (s < 0 || b < s)) return 'BUY';
  if (s >= 0) return 'SELL';
  return null;
}

export function zoneNum(text = '') {
  const m = /zona\s*(\d)/i.exec(text);
  return m ? Number(m[1]) : null;
}

export function parseExecRows(table) {
  const { headers, rows } = table;
  return rows
    .map((row) => {
      const title = col(headers, row, /zona & strategi|zona &|strategi/);
      const entryZone = col(headers, row, /zona entry/);
      const sl = col(headers, row, /stop loss/);
      const tp1 = col(headers, row, /take profit 1|tp1/);
      const tp2 = col(headers, row, /take profit 2|tp2/);
      const confirmation = col(headers, row, /konfirmasi|syarat/);
      const side = sideOf(title);
      const nums = priceNumbers(entryZone);
      const valid = !!side && nums.length > 0 && !/tidak ada|tunggu/i.test(entryZone);
      const lows = nums.map((n) => n.val);
      return {
        side,
        zone: zoneNum(title),
        title,
        valid,
        entryZone,
        entryRaw: nums.slice(0, 2).map((n) => n.raw),
        low: lows.length ? Math.min(...lows.slice(0, 2)) : NaN,
        high: lows.length ? Math.max(...lows.slice(0, 2)) : NaN,
        sl,
        tp1,
        tp2,
        slVal: priceNumbers(sl)[0]?.val ?? NaN,
        tp1Val: priceNumbers(tp1)[0]?.val ?? NaN,
        tp2Val: priceNumbers(tp2)[0]?.val ?? NaN,
        confirmation,
      };
    })
    .filter((r) => r.side);
}

export function parsePendingRows(table) {
  const { headers, rows } = table;
  return rows
    .map((row) => {
      const title = col(headers, row, /^order/);
      const entry = col(headers, row, /harga entry/);
      const side = sideOf(title);
      return {
        side,
        title,
        entry,
        valid: !!side && priceNumbers(entry).length > 0,
        note: priceNumbers(entry).length ? '' : entry,
        sl: col(headers, row, /stop loss/),
        tp: col(headers, row, /take profit/),
        slDist: col(headers, row, /jarak sl/),
        lot: col(headers, row, /lot aman/),
        risk: col(headers, row, /risiko/),
        rr: col(headers, row, /r:r/),
        expiry: col(headers, row, /waktu berakhir/),
      };
    })
    .filter((r) => r.side);
}

// Metadata baris awal: BIAS UTAMA, PAIR, HARGA TERAKHIR, ATR
export function parseMeta(markdown = '') {
  const grab = (re) => {
    const m = re.exec(markdown);
    return m ? cleanCell(m[1]) : '';
  };
  const bias = grab(/BIAS UTAMA:?\**\s*:?\s*([^\n]+)/i);
  const pair = grab(/\*\*PAIR:?\**:?\s*([A-Z0-9]+)/i) || grab(/PAIR:\s*\**\s*([A-Z0-9]+)/i);
  const last = grab(/HARGA TERAKHIR:?\**:?\s*([\d.,]+)/i);
  const atr = grab(/\*\*ATR:?\**:?\s*([^\n]+)/i);
  const price = last ? Number(last.replace(/,/g, '')) : NaN;
  return { bias, pair, last, price: Number.isFinite(price) ? price : NaN, atr };
}

// Bagi isi satu bagian menjadi segmen, menandai tabel yang bisa dijadikan kartu.
export function segmentSection(body = '') {
  return splitTables(body).map((seg) => {
    if (seg.type !== 'table') return seg;
    const kind = tableKind(seg.headers);
    if (kind === 'exec') {
      const rows = parseExecRows(seg);
      return rows.length ? { type: 'exec', rows, raw: seg.raw } : seg;
    }
    if (kind === 'pending') {
      const rows = parsePendingRows(seg);
      return rows.length ? { type: 'pending', rows, raw: seg.raw } : seg;
    }
    return seg;
  });
}
