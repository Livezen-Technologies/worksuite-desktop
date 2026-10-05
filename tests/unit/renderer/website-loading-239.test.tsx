// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Website chats: the conversation pane opens at once and the list is tidier (worksuite-desktop#239).
 *
 * - A conversation opened lately, or saved on this computer, shows at once while the server is asked again.
 * - One not here yet shows the thread's layout in grey (header, bubbles both sides, the composer disabled, the visitor
 *   panel), says "Still loading… Retry" in the middle after 5 seconds, and "Couldn't load this conversation · Retry"
 *   when the server cannot be read.
 * - The last few conversations opened stay in memory; older ones are let go.
 * - Each row: at most one status pill (Waiting, else Unread), online only as the avatar's dot, who has it as faces.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/chat/Composer', () => ({ Composer: () => <div>The composer</div> }));
vi.mock('../../../src/modules/chat/window', () => ({ openWebsiteChatWindow: vi.fn(async () => undefined) }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: new URLSearchParams('view=website&website=41'), path: ['chat'], go: vi.fn(), active: true, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));

import { ApiError, apiGet, request } from '../../../src/core/api';
import { rememberOpened, resetRecentlyOpened, RECENT_CONVERSATIONS, type WebsiteConversation, type WebsiteRow } from '../../../src/modules/chat/website/api';
import { ConversationRow } from '../../../src/modules/chat/website/ConversationRow';
import { shortWait } from '../../../src/modules/chat/website/rowParts';
import { SLOW_AFTER_MS } from '../../../src/modules/chat/website/ThreadPlaceholder';
import { WebsiteThread } from '../../../src/modules/chat/website/WebsiteThread';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const conversation = (name = 'Anne Fernando'): WebsiteConversation => ({
  conversation: { id: 41, widget: 'TechHub', website: 'techubiz.com', status: 'open', is_offline: false, inactive: false, assigned_to: null, visitor_typing: true, started_at: ago(600_000), closed_at: null, rating: null, rating_comment: null, tags: null, is_starred: false },
  visitor: {
    id: 9, label: 'Visitor 4F2A', name, email: 'anne@acme.lk', phone: null, company: null, browser: 'Chrome', os: 'Windows', device: 'desktop', language: null, timezone: null,
    country: 'LK', city: 'Colombo', landing_page: null, current_url: 'https://techubiz.com/shop', current_title: null, referrer: null, utm_source: null, utm_campaign: null,
    visits: 1, first_seen: null, last_seen: ago(5_000), is_blocked: false,
  },
  messages: [{ id: 1, body: 'Is the licence yearly?', from: 'visitor', agent: null, at: ago(60_000), file: null }],
  journey: [],
  history: [],
  can: { view: true, reply: true, manage: false },
});

