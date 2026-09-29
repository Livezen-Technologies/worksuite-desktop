// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ auth: { user: { id: '5' }, server: { origin: 'https://app.worksuite.lk' } }, transfers: [] }) };
});
// The viewer itself is pdf.js on a canvas; here it only has to say which file it was given.
vi.mock('../../../src/components/FileViewer', async (orig) => ({ ...(await orig<Record<string, unknown>>()), FileViewer: ({ path, name }: { path: string; name: string }) => <p>viewing {name} at {path}</p> }));

import { apiGet, apiPost } from '../../../src/core/api';
import { stepZoom, viewKind } from '../../../src/components/FileViewer';
import { menuPlace, uploadStage } from '../../../src/modules/tenders/files';
import { reviewMessage, reviewRecipients } from '../../../src/modules/tenders/people';
import { nextToReview, ReviewScreen } from '../../../src/modules/tenders/Review';
import type { Line } from '../../../src/modules/tenders/work';

const line = (over: Partial<Line>): Line => ({
  id: 1, section: null, label: 'PCA Registration', detail: null, mandatory: true, status: 'pending_review', owner_id: 9, owner_name: 'Dinusha Hansani',
  reviewer_name: null, reviewed_at: null, rejection_reason: null, issued_on: null, expires_on: null, note: null, library: false, settled: false, why_not: null,
  files: [{ id: 31, file_id: 501, version: 1, name: 'TENDER.pdf', uploaded_at: '2026-09-28 09:00:00', uploaded_by: 7, current: true }],
  ...over,
});

describe('upload progress', () => {
  it('says where an upload is, and never shows 100% before it is filed', () => {
    expect(uploadStage({ state: 'queued', bytes: 0, total: 10 })).toEqual({ label: 'Waiting…', pct: null });
    expect(uploadStage({ state: 'running', bytes: 0, total: 10 })).toEqual({ label: 'Preparing…', pct: null });
    expect(uploadStage({ state: 'running', bytes: 4, total: 10 })).toEqual({ label: '40%', pct: 40 });
    expect(uploadStage({ state: 'running', bytes: 10, total: 10 })).toEqual({ label: 'Filing…', pct: null });
  });
  it('opens the Attach menu above its button near the bottom of the window, and inside the window', () => {
    expect(menuPlace({ top: 100, bottom: 128, right: 900 }, { width: 1200, height: 800 })).toEqual({ top: 132, left: 710 });
    expect(menuPlace({ top: 760, bottom: 788, right: 900 }, { width: 1200, height: 800 })).toEqual({ top: 680, left: 710 });
    expect(menuPlace({ top: 100, bottom: 128, right: 120 }, { width: 1200, height: 800 }).left).toBe(8);
  });
});

describe('the viewer', () => {
  it('knows what it can show', () => {
    expect(viewKind('TENDER.pdf', 'application/octet-stream')).toBe('pdf');
    expect(viewKind('x', 'application/pdf; charset=binary')).toBe('pdf');
    expect(viewKind('Divulapitiya Pradeshiya .jpeg', null)).toBe('image');
    expect(viewKind('notes.csv', null)).toBe('text');
    expect(viewKind('DOL_eAIMS_Technical_Proposal.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('other');
  });
  it('zooms in steps', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1.1, -1)).toBe(1);
    expect(stepZoom(3, 1)).toBe(3);
  });
});

describe('telling people about a review', () => {
  it('reaches the uploader and the chaser, once each, never the reviewer', () => {
    expect(reviewRecipients(7, 9, 5)).toEqual([7, 9]);
    expect(reviewRecipients(7, 7, 5)).toEqual([7]);
    expect(reviewRecipients(5, null, 5)).toEqual([]);
  });
  it('says what was decided, the comment, and links to the tender', () => {
    expect(reviewMessage({ decision: 'rejected', line: 'Board Resolution', file: 'letters.pdf', comment: 'This is the bid document request, not the resolution.', tenderId: 35 })).toBe(
      'Sent back: “letters.pdf” for Board Resolution. Please upload a corrected version.\nComment: This is the bid document request, not the resolution.\nhttps://app.worksuite.lk/tenders?open=35',
    );
  });
  it('goes on to the next file waiting for a decision', () => {
    const lines = [line({ id: 1 }), line({ id: 2, status: 'approved' }), line({ id: 3, files: [] }), line({ id: 4, status: 'uploaded' })];
    expect(nextToReview(lines, 1)?.id).toBe(4);
    expect(nextToReview([line({ id: 1 })], 1)).toBeNull();
  });
});

describe('the review screen', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockResolvedValue({ users: [{ id: 7, name: 'Dimuthu Anuraj' }, { id: 9, name: 'Dinusha Hansani' }] } as never);
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPost).mockImplementation(async (path: string) => (path === '/api/chat/rooms/direct' ? { room_id: 88 } : {}) as never);
  });
  afterEach(() => cleanup());

  function mount(lines = [line({}), line({ id: 2, label: 'Audited Financial Statements', files: [{ id: 41, file_id: 601, version: 1, name: '2025 Financial.pdf', uploaded_at: null, uploaded_by: 9, current: true }] })]) {
    const onChanged = vi.fn();
    const onClose = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ReviewScreen tenderId={35} lines={lines} startId={1} canApprove canDownload onClose={onClose} onChanged={onChanged} />
      </QueryClientProvider>,
    );
    return { onChanged, onClose };
  }

  it('shows the file inside the app, with who uploaded it', async () => {
    mount();
    expect(screen.getByText('viewing TENDER.pdf at /api/tenders/checklist/1/download')).toBeTruthy();
    expect(await screen.findByText('Dimuthu Anuraj')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send back to Dimuthu' })).toBeTruthy();
  });

  it('will not send back without a comment', async () => {
    mount();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Send back to Dimuthu' }));
    });
    expect(screen.getByText(/Say what is wrong with it/)).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('sends back to the uploader with the comment, tells them and the chaser in Chat, and opens the next file', async () => {
    const { onChanged } = mount();
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Signed copy please.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send back to Dimuthu' }));
    });
    expect(apiPost).toHaveBeenCalledWith('/api/tenders/checklist/1/review', { decision: 'rejected', reason: 'Signed copy please.' });
    expect(apiPost).toHaveBeenCalledWith('/api/chat/rooms/direct', { user_id: 7 });
    expect(apiPost).toHaveBeenCalledWith('/api/chat/rooms/direct', { user_id: 9 });
    const sent = vi.mocked(apiPost).mock.calls.filter(([p]) => p === '/api/chat/messages');
    expect(sent).toHaveLength(2);
    expect((sent[0]![1] as { message: string }).message).toContain('Comment: Signed copy please.');
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByText('viewing 2025 Financial.pdf at /api/tenders/checklist/2/download')).toBeTruthy();
  });

  it('approves without messaging anyone unless there is a comment', async () => {
    mount();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    });
    expect(apiPost).toHaveBeenCalledWith('/api/tenders/checklist/1/review', { decision: 'approved' });
    expect(vi.mocked(apiPost).mock.calls.some(([p]) => p === '/api/chat/messages')).toBe(false);
  });
});
