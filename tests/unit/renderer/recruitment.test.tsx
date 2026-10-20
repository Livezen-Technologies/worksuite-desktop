// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<object>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({ id: 9 })), apiPatch: vi.fn(async () => ({ id: 9 })) }));
vi.mock('../../../src/components/FileViewer', () => ({ FileViewer: ({ name }: { name: string }) => <div data-testid="cv">{name}</div> }));

import { apiGet, apiPatch, apiPost } from '../../../src/core/api';
import {
  allowed, decide, decisionPath, isBackward, moveApplication, queueKey, submitScorecard, validateScorecard, type Approval, type Stage,
} from '../../../src/modules/recruitment/api';
import Pipeline from '../../../src/modules/recruitment/Pipeline';
import Review from '../../../src/modules/recruitment/Review';
import { ScorecardForm } from '../../../src/modules/recruitment/Scorecard';
import Approvals from '../../../src/modules/recruitment/Approvals';
import { recruitmentNoticeLink } from '../../../shared/recruitment';

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const card = (id: number, name: string) => ({ id, candidate: { id: id * 10, name }, status: 'ACTIVE', flags: { duplicate: id === 2 } });
const STAGES: Stage[] = [
  { id: 1, name: 'Applied', category: 'APPLIED', position: 1, applications: [card(1, 'Kavindu Rajapaksha'), card(2, 'Ayesha Rahman')] },
  { id: 2, name: 'Screening', category: 'SCREENING', position: 2, applications: [card(3, 'Kasun Dissanayake')] },
  { id: 3, name: 'Shortlisted', category: 'SHORTLISTED', position: 3, applications: [] },
];
/** Routes the mocked apiGet by path. */
function serve(map: Record<string, unknown>) {
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    for (const [k, v] of Object.entries(map)) if (path.endsWith(k)) return v;
    throw new Error(`unexpected GET ${path}`);
  });
}

beforeEach(() => { vi.mocked(apiPost).mockClear(); vi.mocked(apiPatch).mockClear(); vi.mocked(apiPost).mockImplementation(async () => ({ id: 9 })); });
afterEach(() => cleanup());

describe('recruitment permissions and notices', () => {
  it('reads can{} with or without the prefix', () => {
    expect(allowed({ can: { 'candidate.view': true } }, 'recruitment.candidate.view')).toBe(true);
    expect(allowed({ can: { 'recruitment.offer.approve': true } }, 'offer.approve')).toBe(true);
    expect(allowed({ can: {} }, 'access')).toBe(false);
    expect(allowed(undefined, 'access')).toBe(false);
  });
  it('opens the right screen for each recruitment key', () => {
    expect(recruitmentNoticeLink('recruitment.interview_scheduled')).toBe('/recruitment?tab=today');
    expect(recruitmentNoticeLink('recruitment.evaluation_due', { interview_id: 7 })).toBe('/recruitment?tab=cards&interview=7');
    expect(recruitmentNoticeLink('recruitment.offer_waiting')).toBe('/recruitment?tab=appr');
    expect(recruitmentNoticeLink('recruitment.requisition_waiting')).toBe('/recruitment?tab=appr');
    expect(recruitmentNoticeLink('recruitment.hire_completed')).toBeNull();
    expect(recruitmentNoticeLink('mail.received')).toBeNull();
  });
});

