// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { toast } from '../../../src/core/toasts';
import type { LeaveReview } from '../../../src/modules/hr/api';
import { isCoverRefusal, resetCoverRule } from '../../../src/modules/hr/coverRule';
import { balanceChips, ReviewLeave } from '../../../src/modules/hr/Leave';

/**
 * Review leave (#262): the cover's answer lives in the Cover card and only the person asked to cover gets Accept /
 * Decline there; the footer is the approval alone (Close · Reject · Approve) and wraps; Approve before the cover
 * has accepted asks first rather than failing, and a server that needs the cover first turns it into "Waiting for
 * cover"; balances are chips without the 0-of-0 types; the result shows after a decision, with Undo only when the
 * server allows it.
 */
const ME = 5;
const review = (over: Partial<LeaveReview> = {}): LeaveReview => ({
  request: { id: 12, type_name: 'Annual leave', paid: true, starts_on: '2026-10-09', ends_on: '2026-10-09', days: 1, portion: 'full', minutes: null, starts_at: null, reason: 'Personal matter', status: 'pending', requested_on: '2026-10-01', notice_days: 8 },
  employee: { id: 40, name: 'Nimal Perera' },
  balances: [
    { type_id: 1, type_name: 'Annual', requested: true, entitled: 7, taken: 1, remaining: 6 },
    { type_id: 2, type_name: 'Casual', requested: false, entitled: 7, taken: 7, remaining: 0 },
    { type_id: 3, type_name: 'Lieu', requested: false, entitled: 0, taken: 0, remaining: 0 },
  ],
  pending: { count: 1, days: 1 },
  history: { year: 2026, approved_days: 4, approved_count: 2, rejected_count: 0, cancelled_count: 0 },
  overlap: { department_known: true, items: [] },
  attendance: { window_days: 30, days_present: 18, days_late: 16, missing_check_outs: 0 },
  responsible: { user_id: 77, name: 'Kamala Silva', status: 'pending', note: null },
  evidence: [],
  ...over,
});

let current: LeaveReview;
function show(props: { canDecide?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ReviewLeave id={12} {...props} onClose={onClose} onDone={onDone} />
    </QueryClientProvider>,
  );
  return { onDone, onClose };
}
const panel = () => screen.getByRole('complementary', { name: 'Review leave' });
const footerButtons = () => {
  const close = within(panel()).getAllByRole('button', { name: 'Close' }).at(-1)!;
  return within(close.parentElement!).getAllByRole('button').map((b) => b.textContent);
};

beforeEach(() => {
  resetCoverRule();
  current = review();
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/hr/leave/requests/12/review') return current;
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiPost).mockResolvedValue({} as never);
  app.set({ auth: { user: { id: String(ME), name: 'Ada' } } as never });
});
afterEach(cleanup);

