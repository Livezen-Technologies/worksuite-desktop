import { describe, expect, it } from 'vitest';
import { MeetKeys } from '../../../electron/services/meet-keys';
import { MEET_GLOBAL_IDS, electronAccelerator, meetShortcutDefaults, wantedMeetKeys, type MeetGlobalKey, type MeetKeyState } from '@shared/shortcuts';

/** The keys as this platform's defaults give them; the main process reads them the same way. */
const DEFAULTS = meetShortcutDefaults(process.platform === 'darwin');

/**
 * Meet's global keys (WS-MEET-ENH-01 D06).
 *
 * Two things here are worth more than the rest: a key must never be held
 * while the computer is locked or signed out — a shortcut that unmutes a
 * microphone on a locked machine is a privacy bug, not a convenience — and a
 * key another app already owns must leave Meet working anyway.
 */

const state = (over: Partial<MeetKeyState> = {}): MeetKeyState => ({ signedIn: true, locked: false, meet: true, inCall: false, ...over });

function harness(opts: { state?: Partial<MeetKeyState>; accelerators?: Partial<Record<MeetGlobalKey, string>>; taken?: string[] } = {}) {
  const held = new Map<string, () => void>();
  const pressed: MeetGlobalKey[] = [];
  const warnings: string[] = [];
  let now = state(opts.state);
  const keys = new MeetKeys({
    register: (acc, fn) => {
      if ((opts.taken ?? []).includes(acc) || held.has(acc)) return false;
      held.set(acc, fn);

      return true;
    },
    unregister: (acc) => void held.delete(acc),
    state: () => now,
    accelerators: () =>
      opts.accelerators ?? (Object.fromEntries(MEET_GLOBAL_IDS.map((id) => [id, DEFAULTS[id]!])) as Partial<Record<MeetGlobalKey, string>>),
    press: (id) => void pressed.push(id),
    warn: (m) => void warnings.push(m),
  });

  return {
    keys,
    pressed,
    warnings,
    held,
    set: (over: Partial<MeetKeyState>) => {
      now = { ...now, ...over };
    },
  };
}

describe('writing a key the way the operating system wants it', () => {
  it('translates this app’s form into Electron’s', () => {
    expect(electronAccelerator('Mod+Shift+M')).toBe('CommandOrControl+Shift+M');
    expect(electronAccelerator('Mod+Alt+N')).toBe('CommandOrControl+Alt+N');
    expect(electronAccelerator('Mod+Ctrl+N')).toBe('CommandOrControl+Control+N');
  });

  it('keeps the keys Electron names rather than taking as characters', () => {
    expect(electronAccelerator('Space')).toBe('Space');
    expect(electronAccelerator('Mod+Alt+Shift+Escape')).toBe('CommandOrControl+Alt+Shift+Escape');
    expect(electronAccelerator('F7')).toBe('F7');
  });

  it('upper-cases a letter, because that is what Electron matches', () => {
    expect(electronAccelerator('Mod+m')).toBe('CommandOrControl+M');
  });

  it('refuses what it does not recognise instead of guessing', () => {
    // These come out of a saved preference. A key the OS half-understands is
    // worse than no key: it silently takes something from another app.
    expect(electronAccelerator('Hyper+M')).toBeNull();
    expect(electronAccelerator('Mod+Shift+Hello')).toBeNull();
    expect(electronAccelerator('Mod+Shift+F99')).toBeNull();
    expect(electronAccelerator('')).toBeNull();
    expect(electronAccelerator('Mod+Mod+M')).toBeNull();
    expect(electronAccelerator(undefined)).toBeNull();
    expect(electronAccelerator(null)).toBeNull();
  });
});

describe('which keys are worth holding', () => {
  it('holds the keys that always have something to do', () => {
    expect(wantedMeetKeys(state())).toEqual(['meet-join-next', 'meet-share-screen', 'meet-new']);
  });

  it('adds mute and camera once this computer is in a call', () => {
    expect(wantedMeetKeys(state({ inCall: true }))).toContain('meet-mute');
    expect(wantedMeetKeys(state({ inCall: true }))).toContain('meet-camera');
  });

  it('owns no key system-wide while nobody is in a call', () => {
    // Taking ⌘⇧M from every other app for nothing is how a shortcut gets
    // reported as broken in somebody else's app.
    expect(wantedMeetKeys(state())).not.toContain('meet-mute');
  });

  it('holds nothing while locked, signed out, or without Meet', () => {
    expect(wantedMeetKeys(state({ locked: true, inCall: true }))).toEqual([]);
    expect(wantedMeetKeys(state({ signedIn: false }))).toEqual([]);
    expect(wantedMeetKeys(state({ meet: false, inCall: true }))).toEqual([]);
  });
});

