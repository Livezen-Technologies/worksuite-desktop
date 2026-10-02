import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { AiPrefs } from '@shared/types';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, on: () => undefined } }));

import { chord, QuickAsk, type Clip } from '../../../electron/services/quick-ask';
import type { InputAction, Injector } from '../../../electron/services/remote-control/input';

/** A clipboard, and an app in front that copies "selected words" when Ctrl/Cmd+C is pressed. */
function world(opts: { selected?: string; copies?: boolean; primary?: string } = {}) {
  let text = 'what was copied before';
  const items = [{ kind: 'original' }];
  let restoredItems: unknown[] | null = null;
  const clip: Clip = {
    readText: async () => text,
    writeText: async (t) => void (text = t),
    read: async () => items,
    write: async (i) => {
      restoredItems = i;
      text = 'what was copied before';
    },
    selection: { readText: async () => opts.primary ?? '' },
  };
  const sent: InputAction[][] = [];
  const helper = {
    send: (a: InputAction[]) => {
      sent.push(a);
      if (opts.copies !== false && a.some((x) => x.t === 'key' && x.code === 'KeyC' && x.down)) text = opts.selected ?? '';
    },
    foreground: async () => ({ window: '1', app: 'Pages', title: 'Client letter' }),
  } as unknown as Injector;
  return { clip, helper, sent, get text() { return text; }, get restored() { return restoredItems; } };
}

const prefs: AiPrefs = { quickAsk: true, shortcut: 'Alt+Space', insert: true, dockAtStart: false, language: 'Sinhala', display: 'drawer', sound: false, moduleAccess: { worksuite: {}, local: {} }, onlineFallback: true, autoMinimize: false, autoMinimizeWhenWorking: true };
function make(w: ReturnType<typeof world>, platform: NodeJS.Platform, helper: Injector | null = w.helper, over: Partial<{ allowed: boolean; register: boolean }> = {}) {
  const shown = vi.fn();
  const hidden = vi.fn();
  const registered: string[] = [];
  const q = new QuickAsk({
    clipboard: w.clip,
    platform,
    injector: async () => helper,
    prefs: () => prefs,
    allowed: () => over.allowed ?? true,
    register: (acc) => {
      if (over.register === false) return false;
      registered.push(acc);
      return true;
    },
    unregister: (acc) => registered.splice(registered.indexOf(acc), 1),
    show: shown,
    hide: hidden,
    sleep: async () => undefined,
  });
  return { q, shown, hidden, registered };
}

describe('Quick Ask (AI Assistant)', () => {
  it('copies with Cmd on a Mac and Ctrl elsewhere, letting go of the shortcut first', () => {
    expect(chord('darwin', 'C').map((a) => (a.t === 'key' ? `${a.code}${a.down ? '↓' : '↑'}` : ''))).toEqual(['AltLeft↑', 'ShiftLeft↑', 'MetaLeft↓', 'KeyC↓', 'KeyC↑', 'MetaLeft↑']);
    expect(chord('win32', 'V')[2]).toEqual({ t: 'key', code: 'ControlLeft', down: true });
  });

  it('reads the selection by copying it, then puts the clipboard back as it was', async () => {
    const w = world({ selected: 'Thank you for choosing CreativeFX.' });
    const { q, shown } = make(w, 'win32');
    await q.open();
    expect(q.context()).toEqual({ text: 'Thank you for choosing CreativeFX.', source: 'selection', app: 'Pages', canInsert: true, note: null });
    expect(w.restored).toEqual([{ kind: 'original' }]);
    expect(w.text).toBe('what was copied before');
    expect(shown).toHaveBeenCalled();
  });

  it('says so when nothing was selected, and never mistakes the old clipboard for a selection', async () => {
    const w = world({ copies: false });
    const { q } = make(w, 'darwin');
    await q.open();
    expect(q.context()).toMatchObject({ text: '', source: 'none', note: 'Nothing was selected. Type or paste the text instead.' });
  });

  it('on Linux reads the X11 selection as it is, pressing nothing', async () => {
    const w = world({ primary: 'selected on X11' });
    const { q } = make(w, 'linux');
    await q.open();
    expect(q.context()).toMatchObject({ text: 'selected on X11', source: 'selection', canInsert: true });
    expect(w.sent).toEqual([]);
  });

  it('without the keyboard helper (no Accessibility on a Mac), offers what was copied last and says why', async () => {
    const w = world();
    const { q } = make(w, 'darwin', null);
    await q.open();
    expect(q.context()).toMatchObject({ text: 'what was copied before', source: 'clipboard', canInsert: false });
    expect(q.context().note).toMatch(/Accessibility/);
    expect(await q.insert('x')).toBe(false);
  });

  it('inserts only on request: pastes into the app, then puts the clipboard back', async () => {
    const w = world({ selected: 'hello' });
    const { q, hidden } = make(w, 'win32');
    await q.open();
    w.sent.length = 0;
    expect(await q.insert('ආයුබෝවන්')).toBe(true);
    expect(hidden).toHaveBeenCalled();
    expect(w.sent[0]!.some((a) => a.t === 'key' && a.code === 'KeyV' && a.down)).toBe(true);
    expect(w.text).toBe('what was copied before');
  });

  it('registers its shortcut only while allowed, and says when another app has it', () => {
    const w = world();
    const on = make(w, 'win32');
    on.q.sync();
    expect(on.registered).toEqual(['Alt+Space']);
    expect(on.q.shortcut()).toBe('Alt+Space');
    on.q.release();
    expect(on.registered).toEqual([]);
    const off = make(w, 'win32', w.helper, { allowed: false });
    off.q.sync();
    expect(off.registered).toEqual([]);
    const taken = make(w, 'win32', w.helper, { register: false });
    taken.q.sync();
    expect(taken.q.shortcut()).toBeNull();
  });

  it('does nothing when not allowed (signed out, locked, no ai.write)', async () => {
    const w = world({ selected: 'secret' });
    const { q, shown } = make(w, 'win32', w.helper, { allowed: false });
    await q.open();
    expect(shown).not.toHaveBeenCalled();
    expect(w.sent).toEqual([]);
  });
});
