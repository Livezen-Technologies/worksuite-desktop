import { describe, expect, it, vi } from 'vitest';
import { invitationBanner, joinable, MeetingsDesk, meetingIdOf, reminderBanner, startsIn, trayMeetings, type DeskMeeting, type MeetingsDeskDeps } from '../../../electron/services/meetings-desk';
import { meetingsSummary, trayMeetingsItems } from '../../../electron/tray/tray';
import type { Incoming } from '../../../electron/services/notifications';

/**
 * Meetings outside the window (Meetings D07): reminder and invitation banners with their own buttons — Join, Snooze
 * 5 min, Open; Going, Maybe, Propose time — shown through the notification service so its rules apply (the one-device
 * claim among them), and today's meetings in the tray.
 */

const NOW = Date.parse('2026-10-13T05:15:00Z');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const time = (ms: number) => new Date(ms).toISOString().slice(11, 16);

const row = (over: Partial<DeskMeeting> = {}): DeskMeeting => ({
  id: 42,
  title: 'Acme Lanka — Q4 business review',
  start_at: '2026-10-13T05:30:00Z',
  end_at: '2026-10-13T07:00:00Z',
  live_status: 'scheduled',
  meet_uuid: '11111111-1111-4111-8111-111111111111',
  online_url: null,
  where: 'Board Room A + Meet',
  organizer: 'Ruwan Jayasinghe',
  my_rsvp: 'accepted',
  my_role: 'required',
  ...over,
});

describe('the tray’s Meetings lines', () => {
  it("lists today's meetings in order, live and joinable ones said so, and counts invitations waiting", () => {
    const rows = [
      row({ id: 3, title: 'Sprint planning', start_at: '2026-10-13T08:30:00Z', end_at: '2026-10-13T09:30:00Z' }),
      row({ id: 1, title: 'Daily stand-up', start_at: '2026-10-13T04:00:00Z', end_at: '2026-10-13T06:00:00Z', live_status: 'ongoing' }),
      row(),
      row({ id: 9, title: 'Tomorrow', start_at: '2026-10-14T04:00:00Z', my_rsvp: 'no_response' }),
      row({ id: 10, title: 'Cancelled', live_status: 'cancelled', my_rsvp: 'no_response' }),
      row({ id: 11, title: 'Mine', start_at: '2026-10-15T04:00:00Z', my_rsvp: 'no_response', my_role: 'organizer' }),
    ];
    const t = trayMeetings(rows, NOW, day, time)!;
    expect(t.today.map((x) => [x.time, x.title, x.live, x.join])).toEqual([
      ['04:00', 'Daily stand-up', true, true],
      ['05:30', 'Acme Lanka — Q4 business review', false, true],
      ['08:30', 'Sprint planning', false, false],
    ]);
    expect(t.waiting).toBe(1);
    expect(trayMeetings(null, NOW)).toBeNull();
  });

  it('never offers Join to somebody the meeting says may not attend, nor with nowhere to join', () => {
    expect(joinable(row({ can: { attend: false } }), NOW)).toBe(false);
    expect(joinable(row({ meet_uuid: null, online_url: null }), NOW)).toBe(false);
    expect(joinable(row({ meet_uuid: null, online_url: 'https://zoom.us/j/1' }), NOW)).toBe(true);
    expect(joinable(row({ start_at: '2026-10-13T06:00:00Z' }), NOW)).toBe(false);
  });

  it('builds the submenu: each meeting, Answer for the invitations, Open Meetings — only with Meetings', () => {
    const a = { openRoute: vi.fn(), meetingOpen: vi.fn() };
    const meetings = { today: [{ id: 1, title: 'Daily stand-up', time: '09:30', live: true, join: true }, { id: 42, title: 'Acme', time: '11:00', live: false, join: true }, { id: 3, title: 'Sprint', time: '14:00', live: false, join: false }], waiting: 3 };
    const items = trayMeetingsItems({ signedIn: true, apps: ['meetings'], meetings }, a);
    expect(items.map((i) => i.label).filter(Boolean)).toEqual(['Today', '09:30  Daily stand-up — Live', '11:00  Acme — Join', '14:00  Sprint', '3 invitations waiting — Answer', 'Open Meetings']);
    (items[2]!.click as () => void)();
    expect(a.meetingOpen).toHaveBeenCalledWith(42);
    (items.find((i) => i.label === '3 invitations waiting — Answer')!.click as () => void)();
    expect(a.openRoute).toHaveBeenCalledWith('/meetings?tab=invitations');
    expect(trayMeetingsItems({ signedIn: true, apps: ['meet'], meetings }, a)).toEqual([]);
    expect(meetingsSummary(meetings)).toBe('Meetings · live: Daily stand-up');
    expect(meetingsSummary({ today: [], waiting: 2 })).toBe('Meetings · 2 waiting');
  });
});