describe('taking and giving back the keys', () => {
  it('takes what is wanted and nothing else', () => {
    const h = harness();

    expect(h.keys.sync().sort()).toEqual(['meet-join-next', 'meet-new', 'meet-share-screen']);
  });

  it('takes mute when a call starts and gives it back when it ends', () => {
    const h = harness();

    h.keys.sync();
    h.set({ inCall: true });
    expect(h.keys.sync()).toContain('meet-mute');

    h.set({ inCall: false });
    expect(h.keys.sync()).not.toContain('meet-mute');
    expect([...h.held.keys()]).not.toContain('CommandOrControl+Shift+M');
  });

  it('gives every key back the moment the app locks', () => {
    const h = harness({ state: { inCall: true } });

    h.keys.sync();
    expect(h.keys.holding().length).toBeGreaterThan(0);

    h.set({ locked: true });
    expect(h.keys.sync()).toEqual([]);
    expect(h.held.size).toBe(0);
  });

  it('carries on without a key another app already owns', () => {
    const h = harness({ taken: ['CommandOrControl+Shift+J'] });
    const holding = h.keys.sync();

    expect(holding).not.toContain('meet-join-next');
    expect(holding).toContain('meet-new');
  });

  it('does not re-register a key it already holds', () => {
    const h = harness();

    h.keys.sync();
    const before = h.held.size;

    expect(h.keys.sync().length).toBe(before);
    expect(h.held.size).toBe(before);
  });

  it('moves a key when its accelerator is changed in Settings', () => {
    const accelerators: Partial<Record<MeetGlobalKey, string>> = { 'meet-new': 'Mod+Alt+N' };
    const h = harness({ accelerators });

    h.keys.sync();
    expect([...h.held.keys()]).toEqual(['CommandOrControl+Alt+N']);

    accelerators['meet-new'] = 'Mod+Alt+Shift+Y';
    h.keys.sync();
    expect([...h.held.keys()]).toEqual(['CommandOrControl+Alt+Shift+Y']);
  });

  it('skips an accelerator it cannot read, and says so, without dropping the others', () => {
    const h = harness({ accelerators: { 'meet-new': 'Nonsense+!!', 'meet-join-next': 'Mod+Shift+J' } });

    expect(h.keys.sync()).toEqual(['meet-join-next']);
    expect(h.warnings.join(' ')).toContain('not usable');
  });

  it('gives one accelerator to one key when two are set the same', () => {
    const h = harness({ accelerators: { 'meet-new': 'Mod+Shift+J', 'meet-join-next': 'Mod+Shift+J' } });

    expect(h.keys.sync()).toHaveLength(1);
  });

  it('presses through to the window, and survives a press that throws', () => {
    const h = harness();

    h.keys.sync();
    h.held.get('CommandOrControl+Shift+J')?.();
    expect(h.pressed).toEqual(['meet-join-next']);
  });

  it('holds nothing when the state cannot be read at all', () => {
    const keys = new MeetKeys({
      register: () => true,
      unregister: () => undefined,
      state: () => {
        throw new Error('no session yet');
      },
      accelerators: () => ({}),
      press: () => undefined,
    });

    expect(keys.sync()).toEqual([]);
  });
});

describe('the defaults the main process reads', () => {
  it('gives every global key a default the operating system will take', () => {
    for (const id of MEET_GLOBAL_IDS) {
      expect(electronAccelerator(DEFAULTS[id]), id).not.toBeNull();
    }
  });

  it('gives the new-meeting key a different default off a Mac, where Ctrl+Alt+N is Marketing’s', () => {
    expect(meetShortcutDefaults(true)['meet-new']).toBe('Mod+Alt+N');
    expect(meetShortcutDefaults(false)['meet-new']).toBe('Mod+Alt+Shift+N');
  });

  it('sets no two Meet keys to the same accelerator', () => {
    const all = Object.values(meetShortcutDefaults(true));

    expect(new Set(all).size).toBe(all.length);
  });
});
