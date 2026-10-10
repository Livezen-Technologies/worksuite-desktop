import { describe, expect, it } from 'vitest';
import { meetPermissions, permissionLabel, permissionsMissing } from '@shared/meet-permissions';
import { wantedMeetKeys, type MeetKeyState } from '@shared/shortcuts';

/**
 * Settings › Meet › System permissions (WS-MEET-ENH-01 D05).
 *
 * The distinction this exists to protect: **not asked for is not denied**.
 * Only macOS gates the camera, microphone and screen capture; a row reading
 * "Not allowed" on Windows would send somebody hunting for a switch that does
 * not exist. And "unable to verify" is its own answer, because
 * docs/MACOS_PERMISSIONS.md records what happens when a contradictory
 * accessibility check is reported as a denial: people reset permissions that
 * were never the problem.
 */

const row = (facts: Parameters<typeof meetPermissions>[0], id: string) => meetPermissions(facts).find((r) => r.id === id)!;

describe('on a Mac, where the permissions are real', () => {
  const mac = { platform: 'darwin' as const };

  it('reads each media permission the system reports', () => {
    expect(row({ ...mac, camera: 'granted' }, 'camera').state).toBe('granted');
    expect(row({ ...mac, microphone: 'denied' }, 'microphone').state).toBe('denied');
    expect(row({ ...mac, screen: 'granted' }, 'screen').state).toBe('granted');
  });

  it('treats a restricted permission as denied, and says who can lift it', () => {
    const r = row({ ...mac, camera: 'restricted' }, 'camera');

    expect(r.state).toBe('denied');
    expect(r.detail).toMatch(/administrator/);
  });

  it('says a permission has not been asked for yet rather than calling it denied', () => {
    const r = row({ ...mac, microphone: 'not-determined' }, 'microphone');

    expect(r.state).toBe('unknown');
    expect(r.detail).toMatch(/asks the first time/);
  });

  it('calls a check that could not run unverified, not denied', () => {
    expect(row({ ...mac, camera: null }, 'camera').state).toBe('unknown');
  });

  it('offers the pane that grants each one', () => {
    expect(row({ ...mac }, 'camera').pane).toBe('camera');
    expect(row({ ...mac }, 'screen').pane).toBe('screen');
    expect(row({ ...mac, accessibility: 'denied' }, 'accessibility').pane).toBe('accessibility');
  });
});

describe('off a Mac, where there is nothing to grant', () => {
  const win = { platform: 'win32' as const };

  it('says the computer does not ask, and offers no pane to open', () => {
    const r = row(win, 'camera');

    expect(r.state).toBe('not_required');
    expect(r.detail).toMatch(/does not ask/);
    expect(r.pane).toBeUndefined();
  });

  it('counts none of them as missing', () => {
    expect(permissionsMissing(meetPermissions({ ...win, accessibility: 'not_required', notifications: 'granted' }))).toBe(0);
  });
});

describe('accessibility, which decides whether a share can be controlled', () => {
  it('explains what being denied costs, in those terms', () => {
    expect(row({ platform: 'darwin', accessibility: 'denied' }, 'accessibility').detail).toMatch(/see your screen but cannot control it/);
  });

  it('reads a check still running as not yet known', () => {
    expect(row({ platform: 'darwin', accessibility: 'checking' }, 'accessibility').state).toBe('unknown');
  });

  it('says nothing is needed where input needs no permission', () => {
    const r = row({ platform: 'win32', accessibility: 'not_required' }, 'accessibility');

    expect(r.state).toBe('not_required');
    expect(r.pane).toBeUndefined();
  });
});

describe('notifications, because an invitation arrives as one', () => {
  it('counts a refusal as not allowed, and says what it costs', () => {
    const r = row({ platform: 'darwin', notifications: 'blocked' }, 'notifications');

    expect(r.state).toBe('denied');
    expect(r.detail).toMatch(/invitation may not reach you/);
  });

  it('counts a computer that cannot show them at all as not allowed', () => {
    expect(row({ platform: 'linux', notifications: 'unsupported' }, 'notifications').state).toBe('denied');
  });

  it('does not claim to know when it cannot', () => {
    expect(row({ platform: 'darwin', notifications: 'unknown' }, 'notifications').state).toBe('unknown');
  });
});

describe('the table as a whole', () => {
  it('has the five rows the design draws, in its order', () => {
    expect(meetPermissions({ platform: 'darwin' }).map((r) => r.id)).toEqual(['camera', 'microphone', 'screen', 'accessibility', 'notifications']);
  });

  it('counts only real denials, which is what the "1 permission missing" line says', () => {
    const rows = meetPermissions({ platform: 'darwin', camera: 'granted', microphone: 'granted', screen: 'granted', accessibility: 'denied', notifications: 'granted' });

    expect(permissionsMissing(rows)).toBe(1);
  });

  it('reads each state the way a person would', () => {
    expect(['granted', 'denied', 'not_required', 'unknown'].map((s) => permissionLabel(s as never))).toEqual(['Allowed', 'Not allowed', 'Not needed', 'Unable to verify']);
  });
});

describe('the global-keys switch', () => {
  const state = (over: Partial<MeetKeyState> = {}): MeetKeyState => ({ signedIn: true, locked: false, meet: true, inCall: true, ...over });

  it('holds nothing for the whole computer when it is off', () => {
    // Somebody who wants ⌘⇧M back for another app can have it.
    expect(wantedMeetKeys(state({ globalKeys: false }))).toEqual([]);
  });

  it('holds them when it is on, and when it has never been set', () => {
    expect(wantedMeetKeys(state({ globalKeys: true })).length).toBeGreaterThan(0);
    expect(wantedMeetKeys(state()).length).toBeGreaterThan(0);
  });
});
