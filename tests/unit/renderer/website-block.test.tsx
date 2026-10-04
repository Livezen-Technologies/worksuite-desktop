// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Blocking a website visitor (WS-WCHAT GATE-08, SEC-10): for a day, a week, a month or until somebody lifts it, with a
 * reason — a week unless somebody chooses otherwise, so a shared office address is not shut out for good by accident.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), request: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/chat/Composer', () => ({
  Composer: ({ compact, reply, onClearReply }: { compact?: boolean; reply: { sender_name: string; snippet: string } | null; onClearReply: () => void }) => (
    <div>
      {compact ? 'The compact composer' : 'The composer'}
      {reply ? <button type="button" onClick={onClearReply}>{`Replying to ${reply.sender_name}: ${reply.snippet}`}</button> : null}
    </div>
  ),
}));
vi.mock('../../../src/modules/chat/window', () => ({ openWebsiteChatWindow: vi.fn(async () => undefined) }));
vi.mock('../../../src/modules/chat/AttachmentViewer', () => ({ openChatAttachment: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: new URLSearchParams('view=website&website=41'), path: ['chat'], go: vi.fn(), active: true, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));

import { apiGet, request } from '../../../src/core/api';
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
    { id: 4, body: 'Yearly, renewed each March.', from: 'agent', agent: 'Nuwan', at: ago(50_000), file: null, reply_to: 1, reply: { id: 1, body: 'Hi, is the Adobe licence lifetime or yearly?', from: 'visitor', agent: null, file: null } },
  ],
  journey: [
    { url: 'https://techubiz.com/', title: 'Home', at: ago(500_000) },
    { url: 'https://techubiz.com/shop/adobe', title: 'Adobe', at: ago(400_000) },
  ],
  history: [],
  can: { view: true, reply: true, manage: true },
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
  vi.mocked(request).mockClear();
});
afterEach(() => cleanup());

const mount = (mini = false) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WebsiteThread id="41" mini={mini} />
    </QueryClientProvider>,
  );

describe('blocking a visitor (GATE-08, SEC-10)', () => {
  it('blocks for a week unless somebody chooses otherwise', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Block this visitor' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/until the block ends/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Block' }));
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/action', { body: { action: 'block', reason: null, days: 7 } }));
  });

  it('takes a reason and another length, or until lifted', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Block this visitor' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'For' }));
    fireEvent.click(screen.getByRole('option', { name: 'Until somebody lifts it' }));
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Spam' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Block' }));
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/action', { body: { action: 'block', reason: 'Spam' } }));
  });
});
