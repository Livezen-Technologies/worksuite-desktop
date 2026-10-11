import { describe, expect, it } from 'vitest';
import { meetDiagnostics, meetDiagnosticsSummary, type MeetDiagFacts } from '../../../shared/meet-diagnostics';

/**
 * Settings › Remote control's checks (WS-MEET-ENH-01 RC09).
 *
 * What these protect: a check is read by somebody deciding whether to let a
 * colleague drive their computer, so a row must never be greener than the
 * truth. Two of the artboard's rows — firewall UDP and TURN — cannot be known
 * from a settings page at all, and say so rather than showing a tick.
 */

const mac: MeetDiagFacts = {
  platform: 'darwin',
  screenPermission: 'granted',
  sources: 1,
  displays: [{ width: 1920, height: 1080, scale: 2, primary: true }],
  accessibility: 'granted',
  method: 'cgevent',
  displayServer: 'quartz',
  clipboard: 'text_only',
  realtime: 'connected',
};
const row = (facts: MeetDiagFacts, id: string) => meetDiagnostics(facts).find((r) => r.id === id)!;

describe('screen sharing', () => {
  it('counts what can actually be captured', () => {
    expect(row({ ...mac, sources: 2 }, 'meet-screen')).toMatchObject({ status: 'pass', detail: '2 screens can be captured.' });
    expect(row({ ...mac, sources: 1 }, 'meet-screen').detail).toBe('One screen can be captured.');
  });

  it('fails, and names the pane that fixes it, when macOS has refused', () => {
    const r = row({ ...mac, screenPermission: 'denied' }, 'meet-screen');

    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/System permissions/);
  });

  it('treats a profile’s restriction as a refusal too', () => {
    expect(row({ ...mac, screenPermission: 'restricted' }, 'meet-screen').status).toBe('fail');
  });

  it('does not read a refusal into a Windows machine with nothing to grant', () => {
    expect(row({ platform: 'win32', sources: 1, screenPermission: 'denied' }, 'meet-screen').status).toBe('pass');
  });

  it('separates "could not ask" from "nothing to capture"', () => {
    expect(row({ ...mac, sources: null }, 'meet-screen').status).toBe('skip');
    expect(row({ ...mac, sources: 0 }, 'meet-screen').status).toBe('fail');
  });
});

describe('displays', () => {
  it('says how many and how big, with the scale when it is not 1', () => {
    expect(row(mac, 'meet-displays').detail).toBe('One display, 1920×1080 @2×.');
  });

  it('warns nobody about a second screen, but says which the picker offers', () => {
    const r = row({ ...mac, displays: [{ width: 1920, height: 1080, scale: 1, primary: true }, { width: 2560, height: 1440, scale: 1, primary: false }] }, 'meet-displays');

    // More than one screen is normal, not a fault — but people share the wrong one.
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/2 displays — 1920×1080, 2560×1440/);
    expect(r.detail).toMatch(/offers each one separately/);
  });
});

describe('remote input', () => {
  it('passes when the permission is held, and names how input would arrive', () => {
    expect(row(mac, 'meet-input')).toMatchObject({ status: 'pass' });
    expect(row(mac, 'meet-input').detail).toMatch(/cgevent/);
    expect(row(mac, 'meet-input').detail).toMatch(/until you approve their request, each time/);
  });

  it('warns, without calling it a failure, when accessibility is off', () => {
    // Nothing is broken: the screen can still be shared, just not driven.
    expect(row({ ...mac, accessibility: 'denied' }, 'meet-input').status).toBe('warn');
  });

  it('says Wayland plainly, whatever the permission says', () => {
    const r = row({ ...mac, platform: 'linux', displayServer: 'wayland', accessibility: 'not_required' }, 'meet-input');

    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/Wayland/);
  });

  it('is not a problem on a computer that asks for no permission', () => {
    expect(row({ ...mac, platform: 'win32', accessibility: 'not_required', displayServer: 'win32', method: 'sendinput' }, 'meet-input').status).toBe('pass');
  });

  it('is checking, not failing, before the service has answered', () => {
    expect(row({ ...mac, accessibility: 'checking' }, 'meet-input').status).toBe('skip');
  });
});

describe('the clipboard row', () => {
  it('reports the policy as a policy, never as a fault', () => {
    // 'off' is somebody's deliberate choice; a warning would read as a thing to fix.
    for (const p of ['off', 'text_only', 'text_and_files'] as const) {
      expect(row({ ...mac, clipboard: p }, 'meet-clipboard').status).toBe('pass');
    }
    expect(row({ ...mac, clipboard: 'off' }, 'meet-clipboard').detail).toMatch(/cannot put anything on your clipboard/);
    expect(row({ ...mac, clipboard: 'text_and_files' }, 'meet-clipboard').detail).toMatch(/always waits for your answer/);
  });

  it('says no policy has arrived rather than inventing a default', () => {
    expect(row({ ...mac, clipboard: null }, 'meet-clipboard').status).toBe('skip');
  });
});

describe('the two rows that cannot be known from here', () => {
  it('says the media path is not knowable, and where it is', () => {
    const r = row(mac, 'meet-media');

    expect(r.status).toBe('skip');
    expect(r.label).toMatch(/UDP and TURN/);
    expect(r.detail).toMatch(/never learns which UDP ports/);
    expect(r.detail).toMatch(/pre-join screen/);
  });

  it('never claims the media path is fine', () => {
    expect(meetDiagnostics(mac).some((r) => r.id === 'meet-media' && r.status === 'pass')).toBe(false);
  });

  it('reports the realtime gateway, which is what carries a control request', () => {
    expect(row(mac, 'meet-realtime').status).toBe('pass');
    expect(row({ ...mac, realtime: 'reconnecting' }, 'meet-realtime').status).toBe('warn');
    // A server with no gateway is a configuration, not a fault.
    expect(row({ ...mac, realtime: 'disabled' }, 'meet-realtime').status).toBe('skip');
  });
});

describe('the one word at the top', () => {
  it('is nothing-in-the-way only when no row is a problem', () => {
    expect(meetDiagnosticsSummary(meetDiagnostics(mac))).toBe('pass');
  });

  it('prefers a failure over a warning', () => {
    expect(meetDiagnosticsSummary(meetDiagnostics({ ...mac, screenPermission: 'denied', accessibility: 'denied' }))).toBe('fail');
  });

  it('warns when control is limited although sharing works', () => {
    expect(meetDiagnosticsSummary(meetDiagnostics({ ...mac, accessibility: 'denied' }))).toBe('warn');
  });

  it('does not let the two unknowable rows colour the summary', () => {
    expect(meetDiagnostics(mac).filter((r) => r.status === 'skip').map((r) => r.id)).toEqual(['meet-media']);
  });
});
