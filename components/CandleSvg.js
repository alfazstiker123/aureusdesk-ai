'use client';

// Ilustrasi pola konfirmasi candle (SVG statis, tanpa data pengguna).
export function detectPattern(text = '', isBuy = true) {
  const t = text.toLowerCase();
  if (/choch|bos|struktur/.test(t)) return { type: 'choch', label: isBuy ? 'Bullish CHoCH (Perubahan Struktur)' : 'Bearish CHoCH (Perubahan Struktur)' };
  if (/pin|rejection|wick|hammer/.test(t)) return { type: 'pinbar', label: isBuy ? 'Bullish Pin Bar / Rejection Wick' : 'Bearish Pin Bar / Rejection Wick' };
  if (/star|morning|evening/.test(t)) return { type: 'star', label: isBuy ? 'Morning Star Reversal' : 'Evening Star Reversal' };
  return { type: 'engulfing', label: isBuy ? 'Bullish Engulfing di Demand' : 'Bearish Engulfing di Supply' };
}

function build(type, isBuy) {
  const zc = isBuy ? 'rgba(34,197,94,0.18)' : 'rgba(244,63,94,0.18)';
  const zs = isBuy ? '#22C55E' : '#F43F5E';
  const zoneY = isBuy ? 66 : 8;
  const zone = `<rect x="8" y="${zoneY}" width="224" height="22" rx="4" fill="${zc}" stroke="${zs}" stroke-dasharray="3 2" />`;
  const zl = isBuy ? 'ZONA DEMAND / OB' : 'ZONA SUPPLY / OB';
  const zlab = `<text x="14" y="${isBuy ? 81 : 21}" fill="${isBuy ? '#4ADE80' : '#FB7185'}" font-size="7.5" font-weight="700" font-family="monospace">${zl}</text>`;
  const G = '#22C55E';
  const R = '#F43F5E';
  const wrap = (inner) => `<svg viewBox="0 0 240 96" class="h-20 w-full max-w-[230px]">${inner}</svg>`;

  if (type === 'pinbar') {
    return isBuy
      ? wrap(`${zone}${zlab}<line x1="65" y1="22" x2="65" y2="62" stroke="${R}" stroke-width="1.8"/><rect x="59" y="28" width="12" height="28" rx="1.5" fill="${R}"/><line x1="108" y1="42" x2="108" y2="82" stroke="${G}" stroke-width="2"/><rect x="102" y="45" width="12" height="10" rx="1.5" fill="${G}"/><line x1="145" y1="20" x2="145" y2="54" stroke="${G}" stroke-width="1.8"/><rect x="139" y="26" width="12" height="22" rx="1.5" fill="${G}"/><path d="M162 46 L186 24" stroke="#46C3FF" stroke-width="2" fill="none"/><polygon points="188,22 180,24 186,30" fill="#46C3FF"/><text x="164" y="58" fill="#46C3FF" font-size="8" font-weight="800">ENTRY BUY</text>`)
      : wrap(`${zone}${zlab}<line x1="65" y1="34" x2="65" y2="74" stroke="${G}" stroke-width="1.8"/><rect x="59" y="40" width="12" height="26" rx="1.5" fill="${G}"/><line x1="108" y1="14" x2="108" y2="56" stroke="${R}" stroke-width="2"/><rect x="102" y="42" width="12" height="10" rx="1.5" fill="${R}"/><line x1="145" y1="44" x2="145" y2="78" stroke="${R}" stroke-width="1.8"/><rect x="139" y="48" width="12" height="22" rx="1.5" fill="${R}"/><path d="M162 50 L186 72" stroke="#46C3FF" stroke-width="2" fill="none"/><polygon points="188,74 180,72 186,66" fill="#46C3FF"/><text x="160" y="42" fill="#46C3FF" font-size="8" font-weight="800">ENTRY SELL</text>`);
  }
  if (type === 'choch') {
    return isBuy
      ? wrap(`<rect x="8" y="66" width="224" height="22" rx="4" fill="${zc}" stroke="${zs}" stroke-dasharray="3 2"/><polyline points="20,26 52,58 76,42 104,74 148,24 176,48 212,16" fill="none" stroke="#38BDF8" stroke-width="2.2"/><line x1="70" y1="42" x2="155" y2="42" stroke="#F5C451" stroke-width="1.3" stroke-dasharray="3 2"/><text x="86" y="38" fill="#F5C451" font-size="7.5" font-weight="800">CHoCH BULLISH</text><circle cx="176" cy="48" r="4" fill="${G}"/><text x="166" y="60" fill="#4ADE80" font-size="7.5" font-weight="800">RETEST BUY</text>`)
      : wrap(`<rect x="8" y="8" width="224" height="22" rx="4" fill="${zc}" stroke="${zs}" stroke-dasharray="3 2"/><polyline points="20,72 52,38 76,56 104,22 148,72 176,48 212,82" fill="none" stroke="#38BDF8" stroke-width="2.2"/><line x1="70" y1="56" x2="155" y2="56" stroke="#F5C451" stroke-width="1.3" stroke-dasharray="3 2"/><text x="84" y="66" fill="#F5C451" font-size="7.5" font-weight="800">CHoCH BEARISH</text><circle cx="176" cy="48" r="4" fill="${R}"/><text x="162" y="42" fill="#FB7185" font-size="7.5" font-weight="800">RETEST SELL</text>`);
  }
  if (type === 'star') {
    return isBuy
      ? wrap(`<rect x="8" y="66" width="224" height="22" rx="4" fill="${zc}" stroke="${zs}" stroke-dasharray="3 2"/><rect x="52" y="28" width="14" height="34" rx="1.5" fill="${R}"/><line x1="94" y1="60" x2="94" y2="82" stroke="#F5C451" stroke-width="1.8"/><rect x="88" y="68" width="12" height="6" rx="1" fill="#F5C451"/><rect x="124" y="26" width="14" height="38" rx="1.5" fill="${G}"/><text x="150" y="46" fill="#46C3FF" font-size="8" font-weight="800">MORNING STAR</text>`)
      : wrap(`<rect x="8" y="8" width="224" height="22" rx="4" fill="${zc}" stroke="${zs}" stroke-dasharray="3 2"/><rect x="52" y="34" width="14" height="34" rx="1.5" fill="${G}"/><line x1="94" y1="14" x2="94" y2="36" stroke="#F5C451" stroke-width="1.8"/><rect x="88" y="22" width="12" height="6" rx="1" fill="#F5C451"/><rect x="124" y="32" width="14" height="38" rx="1.5" fill="${R}"/><text x="150" y="54" fill="#46C3FF" font-size="8" font-weight="800">EVENING STAR</text>`);
  }
  return isBuy
    ? wrap(`${zone}${zlab}<line x1="76" y1="42" x2="76" y2="74" stroke="${R}" stroke-width="1.8"/><rect x="70" y="48" width="12" height="20" rx="1.5" fill="${R}"/><line x1="112" y1="22" x2="112" y2="76" stroke="${G}" stroke-width="2"/><rect x="104" y="28" width="16" height="42" rx="2" fill="${G}"/><path d="M134 48 L164 26" stroke="#46C3FF" stroke-width="2" fill="none"/><polygon points="166,24 158,26 164,32" fill="#46C3FF"/><text x="136" y="60" fill="#46C3FF" font-size="8" font-weight="800">ENGULFING BUY</text>`)
    : wrap(`${zone}${zlab}<line x1="76" y1="22" x2="76" y2="54" stroke="${G}" stroke-width="1.8"/><rect x="70" y="28" width="12" height="20" rx="1.5" fill="${G}"/><line x1="112" y1="20" x2="112" y2="74" stroke="${R}" stroke-width="2"/><rect x="104" y="24" width="16" height="42" rx="2" fill="${R}"/><path d="M134 48 L164 70" stroke="#46C3FF" stroke-width="2" fill="none"/><polygon points="166,72 158,70 164,64" fill="#46C3FF"/><text x="134" y="42" fill="#46C3FF" font-size="8" font-weight="800">ENGULFING SELL</text>`);
}

