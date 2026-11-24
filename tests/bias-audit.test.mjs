import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyModelBias, decideBias, structureTfOf, syncHeadline, insertBiasBlock, parseBiasBlock } from '../lib/biasFinal.js';
import { resolveBias } from '../lib/consistency.js';
import { buildConfig, configHash, buildAudit, snapshotMeta, auditLine, sanitizeAudit, ENGINE_VERSION } from '../lib/auditTrail.js';
import { configDiff } from '../lib/configDiff.js';
import { riskTransparency, insertRiskTransparency } from '../lib/riskTransparency.js';
import { buildDecision, insertDecision } from '../lib/decision.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-'));
for (const f of ['riskCheck.js', 'brokerSpec.js', 'pairs.js', 'marketTime.js', 'prompt.js', 'promptLegacy.js']) {
  fs.writeFileSync(path.join(tmp, f), fs.readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8').replace(/'@\/lib\/([\w]+)'/g, "'./$1.js'"));
}
const { verifyRiskTables } = await import(pathToFileURL(path.join(tmp, 'riskCheck.js')).href);
const { PAIRS } = await import(pathToFileURL(path.join(tmp, 'pairs.js')).href);
const { extractBias } = await import(pathToFileURL(path.join(tmp, 'prompt.js')).href);

// ---- Fixture: kasus live 24 Nov 2026 16.13/16.14 (snapshot sama: harga 3618.03). Buy Z2: entry 3553.31, SL 3527.17 → risiko lot 0.01 = $26.14
const mk = (headline) => `**BIAS UTAMA:** ${headline}
**PAIR:** XAUUSD
**HARGA TERAKHIR:** 3618.03

> **Ringkasan Cepat**
> - 🎯 Rencana: pasang Buy Limit Zona 2 di 3553.31 dan Sell Limit Zona 2 di 3642.72.

### 3. Pemetaan Setup Eksekusi Langsung (Confirmation Entry)

| Zona & Strategi | Zona Entry | Stop Loss (SL) | Take Profit 1 (TP1) | Take Profit 2 (TP2) | Syarat Konfirmasi Candlestick |
|---|---|---|---|---|---|
| BUY Zona 2 - Intraday (Demand H1 FVG) (Searah Bias) | 3539.36 - 3553.31 (limit 3553.31) | 3527.17 | 3600.40 | 3628.31 | Tunggu CHoCH bullish M15; R:R 1:1,80. - Dasar: H1 FVG, H4 FVG |
| SELL Zona 2 - Intraday (OB M15-H1) (Counter-Trend) | 3642.72 - 3646.46 (limit 3642.72) | 3657.93 | 3602.36 | 3577.24 | Close M15 di bawah 3642.72; R:R 1:2,60. - Dasar: M15 OB |

### 4. Rekomendasi Susunan Pending Order

**4B. Order Baru yang Disarankan**

| Order | Harga Entry | Stop Loss | Take Profit | Jarak SL | Lot Aman | Risiko ($) | R:R | Waktu Berakhir (WIB) |
|---|---|---|---|---|---|---|---|---|
| Buy Limit Zona 2 (Intraday FVG H1-H4) | 3553.31 | 3527.17 | 3600.40 | 26.14 | 0.01 | $26.14 | 1:1.80 | 24 Nov 2026, 20.00 WIB |
| Sell Limit Zona 2 (Intraday OB M15-H1) | 3642.72 | 3657.93 | 3602.36 | 15.21 | 0.01 | $15.21 | 1:2.65 | 24 Nov 2026, 20.00 WIB |

**Rincian Hitung Risiko**
- Buy Limit Zona 2: 0.01 lot x 26.14 x 100 = $26.14
- Sell Limit Zona 2: 0.01 lot x 15.21 x 100 = $15.21
`;
const HEAD_PC = 'BEARISH - FOKUS SELL (INTRADAY H1/M15; H4 MASIH BULLISH = BELUM SELARAS)'; // kata BEARISH dan BULLISH sekaligus
const HEAD_HP = 'BEARISH - FOKUS SELL';
const HEAD_BULL = 'BULLISH - FOKUS BUY';
const HEAD_NEUTRAL_PAREN = 'NETRAL - WAIT & SEE (tekanan BEARISH jangka pendek, H4 BULLISH)';
const ANALYSES_H4_BULL = [{ timeframe: 'H4', status: 'OK', bias: 'BULLISH' }, { timeframe: 'H1', status: 'OK', bias: 'BEARISH' }];

function run(headline, { cap = 28, engine = 'BULLISH', pct = 2 } = {}) {
  const raw = mk(headline);
  const info = decideBias({ modelHeadline: extractBias(raw), engineBias: engine, structureTf: structureTfOf(ANALYSES_H4_BULL) });
  let md = syncHeadline(raw, info);
  const c = verifyRiskTables(md, cap, PAIRS.XAUUSD, new Date('2026-11-24T09:13:00Z'), { last: 3618.03, capPerDirection: true, zones: 3 });
  md = c.markdown;
  const decision = buildDecision({ markdown: md, bias: info.direction || 'NETRAL', neutral: info.neutral });
  md = insertDecision(md, decision.text);
  const rt = riskTransparency({ candidates: c.candidates, maxRiskUsd: cap, riskPct: pct, final: info.final, decision });
  md = insertRiskTransparency(md, rt.text);
  md = insertBiasBlock(md, info, { decisionTitle: /KEPUTUSAN SERVER — ([^:*]+):/.exec(decision.text)?.[1] || '' });
  return { info, md, c, decision, rt };
}

// ============ P0 bias final ============
test('classifyModelBias: arah utama = kata arah pertama; campuran ditandai; NETRAL tidak dibaca arah', () => {
  assert.deepEqual(classifyModelBias(HEAD_HP), { kind: 'BEARISH', direction: 'BEARISH', mixed: false });
  const pc = classifyModelBias(HEAD_PC);
  assert.equal(pc.direction, 'BEARISH'); assert.equal(pc.mixed, true);
  assert.equal(classifyModelBias('BULLISH - FOKUS BUY').direction, 'BULLISH');
  assert.equal(classifyModelBias(HEAD_NEUTRAL_PAREN).kind, 'NEUTRAL');
  assert.equal(classifyModelBias('').kind, 'UNKNOWN');
  assert.equal(classifyModelBias('SELL SETUP DAN BUY SETUP').mixed, true);
});

test('header Gemini memuat BEARISH+BULLISH sekaligus ditangani sama dengan BEARISH polos: final = struktur mesin, konflik terlihat', () => {
  const pc = decideBias({ modelHeadline: HEAD_PC, engineBias: 'BULLISH' });
  const hp = decideBias({ modelHeadline: HEAD_HP, engineBias: 'BULLISH' });
  assert.equal(pc.final, 'BULLISH'); assert.equal(hp.final, 'BULLISH');
  assert.equal(pc.override, true); assert.equal(hp.override, true);
  assert.equal(pc.conflict, 'mixed'); assert.equal(hp.conflict, 'direction');
  assert.match(pc.reason, /BEARISH/); assert.match(pc.reason, /BULLISH/); assert.match(pc.reason, /struktur H4 mesin/);
  // aturan LAMA tidak menimpa header campuran (bug asal-usul): resolveBias lama tidak override
  assert.equal(resolveBias(HEAD_PC, 'BULLISH').overridden, false);
  assert.equal(resolveBias(HEAD_HP, 'BULLISH').overridden, true);
});

test('header ditulis ulang ke bias final di kedua kasus; panel Bias menyimpan teks asli model (tidak diam-diam)', () => {
  for (const h of [HEAD_PC, HEAD_HP]) {
    const r = run(h);
    assert.match(r.md, /BIAS UTAMA:\*\* BULLISH - FOKUS BUY/);
    assert.match(r.md, /KONFLIK BIAS/);
    assert.ok(r.md.includes(`Teks asli model: "${h.replace(/\s+/g, ' ').slice(0, 90)}"`));
    const p = parseBiasBlock(r.md);
    assert.equal(p.final, 'BULLISH'); assert.equal(p.structure, 'BULLISH'); assert.equal(p.conflict, true);
    assert.match(p.model, /BEARISH/);
  }
});

test('model dan struktur selaras: header tidak diubah, panel "Selaras"', () => {
  const r = run(HEAD_BULL);
  assert.equal(r.info.override, false); assert.equal(r.info.conflict, 'none');
  assert.match(r.md, /BIAS UTAMA:\*\* BULLISH - FOKUS BUY/);
  assert.match(r.md, /✅ Selaras/); assert.doesNotMatch(r.md, /KONFLIK BIAS/);
  assert.equal(parseBiasBlock(r.md).conflict, false);
});

test('model NETRAL tetap NETRAL walau teks kurung memuat arah (aturan lama salah menimpa jadi BULLISH-FOKUS BUY)', () => {
  const info = decideBias({ modelHeadline: HEAD_NEUTRAL_PAREN, engineBias: 'BULLISH' });
  assert.equal(info.neutral, true); assert.equal(info.final, 'NETRAL'); assert.equal(info.override, false); assert.equal(info.direction, 'BULLISH');
  assert.equal(syncHeadline(mk(HEAD_NEUTRAL_PAREN), info), mk(HEAD_NEUTRAL_PAREN));
  const onlyBear = 'NETRAL - WAIT & SEE (tekanan BEARISH jangka pendek)';
  assert.equal(resolveBias(onlyBear, 'BULLISH').overridden, true); // perilaku lama (bug): header NETRAL ditimpa jadi BULLISH - FOKUS BUY
  const ni = decideBias({ modelHeadline: onlyBear, engineBias: 'BULLISH' });
  assert.equal(ni.override, false); assert.equal(ni.final, 'NETRAL');
  const r = run(HEAD_NEUTRAL_PAREN);
  assert.equal(r.decision.status, 'WAIT');
  assert.match(r.md, /Final server: NETRAL/);
});

test('tanpa struktur mesin (screenshot saja): ikut model bila jelas dan diberi catatan belum diverifikasi; campuran = NETRAL', () => {
  const a = decideBias({ modelHeadline: HEAD_HP, engineBias: '' });
  assert.equal(a.final, 'BEARISH'); assert.equal(a.override, false); assert.match(a.reason, /BELUM diverifikasi/);
  const b = decideBias({ modelHeadline: HEAD_PC, engineBias: '' });
  assert.equal(b.final, 'NETRAL');
  const c = decideBias({ modelHeadline: 'NETRAL - WAIT', engineBias: '' });
  assert.equal(c.final, 'NETRAL'); assert.equal(c.direction, null);
});

test('structureTfOf mengikuti engine: H4 bila ada bias, selain itu H1', () => {
  assert.equal(structureTfOf(ANALYSES_H4_BULL), 'H4');
  assert.equal(structureTfOf([{ timeframe: 'H4', status: 'OK', bias: 'UNKNOWN' }, { timeframe: 'H1', status: 'OK', bias: 'BEARISH' }]), 'H1');
});

test('INPUT IDENTIK → KEPUTUSAN IDENTIK: snapshot+konfigurasi sama, tiga kata-kata model berbeda → status, bias final, header, tabel 4B sama', () => {
  const runs = [HEAD_PC, HEAD_HP, 'BEARISH - FOKUS SELL (H4 MASIH BULLISH, KONFLIK)', 'SELL / BEARISH'].map((h) => run(h));
  for (const r of runs) {
    assert.equal(r.decision.status, runs[0].decision.status);
    assert.equal(r.decision.text, runs[0].decision.text);
    assert.equal(r.info.final, 'BULLISH');
    assert.equal(extractBias(r.md), 'BULLISH - FOKUS BUY');
    assert.equal(r.c.totals.BUY, runs[0].c.totals.BUY);
  }
  // blok keputusan dan bias final identik di header, keputusan, 4B (lihat arah order)
  const fin = (r) => r.md.split('\n').filter((l) => /^\|\s*(Buy|Sell) Limit/.test(l)).join('\n');
  for (const r of runs) assert.equal(fin(r), fin(runs[0]));
  assert.equal(run(HEAD_PC).md.replace(/Teks asli model:[^\n]*\n?/, '').replace(/> ⚠️ KONFLIK BIAS:[^\n]*\n/, ''), run(HEAD_PC).md.replace(/Teks asli model:[^\n]*\n?/, '').replace(/> ⚠️ KONFLIK BIAS:[^\n]*\n/, '')); // deterministik
});

test('idempotent: panel bias & transparansi tidak menggandakan diri', () => {
  const r = run(HEAD_PC, { cap: 26 });
  const info = r.info;
  const again = insertBiasBlock(insertRiskTransparency(r.md, r.rt.text), info, { decisionTitle: 'x' });
  assert.equal((again.match(/🧭 \*\*BIAS\*\*/g) || []).length, 1);
  assert.equal((again.match(/TRANSPARANSI RISIKO/g) || []).length, 1);
  assert.equal(again.match(/Teks asli model/g).length, 1);
});

// ============ P1 transparansi risiko ============
test('batas $26.00: Buy Z2 $26.14 ditolak (NO TRADE) dengan angka, selisih, alasan, dampak; $28.00: lolos tanpa blok', () => {
  const a = run(HEAD_HP, { cap: 26 });
  const it = a.rt.items.find((x) => x.name === 'Buy Z2');
  assert.ok(it); assert.equal(it.risk, 26.14); assert.equal(it.cap, 26); assert.equal(it.excess, 0.14);
  assert.match(a.rt.text, /Buy Z2: risiko lot minimum \$26\.14 \(lot 0\.01\), batas risiko per arah \$26\.00, kelebihan \$0\.14 → NO TRADE/);
  assert.match(a.rt.text, /anggaran risiko tidak cukup untuk lot minimum/);
  assert.match(a.rt.text, /Dampak: keputusan final = /);
  assert.match(a.rt.text, /SEARAH bias final BULLISH/);
  assert.match(a.md, /TRANSPARANSI RISIKO/);
  const b = run(HEAD_HP, { cap: 28 });
  assert.equal(b.rt.items.length, 0); assert.equal(b.rt.text, '');
  assert.doesNotMatch(b.md, /TRANSPARANSI RISIKO/);
  // dampak ke keputusan benar: cap 28 → setup utama BUY Z2; cap 26 → tidak ada setup searah
  assert.equal(b.decision.status, 'TRADE');
  assert.notEqual(a.decision.status, 'TRADE');
});

test('batas risiko tidak berubah oleh kode baru: order lolos/ditolak identik dengan aturan lama (lot, risiko, total)', () => {
  const lo = run(HEAD_HP, { cap: 26 }).c, hi = run(HEAD_HP, { cap: 28 }).c;
  assert.equal(lo.totals.BUY, 0); assert.equal(hi.totals.BUY, 26.14); assert.equal(lo.totals.SELL, 15.21); assert.equal(hi.totals.SELL, 15.21);
  assert.equal(hi.candidates.find((x) => x.side === 'BUY').dropped, false);
  assert.equal(lo.candidates.find((x) => x.side === 'BUY').drop.kind, 'order');
});

test('total per arah melebihi batas: transparansi menyebut batas total per arah', () => {
  const rt = riskTransparency({ candidates: [{ side: 'BUY', zone: 3, dropped: true, why: 'melebihi batas risiko', drop: { kind: 'direction', lot: 0.01, dist: 20, risk: 20 } }], maxRiskUsd: 26, riskPct: 2, final: 'BULLISH', decision: { status: 'WAIT' } });
  assert.match(rt.text, /batas total per arah BUY \$26\.00/); assert.match(rt.text, /kelebihan \$0\.00/);
});

test('penolakan karena R:R/lot minimum bukan batas risiko: tidak muncul di blok transparansi', () => {
  const rt = riskTransparency({ candidates: [{ side: 'SELL', zone: 3, dropped: true, why: 'R:R di bawah standar', drop: { kind: 'order', lot: 0.01, dist: 17, risk: 17 } }], maxRiskUsd: 26, final: 'BEARISH' });
  assert.equal(rt.items.length, 0);
});

// ============ P0 audit trail ============
const BARS = [{ time: 1795500000, open: 3600, high: 3610, low: 3595, close: 3605 }, { time: 1795503600, open: 3605, high: 3620, low: 3600, close: 3618.03 }];
const mkCtx = (bars = BARS, rx = '2026-11-24T09:13:55.000Z') => ({ source: 'MT4_EA', feedPrice: 3618.03, quote: { bid: 3618.03, ask: 3618.36, spread: 0.33, atWib: '16:10' },
  snapshots: ['M15', 'H1', 'H4'].map((tf, i) => ({ id: `uuid-${tf}`, timeframe: tf, received_at: rx, bid: 3618.03, ask: 3618.36, bars })) });
const BODY = { balance: 1300, risk: 2, riskUsd: 26, zones: 3, zonesOff: [], capPerDirection: true, strict: true, mode: 'single', engine: 'gemini', geminiModel: 'gemini-flash-lite-latest', marketSource: 'cloud', pairChoice: 'XAUUSD', connectionId: null, copyFmt: 'ASLI' };

test('konfigurasi identik → hash identik; saldo atau Zona 1 berubah → hash berubah dan tercatat', () => {
  const a = buildConfig(BODY), b = buildConfig({ ...BODY });
  assert.equal(configHash(a), configHash(b));
  const c = buildConfig({ ...BODY, balance: 1400, riskUsd: 28 });
  assert.notEqual(configHash(a), configHash(c));
  assert.equal(c.balance, 1400);
  const d = buildConfig({ ...BODY, zonesOff: [1] });
  assert.equal(d.zone1, 'OFF'); assert.equal(a.zone1, 'ON'); assert.notEqual(configHash(a), configHash(d));
  assert.equal(buildConfig({ ...BODY, zones: 2 }).zone3, 'N/A');
  // urutan kunci tidak memengaruhi hash
  assert.equal(configHash({ b: 1, a: 2 }), configHash({ a: 2, b: 1 }));
});

test('audit memuat ID+timestamp snapshot tiap TF, harga, sumber, hash konfigurasi, saldo/risiko, Zona 1/2/3, mode, digit, model, deployment, versi mesin', () => {
  const env = { VERCEL_GIT_COMMIT_SHA: 'b141611aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', VERCEL_DEPLOYMENT_ID: 'dpl_x', VERCEL_ENV: 'production' };
  const info = decideBias({ modelHeadline: HEAD_PC, engineBias: 'BULLISH' });
  const a = buildAudit({ config: buildConfig(BODY), ctx: mkCtx(), usedModel: 'gemini-flash-lite-latest', requestedModel: 'gemini-flash-lite-latest', bias: info, decision: { status: 'COUNTERTREND_ONLY' }, env, now: new Date('2026-11-24T09:13:34Z') });
  assert.equal(a.v, 1); assert.equal(a.deployment.sha, 'b141611'); assert.equal(a.deployment.id, 'dpl_x'); assert.equal(a.engineVersion, ENGINE_VERSION);
  assert.deepEqual(a.market.snapshots.map((s) => s.tf), ['H1', 'H4', 'M15']);
  for (const s of a.market.snapshots) { assert.match(s.id, /^uuid-/); assert.equal(s.receivedAt, '2026-11-24T09:13:55.000Z'); assert.equal(s.bars, 2); assert.match(s.barsSha, /^[0-9a-f]{12}$/); assert.equal(s.lastBarTime, new Date(1795503600 * 1000).toISOString()); }
  assert.equal(a.market.price, 3618.03); assert.equal(a.market.source, 'MT4_EA'); assert.equal(a.market.quote.bid, 3618.03);
  assert.equal(a.config.balance, 1300); assert.equal(a.config.risk, 2); assert.deepEqual([a.config.zone1, a.config.zone2, a.config.zone3, a.config.zoneMode, a.config.digits], ['ON', 'ON', 'ON', 'tiga', 'ASLI']);
  assert.equal(a.model.used, 'gemini-flash-lite-latest'); assert.equal(a.configHash, configHash(a.config));
  assert.equal(a.bias.model, 'BEARISH'); assert.equal(a.bias.structure, 'BULLISH'); assert.equal(a.bias.final, 'BULLISH'); assert.equal(a.decision, 'COUNTERTREND_ONLY');
  assert.ok(!JSON.stringify(a).match(/apikey|x-gemini|PIN|secret/i)); // tanpa rahasia
  assert.match(auditLine(a), /konfigurasi #[0-9a-f]{12}.*snapshot #[0-9a-f]{12}/);
});

test('data historis tidak berubah saat snapshot terbaru masuk: audit tersalin (nilai), hash membedakan snapshot lama vs baru', () => {
  const ctx = mkCtx();
  const old = buildAudit({ config: buildConfig(BODY), ctx, env: {} });
  const frozen = JSON.stringify(old);
  // snapshot baru menimpa baris yang sama (id sama, isi & waktu berubah), seperti upsert tiap menit
  ctx.snapshots[1].bars = [...BARS, { time: 1795507200, open: 3618, high: 3630, low: 3615, close: 3628 }];
  ctx.snapshots[1].received_at = '2026-11-24T09:20:00.000Z';
  assert.equal(JSON.stringify(old), frozen);
  const fresh = buildAudit({ config: buildConfig(BODY), ctx, env: {} });
  assert.notEqual(fresh.market.snapshotKey, old.market.snapshotKey);
  assert.equal(fresh.market.snapshots.find((s) => s.tf === 'H1').id, old.market.snapshots.find((s) => s.tf === 'H1').id);
  assert.notEqual(fresh.market.snapshots.find((s) => s.tf === 'H1').barsSha, old.market.snapshots.find((s) => s.tf === 'H1').barsSha);
  // data sama → kunci snapshot sama
  assert.equal(buildAudit({ config: buildConfig(BODY), ctx: mkCtx(), env: {} }).market.snapshotKey, old.market.snapshotKey);
});

test('snapshot tanpa id (Cloud) tetap punya identitas: sumber:TF', () => {
  const m = snapshotMeta({ timeframe: 'H1', bars: BARS, received_at: 'x' }, 'CLOUD');
  assert.equal(m.id, 'CLOUD:H1');
});

test('configDiff: peringatan saat saldo/Zona 1 berbeda antar perangkat; tidak ada peringatan bila sama', () => {
  const saved = buildConfig(BODY); // PC: saldo 1300, Zona 1 ON
  const hp = { balance: 1400, risk: 2, zoneMode: 'tiga', zone1: 'OFF', strict: true, mode: 'single', engine: 'gemini', marketSource: 'cloud', digits: 'ASLI' };
  const d = configDiff(saved, hp);
  assert.deepEqual(d.map((x) => x.key), ['balance', 'zone1']);
  assert.equal(d[0].saved, '$1,300'); assert.equal(d[0].now, '$1,400'); assert.equal(d[1].saved, 'ON'); assert.equal(d[1].now, 'OFF');
  assert.deepEqual(configDiff(saved, { balance: 1300, risk: 2, zone1: 'ON' }), []);
  assert.deepEqual(configDiff(null, hp), []);
});

test('sanitizeAudit: hanya objek bersekema v1 dan kecil; selain itu dibuang (riwayat lama tanpa audit tetap valid)', () => {
  const a = buildAudit({ config: buildConfig(BODY), ctx: mkCtx(), env: {} });
  assert.deepEqual(sanitizeAudit(a), a);
  assert.equal(sanitizeAudit(null), null); assert.equal(sanitizeAudit([]), null); assert.equal(sanitizeAudit({ v: 2 }), null);
  assert.equal(sanitizeAudit({ v: 1, big: 'x'.repeat(30000) }), null);
});

test('riwayat dapat ditelusuri: dua analisa 16.13 vs 16.14 — snapshot sama tetapi konfigurasi beda terlihat dari hash & configDiff', () => {
  const pc = buildAudit({ config: buildConfig(BODY), ctx: mkCtx(), env: {} });
  const hp = buildAudit({ config: buildConfig({ ...BODY, balance: 1400, riskUsd: 28, zonesOff: [1] }), ctx: mkCtx(), env: {} });
  assert.equal(pc.market.snapshotKey, hp.market.snapshotKey);
  assert.notEqual(pc.configHash, hp.configHash);
  const d = configDiff(pc.config, hp.config).map((x) => x.key);
  assert.ok(d.includes('balance') && d.includes('zone1'));
});

test('snapshot MT4 tanpa kolom id: identitas = kunci upsert koneksi|simbol|TF (kolom id TIDAK boleh diminta ke tabel snapshot)', () => {
  const m = snapshotMeta({ timeframe: 'H1', connection_id: '90539d85', symbol: 'XAUUSD', bars: BARS, received_at: 'x' }, 'MT4_EA');
  assert.equal(m.id, '90539d85|XAUUSD|H1');
  const cols = /const COLS = "([^"]+)"/.exec(fs.readFileSync(new URL('../lib/mt4Market.js', import.meta.url), 'utf8'))[1].split(',');
  assert.ok(!cols.includes('id')); // regresi: select id → HTTP 400 "Tidak dapat membaca OHLC"
  assert.ok(cols.includes('connection_id') && cols.includes('bars') && cols.includes('received_at'));
});

