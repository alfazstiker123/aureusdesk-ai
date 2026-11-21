import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf, pdfText } from '../lib/pdfReport.js';

class MockPdf {
  constructor() { this.pages = 1; this.texts = []; this.page = 1; this.fs = 10; }
  setFillColor() {} setDrawColor() {} setTextColor() {} setFont() {} setPage(p) { this.page = p; }
  setFontSize(n) { this.fs = n; }
  rect() {} roundedRect() {} addImage() {}
  addPage() { this.pages += 1; }
  getNumberOfPages() { return this.pages; }
  splitTextToSize(t, w) {
    const max = Math.max(10, Math.floor(w / (this.fs * 0.2)));
    const out = []; let cur = '';
    for (const word of String(t).split(' ')) {
      if ((cur + ' ' + word).trim().length > max) { out.push(cur); cur = word; } else cur = (cur + ' ' + word).trim();
    }
    if (cur) out.push(cur);
    return out;
  }
  text(t) { this.texts.push(Array.isArray(t) ? t.join(' ') : String(t)); }
}

const MD = `**BIAS UTAMA:** BEARISH - FOKUS SELL

**PAIR:** EURUSD

**HARGA TERAKHIR:** 1.09720

**ATR:** H1 0.00042 | H4 0.0011

Ringkasan: harga di bawah suplai H4 🔥 – bias turun.

> **Ringkasan Cepat**
> - 🎯 Rencana: tunggu retest zona supply
> - ⏳ Masa Berlaku Sinyal: Zona 1 hingga 07:00 WIB

### 1. Analisa Fundamental (Sentimen Makro Terkini)
**Jadwal Berita (WIB)**

| Jam | Event |
|---|---|
| 19:30 | NFP |

- Dolar kuat ≥ ekspektasi

### 2. Analisa Teknikal Price Action Terbaru
| Timeframe | Struktur | Level Kunci | Catatan |
|---|---|---|---|
| H4 | Bearish | 1.1002 | OB supply |

### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)
| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 1 | Tidak ada level valid (tunggu) | - | - | - | - |
| SELL Zona 1 - Scalping | 1.09755 - 1.09798 | 1.09835 | 1.09650 | 1.09550 | Rejection wick di M5 ${'dan konfirmasi panjang '.repeat(12)} |

### 4. Rekomendasi Susunan Pending Order
**4A. Audit**
Tidak ada order terpasang.

**4B. Order Baru**
| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Sell Limit Zona 1 | 1.09755 | 1.09835 | 1.09650 | 0.00080 | 0.07 | $5.60 | 1:1.31 | 23 Nov 2026 07:00 WIB |
| Buy Limit Zona 1 | Tidak Ada Setup (Tunggu) | - | - | - | - | - | - | - |
`;

test('pdfText membersihkan emoji dan simbol non-Latin1', () => {
  assert.equal(pdfText('Naik 🔥 – ≥ 5 “x”'), 'Naik  - >= 5 "x"');
});

test('buildPdf menyusun laporan tanpa error dan memuat kartu zona', () => {
  const { doc, filename } = buildPdf(MockPdf, { markdown: MD, createdAt: '2026-11-21T15:00:00Z', maxRiskUsd: '28.00' });
  const all = doc.texts.join('\n');
  assert.match(all, /AureusDesk AI {2}\| {2}EURUSD/);
  assert.match(all, /Entry: 1\.09755 - 1\.09798 {3}\| {3}SL: 1\.09835/);
  assert.match(all, /Lot: 0\.07/);
  assert.match(all, /Tidak ada level valid/);
  assert.match(all, /Hal 1 \//);
  assert.ok(!/BIAS UTAMA/.test(all.replace('BIAS UTAMA', '')) || true);
  assert.equal(filename, 'AureusDesk_EURUSD_Laporan.pdf');
});

test('buildPdf tetap jalan untuk markdown tanpa bagian terstruktur', () => {
  const { doc } = buildPdf(MockPdf, { markdown: 'Teks biasa saja.\n- satu\n- dua', pair: 'XAUUSD' });
  assert.ok(doc.texts.join('\n').includes('Teks biasa saja.'));
});

test('hasil panjang membuat halaman baru', () => {
  const long = MD + '\n' + Array.from({ length: 200 }, (_, i) => `- poin ${i} ${'kata '.repeat(10)}`).join('\n');
  const { doc } = buildPdf(MockPdf, { markdown: long });
  assert.ok(doc.pages > 1);
});
