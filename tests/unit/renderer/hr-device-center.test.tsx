// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { apiGet, apiPost } from '../../../src/core/api';
import DeviceCenter, { attentionLine } from '../../../src/modules/hr/DeviceCenter';

/** HR › Devices on the desktop: the attendance device framework (worksuite HR 1.5.0). */
const DEVICE = {
  id: 4, name: 'Front door', model: 'ZKTeco K40 Pro', model_code: 'K40_PRO', serial_number: 'CKJF201060123', connection_type: 'pull_tcp', host: '192.168.1.201', port: 4370,
  online: true, is_active: true, health_state: 'HEALTHY', last_sync_at: '2026-10-22 09:00:00', last_seen_at: '2026-10-22 09:00:00', location: 'Gate',
  firmware: 'Ver 6.60', user_count: 12, record_count: 340, last_error: null, capabilities: { set_time: true, clear_logs: true },
};
const PERMS = { view: true, create: true, edit: true, sync: true, test: true, manage_users: true, commands: true, gateway: true };

function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeviceCenter />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/hr/attendance/devices') return { devices: [DEVICE], permissions: PERMS };
    if (path === '/api/hr/attendance/devices/dashboard') return { total: 1, online: 1, offline: 0, warning: 0, drift: 0, errors: 0, punches_today: 41, jobs_queued: 0, jobs_failed: 0, needs_review: 0, gateways_online: 0, unmapped: 12 };
    if (path === '/api/hr/attendance/devices/4') {
      return { device: DEVICE, counts: { today: 41, unmapped: 0, mapped: 12 }, commands: [
        { key: 'restart', label: 'Restart', supported: true, allowed: true, dangerous: false },
        { key: 'clear_logs', label: 'Clear attendance logs on the device', supported: true, allowed: true, dangerous: true },
      ] };
    }
    throw new Error(path);
  }) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
});
afterEach(cleanup);

describe('the device center', () => {
  it('counts what needs a person', () => {
    expect(attentionLine(12)).toBe('12 records need attention');
    expect(attentionLine(1)).toBe('1 record needs attention');
    expect(attentionLine(0)).toBeNull();
  });

  it('opens on the dashboard with the unmapped punches first', async () => {
    show();
    expect(await screen.findByText('12 records need attention')).toBeTruthy();
  });

  it('will not erase a device until its name is typed exactly', async () => {
    show();
    fireEvent.click(await screen.findByText('All devices'));
    fireEvent.click(await screen.findByText(/Front door · ZKTeco K40 Pro/));
    fireEvent.click(await screen.findByText('Commands'));
    fireEvent.click(await screen.findByText('Clear attendance logs on the device'));

    const erase = await screen.findByText('Erase on device');
    expect((erase as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type "Front door" to confirm/), { target: { value: 'Front door' } });
    expect((erase as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(erase);

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hr/attendance/devices/4/commands', { command: 'clear_logs', confirm: 'Front door' }));
  });
});
