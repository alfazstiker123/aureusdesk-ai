import test from 'node:test';
import assert from 'node:assert/strict';
import { foldMarkdown, parseLotBlock } from '../lib/viewFold.js';

// Fixture mengikuti struktur analisa nyata (XAUUSD MANUAL 0.01, deploy e78efd5).
const MD = `> **Catatan sistem**
> - ⚠️ NARASI AI TIDAK TERSEDIA — TABEL MESIN TETAP DITAMPILKAN.
> - 💱 Harga acuan zona: Bid 3459.02 / Ask 3459.38.
> - ✅ Lot/risiko dihitung dari spesifikasi broker (tickValue 1 / tickSize 0.01, akun USD).
> - 🔎 Jejak audit: konfigurasi #3fb74f740b04 · LOT MANUAL 0.01 · deploy e78efd5.

> 📡 **V2 — OHLC MT4 + SMC**
> Sumber: MT4 EA. Cocokkan harga dengan chart broker.

| TF | Bias | ATR |
|---|---|---|
| M5 | BEARISH | 10.13 |
| H4 | BEARISH | 42.27 |

Alignment H4/H1/M15: **SELARAS** (H4 BEARISH, H1 BEARISH, M15 BEARISH)

---

**BIAS UTAMA: BEARISH**

> 🧭 **BIAS** | Model Gemini: BEARISH | Struktur H4 mesin: BEARISH | Final server: BEARISH
> ✅ Selaras: Model dan struktur H4 mesin sama-sama BEARISH.

> 🎯 **KEPUTUSAN SERVER — SETUP UTAMA SELL Zona 2:** Setup utama searah bias BEARISH: SELL Zona 2 (Intraday) 3494.24–3503.39, SL 3512.66.
>
> 💼 **LOT MODE: MANUAL** — lot 0.01 berasal dari INPUT ANDA, bukan kalkulasi sistem. Lot tidak dikurangi atau dinaikkan otomatis; batas risiko sama dengan mode otomatis ($400.00 per arah).
> - Sell Z2: Lot 0.01 (MANUAL) · Entry 3494.24 · SL 3512.66 · Risiko $18.42 (0.09% dari saldo $20,000) · LOT VALID · DALAM BATAS RISIKO · batas $400.00
> _Berlaku untuk analisis ini. Ubah di ⚙️ Pengaturan → Position Sizing._
**PAIR:** XAUUSD
**HARGA TERAKHIR:** 3459.02

### 3. Pemetaan Setup Eksekusi Langsung
| Zona | Entry |
| --- | --- |
| SELL Zona 2 | 3494.24 - 3503.39 |

### 4. Rekomendasi Susunan Pending Order

| Order | Harga Entry | Lot Aman |
| --- | --- | --- |
| Sell Limit Zona 2 | 3494.24 | 0.01 |

**Rincian Hitung Risiko**
- Sell Limit Zona 2 (Intraday): 0.01 lot x 18.42 x 100 (tickValue 1 / tickSize 0.01, USD) = $18.42

**Aturan Pasang (batas risiko $400.00 per arah):**

- SELL: Sell Z2 = $18.42 (di bawah batas $400.00 per arah).
- ✅ Pasang hanya order berstatus VALIDATED ORDER.

> 🧮 **Verifikasi risiko otomatis** (XAUUSD) catatan:
> - ℹ️ LOT MODE MANUAL: lot 0.01 berasal dari input pengguna.
> - ℹ️ Total risiko per arah: BUY $0.00 | SELL $18.42.

---

### Lampiran: Detail SMC dari candle (referensi)

\`\`\`text
KANDIDAT ZONA DARI SMC
- SELL Zona 2 (Intraday): entry 3494.24–3503.39
# baris yang terlihat seperti heading di dalam kode
\`\`\`
`;

const segs = foldMarkdown(MD);
const folds = (k) => segs.filter((s) => s.type === 'fold' && s.kind === k);
const lot = segs.find((s) => s.type === 'lot');

test('catatan sistem dilipat dengan hitungan catatan dan peringatan', () => {
  const f = folds('notes')[0];
  assert.ok(f);
  assert.match(f.hint, /4 catatan · 1 peringatan/);
  assert.ok(f.text.includes('NARASI AI TIDAK TERSEDIA'));
});

