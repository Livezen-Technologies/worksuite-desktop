// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem } from '../../../src/modules/meetings/api';

/**
 * The agenda window (Meetings D08): an always-on-top window with the meeting's shared agenda timer — the live item,
 * what is left of it or by how much it ran over — Pause and Next item for whoever may run the agenda, and quick notes
 * that go into the minutes, or wait on this computer while the server cannot be reached.
 */
const net = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), call: vi.fn(), toast: vi.fn() }));

vi.mock('../../../src/core/api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly code: string | null = null,
    ) {
      super(message);
    }
    get offline(): boolean {
      return this.code === 'NETWORK_UNREACHABLE' || this.status === 503;
    }
  }
  return { ApiError, apiGet: net.apiGet, apiPost: net.apiPost, apiPut: net.apiPut };
});
vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: net.toast }));
vi.mock('../../../src/core/tab-context', () => ({ useTabTitle: () => undefined }));
vi.mock('../../../src/core/app-state', () => ({ app: { get: () => ({ auth: { user: { id: '5' } } }), subscribe: () => () => undefined } }));

const { ApiError } = await import('../../../src/core/api');
const { agendaClock, clockFace, timerSteps, elapsedOf } = await import('../../../src/modules/meetings/agenda');
const { AgendaWindow, notesHtml } = await import('../../../src/modules/meetings/AgendaWindow');


const NOW = Date.parse('2026-10-13T06:00:00Z');
const item = (id: number, over: Partial<AgendaItem> = {}): AgendaItem => ({ id, position: id, title: `Item ${id}`, presenter: null, minutes: 30, notes: null, status: 'pending', started_at: null, elapsed_seconds: 0, ...over });

describe('the shared agenda timer', () => {
  it('counts down the running item from when it started, on top of what was banked', () => {
    const running = item(2, { title: 'Renewal pricing', status: 'running', started_at: '2026-10-13T05:50:00Z', elapsed_seconds: 8 * 60 + 36 });
    const c = agendaClock([item(1, { status: 'done' }), running, item(3)], NOW);
    expect(c.item?.id).toBe(2);
    expect(c.number).toBe(2);
    expect(c.running).toBe(true);
    expect(Math.round(c.elapsed)).toBe(18 * 60 + 36);
    expect(clockFace(c)).toBe('11:24');
    expect(c.overrun).toBe(false);
    expect(c.progress).toBeCloseTo(0.62, 2);
    expect(c.next?.id).toBe(3);
    expect(c.done).toBe(1);
  });

  it('says an overrun as time over, and fills the bar', () => {
    const c = agendaClock([item(1, { minutes: 10, status: 'running', started_at: '2026-10-13T05:47:55Z' })], NOW);
    expect(c.overrun).toBe(true);
    expect(clockFace(c)).toBe('+2:05');
    expect(c.progress).toBe(1);
  });

  it('a paused item is still the live one; with everything done there is none', () => {
    const paused = agendaClock([item(1, { status: 'done' }), item(2, { elapsed_seconds: 120 }), item(3)], NOW);
    expect(paused.item?.id).toBe(2);
    expect(paused.running).toBe(false);
    expect(elapsedOf(paused.item!, NOW)).toBe(120);
    expect(agendaClock([item(1, { status: 'done' }), item(2, { status: 'skipped' })], NOW).item).toBeNull();
  });

  it('Pause and Resume toggle the live item; Next item finishes it and starts the next', () => {
    const running = agendaClock([item(1, { status: 'running', started_at: '2026-10-13T05:59:00Z' }), item(2)], NOW);
    expect(timerSteps(running, 'toggle')).toEqual([{ itemId: 1, action: 'pause' }]);
    expect(timerSteps(running, 'next')).toEqual([{ itemId: 1, action: 'done' }, { itemId: 2, action: 'start' }]);
    const fresh = agendaClock([item(1), item(2)], NOW);
    expect(timerSteps(fresh, 'toggle')).toEqual([{ itemId: 1, action: 'start' }]);
    // Never started: moving on skips it.
    expect(timerSteps(fresh, 'next')).toEqual([{ itemId: 1, action: 'skip' }, { itemId: 2, action: 'start' }]);
    const last = agendaClock([item(1, { status: 'running', started_at: '2026-10-13T05:59:00Z' })], NOW);
    expect(timerSteps(last, 'next')).toEqual([{ itemId: 1, action: 'done' }]);
  });

  it('heads quick notes with their item, safely', () => {
    expect(notesHtml('2 · Renewal <pricing>', 'Option B\nAsk finance')).toBe('<p><b>2 · Renewal &lt;pricing&gt;</b> — Option B<br>Ask finance</p>');
  });
});

const detail = (can: Record<string, boolean> | undefined, agenda: AgendaItem[]) => ({
  meeting: { id: 42, title: 'Acme Lanka — Q4 business review', live_status: 'ongoing', organizer_id: 9, can },
  participants: [{ id: 3, user_id: 5, name: 'Me', role: 'required', rsvp: 'accepted', permissions: null }],
  agenda,
  can: { view: true, schedule: false, manage: false, rooms: false },
});

