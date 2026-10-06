// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import { READY, serveWith, type Call } from './support-fixtures';

/**
 * The support wallboard on a second display, D-12 (desktop T30; FR-RPT-01/02/03/06, FR-SLA-05/07, FR-ASN-06): the
 * dashboard full screen — KPIs, queues, agents with presence, needs attention with time to breach, SLA bars — asked
 * again on the desk's hints and every 60 s; 403 explained; Esc closes; the inbox's chooser picks the display.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
const realtime = vi.hoisted(() => [] as Array<(e: unknown) => void>);
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => undefined),
  on: (channel: string, cb: (e: unknown) => void) => {
    if (channel !== 'realtime:event') return () => undefined;
    realtime.push(cb);
    return () => realtime.splice(realtime.indexOf(cb), 1);
  },
  hasDesktop: () => true,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
}));

const { ApiError, request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { resetApiFamily } = await import('../../../src/modules/support/api');
const { SupportWallWindow, WallboardChooser, breachTone, mayReadReports, minutesLabel, today, WALL_HINT_MS } = await import('../../../src/modules/support/Wallboard');

const NOW = Date.now();
const iso = (ms: number) => new Date(NOW + ms).toISOString();
const DASH = {
  period: { from: '2026-10-06', to: '2026-10-06' },
  now: { open: 87, unassigned: 7, overdue: 3, due_today: 12, escalated: 2 },
  figures: { created: 40, resolved: 31, frt_median: 14, resolution_median: 200, sla_compliance: 94.2, csat: 89, csat_average: 4.6, csat_responses: 38 },
  agents: [
    { user_id: 1, name: 'Ayesha Fernando', open: 12, overdue: 1, at_risk: 2, resolved: 9, csat: 4.8, capacity: 15, load: 80 },
    { user_id: 4, name: 'Kasun Silva', open: 9, overdue: 0, at_risk: 0, resolved: 4, csat: null, capacity: null, load: null },
  ],
  attention: [
    { id: 1276, reference: 'CFX-001276', subject: 'Windows 11 Pro key rejected', status: 'open', priority: 'urgent', sla_state: 'at_risk', due: iso(12 * 60_000), assignee: 'Ayesha Fernando', organization_id: 10 },
    { id: 1262, reference: 'CFX-001262', subject: 'Hosting backup failed', status: 'escalated', priority: 'normal', sla_state: 'breached', due: iso(-5 * 60_000), assignee: null, organization_id: 10 },
  ],
  sla_by_priority: { urgent: { first_response: { met: 9, breached: 1, compliance: 90 } }, high: { resolution: { met: 4, breached: 0, compliance: 100 } } },
};
const META = { statuses: [], priorities: [], types: [], sources: [], views: [], sorts: [], organizations: [{ id: 10, name: 'CreativeFX', prefix: 'CFX', can: { reports: true } }], departments: [], teams: [], categories: [], tags: [], can: {} };

let log: Call[];
function serve(over: Record<string, unknown> = {}) {
  log = serveWith(request, {
    'GET /api/support/v1/meta': META,
    'GET /api/support/v1/dashboard': DASH,
    'GET /api/support/v1/views': { views: [{ key: 'unassigned', label: 'Unassigned', count: 7 }, { key: 'overdue', label: 'Overdue', count: 3 }, { key: 'all', label: 'All', count: null }], saved: [], badges: null },
    'GET /api/support/v1/agents': { agents: [{ id: 1, name: 'Ayesha Fernando', presence: 'available', open: 12, capacity: 15, teams: [] }, { id: 4, name: 'Kasun Silva', presence: 'away', open: 9, capacity: null, teams: [] }] },
    ...over,
  });
}
const renderWall = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SupportWallWindow /></QueryClientProvider>);

beforeEach(() => {
  resetApiFamily();
  realtime.length = 0;
  vi.mocked(call).mockReset();
  vi.mocked(call).mockResolvedValue(undefined as never);
  serve();
  app.set(READY as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the pieces', () => {
  it('says today, minutes, the time to breach, and who may see the board', () => {
    expect(today(new Date(2026, 9, 6, 9, 0))).toBe('2026-10-06');
    expect(minutesLabel(14)).toBe('14m');
    expect(minutesLabel(125)).toBe('2h 5m');
    expect(minutesLabel(null)).toBe('—');
    expect(breachTone(iso(10 * 60_000), NOW)).toBe('red');
    expect(breachTone(iso(-1), NOW)).toBe('red');
    expect(breachTone(iso(60 * 60_000), NOW)).toBe('amber');
    expect(breachTone(iso(5 * 60 * 60_000), NOW)).toBe('calm');
    expect(breachTone(null, NOW)).toBeNull();
    expect(mayReadReports(META as never)).toBe(true);
    expect(mayReadReports({ ...META, organizations: [{ ...META.organizations[0], can: {} }] } as never)).toBe(false);
    expect(mayReadReports(undefined)).toBe(false);
  });
});

describe('the board', () => {
  it('shows the KPIs, queues, agents with presence, what needs attention and the SLA bars — for today', async () => {
    renderWall();
    const open = await screen.findByRole('group', { name: 'Open' });
    expect(open.textContent).toContain('87');
    expect(screen.getByRole('group', { name: 'SLA today' }).textContent).toContain('94.2%');
    expect(screen.getByRole('group', { name: 'First response' }).textContent).toContain('14m');
    const d = log.find((c) => c.path === '/api/support/v1/dashboard')!;
    expect(d.query).toEqual({ from: today(new Date()), to: today(new Date()) });
    const agents = screen.getByRole('list', { name: 'Agents' });
    await waitFor(() => expect(within(agents).getByRole('img', { name: 'Online' })).toBeTruthy());
    expect(within(agents).getByRole('img', { name: 'Away' })).toBeTruthy();
    expect(within(agents).getByText('12 / 15')).toBeTruthy();
    const attention = screen.getByRole('list', { name: 'Needs attention' });
    expect(within(attention).getByText('CFX-001276')).toBeTruthy();
    expect(within(attention).getByText(/^−5m$/)).toBeTruthy();
    expect(screen.getAllByRole('meter').map((m) => m.getAttribute('aria-valuenow'))).toEqual(['90', '100']);
    expect(within(screen.getByRole('region', { name: 'Queues' })).getByText('Unassigned')).toBeTruthy();
  });

  it('asks again once a burst of desk hints has passed', async () => {
    renderWall();
    await screen.findByRole('group', { name: 'Open' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const before = log.filter((c) => c.path === '/api/support/v1/dashboard').length;
    act(() => {
      for (let i = 0; i < 5; i++) realtime.forEach((cb) => cb({ type: 'support.changed', organization_id: 10, kind: 'updated' }));
    });
    await act(async () => {
      vi.advanceTimersByTime(WALL_HINT_MS + 10);
    });
    await waitFor(() => expect(log.filter((c) => c.path === '/api/support/v1/dashboard').length).toBe(before + 1));
  });

  it('explains a 403, and Esc closes the window', async () => {
    serve({ 'GET /api/support/v1/dashboard': new ApiError(403, 'No', null) });
    renderWall();
    expect((await screen.findByRole('alert')).textContent).toMatch(/support\.reports/);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(call).toHaveBeenCalledWith('windows:close');
  });
});

describe('the chooser', () => {
  it('lists the displays, picks the second, and opens the wallboard there', async () => {
    vi.mocked(call).mockImplementation((async (c: string) => (c === 'support:displays' ? { displays: [{ id: 1, display: 'Display 1', detail: 'Built-in · this window' }, { id: 2, display: 'Display 2', detail: 'LG 27″' }], open: false } : undefined)) as never);
    const onClose = vi.fn();
    render(<WallboardChooser onClose={onClose} />);
    const two = await screen.findByRole('radio', { name: /Display 2/ });
    expect(two.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: /Display 1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(call).toHaveBeenCalledWith('support:wall', { displayId: 1 });
    expect(onClose).toHaveBeenCalled();
  });
});