test('kartu Lot Mode: mode, lot, batas, order, risiko, status', () => {
  assert.ok(lot);
  const c = lot.card;
  assert.equal(c.mode, 'MANUAL');
  assert.equal(c.lot, '0.01');
  assert.equal(c.cap, '$400.00');
  assert.equal(c.items.length, 1);
  assert.deepEqual([c.items[0].name, c.items[0].lot, c.items[0].entry, c.items[0].sl, c.items[0].risk, c.items[0].pct, c.items[0].bad], ['Sell Z2', '0.01', '3494.24', '3512.66', '$18.42', '0.09%', false]);
  assert.match(c.items[0].status, /LOT VALID/);
});

test('bias + keputusan dilipat, ringkasannya memuat keputusan; kartu Lot tidak ikut terlipat', () => {
  const f = folds('bias');
  assert.equal(f.length, 1, 'bias UTAMA, 🧭 BIAS, dan KEPUTUSAN menyatu dalam satu lipatan');
  assert.equal(f[0].hint, 'SETUP UTAMA SELL Zona 2');
  assert.ok(f[0].text.includes('BIAS UTAMA') && f[0].text.includes('Final server: BEARISH') && f[0].text.includes('SL 3512.66'));
  assert.ok(!f[0].text.includes('LOT MODE'));
});

test('tabel multi-timeframe dilipat, baris Alignment tetap tampil', () => {
  const f = folds('tf')[0];
  assert.ok(f && f.text.includes('| M5 | BEARISH'));
  assert.equal(f.hint, '2 timeframe');
  const shown = segs.filter((s) => s.type === 'md').map((s) => s.text).join('\n');
  assert.ok(shown.includes('Alignment H4/H1/M15: **SELARAS**'));
});

test('Rincian Hitung Risiko dilipat utuh; Aturan Pasang jadi kartu hasil akhir', () => {
  const f = folds('rincian')[0];
  assert.equal(f.hint, '1 order');
  assert.ok(f.text.includes('0.01 lot x 18.42 x 100') && f.text.includes('= $18.42'));
  const r = segs.find((s) => s.type === 'rules');
  assert.ok(r);
  assert.equal(r.cap, '$400.00');
  assert.equal(r.results[0].side, 'SELL');
  assert.ok(r.tips.some((x) => x.includes('VALIDATED ORDER')));
});

test('Lampiran dilipat sampai akhir, termasuk blok kode; heading di dalam kode tidak memecah', () => {
  const f = folds('lampiran');
  assert.equal(f.length, 1);
  assert.ok(f[0].text.includes('KANDIDAT ZONA DARI SMC') && f[0].text.includes('# baris yang terlihat seperti heading'));
  assert.equal(segs[segs.length - 1], f[0]);
});

test('verifikasi risiko otomatis dilipat', () => {
  assert.equal(folds('verif')[0].hint, '2 catatan');
});

test('tidak ada baris yang hilang: setiap baris asli muncul di tampil/lipat/kartu', () => {
  const kept = new Set();
  for (const s of segs) for (const l of (s.type === 'md' || s.type === 'fold' ? s.text : s.raw).split('\n')) kept.add(l);
  const lost = MD.split('\n').filter((l) => l.trim() && l.trim() !== '>' && !kept.has(l));
  assert.deepEqual(lost, []);
});

test('tabel order dan heading Bagian 3/4 tetap sebagai markdown yang tampil', () => {
  const shown = segs.filter((s) => s.type === 'md').map((s) => s.text).join('\n');
  assert.ok(shown.includes('### 3.') && shown.includes('### 4.') && shown.includes('| Sell Limit Zona 2 | 3494.24 | 0.01 |'));
});

test('OVER RISK dan order ditolak SELALU tampil sebagai kartu bermerah, tidak pernah dilipat', () => {
  const md = `> 💼 **LOT MODE: MANUAL** — lot 1.00 berasal dari INPUT ANDA (…$400.00 per arah).
> - Sell Z2: ⛔ OVER RISK — lot 1.00 berisiko $1,842.00 (9.21% dari saldo $20,000) > batas $400.00 (lebih $1,442.00) · order TIDAK DIPASANG (lot manual tidak diubah otomatis)
> - Buy Z1: Lot 0.50 (MANUAL) · Entry 1.0 · SL 0.9 · Risiko $5.00 · OVER RISK
> _Berlaku untuk analisis ini._`;
  const r = foldMarkdown(md);
  assert.equal(r.length, 1);
  assert.equal(r[0].type, 'lot');
  const [a, b] = r[0].card.items;
  assert.ok(a.bad && a.rejected && /OVER RISK/.test(a.status));
  assert.ok(b.bad && !b.rejected && /OVER RISK/.test(b.status));
});