describe('the banners’ words and buttons', () => {
  it('a reminder: when it starts and where, Join, Snooze 5 min and Open', () => {
    expect(reminderBanner(row(), { title: 'Reminder', body: 'x' }, null, NOW)).toEqual({ title: 'Acme Lanka — Q4 business review', body: 'Starts in 15 minutes · Board Room A + Meet', actions: ['Join', 'Snooze 5 min', 'Open'] });
    expect(reminderBanner(row({ can: { attend: false } }), { title: 'R', body: 'x' }, null, NOW).actions).toEqual(['Snooze 5 min', 'Open']);
    // Not readable now: the notice's own words, and Join only with its link.
    expect(reminderBanner(null, { title: 'Reminder: Acme', body: 'In 15 minutes' }, 'https://zoom.us/j/1', NOW)).toEqual({ title: 'Reminder: Acme', body: 'In 15 minutes', actions: ['Join', 'Snooze 5 min', 'Open'] });
    expect(startsIn(NOW + 60_000, NOW)).toBe('Starts in 1 minute');
    expect(startsIn(NOW, NOW)).toBe('Starting now');
  });

  it('an invitation: when, from whom and what it clashes with; Going, Maybe and Propose time', () => {
    const b = invitationBanner(row(), { title: 'Invitation', body: 'x' }, ['accepted', 'tentative', 'declined'], 'SFCL pre-bid', () => 'Thu 15 Oct 09:00');
    expect(b).toEqual({ title: 'Acme Lanka — Q4 business review', body: 'Thu 15 Oct 09:00 · from Ruwan Jayasinghe\nClashes with SFCL pre-bid', actions: ['Going', 'Maybe', 'Propose time'] });
    expect(invitationBanner(row({ can: { rsvp: false } }), { title: 'I', body: 'x' }, ['accepted', 'tentative'], null, () => '').actions).toEqual(['Propose time']);
    expect(invitationBanner(row(), { title: 'I', body: 'x' }, ['accepted'], null, () => '').actions).toEqual(['Going', 'Propose time']);
  });

  it('finds the meeting from the notice’s actions or its link', () => {
    expect(meetingIdOf({ link: null, actions: [{ label: 'Going', rsvp: 'accepted', meeting_id: 7 }] }, 'meeting.invitation')).toBe(7);
    expect(meetingIdOf({ link: '/meetings?meeting=12' }, 'meeting.reminder')).toBe(12);
    expect(meetingIdOf({ link: '/calendar' }, 'meeting.reminder')).toBeNull();
  });
});

