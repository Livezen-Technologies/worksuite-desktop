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
import { allowed, choicesOf, commentProblem, flatten, groupActions, liveLimits, liveResolution, postComment, tallyView, voteBlock, type Meeting, type Quorum } from '../../../src/modules/board/api';
import { boardDeviceRefusal, boardNoticeLink, offlineResponseRefusal, showOthersResponses } from '../../../shared/board';
import { parseDeepLink } from '../../../shared/deeplink';
import Room, { roomFrame } from '../../../src/modules/board/Room';
import Comments from '../../../src/modules/board/Comments';
import { CircularRespond } from '../../../src/modules/board/Approvals';
import Packs from '../../../src/modules/board/Packs';
import { highlight, marked } from '../../../src/modules/board/Search';
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
  it("opens the right Board screen for each of the server's notification keys", () => {
    expect(boardNoticeLink('board.vote.opened', { board_meeting_id: 11 })).toBe('/board?view=room&meeting=11');
    expect(boardNoticeLink('board.pack.published', { board_meeting_id: 11 })).toBe('/board?view=agenda&meeting=11');
    expect(boardNoticeLink('board.circular.reminder', { circular_id: 9 })).toBe('/board?view=approvals&circular=9');
    expect(boardNoticeLink('board.action.assigned', { action_id: 3 })).toBe('/board?view=actions');
    expect(boardNoticeLink('board.minutes.review', { board_meeting_id: 11 })).toBe('/board?view=approvals');
    expect(boardNoticeLink('board.backup.completed')).toBeNull();
    expect(boardNoticeLink('recruitment.offer_waiting')).toBeNull();
  });
  it('resolves worksuite://board links', () => {
    expect(parseDeepLink('worksuite://board/meetings/4')).toMatchObject({ ok: true, link: { route: '/board?view=agenda&meeting=4' } });
    expect(parseDeepLink('worksuite://board/circulars/9')).toMatchObject({ ok: true, link: { route: '/board?view=approvals&circular=9' } });
  });
  it('reads can{} from /meta with or without the prefix', () => {
    expect(allowed({ can: { 'board.access': true } }, 'access')).toBe(true);
    expect(allowed({ can: { 'vote.cast': true } }, 'board.vote.cast')).toBe(true);
    expect(allowed(undefined, 'access')).toBe(false);
  });
  it("reads the server's device refusal", () => {
    expect(boardDeviceRefusal(403, { code: 'device_blocked', command: 'WIPE' })).toBe('blocked');
    expect(boardDeviceRefusal(403, { code: 'device_revoked', command: 'WIPE' })).toBe('revoked');
    expect(boardDeviceRefusal(403, null)).toBeNull();
    expect(boardDeviceRefusal(422, { code: 'device_blocked' })).toBeNull();
  });
});

const Q = (over: Partial<Quorum> = {}): Quorum => ({ state: 'ESTABLISHED', established: true, present_voting: 7, eligible_voting: 8, required: 5, label: '✓ Established · 7 / 8 voting members', ...over });

