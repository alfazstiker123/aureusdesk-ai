import { createHash, timingSafeEqual } from 'node:crypto';

const DEFAULT_PIN = '123456';
const sha = (s) => createHash('sha256').update(String(s)).digest();

export function expectedPin() {
  return (process.env.APP_PIN || '').trim() || DEFAULT_PIN;
}

export function pinMatches(candidate) {
  if (!candidate) return false;
  return timingSafeEqual(sha(candidate), sha(expectedPin()));
}

/** Kembalikan Response 401 bila PIN salah/kosong, atau null bila lolos. */
export function requirePin(req) {
  const pin = req.headers.get('x-app-pin') || '';
  if (pinMatches(pin)) return null;
  return Response.json({ error: 'PIN salah atau belum dimasukkan.', code: 'AUTH' }, { status: 401 });
}
