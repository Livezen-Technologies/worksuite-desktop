// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const net = vi.hoisted(() => ({ get: vi.fn(), meta: vi.fn(), post: vi.fn(), allowed: true, offline: false }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => true, errorMessage: String, isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', () => ({ apiGet: net.get, apiGetMeta: net.meta, apiPost: net.post, apiPut: vi.fn(), apiDelete: vi.fn(), ApiError: class extends Error {} }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: vi.fn(), go: vi.fn(), active: true, query: new URLSearchParams('view=day&date=2026-10-01') }), useTabTitle: () => undefined }));
vi.mock('../../../src/core/access', () => ({ useCanOpen: () => false, useVisibleIds: () => new Set(net.allowed ? ['calendar'] : []) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import CalendarPage from '../../../src/modules/calendar/CalendarPage';

beforeEach(() => {
  net.allowed = true; net.offline = false;
  net.get.mockReset().mockResolvedValue({ invitations: [], users: [] });
  net.meta.mockReset().mockImplementation(() => Promise.resolve({ data: { events: [] }, offline: net.offline }));
  net.post.mockReset();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function page() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CalendarPage tabId="calendar" route="/calendar" active /></QueryClientProvider>);
}

describe('Calendar new-event entry points (#63)', () => {
  it('opens the actual New Event form on release with the selected times, without creating an event', async () => {
    const { container } = page();
    await waitFor(() => expect(net.meta).toHaveBeenCalled());
    const column = container.querySelectorAll<HTMLElement>('[data-select-date]')[1]!;
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 100, bottom: 1248, width: 100, height: 1248, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(column, { button: 0, clientY: 9.25 * 52 });
    expect(screen.queryByLabelText('Event title')).toBeNull();
    fireEvent.pointerUp(window, { clientY: 10.75 * 52 });
    expect((screen.getByLabelText('Start') as HTMLInputElement).value).toBe('2026-10-01T09:15');
    expect((screen.getByLabelText('End') as HTMLInputElement).value).toBe('2026-10-01T10:45');
    expect(net.post).not.toHaveBeenCalled();
  });

  it('preserves the New event button and its keyboard shortcut', () => {
    page();
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    expect(screen.getByLabelText('Event title')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'n' });
    expect(screen.getByLabelText('Event title')).toBeTruthy();
    expect(net.post).not.toHaveBeenCalled();
  });

  it('refuses creation through both drag and keyboard when calendar access is absent', () => {
    net.allowed = false;
    const { container } = page();
    expect((screen.getByRole('button', { name: 'New event' }) as HTMLButtonElement).disabled).toBe(true);
    const column = container.querySelectorAll<HTMLElement>('[data-select-date]')[1]!;
    fireEvent.pointerDown(column, { button: 0, clientY: 468 });
    fireEvent.pointerUp(window, { clientY: 520 });
    fireEvent.keyDown(window, { key: 'n' });
    expect(screen.queryByLabelText('Event title')).toBeNull();
    expect(net.post).not.toHaveBeenCalled();
  });

  it('does not select or create from an offline feed', async () => {
    net.offline = true;
    const { container } = page();
    await waitFor(() => expect((screen.getByRole('button', { name: 'New event' }) as HTMLButtonElement).disabled).toBe(true));
    const column = container.querySelectorAll<HTMLElement>('[data-select-date]')[1]!;
    fireEvent.pointerDown(column, { button: 0, clientY: 468 });
    fireEvent.pointerUp(window, { clientY: 520 });
    expect(screen.queryByLabelText('Event title')).toBeNull();
    expect(net.post).not.toHaveBeenCalled();
  });
});