const PATH = '/api/chat/widget-admin/conversations/41';
/** What the server does with the thread: answer, never answer, or fail. */
let server: 'answer' | 'hang' | 'fail' | 'gone' = 'answer';
/** The copy saved on this computer, read with X-WS-Local-Read. */
let saved: unknown = null;

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  server = 'answer';
  saved = null;
  resetRecentlyOpened();
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === PATH) {
      if (server === 'hang') return new Promise(() => undefined);
      if (server === 'fail') throw new ApiError(500, 'The server had a problem.', null);
      if (server === 'gone') throw new ApiError(404, 'Not found.', null);
      return conversation();
    }
    if (path === '/api/chat/widget-admin/canned') return { responses: [] };
    if (path === '/api/chat/widget-admin/agents') return { agents: [] };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(request).mockReset().mockImplementation((async (_method: string, path: string, opts?: { headers?: Record<string, string> }) => {
    if (opts?.headers?.['X-WS-Local-Read'] === '1' && path === PATH && saved) return { data: saved };
    throw new ApiError(404, 'No saved conversation.', null);
  }) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (qc: QueryClient, ui: ReactNode) => render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
const chatWith = (name: string) => screen.queryByRole('region', { name: `Chat with ${name}` });

describe('opening a conversation (#239)', () => {
  it('one opened before opens at once, with no spinner and no placeholder, while the server is asked again', async () => {
    const qc = client();
    const first = wrap(qc, <WebsiteThread id="41" />);
    expect(await screen.findByRole('region', { name: 'Chat with Anne Fernando' })).toBeTruthy();
    first.unmount();
    server = 'hang';
    wrap(qc, <WebsiteThread id="41" />);
    expect(chatWith('Anne Fernando')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByTestId('thread-placeholder')).toBeNull();
  });

  it('one saved on this computer opens from that copy, saying nobody is typing until the server answers', async () => {
    saved = conversation('Saved Sam');
    server = 'hang';
    wrap(client(), <WebsiteThread id="41" />);
    const pane = await screen.findByRole('region', { name: 'Chat with Saved Sam' });
    expect(within(pane).getByText('Is the licence yearly?')).toBeTruthy();
    // The saved copy says the visitor was typing; it says nothing about now.
    expect(within(pane).queryByText('Typing…')).toBeNull();
    expect(within(pane).getByText('Left the site')).toBeTruthy();
    expect(screen.queryByTestId('thread-placeholder')).toBeNull();
  });

  it('the server\'s answer replaces the saved copy', async () => {
    saved = conversation('Saved Sam');
    wrap(client(), <WebsiteThread id="41" />);
    expect(await screen.findByRole('region', { name: 'Chat with Anne Fernando' })).toBeTruthy();
    expect(chatWith('Saved Sam')).toBeNull();
  });

  it('a saved copy that is not a conversation is not drawn', async () => {
    saved = { status: 'ok' };
    server = 'hang';
    wrap(client(), <WebsiteThread id="41" />);
    expect(await screen.findByTestId('thread-placeholder')).toBeTruthy();
  });

  it('one not here yet shows the thread in grey: header, bubbles on both sides, the composer disabled, the visitor panel', async () => {
    server = 'hang';
    wrap(client(), <WebsiteThread id="41" />);
    const placeholder = await screen.findByTestId('thread-placeholder');
    expect(screen.getByRole('status', { name: 'Loading the conversation' }).getAttribute('aria-busy')).toBe('true');
    const sides = [...placeholder.querySelectorAll('[data-side]')].map((b) => b.getAttribute('data-side'));
    expect(sides.length).toBeGreaterThanOrEqual(4);
    expect(sides.length).toBeLessThanOrEqual(6);
    sides.slice(1).forEach((side, i) => expect(side).not.toBe(sides[i]));
    expect((within(placeholder).getByRole('textbox', { hidden: true }) as HTMLTextAreaElement).disabled).toBe(true);
    expect((within(placeholder).getByRole('button', { name: 'Send', hidden: true }) as HTMLButtonElement).disabled).toBe(true);
    // The shimmer only where motion is welcome.
    expect(placeholder.querySelector('.animate-pulse')).toBeNull();
    expect(placeholder.querySelectorAll('.motion-safe\\:animate-pulse').length).toBeGreaterThan(4);
    expect(document.querySelector('aside')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByText('Still loading…')).toBeNull();
  });

  it('the small window\'s placeholder has no visitor panel', async () => {
    server = 'hang';
    wrap(client(), <WebsiteThread id="41" mini />);
    await screen.findByTestId('thread-placeholder');
    expect(document.querySelector('aside')).toBeNull();
  });

  it('slow: after 5 seconds says Still loading… in the middle, and Retry asks again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server = 'hang';
    wrap(client(), <WebsiteThread id="41" />);
    await screen.findByTestId('thread-placeholder');
    expect(screen.queryByText('Still loading…')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(SLOW_AFTER_MS);
    });
    const note = screen.getByText('Still loading…');
    expect(note.parentElement!.className).toContain('justify-center');
    const asked = vi.mocked(apiGet).mock.calls.filter(([p]) => p === PATH).length;
    server = 'answer';
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Chat with Anne Fernando' })).toBeTruthy();
    // The request that hung was let go, and asked again once.
    expect(vi.mocked(apiGet).mock.calls.filter(([p]) => p === PATH).length).toBe(asked + 1);
  });

  it('failed: says Couldn\'t load this conversation in the middle, and Retry asks again', async () => {
    server = 'fail';
    wrap(client(), <WebsiteThread id="41" />);
    const alert = await screen.findByRole('alert', {}, { timeout: 6_000 });
    expect(alert.textContent).toContain("Couldn't load this conversation");
    expect(alert.parentElement!.className).toContain('items-center');
    expect(alert.parentElement!.className).toContain('justify-center');
    server = 'answer';
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Chat with Anne Fernando' })).toBeTruthy();
  }, 10_000);

  it('a chat removed, or no longer mine to see, still says so', async () => {
    server = 'gone';
    wrap(client(), <WebsiteThread id="41" />);
    expect(await screen.findByText('This website chat is not available')).toBeTruthy();
  });
});