describe('pipeline moves (D01)', () => {
  it('knows a backward move', () => {
    expect(isBackward(STAGES, 2, 1)).toBe(true);
    expect(isBackward(STAGES, 1, 2)).toBe(false);
  });
  it('refuses a backward move or an exit without a reason, and sends the reason', async () => {
    await expect(moveApplication(5, { stage_id: 1 }, { backward: true })).rejects.toThrow(/reason/);
    await expect(moveApplication(5, { status: 'WITHDRAWN', reason: '  ' })).rejects.toThrow(/reason/);
    expect(apiPost).not.toHaveBeenCalled();
    await moveApplication(5, { stage_id: 1, reason: ' Missed a requirement ' }, { backward: true });
    expect(apiPost).toHaveBeenCalledWith('/api/recruitment/applications/5/move', { stage_id: 1, reason: 'Missed a requirement' });
  });
  it('dragging a card back asks for a reason, then moves it with that reason', async () => {
    serve({ '/jobs': [{ id: 4, title: 'Senior PHP Developer', status: 'OPEN' }], '/jobs/4/pipeline': { stages: STAGES } });
    wrap(<Pipeline job={4} canMove onJob={() => undefined} onWeb={() => undefined} />);
    const kasun = await screen.findByRole('article', { name: 'Kasun Dissanayake' });
    expect(screen.getByText('Possible duplicate')).toBeTruthy();
    fireEvent.dragStart(kasun);
    fireEvent.dragOver(screen.getByRole('listitem', { name: 'Applied' }));
    fireEvent.drop(screen.getByRole('listitem', { name: 'Applied' }));
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'Wrong stage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/recruitment/applications/3/move', { stage_id: 1, reason: 'Wrong stage' }));
  });
  it('a forward drag moves at once, without a reason', async () => {
    serve({ '/jobs': [{ id: 4, title: 'Senior PHP Developer', status: 'OPEN' }], '/jobs/4/pipeline': { stages: STAGES } });
    wrap(<Pipeline job={4} canMove onJob={() => undefined} onWeb={() => undefined} />);
    fireEvent.dragStart(await screen.findByRole('article', { name: 'Kavindu Rajapaksha' }));
    fireEvent.drop(screen.getByRole('listitem', { name: 'Screening' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/recruitment/applications/1/move', { stage_id: 2 }));
    expect(screen.queryByLabelText('Reason')).toBeNull();
  });
});

describe('review queue keys (D02)', () => {
  it('maps J/K/A/R/S and ignores typing and modifiers', () => {
    expect(queueKey({ key: 'j' })).toBe('next');
    expect(queueKey({ key: 'K' })).toBe('prev');
    expect(queueKey({ key: 'a' })).toBe('advance');
    expect(queueKey({ key: 'r' })).toBe('reject');
    expect(queueKey({ key: 's' })).toBe('shortlist');
    expect(queueKey({ key: 's', metaKey: true })).toBeNull();
    expect(queueKey({ key: 'j', target: document.createElement('textarea') })).toBeNull();
    expect(queueKey({ key: 'x' })).toBeNull();
  });
  it('J moves on, S shortlists, R rejects with a reason', async () => {
    serve({
      '/jobs': [{ id: 4, title: 'Senior PHP Developer', status: 'OPEN' }],
      '/jobs/4/pipeline': { stages: STAGES },
      '/candidates': { items: [{ id: 10, name: 'Kasun Dissanayake', application_id: 101 }, { id: 11, name: 'Hiruni Peiris', application_id: 102 }, { id: 12, name: 'Pradeep J.', application_id: 103 }] },
      '/candidates/10': { id: 10, name: 'Kasun Dissanayake', files: [{ id: 1, name: 'kasun-cv.pdf', category: 'cv' }] },
      '/candidates/11': { id: 11, name: 'Hiruni Peiris', files: [{ id: 2, name: 'hiruni.pdf' }] },
      '/candidates/12': { id: 12, name: 'Pradeep J.', files: [] },
    });
    wrap(<Review job={4} canMove reasons={[{ id: 3, label: 'Not enough experience' }]} onJob={() => undefined} />);
    expect((await screen.findByTestId('cv')).textContent).toBe('kasun-cv.pdf');
    fireEvent.keyDown(window, { key: 'j' });
    await waitFor(() => expect(screen.getByTestId('cv').textContent).toBe('hiruni.pdf'));
    fireEvent.keyDown(window, { key: 'k' });
    await waitFor(() => expect(screen.getByTestId('cv').textContent).toBe('kasun-cv.pdf'));
    fireEvent.keyDown(window, { key: 's' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/recruitment/applications/101/move', { stage_id: 3 }));
    await waitFor(() => expect(screen.getByTestId('cv').textContent).toBe('hiruni.pdf'));
    fireEvent.keyDown(window, { key: 'r' });
    const reject = await screen.findByRole('button', { name: 'Reject' });
    expect((reject as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/recruitment/applications/102/reject', { send_email: true, reason_id: '3', note: '' }));
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/recruitment/applications/103/move', { stage_id: 2 }));
  });
});

describe('scorecard (D04)', () => {
  const criteria = [{ id: 1, name: 'Coding' }, { id: 2, name: 'Communication' }];
  it('needs every rating, a comment on a 1 or a 5, and a recommendation', () => {
    const e = validateScorecard({ ratings: [{ criterion_id: 1, rating: 5, comment: '' }, { criterion_id: 2, rating: null, comment: '' }], notes: '', recommendation: null }, criteria);
    expect(e.criteria['1']).toMatch(/comment/);
    expect(e.criteria['2']).toMatch(/rating/);
    expect(e.form.length).toBe(1);
    const ok = validateScorecard({ ratings: [{ criterion_id: 1, rating: 5, comment: 'Clean code' }, { criterion_id: 2, rating: 3, comment: '' }], notes: '', recommendation: 'PROCEED' }, criteria);
    expect(ok).toEqual({ criteria: {}, form: [] });
  });
  it('will not submit an incomplete scorecard', async () => {
    await expect(submitScorecard(7, null, { ratings: [{ criterion_id: 1, rating: 1, comment: '' }], notes: '', recommendation: 'REJECT' }, [criteria[0]!])).rejects.toThrow();
    expect(apiPost).not.toHaveBeenCalled();
  });
  it('the form shows what is missing, then saves and submits', async () => {
    serve({ '/evaluations': [] });
    wrap(<ScorecardForm interview={7} kit={{ candidate: { id: 1, name: 'Tharindu W.' }, criteria, questions: [] }} />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Coding: 5' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Communication: 3' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Proceed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/A 5 needs a comment/);
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Coding comment'), { target: { value: 'Idempotent webhooks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/recruitment/evaluations/9/submit'));
    expect(apiPost).toHaveBeenCalledWith('/api/recruitment/evaluations', {
      interview_id: 7, notes: '', recommendation: 'PROCEED',
      ratings: [{ criterion_id: 1, rating: 5, comment: 'Idempotent webhooks' }, { criterion_id: 2, rating: 3, comment: null }],
    });
  });
});

describe('approvals (D05)', () => {
  const offer: Approval = { id: 1, kind: 'offer', subject_id: 31, title: 'Hasini Kumari' };
  it('decides each kind at its own address; reject and return need a comment', async () => {
    expect(decisionPath({ kind: 'requisition', subject_id: 4 })).toBe('/api/recruitment/requisitions/4/decide');
    expect(decisionPath(offer)).toBe('/api/recruitment/offers/31/decide');
    await expect(decide(offer, 'reject', ' ')).rejects.toThrow(/comment/);
    await decide(offer, 'approve', '');
    expect(apiPost).toHaveBeenCalledWith('/api/recruitment/offers/31/decide', { decision: 'approve', comment: null });
  });
  it('Return from the list asks for a comment and sends it', async () => {
    const data = { data: [offer, { id: 2, kind: 'requisition', subject_id: 8, title: '2 × Sales Executive' }], isPending: false, isError: false } as never;
    wrap(<Approvals data={data} can={{ requisition: true, offer: true, selection: true }} onWeb={() => undefined} />);
    const row = screen.getByRole('listitem', { name: 'Requisition: 2 × Sales Executive' });
    fireEvent.click(row.querySelectorAll('button')[1]!);
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Add the cost centre' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Return' }).at(-1)!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/recruitment/requisitions/8/decide', { decision: 'return', comment: 'Add the cost centre' }));
  });
  it('hides the decision buttons without the permission', () => {
    wrap(<Approvals data={{ data: [offer], isPending: false, isError: false } as never} can={{ requisition: false, offer: false, selection: false }} onWeb={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});
