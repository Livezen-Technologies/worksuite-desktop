import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  globalShortcut: { register: vi.fn(() => true), unregister: vi.fn() },
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0', isPackaged: false, on: () => undefined },
}));

import { contentSecurityPolicy } from '../../../electron/security/hardening';
import { PhoneService } from '../../../electron/services/phone';
import { contract } from '@shared/ipc/contract';
import { INVOKE_CHANNELS, EVENT_CHANNELS } from '@shared/ipc/channels';
import { PHONE_SHORTCUTS, phoneOrigin } from '@shared/phone';

/**
 * The Phone's main-process side (WS-VOIP-SRS-001 D01): the switch's WebSocket in the page policy — learned from
 * WorkSuite, never from a page — the global shortcuts, and calls as native notifications.
 */
function service(over: Partial<ConstructorParameters<typeof PhoneService>[0]> = {}) {
  const store = new Map<string, unknown>();
  const keys = { register: vi.fn((_acc: string, _fn: () => void) => true), unregister: vi.fn((_acc: string) => undefined) };
  const notify = vi.fn();
  const send = vi.fn();
  const s = new PhoneService({
    config: { getConfig: <T>(k: string) => (store.get(k) as T) ?? null, setConfig: (k, v) => void store.set(k, v) },
    http: { get: vi.fn(async () => ({ ws_uri: 'wss://pbx.example.lk:8089/ws', secret: 'never-kept' })) as never },
    allowed: () => true,
    notify,
    mainWindow: () => ({ isDestroyed: () => false, webContents: { send } }) as never,
    shortcuts: keys,
    ...over,
  });
  return { s, store, keys, notify, send };
}

describe('the phone system in the page policy', () => {
  it('takes only a plain secure WebSocket origin', () => {
    expect(phoneOrigin('wss://pbx.example.lk:8089/ws')).toBe('wss://pbx.example.lk:8089');
    expect(phoneOrigin('WSS://PBX.example.lk/ws')).toBe('wss://pbx.example.lk');
    expect(phoneOrigin('ws://pbx.example.lk/ws')).toBeNull();
    expect(phoneOrigin('wss://user:pw@pbx.example.lk/ws')).toBeNull();
    expect(phoneOrigin('https://pbx.example.lk')).toBeNull();
    expect(phoneOrigin('not a url')).toBeNull();
  });

  it('learns it from WorkSuite, keeps no secret, and says when the page must restart once', async () => {
    const { s, store } = service();
    expect(s.origins()).toEqual([]);
    expect(await s.prepare()).toEqual({ origin: 'wss://pbx.example.lk:8089', added: true });
    expect(store.get('phone_servers')).toEqual(['wss://pbx.example.lk:8089']);
    expect(JSON.stringify([...store.values()])).not.toContain('never-kept');
    expect(await s.prepare()).toEqual({ origin: 'wss://pbx.example.lk:8089', added: false });
  });

  it('puts it in connect-src, over wss and https on that host only', () => {
    const { s } = service();
    return s.prepare().then(() => {
      const csp = contentSecurityPolicy({ server: 'https://worksuite.example.lk', media: s.origins() });
      const connect = csp.split('; ').find((d) => d.startsWith('connect-src'))!;
      expect(connect).toContain('wss://pbx.example.lk:8089');
      expect(connect).toContain('https://pbx.example.lk:8089');
      expect(connect).not.toContain('worksuite.example.lk');
    });
  });

  it('ignores a stored value that is not an origin', () => {
    const { s, store } = service();
    store.set('phone_servers', ['wss://pbx.example.lk:8089', 'javascript:alert(1)', 'wss://x.example/path']);
    expect(s.origins()).toEqual(['wss://pbx.example.lk:8089']);
  });

  it('refuses someone without the Phone, and adds nothing when WorkSuite has no softphone for them', async () => {
    await expect(service({ allowed: () => false }).s.prepare()).rejects.toThrow(/access to the Phone/);
    const none = service({ http: { get: vi.fn(async () => Promise.reject(new Error('404'))) } as never });
    expect(await none.s.prepare()).toEqual({ origin: null, added: false });
    expect(none.store.size).toBe(0);
  });
});