describe('rules checked before the round trip', () => {
  it('a vote opens only with quorum', () => {
    expect(voteBlock(Q({ established: false, state: 'NOT_ESTABLISHED' }), null)).toBe('Cannot open vote — no quorum');
    expect(voteBlock(Q(), null)).toBeNull();
    expect(voteBlock(Q(), { id: 1, status: 'OPEN' })).toBe('Voting is open.');
    expect(voteBlock(Q(), { id: 1, status: 'CLOSING' })).toMatch(/casting/);
  });
  it('a secret ballot shows only the count cast', () => {
    expect(tallyView({ id: 1, status: 'OPEN', secret: true, ballots_cast: 4, eligible_count: 6 })).toEqual({ counts: null, cast: 4, eligible: 6 });
    expect(tallyView({ id: 1, status: 'OPEN', ballots_cast: 6, eligible_count: 6, counts: { FOR: 5, AGAINST: 0, ABSTAIN: 1 } }).counts).toEqual({ for: 5, against: 0, abstain: 1 });
    expect(tallyView({ id: 1, status: 'RESULT_FINAL', result: { outcome: 'PASSED', for: 6, against: 1, abstain: 0, cast: 7, eligible: 8 } })).toEqual({ counts: { for: 6, against: 1, abstain: 0 }, cast: 7, eligible: 8 });
    expect(choicesOf({ id: 1, status: 'OPEN', method: 'APPROVE_REJECT_ABSTAIN' })).toEqual(['APPROVE', 'REJECT', 'ABSTAIN']);
  });
  it('comments: 2,000 characters, and SPECIFIC names someone', () => {
    expect(commentProblem('  ', 'ALL', [])).toMatch(/Write/);
    expect(commentProblem('x'.repeat(2001), 'ALL', [])).toMatch(/2000/);
    expect(commentProblem('ok', 'SPECIFIC', [])).toMatch(/Choose/);
    expect(commentProblem('ok', 'SPECIFIC', [3])).toBeNull();
  });
  it('groups my actions', () => {
    const g = groupActions([
      { id: 1, title: 'a', status: 'OPEN', due_on: '2026-10-19' },
      { id: 2, title: 'b', status: 'IN_PROGRESS', due_on: '2026-10-23' },
      { id: 3, title: 'c', status: 'OPEN', due_on: '2026-11-30' },
      { id: 4, title: 'd', status: 'COMPLETED', due_on: '2026-10-01' },
      { id: 5, title: 'e', status: 'VERIFIED' },
    ], new Date('2026-10-21T09:00:00'));
    expect([g.overdue, g.week, g.later, g.verify].map((x) => x.map((a) => a.id))).toEqual([[1], [2], [3], [4]]);
  });
  it('limits invitees, observers and presenters in a live meeting', () => {
    expect(liveLimits('INVITEE', true)).toEqual({ comment: false, download: false, allItems: true });
    expect(liveLimits('observer', true).comment).toBe(false);
    expect(liveLimits('PRESENTER', true).allItems).toBe(false);
    expect(liveLimits('MEMBER', true)).toEqual({ comment: true, download: true, allItems: true });
  });
  it('flattens the nested agenda in order', () => {
    expect(flatten([{ id: 1, number: '1', title: 'a', children: [{ id: 2, number: '1.1', title: 'b' }] }, { id: 3, number: '2', title: 'c' }]).map((i) => [i.number, i.depth])).toEqual([['1', 0], ['1.1', 1], ['2', 0]]);
  });
  it('the resolution on the floor is the presented item’s', () => {
    const list = [{ id: 1, resolution_number: 'RES-1', title: 'a', resolution_text: 'x', status: 'PROPOSED', agenda_item_id: 31 }, { id: 2, resolution_number: 'RES-2', title: 'b', resolution_text: 'y', status: 'SECONDED', agenda_item_id: 32 }];
    expect(liveResolution(list, 32)?.id).toBe(2);
    expect(liveResolution([{ ...list[0]!, status: 'RECORDED' }], 31)).toBeNull();
  });
  it('offline circular responses: policy, deadline, eligibility, once; others shown only after mine and never secret', () => {
    const now = Date.parse('2026-10-21T10:00:00Z');
    const base = { id: 9, status: 'ISSUED', deadline_at: '2026-10-25T17:00:00Z', allow_offline: true, me: { eligible: true, response: null } };
    expect(offlineResponseRefusal(base, now)).toBeNull();
    expect(offlineResponseRefusal({ ...base, allow_offline: false }, now)).toMatch(/policy/);
    expect(offlineResponseRefusal({ ...base, deadline_at: '2026-10-20T00:00:00Z' }, now)).toMatch(/deadline/);
    expect(offlineResponseRefusal({ ...base, me: { eligible: false } }, now)).toMatch(/eligible/);
    expect(offlineResponseRefusal({ ...base, me: { eligible: true, response: 'APPROVE' } }, now)).toMatch(/already/);
    expect(offlineResponseRefusal({ ...base, status: 'PASSED' }, now)).toMatch(/closed/);
    expect(showOthersResponses({ show_responses: true }, true)).toBe(true);
    expect(showOthersResponses({ show_responses: true }, false)).toBe(false);
    expect(showOthersResponses({ show_responses: true, secret: true }, true)).toBe(false);
  });
  it('takes only frames of this meeting’s channel', () => {
    expect(roomFrame({ type: 'board.realtime', channel: 'board.meeting.11', event: 'quorum.changed', seq: 4, board_meeting_id: 11, data: {} }, 11)).toBeTruthy();
    expect(roomFrame({ type: 'board.realtime', channel: 'board.meeting.11', event: 'board.vote.tally', seq: 5, board_meeting_id: 11, data: {} }, 11)).toBeTruthy();
    expect(roomFrame({ type: 'board.realtime', channel: 'board.meeting.12', event: 'quorum.changed', seq: 4, board_meeting_id: 12, data: {} }, 11)).toBeNull();
    expect(roomFrame({ type: 'chat.message', channel: 'board.meeting.11', event: 'quorum.changed' }, 11)).toBeNull();
  });
});

