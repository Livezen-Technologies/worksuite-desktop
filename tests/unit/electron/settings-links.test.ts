import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../electron/services/db';
import { preferencesPatchSchema } from '../../../shared/ipc/contract';
import { linkPrefs } from '../../../shared/link-prefs';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
const { SettingsService } = await import('../../../electron/services/settings');

function database(initial?: unknown) {
  let stored = initial;
  return { getConfig: () => stored, setConfig: (_: string, value: unknown) => { stored = value; } } as unknown as Database;
}

describe('Settings › Desktop › Links (#170)', () => {
  it('starts on: links open in the app, Mail links in a new tab, actions ask first', () => {
    expect(linkPrefs(new SettingsService(database()).effective())).toEqual({ openInApp: true, mailLinks: 'new-tab', confirmActions: true });
  });

  it('saves one setting at a time, keeping the others, across sessions', () => {
    const db = database({});
    const settings = new SettingsService(db);
    settings.update({ links: { mailLinks: 'current-tab' } });
    settings.update({ links: { confirmActions: false } });
    expect(linkPrefs(new SettingsService(db).effective())).toEqual({ openInApp: true, mailLinks: 'current-tab', confirmActions: false });
  });

  it('takes only known values at the IPC boundary', () => {
    expect(preferencesPatchSchema.safeParse({ links: { openInApp: false } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ links: { mailLinks: 'window' } }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ links: { confirmActions: 'no' } }).success).toBe(false);
  });
});
