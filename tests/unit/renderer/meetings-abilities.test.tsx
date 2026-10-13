// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Detail } from '../../../src/modules/meetings/api';

/**
 * Meetings v1.1 (SRS MTG-U03, U06–U08; design D01, D02): a meeting's controls follow what the server says the reader
 * may do with it — `can` on every meeting — and an older server without it gets what this app always worked out. A
 * status change the server refuses because the meeting moved on (409, 410) is said, and the meeting read again.
 */
const net = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn(), call: vi.fn(), toast: vi.fn(), openMeeting: vi.fn(), navigate: vi.fn(), openLink: vi.fn() }));

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
  return { ApiError, apiGet: net.apiGet, apiPost: net.apiPost, apiPut: net.apiPut, apiDelete: net.apiDelete, request: net.request };
});
vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, platform: 'linux' }));
vi.mock('../../../src/core/toasts', () => ({ toast: net.toast }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: net.navigate, openLink: net.openLink, go: vi.fn(), query: new URLSearchParams() }), useTabTitle: () => undefined }));
vi.mock('../../../src/core/access', () => ({ useCanOpen: () => true, useVisibleIds: () => new Set(['meetings', 'meet', 'chat']) }));
vi.mock('../../../src/core/app-state', () => ({ app: { get: () => ({ auth: { user: { id: '5' } } }), subscribe: () => () => undefined } }));
vi.mock('../../../src/modules/meet/api', () => ({ openMeeting: net.openMeeting }));
vi.mock('../../../src/modules/meet/RecordingProgress', () => ({ RecordingProgress: () => null }));
vi.mock('../../../src/modules/calendar/conflicts', () => ({
  invitationsChanged: vi.fn(),
  useInvitationAnswer: () => ({ waiting: null, answer: vi.fn(), propose: null, dialogs: null, flag: null }),
}));

const { ApiError } = await import('../../../src/core/api');
const mt = await import('../../../src/modules/meetings/api');
const { MeetingDetail, fileLink } = await import('../../../src/modules/meetings/MeetingDetail');


const NONE = { edit: false, reschedule: false, cancel: false, delete: false, start: false, complete: false, run_agenda: false, minutes: false, actions: false, upload: false, attend: false, invite: false, rsvp: false };

const detail = (meeting: Record<string, unknown> = {}, over: Partial<Detail> = {}): Detail =>
  ({
    meeting: {
      id: 42, meeting_no: 'MTG-42', title: 'Acme Lanka — Q4 business review', subject: null, description: null, type: 'client', priority: 'normal',
      status: 'scheduled', live_status: 'scheduled', organizer_id: 9, organizer: 'Hasarinda Perera', host: null, project: null, client: null,
      start_at: '2099-10-13T05:30:00Z', end_at: '2099-10-13T07:00:00Z', all_day: false, timezone: null, duration_minutes: 90, recur_freq: 'none',
      location_type: 'hybrid', room_id: 1, room: 'Board Room A', address: null, where: 'Board Room A + Meet', online_provider: 'builtin', online_url: null,
      online_password: null, meet_uuid: '11111111-1111-4111-8111-111111111111',
      ...meeting,
    },
    deliveries: null,
    participants: [{ id: 3, user_id: 5, name: 'Me', email: 'me@x.lk', role: 'required', rsvp: 'accepted', attendance: null, permissions: null, attended_minutes: 0, external: false }],
    agenda: [{ id: 1, position: 1, title: 'Q3 usage', presenter: null, minutes: 20, notes: null, status: 'pending' }],
    minutes: null,
    action_items: [],
    files: [{ id: 8, kind: 'attachment', filename: 'deck.pdf', size: 1000, mime: 'application/pdf', url: null, created_at: '2099-10-01T00:00:00Z' }],
    chat: null,
    can: { view: true, schedule: true, manage: false, rooms: false },
    ...over,
  }) as unknown as Detail;

const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeetingDetail id={42} onBack={vi.fn()} /></QueryClientProvider>);
const serve = (d: Detail) => net.apiGet.mockImplementation(async (path: string) => (path === '/api/meetings/42' ? d : {}));

beforeEach(() => Object.values(net).forEach((f) => f.mockReset()));
afterEach(cleanup);