const MEETING = (over: Partial<Meeting> = {}): Meeting => ({
  id: 11, board_id: 1, title: 'Board of Directors', meeting_number: 'BOD/2026/011', body: 'Board of Directors', starts_at: '2026-10-20T09:00:00Z', gov_status: 'IN_PROGRESS', my_role: 'CHAIR', can_run: true, started_at: '2026-10-20T09:00:00Z',
  quorum: Q(),
  participants: [{ user_id: 1, name: 'Ravi Perera', meeting_role: 'MEMBER', state: 'PRESENT' }, { user_id: 2, name: 'Dinesh Rajapakse', meeting_role: 'MEMBER', state: 'PRESENT' }],
  presenting: { agenda_item_id: 32, page: 3 },
  ...over,
});
const AGENDA = { items: [{ id: 31, number: '3.1', title: 'Q3 financial results' }, { id: 32, number: '3.2', title: 'FY 2027 budget approval', papers: [{ id: 5, title: 'budget', status: 'BOARD_READY' }] }] };
const RESOLUTIONS = { items: [{ id: 14, resolution_number: 'RES-2026-014', title: 'Budget', resolution_text: 'RESOLVED THAT the FY 2027 budget be approved.', status: 'SECONDED', agenda_item_id: 32 }] };
const room = (meeting: Meeting, votes: unknown[] = []) => ({
  '/meetings/11': meeting, '/meetings/11/agenda': AGENDA, '/votes': { items: votes }, '/resolutions': RESOLUTIONS, '/meetings/11/polls': { items: [] }, '/meetings/11/events': { channel: 'board.meeting.11', items: [], last_seq: 0 },
  '/papers/5': { id: 5, title: 'budget', current_version: { id: 55, paper_id: 5, version: 2, pages: 11 }, versions: [{ id: 54, paper_id: 5, version: 1 }, { id: 55, paper_id: 5, version: 2 }] },
});

