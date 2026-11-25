// Transparansi penolakan order karena batas risiko: angka, selisih, alasan, dampak ke keputusan final.
// Hanya MEMBACA hasil riskCheck (candidates[].drop); tidak menghitung ulang lot/risiko dan tidak mengubah tabel.
// Tanpa import alias supaya bisa diuji dengan node.

const money = (n) => `$${Number(n).toFixed(2)}`;
const nameOf = (c) => `${c.side === 'BUY' ? 'Buy' : 'Sell'} Z${c.zone}`;

/**
 * @param {{candidates:Array, maxRiskUsd:number, riskPct?:number, final?:string, decision?:{status:string,primary?:object}}} p
 * @returns {{items:Array, text:string}}  text = blok markdown (kosong bila tidak ada order ditolak karena batas risiko)
 */
export function riskTransparency({ candidates = [], maxRiskUsd = 0, riskPct = 0, final = 'NETRAL', decision = null } = {}) {
  const dir = final === 'BULLISH' ? 'BUY' : final === 'BEARISH' ? 'SELL' : null;
  const items = [];
  for (const c of candidates || []) {
    if (!c.dropped || !/batas risiko/i.test(c.why || '') || !c.drop || !Number.isFinite(c.drop.risk)) continue;
    const risk = Math.round(c.drop.risk * 100) / 100;
    const cap = Math.round(Number(maxRiskUsd) * 100) / 100;
    const excess = Math.round((risk - cap) * 100) / 100;
    items.push({
      manual: !!c.drop.manual, name: nameOf(c), side: c.side, zone: c.zone, kind: c.drop.kind, lot: c.drop.lot, risk, cap, excess: excess > 0 ? excess : 0,
      aligned: dir ? c.side === dir : null,
      needBalance: riskPct > 0 ? Math.ceil((risk / (riskPct / 100)) * 100) / 100 : null,
    });
  }
  if (!items.length) return { items, text: '' };
  const st = decision?.status;
  const stTxt = st === 'TRADE' ? `SETUP UTAMA ${decision.primary?.side || ''} Zona ${decision.primary?.zone || ''}`.trim() : st === 'COUNTERTREND_ONLY' ? 'HANYA COUNTERTREND' : st === 'WAIT' ? 'WAIT & SEE' : st === 'NO_TRADE' ? 'NO TRADE' : st || '-';
  const lines = ['> 🧮 **TRANSPARANSI RISIKO — order ditolak karena batas risiko**'];
  for (const it of items) {
    const scope = it.kind === 'direction' ? `batas total per arah ${it.side}` : 'batas risiko per arah';
    if (it.manual) lines.push(`> - ${it.name}: OVER RISK — lot manual ${it.lot} berisiko ${money(it.risk)}, ${scope} ${money(it.cap)}, kelebihan ${money(it.excess)} → order tidak dipasang. Lot manual tidak dikurangi otomatis oleh server.`);
    else lines.push(`> - ${it.name}: risiko lot minimum ${money(it.risk)} (lot ${it.lot}), ${scope} ${money(it.cap)}, kelebihan ${money(it.excess)} → NO TRADE. Alasan: anggaran risiko tidak cukup untuk lot minimum broker; server tidak menaikkan lot/batas atau menggeser SL.`);
    const bias = it.aligned === null ? '' : it.aligned ? ` Zona ini SEARAH bias final ${final}${st && st !== 'TRADE' ? '; tidak ada setup searah lain yang lolos' : ''}.` : ` Zona ini berlawanan dengan bias final ${final}.`;
    lines.push(`>   Dampak: keputusan final = ${stTxt}.${bias}${it.needBalance ? ` Informasi: order ini lolos bila batas risiko ≥ ${money(it.risk)} (saldo ≥ $${it.needBalance.toLocaleString('en-US')} pada risiko ${riskPct}%); ini bukan saran menaikkan risiko.` : ''}`);
  }
  return { items, text: lines.join('\n') };
}

/** Sisipkan blok setelah blok KEPUTUSAN SERVER; idempotent. */
export function insertRiskTransparency(markdown, text) {
  const md = String(markdown).replace(/^(?:>\n)?> 🧮 \*\*TRANSPARANSI RISIKO[^\n]*\n(?:>[^\n]*\n?)*/gmu, '');
  if (!text) return md;
  const m = /^> [🎯⛔⚠️⏳] \*\*KEPUTUSAN SERVER[^\n]*\n(?:> [^\n]*\n)*/mu.exec(md);
  if (m) { const at = m.index + m[0].length; return `${md.slice(0, at)}>\n${text}\n${md.slice(at)}`.replace(/\n{3,}/g, '\n\n'); }
  return `${text}\n\n${md}`;
}
