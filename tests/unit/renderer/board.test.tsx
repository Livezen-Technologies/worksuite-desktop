// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<object>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({ id: 9 })), apiPatch: vi.fn(async () => ({ id: 9 })), apiPut: vi.fn(async () => ({ id: 9 })) }));
vi.mock('../../../src/components/FileViewer', () => ({ FileViewer: ({ name }: { name: string }) => <div data-testid="paper">{name}</div> }));

import { call } from '../../../src/core/bridge';
import { apiGet, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { allowed, commentProblem, groupActions, liveLimits, postComment, tallyView, voteBlock, type Meeting } from '../../../src/modules/board/api';
import { boardNoticeLink, offlineResponseRefusal, packExpiry, showOthersResponses } from '../../../shared/board';
import { parseDeepLink } from '../../../shared/deeplink';
import Room from '../../../src/modules/board/Room';
import Comments from '../../../src/modules/board/Comments';
import { CircularRespond } from '../../../src/modules/board/Approvals';
import Packs from '../../../src/modules/board/Packs';
import { highlight } from '../../../src/modules/board/Search';
import { exportNotes } from '../../../src/modules/board/Annotations';
import { keepAnnotation } from '../../../src/modules/board/Reader';

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
function serve(map: Record<string, unknown>) {
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    for (const [k, v] of Object.entries(map)) if (path.endsWith(k)) return v;
    throw new Error(`unexpected GET ${path}`);
  });
}
const setNetwork = (network: 'ONLINE' | 'OFFLINE') => app.set({ status: { ...(app.get().status ?? {}), network } as never });

beforeEach(() => { vi.mocked(apiPost).mockClear(); vi.mocked(call).mockClear(); setNetwork('ONLINE'); });
afterEach(() => cleanup());

describe('notices, deep links and permissions', () => {
  it('opens the right Board screen for each event', () => {
    expect(boardNoticeLink('board.vote.opened', { meeting_id: 11 })).toBe('/board?view=room&meeting=11');
    expect(boardNoticeLink('board.pack.published', { meeting_id: 11 })).toBe('/board?view=packs');
    expect(boardNoticeLink('board.circular.created', { circular_id: 9 })).toBe('/board?view=approvals&circular=9');
    expect(boardNoticeLink('board.action.created')).toBe('/board?view=actions');
    expect(boardNoticeLink('board.backup.completed')).toBeNull();
    expect(boardNoticeLink('recruitment.offer_waiting')).toBeNull();
  });
  it('resolves worksuite://board links', () => {
    expect(parseDeepLink('worksuite://board/meetings/4')).toMatchObject({ ok: true, link: { route: '/board?view=agenda&meeting=4' } });
    expect(parseDeepLink('worksuite://board/circulars/9')).toMatchObject({ ok: true, link: { route: '/board?view=approvals&circular=9' } });
  });
  it('reads can{} with or without the prefix', () => {
    expect(allowed({ can: { 'board.access': true } }, 'access')).toBe(true);
    expect(allowed({ can: { 'notice.send': true } }, 'board.notice.send')).toBe(true);
    expect(allowed(undefined, 'access')).toBe(false);
  });
});

