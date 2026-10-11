import { describe, expect, it } from 'vitest';
import { meetHomeWarning, meetPermissions, type MeetPermissionRow } from '../../../shared/meet-permissions';

/**
 * The amber line on Meet's home (WS-MEET-ENH-01 D01).
 *
 * What it protects: a home page that warns about a permission nobody has
 * refused — "unable to verify", or a permission this operating system does not
 * have — would warn on almost every machine, and a banner that is always there
 * is a banner nobody reads. So only an actual denial earns one, and only the
 * worst of them.
 */

const rows = (patch: Partial<Record<MeetPermissionRow['id'], MeetPermissionRow['state']>>): MeetPermissionRow[] =>
  (['camera', 'microphone', 'screen', 'accessibility', 'notifications'] as const).map((id) => ({
    id,
    label: id,
    state: patch[id] ?? 'granted',
    detail: '',
  }));

describe('the warning above Meet home', () => {
  it('says nothing while everything is allowed', () => {
    expect(meetHomeWarning(rows({}))).toBeNull();
  });

  it('says nothing before the answer has arrived', () => {
    // The first paint has no rows at all; a banner that flashed and vanished
    // would teach people to ignore the next one.
    expect(meetHomeWarning([])).toBeNull();
  });

  it('warns that remote control is limited when accessibility is refused', () => {
    const w = meetHomeWarning(rows({ accessibility: 'denied' }));

    expect(w?.id).toBe('accessibility');
    expect(w?.title).toMatch(/Remote control is limited/);
    // Said in terms of what it costs: seen, but not controlled.
    expect(w?.detail).toMatch(/cannot use your mouse or keyboard/);
  });

  it('prefers the blocked screen, which is the larger loss', () => {
    const w = meetHomeWarning(rows({ screen: 'denied', accessibility: 'denied' }));

    expect(w?.id).toBe('screen');
    expect(w?.title).toMatch(/Screen sharing is blocked/);
  });

  it('is silent when a permission is merely unverifiable', () => {
    expect(meetHomeWarning(rows({ accessibility: 'unknown', screen: 'unknown' }))).toBeNull();
  });

  it('is silent about permissions this computer does not have', () => {
    // Windows and Linux: nothing to grant, so nothing to fix in Settings.
    expect(meetHomeWarning(rows({ screen: 'not_required', accessibility: 'not_required' }))).toBeNull();
  });

  it('stays silent on a Windows machine with nothing granted', () => {
    // Through the real rows rather than a hand-made set, which is where a
    // not_required that read as denied would actually come from.
    expect(meetHomeWarning(meetPermissions({ platform: 'win32' }))).toBeNull();
  });

  it('warns on a Mac that refused screen recording', () => {
    expect(meetHomeWarning(meetPermissions({ platform: 'darwin', screen: 'denied' }))?.id).toBe('screen');
  });

  it('does not warn on a Mac that has simply never been asked', () => {
    expect(meetHomeWarning(meetPermissions({ platform: 'darwin', screen: 'not-determined', accessibility: 'checking' }))).toBeNull();
  });
});
