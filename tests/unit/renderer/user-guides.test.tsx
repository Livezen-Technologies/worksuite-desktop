// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

const bridge = vi.hoisted(() => ({ call: vi.fn(async () => true) }));
vi.mock('../../../src/core/bridge', () => ({ call: bridge.call, on: () => () => undefined, errorMessage: (e: unknown) => String(e), hasDesktop: () => true, isMac: false }));
const answers = vi.hoisted(() => ({ map: new Map<string, unknown>() }));
vi.mock('../../../src/core/api', async (orig) => ({
  ...(await orig<typeof CoreApi>()),
  apiGetMeta: vi.fn(async (path: string) => {
    const v = answers.map.get(path);
    if (v instanceof Error) throw v;
    if (v === undefined) throw new Error(`unexpected ${path}`);
    return { data: v, offline: false, cachedAt: null };
  }),
}));
const tab = vi.hoisted(() => ({ go: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ go: tab.go, setTitle: () => undefined }), useTabTitle: () => undefined, openWebLink: vi.fn() }));

import { APP_CATALOGUE } from '@shared/apps';
import { ApiError } from '../../../src/core/api';
import { MODULES } from '../../../src/modules/registry';
import { resetGuideIndex } from '../../../src/modules/help/api';
import { GUIDE_KEYS, guideKeyFor } from '../../../src/modules/help/keys';
import HelpPage from '../../../src/modules/help/HelpPage';
import { UserGuideButton } from '../../../src/modules/help/UserGuideButton';

// The brief's catalogue keys (the server's docs/guides/<key>.md).
const KEYS = new Set('word excel powerpoint pdf diagram notes announcements mail chat social meet phone whatsapp website-chats tickets calendar meetings tasks projects contacts forms crm marketing recruitment board tender hosting docs billing expenses appointments salon garage pos restaurant pms events rental amc subscriptions inventory purchase oms hr elearning ai payroll finance assets devices analytics drive admin'.split(' '));

const CRM = { key: 'crm', title: 'CRM', summary: 'Leads and deals.', workflows: [{ slug: 'add-a-lead', title: 'Add a lead' }], url: '/help/guides/crm', external_url: null };
const INDEX = (over: Record<string, unknown> = {}) => ({ guides: [CRM, { key: 'tickets', title: 'Support', summary: 'Tickets.', workflows: [], url: '/help/guides/tickets', external_url: 'https://wiki.example.com/support' }, { key: 'social', title: 'Social', summary: 'Posts.', workflows: [], url: '/help/guides/social', external_url: null }], ...over });

beforeEach(() => {
  resetGuideIndex();
  answers.map.clear();
  bridge.call.mockClear();
  tab.go.mockClear();
});
afterEach(cleanup);

describe('User guides: every module has a guide key', () => {
  it('maps every registry module and catalogue app to a known guide key, or to the list of guides', () => {
    for (const m of MODULES) {
      expect(m.id in GUIDE_KEYS, m.id).toBe(true);
      const k = guideKeyFor(m.id);
      if (k) expect(KEYS.has(k), `${m.id} → ${k}`).toBe(true);
    }
    for (const a of APP_CATALOGUE) {
      expect(a.id in GUIDE_KEYS, a.id).toBe(true);
      const k = guideKeyFor(a.id);
      if (k) expect(KEYS.has(k), `${a.id} → ${k}`).toBe(true);
    }
    expect(guideKeyFor('support')).toBe('tickets');
    expect(guideKeyFor('files')).toBe('drive');
    expect(MODULES.some((m) => m.id === 'help')).toBe(true);
  });
});

describe('User guide button', () => {
  it('opens the module guide in the viewer', async () => {
    answers.map.set('/api/help/guides', INDEX());
    render(<UserGuideButton app="crm" />);
    const b = await screen.findByRole('button', { name: 'User guide' });
    expect(b.getAttribute('data-guide-link')).toBe('crm');
  });

  it('opens the company page in the system browser when external_url is set', async () => {
    answers.map.set('/api/help/guides', INDEX());
    render(<UserGuideButton app="support" />);
    fireEvent.click(await screen.findByRole('button', { name: 'User guide' }));
    expect(bridge.call).toHaveBeenCalledWith('app:openExternal', { url: 'https://wiki.example.com/support' });
  });

  it('opens the web guide for a browser-surface app', async () => {
    answers.map.set('/api/help/guides', INDEX());
    render(<UserGuideButton app="social" />);
    fireEvent.click(await screen.findByRole('button', { name: 'User guide' }));
    expect(bridge.call).toHaveBeenCalledWith('app:openInBrowser', { path: '/help/guides/social' });
  });

  it('is hidden when the module guide is disabled (not listed), when links are off, or guides are off', async () => {
    answers.map.set('/api/help/guides', INDEX());
    const { container, unmount } = render(<UserGuideButton app="finance" />);
    await waitFor(() => expect(answers.map.size).toBe(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('button')).toBeNull();
    unmount();
    for (const over of [{ show_link: false }, { enabled: false }]) {
      resetGuideIndex();
      answers.map.set('/api/help/guides', INDEX(over));
      const r = render(<UserGuideButton app="crm" />);
      await new Promise((res) => setTimeout(res, 0));
      expect(r.container.querySelector('button')).toBeNull();
      r.unmount();
    }
  });
});

describe('Guide viewer', () => {
  it('lists and searches guides', async () => {
    answers.map.set('/api/help/guides', INDEX());
    render(<HelpPage tabId="t" route="/help" active />);
    expect(await screen.findByText('CRM')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search the guides'), { target: { value: 'lead' } });
    expect(screen.queryByText('Payroll')).toBeNull();
    fireEvent.click(screen.getByText('Add a lead'));
    expect(tab.go).toHaveBeenCalledWith('/help?guide=crm&workflow=add-a-lead');
  });

  it('renders a guide and a workflow deep link, with the HTML cleaned', async () => {
    answers.map.set('/api/help/guides', INDEX());
    answers.map.set('/api/help/guides/crm', {
      key: 'crm', title: 'CRM', summary: 'Leads and deals.', audience: ['everyone'], updated: '2026-10-22',
      overview_html: '<p>Overview text</p><script>alert(1)</script><img src=x onerror="alert(1)">',
      workflows: [{ slug: 'add-a-lead', title: 'Add a lead', who: 'Sales rep', where: 'Leads', route: '/crm/leads', steps_html: '<ol><li>Click <strong>New lead</strong></li></ol><a href="javascript:alert(1)">bad</a>' }],
      settings_html: null, faq: [], external_url: null, url: '/help/guides/crm',
    });
    const { container, unmount } = render(<HelpPage tabId="t" route="/help?guide=crm" active />);
    expect(await screen.findByText('Overview text')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Add a lead')).toBeTruthy();
    unmount();
    const r = render(<HelpPage tabId="t" route="/help?guide=crm&workflow=add-a-lead" active />);
    expect(await screen.findByText('New lead')).toBeTruthy();
    expect(screen.getByText('Who: Sales rep')).toBeTruthy();
    expect(r.container.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it('says it is offline when the guide was never read here', async () => {
    answers.map.set('/api/help/guides', INDEX());
    answers.map.set('/api/help/guides/crm', new ApiError(0, 'offline', 'NETWORK_UNREACHABLE'));
    render(<HelpPage tabId="t" route="/help?guide=crm" active />);
    expect(await screen.findByText("You're offline")).toBeTruthy();
  });
});
