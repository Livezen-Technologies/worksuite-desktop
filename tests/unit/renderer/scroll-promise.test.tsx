// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Chromium 152 (Electron 44) returns a Promise from `scrollIntoView`,
 * `scrollTo` and `scrollBy`. An effect written `useEffect(() => el.scrollIntoView())`
 * returns it, React keeps it as the effect's cleanup, and calling it on the
 * next run or on unmount throws "destroy_ is not a function" — which took the
 * AI dock down, and with it the window whenever Chat or Lock now replaced it.
 * Here the DOM answers as Chromium does, and the dock opens, updates and closes.
 */
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: true, platform: 'darwin' }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({ items: [], actions: [] })), apiPost: vi.fn(), apiPut: vi.fn() }));

const was = Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView = function () {
  return Promise.resolve() as unknown as void;
};
afterEach(cleanup);

const { AiDock } = await import('../../../src/app/overlays/AiDock');
const { AskPanel } = await import('../../../src/modules/ai/AskPanel');

describe('scrolling returns a Promise, as in Chromium 152', () => {
  it('the AI dock opens, re-renders and closes without taking the window with it', async () => {
    const qc = new QueryClient();
    const r = render(<QueryClientProvider client={qc}><AiDock /></QueryClientProvider>);
    await act(async () => undefined);
    expect(() => r.unmount()).not.toThrow();
  });

  it('the ask panel re-runs its scroll effect safely', async () => {
    const qc = new QueryClient();
    const r = render(<QueryClientProvider client={qc}><AskPanel surface="assistant.panel" tabRef="task:1" /></QueryClientProvider>);
    await act(async () => undefined);
    expect(() => r.rerender(<QueryClientProvider client={qc}><AskPanel surface="assistant.panel" tabRef="task:2" /></QueryClientProvider>)).not.toThrow();
    expect(() => r.unmount()).not.toThrow();
    Element.prototype.scrollIntoView = was;
  });
});