describe('abilities (MTG-U03)', () => {
  it("takes the server's word, a flag it leaves out being false, and `agenda` as the older name of run_agenda", () => {
    const ctx = { me: 9, mine: null, manage: true };
    expect(mt.abilitiesOf({ can: { edit: true }, live_status: 'scheduled', organizer_id: 9 }, ctx)).toEqual({ ...NONE, edit: true });
    expect(mt.abilitiesOf({ can: { agenda: true } as never, live_status: 'scheduled', organizer_id: 9 }, ctx).run_agenda).toBe(true);
    expect(mt.abilitiesOf({ can: { run_agenda: false, agenda: true } as never, live_status: 'scheduled', organizer_id: 9 }, ctx).run_agenda).toBe(false);
  });

  it('from an older server: whoever runs it may edit, cancel and run it; nobody is offered Start, Complete or Delete', () => {
    const runs = mt.abilitiesOf({ can: undefined, live_status: 'scheduled', organizer_id: 9 }, { me: 9, mine: null, manage: false });
    expect(runs).toMatchObject({ edit: true, cancel: true, run_agenda: true, invite: true, start: false, complete: false, delete: false, rsvp: false });
    const guest = mt.abilitiesOf({ can: null, live_status: 'scheduled', organizer_id: 9 }, { me: 5, mine: { role: 'required', permissions: { edit_minutes: true } }, manage: false });
    expect(guest).toMatchObject({ edit: false, cancel: false, run_agenda: false, minutes: true, rsvp: true, attend: true });
    expect(mt.abilitiesOf({ can: null, live_status: 'cancelled', organizer_id: 9 }, { me: 9, mine: null, manage: false })).toMatchObject({ cancel: false, attend: false });
  });

  it('says a refusal because the meeting moved on, and nothing else', () => {
    expect(mt.meetingProblem(new ApiError(409, 'Request failed', 'INVALID_STATUS'))?.message).toMatch(/changed since you opened it/);
    expect(mt.meetingProblem(new ApiError(409, 'This meeting is already cancelled.', 'INVALID_STATUS'))?.message).toBe('This meeting is already cancelled.');
    expect(mt.meetingProblem(new ApiError(410, '', 'MEETING_OVER'))?.message).toMatch(/over/);
    expect(mt.meetingProblem(new ApiError(403, 'No', null))).toBeNull();
    expect(mt.meetingProblem(new Error('x'))).toBeNull();
  });
});

