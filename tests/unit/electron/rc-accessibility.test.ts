import { describe, expect, it, vi } from 'vitest';
import { AccessibilityCheck } from '../../../electron/services/remote-control/accessibility';
function mac(app: boolean, helper: boolean | null) {
  const s = { app, helper, now: 1000 };
  const helperTrusted = vi.fn(async () => s.helper);
  const check = new AccessibilityCheck({ platform: 'darwin', appTrusted: () => s.app, helperTrusted, now: () => s.now });
  return { s, check, helperTrusted };
}
describe('Accessibility verification', () => {
  it('checks the helper even when the running app reports permission', async () => {
    const { check, helperTrusted } = mac(true, false);
    expect(check.state().status).toBe('checking');
    expect(await check.refresh()).toMatchObject({ status: 'denied', hint: 'restart', appTrusted: true, helperTrusted: false });
    expect(helperTrusted).toHaveBeenCalled();
  });
  it('trusts the process posting input when the app answer is stale', async () => {
    expect((await mac(false, true).check.refresh()).status).toBe('granted');
  });
  it('separates failed verification from explicit denial', async () => {
    const { check, helperTrusted } = mac(true, null);
    helperTrusted.mockRejectedValueOnce(new Error('timeout'));
    expect((await check.refresh()).status).toBe('unknown');
  });
  it('refreshes cached permission and revocation', async () => {
    const { s, check } = mac(true, true);
    await check.refresh();
    s.app = false; s.helper = false;
    expect(check.state().status).toBe('checking');
    expect((await check.refresh()).status).toBe('denied');
    s.helper = true;
    expect((await check.refresh()).status).toBe('granted');
  });
  it('does not prescribe resets merely because System Settings was opened', async () => {
    const { check } = mac(false, false);
    await check.refresh(); check.openedSettings();
    expect((await check.refresh()).hint).toBeNull();
  });
  it('does not let an older probe overwrite the latest result', async () => {
    const { check, helperTrusted } = mac(false, false);
    let finish!: (value: boolean) => void;
    helperTrusted.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const older = check.refresh();
    await Promise.resolve();
    helperTrusted.mockResolvedValueOnce(true);
    expect((await check.refresh()).status).toBe('granted');
    finish(false); await older;
    expect(check.state().status).toBe('granted');
  });
  it('needs no check on other platforms', async () => {
    const helperTrusted = vi.fn();
    const check = new AccessibilityCheck({ platform: 'linux', appTrusted: () => false, helperTrusted, now: () => 0 });
    expect(await check.refresh()).toEqual({ status: 'not_required', hint: null });
    expect(helperTrusted).not.toHaveBeenCalled();
  });
});


it('shows contradictory Accessibility/event-posting checks as unverifiable when the app itself is not trusted', async () => {
  const check = new AccessibilityCheck({ platform: 'darwin', appTrusted: () => false, helperTrusted: async () => ({ trusted: false, accessibility: true, error: null }), now: () => 1000 });
  expect(await check.refresh()).toMatchObject({ status: 'unknown', appTrusted: false, helperAccessibility: true, helperTrusted: false, problem: expect.stringContaining('preflight disagrees') });
});

describe('Check again and restart advice (worksuite-desktop#147)', () => {
  it('asks the app and the helper again on every Check again, never an earlier answer', async () => {
    const appTrusted = vi.fn(() => false);
    const helperTrusted = vi.fn(async () => ({ trusted: false, accessibility: false, error: null }));
    const check = new AccessibilityCheck({ platform: 'darwin', appTrusted, helperTrusted, now: () => 1000 });
    await check.refresh();
    await check.refresh();
    await check.refresh();
    expect(helperTrusted).toHaveBeenCalledTimes(3);
    expect(appTrusted.mock.calls.length).toBeGreaterThanOrEqual(3);
    // Granted in System Settings: the very next Check again says so, though the last answer is only milliseconds old.
    appTrusted.mockReturnValue(true);
    helperTrusted.mockResolvedValue({ trusted: true, accessibility: true, error: null });
    expect(await check.refresh()).toMatchObject({ status: 'granted', hint: null, appTrusted: true, helperTrusted: true });
  });

  it('says restart, not Denied or Unable to verify, when the app has access but the helper’s event posting has not caught up', async () => {
    const s = { app: false };
    const check = new AccessibilityCheck({ platform: 'darwin', appTrusted: () => s.app, helperTrusted: async () => ({ trusted: false, accessibility: s.app, error: null }), now: () => 1000, relaunched: () => false });
    expect(await check.refresh()).toMatchObject({ status: 'denied', hint: null });
    s.app = true; // granted while WorkSuite runs
    expect(await check.refresh()).toMatchObject({ status: 'denied', hint: 'restart', appTrusted: true, helperAccessibility: true, helperTrusted: false, problem: null });
  });

  it('after Restart WorkSuite, the same mismatch points at the helper instead of offering another restart', async () => {
    const check = new AccessibilityCheck({ platform: 'darwin', appTrusted: () => true, helperTrusted: async () => ({ trusted: false, accessibility: false, error: null }), now: () => 1000, relaunched: () => true });
    expect(await check.refresh()).toMatchObject({ status: 'denied', hint: 'helper' });
  });

  it('still offers a restart after one if this process saw access arrive while running', async () => {
    const s = { app: false };
    const check = new AccessibilityCheck({ platform: 'darwin', appTrusted: () => s.app, helperTrusted: async () => false, now: () => 1000, relaunched: () => true });
    await check.refresh();
    s.app = true;
    expect((await check.refresh()).hint).toBe('restart');
  });

  it('keeps the last answer on screen during a background re-check, unless the app’s own answer changed', async () => {
    const s = { app: false, now: 1000 };
    let finish!: (v: boolean) => void;
    const helperTrusted = vi.fn(async () => false as boolean);
    const check = new AccessibilityCheck({ platform: 'darwin', appTrusted: () => s.app, helperTrusted, now: () => s.now });
    await check.refresh();
    s.now += 20_000;
    helperTrusted.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    expect(check.state().status).toBe('denied');
    s.app = true;
    expect(check.state().status).toBe('checking');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    finish(false);
  });

  it('records which helper answered', async () => {
    const check = new AccessibilityCheck({ platform: 'darwin', appTrusted: () => true, helperTrusted: async () => ({ trusted: true, accessibility: true, error: null, source: 'injector' as const }), now: () => 1 });
    expect(await check.refresh()).toMatchObject({ status: 'granted', helperSource: 'injector' });
  });
});

it('invalidates an in-flight probe when Settings is opened', async () => {
  let finish!: (result: boolean) => void;
  const probe = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; })).mockResolvedValue(true);
  const check = new AccessibilityCheck({ platform: 'darwin', appTrusted: () => true, helperTrusted: probe, now: () => 1000 });
  const first = check.refresh(); await Promise.resolve();
  check.openedSettings(); finish(false);
  expect((await first).status).toBe('granted');
});
