// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn(async () => []) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tab = { route: '/social-media' };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { route: tab.route, query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: vi.fn(), navigate: vi.fn(), openInNewTab: vi.fn(), openInWindow: vi.fn(), active: true, openLink: vi.fn(), setTitle: vi.fn(), tabId: 't1' };
  },
  useTabTitle: () => undefined,
}));

import { apiGet } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import SocialMediaPage from '../../../src/modules/social-media/SocialMediaPage';
import { socialAnswer } from './social-fixtures';

/**
 * Every Social Media screen draws, as a Social Admin, against today's server (no module: every route answers 404)
 * and against one that has it — no crash, no render loop, and the screen's heading on it.
 */
const ROUTES: Array<[string, RegExp]> = [
  ['/social-media', /Overview/],
  ['/social-media/compose', /Create post/],
  ['/social-media/calendar', /Calendar/],
  ['/social-media/queue', /Queue & posting slots/],
  ['/social-media/approvals', /Approvals/],
  ['/social-media/inbox', /Inbox/],
  ['/social-media/analytics', /Analytics/],
  ['/social-media/library', /Content library/],
  ['/social-media/campaigns', /Campaigns/],
  ['/social-media/accounts', /Accounts/],
  ['/social-media/log', /Publishing log/],
  ['/social-media/settings', /Module settings/],
];

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SocialMediaPage tabId="t1" route={tab.route} active />
    </QueryClientProvider>,
  );
}

describe('Social Media screens', () => {
  beforeEach(() => {
    app.set({ bootstrap: { permissions: ['*'] } as never });
  });
  afterEach(() => cleanup());

  for (const offered of [false, true]) {
    describe(offered ? 'on a server with the module' : 'on today’s server', () => {
      for (const [route, heading] of ROUTES) {
        it(`draws ${route}`, async () => {
          vi.mocked(apiGet).mockImplementation(socialAnswer(offered) as never);
          tab.route = route;
          mount();
          expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
          if (!offered) expect((await screen.findAllByText(/isn’t (offered by|on) this WorkSuite server/)).length).toBeGreaterThan(0);
        });
      }
    });
  }
});
