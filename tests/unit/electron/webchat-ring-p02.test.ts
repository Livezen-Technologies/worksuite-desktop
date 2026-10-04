import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { WebchatRingPrefs, WebchatRingState } from '@shared/types';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, on: () => undefined },
  BrowserWindow: class {},
  screen: {},
}));

import { toneFor, WebchatRinger, type PendingAnswer, type RingingEntry } from '../../../electron/services/webchat-ring';
import { focusFromAssertions, focusFromGsettings, SystemFocus } from '../../../electron/services/system-focus';
import { defaultPreferences } from '../../../electron/services/settings';
import { contract } from '../../../shared/ipc/contract';
import type { HttpClient } from '../../../electron/services/http';

/**
 * P-02 "Desktop notifications & calls settings" in the main process (RING-UI-08; RING-29, RING-42, RING-47, RING-48):
 * the ringtone the server keeps reaches the ring, where it plays is the person's choice, the system's own Focus / Do
 * not disturb counts as Do not disturb, and the defaults ring on speakers and headset and start with the computer.
 */
const stamp = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
const entry = (over: Partial<RingingEntry> = {}): RingingEntry => ({ id: 3, conversation_id: 3, visitor: 'Visitor 4F2A', site: 'techubiz.com', kind: 'waiting', mine: false, since: stamp(5000), silenced: false, others_ringing: 2, ...over });

function ringer(answer: PendingAnswer, prefs: WebchatRingPrefs = { window: true, duringDnd: 'card', shortcut: true, volume: 80 }) {
  return new WebchatRinger({
    http: { get: vi.fn(async () => answer), post: vi.fn(async () => ({})), request: vi.fn(async () => ({})) } as unknown as HttpClient,
    signedIn: () => true,
    locked: () => false,
    me: () => 5,
    prefs: () => prefs,
    quiet: () => false,
    open: () => undefined,
    onChanged: (_s: WebchatRingState) => undefined,
    deviceId: () => 'desktop-12',
    focused: () => false,
  });
}

describe('the ringtone and output reach the ring (RING-29, RING-42)', () => {
  it('plays the ringtone my ringing settings keep on the server, Classic phone until it says', async () => {
    const r = ringer({ ringing: [entry()], ring_prefs: { ringtone: 'bright' } });
    expect(r.state().ringtone).toBe('classic');
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect(r.state().ringtone).toBe('bright');
    expect(r.state().ringOn).toBe('both');
    r.stop();
  });

  it('ignores a ringtone name it cannot use, and an older server that sends none', async () => {
    const r = ringer({ ringing: [entry()], ring_prefs: { ringtone: '<b>loud</b>' } });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect(r.state().ringtone).toBe('classic');
    r.stop();
  });

  it('rings on the system output only when I chose so', () => {
    expect(ringer({}, { window: true, duringDnd: 'card', shortcut: true, volume: 80, ringOn: 'default' }).state().ringOn).toBe('default');
  });

  it('defaults: speakers and headset, the Live shortcuts on, start at login and keep in the tray (RING-42, RING-48)', () => {
    const d = defaultPreferences();
    expect(d.webchatRinging.ringOn).toBe('both');
    expect(d.webchatRinging.liveShortcuts).toBe(true);
    expect(d.startWithOs).toBe(true);
    expect(d.minimizeToTray).toBe(true);
  });

  it('settings:set takes Ring on and the Live shortcuts, and still takes what an older window sends', () => {
    const schema = contract['settings:set'].input;
    const base = { window: true, duringDnd: 'card', shortcut: true, volume: 80 };
    expect(schema.safeParse({ webchatRinging: { ...base, ringOn: 'default', liveShortcuts: false } }).success).toBe(true);
    expect(schema.safeParse({ webchatRinging: base }).success).toBe(true);
    expect(schema.safeParse({ webchatRinging: { ...base, ringOn: 'everywhere' } }).success).toBe(false);
  });
});

describe('system Focus / Do not disturb (RING-47)', () => {
  it('reads a Focus turned on by hand from macOS, and nothing from what it cannot read', () => {
    expect(focusFromAssertions(JSON.stringify({ data: [{ storeAssertionRecords: [{ assertionDetails: { assertionDetailsModeIdentifier: 'com.apple.donotdisturb.mode.default' } }] }] }))).toBe(true);
    expect(focusFromAssertions(JSON.stringify({ data: [{ storeAssertionRecords: [] }] }))).toBe(false);
    expect(focusFromAssertions(JSON.stringify({ data: [{}] }))).toBe(false);
    expect(focusFromAssertions('not json')).toBeNull();
    expect(focusFromAssertions('{}')).toBeNull();
  });

  it('reads GNOME’s Do not disturb (banners off)', () => {
    expect(focusFromGsettings('false\n')).toBe(true);
    expect(focusFromGsettings('true\n')).toBe(false);
    expect(focusFromGsettings('')).toBeNull();
  });

  it('says when it turns on and off; what cannot be read is off, and Windows is never read', async () => {
    let banners = 'true';
    const changes: boolean[] = [];
    const f = new SystemFocus({ platform: 'linux', run: async () => banners, onChange: (on) => changes.push(on) });
    expect(await f.check()).toBe(false);
    banners = 'false';
    expect(await f.check()).toBe(true);
    expect(f.active()).toBe(true);
    const failing = new SystemFocus({ platform: 'linux', run: async () => Promise.reject(new Error('no gsettings')) });
    expect(await failing.check()).toBe(false);
    banners = 'true';
    await f.check();
    expect(changes).toEqual([true, false]);
    const run = vi.fn(async () => 'false');
    const win = new SystemFocus({ platform: 'win32', run });
    win.start();
    expect(await win.check()).toBe(false);
    expect(run).not.toHaveBeenCalled();
    win.stop();
    const mac = new SystemFocus({ platform: 'darwin', readFile: async () => Promise.reject(new Error('EPERM')) });
    expect(await mac.check()).toBe(false);
  });

  it('during Focus the window shows without the tone by default, and my choice decides (RING-47)', () => {
    const chats = [{ id: 1, visitor: 'V', site: null, page: null, place: null, device: null, returning: false, preview: null, priority: 'normal' as const, offline: false, since: stamp(5000), stage: 'first' as const, atRisk: false, mine: false, by: null, silenced: false }];
    const now = Date.now();
    expect(toneFor(chats, { ringSeconds: 0, quiet: true, duringDnd: 'card', now })).toBe('off');
    expect(toneFor(chats, { ringSeconds: 0, quiet: true, duringDnd: 'ring', now })).toBe('normal');
    expect(toneFor([{ ...chats[0]!, atRisk: true }], { ringSeconds: 0, quiet: true, duringDnd: 'at_risk', now })).toBe('strong');
  });
});