test('mesin gateway memaksa 2 tahap: "Mode" 2tahap vs single BUKAN perbedaan konfigurasi (false positive dari analisa live 16.53), tetapi beda saldo/Zona 1 tetap terdeteksi', () => {
  const saved = buildConfig({ ...BODY, engine: 'gateway', mode: 'single', modeEffective: '2stage', copyFmt: 'AUTO' });
  assert.equal(saved.mode, 'single'); assert.equal(saved.modeEffective, '2tahap');
  const live = { balance: 1400, risk: 2, zoneMode: 'tiga', zone1: 'OFF', strict: true, mode: 'single', engine: 'gateway', marketSource: 'cloud', digits: 'AUTO' };
  assert.deepEqual(configDiff({ ...saved, mode: '2tahap' }, live).map((x) => x.key), ['balance', 'zone1', 'marketSource'].filter((k) => k !== 'marketSource' || saved.marketSource !== 'cloud'));
  assert.ok(!configDiff({ ...saved, mode: '2tahap' }, live).some((x) => x.key === 'mode'));
  // mesin gemini: perbedaan mode tetap dilaporkan
  assert.ok(configDiff({ mode: '2tahap', engine: 'gemini' }, { mode: 'single', engine: 'gemini' }).some((x) => x.key === 'mode'));
});
