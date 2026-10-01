import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../electron/services/db';
import { preferencesPatchSchema } from '../../../shared/ipc/contract';
import { DARK_PROFILE_IDS } from '../../../shared/theme-profiles';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
const { SettingsService } = await import('../../../electron/services/settings');

function database(initial?: unknown) {
  let stored = initial;
  return { getConfig: () => stored, setConfig: (_: string, value: unknown) => { stored = value; } } as unknown as Database;
}

describe('Dark color profile preferences (#73)', () => {
  it('defaults old and invalid preferences to the existing Blue profile', () => {
    for (const saved of [undefined, { theme: 'system' }, { darkColorProfile: 'invalid' }, { darkColorProfile: null }]) {
      expect(new SettingsService(database(saved)).effective().darkColorProfile).toBe('blue');
    }
  });
  it.each(DARK_PROFILE_IDS)('validates, saves, broadcasts and restores %s across sessions', (id) => {
    expect(preferencesPatchSchema.parse({ darkColorProfile: id })).toEqual({ darkColorProfile: id });
    const db = database({ theme: 'system' });
    const settings = new SettingsService(db);
    const changed = vi.fn(); settings.onChange(changed);
    settings.update({ darkColorProfile: id });
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ theme: 'system', darkColorProfile: id }));
    expect(new SettingsService(db).effective().darkColorProfile).toBe(id);
  });
  it('rejects unsupported profile identifiers at the IPC boundary', () => {
    for (const id of ['pink', '', null, 1]) expect(preferencesPatchSchema.safeParse({ darkColorProfile: id }).success).toBe(false);
  });
});
