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

test('Rincian Hitung Risiko dilipat utuh; Aturan Pasang tetap tampil', () => {
  const f = folds('rincian')[0];
  assert.equal(f.hint, '1 order');
  assert.ok(f.text.includes('0.01 lot x 18.42 x 100') && f.text.includes('= $18.42'));
  const shown = segs.filter((s) => s.type === 'md').map((s) => s.text).join('\n');
  assert.ok(shown.includes('Aturan Pasang') && shown.includes('VALIDATED ORDER'));
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
  for (const s of segs) for (const l of (s.type === 'lot' ? s.raw : s.text).split('\n')) kept.add(l);
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
