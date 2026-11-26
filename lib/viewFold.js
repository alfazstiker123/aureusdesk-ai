// Tampilan ringkas: memecah markdown hasil analisa menjadi potongan "tampil" dan "lipat".
// MURNI UNTUK TAMPILAN. Markdown tersimpan, riwayat, PDF, dan semua validator tidak disentuh;
// potongan lipat berisi teks ASLI (tidak diubah), hanya disembunyikan sampai diketuk.
// Peringatan keselamatan (OVER RISK, lot tidak valid, order ditolak) tidak pernah dilipat:
// baris order Lot Mode selalu tampil sebagai kartu.

const FENCE = /^\s*```/;
const isQuote = (l) => /^>/.test(l);
const isBlank = (l) => !l.trim();

// Ambil baris berurutan yang berawalan ">" mulai dari i; berhenti sebelum baris yang cocok stopRe.
function quoteEnd(lines, i, stopRe) {
  let j = i;
  while (j < lines.length && isQuote(lines[j]) && !(j > i && stopRe && stopRe.test(lines[j]))) j++;
  return j;
}

/** Parse baris order pada blok LOT MODE → item kartu. */
export function parseLotBlock(rawLines) {
  const lines = rawLines.map((l) => l.replace(/^>\s?/, ''));
  const head = lines.find((l) => /💼\s*\*\*LOT MODE/u.test(l)) || '';
  const hm = /LOT MODE:\s*(MANUAL|AUTOMATIC)\*\*(?:\s*—\s*lot\s*([\d.]+))?/u.exec(head);
  const cap = /\(([^()]*?)\s+per arah\)/.exec(head) || /batas risiko[^$]*(\$[\d,.]+)\s+per arah/.exec(head);
  const mode = hm ? hm[1] : 'AUTOMATIC';
  const items = [];
  const notes = [];
  for (const l of lines) {
    const m = /^-\s+([^:]+):\s+(.*)$/.exec(l.trim());
    if (!m) continue;
    const body = m[2];
    if (/^Lot\s/.test(body)) {
      const lot = /Lot\s+([\d.]+)/.exec(body);
      const entry = /Entry\s+([\d.,]+)/.exec(body);
      const sl = /SL\s+([\d.,]+)/.exec(body);
      const risk = /Risiko\s+(\$[\d,.]+)(?:\s*\(([\d.]+%)[^)]*\))?/.exec(body);
      const bad = /OVER RISK|TIDAK VALID|UNAVAILABLE|PERKIRAAN|JANGAN dipakai/i.test(body);
      const status = (body.split('·').map((s) => s.trim()).filter(Boolean).filter((s) => /VALID|OVER|RISIKO|UNAVAILABLE|PERKIRAAN|JANGAN/i.test(s) && !/^Risiko\s+\$/.test(s) && !/^batas\s/i.test(s))).join(' · ');
      items.push({ name: m[1].trim(), lot: lot ? lot[1] : '-', entry: entry ? entry[1] : '-', sl: sl ? sl[1] : '-', risk: risk ? risk[1] : null, pct: risk && risk[2] ? risk[2] : null, status: status || (bad ? 'PERIKSA' : 'OK'), bad, rejected: false });
    } else if (/⛔/.test(body)) {
      items.push({ name: m[1].trim(), lot: '-', entry: '-', sl: '-', risk: null, pct: null, status: body.replace(/^⛔\s*/, ''), bad: true, rejected: true });
    } else {
      notes.push(`${m[1].trim()}: ${body}`.trim());
    }
  }
  const noteLine = lines.find((l) => /^- /.test(l.trim()) && !/^- [^:]+:\s+(Lot\s|⛔)/.test(l.trim()) && /Tidak ada order/.test(l)) || null;
  return {
    mode,
    lot: hm && hm[2] ? hm[2] : null,
    cap: cap ? cap[1] : null,
    items,
    empty: items.length === 0,
    explain: head.replace(/💼\s*\*\*LOT MODE:[^*]*\*\*\s*—?\s*/u, '').trim(),
    emptyText: noteLine ? noteLine.replace(/^\s*-\s*/, '').trim() : null,
    notes,
    foot: lines.filter((l) => /^_.*_$/.test(l.trim())).map((l) => l.trim().replace(/^_|_$/g, '')).join(' '),
  };
}

/**
 * @returns {Array<{type:'md',text:string}|{type:'fold',kind:string,icon:string,title:string,hint:string,text:string}|{type:'lot',raw:string,card:object}>}
 */
export function foldMarkdown(markdown) {
  const lines = String(markdown || '').split('\n');
  const out = [];
  let buf = [];
  const flush = () => {
    if (buf.length) out.push({ type: 'md', text: buf.join('\n') });
    buf = [];
  };
  const fold = (kind, icon, title, hint, chunk) => {
    flush();
    out.push({ type: 'fold', kind, icon, title, hint, text: chunk.join('\n') });
  };

  let fence = false;
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (FENCE.test(ln)) { fence = !fence; buf.push(ln); i++; continue; }
    if (fence) { buf.push(ln); i++; continue; }

    // Lampiran detail SMC (sangat panjang): lipat sampai akhir
    if (/^#{2,4}\s*Lampiran/i.test(ln)) {
      const title = ln.replace(/^#{2,4}\s*/, '').replace(/\*+/g, '').trim();
      fold('lampiran', '📎', title, 'ketuk untuk membuka', lines.slice(i));
      i = lines.length;
      continue;
    }

    // Catatan sistem
    if (/^>\s*\*\*Catatan sistem\*\*/.test(ln)) {
      const j = quoteEnd(lines, i);
      const chunk = lines.slice(i, j);
      const n = chunk.filter((l) => /^>\s*-\s/.test(l)).length;
      const w = chunk.filter((l) => /^>\s*-\s*(⚠️|⛔)/u.test(l)).length;
      fold('notes', '📋', 'Catatan sistem', `${n} catatan${w ? ` · ${w} peringatan` : ''}`, chunk);
      i = j;
      continue;
    }

    // Kartu Lot Mode (selalu tampil; hanya penjelasan panjang yang dilipat di dalam kartu)
    if (/^>\s*💼\s*\*\*LOT MODE/u.test(ln)) {
      const j = quoteEnd(lines, i);
      const raw = lines.slice(i, j);
      flush();
      out.push({ type: 'lot', raw: raw.join('\n'), card: parseLotBlock(raw) });
      i = j;
      continue;
    }

    // Detail bias & keputusan (sudah tampil sebagai kartu di atas hasil) → lipat
    if (/^\*\*BIAS UTAMA/.test(ln) || /^>\s*🧭\s*\*\*BIAS\*\*/u.test(ln) || /^>\s*(🎯|⛔|⚠️|⏳)\s*\*\*KEPUTUSAN SERVER/u.test(ln)) {
      const stop = /^>\s*💼\s*\*\*LOT MODE/u;
      let j = /^\*\*BIAS UTAMA/.test(ln) ? i + 1 : quoteEnd(lines, i, stop);
      // lanjutkan selama baris berikutnya (melewati baris kosong) masih bagian kelompok yang sama
      for (;;) {
        let k = j;
        while (k < lines.length && isBlank(lines[k])) k++;
        const nx = lines[k] || '';
        if (/^\*\*BIAS UTAMA/.test(nx)) { j = k + 1; continue; }
        if ((/^>\s*🧭\s*\*\*BIAS\*\*/u.test(nx) || /^>\s*(🎯|⛔|⚠️|⏳)\s*\*\*KEPUTUSAN SERVER/u.test(nx)) && !stop.test(nx)) { j = quoteEnd(lines, k, stop); continue; }
        // blok ">" kosong penyambung menuju LOT MODE: biarkan kartu Lot Mode memprosesnya
        break;
      }
      const chunk = lines.slice(i, j);
      const km = /KEPUTUSAN SERVER\s*—\s*([^:*]+):/u.exec(chunk.join('\n'));
      fold('bias', '🧭', 'Detail bias & keputusan server', km ? km[1].trim() : 'ketuk untuk membuka', chunk);
      i = j;
      // buang sisa ">" kosong penyambung sebelum LOT MODE agar kartu tidak terdorong
      while (i < lines.length && lines[i].trim() === '>' && /^>\s*💼/u.test(lines[i + 1] || '')) i++;
      continue;
    }

    // Tabel multi-timeframe: lipat bersama kepala sumbernya; baris "Alignment" tetap tampil
    if (/^>\s*📡\s*\*\*V2/u.test(ln)) {
      let j = i;
      while (j < lines.length && (isBlank(lines[j]) || isQuote(lines[j]) || /^\s*\|/.test(lines[j]))) j++;
      // jangan telan baris kosong penutup
      let e = j;
      while (e > i && isBlank(lines[e - 1])) e--;
      const rows = lines.slice(i, e).filter((l) => /^\s*\|/.test(l)).length - 2;
      fold('tf', '📡', 'Struktur multi-timeframe', rows > 0 ? `${rows} timeframe` : 'ketuk untuk membuka', lines.slice(i, e));
      i = e;
      continue;
    }

    // Rincian Hitung Risiko
    if (/^\*\*Rincian Hitung Risiko\*\*/.test(ln)) {
      let j = i + 1;
      while (j < lines.length && (/^\s*[-*]\s/.test(lines[j]))) j++;
      const n = j - i - 1;
      fold('rincian', '🧮', 'Rincian hitung risiko', `${n} order`, lines.slice(i, j));
      i = j;
      continue;
    }

    // Verifikasi risiko otomatis
    if (/^>\s*🧮\s*\*\*Verifikasi risiko otomatis/u.test(ln)) {
      const j = quoteEnd(lines, i);
      const chunk = lines.slice(i, j);
      const n = chunk.filter((l) => /^>\s*-\s/.test(l)).length;
      fold('verif', '🧮', 'Verifikasi risiko otomatis', `${n} catatan`, chunk);
      i = j;
      continue;
    }

    buf.push(ln);
    i++;
  }
  flush();
  return out.filter((s) => s.type !== 'md' || s.text.trim());
}