describe('the compact phone’s global shortcuts', () => {
  it('holds answer, hang up and mute while asked, and sends them to the main window', () => {
    const { s, keys, send } = service();
    const r = s.setShortcuts(true);
    expect(r.held).toEqual({ answer: true, hangup: true, mute: true });
    expect(keys.register).toHaveBeenCalledTimes(3);
    expect(keys.register.mock.calls.map((c) => c[0])).toEqual([PHONE_SHORTCUTS.answer, PHONE_SHORTCUTS.hangup, PHONE_SHORTCUTS.mute]);
    // Pressed: the phone in the main window acts.
    keys.register.mock.calls[1]![1]();
    expect(send).toHaveBeenCalledWith('phone:shortcut', { action: 'hangup' });
    s.setShortcuts(true);
    expect(keys.register).toHaveBeenCalledTimes(3);
    s.reset();
    expect(keys.unregister).toHaveBeenCalledTimes(3);
  });

  it('says when another app holds one', () => {
    const { s } = service({ shortcuts: { register: vi.fn((acc: string) => acc !== PHONE_SHORTCUTS.mute), unregister: vi.fn() } });
    expect(s.setShortcuts(true).held).toEqual({ answer: true, hangup: true, mute: false });
  });
});

describe('calls as native notifications', () => {
  it('rings critically and opens the Phone; a missed call opens Calls', () => {
    const { s, notify } = service();
    s.notify({ kind: 'incoming', id: 'phone-ring:l1', title: 'Incoming call from Nimal Perera', body: '+94 77 312 4408 · Sales queue 600' });
    s.notify({ kind: 'missed', id: 'phone-missed:l2', title: 'Missed call from +94 71 880 2231', body: '+94 71 880 2231' });
    expect(notify.mock.calls[0]![0]).toMatchObject({ module: 'phone', category: 'voip', link: '/phone', critical: true, call: true });
    expect(notify.mock.calls[1]![0]).toMatchObject({ link: '/phone/calls', critical: false, call: false });
  });

  it('rings without a sound while Busy, and keeps a call turned away by Do not disturb in the bell only (#288)', () => {
    const bell = vi.fn();
    const { s, notify } = service({ bell });
    s.notify({ kind: 'incoming', id: 'phone-ring:l1', title: 'Incoming call from Nimal Perera', body: '+94 77 312 4408', delivery: 'silent' });
    expect(notify.mock.calls[0]![0]).toMatchObject({ critical: true, call: true, custom: { actions: [], sound: false } });
    s.notify({ kind: 'missed', id: 'phone-missed:l2', title: 'Missed call from Nimal Perera', body: '+94 77 312 4408 · Do not disturb: sent to voicemail', delivery: 'bell' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(bell).toHaveBeenCalledWith({ id: 'phone-missed:l2', title: 'Missed call from Nimal Perera', body: '+94 77 312 4408 · Do not disturb: sent to voicemail', link: '/phone/calls', module: 'phone' });
    // An ordinary banner has no `custom` of its own: the app's sounds apply.
    s.notify({ kind: 'incoming', id: 'phone-ring:l3', title: 'Incoming call', body: '1042' });
    expect(notify.mock.calls[1]![0].custom).toBeUndefined();
    // Nobody without the Phone hears of a call, banner or bell.
    const off = service({ allowed: () => false, bell });
    off.s.notify({ kind: 'missed', id: 'phone-missed:l4', title: 'x', body: 'y', delivery: 'bell' });
    expect(bell).toHaveBeenCalledTimes(1);
  });

  it('is in the IPC contract with a strict payload', () => {
    for (const c of ['phone:prepare', 'phone:shortcuts', 'phone:notify'] as const) expect(INVOKE_CHANNELS).toContain(c);
    expect(EVENT_CHANNELS).toContain('phone:shortcut');
    const schema = contract['phone:notify'].input;
    expect(schema.safeParse({ kind: 'incoming', id: 'phone-ring:l1', title: 'x', body: 'y' }).success).toBe(true);
    expect(schema.safeParse({ kind: 'incoming', id: 'chat:1', title: 'x', body: 'y' }).success).toBe(false);
    expect(schema.safeParse({ kind: 'incoming', id: 'phone-ring:l1', title: 'x', body: 'y', link: '/mail' }).success).toBe(false);
    expect(schema.safeParse({ kind: 'missed', id: 'phone-missed:l1', title: 'x', body: 'y', delivery: 'bell' }).success).toBe(true);
    expect(schema.safeParse({ kind: 'incoming', id: 'phone-ring:l1', title: 'x', body: 'y', delivery: 'loud' }).success).toBe(false);
    expect(contract['windows:open'].input.safeParse({ kind: 'phone', route: '/phone/compact', alwaysOnTop: true }).success).toBe(true);
  });
});
