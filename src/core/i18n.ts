import { useSyncExternalStore } from 'react';
import type { AppDefinition } from '@shared/apps';
import { MESSAGES, RTL_LANGUAGES, type MessageKey } from './locales';

/**
 * UI language and direction (FR-L10N-01). English is complete; Sinhala,
 * Tamil, Arabic and Hindi cover the shell and fall back to English for
 * anything not yet translated. Arabic switches the layout to right-to-left.
 */
let lang = 'en';
const subs = new Set<() => void>();

export function setLanguage(next: string | null | undefined): void {
  const l = (next ?? 'en').split('-')[0]!;
  const chosen = l in MESSAGES ? l : 'en';
  if (chosen === lang && document.documentElement.lang === chosen) return;
  lang = chosen;
  document.documentElement.lang = chosen;
  document.documentElement.dir = RTL_LANGUAGES.has(chosen) ? 'rtl' : 'ltr';
  for (const fn of subs) fn();
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const table = MESSAGES[lang] ?? {};
  let s = table[key] ?? MESSAGES.en?.[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Re-renders a component when the language changes. */
export function useLanguage(): string {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => lang,
  );
}

export const LANGUAGES: Array<{ id: string; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'si', label: 'සිංහල (Sinhala)' },
  { id: 'ta', label: 'தமிழ் (Tamil)' },
  { id: 'ar', label: 'العربية (Arabic)' },
  { id: 'hi', label: 'हिन्दी (Hindi)' },
];

/** An app's label in the current language, where the shell has one. */
export function appLabel(a: Pick<AppDefinition, 'id' | 'label'>): string {
  const key = `nav.${a.id}` as MessageKey;
  return key in MESSAGES.en! ? t(key) : a.label;
}
