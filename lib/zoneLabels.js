// Sumber resmi nama & peran zona (Audit #12 Tahap 2). Tanpa import supaya bisa diuji dengan node.
// Nama zona di tabel Bagian 3 / 4B ditetapkan server dari konfigurasi (mode 2/3 zona, Zona 1 ON/OFF), bukan dari tulisan model.
export const ZONE_LABELS_VERSION = 'zone-labels/1';
export const ZONE_OFF_LABEL = 'Dimatikan';

const STYLES = { 2: { 1: 'Intraday', 2: 'Swing' }, 3: { 1: 'Scalping', 2: 'Intraday', 3: 'Swing' } };
export const zoneCount = (zones) => (Number(zones) === 3 ? 3 : 2);

/** Gaya zona resmi ("Scalping" | "Intraday" | "Swing") atau null bila nomor zona tidak ada di mode itu. */
export const zoneStyle = (zones, zone) => STYLES[zoneCount(zones)][zone] || null;
/** Peran yang ditampilkan di tabel: gaya zona, atau "Dimatikan" bila zona dinonaktifkan. */
export const zoneRole = (zones, zone, off = false) => (off ? ZONE_OFF_LABEL : zoneStyle(zones, zone));

const SIDE_TXT = { sec3: (s) => String(s).toUpperCase(), '4b': (s) => (String(s).toUpperCase() === 'SELL' ? 'Sell' : 'Buy') };
/** Nama baris baku. sec3: "BUY Zona 1 - Scalping"; 4b: "Buy Limit Zona 1 (Scalping)"; zona mati: tambah 🚫. */
export function zoneRowName(kind, side, zone, zones, off = false) {
  const role = zoneRole(zones, zone, off);
  const s = SIDE_TXT[kind === '4b' ? '4b' : 'sec3'](side);
  const base = kind === '4b' ? `${s} Limit Zona ${zone} (${role})` : `${s} Zona ${zone} - ${role}`;
  return off ? `${base} 🚫` : base;
}

/** Jenis zona dari nama baris (dipakai penyamaan Waktu Berakhir). */
export const kindFromName = (name = '') => (/scalp/i.test(name) ? 'Scalping' : /intraday/i.test(name) ? 'Intraday' : /swing/i.test(name) ? 'Swing' : null);

const normTok = (t) => { const x = String(t || '').toLowerCase(); return x === 'scalp' ? 'scalping' : x; };
// Token gaya yang menempel tepat setelah "Zona N" ("Zona 1 - Intraday", "Zona 1 (Scalping", "Zona 2 Swing"); "Swing High/Low" bukan gaya zona.
const styleRe = (zone) => new RegExp(`(zona\\s*${zone}\\s*(?:[-–—:]\\s*|\\(\\s*)?\\**\\s*)(scalping|scalp|intraday|swing|dimatikan)\\b(?!\\s+(?:high|low)\\b)`, 'i');

/**
 * Samakan nama baris dengan label resmi. Yang dipertahankan: deskripsi dasar level dari model (mis. "(RBS / Demand Dekat)").
 * @returns {{name:string, found:string|null, want:string, fixed:boolean}}
 */
export function canonicalizeName(name, { kind = 'sec3', zone, zones, off = false } = {}) {
  const want = zoneRole(zones, zone, off);
  let out = String(name ?? '');
  let found = null, fixed = false;
  if (!want) return { name: out, found, want, fixed };
  const re = styleRe(zone);
  const m = re.exec(out);
  if (m) {
    found = m[2];
    // Zona mati: gaya asli di barisnya (mis. dari penonaktifan) bukan salah tulis model, hanya diganti ke "Dimatikan".
    if (normTok(found) !== normTok(want) && !(off && normTok(found) === normTok(zoneStyle(zones, zone)))) fixed = true;
    out = out.replace(re, (all, pre) => `${pre}${want}`);
  } else {
    const z = new RegExp(`(zona\\s*${zone})(?!\\d)`, 'i').exec(out);
    if (z) { out = out.replace(z[1], kind === '4b' ? `${z[1]} (${want})` : `${z[1]} - ${want}`); fixed = true; }
  }
  if (off && !/🚫/u.test(out)) out = `${out.trimEnd()} 🚫`;
  return { name: out, found, want, fixed };
}

/**
 * Catat penyebutan "Zona N <gaya>" yang bentrok dengan label resmi di seluruh teks (tabel & narasi). Hanya mencatat.
 * Zona 1 yang dimatikan tetap boleh disebut dengan gaya aslinya.
 */
export function auditZoneLabels(markdown, { zones = 2, max = 20 } = {}) {
  const out = [];
  const re = /zona\s*([1-9])\s*(?:[-–—:]\s*|\(\s*)?\**\s*(scalping|scalp|intraday|swing)\b(?!\s+(?:high|low)\b)/gi;
  String(markdown || '').split('\n').forEach((line, i) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) && out.length < max) {
      const zone = Number(m[1]);
      const want = zoneStyle(zones, zone);
      if (want && normTok(m[2]) === normTok(want)) continue;
      out.push({ line: i + 1, zone, found: m[2], expected: want, text: line.trim().slice(0, 80) });
    }
  });
  return out;
}
