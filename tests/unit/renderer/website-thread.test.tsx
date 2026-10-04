// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as AttachmentViewer from '../../../src/modules/chat/AttachmentViewer';

/**
 * The website thread's visitor panel as drawn in WS-WCHAT-SRS v1.5 (CHAT-UI-01): who the visitor is at the top,
 * then Visitor, Journey and Shared files; and the header's on-site dot.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})) }));
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
vi.mock('../../../src/modules/chat/AttachmentViewer', async (orig) => ({ ...(await orig<typeof AttachmentViewer>()), openChatAttachment: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: new URLSearchParams('view=website&website=41'), path: ['chat'], go: vi.fn(), active: true, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));

import { apiGet, apiPost } from '../../../src/core/api';
import { openChatAttachment } from '../../../src/modules/chat/AttachmentViewer';
import { openWebsiteChatWindow } from '../../../src/modules/chat/window';
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

const mount = (mini = false) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WebsiteThread id="41" mini={mini} />
    </QueryClientProvider>,
  );

describe('a website chat in its own small window (RDC-16)', () => {
  it('the full thread opens the conversation in a window of its own', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open in new window' }));
    expect(openWebsiteChatWindow).toHaveBeenCalledWith(41, 'Visitor 4F2A');
    expect(screen.getByText('The composer')).toBeTruthy();
  });

  it('in the window: the conversation and the compact composer, taking and closing the chat, nothing else', async () => {
    mount(true);
    expect(await screen.findByText('Hi, is the Adobe licence lifetime or yearly?')).toBeTruthy();
    expect(screen.getByText('The compact composer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Assignee' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Priority' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open in new window' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Visitor details' })).toBeNull();
  });
});

describe('reply quotes in the website thread (RDC-10)', () => {
  it('shows what a reply answers, and Reply on a message quotes it in the composer', async () => {
    mount();
    const answer = await screen.findByText('Yearly, renewed each March.');
    // The quote sits inside the answer's bubble (C-02, #229).
    const quote = answer.closest('[data-bubble-body]')!.querySelector('[data-reply-quote]')!;
    expect(quote.textContent).toBe('Visitor 4F2A · Hi, is the Adobe licence lifetime or yearly?');
    // Reply is in the message's actions, the same menu as Team Chat's (RDC-12).
    const replyTo = (el: HTMLElement) => {
      fireEvent.click(within(el.closest('[data-bubble]') as HTMLElement).getByRole('button', { name: 'Message actions' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));
    };
    replyTo(screen.getByText('Hi, is the Adobe licence lifetime or yearly?', { selector: '[data-bubble-body] span' }));
    const bar = screen.getByRole('button', { name: 'Replying to Visitor 4F2A: Hi, is the Adobe licence lifetime or yearly?' });
    fireEvent.click(bar);
    expect(screen.queryByText(/^Replying to/)).toBeNull();
    // A file alone is quoted by its name.
    replyTo(screen.getByRole('button', { name: 'Open screenshot-pricing.png' }));
    expect(screen.getByText('Replying to Visitor 4F2A: screenshot-pricing.png')).toBeTruthy();
  });
});

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
    // This visit's pages, the page they are on first (UX-DRW-01).
    const journey = within(panel).getByRole('list');
    expect(within(journey).getAllByRole('listitem').map((li) => li.firstChild?.textContent)).toEqual(['/shop/adobe', '/']);
    expect(within(journey).getByText('Reading now')).toBeTruthy();
    expect(within(panel).getByRole('heading', { name: 'Shared files · 2' })).toBeTruthy();
    // Pictures as a grid of thumbnails, other files listed with size and sender; each opens in the attachment preview.
    expect(within(panel).getByRole('button', { name: 'Open screenshot-pricing.png, sent by Visitor 4F2A' }).querySelector('img')).toBeTruthy();
    const files = within(panel).getAllByRole('button').filter((b) => /\.pdf/.test(b.textContent ?? ''));
    expect(files.map((b) => b.textContent)).toEqual([expect.stringContaining('Adobe-CC-Teams-Quote.pdf')]);
    expect(files[0]!.textContent).toContain('Nuwan');
    fireEvent.click(files[0]!);
    expect(openChatAttachment).toHaveBeenCalledWith(expect.objectContaining({ filename: 'Adobe-CC-Teams-Quote.pdf', url: '/api/chat/widget-admin/files/def' }), expect.any(Function));
    expect(screen.getByText(/On the site now · reading \/shop\/adobe/)).toBeTruthy();
  });
});

describe('a callback in its conversation (worksuite-desktop#223, #224)', () => {
  it('sits at the top with what the visitor asked for and the actions; a WhatsApp chat they continued on is linked', async () => {
    const data = {
      ...conversation(),
      callback: {
        id: 5, conversation_id: 41, phone: '+94771234567', best_time: 'As soon as possible', visitor: 'Ravi', site: 'techubiz.com', missed_call: false,
        created_at: ago(120_000), reference: 'CB-1042', email: 'ravi@studio.lk', channel: 'call' as const, how: 'by phone', message: 'Lifetime or yearly?',
        due_at: ago(-3_600_000), overdue: false, status: 'open' as const, attempts: 0,
      },
      whatsapp: [{ account: 'Techubiz Sales', chat_id: 55, ref: 'E5C9', linked_at: ago(60_000), link: '/whatsapp?chat=55' }],
    };
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path === '/api/chat/widget-admin/conversations/41') return data;
      if (path === '/api/chat/widget-admin/canned') return { responses: [] };
      if (path === '/api/chat/widget-admin/agents') return { agents: [] };
      throw new Error(`unexpected ${path}`);
    }) as never);
    mount();

    const card = await screen.findByRole('group', { name: 'Callback CB-1042 for Ravi' });
    expect(within(card).getByText('Callback requested')).toBeTruthy();
    expect(within(card).getByText('Lifetime or yearly?')).toBeTruthy();
    expect(within(card).getByText('+94771234567 · ravi@studio.lk')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'WhatsApp' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Reply by email' })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/callbacks/5/done', {}));
    expect(screen.getByRole('button', { name: 'Continued on WhatsApp · Techubiz Sales' })).toBeTruthy();
  });

  it('in the small window, no callback card', async () => {
    mount(true);
    await screen.findByText('Yearly, renewed each March.');
    expect(screen.queryByText('Callback requested')).toBeNull();
  });
});
