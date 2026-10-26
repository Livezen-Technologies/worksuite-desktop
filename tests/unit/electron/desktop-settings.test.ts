import { describe, expect, it, vi } from 'vitest';
import { featureKey, moduleKey, STARTUP_KEY, type DesktopSettingsDoc } from '../../../shared/desktop-settings';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
const { DesktopSettingsService, docOf, invalidKeys, lockedKeys, DESKTOP_SETTINGS_PATH, DESKTOP_PREFERENCES_PATH, RETRY_MS } = await import('../../../electron/services/desktop-settings');
const { SettingsService } = await import('../../../electron/services/settings');
const { preferenceOverlay } = await import('../../../shared/desktop-settings');

/**
 * The desktop settings service against the server contract: GET api/desktop/settings (ETag), PUT …/preferences
 * (409 policy_locked), a 404 as an older server, offline as the copy "as of", and the first sync's migration.
 */

const ORIGIN = 'https://ws.example';

function doc(over: Partial<DesktopSettingsDoc> = {}): DesktopSettingsDoc {
  return { mode: 'enterprise', org_id: 7, version: 3, catalogue_version: 1, catalogue: [], policy: {}, preferences: {}, updated_at: '2026-10-26T10:00:00Z', ...over };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 304 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function db() {
  const map = new Map<string, unknown>();
  return { map, getConfig: <T,>(k: string) => map.get(k) as T | undefined, setConfig: (k: string, v: unknown) => void map.set(k, v) };
}

function setup(opts: { online?: boolean; prefs?: Record<string, unknown>; store?: ReturnType<typeof db>; org?: string | null } = {}) {
  const calls: Array<{ method: string; path: string; query: string; body: unknown; headers: Record<string, string> }> = [];
  const replies: Array<Response | Error> = [];
  const store = opts.store ?? db();
  let online = opts.online ?? true;
  const http = {
    url: (p: string, q?: Record<string, unknown>) => `${ORIGIN}${p}${q ? `?${new URLSearchParams(q as Record<string, string>)}` : ''}`,
    raw: vi.fn(async (method: string, url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      calls.push({ method, path: u.pathname, query: u.search, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: (init.headers ?? {}) as Record<string, string> });
      const r = replies.shift();
      if (!r) throw new Error('no reply queued');
      if (r instanceof Error) throw r;
      return r;
    }),
  };
  const resetPrefs = vi.fn();
  const svc = new DesktopSettingsService({
    http,
    db: store,
    online: () => online,
    scope: () => 'acct-1:42',
    organizationId: () => opts.org ?? null,
    deviceId: () => 'dev-9',
    prefs: () => ({ notificationPrivacy: 'SENDER_ONLY', ...(opts.prefs ?? {}) }),
    defaults: () => ({ notificationPrivacy: 'SENDER_ONLY', startWithOs: true, minimizeToTray: true, badgeCount: true }),
    resetPrefs,
    now: () => Date.parse('2026-10-26T12:00:00Z'),
  });
  return { svc, calls, replies, store, resetPrefs, setOnline: (v: boolean) => (online = v) };
}

describe('DesktopSettingsService', () => {
  it('treats a 404 as an older server: personal mode on this computer’s choices, kept across restarts', async () => {
    const t = setup();
    t.replies.push(json(404, { status: 'error', message: 'Not found' }));
    await t.svc.refresh();
    expect(t.calls[0]).toMatchObject({ method: 'GET', path: DESKTOP_SETTINGS_PATH });
    expect(t.svc.view()).toMatchObject({ mode: 'personal', status: 'local' });
    await t.svc.set({ [moduleKey('crm')]: false });
    // Nothing is sent to a server that has no desktop settings.
    expect(t.calls).toHaveLength(1);
    expect(t.svc.moduleEnabled('crm')).toBe(false);
    const again = setup({ store: t.store });
    expect(again.svc.disabledModules().has('crm')).toBe(true);
  });

  it('reads the document, keeps its ETag and “as of”, and asks with If-None-Match next time (304)', async () => {
    const t = setup();
    t.replies.push(json(200, { status: 'success', data: doc({ policy: { [moduleKey('crm')]: { value: false, enforcement: 'managed' } } }) }, { etag: '"ds-3-ab12cd34ef56"' }));
    t.replies.push(json(200, { data: doc() })); // the migration's PUT, if any
    await t.svc.refresh();
    expect(t.svc.view()).toMatchObject({ mode: 'enterprise', status: 'synced', version: 3, orgId: '7', asOf: '2026-10-26T12:00:00.000Z' });
    expect(t.svc.effective()[moduleKey('crm')]).toEqual({ value: false, source: 'policy', locked: true });
    t.replies.length = 0;
    t.replies.push(json(304, null));
    await t.svc.refresh();
    expect(t.calls.at(-1)!.headers['If-None-Match']).toBe('"ds-3-ab12cd34ef56"');
    expect(t.svc.view().status).toBe('synced');
  });

  it('migrates this computer’s preferences under the server’s names on the first sync — not managed keys, not keys another device set — once', async () => {
    const t = setup({ prefs: { notificationPrivacy: 'GENERIC', minimizeToTray: false, startWithOs: false } });
    t.replies.push(json(200, { data: doc({ policy: { 'prefs.minimizeToTray': { value: true, enforcement: 'managed' } }, preferences: { 'prefs.launchAtLogin': true } }) }));
    t.replies.push(json(200, { data: doc({ version: 4, preferences: { 'prefs.launchAtLogin': true, 'prefs.notifications.preview': 'generic' } }) }));
    await t.svc.refresh();
    const put = t.calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe(DESKTOP_PREFERENCES_PATH);
    expect(put.body).toEqual({ values: { 'prefs.notifications.preview': 'generic' }, device_id: 'dev-9' });
    expect(t.svc.view().pending).toEqual([]);
    expect(t.svc.view().version).toBe(4);
    // Not again.
    t.replies.push(json(304, null));
    await t.svc.refresh();
    expect(t.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('asks for the company open here, and keeps each company’s copy apart', async () => {
    const t = setup({ org: '12' });
    t.replies.push(json(200, { data: doc({ org_id: 12 }) }));
    await t.svc.refresh();
    expect(t.calls[0]!.query).toBe('?organization_id=12');
    expect([...t.store.map.keys()]).toContain('desktop_settings:acct-1:42:org-12');
  });

  it('refuses a managed key here, and drops one the server answers 409 policy_locked for', async () => {
    const t = setup();
    t.replies.push(json(200, { data: doc({ policy: { [featureKey('launcherSearch')]: { value: false, enforcement: 'managed' } } }) }));
    await t.svc.refresh();
    await expect(t.svc.set({ [featureKey('launcherSearch')]: true })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(t.calls.some((c) => c.method === 'PUT')).toBe(false);

    t.replies.push(json(409, { status: 'error', message: 'Your organization manages this setting.', error: 'policy_locked', keys: [moduleKey('mail')] }));
    t.replies.push(json(200, { data: doc({ version: 5, policy: { [moduleKey('mail')]: { value: true, enforcement: 'managed' } } }) }));
    await expect(t.svc.set({ [moduleKey('mail')]: false })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(t.svc.view().pending).toEqual([]);
    await vi.waitFor(() => expect(t.svc.view().version).toBe(5));
    expect(t.svc.effective()[moduleKey('mail')]).toEqual({ value: true, source: 'policy', locked: true });
  });

  it('offline: shows the copy as of the last read, takes changes at once and sends them when the server answers again', async () => {
    const t = setup();
    t.replies.push(json(200, { data: doc() }));
    await t.svc.refresh();
    t.replies.push(new Error('NETWORK_UNREACHABLE'));
    await t.svc.refresh();
    expect(t.svc.view()).toMatchObject({ status: 'cached', asOf: '2026-10-26T12:00:00.000Z' });
    t.setOnline(false);
    await t.svc.set({ [STARTUP_KEY]: 'app:mail' });
    expect(t.svc.startupScreen()).toBe('app:mail');
    expect(t.svc.view().pending).toEqual([STARTUP_KEY]);
    t.setOnline(true);
    t.replies.push(json(200, { data: doc({ version: 4 }) }));
    t.replies.push(json(200, { data: doc({ version: 5, preferences: { [STARTUP_KEY]: 'app:mail' } }) }));
    await t.svc.refresh();
    expect(t.calls.at(-1)).toMatchObject({ method: 'PUT', body: { values: { [STARTUP_KEY]: 'app:mail' }, device_id: 'dev-9' } });
    expect(t.svc.view()).toMatchObject({ status: 'synced', pending: [], version: 5 });
    expect(t.svc.startupScreen()).toBe('app:mail');
  });

  it('reset to default sends null and resets this computer’s copy of a synced preference', async () => {
    const t = setup();
    t.replies.push(json(200, { data: doc({ preferences: { 'prefs.notifications.badge': false } }) }));
    await t.svc.refresh();
    t.replies.push(json(200, { data: doc({ version: 4 }) }));
    await t.svc.set({ 'prefs.notifications.badge': null });
    expect(t.calls.at(-1)!.body).toEqual({ values: { 'prefs.notifications.badge': null }, device_id: 'dev-9' });
    expect(t.resetPrefs).toHaveBeenCalledWith({ badgeCount: true });
    expect(t.svc.effective()['prefs.notifications.badge']!.source).toBe('default');
  });

  it('a null for a managed key is sent — it removes the person’s stored value — and is not refused', async () => {
    const t = setup();
    t.replies.push(json(200, { data: doc({ policy: { [moduleKey('crm')]: { value: false, enforcement: 'managed' } }, preferences: { [moduleKey('crm')]: true } }) }));
    await t.svc.refresh();
    t.replies.push(json(200, { data: doc({ version: 4, policy: { [moduleKey('crm')]: { value: false, enforcement: 'managed' } } }) }));
    await t.svc.set({ [moduleKey('crm')]: null });
    expect(t.calls.at(-1)).toMatchObject({ method: 'PUT', body: { values: { [moduleKey('crm')]: null } } });
    expect(t.svc.effective()[moduleKey('crm')]).toEqual({ value: false, source: 'policy', locked: true });
  });

  it('a 422 takes nothing: the values it names are dropped and said', async () => {
    const t = setup();
    t.replies.push(json(200, { data: doc() }));
    await t.svc.refresh();
    t.replies.push(json(422, { status: 'error', message: 'Some settings are not allowed.', errors: { [moduleKey('ghost')]: 'Not a desktop setting.' } }));
    await expect(t.svc.set({ [moduleKey('ghost')]: false })).rejects.toMatchObject({ code: 'IPC_VALIDATION_FAILED', message: 'Not a desktop setting.' });
    expect(t.svc.view().pending).toEqual([]);
  });

  it('a 503 on a write keeps the change here and sends it again later', async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      t.replies.push(json(200, { data: doc() }));
      await t.svc.refresh();
      t.replies.push(json(503, { status: 'error', message: 'Desktop settings are not set up on this server yet.' }));
      await t.svc.set({ [featureKey('fileSync')]: false });
      expect(t.svc.feature('fileSync')).toBe(false);
      expect(t.svc.view().pending).toEqual([featureKey('fileSync')]);
      t.replies.push(json(200, { data: doc({ version: 4, preferences: { [featureKey('fileSync')]: false } }) }));
      await vi.advanceTimersByTimeAsync(RETRY_MS + 10);
      expect(t.svc.view()).toMatchObject({ pending: [], version: 4 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads again on desktop.settings.changed only when the version is newer', async () => {
    const t = setup();
    t.replies.push(json(200, { data: doc({ version: 3 }) }));
    await t.svc.refresh();
    const n = t.calls.length;
    t.svc.handleRealtime({ type: 'desktop.settings.changed', version: 3 });
    t.svc.handleRealtime({ type: 'chat.message', version: 9 });
    expect(t.calls).toHaveLength(n);
    t.replies.push(json(200, { data: doc({ version: 4 }) }));
    t.svc.handleRealtime({ type: 'desktop.settings.changed', version: 4 });
    await vi.waitFor(() => expect(t.svc.view().version).toBe(4));
  });

  it('reads the document and 409 keys in either shape', () => {
    expect(docOf({ status: 'success', data: doc() })?.version).toBe(3);
    expect(docOf(doc({ mode: 'personal' }))?.mode).toBe('personal');
    expect(docOf({ data: { mode: 'weird' } })).toBeNull();
    expect(lockedKeys({ error: 'policy_locked', keys: ['a', 2] })).toEqual(['a']);
    expect(lockedKeys({ status: 'error', data: { error: 'policy_locked', keys: ['b'] } })).toEqual(['b']);
    expect(invalidKeys({ errors: { 'prefs.theme': 'Not an allowed value.', x: 3 } })).toEqual({ 'prefs.theme': 'Not an allowed value.', x: 'Not an allowed value.' });
  });
});

describe('enforcement through the preferences', () => {
  function database() {
    let stored: unknown;
    return { getConfig: () => stored, setConfig: (_: string, v: unknown) => void (stored = v) } as never;
  }

  it('a managed preference takes effect and is locked, so Settings refuses a change to it; itemLinks off keeps the rest of links', () => {
    const settings = new SettingsService(database());
    settings.update({ links: { mailLinks: 'current-tab' } });
    settings.setDesktopOverlay(preferenceOverlay({ 'prefs.notifications.preview': { value: 'generic', source: 'policy', locked: true }, 'prefs.theme': { value: 'dark', source: 'user', locked: false }, [featureKey('itemLinks')]: { value: false, source: 'user', locked: false } }));
    const eff = settings.effective();
    expect(eff.notificationPrivacy).toBe('GENERIC');
    expect(eff.theme).toBe('dark');
    expect(eff.appearance?.mode).toBe('dark');
    expect(eff.links).toEqual({ mailLinks: 'current-tab', openInApp: false });
    expect(settings.locks().map((l) => l.key)).toEqual(['notificationPrivacy']);
    // Taken off again: the person's own preference is back.
    settings.setDesktopOverlay({ values: {}, locks: [] });
    expect(settings.effective().notificationPrivacy).toBe('SENDER_ONLY');
    expect(settings.effective().links).toEqual({ mailLinks: 'current-tab' });
    expect(settings.locks()).toEqual([]);
  });
});
