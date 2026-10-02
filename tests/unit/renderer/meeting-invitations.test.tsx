// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly code: string | null = null,
    ) {
      super(message);
    }
  }
  return { ApiError, ...api };
});
const bridge = vi.hoisted(() => ({ handlers: new Map<string, (p: unknown) => void>(), call: vi.fn(async () => null) }));
vi.mock('../../../src/core/bridge', () => ({
  call: bridge.call,
  on: vi.fn((ch: string, fn: (p: unknown) => void) => (bridge.handlers.set(ch, fn), () => undefined)),
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', () => nav);
vi.mock('../../../src/core/app-state', () => ({ app: { get: () => ({ auth: { user: { id: '5' } } }), subscribe: () => () => undefined } }));
const tab = vi.hoisted(() => ({ openWebLink: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => tab);

import { ApiError } from '../../../src/core/api';
import { queryClient, wireQueryInvalidation } from '../../../src/core/query';
import { setRegional } from '../../../src/core/time';
import { answerInvitation, invitationsChanged, type WaitingInvitation } from '../../../src/modules/calendar/conflicts';
import { WaitingInvitations, invitationLink, invitationWhen } from '../../../src/modules/home/WaitingInvitations';
import { MeetingInviteActions } from '../../../src/modules/notifications/MeetingInviteActions';
import type { Notice } from '../../../src/modules/notifications/api';
import { BannerBlocked } from '../../../src/modules/notifications/Settings';

/**
 * Meeting invitations in the desktop (worksuite-desktop#97): Home's Waiting for me answers them in place and says who,
 * when — with the zone — and where; the notification answers them too; an answer anywhere refreshes every view that
 * shows or counts invitations, and so does the server saying one changed; a banner that is blocked says why.
 */
afterEach(cleanup);
beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPost.mockReset();
  bridge.call.mockClear();
  tab.openWebLink.mockReset();
  setRegional({ timezone: 'Asia/Dubai', locale: 'en-GB', timeFormat: '24' });
});

const invitation = (over: Partial<WaitingInvitation> = {}): WaitingInvitation => ({
  source: 'meeting',
  id: 7,
  title: 'Budget review',
  start_at: '2026-10-05 04:30:00',
  end_at: '2026-10-05 05:30:00',
  all_day: false,
  my_rsvp: 'no_response',
  conflicts: [],
  duplicate: false,
  link: '/meetings?meeting=7',
  organizer: 'Nadia Perera',
  timezone: 'Asia/Colombo',
  where: 'Online — https://meet.example.com/j/42',
  location_type: 'online',
  online_url: 'https://meet.example.com/j/42',
  ...over,
});

function wrap(ui: React.ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  api.apiGet.mockImplementation(async (path: string) => {
    if (path === '/api/calendar/conflicts/invitations') return { invitations: [invitation()] };
    throw new Error(`unexpected ${path}`);
  });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

describe('Home › Waiting for me', () => {
  it('says who asked, when on the reader’s clock with the zone it was booked in, and where', () => {
    wrap(<WaitingInvitations items={[invitation()]} canMeetings onOpen={vi.fn()} />);
    const row = screen.getByText('Budget review').closest('li')!;
    expect(within(row).getByText('Invitation from Nadia Perera')).toBeTruthy();
    // 04:30Z is 08:30 in Dubai.
    expect(within(row).getByText(/8:30–9:30 \(Asia\/Dubai\) · booked in Asia\/Colombo/)).toBeTruthy();
    expect(within(row).getByText('Online · https://meet.example.com/j/42')).toBeTruthy();
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Going', 'Maybe', 'Not going', 'View meeting']);
  });

  it('leaves the zone out when it is the reader’s own, and says all day for one that is', () => {
    expect(invitationWhen(invitation({ timezone: 'Asia/Dubai' }))).toMatch(/ 8:30–9:30 \(Asia\/Dubai\)$/);
    expect(invitationWhen(invitation({ all_day: true }))).toMatch(/· all day$/);
  });

  it('answers in place through the Calendar, and asks every view again', async () => {
    api.apiPost.mockResolvedValue({});
    const { client } = wrap(<WaitingInvitations items={[invitation()]} canMeetings onOpen={vi.fn()} />);
    const spy = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Not going' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/calendar/conflicts/invitations/meetings/7/rsvp', { rsvp: 'declined' }));
    await waitFor(() => expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toEqual(expect.arrayContaining([['meetings'], ['calendar'], ['home']])));
  });

  it('opens the meeting for somebody with Meetings, and its Calendar day for somebody without', () => {
    const onOpen = vi.fn();
    wrap(<WaitingInvitations items={[invitation()]} canMeetings={false} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'View meeting' }));
    expect(onOpen).toHaveBeenCalledWith('/calendar?date=2026-10-05');
    expect(invitationLink(invitation(), true)).toBe('/meetings?meeting=7');
    expect(invitationLink(invitation({ source: 'event', id: 3, link: '/calendar?event=3' }), false)).toBe('/calendar?event=3');
  });
});

