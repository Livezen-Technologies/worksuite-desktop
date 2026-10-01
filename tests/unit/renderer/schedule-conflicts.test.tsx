// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: vi.fn(() => () => undefined), errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', () => nav);
vi.mock('../../../src/core/app-state', () => ({ app: { get: () => ({ auth: { user: { id: '5' } } }), subscribe: () => () => undefined } }));

import { ConflictFlag, useConflictGate, useInvitationAnswer, type Conflict, type WaitingInvitation } from '../../../src/modules/calendar/conflicts';

afterEach(cleanup);
beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPost.mockReset();
  nav.navigate.mockReset();
});

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const mine: Conflict = { user_id: 5, source: 'meeting', id: 9, title: 'Budget review', busy_only: false, start_at: '2027-03-10 09:30:00', end_at: '2027-03-10 10:30:00', all_day: false, status: 'accepted', tentative: false };
const theirs: Conflict = { user_id: 7, source: 'event', id: 0, title: null, busy_only: true, start_at: '2027-03-10 09:15:00', end_at: '2027-03-10 09:45:00', all_day: false, status: 'organizer', tentative: false };

function Saver({ save }: { save: () => void }) {
  const gate = useConflictGate('Save anyway');
  return (
    <>
      <button type="button" onClick={() => void gate.guard({ start: '2027-03-10 09:00', end: '2027-03-10 10:00', user_ids: [7] }, save)}>
        Save
      </button>
      {gate.dialog}
    </>
  );
}

describe('warning before saving (worksuite-desktop#99)', () => {
  it('saves straight away when nothing overlaps', async () => {
    api.apiPost.mockResolvedValue({ conflicts: [], duplicates: [], people: [], checked: 1 });
    const save = vi.fn();
    wrap(<Saver save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(api.apiPost).toHaveBeenCalledWith('/api/calendar/conflicts', expect.objectContaining({ start: '2027-03-10 09:00', user_ids: [7], timezone: expect.any(String) }));
  });

  it('says what overlaps — yours by name, another person’s only as Busy — and saves only when told to', async () => {
    api.apiPost.mockResolvedValue({ conflicts: [mine, theirs], duplicates: [], people: [{ user_id: 5, name: 'Me', busy: true, tentative_only: false }, { user_id: 7, name: 'Ann', busy: true, tentative_only: false }], checked: 1 });
    const save = vi.fn();
    wrap(<Saver save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Schedule conflict')).toBeTruthy();
    expect(screen.getByText(/^Budget review · /)).toBeTruthy();
    expect(screen.getByText(/^Busy · /)).toBeTruthy();
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    // Only what you may see can be opened.
    expect(screen.getAllByRole('button', { name: 'View conflict' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Choose another time' }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save anyway' }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('never holds a save up when the server cannot be asked', async () => {
    api.apiPost.mockRejectedValue(new Error('offline'));
    const save = vi.fn();
    wrap(<Saver save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });
});

const waiting: WaitingInvitation = { source: 'meeting', id: 12, title: 'Planning', start_at: '2027-03-10 09:00:00', end_at: '2027-03-10 10:00:00', my_rsvp: 'no_response', conflicts: [mine], duplicate: false, link: '/meetings?meeting=12' };

function Invitation({ send }: { send: (r: string) => void }) {
  const inv = useInvitationAnswer('meeting', 12, send);
  return (
    <>
      {inv.flag}
      <button type="button" onClick={() => inv.answer('accepted')}>
        Accept
      </button>
      <button type="button" onClick={() => inv.answer('declined')}>
        Decline
      </button>
      {inv.dialogs}
    </>
  );
}

describe('answering an invitation that clashes (worksuite-desktop#99)', () => {
  it('is flagged, asks before accepting, and offers to propose another time', async () => {
    api.apiGet.mockResolvedValue({ invitations: [waiting] });
    api.apiPost.mockResolvedValue({ proposed: {} });
    const send = vi.fn();
    wrap(<Invitation send={send} />);
    expect(await screen.findByText(/Overlaps “Budget review”/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(send).toHaveBeenCalledWith('declined');
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('Schedule conflict')).toBeTruthy();
    expect(send).not.toHaveBeenCalledWith('accepted');
    fireEvent.click(screen.getByRole('button', { name: 'Propose new time' }));
    expect(await screen.findByText(/The organiser is told the time you suggest/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send proposal' }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/meetings/12/propose', expect.objectContaining({ start_at: expect.stringMatching(/^2027-03-10T/), timezone: expect.any(String) })));
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept anyway' }));
    expect(send).toHaveBeenCalledWith('accepted');
  });

  it('accepts straight away when nothing overlaps', async () => {
    api.apiGet.mockResolvedValue({ invitations: [{ ...waiting, conflicts: [] }] });
    const send = vi.fn();
    wrap(<Invitation send={send} />);
    await waitFor(() => expect(api.apiGet).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(send).toHaveBeenCalledWith('accepted');
    expect(screen.queryByText('Schedule conflict')).toBeNull();
  });
});

describe('the conflict flag', () => {
  it('names one, counts several, and says when they are only tentative', () => {
    const { rerender } = render(<ConflictFlag conflicts={[mine]} />);
    expect(screen.getByRole('note').textContent).toContain('Overlaps “Budget review”');
    rerender(<ConflictFlag conflicts={[mine, theirs]} />);
    expect(screen.getByRole('note').textContent).toContain('Overlaps 2 other commitments');
    rerender(<ConflictFlag conflicts={[{ ...mine, tentative: true, status: 'tentative' }]} />);
    expect(screen.getByRole('note').textContent).toContain('(tentative)');
  });
});
