import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../electron/services/db';
const power = vi.hoisted(() => new Map<string, () => void>());
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, powerMonitor: { on: (event: string, handler: () => void) => power.set(event, handler) }, systemPreferences: {} }));
import { SettingsService } from '../../../electron/services/settings';
import { LockService } from '../../../electron/services/lock';
import { verifyLockChange } from '../../../electron/services/lock-verification';
import { normalizePolicy } from '../../../electron/services/policy';
import { contract } from '../../../shared/ipc/contract';
function database() {
  const rows = new Map<string, unknown>();
  return { getConfig: (key: string) => rows.get(key), setConfig: (key: string, value: unknown) => rows.set(key, structuredClone(value)) } as unknown as Database;
}
afterEach(() => {
  vi.useRealTimers();
  power.clear();
});
describe('lock-screen protection (#115)', () => {
  it('isolates security choices across users and servers and restores them after restart', () => {
    const db = database();
    const settings = new SettingsService(db);
    settings.setUserLanguageScope('https://one.example', '1');
    settings.update({ appLockEnabled: false, appLockMinutes: 23, lockOnSleep: false, lockedChatNotifications: false });
    settings.setUserLanguageScope('https://one.example', '2');
    expect(settings.effective()).toMatchObject({ appLockEnabled: true, appLockMinutes: 15, lockOnSleep: true, lockedChatNotifications: true });
    settings.setUserLanguageScope('https://two.example', '1');
    expect(settings.effective().appLockEnabled).toBe(true);
    const restored = new SettingsService(db);
    restored.setUserLanguageScope('https://one.example', '1');
    expect(restored.effective()).toMatchObject({ appLockEnabled: false, appLockMinutes: 23, lockOnSleep: false, lockedChatNotifications: false });
  });
  it('enforces organization locking and timeout limits while allowing shorter and immediate intervals', () => {
    const settings = new SettingsService(database());
    settings.setPolicy(normalizePolicy({ app_lock_max_minutes: 5 }, true));
    settings.update({ appLockEnabled: false, appLockMinutes: 23 });
    expect(settings.effective()).toMatchObject({ appLockEnabled: true, appLockMinutes: 5 });
    settings.update({ appLockMinutes: 2 });
    expect(settings.effective().appLockMinutes).toBe(2);
    settings.update({ appLockMinutes: 0 });
    expect(settings.effective().appLockMinutes).toBe(0);
    expect(settings.locks().map((x) => x.key)).toContain('appLockEnabled');
  });
  it('separates sleep from OS lock, supports disabled automatic locking and preserves manual lock', () => {
    vi.useFakeTimers();
    const lock = new LockService();
    lock.enabled = () => true;
    lock.lockOnSleep = () => false;
    lock.start();
    power.get('suspend')!();
    expect(lock.isLocked()).toBe(false);
    power.get('lock-screen')!();
    expect(lock.isLocked()).toBe(true);
    lock.unlock();
    lock.enabled = () => false;
    vi.advanceTimersByTime(60 * 60_000);
    expect(lock.isLocked()).toBe(false);
    lock.lock('manual');
    expect(lock.isLocked()).toBe(true);
    lock.stop();
  });
  it('uses a custom idle timeout and never locks active work through the immediate-mode timer', () => {
    vi.useFakeTimers();
    const lock = new LockService();
    lock.enabled = () => true;
    lock.minutes = () => 2;
    lock.start();
    vi.advanceTimersByTime(60_000);
    lock.activity();
    vi.advanceTimersByTime(90_000);
    expect(lock.isLocked()).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(lock.isLocked()).toBe(true);
    lock.unlock();
    lock.minutes = () => 0;
    vi.advanceTimersByTime(60_000);
    expect(lock.isLocked()).toBe(false);
    lock.stop();
  });
  it('rejects missing and wrong verification and an account switch during verification', async () => {
    let account = { id: '1', email: 'one@example.com' };
    const verify = vi.fn(async () => true);
    await expect(verifyLockChange(() => account, verify, undefined)).rejects.toThrow('Verify');
    expect(verify).not.toHaveBeenCalled();
    await expect(
      verifyLockChange(
        () => account,
        async () => false,
        'wrong',
      ),
    ).rejects.toThrow('Verify');
    await expect(
      verifyLockChange(
        () => account,
        async () => {
          account = { id: '2', email: 'two@example.com' };
          return true;
        },
        'correct',
      ),
    ).rejects.toThrow('account changed');
    await expect(verifyLockChange(() => account, verify, 'correct')).resolves.toBeUndefined();
  });
  it('accepts bounded whole custom minutes and requires a password for PIN removal', () => {
    for (const n of [0, 1, 23, 1440]) expect(contract['settings:set'].input.safeParse({ appLockMinutes: n }).success).toBe(true);
    for (const n of [-1, 1.5, 1441]) expect(contract['settings:set'].input.safeParse({ appLockMinutes: n }).success).toBe(false);
    expect(contract['security:clearPin'].input.safeParse(undefined).success).toBe(false);
  });
});
