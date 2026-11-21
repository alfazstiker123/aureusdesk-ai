// Laporan PDF (A4, tema gelap) dari hasil analisa Markdown. jsPDF diberikan dari luar
// (dimuat di browser), sehingga modul ini murni logika tata letak dan bisa dites dengan tiruan.
import { splitSections } from './sections.js';
import { splitTables, segmentSection, parseMeta, cleanCell } from './zoneParse.js';
import { fixInlineTables } from './markdownFix.js';

const PW = 210;
const PH = 297;
const M = 12;
const CW = PW - M * 2;

export function pdfText(str) {
  return String(str ?? '')
    .replace(/[–—−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/→/g, '->')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[•●]/g, '-')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
    .replace(/[^\x20-\x7E -ÿ\n]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

const stripMd = (s) =>
  pdfText(
    String(s)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\*\*|__|`/g, '')
      .replace(/(^|\s)\*(?=\S)|(?<=\S)\*(\s|$)/g, '$1$2')
  );

// Ubah teks Markdown (non-tabel) menjadi daftar {kind, text}
function textBlocks(md) {
  const out = [];
  for (const raw of String(md).split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    if (/^#{1,6}\s/.test(t)) continue; // judul bagian digambar terpisah
    const h = /^\*\*([^*]+)\*\*:?$/.exec(t);
    if (h) {
      out.push({ kind: 'bold', text: stripMd(h[1]) });
      continue;
    }
    const q = t.replace(/^>\s?/, '');
    const b = /^([-*•])\s+(.*)$/.exec(q);
    out.push(b ? { kind: 'bullet', text: stripMd(b[2]) } : { kind: 'p', text: stripMd(q) });
  }
  return out.filter((x) => x.text);
}

export function buildPdf(jsPDF, { markdown = '', pair = '', createdAt = '', chartDataUrl = '', maxRiskUsd = '' }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const md = fixInlineTables(markdown);
  const meta = parseMeta(md);
  const pairId = meta.pair || pair || '';
  let y = M;

  const bg = () => {
    doc.setFillColor(7, 13, 25);
    doc.rect(0, 0, PW, PH, 'F');
  };
  const need = (h) => {
    if (y + h > PH - 14) {
      doc.addPage();
      bg();
      y = M + 2;
    }
  };
  const heading = (title) => {
    need(12);
    doc.setFillColor(16, 30, 54);
    doc.roundedRect(M, y, CW, 7.5, 1.5, 1.5, 'F');
    doc.setFillColor(70, 195, 255);
    doc.rect(M, y, 2, 7.5, 'F');
    doc.setTextColor(70, 195, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(pdfText(title), M + 5, y + 5.1);
    y += 10;
  };
  const lines = (text, width, size) => {
    doc.setFontSize(size);
    return doc.splitTextToSize(pdfText(text), width);
  };

  // Baris teks bebas (paragraf, bullet, subjudul) dengan paginasi per baris
  const flow = (blocks) => {
    for (const b of blocks) {
      const bold = b.kind === 'bold';
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      const size = bold ? 8.8 : 8.2;
      const ls = lines((b.kind === 'bullet' ? '- ' : '') + b.text, CW - 6, size);
      const lh = 4.1;
      for (let i = 0; i < ls.length; i += 1) {
        need(lh + 1);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        doc.setTextColor(...(bold ? [70, 195, 255] : [215, 225, 240]));
        doc.text(ls[i], M + 3 + (b.kind === 'bullet' && i > 0 ? 3 : 0), y + 3.2);
        y += lh;
      }
      y += bold ? 0.8 : 1.2;
    }
  };

  // Tabel generik -> baris "kolom1 | kolom2 | ..." dengan baris judul tebal
  const genericTable = (t) => {
    const head = t.headers.map(cleanCell).join('  |  ');
    flow([{ kind: 'bold', text: head }]);
    for (const r of t.rows) {
      const row = r.map(cleanCell).join('  |  ');
      flow([{ kind: 'p', text: row }]);
    }
    y += 1;
  };

  const renderGeneric = (body) => {
    for (const seg of splitTables(body)) {
      if (seg.type === 'table') genericTable(seg);
      else flow(textBlocks(seg.text));
    }
  };

  const colFor = (side) => (side === 'BUY' ? [34, 197, 94] : [244, 63, 94]);

  const execCards = (rows) => {
    for (const r of rows) {
      const col = colFor(r.side);
      if (!r.valid) {
        need(11);
        doc.setFillColor(11, 19, 36);
        doc.setDrawColor(26, 42, 72);
        doc.roundedRect(M, y, CW, 9, 1.5, 1.5, 'FD');
        doc.setFillColor(...col);
        doc.rect(M, y, 1.8, 9, 'F');
        doc.setTextColor(...col);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.2);
        doc.text(pdfText(r.title).slice(0, 70), M + 4.5, y + 5.8);
        doc.setTextColor(148, 163, 184);
        doc.setFont('helvetica', 'normal');
        doc.text('Tidak ada level valid', PW - M - 4, y + 5.8, { align: 'right' });
        y += 10.5;
        continue;
      }
      doc.setFont('helvetica', 'normal');
      const conf = lines(`Konfirmasi: ${r.confirmation}`, CW - 9, 7.8);
      const bh = 21 + conf.length * 3.9;
      need(bh + 3);
      doc.setFillColor(12, 22, 42);
      doc.setDrawColor(32, 52, 90);
      doc.roundedRect(M, y, CW, bh, 2, 2, 'FD');
      doc.setFillColor(...col);
      doc.rect(M, y, 2, bh, 'F');
      doc.setTextColor(...col);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(pdfText(r.title).slice(0, 80), M + 5, y + 5.5);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8.2);
      doc.text(pdfText(`Entry: ${r.entryZone}   |   SL: ${r.sl}   |   TP1: ${r.tp1}   |   TP2: ${r.tp2}`), M + 5, y + 11.5);
      doc.setTextColor(190, 210, 235);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      doc.text(conf, M + 5, y + 16.5);
      y += bh + 2.8;
    }
  };

  const pendingCards = (rows) => {
    for (const r of rows) {
      const col = colFor(r.side);
      if (!r.valid) {
        need(10);
        doc.setFillColor(11, 19, 36);
        doc.roundedRect(M, y, CW, 8.5, 1.5, 1.5, 'F');
        doc.setFillColor(...col);
        doc.rect(M, y, 1.8, 8.5, 'F');
        doc.setTextColor(...col);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text(pdfText(r.title).slice(0, 70), M + 4.5, y + 5.5);
        doc.setTextColor(148, 163, 184);
        doc.setFont('helvetica', 'normal');
        doc.text(pdfText(r.note || 'Tidak Ada Setup (Tunggu)').slice(0, 40), PW - M - 4, y + 5.5, { align: 'right' });
        y += 10;
        continue;
      }
      const exp = lines(`Berakhir: ${r.expiry}`, CW - 10, 7.6);
      const bh = 17.5 + exp.length * 3.8;
      need(bh + 3);
      doc.setFillColor(12, 22, 42);
      doc.setDrawColor(32, 52, 90);
      doc.roundedRect(M, y, CW, bh, 2, 2, 'FD');
      doc.setFillColor(...col);
      doc.rect(M, y, 2, bh, 'F');
      doc.setTextColor(...col);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.8);
      doc.text(pdfText(r.title).slice(0, 80), M + 5, y + 5.5);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.text(pdfText(`Entry: ${r.entry}  |  SL: ${r.sl}  |  TP: ${r.tp}  |  Lot: ${r.lot}`), M + 5, y + 10.8);
      doc.setTextColor(148, 163, 184);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.6);
      doc.text(pdfText(`Jarak SL: ${r.slDist}  |  Risiko: ${r.risk}  |  R:R: ${r.rr}`), M + 5, y + 15.4);
      doc.text(exp, M + 5, y + 19.2);
      y += bh + 2.5;
    }
  };

  // ----- Halaman 1: banner
  bg();
  doc.setFillColor(12, 24, 46);
  doc.setDrawColor(40, 75, 125);
  doc.roundedRect(M, y, CW, 24, 3, 3, 'FD');
  doc.setFillColor(245, 196, 81);
  doc.roundedRect(M + 4, y + 4, 15, 15, 2.5, 2.5, 'F');
  doc.setFillColor(9, 15, 29);
  doc.roundedRect(M + 4.8, y + 4.8, 13.4, 13.4, 2, 2, 'F');
  doc.setTextColor(245, 196, 81);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('A', M + 11.5, y + 13.5, { align: 'center' });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text(`AureusDesk AI  |  ${pdfText(pairId) || '-'}`, M + 23, y + 10.5);
  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const when = createdAt
    ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(createdAt))
    : '';
  doc.text(pdfText(`Laporan Analisa SMC Multi-Timeframe  |  ${when} WIB`), M + 23, y + 16.5);
  const biasWord = (meta.bias || 'NETRAL').toUpperCase();
  const bcol = /BULL|BUY/.test(biasWord) && !/BEAR|SELL/.test(biasWord) ? [34, 197, 94] : /BEAR|SELL/.test(biasWord) && !/BULL|BUY/.test(biasWord) ? [244, 63, 94] : [245, 196, 81];
  const biasShort = pdfText(biasWord.split(/\s+-\s+|\s+/)[0] || 'NETRAL');
  doc.setFillColor(...bcol);
  doc.roundedRect(PW - M - 30, y + 6.5, 26, 9, 2, 2, 'F');
  doc.setTextColor(7, 13, 25);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(biasShort, PW - M - 17, y + 12.2, { align: 'center' });
  y += 28;

  // KPI
  const allSegs = segmentSection(md);
  const exec = allSegs.find((s) => s.type === 'exec')?.rows || [];
  const pend = allSegs.find((s) => s.type === 'pending')?.rows || [];
  const kpis = [
    ['HARGA TERAKHIR', pdfText(meta.last || '-'), [245, 196, 81]],
    ['BIAS UTAMA', biasShort, bcol],
    ['ZONA AKTIF', `${exec.filter((r) => r.valid).length} / ${exec.length || '-'}`, [70, 195, 255]],
    ['ORDER BARU', `${pend.filter((r) => r.valid).length} / ${pend.length || '-'}${maxRiskUsd ? ` (maks $${maxRiskUsd})` : ''}`, [52, 211, 153]],
  ];
  const kw = (CW - 6) / 4;
  kpis.forEach(([lbl, val, col], i) => {
    const kx = M + i * (kw + 2);
    doc.setFillColor(12, 21, 40);
    doc.setDrawColor(30, 49, 84);
    doc.roundedRect(kx, y, kw, 14, 2, 2, 'FD');
    doc.setTextColor(148, 163, 184);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text(lbl, kx + 3, y + 5);
    doc.setTextColor(...col);
    doc.setFontSize(8.6);
    doc.text(String(val).slice(0, 22), kx + 3, y + 11);
  });
  y += 18;

  // Peta zona
  if (chartDataUrl) {
    const imgH = (CW * 620) / 1200;
    need(imgH + 6);
    doc.setDrawColor(40, 75, 125);
    doc.roundedRect(M, y, CW, imgH, 2, 2, 'S');
    doc.addImage(chartDataUrl, 'PNG', M + 0.5, y + 0.5, CW - 1, imgH - 1);
    y += imgH + 6;
  }

  // ----- Isi
  const parts = splitSections(md);
  if (!parts) {
    renderGeneric(md);
  } else {
    const intro = parts.intro
      .split('\n')
      .filter((l) => !/^\s*\*\*(BIAS UTAMA|PAIR|HARGA TERAKHIR|ATR)/i.test(l))
      .join('\n');
    if (intro.trim()) renderGeneric(intro);
    y += 2;
    for (const s of parts.sections) {
      heading(`${s.n}. ${s.title}`);
      if (s.n === 3 || s.n === 4) {
        for (const seg of segmentSection(s.body)) {
          if (seg.type === 'exec') execCards(seg.rows);
          else if (seg.type === 'pending') pendingCards(seg.rows);
          else if (seg.type === 'table') genericTable(seg);
          else flow(textBlocks(seg.text));
        }
      } else {
        renderGeneric(s.body);
      }
      y += 2;
    }
  }

  // Footer
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p += 1) {
    doc.setPage(p);
    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('AureusDesk AI - Analisa SMC (bukan nasihat keuangan; cek ulang level di platform Anda)', M, PH - 6);
    doc.text(`Hal ${p} / ${total}`, PW - M, PH - 6, { align: 'right' });
  }
  return { doc, filename: `AureusDesk_${pdfText(pairId) || 'SMC'}_Laporan.pdf` };
}

// Muat jsPDF dari CDN sekali saja (browser)
let loading = null;
export function loadJsPdf() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Hanya di browser'));
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.async = true;
    s.onload = () => (window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF tidak termuat')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Gagal memuat pustaka PDF (cek koneksi internet)'));
    };
    document.head.appendChild(s);
  });
  return loading;
}
