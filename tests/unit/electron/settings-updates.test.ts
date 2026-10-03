import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../electron/services/db';
import { DEFAULT_POLICY } from '../../../electron/services/policy';
import { preferencesPatchSchema } from '../../../shared/ipc/contract';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
const { SettingsService } = await import('../../../electron/services/settings');

function database(initial?: unknown) {
  let stored = initial;
  return { getConfig: () => stored, setConfig: (_: string, value: unknown) => { stored = value; } } as unknown as Database;
}

describe('Settings › Desktop › Updates', () => {
  it('starts on: new versions download by themselves, and say so', () => {
    const p = new SettingsService(database()).effective();
    expect(p.autoUpdate).toBe(true);
    expect(p.updateNotifications).toBe(true);
  });

  it('can be turned off where the organization leaves it to the person', () => {
    const settings = new SettingsService(database({}));
    settings.setPolicy({ ...DEFAULT_POLICY, auto_update: 'user_choice' });
    settings.update({ autoUpdate: false, updateNotifications: false });
    expect(settings.effective()).toMatchObject({ autoUpdate: false, updateNotifications: false });
    expect(settings.locks().map((l) => l.key)).not.toContain('autoUpdate');
  });

  it('stays on, with the reason, where the organization enforces updates', () => {
    const settings = new SettingsService(database({ autoUpdate: false }));
    settings.setPolicy({ ...DEFAULT_POLICY, auto_update: 'enforced' });
    expect(settings.effective().autoUpdate).toBe(true);
    expect(settings.locks()).toContainEqual({ key: 'autoUpdate', reason: 'Your organization keeps WorkSuite up to date automatically.' });
    // Notifications about it stay the person's choice.
    expect(settings.locks().map((l) => l.key)).not.toContain('updateNotifications');
  });

  it('takes only on or off at the IPC boundary', () => {
    expect(preferencesPatchSchema.safeParse({ autoUpdate: false, updateNotifications: true }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ autoUpdate: 'never' }).success).toBe(false);
  });
});
