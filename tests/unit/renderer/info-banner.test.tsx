// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPut: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { apiGet } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { toast } from '../../../src/core/toasts';
import { BANNER_COMPACT, BANNER_STACKED, InfoBanner } from '../../../src/components/InfoBanner';
import { FirstRunOffers } from '../../../src/modules/mail/FirstRun';

const width = (w: number) =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: w, height: 60, top: 0, left: 0, right: w, bottom: 60, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);

function wrap(ui: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(toast).mockReset();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('InfoBanner (#210)', () => {
  const props = {
    title: 'Outlook shortcuts are on',
    description: 'Finish setting up Mail',
    primary: { id: 'a', label: 'Import email', onClick: vi.fn() },
    secondary: [
      { id: 'b', label: 'Add signature', onClick: vi.fn() },
      { id: 'c', label: 'Make default mail app', onClick: vi.fn(), done: true },
    ],
  };

  it('is one row with one primary action, secondary actions the same height, and a dismiss button', () => {
    width(1300);
    render(<InfoBanner {...props} onDismiss={() => undefined} />);
    const b = screen.getByRole('region', { name: 'Outlook shortcuts are on' });
    expect(b.getAttribute('data-layout')).toBe('wide');
    expect(b.className).toMatch(/\bm-3\b/); // 12px all round, the gap below included
    expect(within(b).getByText('Finish setting up Mail')).toBeTruthy();
    const primary = within(b).getByRole('button', { name: 'Import email' });
    const secondary = within(b).getByRole('button', { name: 'Add signature' });
    expect(primary.className).toMatch(/h-\[34px\]/);
    expect(secondary.className).toMatch(/h-\[34px\]/);
    expect(primary.className).not.toBe(secondary.className);
    // A step already done: a tick, and it can't be pressed.
    expect((within(b).getByRole('button', { name: 'Make default mail app' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(b).getByRole('button', { name: 'Dismiss' }).className).toMatch(/h-8 w-8/);
  });

  it(`drops the description and moves secondary actions into More below ${BANNER_COMPACT}px, and stacks below ${BANNER_STACKED}px`, async () => {
    width(900);
    const { unmount } = render(<InfoBanner {...props} />);
    let b = screen.getByRole('region', { name: 'Outlook shortcuts are on' });
    expect(b.getAttribute('data-layout')).toBe('compact');
    expect(within(b).queryByText('Finish setting up Mail')).toBeNull();
    expect(within(b).queryByRole('button', { name: 'Add signature' })).toBeNull();
    fireEvent.click(within(b).getByRole('button', { name: 'More' }));
    expect(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Add signature' })).toBeTruthy();
    unmount();
    vi.restoreAllMocks();
    width(600);
    render(<InfoBanner {...props} />);
    b = screen.getByRole('region', { name: 'Outlook shortcuts are on' });
    expect(b.getAttribute('data-layout')).toBe('stacked');
    expect(b.className).toMatch(/flex-wrap/);
  });

  it('collapses in 150ms before it is dismissed, so nothing below jumps; reduced motion just removes it', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { container, unmount } = render(<InfoBanner {...props} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(container.firstElementChild?.className).toMatch(/grid-rows-\[0fr\]/);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(150));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    unmount();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const now = vi.fn();
    render(<InfoBanner {...props} onDismiss={now} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(now).toHaveBeenCalledTimes(1);
  });
});

describe('the Mail setup banner (#210)', () => {
  const answer = (signatures: number, imports: Array<{ stage: string }>) =>
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path === '/api/mail/signatures') return { signatures: Array.from({ length: signatures }, (_, i) => ({ id: i + 1 })) };
      if (path === '/api/mail/imports') return { imports };
      throw new Error(path);
    }) as typeof apiGet);

  it('ticks the steps already done', async () => {
    answer(1, []);
    app.set((s) => ({ ...s, prefs: { ...(s.prefs ?? {}), mailtoHandler: false } as never }));
    wrap(<FirstRunOffers onImport={() => undefined} onSignatures={() => undefined} onDone={() => undefined} />);
    const b = await screen.findByRole('region', { name: 'Outlook shortcuts are on' });
    await waitFor(() => expect((within(b).getByRole('button', { name: 'Add signature' }) as HTMLButtonElement).disabled).toBe(true));
    expect((within(b).getByRole('button', { name: 'Import email' }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(b).getByRole('button', { name: 'Make default mail app' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('goes by itself once all three steps are done', async () => {
    answer(1, [{ stage: 'done' }]);
    app.set((s) => ({ ...s, prefs: { ...(s.prefs ?? {}), mailtoHandler: true } as never }));
    const onDone = vi.fn();
    wrap(<FirstRunOffers onImport={() => undefined} onSignatures={() => undefined} onDone={onDone} />);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('region', { name: 'Outlook shortcuts are on' })).toBeNull();
  });

  it('saves the dismissal and offers Undo for five seconds', async () => {
    answer(0, []);
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const onDone = vi.fn();
    const onRestore = vi.fn();
    wrap(<FirstRunOffers onImport={() => undefined} onSignatures={() => undefined} onDone={onDone} onRestore={onRestore} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('info', 'Setup tips hidden.', expect.objectContaining({ label: 'Undo' }), 5000);
    vi.mocked(toast).mock.calls[0]![2]!.run();
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('says what is left without claiming Outlook shortcuts when they are not on', async () => {
    answer(0, []);
    wrap(<FirstRunOffers outlook={false} onImport={() => undefined} onSignatures={() => undefined} onDone={() => undefined} />);
    expect(await screen.findByRole('region', { name: 'Finish setting up Mail' })).toBeTruthy();
  });
});
