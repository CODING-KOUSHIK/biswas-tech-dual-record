// lib/languages.ts — Supported language list

export interface Language {
  code: string;
  label: string;
}

export const LANGUAGES: Language[] = [
  { code: 'ENGLISH', label: 'English' },
  { code: 'HINDI', label: 'Hindi' },
  { code: 'BENGALI', label: 'Bengali' },
  { code: 'TAMIL', label: 'Tamil' },
  { code: 'TELUGU', label: 'Telugu' },
  { code: 'MARATHI', label: 'Marathi' },
  { code: 'GUJARATI', label: 'Gujarati' },
  { code: 'KANNADA', label: 'Kannada' },
  { code: 'MALAYALAM', label: 'Malayalam' },
  { code: 'PUNJABI', label: 'Punjabi' },
  { code: 'ODIA', label: 'Odia' },
  { code: 'ASSAMESE', label: 'Assamese' },
  { code: 'URDU', label: 'Urdu' },
  { code: 'MAITHILI', label: 'Maithili' },
  { code: 'SANTALI', label: 'Santali' },
  { code: 'KASHMIRI', label: 'Kashmiri' },
  { code: 'NEPALI', label: 'Nepali' },
  { code: 'SINDHI', label: 'Sindhi' },
  { code: 'KONKANI', label: 'Konkani' },
  { code: 'DOGRI', label: 'Dogri' },
  { code: 'MANIPURI', label: 'Manipuri' },
  { code: 'BODO', label: 'Bodo' },
  { code: 'SANSKRIT', label: 'Sanskrit' },
];

export function getLabelByCode(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}
