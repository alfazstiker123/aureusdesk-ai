// Murni (tanpa node:crypto) agar bisa dipakai di browser: JSON stabil + pembanding konfigurasi analisa vs pengaturan perangkat.

/** JSON stabil (kunci diurutkan) agar hash identik untuk konfigurasi identik. */
export function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

const KEYS = [['balance', 'Saldo', (v) => `$${Number(v).toLocaleString('en-US')}`], ['risk', 'Risiko', (v) => `${v}%`], ['zoneMode', 'Mode zona'], ['zone1', 'Zona 1'], ['zone2', 'Zona 2'], ['zone3', 'Zona 3'],
  ['strict', 'Validator zona', (v) => (v ? 'ON' : 'OFF')], ['mode', 'Mode'], ['engine', 'Mesin'], ['geminiModel', 'Model Gemini'], ['gwModel', 'Model gateway'], ['marketSource', 'Sumber data']];

/** Bandingkan konfigurasi analisa tersimpan vs pengaturan perangkat sekarang; hanya peringatan. */
export function configDiff(saved, now) {
  if (!saved || !now) return [];
  const out = [];
  // Mesin gateway SELALU memakai alur 2 tahap (server memaksa), jadi "Mode" tidak bermakna dan bukan perbedaan konfigurasi
  const gw = saved.engine === 'gateway' || now.engine === 'gateway';
  for (const [k, label, fmt] of KEYS) {
    if (k === 'mode' && gw) continue;
    if (saved[k] === undefined || now[k] === undefined) continue;
    if (stable(saved[k]) !== stable(now[k])) { const f = fmt || String; out.push({ key: k, label, saved: f(saved[k]), now: f(now[k]) }); }
  }
  // Lot Mode: konfigurasi lama tanpa kunci lotMode = AUTOMATIC. Hanya dibandingkan bila pengaturan perangkat menyertakannya.
  if (now.lotMode !== undefined) {
    const lm = (c) => (c.lotMode === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC');
    const lbl = (c) => (lm(c) === 'MANUAL' ? `Manual ${c.manualLot ?? '-'}` : 'Otomatis');
    if (lm(saved) !== lm(now) || (lm(now) === 'MANUAL' && Number(saved.manualLot) !== Number(now.manualLot))) out.push({ key: 'lotMode', label: 'Lot Mode', saved: lbl(saved), now: lbl(now) });
  }
  return out;
}