describe('the conversations opened lately stay in memory (#239)', () => {
  it('keeps the last few and lets go of older ones nothing shows', () => {
    const qc = client();
    const ids = Array.from({ length: RECENT_CONVERSATIONS + 2 }, (_, i) => String(100 + i));
    for (const id of ids) {
      qc.setQueryData(['website', 'conversation', id, { scope: 's' }], conversation());
      rememberOpened(qc, id);
    }
    const kept = ids.filter((id) => qc.getQueriesData({ queryKey: ['website', 'conversation', id] }).length > 0);
    expect(kept).toEqual(ids.slice(2));
    // Opening one again makes it the newest: the next to go is the one opened longest ago.
    rememberOpened(qc, ids[2]!);
    qc.setQueryData(['website', 'conversation', '999', { scope: 's' }], conversation());
    rememberOpened(qc, '999');
    expect(qc.getQueriesData({ queryKey: ['website', 'conversation', ids[2]!] })).toHaveLength(1);
    expect(qc.getQueriesData({ queryKey: ['website', 'conversation', ids[3]!] })).toHaveLength(0);
  });
});

const row = (over: Partial<WebsiteRow>): WebsiteRow => ({
  id: 1, widget: 'TechHub', widget_id: 1, site: 'techubiz.com', online: true, inactive: false, label: 'Visitor 1', visitor_name: 'Hasitha', email: null, country: null, browser: null,
  os: null, device: null, current_url: null, last_seen: null, status: 'open', is_offline: false, priority: 'normal', updated_at: ago(0), agent: null, assigned_to: null, started_at: null,
  last_visitor_at: null, waiting_since: null, at_risk: false, awaiting_reply: false, rating: null, is_starred: false, tags: null, ...over,
});
const drawRow = (r: WebsiteRow, extra: { typing?: boolean; active?: boolean; me?: number } = {}) => {
  render(<ConversationRow r={r} me={extra.me ?? 7} myName="Me" typing={extra.typing} active={!!extra.active} onOpen={vi.fn()} onMenu={vi.fn()} />);
  return screen.getByRole('button');
};
const PILLS = /^(Waiting .+|Unread|Closed|Awaiting reply|At risk|Offline|You|Participant|Visitor replied|Callback requested)$/;

