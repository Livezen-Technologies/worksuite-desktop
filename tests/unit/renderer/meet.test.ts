import { describe, expect, it, vi } from 'vitest';

vi.mock('livekit-client', () => ({ Room: class {}, RoomEvent: {}, Track: { Source: {}, Kind: {} }, VideoPresets: { h720: {} }, DisconnectReason: {}, createLocalTracks: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: vi.fn(), errorMessage: (e: unknown) => String(e) }));
vi.mock('../../../src/core/api', () => ({ ApiError: class {}, apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));

import { formatCode, invitation, parseMeetingInput } from '../../../src/modules/meet/api';
import { elapsedOf } from '../../../src/modules/meetings/MeetingDetail';
import { nextSlot } from '../../../src/modules/meetings/ScheduleDialog';
import { setRegional } from '../../../src/core/time';

describe('joining a meeting by what was typed', () => {
  it('takes a meeting link, from any server, to its uuid', () => {
    expect(parseMeetingInput('https://app.worksuite.lk/meet/c30c0aac-e4e9-454b-b1f0-551cebb76429')).toEqual({ uuid: 'c30c0aac-e4e9-454b-b1f0-551cebb76429' });
    expect(parseMeetingInput('app.worksuite.lk/meet/c30c0aac-e4e9-454b-b1f0-551cebb76429?x=1')).toEqual({ uuid: 'c30c0aac-e4e9-454b-b1f0-551cebb76429' });
  });

  it('takes a meeting ID, spaced or not, as a code to look up', () => {
    expect(parseMeetingInput('482 119 330')).toEqual({ code: '482119330' });
    expect(parseMeetingInput('C30 C0A ACE')).toEqual({ code: 'C30 C0A ACE' });
    expect(parseMeetingInput('   ')).toBeNull();
  });

  it('reads a numeric ID out in threes', () => {
    expect(formatCode('482119330')).toBe('482 119 330');
    expect(formatCode('C30 C0A ACE')).toBe('C30 C0A ACE');
  });

  it('words the invitation with what exists', () => {
    const text = invitation({ title: 'Design review', join_url: 'https://x/meet/u', code: '482119330', passcode: null }, 'Samali');
    expect(text).toContain('Samali invites you to “Design review”.');
    expect(text).toContain('Meeting ID: 482 119 330');
    expect(text).not.toContain('Passcode');
  });
});

describe('the agenda timer', () => {
  const now = Date.parse('2026-09-26T10:05:00Z');
  it('counts the banked seconds plus the stretch running now', () => {
    expect(elapsedOf({ id: 1, position: 1, title: 'a', presenter: null, minutes: 10, notes: null, status: 'running', started_at: '2026-09-26T10:03:00Z', elapsed_seconds: 30 }, now)).toBe(150);
  });
  it('counts only what was banked while paused', () => {
    expect(elapsedOf({ id: 1, position: 1, title: 'a', presenter: null, minutes: 10, notes: null, status: 'pending', started_at: null, elapsed_seconds: 90 }, now)).toBe(90);
  });
});

describe('scheduling', () => {
  it('suggests the next quarter hour on the WorkSuite clock, not the computer’s', () => {
    setRegional({ timezone: 'Asia/Colombo' });
    // 10:05 UTC is 15:35 in Colombo; +30 min → 16:05 → next quarter 16:15.
    expect(nextSlot(30, Date.parse('2026-09-26T10:05:00Z'))).toBe('2026-09-26T16:15');
  });
});
