import { describe, expect, it, vi } from 'vitest';
import type { PolicyHttp } from '../../../electron/services/launcher-defaults';

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }));
const { saveLauncherDefaults } = await import('../../../electron/services/launcher-defaults');
const { normalizePolicy } = await import('../../../electron/services/policy');
const { contract } = await import('../../../shared/ipc/contract');

/** The organization's app launcher defaults (worksuite-desktop#201): two keys of its desktop policy. */
function fakeHttp(policies: unknown[]) {
  const put = vi.fn(async (..._a: unknown[]) => ({}));
  const get = vi.fn(async () => ({ policies }));
  const http = {
    get,
    request: vi.fn(async (method: string, path: string, opts?: { body?: unknown }) => put(method, path, opts?.body)),
  } as unknown as PolicyHttp;
  return { put, get, http };
}

describe('organization launcher defaults', () => {
  it('adds them to the organization\'s policy, keeping its other keys', async () => {
    const { http, put } = fakeHttp([
      { scope: 'platform', scope_id: 0, policy: { downloads: 'disabled' } },
      { scope: 'organization', scope_id: 4, policy: { clipboard_paste: false, launcher_order: ['old'] } },
    ]);
    const saved = await saveLauncherDefaults(http, '4', { pinned: ['mail', 'chat', 'mail', 'NOT AN ID'], order: ['chat', 'mail'] });
    expect(saved).toEqual({ pinned: ['mail', 'chat'], order: ['chat', 'mail'] });
    expect(put).toHaveBeenCalledWith('PUT', '/desktop/v1/admin/policies/organization:4', { policy: { clipboard_paste: false, launcher_pinned: ['mail', 'chat'], launcher_order: ['chat', 'mail'] } });
  });

  it('takes at most 8 pinned apps, and clears a default by removing its keys', async () => {
    const { http, put } = fakeHttp([{ scope: 'organization', scope_id: '4', policy: { launcher_pinned: ['mail'], launcher_order: ['mail'], proxy: 'pac' } }]);
    const many = Array.from({ length: 12 }, (_, i) => `app${i}`);
    expect((await saveLauncherDefaults(http, '4', { pinned: many, order: [] })).pinned).toHaveLength(8);
    await saveLauncherDefaults(http, '4', { pinned: [], order: [] });
    expect(put).toHaveBeenLastCalledWith('PUT', '/desktop/v1/admin/policies/organization:4', { policy: { proxy: 'pac' } });
  });

  it('starts a policy for an organization that has none', async () => {
    const { http, put } = fakeHttp([]);
    await saveLauncherDefaults(http, '9', { pinned: ['tasks'], order: [] });
    expect(put).toHaveBeenCalledWith('PUT', '/desktop/v1/admin/policies/organization:9', { policy: { launcher_pinned: ['tasks'] } });
  });

  it('refuses an organization id that is not one', async () => {
    const { http, get } = fakeHttp([]);
    await expect(saveLauncherDefaults(http, 'all', { pinned: [], order: [] })).rejects.toThrow('Choose an organization first.');
    expect(get).not.toHaveBeenCalled();
  });

  it('is only for whoever may set desktop policy', () => {
    expect(contract['settings:launcherDefaults'].permission).toBe('desktop.policies.manage');
    expect(contract['settings:launcherDefaults'].input.safeParse({ organizationId: '4', pinned: Array.from({ length: 9 }, (_, i) => `a${i}`), order: [] }).success).toBe(false);
    expect(contract['settings:launcherDefaults'].input.safeParse({ organizationId: '4', pinned: ['mail'], order: ['mail'] }).success).toBe(true);
  });

  it('reaches every device in the policy, cleaned', () => {
    const p = normalizePolicy({ launcher_pinned: ['mail', 'mail', 3, 'chat', 'a', 'b', 'c', 'd', 'e', 'f', 'g'], launcher_order: 'mail' }, true);
    expect(p.launcher_pinned).toEqual(['mail', 'chat', 'a', 'b', 'c', 'd', 'e', 'f']);
    expect(p.launcher_order).toEqual([]);
    expect(normalizePolicy({}, false)).toMatchObject({ launcher_pinned: [], launcher_order: [] });
  });
});
