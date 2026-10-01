import { describe, expect, it, vi } from 'vitest';
import { AccessibilityCheck } from '../../../electron/services/remote-control/accessibility';

/** A Mac whose answers the test sets, with a clock it moves. */
function mac(app: boolean, helper: boolean | null) {
  const s = { app, helper, now: 1_000 };
  const helperTrusted = vi.fn(async () => s.helper);
  const check = new AccessibilityCheck({ platform: 'darwin', appTrusted: () => s.app, helperTrusted, now: () => s.now });
  return { s, check, helperTrusted };
}

describe('remote control: macOS Accessibility (worksuite-desktop#47)', () => {
  it('is granted when the app says so, without asking the helper', async () => {
    const { check, helperTrusted } = mac(true, null);
    expect(check.state()).toEqual({ status: 'granted', hint: null });
    expect((await check.refresh()).status).toBe('granted');
    expect(helperTrusted).not.toHaveBeenCalled();
  });

  it('believes the helper that injects input when the app\'s own answer is stale', async () => {
    const { check } = mac(false, true);
    expect((await check.refresh()).status).toBe('granted');
    expect(check.state().status).toBe('granted');
  });

  it('asks the helper again only after a few seconds, unless asked to check now', async () => {
    const { s, check, helperTrusted } = mac(false, false);
    await check.refresh();
    check.state();
    check.state();
    expect(helperTrusted).toHaveBeenCalledTimes(1);
    s.now += 11_000;
    check.state();
    expect(helperTrusted).toHaveBeenCalledTimes(2);
    await check.refresh();
    expect(helperTrusted).toHaveBeenCalledTimes(3);
  });

  it('turns granted the moment access is given, and denied again when it is taken away', async () => {
    const { s, check } = mac(false, false);
    expect((await check.refresh()).status).toBe('denied');
    s.app = true;
    expect(check.state().status).toBe('granted');
    s.app = false;
    s.helper = false;
    expect((await check.refresh()).status).toBe('denied');
  });

  it('after System Settings was opened and access still reads as off, says why instead of asking again', async () => {
    const { s, check } = mac(false, false);
    expect((await check.refresh()).hint).toBeNull();
    s.now += 500;
    check.openedSettings();
    expect(check.state().hint).toBeNull();
    s.now += 500;
    expect(await check.refresh()).toEqual({ status: 'denied', hint: 'restart' });
  });

  it('a helper that cannot be asked counts as no answer, not as access', async () => {
    const { check, helperTrusted } = mac(false, null);
    helperTrusted.mockRejectedValueOnce(new Error('osascript timed out'));
    expect((await check.refresh()).status).toBe('denied');
  });

  it('is not needed on Windows or Linux', async () => {
    const helperTrusted = vi.fn();
    const check = new AccessibilityCheck({ platform: 'win32', appTrusted: () => false, helperTrusted, now: () => 0 });
    expect(await check.refresh()).toEqual({ status: 'not_required', hint: null });
    expect(helperTrusted).not.toHaveBeenCalled();
  });
});
