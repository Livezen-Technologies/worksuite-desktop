// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

// The shell reads where it is from the tab's address; the tests say what that address is.
const tab = vi.hoisted(() => ({ query: new URLSearchParams(), path: ['garage'], go: (_r: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: `/garage?${tab.query}`, active: true, path: tab.path, query: tab.query, go: (r: string) => tab.go(r), navigate: () => undefined, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { default: GarageShell } = await import('../../../src/modules/garage/GarageShell');

const options = (can: Record<string, boolean>, complete = true) => ({
  org: 3, companies: [{ id: 3, name: 'Livezen Motors' }], currency: 'LKR', units: 'km', can,
  setup: { complete, done: complete ? 7 : 2, total: 7, next: null }, branches: [], technicians: [], models: [], priorities: ['NORMAL'], job_types: ['SERVICE'],
  vehicle_types: ['car'], fuels: [], transmissions: [], complaints: [], cancel_reasons: [], require_vin: false,
});

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GarageShell tabId="t1" route="/garage" active />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(call).mockReset();
  tab.query = new URLSearchParams();
  tab.path = ['garage'];
  tab.go = vi.fn();
});
afterEach(cleanup);

describe('Garage, the shell', () => {
  it('shows a technician their own screens only, with the web ones they may use', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path.endsWith('/options') ? options({ work_order_execute: true, vehicle_view: true }) : { counts: {}, overdue: [], checked_in_today: 0, delivered_today: 0, bays: {}, recent: [] }));
    show();
    const rail = await screen.findByRole('navigation', { name: 'Garage' });
    expect(rail.textContent).toContain('My work');
    expect(rail.textContent).not.toContain('Parts counter');
    expect(rail.textContent).not.toContain('New walk-in');
    expect(rail.textContent).not.toContain('Workshop');
    fireEvent.click(screen.getByRole('button', { name: /Vehicles/ }));
    expect(call).toHaveBeenCalledWith('app:openInBrowser', { path: '/garage?view=vehicles' });
    fireEvent.click(screen.getByRole('button', { name: /My work/ }));
    expect(tab.go).toHaveBeenCalledWith('/garage?view=mywork');
  });

  it('sends a manager to the set-up on the web until the workshop is configured', async () => {
    vi.mocked(apiGet).mockResolvedValue(options({ job_view: true, job_create: true, settings_manage: true }, false));
    show();
    expect(await screen.findByText('Configure your workshop before the first service job')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start set-up' }));
    expect(call).toHaveBeenCalledWith('app:openInBrowser', { path: '/garage?view=setup' });
  });

  it('opens the job a notification names', async () => {
    tab.query = new URLSearchParams('job=40');
    vi.mocked(apiGet).mockImplementation(async (path: string) => (path.endsWith('/options') ? options({ job_view: true }) : new Promise(() => undefined)));
    show();
    await screen.findByRole('navigation', { name: 'Garage' });
    await waitFor(() => expect(vi.mocked(apiGet).mock.calls.some(([p]) => p === '/api/garage/v1/jobs/40')).toBe(true));
  });
});