describe('a row in the list (#239)', () => {
  it('waiting and unread: one pill, Waiting, amber; the unread count on the right', () => {
    const b = drawRow(row({ awaiting_reply: true, waiting_since: ago(4 * 60_000 + 10_000), unread: 3, is_offline: true }));
    expect(within(b).getAllByText(PILLS).map((p) => p.textContent)).toEqual(['Waiting 4m']);
    expect(within(b).getByText('Waiting 4m').getAttribute('data-tone')).toBe('amber');
    expect(within(b).getByLabelText('3 unread').textContent).toBe('3');
  });

  it('turns red past the response target: at risk, or past the site\'s red mark', () => {
    drawRow(row({ awaiting_reply: true, waiting_since: ago(4 * 60_000), at_risk: true }));
    expect(screen.getByText('Waiting 4m').getAttribute('data-tone')).toBe('red');
    cleanup();
    drawRow(row({ awaiting_reply: true, waiting_since: ago(11 * 60_000), wait_amber: 120, wait_red: 600 }));
    expect(screen.getByText('Waiting 11m').getAttribute('data-tone')).toBe('red');
  });

  it('unread only: Unread; neither: no pill at all', () => {
    let b = drawRow(row({ unread: 2 }));
    expect(within(b).getAllByText(PILLS).map((p) => p.textContent)).toEqual(['Unread']);
    cleanup();
    b = drawRow(row({}));
    expect(within(b).queryAllByText(PILLS)).toHaveLength(0);
  });

  it('online only as the avatar\'s dot: green on the site, grey once gone; no Offline badge, no "away"', () => {
    let b = drawRow(row({ online: true }));
    expect(b.querySelector('.bg-success')).toBeTruthy();
    expect(within(b).getByText('On the site now').className).toContain('sr-only');
    cleanup();
    b = drawRow(row({ online: false, is_offline: true }));
    expect(b.querySelector('.bg-success')).toBeNull();
    expect(b.querySelector('.bg-ink-3')).toBeTruthy();
    expect(b.querySelector('.bg-warning')).toBeNull();
    expect(within(b).queryByText('Offline')).toBeNull();
    expect(b.textContent).not.toMatch(/away/);
    expect(within(b).getByText('techubiz.com')).toBeTruthy();
  });

  it('typing: Typing… in the accent, and my photo on the right instead of a You tag', () => {
    const b = drawRow(row({ assigned_to: 7, agent: 'Me' }), { typing: true });
    expect(within(b).getByText('Typing…').className).toContain('text-primary');
    expect(within(b).queryByText('You')).toBeNull();
    expect(within(b).getByRole('img', { name: 'Assigned to you' })).toBeTruthy();
  });

  it('nobody has it: no faces; several in it: at most two and +N', () => {
    let b = drawRow(row({}));
    expect(within(b).queryByRole('img', { name: /Assigned|In this chat/ })).toBeNull();
    cleanup();
    b = drawRow(row({
      assigned_to: 9, agent: 'Nuwan',
      team: [
        { user_id: 9, name: 'Nuwan', avatar: null, role: 'owner' }, { user_id: 7, name: 'Me', avatar: null, role: 'participant' },
        { user_id: 4, name: 'Dilini', avatar: null, role: 'participant' }, { user_id: 5, name: 'Watcher', avatar: null, role: 'observer' },
      ],
    }));
    const faces = within(b).getByRole('img', { name: 'In this chat: Nuwan, Me, Dilini' });
    expect(faces.textContent).toContain('+1');
  });

  it('is 72px high, long names and previews cut with an ellipsis; the picked row keeps its bar', () => {
    const b = drawRow(row({ visitor_name: 'A very long visitor name that will not fit', last_message: { id: 1, body: 'A long message '.repeat(10), file: null, from: 'visitor', agent: null, at: ago(0) } }), { active: true });
    expect(b.className).toContain('h-[72px]');
    expect(within(b).getByText('A very long visitor name that will not fit').className).toContain('truncate');
    expect(within(b).getByText(/^A long message/).className).toContain('truncate');
    expect(b.className).toContain('bg-selection');
    expect(b.querySelector('.bg-primary.w-\\[3px\\]')).toBeTruthy();
  });
});

describe('shortWait', () => {
  it('says a wait as a pill carries it', () => {
    expect([shortWait(10), shortWait(4 * 60 + 59), shortWait(3600), shortWait(3900), shortWait(2 * 86_400)]).toEqual(['1m', '4m', '1h', '1h 5m', '2d']);
  });
});

// The empty pane (Select a conversation, centred, with today's stats) is checked with the workspace in website-inbox.test.tsx.