describe('rules checked before the round trip', () => {
  it('a vote opens only with quorum', () => {
    expect(voteBlock({ present: 4, required: 5, met: false }, null)).toBe('Cannot open vote — no quorum');
    expect(voteBlock({ present: 7, required: 5, met: true }, null)).toBeNull();
    expect(voteBlock({ present: 7, required: 5, met: true }, { id: 1, status: 'open' })).toBe('Voting is open.');
  });
  it('a secret ballot shows only the count cast', () => {
    expect(tallyView({ id: 1, status: 'open', secret: true, for: 3, against: 1, abstain: 0, eligible: 6 })).toEqual({ counts: null, cast: 4, eligible: 6 });
    expect(tallyView({ id: 1, status: 'open', for: 5, against: 0, abstain: 1, eligible: 6 }).counts).toEqual({ for: 5, against: 0, abstain: 1 });
  });
  it('comments: 2,000 characters, and "specific" names someone', () => {
    expect(commentProblem('  ', 'all', [])).toMatch(/Write/);
    expect(commentProblem('x'.repeat(2001), 'all', [])).toMatch(/2000/);
    expect(commentProblem('ok', 'specific', [])).toMatch(/Choose/);
    expect(commentProblem('ok', 'specific', [3])).toBeNull();
  });
  it('groups my actions', () => {
    const g = groupActions([
      { id: 1, title: 'a', status: 'open', due: '2026-10-19' },
      { id: 2, title: 'b', status: 'in_progress', due: '2026-10-23' },
      { id: 3, title: 'c', status: 'open', due: '2026-11-30' },
      { id: 4, title: 'd', status: 'done', due: '2026-10-01' },
      { id: 5, title: 'e', status: 'verified' },
    ], new Date('2026-10-21T09:00:00'));
    expect([g.overdue, g.week, g.later, g.verify].map((x) => x.map((a) => a.id))).toEqual([[1], [2], [3], [4]]);
  });
  it('limits invitees and presenters in a live meeting', () => {
    expect(liveLimits('invitee', true)).toEqual({ comment: false, download: false, allItems: true });
    expect(liveLimits('presenter', true).allItems).toBe(false);
    expect(liveLimits('member', true)).toEqual({ comment: true, download: true, allItems: true });
  });
  it('offline circular responses: policy, deadline, eligibility, never live; others shown only after mine and never secret', () => {
    const now = Date.parse('2026-10-21T10:00:00Z');
    const base = { id: 9, status: 'open', deadline: '2026-10-25T17:00:00Z', offline_responses_allowed: true };
    expect(offlineResponseRefusal(base, now)).toBeNull();
    expect(offlineResponseRefusal({ ...base, offline_responses_allowed: false }, now)).toMatch(/policy/);
    expect(offlineResponseRefusal({ ...base, deadline: '2026-10-20T00:00:00Z' }, now)).toMatch(/deadline/);
    expect(offlineResponseRefusal({ ...base, can_respond: false }, now)).toMatch(/eligible/);
    expect(offlineResponseRefusal({ ...base, live_meeting: true }, now)).toMatch(/online only/);
    expect(offlineResponseRefusal({ ...base, status: 'closed' }, now)).toMatch(/closed/);
    expect(showOthersResponses({ show_responses: true }, true)).toBe(true);
    expect(showOthersResponses({ show_responses: true }, false)).toBe(false);
    expect(showOthersResponses({ show_responses: true, secret: true }, true)).toBe(false);
  });
  it('expiry is the soonest of grant, max offline days and archive date', () => {
    const now = Date.parse('2026-10-21T00:00:00Z');
    expect(packExpiry({ grantExpiresAt: '2026-11-30T00:00:00Z', maxOfflineDays: 7, archiveAt: '2026-12-01T00:00:00Z' }, now)).toBe('2026-10-28T00:00:00.000Z');
    expect(packExpiry({ archiveAt: '2026-10-22T00:00:00Z', maxOfflineDays: 7 }, now)).toBe('2026-10-22T00:00:00.000Z');
  });
});

const MEETING = (over: Partial<Meeting> = {}): Meeting => ({
  id: 11, title: 'Board of Directors', number: 'BOD/2026/011', starts_at: '2026-10-20T09:00:00Z', status: 'live', my_role: 'chair', started_at: '2026-10-20T09:00:00Z',
  body: { id: 1, name: 'Board of Directors' },
  quorum: { present: 7, required: 5, voting_total: 8, met: true },
  participants: [{ id: 1, name: 'Ravi Perera', presence: 'in_room' }, { id: 2, name: 'Dinesh Rajapakse', presence: 'in_room', conflict_items: ['3.2'] }],
  live: { item_id: 32, page: 3, resolution: { id: 14, number: 'RES-2026-014', text: 'RESOLVED THAT the FY 2027 budget be approved.' }, vote: null },
  ...over,
});
const AGENDA = [{ id: 31, number: '3.1', title: 'Q3 financial results' }, { id: 32, number: '3.2', title: 'FY 2027 budget approval', paper: { id: 5, name: 'budget.pdf', pages: 11 } }];

