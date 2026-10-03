import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => null }, Menu: { buildFromTemplate: (t: unknown) => ({ items: t, popup: vi.fn() }) } }));

import { setSpellLanguages, spellChoices, spellingMenuTemplate, spellState } from '../../../electron/services/spellcheck';

/**
 * Spell check (worksuite-desktop#188): the languages Mail's settings offer
 * are the ones this computer's spell checker has — Sinhala, which Chromium
 * has no dictionary for, is shown unavailable with the reason — and a
 * right-click on a misspelt word offers its corrections.
 */

const CHROMIUM = ['af', 'en-AU', 'en-CA', 'en-GB', 'en-US', 'es', 'fr', 'ta', 'uk'];

function fakeSession(current = ['en-US']) {
  let langs = current;
  return {
    availableSpellCheckerLanguages: CHROMIUM,
    getSpellCheckerLanguages: () => langs,
    setSpellCheckerLanguages: vi.fn((l: string[]) => {
      langs = l;
    }),
    addWordToSpellCheckerDictionary: vi.fn(() => true),
  };
}

describe('spell check languages', () => {
  it('offers English and Tamil where the dictionaries exist, and says plainly that Sinhala has none', () => {
    const choices = spellChoices(CHROMIUM, 'win32');
    expect(choices.map((c) => [c.code, c.available])).toEqual([
      ['en-US', true],
      ['en-GB', true],
      ['si', false],
      ['ta', true],
    ]);
    expect(choices.find((c) => c.code === 'si')!.reason).toMatch(/No Sinhala spelling dictionary/);
  });

  it('leaves the language to the system on macOS', () => {
    expect(spellChoices(CHROMIUM, 'darwin').every((c) => !c.available && /System Settings/.test(c.reason!))).toBe(true);
    const s = fakeSession();
    expect(spellState(s as never, 'darwin')).toMatchObject({ system: true, current: [] });
    expect(setSpellLanguages(s as never, ['en-GB'], 'darwin')).toEqual([]);
    expect(s.setSpellCheckerLanguages).not.toHaveBeenCalled();
  });

  it('sets only languages it has, and never none', () => {
    const s = fakeSession();
    expect(setSpellLanguages(s as never, ['en-GB', 'si', 'ta'], 'linux')).toEqual(['en-GB', 'ta']);
    expect(setSpellLanguages(s as never, ['si'], 'linux')).toEqual(['en-US']);
    expect(spellState(s as never, 'linux').current).toEqual(['en-US']);
  });
});

describe('the spelling menu', () => {
  it('offers the corrections, adds a word to the dictionary, and keeps cut, copy and paste', () => {
    const replaceMisspelling = vi.fn();
    const session = fakeSession();
    const items = spellingMenuTemplate({ misspelledWord: 'recieve', dictionarySuggestions: ['receive', 'relieve'] }, { replaceMisspelling, session } as never);
    expect(items.map((i) => i.label ?? i.role ?? i.type)).toEqual(['receive', 'relieve', 'separator', 'Add to dictionary', 'separator', 'cut', 'copy', 'paste']);
    (items[0]!.click as () => void)();
    expect(replaceMisspelling).toHaveBeenCalledWith('receive');
    (items[3]!.click as () => void)();
    expect(session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith('recieve');
    const none = spellingMenuTemplate({ misspelledWord: 'qzx', dictionarySuggestions: [] }, { replaceMisspelling, session } as never);
    expect(none[0]).toMatchObject({ label: 'No suggestions', enabled: false });
  });
});
