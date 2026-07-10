// lib/validation.ts — Input sanitization and validation utilities

export function sanitizeString(input: unknown, maxLength = 256): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/[<>'"]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function isValidUserId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{3,32}$/.test(id);
}

export function isValidPassword(password: string): boolean {
  return password.length >= 6 && password.length <= 128;
}

export function isValidLanguage(lang: string): boolean {
  return /^[A-Z]{2,5}$/.test(lang);
}

export function isValidGender(gender: string): gender is 'MALE' | 'FEMALE' {
  return gender === 'MALE' || gender === 'FEMALE';
}

export function isValidInviteToken(token: string): boolean {
  return /^[a-zA-Z0-9]{8}$/.test(token);
}

export function isValidDeviceId(id: string): boolean {
  return /^[A-Z0-9]{4}$/.test(id);
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}