describe('D-12 live meeting room', () => {
  it('the chair opens the vote with quorum', async () => {
    serve({ '/meetings/11': MEETING(), '/meetings/11/agenda': AGENDA });
    vi.mocked(apiPost).mockImplementation(async (p: string) => (p.endsWith('/votes') ? { id: 70, status: 'draft' } : { id: 70, status: 'open' }));
    wrap(<Room meetingId={11} onMinutes={() => undefined} />);
    expect((await screen.findAllByTestId('paper'))[0]!.textContent).toBe('budget.pdf');
    expect(screen.getByText('Conflict 3.2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open vote' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/board/votes/70/open'));
    expect(apiPost).toHaveBeenCalledWith('/api/board/votes', { resolution_id: 14 });
  });
  it('without quorum the vote cannot open', async () => {
    serve({ '/meetings/11': MEETING({ quorum: { present: 4, required: 5, voting_total: 8, met: false } }), '/meetings/11/agenda': AGENDA });
    wrap(<Room meetingId={11} onMinutes={() => undefined} />);
    const b = await screen.findByRole('button', { name: 'Cannot open vote — no quorum' });
    expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Quorum lost/)).toBeTruthy();
  });
  it('shows the live tally and lets a member cast online', async () => {
    serve({ '/meetings/11': MEETING({ my_role: 'member', live: { ...MEETING().live!, vote: { id: 70, status: 'open', for: 5, against: 0, abstain: 1, eligible: 6 } } }), '/meetings/11/agenda': AGENDA });
    wrap(<Room meetingId={11} onMinutes={() => undefined} />);
    expect(await screen.findByText('6 of 6 eligible voted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'For' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/board/votes/70/cast', { choice: 'for' }));
  });
});

