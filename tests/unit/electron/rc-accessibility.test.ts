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


it('shows contradictory Accessibility/event-posting checks as unverifiable rather than permission denial', async () => {
  const check = new AccessibilityCheck({ platform: 'darwin', appTrusted: () => true, helperTrusted: async () => ({ trusted: false, accessibility: true, error: null }), now: () => 1000 });
  expect(await check.refresh()).toMatchObject({ status: 'unknown', appTrusted: true, helperAccessibility: true, helperTrusted: false, problem: expect.stringContaining('preflight disagrees') });
});

it('invalidates an in-flight probe when Settings is opened', async () => {
  let finish!: (result: boolean) => void;
  const probe = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; })).mockResolvedValue(true);
  const check = new AccessibilityCheck({ platform: 'darwin', appTrusted: () => true, helperTrusted: probe, now: () => 1000 });
  const first = check.refresh(); await Promise.resolve();
  check.openedSettings(); finish(false);
  expect((await first).status).toBe('granted');
});