describe('answering', () => {
  it('falls back to Meetings’ own answer on a server without the Calendar’s, and answers an event on the event', async () => {
    api.apiPost.mockRejectedValueOnce(new ApiError(404, 'Not found', null)).mockResolvedValueOnce({});
    await answerInvitation('meeting', 7, 'tentative');
    expect(api.apiPost.mock.calls.map((c) => c[0])).toEqual(['/api/calendar/conflicts/invitations/meetings/7/rsvp', '/api/meetings/7/rsvp']);

    api.apiPost.mockReset();
    api.apiPost.mockRejectedValueOnce(new ApiError(409, 'This meeting was cancelled', null));
    await expect(answerInvitation('meeting', 7, 'accepted')).rejects.toThrow('cancelled');
    expect(api.apiPost).toHaveBeenCalledTimes(1);

    api.apiPost.mockReset().mockResolvedValue({});
    await answerInvitation('event', 3, 'accepted');
    expect(api.apiPost).toHaveBeenCalledWith('/api/calendar/events/3/rsvp', { status: 'accepted' });
  });

  it('refreshes Meetings, the Calendar and Home together', () => {
    const qc = { invalidateQueries: vi.fn() };
    invitationsChanged(qc);
    expect(qc.invalidateQueries.mock.calls.map((c) => c[0].queryKey)).toEqual([['meetings'], ['calendar'], ['home']]);
  });
});

describe('synchronised from the server', () => {
  it('asks every view again when an invitation changes elsewhere — and not for anything else', () => {
    wireQueryInvalidation();
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    const emit = bridge.handlers.get('realtime:event')!;
    const keys = () => spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));

    emit({ type: 'meeting.rsvp', meeting_id: 7, rsvp: 'accepted' });
    expect(keys()).toEqual(expect.arrayContaining(['["meetings"]', '["calendar"]', '["home"]']));

    spy.mockClear();
    emit({ type: 'notification', event: 'meeting.invitation' });
    expect(keys()).toEqual(expect.arrayContaining(['["notifications"]', '["meetings"]', '["calendar"]', '["home"]']));

    spy.mockClear();
    emit({ type: 'notification', event: 'task.assigned' });
    expect(keys()).toEqual(['["notifications"]']);
    spy.mockRestore();
  });
});

describe('in the notification centre', () => {
  const notice = (over: Partial<Notice> = {}): Notice =>
    ({
      id: 31,
      event: 'meeting.invitation',
      category: 'calendar',
      title: 'Invitation: Budget review — Mon 5 Oct, 10:00',
      body: 'You are invited.',
      link: '/meetings?meeting=7',
      actions: [
        { label: 'Going', rsvp: 'accepted', meeting_id: 7 },
        { label: 'Maybe', rsvp: 'tentative', meeting_id: 7 },
        { label: 'Not going', rsvp: 'declined', meeting_id: 7 },
        { label: 'View meeting', link: '/meetings?meeting=7', meeting_id: 7 },
      ],
      read: false,
      ...over,
    }) as Notice;

  it('answers an invitation from the notice and marks it read', async () => {
    api.apiPost.mockResolvedValue({});
    wrap(<MeetingInviteActions notice={notice()} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Going', 'Maybe', 'Not going', 'View meeting']);
    fireEvent.click(screen.getByRole('button', { name: 'Going' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/notifications/31/action', { action: 'read' }));
    expect(api.apiPost).toHaveBeenCalledWith('/api/calendar/conflicts/invitations/meetings/7/rsvp', { rsvp: 'accepted' });
    fireEvent.click(screen.getByRole('button', { name: 'View meeting' }));
    expect(tab.openWebLink).toHaveBeenCalledWith('/meetings?meeting=7');
  });

  it('offers Join meeting on a reminder for an online meeting', () => {
    wrap(<MeetingInviteActions notice={notice({ event: 'meeting.reminder', actions: [{ label: 'Join meeting', url: 'https://meet.example.com/j/42', meeting_id: 7 }] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Join meeting' }));
    expect(bridge.call).toHaveBeenCalledWith('app:openExternal', { url: 'https://meet.example.com/j/42' });
    expect(screen.queryByRole('button', { name: 'Going' })).toBeNull();
  });
});

describe('when banners are blocked', () => {
  const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true, realtime: true }, dndEnabled: false, dndFrom: '22:00', dndTo: '07:00', moduleNotifications: {} } as never;

  it('says why, and nothing when they are not', () => {
    const { rerender } = render(<BannerBlocked prefs={prefs} supported={false} pausedUntil={null} />);
    expect(screen.getByRole('status').textContent).toMatch(/Banners are blocked on this computer\..*system settings/);
    rerender(<BannerBlocked prefs={{ ...(prefs as object), moduleNotifications: { 'cat:calendar': false } } as never} supported pausedUntil={null} />);
    expect(screen.getByRole('status').textContent).toMatch(/Meeting banners are blocked/);
    rerender(<BannerBlocked prefs={prefs} supported pausedUntil={null} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