test('lot tidak valid dan RISK CALCULATION UNAVAILABLE ditandai bad', () => {
  const c = parseLotBlock([
    '> 💼 **LOT MODE: MANUAL** — lot 0.015 berasal dari INPUT ANDA.',
    '> - Sell Z2: ⛔ LOT TIDAK VALID — kelipatan step · order TIDAK DIPASANG',
    '> - Buy Z2: Lot 0.01 (MANUAL) · Entry 1.2 · SL 1.1 · Risiko tidak tersedia · RISK CALCULATION UNAVAILABLE',
  ]);
  assert.ok(c.items.every((x) => x.bad));
});

test('mode otomatis dan daftar kosong', () => {
  const r = foldMarkdown('> 💼 **LOT MODE: AUTOMATIC** — lot dihitung SISTEM.\n> - Tidak ada order baru yang lolos validator; tidak ada lot yang dipakai.\n> _Berlaku._');
  assert.equal(r[0].card.mode, 'AUTOMATIC');
  assert.ok(r[0].card.empty && /Tidak ada order baru/.test(r[0].card.emptyText));
});

test('markdown lama tanpa blok khusus tidak diubah sama sekali', () => {
  const old = '## Judul\n\nTeks biasa.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
  const r = foldMarkdown(old);
  assert.equal(r.length, 1);
  assert.equal(r[0].type, 'md');
  assert.equal(r[0].text.trimEnd(), old.trimEnd());
});

test('kosong/null aman', () => {
  assert.deepEqual(foldMarkdown(''), []);
  assert.deepEqual(foldMarkdown(null), []);
});

// Struktur nyata EURUSD (06.39 WIB): judul dengan titik dua, blok Ringkasan Cepat, Skenario Batal, Manajemen Posisi.
const REAL = `> **Ringkasan Cepat**
> - 🎯 Rencana: Pantau reaksi harga pada zona Intraday dan tunggu konfirmasi price action.
> - 📍 Level kunci: 1.09752 (Resistance H1) | 1.09640 (Support/FVG H1) | 1.09320 (Demand H4)
> - ⏰ Hindari trading: 16:45 - 17:15 WIB (No-Trade Zone)
> - ⏳ Masa Berlaku Sinyal: Zona 1 valid hingga 08:38 WIB; Zona 2 valid hingga 12:38 WIB; Zona 3 valid hingga Daily Close.

### 1. Analisa Fundamental

- **Tafsir Fundamental:** teks.

### 4. Rekomendasi Susunan Pending Order

**Rincian Hitung Risiko:**
- Buy Limit Zona 2 (Intraday): 0.01 lot x 0.00028 × 100000 (tickValue 1 / tickSize 0.00001, USD) = $0.28 (berada di bawah batas maksimal $150.00).

**Aturan Pasang (batas risiko $150.00 per arah; dihitung ulang server dari order yang lolos validator):**

- Kandidat awal sebelum validator (risiko per order, BUKAN total dan bukan order aktif): Buy Z2 $0.28.
- Dibatalkan validator (tidak dihitung): Sell Z2 (Tidak Ada Target Struktural Valid).
- Lolos validator (total akhir; batas $150.00 per arah):
- SELL: tidak ada order valid (WAIT / NO TRADE).
- BUY: Buy Z2 = $0.28 (di bawah batas $150.00 per arah).
- ✅ Pasang hanya order berstatus VALIDATED ORDER, dan hanya bila syarat konfirmasi Bagian 3 terpenuhi.

**Skenario Batal (Invalidation Level):**
- Buy Zona 2: SL 1.09612 = batas risiko posisi.

**Manajemen Posisi:**
- Pindahkan SL ke Break Even setelah TP1.
- *Ingat:* Kolom waktu kedaluwarsa mengikuti jam server broker.

_Bukan saran keuangan. Selalu gunakan manajemen risiko._
`;

test('struktur nyata: Ringkasan Cepat jadi kartu dengan 4 baris', () => {
  const r = foldMarkdown(REAL).find((s) => s.type === 'ringkas');
  assert.ok(r);
  assert.deepEqual(r.rows.map((x) => x.label), ['Rencana', 'Level kunci', 'Hindari trading', 'Masa Berlaku Sinyal']);
  assert.equal(r.rows[1].icon, '📍');
});