describe('D-12 live meeting room', () => {
  it('the chair opens the vote with quorum', async () => {
    serve(room(MEETING()));
    vi.mocked(apiPost).mockImplementation(async (p: string) => (p.endsWith('/votes') ? { id: 70, status: 'CREATED' } : { id: 70, status: 'OPEN' }));
    wrap(<Room meetingId={11} onMinutes={() => undefined} />);
    expect((await screen.findAllByTestId('paper'))[0]!.textContent).toBe('budget.pdf');
    fireEvent.click(await screen.findByRole('button', { name: 'Open vote' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/board/votes/70/open'));
    expect(apiPost).toHaveBeenCalledWith('/api/board/votes', { board_meeting_id: 11, resolution_id: 14 });
  });
  it('without quorum the vote cannot open', async () => {
    serve(room(MEETING({ quorum: Q({ established: false, state: 'LOST', present_voting: 4, label: '▲ Lost · 4 / 8 voting members' }) })));
    wrap(<Room meetingId={11} onMinutes={() => undefined} />);
    const b = await screen.findByRole('button', { name: 'Cannot open vote — no quorum' });
    expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Lost · 4 \/ 8/)).toBeTruthy();
  });
  it('a tie asks the chair for the casting vote, then closes with it', async () => {
    serve(room(MEETING(), [{ id: 70, resolution_id: 14, status: 'OPEN', ballots_cast: 6, eligible_count: 6, counts: { FOR: 3, AGAINST: 3, ABSTAIN: 0 } }]));
    const { ApiError } = await import('../../../src/core/api');
    vi.mocked(apiPost).mockImplementation(async (_p: string, body?: unknown) => {
      if (!(body as { casting_choice?: string })?.casting_choice) throw new ApiError(409, 'Tied: the chair has the casting vote.', null, { code: 'casting_vote_required' });
      return { id: 70, status: 'RESULT_FINAL' };
    });
    wrap(<Room meetingId={11} onMinutes={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: /Close vote/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'For' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/board/votes/70/close', { casting_choice: 'FOR' }));
  });
  it('shows the live tally and lets a member cast online', async () => {
    serve(room(MEETING({ my_role: 'MEMBER', can_run: false }), [{ id: 70, resolution_id: 14, status: 'OPEN', ballots_cast: 6, eligible_count: 6, me: { eligible: true, has_voted: false } }]));
    wrap(<Room meetingId={11} onMinutes={() => undefined} />);
    expect(await screen.findByText('6 of 6 eligible voted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'For' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/board/votes/70/cast', { choice: 'FOR' }));
  });
});

describe('D-04 comments', () => {
  it('sends to specific people only once someone is chosen', async () => {
    serve({ '/meetings/11/agenda': AGENDA, '/meetings/11/comments': { items: [] } });
    vi.mocked(apiPost).mockImplementation(async (p: string) => (p.endsWith('/ai/summarize') ? { summary: 'Revenue up 12%', sources: [], ai: true, label: 'AI summary — check it against the paper' } : { comment: { id: 1 } }));
    wrap(<Comments meetingId={11} item={32} participants={[{ user_id: 7, name: 'Ahmed Khan', meeting_role: 'MEMBER', state: 'ACCEPTED' }]} canComment onItem={() => undefined} />);
    expect(await screen.findByText(/Revenue up 12%/)).toBeTruthy();
    expect(apiPost).toHaveBeenCalledWith('/api/board/ai/summarize', { paper_id: 5 });
    fireEvent.change(screen.getByPlaceholderText(/Write a comment/), { target: { value: 'Ask the CFO' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Specific…' }));
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('People'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/board/meetings/11/comments', { agenda_item_id: 32, body: 'Ask the CFO', audience: 'SPECIFIC', shared_with: [7] }));
    await expect(postComment(11, 32, '   ', 'ALL')).rejects.toThrow(/Write/);
  });
});

const CIRC = { id: 9, number: 'CIR-2026-009', title: 'Auditor', resolution_text: 'RESOLVED THAT', status: 'ISSUED', deadline_at: '2030-01-01T00:00:00Z', approvals: 5, required: 6, me: { eligible: true, response: null } };

describe('circular responses (FR-VOT-08)', () => {
  it('online: responds through the server', async () => {
    serve({ '/circulars/9': CIRC });
    wrap(<CircularRespond id={9} offline={false} />);
    fireEvent.change(await screen.findByLabelText(/Comment/), { target: { value: 'Agreed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/board/circulars/9/respond', { response: 'APPROVE', comment: 'Agreed' }));
  });
  it('a signed circular asks for the step-up when the server does (428), then sends the password', async () => {
    serve({ '/circulars/9': { ...CIRC, sign_required: true } });
    const { ApiError } = await import('../../../src/core/api');
    vi.mocked(apiPost).mockImplementation(async (_p: string, body?: unknown) => {
      if (!(body as { current_password?: string }).current_password) throw new ApiError(428, 'Confirm it is you.', null, { step_up: true, methods: ['password'] });
      return { ...CIRC };
    });
    wrap(<CircularRespond id={9} offline={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(apiPost).toHaveBeenLastCalledWith('/api/board/circulars/9/respond', { response: 'APPROVE', type: 'ACKNOWLEDGEMENT', current_password: 'pw' }));
  });
  it('offline: records on this device, signed in the main process', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['board', 'circular', 9], { ...CIRC, allow_offline: true });
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
    qc.setQueryData(['board', 'circular', 9], { ...CIRC, allow_offline: false });
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
  it('says plainly when a revoked device was wiped, and when one waits for approval', () => {
    wrap(<Packs status={{ keystore: true, backend: 'dpapi', trust: 'revoked', lastSyncAt: null, queued: 0, packs: [], wiped: { at: '', reason: 'An administrator revoked this device.' } }} meetings={[]} onOpen={() => undefined} />);
    expect(screen.getByRole('alert').textContent).toMatch(/revoked this device.*Your own files were not touched/);
    expect(screen.getByText('Revoked')).toBeTruthy();
    cleanup();
    wrap(<Packs status={{ keystore: true, backend: 'dpapi', trust: 'pending', lastSyncAt: null, queued: 0, packs: [], wiped: null }} meetings={[]} onOpen={() => undefined} />);
    expect(screen.getByText(/Waiting for an administrator/)).toBeTruthy();
  });
  it('saves an annotation to the server, or queues it in the vault when offline', async () => {
    vi.mocked(call).mockResolvedValue(undefined as never);
    expect(await keepAnnotation(4, 111, { page: 3, quote: 'q', note: 'n', visibility: 'PRIVATE', kind: 'highlight' }, 'a1', true)).toBe('queued');
    expect(call).toHaveBeenCalledWith('board:queueAdd', { kind: 'annotation', meetingId: 4, ref: 'a1', body: { paper_version_id: 111, page: 3, kind: 'highlight', body: 'n', anchor: { text: 'q' }, visibility: 'PRIVATE', client_uuid: 'a1' } });
    expect(apiPost).not.toHaveBeenCalled();
    expect(await keepAnnotation(4, 111, { page: 3, quote: '', note: 'n', visibility: 'COMMITTEE', kind: 'note' }, 'a2', false)).toBe('server');
    expect(apiPost).toHaveBeenCalledWith('/api/board/annotations', expect.objectContaining({ board_meeting_id: 4, paper_version_id: 111, kind: 'note', body: 'n', anchor: null, visibility: 'COMMITTEE', client_uuid: 'a2' }));
  });
  it('exports my notes and highlights matches', () => {
    expect(exportNotes([{ id: 1, user_id: 1, kind: 'highlight', page: 11, anchor: { text: 'Receivables' }, body: 'Ask', visibility: 'PRIVATE' }])).toContain('Highlight · p 11\n“Receivables”\nAsk');
    render(<p>{highlight('Appointment of external auditor', 'auditor appointment')}</p>);
    expect(document.querySelectorAll('mark').length).toBe(2);
    cleanup();
    render(<p>{marked('The [[auditor]] rotation and [[audit]] fees')}</p>);
    expect([...document.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['auditor', 'audit']);
  });
});
