// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The website thread's visitor panel as drawn in WS-WCHAT-SRS v1.5 (CHAT-UI-01): who the visitor is at the top,
 * then Visitor, Journey and Shared files; and the header's on-site dot.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/chat/Composer', () => ({ Composer: () => <div>The composer</div> }));
vi.mock('../../../src/modules/chat/AttachmentViewer', () => ({ openChatAttachment: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: new URLSearchParams('view=website&website=41'), path: ['chat'], go: vi.fn(), active: true, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));

import { apiGet } from '../../../src/core/api';
import { openChatAttachment } from '../../../src/modules/chat/AttachmentViewer';
import type { WebsiteConversation } from '../../../src/modules/chat/website/api';
import { WebsiteThread } from '../../../src/modules/chat/website/WebsiteThread';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const conversation = (): WebsiteConversation => ({
  conversation: { id: 41, widget: 'TechHub', website: 'techubiz.com', status: 'open', is_offline: false, inactive: false, assigned_to: null, visitor_typing: false, started_at: ago(600_000), closed_at: null, rating: null, rating_comment: null, tags: null, is_starred: false },
  visitor: {
    id: 9, label: 'Visitor 4F2A', name: null, email: 'ravi@studio.lk', phone: null, company: null, browser: 'Chrome', os: 'Windows', device: 'desktop', language: null, timezone: null,
    country: 'LK', city: 'Colombo', landing_page: null, current_url: 'https://techubiz.com/shop/adobe', current_title: null, referrer: null, utm_source: null, utm_campaign: null,
    visits: 3, first_seen: null, last_seen: ago(10_000), is_blocked: false,
  },
  messages: [
    { id: 1, body: 'Hi, is the Adobe licence lifetime or yearly?', from: 'visitor', agent: null, at: ago(300_000), file: null },
    { id: 2, body: null, from: 'visitor', agent: null, at: ago(200_000), file: { url: '/chat/widget-admin/files/abc', filename: 'screenshot-pricing.png', mime: 'image/png', size: 2048, is_image: true } },
    { id: 3, body: null, from: 'agent', agent: 'Nuwan', at: ago(100_000), file: { url: '/chat/widget-admin/files/def', filename: 'Adobe-CC-Teams-Quote.pdf', mime: 'application/pdf', size: 188_416, is_image: false } },
  ],
  journey: [
    { url: 'https://techubiz.com/', title: 'Home', at: ago(500_000) },
    { url: 'https://techubiz.com/shop/adobe', title: 'Adobe', at: ago(400_000) },
  ],
  history: [],
  can: { view: true, reply: true, manage: false },
});

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/conversations/41') return conversation();
    if (path === '/api/chat/widget-admin/canned') return { responses: [] };
    if (path === '/api/chat/widget-admin/agents') return { agents: [] };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(openChatAttachment).mockClear();
});
afterEach(() => cleanup());

describe('the website thread (CHAT-UI-01)', () => {
  it('shows who the visitor is, their journey and the files shared in the chat', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WebsiteThread id="41" />
      </QueryClientProvider>,
    );
    const panel = await screen.findByRole('complementary', { name: 'Visitor details' });
    expect(within(panel).getByText('Visitor 4F2A')).toBeTruthy();
    expect(within(panel).getByText('ravi@studio.lk')).toBeTruthy();
    expect(within(panel).getByRole('heading', { name: 'Visitor' })).toBeTruthy();
    expect(within(panel).getByText('Colombo, LK')).toBeTruthy();
    expect(within(panel).getByRole('heading', { name: 'Journey' })).toBeTruthy();
    const journey = within(panel).getByRole('list');
    expect(within(journey).getAllByRole('listitem').map((li) => li.firstChild?.textContent)).toEqual(['/', '/shop/adobe']);
    expect(within(journey).getByText('Reading now')).toBeTruthy();
    expect(within(panel).getByRole('heading', { name: 'Shared files · 2' })).toBeTruthy();
    // Newest first; a file opens in the attachment preview.
    const files = within(panel).getAllByRole('button').filter((b) => /\.(pdf|png)/.test(b.textContent ?? ''));
    expect(files.map((b) => b.textContent)).toEqual([expect.stringContaining('Adobe-CC-Teams-Quote.pdf'), expect.stringContaining('screenshot-pricing.png')]);
    fireEvent.click(files[0]!);
    expect(openChatAttachment).toHaveBeenCalledWith(expect.objectContaining({ filename: 'Adobe-CC-Teams-Quote.pdf', url: '/api/chat/widget-admin/files/def' }), expect.any(Function));
    expect(screen.getByText(/On the site now · reading \/shop\/adobe/)).toBeTruthy();
  });
});
