import test from 'node:test';
import assert from 'node:assert/strict';
import { syncExpiry } from '../lib/consistency.js';
import { zoneStyle } from '../lib/zoneLabels.js';

// NOW = 17:00 WIB. Jendela wajar: Scalping 17:30-19:30, Intraday 20:00-24:00 (aturan durasi tidak diubah).
const NOW = new Date('2026-11-24T10:00:00Z');
const H4 = ['Order', 'Harga Entry', 'Stop Loss', 'Take Profit', 'Jarak SL', 'Lot Aman', 'Risiko ($)', 'R:R', 'Waktu Berakhir (WIB)'];
const row = (name, exp) => [name, '3500.00', '3490.00', '3530.00', '10.00', '0.10', '$100.00', '1:3.0', exp];
const OFFROW = (name) => [name, 'Tidak Ada Setup (Tunggu)', '-', '-', '-', '-', '-', '-', '-'];
const T = (rows) => [`| ${H4.join(' | ')} |`, `| ${H4.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const doc = (rows, summary) => `**4B. Order Baru yang Disarankan**\n${T(rows)}\n\n> - ⏳ Masa Berlaku Sinyal: ${summary}\n`;
const hhmm = (s) => s.replace('.', ':');
const times4b = (md) => Object.fromEntries(md.split('\n').filter((l) => /^\|\s*(Sell|Buy) Limit/.test(l)).map((l) => { const c = l.split('|'); return [`${/(Sell|Buy)/.exec(c[1])[1]} Z${/Zona (\d)/.exec(c[1])[1]}`, /(\d{2})[.:](\d{2}) WIB/.exec(c[9]) ? hhmm(/(\d{2}[.:]\d{2}) WIB/.exec(c[9])[1]) : null]; }));
const sumTimes = (md) => { const l = md.split('\n').find((x) => /Masa Berlaku Sinyal/.test(x)); return Object.fromEntries(l.split(':').slice(1).join(':').split(';').map((seg) => [`Z${/Zona\s*(\d)/i.exec(seg)[1]}`, /(\d{1,2}[:.]\d{2})\s*WIB/.exec(seg)?.[1].replace('.', ':').padStart(5, '0') ?? null])); };

const M2 = doc([
  row('Sell Limit Zona 1 (Intraday)', '24 Nov 2026, 21.00 WIB'), row('Buy Limit Zona 1 (Intraday)', '24 Nov 2026, 21.30 WIB'),
  row('Sell Limit Zona 2 (Swing)', '25 Nov 2026, 04.00 WIB'), row('Buy Limit Zona 2 (Swing)', '25 Nov 2026, 04.00 WIB'),
], 'Zona 1 (Intraday) valid hingga 23:55 WIB; Zona 2 (Swing) valid hingga Daily Close pukul 06:00 WIB.');
const M3 = doc([
  row('Sell Limit Zona 1 (Scalping)', '24 Nov 2026, 19.00 WIB'), row('Buy Limit Zona 1 (Scalping)', '24 Nov 2026, 19.10 WIB'),
  row('Sell Limit Zona 2 (Intraday)', '24 Nov 2026, 21.00 WIB'), row('Buy Limit Zona 2 (Intraday)', '24 Nov 2026, 21.20 WIB'),
  row('Sell Limit Zona 3 (Swing)', '25 Nov 2026, 04.00 WIB'), row('Buy Limit Zona 3 (Swing)', '25 Nov 2026, 04.00 WIB'),
], 'Zona 1 valid 1-2 jam hingga 22:00 WIB; Zona 2 valid hingga 23:30 WIB; Zona 3 (Swing) valid hingga Daily Close pukul 06:00 WIB.');
const M3OFF = doc([
  row('Sell Limit Zona 1 (Dimatikan) 🚫', '-').map((c, i) => (i ? '-' : c)).map((c, i) => (i === 1 ? 'Tidak Ada Setup (Tunggu)' : c)), OFFROW('Buy Limit Zona 1 (Dimatikan) 🚫'),
  row('Sell Limit Zona 2 (Intraday)', '24 Nov 2026, 21.00 WIB'), row('Buy Limit Zona 2 (Intraday)', '24 Nov 2026, 21.20 WIB'),
  row('Sell Limit Zona 3 (Swing)', '25 Nov 2026, 04.00 WIB'),
], 'Zona 1 dimatikan 22:00 WIB; Zona 2 valid hingga 23:30 WIB; Zona 3 (Swing) valid hingga Daily Close pukul 06:00 WIB.');

test('mode 2 zona: jam Ringkasan Zona 1 = jam 4B Intraday, Zona 2 = Swing', () => {
  const r = syncExpiry(M2, NOW, null, { zones: 2, zonesOff: [] });
  const t4 = times4b(r.markdown), ts = sumTimes(r.markdown);
  assert.equal(t4['Sell Z1'], t4['Buy Z1']); // Intraday seragam di 4B
  assert.equal(ts.Z1, t4['Sell Z1']); // Ringkasan Zona 1 = jam 4B Zona 1
  assert.equal(ts.Z2, t4['Sell Z2']); // Ringkasan Zona 2 = jam 4B Zona 2 (Swing)
  assert.equal(ts.Z1, '21:00'); assert.equal(ts.Z2, '04:00');
});
test('mode 2 zona: pemetaan lama (asumsi 3 zona) memang salah pada input yang sama (bukti temuan)', () => {
  const legacy = syncExpiry(M2, NOW, null); // bawaan = perilaku lama
  assert.equal(sumTimes(legacy.markdown).Z1, '23:55'); // Zona 1 dianggap Scalping -> tidak ada target -> jam tak diselaraskan
  assert.equal(sumTimes(syncExpiry(M2, NOW, null, { zones: 2 }).markdown).Z1, '21:00');
});
test('mode 3 zona: Z1 Scalping, Z2 Intraday, Z3 Swing; jam Ringkasan = jam 4B', () => {
  const r = syncExpiry(M3, NOW, null, { zones: 3, zonesOff: [] });
  const t4 = times4b(r.markdown), ts = sumTimes(r.markdown);
  assert.equal(t4['Sell Z1'], t4['Buy Z1']); assert.equal(t4['Sell Z2'], t4['Buy Z2']);
  for (const z of [1, 2, 3]) assert.equal(ts[`Z${z}`], t4[`Sell Z${z}`], `Zona ${z}`);
  assert.deepEqual([ts.Z1, ts.Z2, ts.Z3], ['19:00', '21:00', '04:00']);
});
test('mode 3 zona, Zona 1 OFF: Zona 1 tidak menentukan expiry Scalping dan teksnya tidak disentuh', () => {
  const r = syncExpiry(M3OFF, NOW, null, { zones: 3, zonesOff: [1] });
  const ts = sumTimes(r.markdown), t4 = times4b(r.markdown);
  assert.equal(ts.Z1, '22:00'); // tidak diubah
  assert.equal(t4['Sell Z1'], null); assert.equal(t4['Buy Z1'], null); // baris 4B Zona 1 tetap kosong
  assert.equal(ts.Z2, t4['Sell Z2']); assert.equal(ts.Z2, '21:00');
  assert.equal(ts.Z3, t4['Sell Z3']);
  // tanpa zonesOff pun, tidak ada baris Scalping bernilai -> tidak ada target Scalping
  assert.equal(sumTimes(syncExpiry(M3OFF, NOW, null, { zones: 3 }).markdown).Z1, '22:00');
});
test('aturan durasi/expiry tidak berubah: tabel 4B identik dengan pemanggilan lama (bawaan) di semua mode', () => {
  const tbl = (md) => md.split('\n').filter((l) => l.startsWith('|')).join('\n');
  assert.equal(tbl(syncExpiry(M3, NOW, null, { zones: 3 }).markdown), tbl(syncExpiry(M3, NOW, null).markdown));
  assert.equal(tbl(syncExpiry(M2, NOW, null, { zones: 2 }).markdown), tbl(syncExpiry(M2, NOW, null).markdown));
  assert.equal(tbl(syncExpiry(M3OFF, NOW, null, { zones: 3, zonesOff: [1] }).markdown), tbl(syncExpiry(M3OFF, NOW, null).markdown));
});
test('3 zona: hasil identik dengan perilaku lama (bawaan) untuk seluruh teks', () => {
  assert.equal(syncExpiry(M3, NOW, null, { zones: 3 }).markdown, syncExpiry(M3, NOW, null).markdown);
});
test('Ringkasan memakai nomor zona resmi walau model salah menulis gaya (mode 2: "Zona 1 (Scalping)")', () => {
  const md = M2.replace('Zona 1 (Intraday) valid', 'Zona 1 (Scalping) valid');
  const r = syncExpiry(md, NOW, null, { zones: 2 });
  assert.equal(sumTimes(r.markdown).Z1, '21:00');
});
test('tanpa nomor zona: pemetaan lewat kata gaya tetap bekerja', () => {
  const md = doc([row('Sell Limit Zona 2 (Intraday)', '24 Nov 2026, 21.00 WIB')], 'Intraday valid hingga 23:30 WIB.');
  const l = syncExpiry(md, NOW, null, { zones: 3 }).markdown.split('\n').find((x) => /Masa Berlaku/.test(x));
  assert.match(l, /21:00 WIB/);
});
test('zoneStyle konsisten dengan pemetaan yang dipakai', () => {
  assert.equal(zoneStyle(2, 1), 'Intraday'); assert.equal(zoneStyle(2, 2), 'Swing'); assert.equal(zoneStyle(3, 1), 'Scalping');
});
test('kabel: route meneruskan zones & zonesOff ke syncExpiry', async () => {
  const fs = await import('node:fs');
  assert.match(fs.readFileSync(new URL('../app/api/analyze/route.js', import.meta.url), 'utf8'), /syncExpiry\(m, new Date\(\), pairCfg, \{ zones, zonesOff \}\)/);
});
