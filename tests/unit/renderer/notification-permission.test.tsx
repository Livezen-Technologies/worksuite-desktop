// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), errorMessage: (e: unknown) => String(e) }));
import { call } from '../../../src/core/bridge';
import { SystemPermission } from '../../../src/modules/notifications/Settings';

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const show = (enabled = true) => render(<QueryClientProvider client={new QueryClient()}><SystemPermission enabled={enabled} /></QueryClientProvider>);

it('explains a system that refused WorkSuite’s notifications (#114)', async () => {
  vi.mocked(call).mockResolvedValue({ state: 'blocked', detail: 'The system refused WorkSuite’s last notification. Check System Settings › Notifications › WorkSuite.', failure: 'Notifications are not allowed' });
  show();
  expect((await screen.findByRole('alert')).textContent).toContain('System Settings › Notifications › WorkSuite');
  expect(screen.getByText('Notifications are not allowed')).toBeTruthy();
  expect(call).toHaveBeenCalledWith('notifications:permission');
});

it('says honestly when the permission cannot be read, without alarming', async () => {
  vi.mocked(call).mockResolvedValue({ state: 'unknown', detail: 'WorkSuite cannot read whether the system allows its notifications.', failure: null });
  show();
  await screen.findByText(/cannot read whether/);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('asks nothing while banners are switched off here', () => {
  show(false);
  expect(call).not.toHaveBeenCalled();
});