describe('the meeting header (D02)', () => {
  it('offers nothing the server does not allow', async () => {
    serve(detail({ can: { ...NONE } }));
    wrap();
    expect(await screen.findByText('Acme Lanka — Q4 business review')).toBeTruthy();
    for (const name of [/Edit/, /Reschedule/, 'Start', 'Complete', 'Cancel meeting', 'Delete', 'Join']) expect(screen.queryByRole('button', { name })).toBeNull();
    // No answer to give: the answers are shown, not asked for.
    expect(screen.queryByRole('region', { name: 'Your answer' })).toBeNull();
  });

  it('offers each control its flag allows', async () => {
    serve(detail({ can: { ...NONE, edit: true, reschedule: true, cancel: true, delete: true, start: true, complete: true, attend: true, rsvp: true } }));
    net.apiPost.mockResolvedValue({});
    wrap();
    expect(await screen.findByRole('button', { name: /Edit/ })).toBeTruthy();
    for (const name of [/Reschedule/, 'Start', 'Complete', 'Cancel meeting', 'Delete', 'Join']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Your answer' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(net.openMeeting).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'Acme Lanka — Q4 business review');
  });

  it('an older server: the organiser keeps Edit and Cancel, and is not offered Start or Delete', async () => {
    serve(detail({ organizer_id: 5, can: undefined }));
    wrap();
    expect(await screen.findByRole('button', { name: /Edit/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel meeting' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reschedule/ })).toBeNull();
  });

  it('a Start refused because the meeting was cancelled meanwhile (409) is said, and the meeting read again', async () => {
    serve(detail({ can: { ...NONE, start: true } }));
    net.apiPost.mockRejectedValue(new ApiError(409, 'This meeting was cancelled.', 'INVALID_STATUS'));
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => expect(net.apiPost).toHaveBeenCalledWith('/api/meetings/42/start'));
    await waitFor(() => expect(net.toast).toHaveBeenCalledWith('info', 'This meeting was cancelled.'));
  });
});

describe('tabs by ability', () => {
  it('runs the agenda only with run_agenda', async () => {
    serve(detail({ can: { ...NONE } }));
    wrap();
    fireEvent.click(await screen.findByRole('tab', { name: 'Agenda' }));
    expect(screen.queryByRole('button', { name: 'Start this item' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Add an agenda item' })).toBeNull();
    cleanup();
    serve(detail({ can: { agenda: true } as never }));
    net.apiPost.mockResolvedValue({});
    wrap();
    fireEvent.click(await screen.findByRole('tab', { name: 'Agenda' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start this item' }));
    await waitFor(() => expect(net.apiPost).toHaveBeenCalledWith('/api/meetings/42/agenda/1/timer', { action: 'start' }));
  });

  it('uploads only with upload, and opens a file by its short-lived signed link (MTG-U06)', async () => {
    serve(detail({ can: { ...NONE } }));
    net.apiGet.mockImplementation(async (path: string) => (path === '/api/meetings/42' ? detail({ can: { ...NONE } }) : path === '/api/meetings/42/files/8/link' ? { url: 'https://ws.example/files/t0k3n', expires_at: 'x' } : {}));
    wrap();
    fireEvent.click(await screen.findByRole('tab', { name: 'Files' }));
    expect(screen.queryByRole('button', { name: 'Upload files' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('app:openExternal', { url: 'https://ws.example/files/t0k3n' }));
  });

  it('opens a signed path on the WorkSuite server, as the server signs it', async () => {
    net.apiGet.mockImplementation(async (path: string) => (path === '/api/meetings/42' ? detail({ can: { ...NONE } }) : path === '/api/meetings/42/files/8/link' ? { url: '/api/meetings/signed-files/abc?expires=1&sig=x-_y', expires_at: 'x' } : {}));
    wrap();
    fireEvent.click(await screen.findByRole('tab', { name: 'Files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('app:openInBrowser', { path: '/api/meetings/signed-files/abc?expires=1&sig=x-_y' }));
  });

  it("falls back to the list's address on a server without signed links, and never past a refusal", async () => {
    net.apiGet.mockRejectedValueOnce(new ApiError(404, 'Not found', null));
    expect(await fileLink(42, { id: 8, url: 'https://ws.example/old/8' })).toBe('https://ws.example/old/8');
    net.apiGet.mockRejectedValueOnce(new ApiError(404, 'Not found', null));
    expect(await fileLink(42, { id: 8, url: '/relative' })).toBeNull();
    net.apiGet.mockRejectedValueOnce(new ApiError(403, 'No', null));
    await expect(fileLink(42, { id: 8, url: 'https://ws.example/old/8' })).rejects.toThrow('No');
  });
});

describe('the home (D01)', () => {
  it('reads the list from this server or the paged one, with its paging', () => {
    const row = { id: 1 } as never;
    expect(mt.listOf({ meetings: [row] })).toEqual({ rows: [row], meta: null });
    expect(mt.listOf({ data: [row], meta: { page: 2, per_page: 25, total: 30, last_page: 2 } })).toEqual({ rows: [row], meta: { page: 2, per_page: 25, total: 30, last_page: 2 } });
    expect(mt.listOf(null)).toEqual({ rows: [], meta: null });
  });

  it('counts each day of the strip, every occurrence on its day, cancelled ones left out', () => {
    const add = (ymd: string, n: number) => {
      const d = new Date(`${ymd}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const strip = mt.dayStrip('2026-10-13', 3, [{ start_at: '2026-10-13T05:00:00Z' }, { start_at: '2026-10-13T09:00:00Z', status: 'cancelled' }, { start_at: '2026-10-15T09:00:00Z' }, { start_at: '2026-10-20T09:00:00Z' }], (s) => s.slice(0, 10), add);
    expect(strip).toEqual([{ day: '2026-10-13', count: 1 }, { day: '2026-10-14', count: 0 }, { day: '2026-10-15', count: 1 }]);
  });

  it('labels each row as the design does', () => {
    expect(mt.rowChip({ live_status: 'scheduled', my_role: 'organizer', my_rsvp: null })).toEqual(['Organiser', 'indigo']);
    expect(mt.rowChip({ live_status: 'scheduled', my_role: 'required', my_rsvp: 'accepted' })).toEqual(['Going', 'success']);
    expect(mt.rowChip({ live_status: 'scheduled', my_role: 'required', my_rsvp: 'no_response' })).toEqual(['Waiting for you', 'danger']);
    expect(mt.rowChip({ live_status: 'scheduled', my_role: 'required', my_rsvp: 'tentative' })).toEqual(['Tentative', 'warning']);
    expect(mt.rowChip({ live_status: 'ongoing', my_role: 'organizer', my_rsvp: null })).toEqual(['Happening now', 'danger']);
  });
});
