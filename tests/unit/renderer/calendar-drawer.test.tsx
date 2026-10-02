// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../../src/modules/calendar/api';
import type { Draft } from '../../../src/modules/calendar/EventDrawer';

/**
 * #64: an entry from another module opens as a summary whose button names the
 * record and goes to it — after asking the calendar whether it is still there,
 * so a record deleted or no longer shared says so instead of opening.
 */
const net = vi.hoisted(() => ({ call: vi.fn(), apiGetMeta: vi.fn(), apiGet: vi.fn(), apiPost: vi.fn(), navigate: vi.fn() }));

vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', () => ({ apiGetMeta: net.apiGetMeta, apiGet: net.apiGet, apiPost: net.apiPost, apiPut: vi.fn(), apiDelete: vi.fn(), ApiError: class extends Error {} }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: net.navigate, query: new URLSearchParams(), path: ['calendar'] }), useTabTitle: () => undefined }));
vi.mock('../../../src/core/access', () => ({ useCanOpen: () => true, useVisibleIds: () => new Set(['tasks', 'tenders', 'projects', 'expenses', 'hr', 'meet', 'meetings']) }));

const { EventDrawer } = await import('../../../src/modules/calendar/EventDrawer');

const task: CalendarEvent = { source: 'task', id: 12, title: 'Send the bid', color: null, start_at: '2026-10-02 00:00:00', end_at: null, all_day: true, editable: false, status: 'in_progress', link: '/tasks?task=12' };

function show(e: CalendarEvent, onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EventDrawer event={e} draft={null} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => Object.values(net).forEach((f) => f.mockReset()));
afterEach(cleanup);

describe('Calendar › a selected range remains a draft (#63)', () => {
  function draftForm(draft: Draft) {
    const onClose = vi.fn();
    net.apiGet.mockResolvedValue({ users: [] });
    net.apiPost.mockImplementation((path: string) => path === '/api/calendar/conflicts'
      ? Promise.resolve({ conflicts: [], duplicates: [], people: [] })
      : Promise.reject(new Error('The event could not be saved. Try again.')));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EventDrawer event={null} draft={draft} onClose={onClose} /></QueryClientProvider>);
    return onClose;
  }

  it('prefills both selected times, preserves the event fields, and saves only when asked', async () => {
    const onClose = draftForm({ start: '2026-10-01T09:15', end: '2026-10-01T10:45', allDay: false });
    expect((screen.getByLabelText('Start') as HTMLInputElement).value).toBe('2026-10-01T09:15');
    expect((screen.getByLabelText('End') as HTMLInputElement).value).toBe('2026-10-01T10:45');
    expect(screen.getByText('Attendees · 0')).toBeTruthy();
    expect(screen.getByLabelText('Reminder')).toBeTruthy();
    expect(net.apiPost).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'Planning' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Meeting room' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Review the plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(net.apiPost).toHaveBeenCalledWith('/api/calendar/events', expect.objectContaining({ title: 'Planning', start: '2026-10-01T09:15', end: '2026-10-01T10:45', all_day: false, location: 'Meeting room', description: 'Review the plan', remind_minutes: 15 })));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Error: The event could not be saved. Try again.');
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Event title') as HTMLInputElement).value).toBe('Planning');
  });

  it('prefills an inclusive multi-day all-day range without posting on open or cancel', () => {
    const onClose = draftForm({ start: '2026-09-30', end: '2026-10-03', allDay: true });
    expect((screen.getByLabelText('Start') as HTMLInputElement).type).toBe('date');
    expect((screen.getByLabelText('Start') as HTMLInputElement).value).toBe('2026-09-30');
    expect((screen.getByLabelText('End') as HTMLInputElement).value).toBe('2026-10-03');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(net.apiPost).not.toHaveBeenCalled();
  });
});

describe('Calendar › an entry from another module (#64)', () => {
  it('names what it opens, shows its status, and opens that record once the calendar still has it', async () => {
    net.apiGetMeta.mockResolvedValue({ data: { events: [task] }, offline: false, cachedAt: null });
    show(task);

    expect(screen.getByText('Send the bid')).toBeTruthy();
    expect(screen.getByText('in progress')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Task' }));

    await waitFor(() => expect(net.navigate).toHaveBeenCalledWith('/tasks?task=12'));
    expect(net.apiGetMeta).toHaveBeenCalledWith('/api/calendar/events', { from: '2026-10-02', to: '2026-10-02' });
  });

  it('says plainly when the record has gone, and goes nowhere', async () => {
    net.apiGetMeta.mockResolvedValue({ data: { events: [] }, offline: false, cachedAt: null });
    show(task);

    fireEvent.click(screen.getByRole('button', { name: 'Open Task' }));

    expect(await screen.findByText('This has been deleted, or you no longer have access to it.')).toBeTruthy();
    expect(net.navigate).not.toHaveBeenCalled();
  });

  it('offline, it cannot ask, so it opens', async () => {
    net.apiGetMeta.mockResolvedValue({ data: { events: [] }, offline: true, cachedAt: '2026-10-01T00:00:00Z' });
    show(task);
    fireEvent.click(screen.getByRole('button', { name: 'Open Task' }));
    await waitFor(() => expect(net.navigate).toHaveBeenCalledWith('/tasks?task=12'));
  });

  it('opens a project on the web, at that project', async () => {
    const m: CalendarEvent = { ...task, source: 'project_milestone', id: 3, project_id: 21, link: '/projects?project=21', status: undefined };
    net.apiGetMeta.mockResolvedValue({ data: { events: [m] }, offline: false, cachedAt: null });
    show(m);
    fireEvent.click(screen.getByRole('button', { name: 'Open Project ↗' }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('app:openInBrowser', { path: '/projects?project=21' }));
  });

  it('closes on Escape', () => {
    const onClose = show(task);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
