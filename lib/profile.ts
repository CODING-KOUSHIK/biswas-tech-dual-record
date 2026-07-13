// lib/profile.ts — User profile stored in localStorage + cookies

export interface UserProfile {
  name: string;
  gender: 'MALE' | 'FEMALE';
  language: string; // language code e.g. ENGLISH, HINDI
}

const KEYS = {
  name: 'btd_name',
  gender: 'btd_gender',
  language: 'btd_language',
} as const;

function setCookie(key: string, value: string) {
  document.cookie = `${key}=${encodeURIComponent(value)}; max-age=31536000; path=/; SameSite=Lax`;
}

function getCookie(key: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${key}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function saveProfile(profile: UserProfile) {
  for (const [field, storageKey] of Object.entries(KEYS)) {
    const value = profile[field as keyof UserProfile];
    localStorage.setItem(storageKey, value);
    setCookie(storageKey, value);
  }
}

export function loadProfile(): UserProfile | null {
  if (typeof window === 'undefined') return null;
  const name = localStorage.getItem(KEYS.name) ?? getCookie(KEYS.name) ?? '';
  const gender = (localStorage.getItem(KEYS.gender) ?? getCookie(KEYS.gender) ?? '') as UserProfile['gender'] | '';
  const language = localStorage.getItem(KEYS.language) ?? getCookie(KEYS.language) ?? '';
  if (!name || !gender || !language) return null;
  return { name, gender: gender as UserProfile['gender'], language };
}

export function clearProfile() {
  Object.values(KEYS).forEach((key) => {
    localStorage.removeItem(key);
    document.cookie = `${key}=; max-age=0; path=/`;
  });
}

/** Save partial guest profile (no language — comes from host) */
export function saveGuestProfile(name: string, gender: 'MALE' | 'FEMALE') {
  localStorage.setItem(KEYS.name, name);
  localStorage.setItem(KEYS.gender, gender);
  setCookie(KEYS.name, name);
  setCookie(KEYS.gender, gender);
}

export function loadGuestProfile(): { name: string; gender: 'MALE' | 'FEMALE' } | null {
  if (typeof window === 'undefined') return null;
  const name = localStorage.getItem(KEYS.name) ?? getCookie(KEYS.name) ?? '';
  const gender = (localStorage.getItem(KEYS.gender) ?? getCookie(KEYS.gender) ?? '') as 'MALE' | 'FEMALE' | '';
  if (!name || !gender) return null;
  return { name, gender: gender as 'MALE' | 'FEMALE' };
}
