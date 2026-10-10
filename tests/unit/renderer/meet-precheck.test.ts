import { describe, expect, it } from 'vitest';
import { checkSummary, deviceCheck, videoLabel } from '../../../src/modules/meet/precheck';

/**
 * The pre-join device check (WS-MEET-ENH-01 D08).
 *
 * What it protects: a row says what the device **gave**, not what was asked
 * for — a camera asked for 720p and handing back 480 must read 480, because
 * the point of a check is to find out before everybody is watching. And a
 * device deliberately off is not a fault: somebody joining muted does not
 * want a warning about their microphone.
 */

describe('what the camera is really sending', () => {
  it('names the usual sizes', () => {
    expect(videoLabel({ height: 1080, frameRate: 30 })).toBe('1080p · 30 fps');
    expect(videoLabel({ height: 720, frameRate: 24 })).toBe('720p · 24 fps');
    expect(videoLabel({ height: 480, frameRate: 30 })).toBe('480p · 30 fps');
  });

  it('rounds a frame rate the browser reports with decimals', () => {
    expect(videoLabel({ height: 720, frameRate: 29.97 })).toBe('720p · 30 fps');
  });

  it('gives the height itself for a size with no name', () => {
    expect(videoLabel({ height: 540, frameRate: 15 })).toBe('540p · 15 fps');
  });

  it('leaves out a frame rate it was not told', () => {
    expect(videoLabel({ height: 720 })).toBe('720p');
  });

  it('says nothing at all without a size', () => {
    expect(videoLabel({})).toBe('');
    expect(videoLabel(null)).toBe('');
  });

  it('reports what the camera gave, not what was asked for', () => {
    // Asked for 720 and handed 480: the check exists to say so.
    expect(videoLabel({ height: 480, frameRate: 30 })).toBe('480p · 30 fps');
  });
});

describe('the rows', () => {
  const row = (facts: Parameters<typeof deviceCheck>[0], id: string) => deviceCheck(facts)!.find((r) => r.id === id)!;
  const on = { cameraOn: true, micOn: true, camera: { height: 720, frameRate: 30 }, audio: { noiseSuppression: true } };

  it('has the three it can measure, in the design’s order', () => {
    expect(deviceCheck(on).map((r) => r.id)).toEqual(['camera', 'microphone', 'remote']);
  });

  it('treats a device switched off as fine, not as a problem', () => {
    expect(row({ ...on, cameraOn: false }, 'camera')).toMatchObject({ state: 'ok', value: 'Off' });
    expect(row({ ...on, micOn: false }, 'microphone')).toMatchObject({ state: 'ok', value: 'Muted' });
  });

  it('says a device is still starting rather than claiming a figure', () => {
    expect(row({ ...on, camera: null }, 'camera')).toMatchObject({ state: 'unknown', value: 'Starting…' });
    expect(row({ ...on, audio: null }, 'microphone')).toMatchObject({ state: 'unknown', value: 'Starting…' });
  });

  it('reports noise cancellation as the device actually opened it', () => {
    expect(row({ ...on, audio: { noiseSuppression: true } }, 'microphone').value).toBe('Noise cancellation on');
    expect(row({ ...on, audio: { noiseSuppression: false } }, 'microphone').value).toBe('Noise cancellation off');
  });

  it('says what remote control costs rather than which permission is missing', () => {
    // The person reading this is about to join a meeting, not about to fix a Mac.
    expect(row({ ...on, remote: { available: false, accessibility: 'denied' } }, 'remote').value).toMatch(/seen, not controlled/);
    expect(row({ ...on, remote: { available: true } }, 'remote')).toMatchObject({ state: 'ok' });
  });

  it('warns when a share of this screen could not be controlled', () => {
    expect(row({ ...on, remote: { available: false, accessibility: 'not_required' } }, 'remote').state).toBe('warn');
  });

  it('is checking, not warning, before the service has answered', () => {
    expect(row(on, 'remote')).toMatchObject({ state: 'unknown', value: 'Checking…' });
  });
});

describe('the one word at the top', () => {
  const rows = (...states: Array<'ok' | 'warn' | 'unknown'>) => states.map((state, i) => ({ id: 'camera' as const, label: '', state, value: String(i) }));

  it('is ready only when every row is', () => {
    expect(checkSummary(rows('ok', 'ok', 'ok'))).toBe('ok');
  });

  it('prefers a warning over anything still checking', () => {
    expect(checkSummary(rows('ok', 'unknown', 'warn'))).toBe('warn');
  });

  it('is checking while anything is', () => {
    expect(checkSummary(rows('ok', 'unknown'))).toBe('unknown');
  });
});
