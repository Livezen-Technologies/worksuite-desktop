// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../../../src/modules/calendar/api';

/**
 * #64: an entry from another module opens as a summary whose button names the
 * record and goes to it — after asking the calendar whether it is still there,
 * so a record deleted or no longer shared says so instead of opening.
 */
const net = vi.hoisted(() => ({ call: vi.fn(), apiGetMeta: vi.fn(), navigate: vi.fn() }));

vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', () => ({ apiGetMeta: net.apiGetMeta, apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), ApiError: class extends Error {} }));
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
