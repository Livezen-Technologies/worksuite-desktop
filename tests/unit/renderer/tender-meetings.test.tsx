// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../../src/modules/calendar/api';

/**
 * #100: a tender's meeting is one meeting — in the tender's Meetings tab, the Meetings list and the Calendar — and
 * every one of those says it is a tender meeting and offers Open Tender, View Meeting and Join where they apply.
 * The tender's closing deadline stays its own entry, never a meeting.
 */
const net = vi.hoisted(() => ({ call: vi.fn(), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), navigate: vi.fn(), openLink: vi.fn(), openMeeting: vi.fn(), toast: vi.fn() }));

vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', () => ({ apiGet: net.apiGet, apiGetMeta: net.apiGetMeta, apiPost: net.apiPost, apiPut: net.apiPut, apiDelete: net.apiDelete, ApiError: class extends Error {} }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: net.navigate, openLink: net.openLink, query: new URLSearchParams(), path: ['calendar'] }), useTabTitle: () => undefined }));
vi.mock('../../../src/core/access', () => ({ useCanOpen: () => true, useVisibleIds: () => new Set(['tenders', 'meet', 'meetings']) }));
vi.mock('../../../src/core/toasts', () => ({ toast: net.toast }));
vi.mock('../../../src/modules/meet/api', () => ({ openMeeting: net.openMeeting, createMeeting: vi.fn() }));

const cal = await import('../../../src/modules/calendar/api');
const mt = await import('../../../src/modules/meetings/api');
const work = await import('../../../src/modules/tenders/work');
const { EventDrawer } = await import('../../../src/modules/calendar/EventDrawer');
const { default: TenderMeetings } = await import('../../../src/modules/tenders/Meetings');

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** A pre-bid meeting as the calendar feed sends it to somebody who may open the tender. */
const preBid: CalendarEvent = {
  source: 'businessmeeting', id: 39, title: 'Pre-bid meeting · RFP-118', color: '#4f46e5',
  start_at: '2099-10-20 09:30:00', end_at: '2099-10-20 11:00:00', all_day: false, editable: true,
  status: 'scheduled', link: '/meetings?meeting=39', location: 'Buyer HQ, Colombo 3', join_url: 'https://zoom.us/j/123456',
  timezone: 'Asia/Colombo', organizer: 'Nadeesha Silva', source_type: 'tender', source_kind: 'pre_bid',
  related: { kind_label: 'Tender meeting', label: 'RFP-118 · Road works', link: '/tenders?open=4', open_label: 'Open Tender' },
};
/** The same tender's closing date: a deadline, not a meeting. */
const closes: CalendarEvent = { source: 'tender', id: 4, title: 'Closes: RFP-118', color: '#dc2626', start_at: '2099-10-25 11:30:00', end_at: null, all_day: false, editable: false, route: '/tenders?open=4', link: '/tenders?open=4' };

beforeEach(() => Object.values(net).forEach((f) => f.mockReset()));
afterEach(cleanup);