export default function CandleSvg({ type, isBuy }) {
  return <div className="flex justify-center" dangerouslySetInnerHTML={{ __html: build(type, isBuy) }} />;
}

export const GUIDE_ITEMS = [
  { title: 'Bullish Engulfing (Demand)', desc: 'Candle hijau besar menelan penuh body candle merah sebelumnya di dalam zona Demand/OB.', type: 'engulfing', buy: true },
  { title: 'Bearish Engulfing (Supply)', desc: 'Candle merah besar menelan penuh body candle hijau sebelumnya di dalam zona Supply/OB.', type: 'engulfing', buy: false },
  { title: 'Bullish Pin Bar / Rejection Wick', desc: 'Sumbu bawah panjang menandakan penolakan kuat oleh buyer di area Demand.', type: 'pinbar', buy: true },
  { title: 'Bearish Pin Bar / Rejection Wick', desc: 'Sumbu atas panjang menandakan tekanan jual kuat di area Supply.', type: 'pinbar', buy: false },
  { title: 'Bullish CHoCH (M1–M5)', desc: 'Harga menembus Lower High minor di TF kecil lalu retest ke OB baru untuk entry aman.', type: 'choch', buy: true },
  { title: 'Bearish CHoCH (M1–M5)', desc: 'Harga menembus Higher Low minor di TF kecil lalu retest ke Supply baru untuk entry aman.', type: 'choch', buy: false },
  { title: 'Morning Star', desc: 'Tiga candle: turun, ragu (body kecil), naik kuat di zona Demand.', type: 'star', buy: true },
  { title: 'Evening Star', desc: 'Tiga candle: naik, ragu (body kecil), turun kuat di zona Supply.', type: 'star', buy: false },
];

export function CandleGuideModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line p-4">
          <div>
            <h3 className="text-sm font-extrabold text-strong sm:text-base">🕯️ Panduan Visual Konfirmasi Candlestick</h3>
            <p className="text-[11px] text-muted">Tunggu salah satu pola ini di dalam Zona Entry sebelum eksekusi</p>
          </div>
          <button type="button" onClick={onClose} className="h-8 w-8 rounded-xl bg-night font-bold text-soft hover:text-strong" aria-label="Tutup">✕</button>
        </div>
        <div className="grid grid-cols-1 gap-3.5 overflow-y-auto p-4 sm:grid-cols-2">
          {GUIDE_ITEMS.map((it) => (
            <div key={it.title} className="flex flex-col gap-2 rounded-xl border border-line bg-night p-3.5">
              <div className="text-xs font-extrabold text-gold sm:text-sm">{it.title}</div>
              <div className="rounded-lg border border-line/70 bg-night p-2"><CandleSvg type={it.type} isBuy={it.buy} /></div>
              <p className="text-[11px] leading-relaxed text-soft">{it.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
