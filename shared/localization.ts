import si from './locales/si.json';
import ta from './locales/ta.json';
export type UiLanguage = 'en' | 'si' | 'ta' | 'ar' | 'hi';
const tables: Record<string, Record<string, string>> = { si, ta };
export const languageLocale: Record<UiLanguage, string> = { en: 'en-LK', si: 'si-LK', ta: 'ta-LK', ar: 'ar', hi: 'hi-IN' };
export const languageNames: Record<UiLanguage, string> = { en: 'English', si: 'Sinhala', ta: 'Tamil', ar: 'Arabic', hi: 'Hindi' };
export function normalizeLanguage(value: string | null | undefined): UiLanguage {
  const code = (value ?? 'en').split('-')[0]?.toLowerCase();
  return code && Object.hasOwn(languageLocale, code) ? (code as UiLanguage) : 'en';
}
export function localeForLanguage(value: string | null | undefined): string {
  return languageLocale[normalizeLanguage(value)];
}
const missing = new Map<string, { language: string; source: string }>();
/** Only static system wording reaches this function. Callers keep user content as data, outside catalog lookup. */
export function localize(source: string, language: string, vars?: Record<string, string | number>): string {
  const code = normalizeLanguage(language);
  const key = source.trim();
  let text = tables[code]?.[key];
  if (code !== 'en' && text === undefined) {
    // Bounded, in-memory diagnostics. Never upload messages or retain interpolation values.
    if (missing.size < 10000) missing.set(`${code}:${key}`, { language: code, source: key });
  }
  text = text === undefined ? source : (source.match(/^\s*/)?.[0] ?? '') + text + (source.match(/\s*$/)?.[0] ?? '');
  return text.replace(/\{([\w]+)\}/g, (token, key: string) => (vars && Object.hasOwn(vars, key) ? String(vars[key]) : token));
}
export function missingTranslations(): Array<{ language: string; source: string }> {
  return [...missing.values()];
}
export function clearMissingTranslations(): void {
  missing.clear();
}
export function replyLanguageInstruction(language: string): string {
  return `Answer in ${languageNames[normalizeLanguage(language)]} by default, even if the question uses another language. If the user explicitly requests another reply language, follow that request. Preserve names, numbers, currencies and user-provided content unless translation is requested.`;
}
/** Search equivalence only: never rewrite stored content or the text someone is composing. */
export function searchFold(value: string, language = 'en'): string {
  return value.normalize('NFC').toLocaleLowerCase(localeForLanguage(language));
}
