// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => true), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: vi.fn(), query: new URLSearchParams(), path: ['settings'] }), useTabTitle: () => undefined }));

const { call } = await import('../../../src/core/bridge');
const { About } = await import('../../../src/modules/settings/SettingsPage');

afterEach(cleanup);

describe('Settings › About (#48)', () => {
  it('names the owner in full, with this year’s copyright, the website, and the open-source notice apart', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-01T10:00:00Z'));
    render(<QueryClientProvider client={new QueryClient()}><About /></QueryClientProvider>);
    vi.useRealTimers();
    expect(screen.getByText('WorkSuite is owned and developed by Livezen Technologies LLC.')).toBeTruthy();
    expect(screen.getByText('© 2027 Livezen Technologies LLC. All rights reserved.')).toBeTruthy();
    expect(screen.queryByText(/© Livezen Technologies\./)).toBeNull();
    const notice = screen.getByText(/includes open-source software/);
    expect(notice.textContent).not.toContain('©');
  });

  it('opens worksuitecloud.com in the default browser, not in the app', () => {
    render(<QueryClientProvider client={new QueryClient()}><About /></QueryClientProvider>);
    const link = screen.getByRole('link', { name: 'worksuitecloud.com' });
    expect(link.getAttribute('href')).toBe('https://worksuitecloud.com/');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(link, click);
    expect(click.defaultPrevented).toBe(true);
    expect(call).toHaveBeenCalledWith('app:openExternal', { url: 'https://worksuitecloud.com/' });
  });
});