describe('D-04 comments', () => {
  it('sends to specific people only once someone is chosen', async () => {
    serve({ '/meetings/11/agenda': AGENDA, '/meetings/11/comments': [], '/ai/summarize': {} });
    vi.mocked(apiPost).mockImplementation(async (p: string) => (p.endsWith('/ai/summarize') ? { points: [{ label: 'Headline', text: 'Revenue up', page: 3 }] } : { id: 1 }));
    wrap(<Comments meetingId={11} item={32} participants={[{ id: 7, name: 'Ahmed Khan' }]} canComment onItem={() => undefined} />);
    expect(await screen.findByText('p3')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Write a comment/), { target: { value: 'Ask the CFO' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Specific…' }));
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('People'), { target: { value: '7' } });
    await expect(postComment(11, 32, '   ', 'all')).rejects.toThrow(/Write/);
  });
});

describe('circular responses (FR-VOT-08)', () => {
  it('online: responds through the server', async () => {
    serve({ '/circulars/9': { id: 9, number: 'CIR-2026-009', title: 'Auditor', text: 'RESOLVED THAT', status: 'open', deadline: '2030-01-01T00:00:00Z', approvals: 5, required: 6 } });
    wrap(<CircularRespond id={9} offline={false} />);
    fireEvent.change(await screen.findByLabelText(/Comment/), { target: { value: 'Agreed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/board/circulars/9/respond', { choice: 'approve', comment: 'Agreed' }));
  });
  it('offline: records on this device, signed in the main process', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['board', 'circular', 9], { id: 9, number: 'CIR-2026-011', title: 'Treaty', text: 'RESOLVED', status: 'open', deadline: '2030-01-01T00:00:00Z', offline_responses_allowed: true });
    vi.mocked(call).mockImplementation((async (ch: string) => (ch === 'board:respondOffline' ? { id: 'q', kind: 'circular', at: '2026-10-21T10:00:00Z', outcome: 'pending' } : undefined)) as never);
    setNetwork('OFFLINE');
    render(<QueryClientProvider client={qc}><CircularRespond id={9} offline={false} /></QueryClientProvider>);
    expect(screen.getByText(/your response will be sent when you reconnect/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('board:respondOffline', { circularId: 9, choice: 'approve', comment: undefined }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(await screen.findByText(/queued on this device/)).toBeTruthy();
  });
  it('offline without the policy: the buttons say why and stay off', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['board', 'circular', 9], { id: 9, number: 'C', title: 'T', text: 'R', status: 'open', deadline: '2030-01-01T00:00:00Z', offline_responses_allowed: false });
    setNetwork('OFFLINE');
    render(<QueryClientProvider client={qc}><CircularRespond id={9} offline /></QueryClientProvider>);
    expect(screen.getByRole('alert').textContent).toMatch(/policy/);
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('D-05 packs, D-06 notes, D-07 search', () => {
  it('lists kept packs with update and expiry, and the device trust', () => {
    wrap(<Packs status={{ keystore: true, backend: 'keychain', trust: 'trusted', lastSyncAt: null, queued: 2, wiped: null, packs: [
      { meetingId: 4, title: 'Audit Committee — AC/2026/004', version: 2, pages: 75, notes: 6, bytes: 3e6, downloadedAt: '', expiresAt: '2026-11-01T00:00:00Z', latestVersion: null, state: 'ready' },
      { meetingId: 5, title: 'AC/2026/005', version: 2, pages: 10, notes: 0, bytes: 1e6, downloadedAt: '', expiresAt: '2026-11-01T00:00:00Z', latestVersion: 3, state: 'ready' },
    ] }} meetings={[]} onOpen={() => undefined} />);
    expect(screen.getByText(/Offline · until/)).toBeTruthy();
    expect(screen.getByText('Update ready')).toBeTruthy();
    expect(screen.getByText('Trusted')).toBeTruthy();
    expect(screen.getByText(/2 waiting/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(call).toHaveBeenCalledWith('board:packDownload', { meetingId: 5 });
  });
  it('says plainly when a revoked device was wiped', () => {
    wrap(<Packs status={{ keystore: true, backend: 'dpapi', trust: 'revoked', lastSyncAt: null, queued: 0, packs: [], wiped: { at: '', reason: 'An administrator revoked this device.' } }} meetings={[]} onOpen={() => undefined} />);
    expect(screen.getByRole('alert').textContent).toMatch(/revoked this device.*Your own files were not touched/);
    expect(screen.getByText('Revoked')).toBeTruthy();
  });
  it('queues an annotation in the vault when offline', async () => {
    vi.mocked(call).mockResolvedValue(undefined as never);
    expect(await keepAnnotation(4, 11, { page: 3, quote: 'q', note: 'n', share: 'private', kind: 'highlight' }, 'a1', true)).toBe('queued');
    expect(call).toHaveBeenCalledWith('board:queueAdd', expect.objectContaining({ kind: 'annotation', meetingId: 4, ref: 'a1' }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(await keepAnnotation(4, 11, { page: 3, quote: '', note: 'n', share: 'shared', kind: 'text' }, 'a2', false)).toBe('server');
  });
  it('exports my notes and highlights matches', () => {
    expect(exportNotes([{ id: 1, paper: 'Q3', item: '2.1', page: 11, quote: 'Receivables', note: 'Ask', share: 'private', at: '' }])).toContain('2.1 · p 11\n“Receivables”\nAsk');
    render(<p>{highlight('Appointment of external auditor', 'auditor appointment')}</p>);
    expect(document.querySelectorAll('mark').length).toBe(2);
  });
});
