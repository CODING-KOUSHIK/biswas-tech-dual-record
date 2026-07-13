// lib/device.ts — Permanent 4-char device ID (client-side only)

const STORAGE_KEY = 'btd_device_id';
const COOKIE_KEY = 'btd_device_id';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

function generate(): string {
  let id = '';
  const array = new Uint8Array(4);
  crypto.getRandomValues(array);
  for (const byte of array) id += CHARS[byte % CHARS.length];
  return id;
}

/** Get or create permanent device ID. Call only in browser context. */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return '';

  // Try localStorage first
  let id = localStorage.getItem(STORAGE_KEY);
  if (id && /^[A-Z0-9]{4}$/.test(id)) return id;

  // Try cookie
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_KEY}=([A-Z0-9]{4})`));
  if (match) {
    id = match[1];
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  }

  // Generate new
  id = generate();
  localStorage.setItem(STORAGE_KEY, id);
  document.cookie = `${COOKIE_KEY}=${id}; max-age=31536000; path=/; SameSite=Lax`;
  return id;
}
