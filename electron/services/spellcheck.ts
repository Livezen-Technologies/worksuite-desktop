import { BrowserWindow, Menu, type MenuItemConstructorOptions, type Session, type WebContents } from 'electron';

/**
 * Spell check in the app's windows (worksuite-desktop#188).
 *
 * Chromium's spell checker is on in every window (`spellcheck: true`); what
 * it lacked was a way to act on it — a right-click on an underlined word
 * now offers its suggestions, "Add to dictionary", and cut/copy/paste.
 *
 * Languages: on Windows and Linux Chromium checks with its own Hunspell
 * dictionaries, chosen with `session.setSpellCheckerLanguages` (and kept by
 * Chromium in the profile). Chromium has no Sinhala dictionary, so Sinhala
 * is offered as unavailable and says why rather than pretending to check.
 * On macOS the system's spell checker decides the language and the choice
 * here does nothing, which the setting says too.
 */

export interface SpellChoice {
  code: string;
  label: string;
  available: boolean;
  reason?: string;
}

export interface SpellState {
  choices: SpellChoice[];
  current: string[];
  /** macOS: the system spell checker picks the language. */
  system: boolean;
}

const OFFERED: Array<[string, string]> = [
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['si', 'Sinhala'],
  ['ta', 'Tamil'],
];

/** The languages offered in Mail's settings, each said to be available here or not (and why). */
export function spellChoices(available: string[], platform: NodeJS.Platform): SpellChoice[] {
  const has = new Set(available.map((a) => a.toLowerCase()));
  return OFFERED.map(([code, label]) => {
    if (platform === 'darwin') return { code, label, available: false, reason: 'On macOS, spelling follows the languages set in System Settings › Keyboard › Text Input.' };
    const ok = has.has(code.toLowerCase()) || (code.length === 2 && [...has].some((a) => a.startsWith(`${code}-`)));
    return ok ? { code, label, available: true } : { code, label, available: false, reason: code === 'si' ? 'No Sinhala spelling dictionary is available for the spell checker, so Sinhala text is not checked.' : `No ${label} spelling dictionary is available on this computer.` };
  });
}

export function spellState(session: Session, platform: NodeJS.Platform = process.platform): SpellState {
  const available = platform === 'darwin' ? [] : session.availableSpellCheckerLanguages;
  return { choices: spellChoices(available, platform), current: platform === 'darwin' ? [] : session.getSpellCheckerLanguages(), system: platform === 'darwin' };
}

/** Sets the languages the spell checker uses, keeping only ones it has; at least one stays on. */
export function setSpellLanguages(session: Session, wanted: string[], platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'darwin') return [];
  const ok = new Set(spellChoices(session.availableSpellCheckerLanguages, platform).filter((c) => c.available).map((c) => c.code));
  const list = wanted.filter((w) => ok.has(w));
  session.setSpellCheckerLanguages(list.length ? list : ['en-US']);
  return session.getSpellCheckerLanguages();
}

/** The right-click menu on a misspelt word: suggestions, add to dictionary, and the editing basics. */
export function spellingMenuTemplate(params: { misspelledWord: string; dictionarySuggestions: string[] }, contents: Pick<WebContents, 'replaceMisspelling' | 'session'>): MenuItemConstructorOptions[] {
  const suggestions: MenuItemConstructorOptions[] = params.dictionarySuggestions.slice(0, 6).map((s) => ({ label: s, click: () => contents.replaceMisspelling(s) }));
  return [
    ...(suggestions.length ? suggestions : [{ label: 'No suggestions', enabled: false }]),
    { type: 'separator' },
    { label: 'Add to dictionary', click: () => void contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
  ];
}

/** A window's spelling menu. Pages that draw their own context menu (they cancel the event) are left alone. */
export function attachSpellingMenu(contents: WebContents): void {
  if (contents.getType() !== 'window') return;
  contents.on('context-menu', (_e, params) => {
    if (!params.isEditable || !params.misspelledWord) return;
    const menu = Menu.buildFromTemplate(spellingMenuTemplate(params, contents));
    menu.popup({ window: BrowserWindow.fromWebContents(contents) ?? undefined });
  });
}
