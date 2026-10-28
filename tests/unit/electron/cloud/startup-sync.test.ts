import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_STARTUP, startupConfigV1, type StartupConfig } from '@shared/startup-config';
import { StartupSync, startupFromDiscovery } from '../../../../electron/services/cloud/startup-sync';

const cfg = (over: Record<string, unknown> = {}): StartupConfig => startupConfigV1.parse(over);

function sync(answers: Array<unknown | Error>, discovery: StartupConfig = DEFAULT_STARTUP, policy: Parameters<typeof startupFromDiscovery>[1] = null) {
  let i = 0;
  const get = vi.fn(() => {
    const a = answers[Math.min(i++, answers.length - 1)];
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  });
  return { s: new StartupSync({ get: get as never, policy: () => policy, fromDiscovery: () => discovery }), get };
}

describe('startup sync', () => {
  it('takes the organization’s configuration over what discovery said', async () => {
    const { s } = sync([{ startup: { config_version: 4, methods: { google: false } }, organization_id: 'org_1' }]);
    const out = await s.refresh();
    expect(out.methods.google).toBe(false);
    expect(s.state()).toMatchObject({ version: 4, organizationId: 'org_1' });
  });

  it('keeps the configuration in force when the server cannot be reached', async () => {
    const { s } = sync([{ startup: { config_version: 3, methods: { apple: false } } }, new Error('offline')]);
    await s.refresh();
    const after = await s.refresh();
    expect(after.methods.apple).toBe(false);
    expect(s.state()?.version).toBe(3);
  });

  it('ignores an unreadable answer', async () => {
    const { s } = sync([{ startup: { methods: 'nonsense' } }]);
    const out = await s.refresh();
    expect(out).toEqual(DEFAULT_STARTUP);
    expect(s.state()).toBeNull();
  });

  it('never goes back to an older version', async () => {
    const { s } = sync([{ startup: { config_version: 9, methods: { passkey: false } } }, { startup: { config_version: 2, methods: { passkey: true } } }]);
    await s.refresh();
    const out = await s.refresh();
    expect(out.methods.passkey).toBe(false);
    expect(s.state()?.version).toBe(9);
  });

  it('does nothing at all when nobody is signed in', async () => {
    const s = new StartupSync({ get: () => null, policy: () => null, fromDiscovery: () => cfg({ methods: { guest: false } }) });
    expect((await s.refresh()).methods.guest).toBe(false);
    expect(s.state()).toBeNull();
  });

  it('applies local policy over whatever was synced', async () => {
    const { s } = sync([{ startup: { config_version: 1, methods: { personal: true } } }], DEFAULT_STARTUP, { allowPersonal: false });
    expect((await s.refresh()).methods.personal).toBe(false);
  });

  it('prefers discovery while it is newer than the last sync', async () => {
    const { s } = sync([{ startup: { config_version: 1, methods: { meeting: false } } }], cfg({ config_version: 5, methods: { meeting: true } }));
    expect((await s.refresh()).methods.meeting).toBe(true);
  });

  it('forgets the synced copy when the account goes', async () => {
    const { s } = sync([{ startup: { config_version: 2, methods: { email: false, google: true } } }]);
    await s.refresh();
    s.forget();
    expect(s.state()).toBeNull();
    expect(s.current()).toEqual(DEFAULT_STARTUP);
  });

  it('reads a discovery document under local policy', () => {
    expect(startupFromDiscovery({ startup: { methods: { guest: false } } }, { allowPersonal: false }).methods).toMatchObject({ guest: false, personal: false });
  });
});
