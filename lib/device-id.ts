// lib/device-id.ts — Permanent 4-character device ID management (client-side)
// Format: exactly 4 uppercase alphanumeric chars, e.g. "A9F2"

const STORAGE_KEY = 'btd_device_id';

/**
 * Get or create a permanent device ID.
 * Must only be called in browser context.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') {
    throw new Error('getOrCreateDeviceId must be called client-side');
  }

  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing && /^[A-Z0-9]{4}$/.test(existing)) {
    return existing;
  }

  const newId = generateDeviceId();
  localStorage.setItem(STORAGE_KEY, newId);
  return newId;
}

/**
 * Generate a new 4-char uppercase alphanumeric device ID.
 * Pattern: letter, digit, letter, alphanumeric — e.g. "A9F2"
 */
function generateDeviceId(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const alphanumeric = letters + digits;

  const rand = (charset: string) =>
    charset[Math.floor(Math.random() * charset.length)];

  return (
    rand(letters) +
    rand(digits) +
    rand(letters) +
    rand(alphanumeric)
  );
}

/**
 * Forcefully reset the device ID (Host-triggered only).
 */
export function resetDeviceId(): string {
  const newId = generateDeviceId();
  localStorage.setItem(STORAGE_KEY, newId);
  return newId;
}
