import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../electron/services/db';
import { preferencesPatchSchema } from '../../../shared/ipc/contract';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
const { SettingsService } = await import('../../../electron/services/settings');

function database(initial?: unknown) {
  let stored = initial;
  return { getConfig: () => stored, setConfig: (_: string, value: unknown) => { stored = value; } } as unknown as Database;
}

describe('Settings › Chat › Chat drawer opens as (#264)', () => {
  it('is unset at first (docked), and kept on this computer once chosen', () => {
    expect(new SettingsService(database()).effective().chatDrawer).toBeUndefined();
    const db = database({});
    new SettingsService(db).update({ chatDrawer: 'floating' });
    expect(new SettingsService(db).effective().chatDrawer).toBe('floating');
  });

  it('takes only docked or floating at the IPC boundary', () => {
    expect(preferencesPatchSchema.safeParse({ chatDrawer: 'docked' }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ chatDrawer: 'floating' }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ chatDrawer: 'sideways' }).success).toBe(false);
  });
});
