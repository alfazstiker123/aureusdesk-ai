// Jam pasar yang mengikuti DST New York (forex/emas: Daily Close = 17:00 New York).
// - Daily Close WIB: 04:00 saat musim panas AS (EDT), 05:00 saat musim dingin (EST).
// - Batas order akhir pekan: Jumat 16:00 New York (1 jam sebelum tutup) -> Sabtu 03:00 / 04:00 WIB.
// - Jam server MT4: kebanyakan broker memakai "New York + 7" (GMT+2 musim dingin / GMT+3 musim panas).
//   Bisa dipaksa dengan env MT4_SERVER_UTC_OFFSET (mis. "2", "3", atau "0").

const H = 3600e3;
const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const pad = (n) => String(n).padStart(2, '0');

/** Offset UTC New York (jam) pada saat `date`: -4 (EDT) atau -5 (EST). */
export function nyOffsetHours(date = new Date()) {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value;
    const m = /GMT([+-]\d{1,2})/.exec(s || '');
    if (m) return Number(m[1]);
  } catch {}
  // cadangan: aturan DST AS (Minggu ke-2 Maret 07:00 UTC s/d Minggu ke-1 November 06:00 UTC)
  const y = date.getUTCFullYear();
  const nthSunday = (month, n) => {
    const d = new Date(Date.UTC(y, month, 1));
    const first = (7 - d.getUTCDay()) % 7;
    return Date.UTC(y, month, 1 + first + 7 * (n - 1));
  };
  const start = nthSunday(2, 2) + 7 * H;
  const end = nthSunday(10, 1) + 6 * H;
  const t = date.getTime();
  return t >= start && t < end ? -4 : -5;
}

/** Jam WIB (0-23) untuk jam NY tertentu pada tanggal itu. */
export function nyHourToWIB(nyHour, date = new Date()) {
  return (((nyHour - nyOffsetHours(date) + 7) % 24) + 24) % 24;
}

/** "04:00" atau "05:00" — Daily Close (17:00 NY) dalam WIB. */
export function dailyCloseWIB(date = new Date()) {
  return `${pad(nyHourToWIB(17, date))}:00`;
}

/** "03:00" atau "04:00" — batas order akhir pekan (Jumat 16:00 NY) pada hari Sabtu WIB. */
export function weekendCutoffWIB(date = new Date()) {
  return `${pad(nyHourToWIB(16, date))}:00`;
}

/** Offset UTC jam server MT4 (jam). */
export function mt4ServerOffset(date = new Date()) {
  const env = process.env.MT4_SERVER_UTC_OFFSET;
  if (env !== undefined && env !== '' && !Number.isNaN(Number(env))) return Number(env);
  return nyOffsetHours(date) + 7;
}

/** Timestamp UTC -> "21 Nov 2026, 09.00" dalam offset jam tertentu. */
export function fmtMt4(ts, offsetHours) {
  const d = new Date(ts + offsetHours * H);
  return `${pad(d.getUTCDate())} ${MONTHS_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}.${pad(d.getUTCMinutes())}`;
}

/** Apakah ts (UTC) melewati batas akhir pekan (Jumat 16:00 NY s/d Minggu 17:00 NY)? */
export function isPastWeekendCutoff(ts) {
  const d = new Date(ts);
  const ny = new Date(ts + nyOffsetHours(d) * H); // komponen UTC = jam New York
  const dow = ny.getUTCDay();
  const h = ny.getUTCHours() + ny.getUTCMinutes() / 60;
  if (dow === 5 && h >= 16) return true;
  if (dow === 6) return true;
  if (dow === 0 && h < 17) return true;
  return false;
}

/**
 * Jam perdagangan logam (XAU) mengikuti CME/forex: tutup Jumat 17:00 NY s/d Minggu 18:00 NY,
 * plus jeda harian 17:00-18:00 NY (Senin-Kamis).
 */
export function metalsClosed(ts) {
  const d = new Date(ts);
  const ny = new Date(ts + nyOffsetHours(d) * H);
  const dow = ny.getUTCDay();
  const h = ny.getUTCHours() + ny.getUTCMinutes() / 60;
  if (dow === 6) return true;
  if (dow === 5 && h >= 17) return true;
  if (dow === 0 && h < 18) return true;
  return h >= 17 && h < 18; // jeda harian
}

/** Apakah sedang libur akhir pekan (bukan sekadar jeda harian)? */
export function metalsWeekendClosed(ts) {
  const d = new Date(ts);
  const ny = new Date(ts + nyOffsetHours(d) * H);
  const dow = ny.getUTCDay();
  const h = ny.getUTCHours() + ny.getUTCMinutes() / 60;
  return dow === 6 || (dow === 5 && h >= 17) || (dow === 0 && h < 18);
}

/** Detik UTC terakhir pasar logam masih buka (<= nowSec). Pasar buka -> nowSec. */
export function lastMetalsOpenSec(nowSec) {
  let t = Math.floor(nowSec / 300) * 300;
  if (!metalsClosed(nowSec * 1000)) return nowSec;
  for (let i = 0; i < 1200 && metalsClosed(t * 1000); i++) t -= 300; // maks ~4 hari
  return t + 300;
}

/** Detik UTC pembukaan pasar logam berikutnya (>= nowSec). */
export function nextMetalsOpenSec(nowSec) {
  let t = Math.ceil(nowSec / 300) * 300;
  for (let i = 0; i < 1200 && metalsClosed(t * 1000); i++) t += 300;
  return t;
}