test('struktur nyata: Rincian (judul bertitik dua), Skenario Batal, Manajemen Posisi dilipat; Aturan Pasang jadi kartu', () => {
  const s = foldMarkdown(REAL);
  const k = (x) => s.filter((y) => y.type === 'fold' && y.kind === x);
  assert.equal(k('rincian').length, 1);
  assert.equal(k('rincian')[0].hint, '1 order');
  assert.equal(k('skenario')[0].hint, '1 level');
  assert.equal(k('manajemen')[0].hint, '2 catatan');
  assert.ok(k('manajemen')[0].text.includes('Break Even') && k('manajemen')[0].text.includes('Ingat'));
  const rules = s.find((y) => y.type === 'rules');
  assert.equal(rules.cap, '$150.00');
  assert.deepEqual(rules.results.map((x) => x.side), ['SELL', 'BUY']);
  assert.equal(rules.detail.length, 3); // kandidat, dibatalkan, "Lolos validator (total akhir...)"
  const shown = s.filter((y) => y.type === 'md').map((y) => y.text).join('\n');
  assert.ok(shown.includes('_Bukan saran keuangan'), 'penafian tetap tampil');
});

test('struktur nyata: tidak ada baris yang hilang', () => {
  const kept = new Set();
  for (const s of foldMarkdown(REAL)) for (const l of (s.type === 'md' || s.type === 'fold' ? s.text : s.raw).split('\n')) kept.add(l);
  assert.deepEqual(REAL.split('\n').filter((l) => l.trim() && !kept.has(l)), []);
});

test('Aturan Pasang dengan peringatan ⛔ tetap tampil (tidak dilipat)', () => {
  const r = foldMarkdown('**Aturan Pasang (batas risiko $200.00 per arah):**\n\n- SELL: tidak ada order valid.\n- ⛔ OVER RISK: Sell Z2 melewati batas.\n- Dibatalkan validator: x.\n').find((s) => s.type === 'rules');
  assert.ok(r.tips.some((t) => t.startsWith('⛔')));
});

test('Aturan Pasang tanpa baris BUY/SELL tidak diubah (tetap markdown)', () => {
  const r = foldMarkdown('**Aturan Pasang (batas risiko $200.00 per arah):**\n\n- teks lain\n');
  assert.ok(r.every((s) => s.type === 'md'));
});

const TF = `### 2. Analisa Teknikal Price Action Terbaru

**Struktur Top-Down (OHLC MT4)**
| Timeframe | Struktur/Trend | Level Kunci | Catatan |
|---|---|---|---|
| W1 | BEARISH | 1.02104 (Swing Low utuh W1), 1.17126 (Swing High W1) | Tren makro jangka panjang tertekan |
| H4 | BULLISH | 1.09320 (OB Bullish H4 fresh, tepi bawah), 1.09926 (Swing High H4) | Struktur menengah mencoba bertahan |
| M5 | BULLISH | 1.09657 (CHoCH Bullish M5) | Pantulan |

*Hasil Pemindaian Order:* Tidak ada data order.
`;

test('Struktur Top-Down jadi baris per timeframe dengan level terpisah', () => {
  const s = foldMarkdown(TF);
  const t = s.find((x) => x.type === 'tftable');
  assert.ok(t);
  assert.deepEqual(t.rows.map((r) => [r.tf, r.trend]), [['W1', 'BEARISH'], ['H4', 'BULLISH'], ['M5', 'BULLISH']]);
  assert.equal(t.rows[0].levels.length, 2);
  assert.deepEqual(t.rows[1].levels[0], { price: '1.09320', label: 'OB Bullish H4 fresh, tepi bawah' });
  assert.ok(t.raw.includes('| W1 | BEARISH |'));
  const kept = new Set();
  for (const x of s) for (const l of (x.type === 'md' || x.type === 'fold' ? x.text : x.raw).split('\n')) kept.add(l);
  assert.deepEqual(TF.split('\n').filter((l) => l.trim() && !kept.has(l)), []);
});

test('tabel lain bernama berbeda tidak disentuh', () => {
  const r = foldMarkdown('| Zona | Entry |\n|---|---|\n| A | 1 |\n');
  assert.ok(r.every((x) => x.type === 'md'));
});