describe('the Cover card', () => {
  it('says who is asked and that they have not answered, with no cover buttons for the approver', async () => {
    show({ canDecide: true });
    const card = await screen.findByRole('region', { name: 'Cover' });
    expect(card.textContent).toContain('Kamala Silva is asked to cover · Waiting for their answer');
    expect(within(card).queryByRole('button', { name: 'Accept cover' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Decline cover' })).toBeNull();
    // Remind and Change cover… only where the server offers them.
    expect(within(card).queryByRole('button', { name: /Remind/ })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Change cover…' })).toBeNull();
  });

  it('offers Remind and Change cover… when the server says the approver may', async () => {
    current = review({ responsible: { user_id: 77, name: 'Kamala Silva', status: 'pending', note: null, can_remind: true, can_change: true } });
    show({ canDecide: true });
    const card = await screen.findByRole('region', { name: 'Cover' });
    fireEvent.click(within(card).getByRole('button', { name: 'Remind Kamala Silva' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/leave/requests/12/cover/remind', {}));
    expect(within(card).getByRole('button', { name: 'Change cover…' })).toBeTruthy();
  });

  it('gives the person asked to cover Accept and Decline (with an optional reason), and a footer of Close alone', async () => {
    current = review({ responsible: { user_id: ME, name: 'Ada', status: 'pending', note: null } });
    show();
    const card = await screen.findByRole('region', { name: 'Cover' });
    expect(card.textContent).toContain('You are asked to cover · Waiting for your answer');
    expect(footerButtons()).toEqual(['Close']);
    expect(screen.queryByRole('textbox', { name: 'Decision note' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Decline cover' }));
    fireEvent.change(within(card).getByRole('textbox', { name: 'Why you can’t cover it' }), { target: { value: 'On site that week' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Decline cover' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/leave/requests/12/cover', { answer: 'declined', note: 'On site that week' }));
  });
});

describe('the footer', () => {
  it('is the approval alone: Close, then Reject and Approve, never shrinking and wrapping when narrow', async () => {
    show({ canDecide: true });
    await screen.findByRole('region', { name: 'Cover' });
    expect(footerButtons()).toEqual(['Close', 'Reject', 'Approve']);
    const approve = within(panel()).getByRole('button', { name: 'Approve' });
    expect(approve.className).toContain('shrink-0');
    expect(approve.className).toContain('whitespace-nowrap');
    expect(approve.parentElement!.parentElement!.className).toContain('flex-wrap');
    // The note sits with the footer, not at the end of the scrolling body.
    const note = within(panel()).getByRole('textbox', { name: 'Decision note' });
    expect(note.closest('.overflow-y-auto')).toBeNull();
    expect(panel().className).toContain('max-w-full');
  });

  it('a cover person who also approves gets both', async () => {
    current = review({ responsible: { user_id: ME, name: 'Ada', status: 'pending', note: null } });
    show({ canDecide: true });
    await screen.findByRole('region', { name: 'Cover' });
    expect(within(screen.getByRole('region', { name: 'Cover' })).getByRole('button', { name: 'Accept cover' })).toBeTruthy();
    expect(footerButtons()).toEqual(['Close', 'Reject', 'Approve']);
  });
});

describe('approving before the cover accepts', () => {
  it('asks "Approve anyway?" instead of failing, and sends the decision with approve_without_cover', async () => {
    const { onDone } = show({ canDecide: true });
    await screen.findByRole('region', { name: 'Cover' });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Approve' }));
    const ask = await screen.findByRole('dialog', { name: 'Approve before cover?' });
    expect(ask.textContent).toContain('Kamala Silva hasn’t accepted cover yet. Approve anyway?');
    expect(apiPost).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Approve anyway' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/leave/requests/12/decide', { decision: 'approved', approve_without_cover: true }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(await within(panel()).findByRole('status')).toBeTruthy();
    expect(within(panel()).getByRole('status').textContent).toMatch(/^Approved by you · /);
    // No Undo: this server did not say a decision can be undone.
    expect(within(panel()).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('a server that needs the cover first refuses: no red toast, and Approve becomes "Waiting for cover"', async () => {
    vi.mocked(apiPost).mockRejectedValue(new ApiError(422, 'The person responsible for cover has not accepted this yet.', null));
    show({ canDecide: true });
    await screen.findByRole('region', { name: 'Cover' });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Approve' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Approve before cover?' })).getByRole('button', { name: 'Approve anyway' }));
    const blocked = await screen.findByRole('dialog', { name: 'Waiting for cover' });
    expect(blocked.textContent).toContain('Your organisation needs the cover to accept before leave is approved.');
    expect(within(blocked).queryByRole('button', { name: 'Approve anyway' })).toBeNull();
    expect(vi.mocked(toast).mock.calls.filter(([kind]) => kind === 'error')).toEqual([]);
    fireEvent.click(within(blocked).getAllByRole('button', { name: 'Close' }).at(-1)!);
    const waiting = within(panel()).getByRole('button', { name: /^Waiting for cover/ });
    expect(waiting.getAttribute('aria-disabled')).toBe('true');
    expect(waiting.getAttribute('title')).toContain('Kamala Silva hasn’t accepted cover yet');
  });

  it('the organisation setting from the server blocks at once', async () => {
    current = review({ cover_first: true });
    show({ canDecide: true });
    await screen.findByRole('region', { name: 'Cover' });
    expect(within(panel()).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(panel()).getByRole('button', { name: /^Waiting for cover/ })).toBeTruthy();
  });

  it('an accepted cover approves straight away', async () => {
    current = review({ responsible: { user_id: 77, name: 'Kamala Silva', status: 'accepted', note: null } });
    show({ canDecide: true });
    await screen.findByRole('region', { name: 'Cover' });
    fireEvent.change(within(panel()).getByRole('textbox', { name: 'Decision note' }), { target: { value: 'Enjoy' } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/leave/requests/12/decide', { decision: 'approved', note: 'Enjoy' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('knows the server’s refusal by its words or its code', () => {
    expect(isCoverRefusal(new ApiError(422, 'The person responsible for cover has not accepted this yet.', null))).toBe(true);
    expect(isCoverRefusal(new ApiError(409, 'Not yet.', 'COVER_NOT_ACCEPTED'))).toBe(true);
    expect(isCoverRefusal(new ApiError(422, 'The leave balance is not enough.', null))).toBe(false);
    expect(isCoverRefusal(new ApiError(503, 'cover', 'NETWORK_UNREACHABLE'))).toBe(false);
    expect(isCoverRefusal(new Error('cover'))).toBe(false);
  });
});

describe('after a decision', () => {
  it('Reject shows the result, and Undo while the server allows it', async () => {
    vi.mocked(apiPost).mockResolvedValue({ status: 'rejected', decided_at: '2026-10-05T09:00:00Z', undo_until: new Date(Date.now() + 5 * 60_000).toISOString() } as never);
    show({ canDecide: true });
    await screen.findByRole('region', { name: 'Cover' });
    await act(async () => fireEvent.click(within(panel()).getByRole('button', { name: 'Reject' })));
    expect(within(panel()).getByRole('status').textContent).toMatch(/^Rejected by you · (Oct 5|5 Oct)$/);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/leave/requests/12/undo', {}));
  });
});

describe('the rest of the panel', () => {
  it('shows balances as chips, without types that have 0 of 0', async () => {
    expect(balanceChips(review().balances).map((b) => b.type_name)).toEqual(['Annual', 'Casual']);
    show({ canDecide: true });
    const list = await screen.findByRole('list', { name: 'Leave balances' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Annual 6/7', 'Casual 0/7']);
  });

  it('marks days late in amber, naming the period the server counted', async () => {
    show({ canDecide: true });
    const late = (await screen.findByText('Days late')).parentElement!;
    expect(late.getAttribute('title')).toBe('Late on 16 days in the last 30 days');
    expect(late.className).toContain('bg-[#FFF4E0]');
  });
});