describe('Calendar › a tender meeting (#100)', () => {
  it('is filtered and coloured as a tender meeting, apart from other meetings and from the closing date', () => {
    expect(cal.entryCategory(preBid)).toBe('tendermeetings');
    expect(cal.entryCategory({ ...preBid, source_type: null })).toBe('meetings');
    expect(cal.entryCategory(closes)).not.toBe('tendermeetings');
    expect(cal.CATEGORIES.find((c) => c.id === 'tendermeetings')?.label).toBe('Tender meetings');
    expect(cal.colourOf(preBid)).toBe(cal.CATEGORIES.find((c) => c.id === 'tendermeetings')?.color);
  });

  it('offers Open Tender beside View Meeting, and the closing date still opens the tender', () => {
    expect(cal.relatedOf(preBid)).toEqual({ route: '/tenders?open=4', label: 'Open Tender' });
    expect(cal.destinationOf(preBid)).toEqual({ route: '/meetings?meeting=39', label: 'View Meeting' });
    expect(cal.destinationOf({ ...preBid, source_type: null, related: null })).toEqual({ route: '/meetings?meeting=39', label: 'Open Meeting' });
    expect(cal.destinationOf(closes)).toEqual({ route: '/tenders?open=4', label: 'View Tender' });
  });

  it('somebody who may not open the tender is told it is a tender meeting, and offered nothing more', () => {
    const guest = { ...preBid, related: { kind_label: 'Tender meeting', label: null, link: null, open_label: null } };
    expect(cal.relatedOf(guest)).toBeNull();
    expect(cal.entryCategory(guest)).toBe('tendermeetings');
  });

  it("the entry's summary shows the tender, the place, the organiser and the clock, with all three actions", async () => {
    net.apiGetMeta.mockResolvedValue({ data: { events: [preBid] }, offline: false, cachedAt: null });
    render(<QueryClientProvider client={client()}><EventDrawer event={preBid} draft={null} onClose={vi.fn()} /></QueryClientProvider>);

    expect(screen.getByText('Tender meeting')).toBeTruthy();
    expect(screen.getByText('RFP-118 · Road works')).toBeTruthy();
    expect(screen.getByText('Buyer HQ, Colombo 3')).toBeTruthy();
    expect(screen.getByText('Organised by Nadeesha Silva')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(net.call).toHaveBeenCalledWith('app:openExternal', { url: 'https://zoom.us/j/123456' });

    fireEvent.click(screen.getByRole('button', { name: 'Open Tender' }));
    expect(net.navigate).toHaveBeenCalledWith('/tenders?open=4');

    fireEvent.click(screen.getByRole('button', { name: 'View Meeting' }));
    await waitFor(() => expect(net.navigate).toHaveBeenCalledWith('/meetings?meeting=39'));
  });
});

describe('Meetings › the Related to filter and the label (#100)', () => {
  const m = (type: string | null) => ({ source: type ? { type, id: 4, kind: null, kind_label: 'Tender meeting', label: null, link: null, can_open: false } : null });

  it('offers Tender, and holds the rows to it even if the server did not filter', () => {
    expect(mt.SOURCE_FILTERS).toContainEqual(['tender', 'Tender']);
    expect(mt.matchesSource(m('tender'), 'tender')).toBe(true);
    expect(mt.matchesSource(m(null), 'tender')).toBe(false);
    expect(mt.matchesSource(m('crm_lead'), 'tender')).toBe(false);
    expect(mt.matchesSource(m('crm_lead'), 'crm')).toBe(true);
    expect(mt.matchesSource(m(null), '')).toBe(true);
    expect(mt.openRelatedLabel({ type: 'tender' })).toBe('Open Tender');
  });

  it('says the time on the clock it was booked on, only when that is not the reader’s', () => {
    expect(mt.zoneNote('2026-10-20T04:00:00Z', 'Asia/Colombo', 'Europe/London')).toBe('20 Oct, 09:30 Asia/Colombo');
    expect(mt.zoneNote('2026-10-20T04:00:00Z', 'Asia/Colombo', 'Asia/Colombo')).toBeNull();
    expect(mt.zoneNote('2026-10-20T04:00:00Z', null)).toBeNull();
    expect(mt.zoneNote('2026-10-20T04:00:00Z', 'Not/AZone', 'UTC')).toBeNull();
  });
});

describe("Tenders › a tender's meetings are meetings (#100)", () => {
  const line = (over: Record<string, unknown> = {}) => ({
    id: 1, kind: 'pre_bid', title: null, duration_minutes: 90, cancelled_at: null, scheduled_at: '2099-10-20T04:00:00Z',
    mode: 'hybrid', venue: 'Buyer HQ', link: 'https://zoom.us/j/123456', mandatory: 1, questions_due_at: null, attended: 0, attended_by: null, minutes: null,
    meeting: { id: 39, meeting_no: 'MTG-2099-0001', status: 'scheduled', timezone: 'Asia/Colombo', organizer: 'Nadeesha Silva', participants: 3, accepted: 1, my_rsvp: 'no_response', can_view: true, join_url: 'https://zoom.us/j/123456', meet_uuid: null },
    ...over,
  });

  it('reads the linked meeting, and offers Join only while it is still to happen and has somewhere to join', () => {
    const m = work.toMeeting(line());
    expect(m.meeting).toMatchObject({ id: 39, can_view: true, participants: 3, accepted: 1 });
    expect(work.joinOf(m.meeting ?? null)).toEqual({ url: 'https://zoom.us/j/123456' });
    expect(work.joinOf({ ...m.meeting!, meet_uuid: 'abc' })).toEqual({ uuid: 'abc' });
    expect(work.joinOf({ ...m.meeting!, status: 'cancelled' })).toBeNull();
    expect(work.joinOf({ ...m.meeting!, join_url: null })).toBeNull();
    expect(work.toMeeting(line({ meeting: null })).meeting).toBeNull();
  });

  it('has presentations, and sends the title and how long to hold', () => {
    expect(work.MEETING_KINDS.map(([k]) => k)).toEqual(expect.arrayContaining(['pre_bid', 'site_visit', 'clarification', 'presentation']));
    const d = { ...work.meetingDraft(null), kind: 'presentation', title: ' Technical presentation ', duration: '120', date: '2099-10-05', time: '10:00' };
    expect(work.meetingBody(d, null).body).toMatchObject({ kind: 'presentation', title: 'Technical presentation', duration_minutes: '120' });
    const before = work.meetingDraft(work.toMeeting(line()));
    expect(before.duration).toBe('90');
    expect(work.meetingBody({ ...before, duration: '60' }, before).body).toEqual({ duration_minutes: '60' });
  });

  it('the tab shows the meeting, and offers View Meeting, Join and Cancel', async () => {
    net.apiGet.mockResolvedValue({ items: [line()] });
    net.apiPut.mockResolvedValue({});
    render(<QueryClientProvider client={client()}><TenderMeetings id={4} canManage /></QueryClientProvider>);

    expect(await screen.findByText(/In Meetings and the Calendar as MTG-2099-0001/)).toBeTruthy();
    expect(screen.getByText(/1 of 3 accepted/)).toBeTruthy();
    expect(net.apiGet).toHaveBeenCalledWith('/api/tenders/4/meetings', undefined, expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'View Meeting' }));
    expect(net.openLink).toHaveBeenCalledWith('/meetings?meeting=39');

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(net.call).toHaveBeenCalledWith('app:openExternal', { url: 'https://zoom.us/j/123456' });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(net.apiPut).toHaveBeenCalledWith('/api/tenders/meetings/1', { cancelled: true }));
  });

  it('a cancelled one says so, offers no Join, and can be put back on', async () => {
    net.apiGet.mockResolvedValue({ items: [line({ cancelled_at: '2099-10-01T00:00:00Z', meeting: { ...line().meeting, status: 'cancelled' } })] });
    net.apiPut.mockResolvedValue({});
    render(<QueryClientProvider client={client()}><TenderMeetings id={4} canManage /></QueryClientProvider>);

    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back on' }));
    await waitFor(() => expect(net.apiPut).toHaveBeenCalledWith('/api/tenders/meetings/1', { cancelled: false }));
  });

  it('a reader who is not on the meeting is not offered View Meeting', async () => {
    net.apiGet.mockResolvedValue({ items: [line({ meeting: { ...line().meeting, can_view: false } })] });
    render(<QueryClientProvider client={client()}><TenderMeetings id={4} canManage={false} /></QueryClientProvider>);

    expect(await screen.findByText(/In Meetings and the Calendar/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'View Meeting' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});