const minutes = { sections: { agenda: '', discussion: '<p>Earlier</p>', decisions: '' }, revs: { agenda: 0, discussion: 4, decisions: 0 } };

const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AgendaWindow id={42} /></QueryClientProvider>);

beforeEach(() => {
  Object.values(net).forEach((f) => f.mockReset());
  net.call.mockResolvedValue(null);
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('the agenda window', () => {
  const agenda = [item(1, { status: 'done', title: 'Q3 usage' }), item(2, { title: 'Renewal pricing', status: 'running', started_at: '2026-10-13T05:50:00Z', elapsed_seconds: 516 }), item(3, { title: 'Roadmap' })];

  it('shows the live item and its time, and moves the agenda on for whoever runs it', async () => {
    net.apiGet.mockResolvedValue(detail({ run_agenda: true, minutes: true, actions: true }, agenda));
    net.apiPost.mockResolvedValue({});
    wrap();
    expect((await screen.findByTestId('agenda-live')).textContent).toBe('2 · Renewal pricing');
    expect(screen.getByRole('timer').textContent).toBe('11:24');
    fireEvent.click(screen.getByRole('button', { name: 'Next item' }));
    await waitFor(() => expect(net.apiPost).toHaveBeenCalledWith('/api/meetings/42/agenda/3/timer', { action: 'start' }));
    expect(net.apiPost.mock.calls[0]).toEqual(['/api/meetings/42/agenda/2/timer', { action: 'done' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(net.apiPost).toHaveBeenCalledWith('/api/meetings/42/agenda/2/timer', { action: 'pause' }));
  });

  it('shows the timer to everybody, but its buttons only with run_agenda', async () => {
    net.apiGet.mockResolvedValue(detail({ run_agenda: false }, agenda));
    wrap();
    expect(await screen.findByRole('timer')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next item' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to minutes' })).toBeNull();
    expect(screen.getByText(/Whoever runs the meeting moves the agenda on/)).toBeTruthy();
  });

  it('turns red when the item runs over', async () => {
    net.apiGet.mockResolvedValue(detail({ run_agenda: true }, [item(1, { minutes: 10, status: 'running', started_at: '2026-10-13T05:47:55Z' })]));
    wrap();
    const t = await screen.findByRole('timer');
    expect(t.textContent).toBe('+2:05');
    expect(t.className).toContain('text-danger');
    expect(screen.getByText(/Over its time/)).toBeTruthy();
  });

  it('adds quick notes to the minutes on the revision they are now, under the live item', async () => {
    net.apiGet.mockImplementation(async (path: string) => (path.endsWith('/minutes') ? minutes : detail({ run_agenda: true, minutes: true }, agenda)));
    net.apiPut.mockResolvedValue({});
    wrap();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Quick notes' }), { target: { value: 'Acme wants option B.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to minutes' }));
    await waitFor(() => expect(net.apiPut).toHaveBeenCalledWith('/api/meetings/42/minutes/sections/discussion', { html: '<p>Earlier</p><p><b>2 · Renewal pricing</b> — Acme wants option B.</p>', base_rev: 4 }));
    expect(await screen.findByText('Added to the minutes.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Quick notes' }) as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps the notes on this computer while offline, and adds them once the server answers', async () => {
    net.apiGet.mockImplementation(async (path: string) => {
      if (path.endsWith('/minutes')) throw new ApiError(0, 'offline', 'NETWORK_UNREACHABLE');
      return detail({ run_agenda: true, minutes: true }, agenda);
    });
    wrap();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Quick notes' }), { target: { value: 'Ask finance by Fri.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to minutes' }));
    expect(await screen.findByText('Saved offline · added to the minutes when back online')).toBeTruthy();
    expect(net.apiPut).not.toHaveBeenCalled();
    // Back online.
    net.apiGet.mockImplementation(async (path: string) => (path.endsWith('/minutes') ? minutes : detail({ run_agenda: true, minutes: true }, agenda)));
    net.apiPut.mockResolvedValue({});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    await waitFor(() => expect(net.apiPut).toHaveBeenCalledWith('/api/meetings/42/minutes/sections/discussion', expect.objectContaining({ base_rev: 4 })));
  });

  it('tries again on the newer revision when somebody saved the minutes meanwhile', async () => {
    net.apiGet.mockImplementation(async (path: string) => (path.endsWith('/minutes') ? minutes : detail({ run_agenda: true, minutes: true }, agenda)));
    net.apiPut.mockRejectedValueOnce(new ApiError(409, 'conflict', null)).mockResolvedValueOnce({});
    wrap();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Quick notes' }), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to minutes' }));
    await waitFor(() => expect(net.apiPut).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Added to the minutes.')).toBeTruthy();
  });
});
