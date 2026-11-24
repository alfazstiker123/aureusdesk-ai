// Jejak audit tiap analisa: konfigurasi (hash), snapshot per timeframe (id, waktu, hash candle), harga/sumber, model, versi.
// Disalin ke baris riwayat (kolom audit_meta) sehingga TIDAK berubah ketika snapshot MT4 terbaru masuk (tabel snapshot ditimpa tiap menit).
// Tanpa import alias supaya bisa diuji dengan node.
import { createHash } from 'node:crypto';
import { stable, configDiff } from './configDiff.js';
export { stable, configDiff };

export const AUDIT_SCHEMA = 1;
// Naikkan string ini tiap perubahan logika validator/keputusan agar analisa lama bisa dibedakan dari yang baru.
export const ENGINE_VERSION = 'smc-validators/2026-11-24.bias3';

const sha = (s) => createHash('sha256').update(s).digest('hex');
/** Konfigurasi yang memengaruhi keputusan server. Bukan rahasia: tanpa API key / PIN. */
export function buildConfig(b = {}) {
  const zones = b.zones === 3 ? 3 : 2;
  const zonesOff = Array.isArray(b.zonesOff) ? [...b.zonesOff].sort() : [];
  const on = (n) => (zonesOff.includes(n) ? 'OFF' : 'ON');
  return {
    balance: Number(b.balance) || 0,
    risk: Number(b.risk) || 0,
    riskUsd: Number(b.riskUsd) || 0,
    riskCap: b.capPerDirection === false ? 'order' : 'arah',
    zoneMode: zones === 3 ? 'tiga' : 'dua',
    zone1: on(1),
    zone2: on(2),
    zone3: zones === 3 ? on(3) : 'N/A', // mode 2 zona hanya memakai Zona 1 & 2
    strict: b.strict !== false,
    mode: b.mode === '2stage' ? '2tahap' : 'single', // pilihan UI (yang dibandingkan antar perangkat)
    modeEffective: b.modeEffective === '2stage' ? '2tahap' : 'single', // yang benar-benar dijalankan server (gateway memaksa 2 tahap)
    engine: b.engine === 'gateway' ? 'gateway' : 'gemini',
    geminiModel: String(b.geminiModel || ''),
    gwModel: String(b.gwModel || ''),
    marketSource: String(b.marketSource || ''),
    pairChoice: String(b.pairChoice || 'AUTO'),
    connectionId: b.connectionId || null,
    digits: String(b.copyFmt || 'ASLI'), // format digit tombol salin (UI)
  };
}

// Hash = hanya yang memengaruhi keputusan server. Pengaturan tampilan (digit tombol salin) dan mode efektif turunan tidak dihitung.
const DISPLAY_ONLY = ['digits', 'modeEffective'];
export const configHash = (cfg) => sha(stable(Object.fromEntries(Object.entries(cfg || {}).filter(([k]) => !DISPLAY_ONLY.includes(k))))).slice(0, 12);

/** Ringkas satu snapshot: id baris, waktu terima, hash isi candle, bar terakhir. */
export function snapshotMeta(s, source = '') {
  const bars = Array.isArray(s?.bars) ? s.bars : [];
  const last = bars[bars.length - 1] || {};
  return {
    tf: s?.timeframe || null,
    // tabel snapshot tidak punya kolom id; identitas baris = kunci upsert (koneksi|simbol|TF)
    id: s?.id || (s?.connection_id && s?.symbol ? `${s.connection_id}|${s.symbol}|${s.timeframe}` : source ? `${source}:${s?.timeframe || '?'}` : null),
    receivedAt: s?.received_at || null,
    bid: s?.bid ?? null,
    ask: s?.ask ?? null,
    bars: bars.length,
    lastBarTime: last.time ? new Date(last.time * 1000).toISOString() : null,
    barsSha: sha(stable(bars.map((x) => [x.time, x.open, x.high, x.low, x.close]))).slice(0, 12),
  };
}

export function buildAudit({ config, ctx = null, usedModel = '', requestedModel = '', bias = null, decision = null, env = process.env, now = new Date() } = {}) {
  const snaps = (ctx?.snapshots || []).map((s) => snapshotMeta(s, ctx?.source || '')).sort((a, b) => String(a.tf).localeCompare(String(b.tf)));
  const q = ctx?.quote || null;
  const key = snaps.map((s) => `${s.tf}:${s.barsSha}`).join('|');
  return {
    v: AUDIT_SCHEMA,
    createdAt: now.toISOString(),
    deployment: { sha: (env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null, id: env.VERCEL_DEPLOYMENT_ID || null, env: env.VERCEL_ENV || null },
    engineVersion: ENGINE_VERSION,
    model: { used: usedModel || null, requested: requestedModel || null },
    config,
    configHash: configHash(config),
    market: {
      source: ctx?.source || 'NONE',
      provider: ctx?.provider || null,
      price: Number(ctx?.feedPrice) || null,
      quote: q ? { bid: q.bid ?? null, ask: q.ask ?? null, spread: q.spread ?? null, at: q.atWib || null } : null,
      snapshots: snaps,
      snapshotKey: key ? sha(key).slice(0, 12) : null, // sama = candle sumber identik
    },
    bias: bias ? { model: bias.model?.direction || bias.model?.kind || null, structure: bias.structure, structureTf: bias.structureTf, final: bias.final, conflict: bias.conflict } : null,
    decision: decision?.status || null,
  };
}

/** Satu baris ringkas untuk Catatan sistem / PDF. */
export function auditLine(a) {
  if (!a) return '';
  const c = a.config || {};
  const tf = (a.market?.snapshots || []).map((s) => `${s.tf} ${String(s.receivedAt || '').slice(11, 19)}Z`).join(', ');
  return `🔎 Jejak audit: konfigurasi #${a.configHash} (saldo $${Number(c.balance).toLocaleString('en-US')}, risiko ${c.risk}%, Zona 1/2/3 ${c.zone1}/${c.zone2}/${c.zone3}, ${c.zoneMode === 'tiga' ? '3' : '2'} zona) · snapshot #${a.market?.snapshotKey || '-'}${tf ? ` (${tf})` : ''} · model ${a.model?.used || '-'} · deploy ${a.deployment?.sha || '-'} · ${a.engineVersion}.`;
}

/** Terima audit dari klien hanya bila objek JSON kecil bersekema dikenal (bukan input tepercaya). */
export function sanitizeAudit(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || a.v !== AUDIT_SCHEMA) return null;
  try { const j = JSON.stringify(a); return j.length <= 20000 ? JSON.parse(j) : null; } catch { return null; }
}