function desk(over: Record<string, unknown> = {}) {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const shown: Incoming[] = [];
  const d = {
    get: vi.fn(async (path: string) => {
      if (path === '/api/meetings/42') return { meeting: row() };
      if (path === '/api/calendar/conflicts/invitations') return { invitations: [{ source: 'meeting', id: 42, conflicts: [{ title: 'SFCL pre-bid', busy_only: false }] }] };
      if (path === '/api/meetings') return { meetings: [row()] };
      return {};
    }),
    post: vi.fn(async () => ({})),
    notify: vi.fn((n: Incoming) => void shown.push(n)),
    markRead: vi.fn(async () => undefined),
    allowed: vi.fn(() => true),
    canMeet: vi.fn(() => true),
    open: vi.fn(),
    joinMeet: vi.fn(),
    openExternal: vi.fn(),
    onChange: vi.fn(),
    now: () => NOW,
    every: 1e9,
    setTimer: vi.fn((fn: () => void, ms: number) => (timers.push({ fn, ms }), timers.length)),
    clearTimer: vi.fn(),
    ...over,
  };
  const s = new MeetingsDesk(d as unknown as MeetingsDeskDeps);
  s.start();
  return { s, d, shown, timers };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const reminder = { id: '501', module: 'meetings', event: 'meeting.reminder', title: 'Reminder', body: 'Soon', link: '/meetings?meeting=42', category: 'meeting', priority: null, actions: [{ label: 'View meeting', link: '/meetings?meeting=42', meeting_id: 42 }] };
const invitation = { id: '502', event: 'meeting.invitation', title: 'Invitation', body: 'You are invited', link: '/meetings?meeting=42', category: 'meeting', priority: null, actions: [{ label: 'Going', rsvp: 'accepted', meeting_id: 42 }, { label: 'Maybe', rsvp: 'tentative', meeting_id: 42 }, { label: 'Not going', rsvp: 'declined', meeting_id: 42 }] };

describe('the banners, shown and acted on', () => {
  it('takes a reminder, reads the meeting, and shows it through the notification service under the bell entry’s key', async () => {
    const { s, shown } = desk();
    expect(s.claim(reminder)).toBe(true);
    // Taken once: the same notice again (the list catching up) is not shown twice.
    expect(s.claim(reminder)).toBe(true);
    await flush();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ id: 'meeting:501', attentionKey: 'notification:501', readId: '501', module: 'meetings', category: 'meeting', title: 'Acme Lanka — Q4 business review', body: 'Starts in 15 minutes · Board Room A + Meet', critical: false });
    expect(shown[0]!.custom?.actions).toEqual(['Join', 'Snooze 5 min', 'Open']);
  });

  it('Join joins on Meet and counts the attendance; Open opens the meeting; both read the bell entry', async () => {
    const { s, d, shown } = desk();
    s.claim(reminder);
    await flush();
    await shown[0]!.custom!.onAction(0);
    expect(d.post).toHaveBeenCalledWith('/api/meetings/42/attend', { action: 'join' });
    expect(d.joinMeet).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'Acme Lanka — Q4 business review');
    expect(d.markRead).toHaveBeenCalledWith(['501']);
    await shown[0]!.custom!.onAction(2);
    expect(d.open).toHaveBeenCalledWith('/meetings?meeting=42');
  });

  it('Join without Meet opens the online link instead', async () => {
    const { s, d, shown } = desk({ canMeet: () => false, get: vi.fn(async (path: string) => (path === '/api/meetings/42' ? { meeting: row({ meet_uuid: 'x', online_url: 'https://zoom.us/j/1' }) } : {})) });
    s.claim(reminder);
    await flush();
    await shown[0]!.custom!.onAction(0);
    expect(d.joinMeet).not.toHaveBeenCalled();
    expect(d.openExternal).toHaveBeenCalledWith('https://zoom.us/j/1');
  });

  it('Snooze 5 min shows it again five minutes later, as a banner of its own', async () => {
    const { s, shown, timers } = desk();
    s.claim(reminder);
    await flush();
    await shown[0]!.custom!.onAction(1);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(5 * 60_000);
    timers[0]!.fn();
    await flush();
    expect(shown).toHaveLength(2);
    expect(shown[1]).toMatchObject({ id: 'meeting-snooze:501:1', attentionKey: null, readId: '501' });
  });

  it('an invitation says what it clashes with; Going answers it through the Calendar and reads the entry', async () => {
    const { s, d, shown } = desk();
    expect(s.claim(invitation)).toBe(true);
    await flush();
    expect(shown[0]!.body).toContain('Clashes with SFCL pre-bid');
    expect(shown[0]!.custom?.actions).toEqual(['Going', 'Maybe', 'Propose time']);
    await shown[0]!.custom!.onAction(0);
    expect(d.post).toHaveBeenCalledWith('/api/calendar/conflicts/invitations/meetings/42/rsvp', { rsvp: 'accepted' });
    expect(d.markRead).toHaveBeenCalledWith(['502']);
  });

  it("answers through Meetings on a server without the Calendar's, and opens the meeting when the answer is refused", async () => {
    const post = vi.fn(async (path: string) => {
      if (path.startsWith('/api/calendar/')) throw Object.assign(new Error('nf'), { status: 404 });
      return {};
    });
    const { s, d, shown } = desk({ post });
    s.claim(invitation);
    await flush();
    await shown[0]!.custom!.onAction(1);
    expect(post).toHaveBeenCalledWith('/api/meetings/42/rsvp', { rsvp: 'tentative' });
    post.mockImplementation(async () => {
      throw Object.assign(new Error('over'), { status: 410 });
    });
    await shown[0]!.custom!.onAction(0);
    expect(d.open).toHaveBeenCalledWith('/meetings?meeting=42');
  });

  it('Propose time opens the meeting with its dialog', async () => {
    const { s, d, shown } = desk();
    s.claim(invitation);
    await flush();
    await shown[0]!.custom!.onAction(2);
    expect(d.open).toHaveBeenCalledWith('/meetings?meeting=42&propose=1');
  });

  it('leaves alone what is not its own: other events, a change asking for no answer, or somebody without Meetings', () => {
    expect(desk().s.claim({ ...reminder, event: 'meeting.cancellation' })).toBe(false);
    expect(desk().s.claim({ ...invitation, event: 'meeting.update', actions: [{ label: 'View meeting', link: '/meetings?meeting=42', meeting_id: 42 }] })).toBe(false);
    expect(desk({ allowed: () => false }).s.claim(reminder)).toBe(false);
    expect(desk().s.claim({ ...reminder, link: '/calendar', actions: [] })).toBe(false);
  });

  it('tells the tray, and nothing once stopped', async () => {
    const { s, d } = desk();
    await s.refresh();
    expect(d.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ today: [expect.objectContaining({ id: 42, join: true })] }));
    s.openFromTray(42);
    expect(d.joinMeet).toHaveBeenCalled();
    s.stop();
    expect(d.onChange).toHaveBeenLastCalledWith(null);
  });
});
