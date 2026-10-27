// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Bridge from '../../../src/core/bridge';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({ data: [] })) }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: vi.fn() }));

import { CrmSearch } from '../../../src/modules/crm/Rail';

/**
 * Search the CRM closes its list a moment after the box loses focus. That timer belonged to nothing: leaving the CRM
 * inside those 150 ms left it to set state on an unmounted rail — the bug fixed in Mail's @mentions, which outlived a
 * test's jsdom as "ReferenceError: window is not defined" (audit D-G15). The timer is now cleared when the search goes.
 */
function renderSearch() {
  // No query runs (fewer than two characters), and an unmounted query is never collected (gcTime: Infinity schedules
  // nothing), so the only timer is the blur's.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrmSearch onOpen={() => undefined} params={{}} orgKey={0} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Search the CRM in the rail (D-G15)', () => {
  it('leaves no timer behind when the rail goes right after the box loses focus', () => {
    vi.useFakeTimers();
    const view = renderSearch();
    const box = view.getByLabelText('Search the CRM');
    act(() => {
      fireEvent.focus(box);
      fireEvent.blur(box);
    });
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still closes after the pause, and a second blur replaces the first timer', () => {
    vi.useFakeTimers();
    const view = renderSearch();
    const box = view.getByLabelText('Search the CRM');
    act(() => {
      fireEvent.blur(box);
      fireEvent.blur(box);
    });
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
