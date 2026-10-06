// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Website chats: a conversation loads in place, and the lists' previews are plain and never blank
 * (worksuite-desktop#261).
 *
 * - Opening one not on this computer yet fills the pane with its placeholder — the header from the list row (name,
 *   where they are), grey bubbles, the composer disabled — never a small spinner at the pane's edge; "Still loading… ·
 *   Retry" after 5 seconds and "Couldn't load this conversation · Retry" on failure, centred, under that header.
 *   Closed, missed and offline chats, read back, do the same, and open at once from a copy saved here.
 * - A preview is plain words on one line: no Markdown marks, links as their words, lists run together.
 * - A row whose last message has no words says what it was: "📷 Photo", "📎 File: invoice.pdf", "★★★★★ Rated 5",
 *   "Chat closed", "Visitor left" — never a blank line.
 * - In the thread the same words are drawn formatted: bold, lists, links.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn(), hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/chat/Composer', () => ({ Composer: () => <div>The composer</div> }));
vi.mock('../../../src/modules/chat/window', () => ({ openWebsiteChatWindow: vi.fn(async () => undefined) }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: new URLSearchParams('view=website&website=41'), path: ['chat'], go: vi.fn(), active: true, openLink: vi.fn() }),
  useTabTitle: () => undefined,
  openWebLink: vi.fn(),
}));

import { ApiError, apiGet, request } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { hasMarkdown, markdownLine, markdownText } from '../../../src/core/markdown';
import { TEAM_CAPS, WEBSITE_CAPS } from '../../../src/modules/chat/kit/caps';
import { MessageList } from '../../../src/modules/chat/kit/MessageList';
import { fromWebsiteMessage } from '../../../src/modules/chat/kit/model';
import { fileLine, ratedLine, resetRecentlyOpened, type WebsiteConversation, type WebsiteMessage, type WebsiteRow } from '../../../src/modules/chat/website/api';
import { closedLine, ClosedDetail } from '../../../src/modules/chat/website/Closed';
import { ConversationRow } from '../../../src/modules/chat/website/ConversationRow';
import { MissedDetail, type Missed } from '../../../src/modules/chat/website/Missed';
import { OfflineDetail, OfflineRow, type OfflineEnquiry } from '../../../src/modules/chat/website/Offline';
import { rowPreview } from '../../../src/modules/chat/website/rowParts';
import { SLOW_AFTER_MS } from '../../../src/modules/chat/website/ThreadPlaceholder';
import { WebsiteThread } from '../../../src/modules/chat/website/WebsiteThread';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const BOLD = 'You can open Settings by pressing **Windows + I**.\n\n1. Go to [Windows Update](https://support.microsoft.com/update)\n2. Click *Check for updates*';

const message = (o: Partial<WebsiteMessage> & { id: number }): WebsiteMessage => ({ body: null, from: 'visitor', agent: null, at: ago(60_000), file: null, ...o });
const conversation = (messages: WebsiteMessage[] = [message({ id: 1, body: 'Is the licence yearly?' })]): WebsiteConversation => ({
  conversation: { id: 41, widget: 'TechHub', website: 'techubiz.com', status: 'open', is_offline: false, inactive: false, assigned_to: null, visitor_typing: false, started_at: ago(600_000), closed_at: null, rating: null, rating_comment: null, tags: null, is_starred: false },
  visitor: {
    id: 9, label: 'Visitor 4F2A', name: 'Anne Fernando', email: 'anne@acme.lk', phone: null, company: null, browser: 'Chrome', os: 'Windows', device: 'desktop', language: null, timezone: null,
    country: 'LK', city: 'Colombo', landing_page: null, current_url: 'https://techubiz.com/shop', current_title: null, referrer: null, utm_source: null, utm_campaign: null,
    visits: 1, first_seen: null, last_seen: ago(5_000), is_blocked: false,
  },
  messages,
  journey: [],
  history: [],
  can: { view: true, reply: true, manage: false },
});

const row = (over: Partial<WebsiteRow> = {}): WebsiteRow => ({
  id: 41, widget: 'TechHub', widget_id: 1, site: 'techubiz.com', online: true, inactive: false, label: 'Visitor 4F2A', visitor_name: 'Anne Fernando', email: null, country: null, browser: null,
  os: null, device: null, current_url: 'https://techubiz.com/pricing', last_seen: null, status: 'open', is_offline: false, priority: 'normal', updated_at: ago(0), agent: null, assigned_to: null,
  started_at: null, last_visitor_at: null, waiting_since: null, at_risk: false, awaiting_reply: false, rating: null, is_starred: false, tags: null, ...over,
});

const PATH = '/api/chat/widget-admin/conversations/41';
/** What the server does with the conversation: answer, never answer, or fail. */
let server: 'answer' | 'hang' | 'fail' = 'answer';
let answer: WebsiteConversation = conversation();
/** The copies saved on this computer, by `?review=1` or not. */
let saved: { open: unknown; review: unknown } = { open: null, review: null };

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  server = 'answer';
  answer = conversation();
  saved = { open: null, review: null };
  resetRecentlyOpened();
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === PATH) {
      if (server === 'hang') return new Promise(() => undefined);
      if (server === 'fail') throw new ApiError(500, 'The server had a problem.', null);
      return answer;
    }
    if (path === '/api/chat/widget-admin/canned') return { responses: [] };
    if (path === '/api/chat/widget-admin/agents') return { agents: [] };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(request).mockReset().mockImplementation((async (_method: string, path: string, opts?: { query?: Record<string, string>; headers?: Record<string, string> }) => {
    const copy = opts?.query?.review === '1' ? saved.review : saved.open;
    if (opts?.headers?.['X-WS-Local-Read'] === '1' && path === PATH && copy) return { data: copy };
    throw new ApiError(404, 'No saved conversation.', null);
  }) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  app.set({ auth: null } as never);
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (ui: ReactNode, qc = client()) => render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
/** The small spinner the pane used to show at its edge: the shared Spinner's "Loading…" words. */
const spinner = () => screen.queryByText('Loading…');

describe('opening a conversation loads in place (#261)', () => {
  it('not here yet: the placeholder fills the pane under the header the list row gives it, with no spinner', async () => {
    server = 'hang';
    wrap(<WebsiteThread id="41" row={row({ company: 'Acme Ltd', current_url: 'https://techubiz.com/shop' })} />);
    const placeholder = await screen.findByTestId('thread-placeholder');
    expect(spinner()).toBeNull();
    // The pane, filled: its own box takes the whole height and width.
    const pane = screen.getByRole('status', { name: 'Loading the conversation' });
    expect(pane.className).toContain('h-full');
    expect(pane.className).toContain('flex-1');
    // The header from the row: the visitor, and where they are.
    const head = within(placeholder).getByTestId('pane-head');
    expect(within(head).getByText('Anne Fernando · Acme Ltd')).toBeTruthy();
    expect(within(head).getByText('On the site now · reading /shop')).toBeTruthy();
    // Grey bubbles both sides, and the composer there but disabled.
    const bubbles = placeholder.querySelectorAll('[data-side]');
    expect(bubbles.length).toBeGreaterThanOrEqual(4);
    expect(bubbles.length).toBeLessThanOrEqual(6);
    expect((within(placeholder).getByRole('textbox', { hidden: true }) as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('a closed chat\'s header says so, and one without a row keeps the grey header', async () => {
    server = 'hang';
    const first = wrap(<WebsiteThread id="41" row={row({ status: 'closed', online: false })} />);
    const head = await screen.findByTestId('pane-head');
    expect(head.textContent).toContain('Anne Fernando');
    expect(head.textContent).toContain('Closed');
    first.unmount();
    wrap(<WebsiteThread id="41" />);
    const grey = await screen.findByTestId('pane-head');
    expect(grey.textContent).toBe('');
    expect(grey.querySelectorAll('.motion-safe\\:animate-pulse').length).toBeGreaterThanOrEqual(2);
  });

  it('slow: "Still loading… · Retry" in the middle after 5 seconds, the header still there', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server = 'hang';
    wrap(<WebsiteThread id="41" row={row()} />);
    await screen.findByTestId('thread-placeholder');
    await act(async () => {
      vi.advanceTimersByTime(SLOW_AFTER_MS);
    });
    const note = screen.getByText('Still loading…');
    expect(note.textContent).toBe('Still loading…·Retry');
    expect(note.parentElement!.className).toMatch(/absolute inset-0 flex items-center justify-center/);
    expect(within(screen.getByTestId('pane-head')).getByText('Anne Fernando')).toBeTruthy();
    server = 'answer';
    fireEvent.click(within(note).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Chat with Anne Fernando' })).toBeTruthy();
  });

  it('failed: "Couldn\'t load this conversation · Retry" in the middle, under the row\'s header', async () => {
    server = 'fail';
    wrap(<WebsiteThread id="41" row={row()} />);
    const alert = await screen.findByRole('alert', {}, { timeout: 6_000 });
    expect(alert.textContent).toBe("Couldn't load this conversation·Retry");
    expect(alert.parentElement!.className).toMatch(/absolute inset-0 flex items-center justify-center/);
    expect(within(screen.getByTestId('pane-head')).getByText('Anne Fernando')).toBeTruthy();
    expect(spinner()).toBeNull();
    server = 'answer';
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Chat with Anne Fernando' })).toBeTruthy();
  }, 10_000);

  it('stored here: the conversation at once, header, messages and the visitor panel, while the server is asked', async () => {
    saved.open = conversation();
    server = 'hang';
    wrap(<WebsiteThread id="41" row={row()} />);
    const pane = await screen.findByRole('region', { name: 'Chat with Anne Fernando' });
    expect(within(pane).getByText('Is the licence yearly?')).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Visitor details' })).toBeTruthy();
    expect(screen.queryByTestId('thread-placeholder')).toBeNull();
    expect(spinner()).toBeNull();
  });
});

const CLOSED = row({ status: 'closed', online: false, visitor_name: 'Kamal F.', closed_reason: 'visitor', closed_at: ago(10 * 60_000) });
const MISSED: Missed = { id: 41, widget: 'TechHub', visitor: 'Ruwan', email: null, phone: null, place: null, missed_at: ago(60_000), last_visitor_at: ago(60_000), online: false, left_at: null };
const ENQUIRY: OfflineEnquiry = {
  id: 41, widget_id: 1, widget: 'TechHub', visitor: 'Malini', company: 'Lanka Traders', email: 'malini@lt.lk', phone: null, place: null, url: null, status: 'pending', received_at: ago(60_000),
  last_visitor_at: null, preview: 'Do you deliver?', reason: 'hours', hours: null, online: false, left_at: null, replied: null, assigned_to: null, agent: null,
};

describe('closed, missed and offline chats load in place too (#261)', () => {
  const details: Array<[string, () => ReactNode, string]> = [
    ['closed', () => <ClosedDetail id="41" row={CLOSED} onReopened={vi.fn()} />, 'Kamal F.'],
    ['missed', () => <MissedDetail id="41" m={MISSED} onOpenChat={vi.fn()} />, 'Ruwan'],
    ['offline', () => <OfflineDetail id="41" e={ENQUIRY} me={7} onOpenChat={vi.fn()} onClosed={vi.fn()} />, 'Malini · Lanka Traders'],
  ];

  it.each(details)('%s: the placeholder fills the pane under the row\'s header, with no spinner and no composer', async (_kind, ui, name) => {
    server = 'hang';
    wrap(ui());
    const placeholder = await screen.findByTestId('thread-placeholder');
    expect(spinner()).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading the conversation' }).className).toContain('h-full');
    expect(within(screen.getByTestId('pane-head')).getByText(name)).toBeTruthy();
    expect(placeholder.querySelectorAll('[data-side]').length).toBeGreaterThanOrEqual(4);
    // Read back, not answered here: no message box in its placeholder.
    expect(within(placeholder).queryByRole('textbox', { hidden: true })).toBeNull();
  });

  it.each(details)('%s: a failure is said in the middle, with Retry', async (_kind, ui, name) => {
    server = 'fail';
    wrap(ui());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Couldn't load this conversation·Retry");
    expect(alert.parentElement!.className).toContain('justify-center');
    expect(within(screen.getByTestId('pane-head')).getByText(name)).toBeTruthy();
    server = 'answer';
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: /Transcript|Their message/ })).toBeTruthy();
  });

  it('a closed chat\'s header says how it ended while it loads', async () => {
    server = 'hang';
    wrap(<ClosedDetail id="41" row={CLOSED} onReopened={vi.fn()} />);
    const head = await screen.findByTestId('pane-head');
    expect(head.textContent).toMatch(/Ended by the visitor at .* · techubiz\.com/);
  });

  it('read here before: shown at once from the copy saved on this computer, while the server is asked', async () => {
    saved.review = conversation();
    server = 'hang';
    wrap(<ClosedDetail id="41" row={CLOSED} onReopened={vi.fn()} />);
    const transcript = await screen.findByRole('region', { name: 'Transcript' });
    expect(within(transcript).getByText('Is the licence yearly?')).toBeTruthy();
    expect(screen.queryByTestId('thread-placeholder')).toBeNull();
    // The review copy, not the open thread's: reading it back must not join the chat.
    expect(vi.mocked(request)).toHaveBeenCalledWith('GET', PATH, expect.objectContaining({ query: { review: '1' }, headers: { 'X-WS-Local-Read': '1' } }));
  });
});

const line = (r: WebsiteRow, opts: { quote?: boolean } = {}) => rowPreview(r, { me: 7, myName: 'Me', ...opts });
const said = (over: Partial<NonNullable<WebsiteRow['last_message']>>) => ({ id: 9, body: null, file: null, from: 'visitor' as const, agent: null, at: ago(0), ...over });

describe('list previews are plain words on one line (#261)', () => {
  it('strips Markdown: bold as its words, links as their words, a list run together', () => {
    expect(line(row({ last_message: said({ body: BOLD, from: 'agent', agent: 'Samali' }) }))).toBe('Samali: You can open Settings by pressing Windows + I. 1. Go to Windows Update 2. Click Check for updates');
    expect(line(row({ last_message: said({ body: '- one\n- **two**\n\nthree' }) }))).toBe('• one • two three');
    // The table quotes the visitor's own words, without their marks.
    expect(line(row({ last_message: said({ body: 'Is it **really** free?' }) }), { quote: true })).toBe('“Is it really free?”');
    // Words without Markdown stay as they are, on one line.
    expect(line(row({ last_message: said({ body: 'Hello   there\nAnyone?' }) }))).toBe('Hello there Anyone?');
    // A ringing chat's words too.
    expect(rowPreview(row(), { me: 7, myName: 'Me', ring: { preview: '**Help** please' } as never })).toBe('“Help please”');
  });

  it('the row draws it on one line, with no marks left', () => {
    render(<ConversationRow r={row({ last_message: said({ body: BOLD, from: 'bot' }) })} me={7} myName="Me" active={false} onOpen={vi.fn()} onMenu={vi.fn()} />);
    const preview = screen.getByText(/^Bot: You can open Settings/);
    expect(preview.textContent).not.toMatch(/\*\*|\]\(|\n/);
    expect(preview.className).toContain('truncate');
  });

  it('a closed chat\'s line is plain too, and never empty', () => {
    expect(closedLine({ closed_reason: 'agent', closed_by: 'Nuwan Silva', subject: null, last_message: said({ body: 'Fixed by pressing **Windows + I**' }), email: null })).toBe('Fixed by pressing Windows + I · Nuwan');
    expect(closedLine({ closed_reason: 'agent', closed_by: null, subject: null, last_message: said({ file: 'invoice.pdf' }), email: null })).toBe('📎 File: invoice.pdf');
    expect(closedLine({ closed_reason: null, closed_by: null, subject: null, last_message: null, email: null })).toBe('Chat closed');
  });

  it('an offline enquiry\'s line is plain, and says so when nothing was left', () => {
    render(<OfflineRow e={{ ...ENQUIRY, preview: 'Do you **deliver** to Kandy?' }} active={false} onOpen={vi.fn()} />);
    expect(screen.getByText('“Do you deliver to Kandy?”')).toBeTruthy();
    cleanup();
    render(<OfflineRow e={{ ...ENQUIRY, preview: null, email: null, phone: null }} active={false} onOpen={vi.fn()} />);
    expect(screen.getByText('No message')).toBeTruthy();
  });
});

describe('a last message without words says what it was (#261)', () => {
  it('a picture, a file', () => {
    expect(line(row({ last_message: said({ file: 'Photo – 4 Oct 2026, 11:31.jpg' }) }))).toBe('📷 Photo');
    // An empty body is no words either.
    expect(line(row({ last_message: said({ body: '', file: 'scan.PNG' }) }))).toBe('📷 Photo');
    expect(line(row({ last_message: said({ file: 'invoice.pdf', from: 'agent', agent: 'Nimal Silva' }) }))).toBe('Nimal Silva: 📎 File: invoice.pdf');
    expect(line(row({ last_message: said({ body: '  ', file: 'quote.docx', from: 'agent', agent: 'Me' }) }))).toBe('You: 📎 File: quote.docx');
    expect([fileLine('a.webp'), fileLine('b.HEIC'), fileLine('c.zip')]).toEqual(['📷 Photo', '📷 Photo', '📎 File: c.zip']);
  });

  it('a rating, the chat closing, the visitor leaving', () => {
    expect(line(row({ status: 'closed', online: false, rating: 5 }))).toBe('★★★★★ Rated 5');
    expect(line(row({ status: 'closed', online: false, rating: 4, last_message: said({ body: '' }) }))).toBe('★★★★☆ Rated 4');
    expect(line(row({ status: 'closed', online: false, closed_reason: 'visitor' }))).toBe('Visitor left');
    expect(line(row({ status: 'closed', online: false, closed_reason: 'agent', agent: 'Nuwan' }))).toBe('Chat closed');
    expect(line(row({ online: false, last_message: said({}) }))).toBe('Visitor left');
    expect(ratedLine(3)).toBe('★★★☆☆ Rated 3');
  });

  it('something the row cannot name, or nothing at all: a label, never a blank line', () => {
    expect(line(row({ current_url: null, last_message: said({}) }))).toBe('💬 Message');
    expect(line(row({ current_url: null }))).toBe('No messages yet');
    // What the row knew before still comes first.
    expect(line(row({ current_url: 'https://techubiz.com/pricing' }))).toBe('Reading /pricing');
    expect(line(row({ online: false, agent: 'Me', assigned_to: 7 }))).toBe('With you');
    expect(line(row({ online: false, email: 'a@b.lk' }))).toBe('a@b.lk');
    // Every shape a row can take has a line.
    for (const status of ['open', 'closed'])
      for (const online of [true, false])
        for (const last of [null, said({}), said({ body: '' }), said({ body: '**' }), said({ file: 'x.png' })])
          for (const rating of [null, 2])
            for (const closed_reason of [null, 'visitor', 'idle'] as const) expect(line(row({ status, online, last_message: last, rating, closed_reason, current_url: null })).trim()).not.toBe('');
  });
});

describe('the thread draws the same words formatted (#261)', () => {
  it('bold, a list and a link in a website chat; plain words exactly as before', async () => {
    answer = conversation([
      message({ id: 1, body: 'How do I check for updates?' }),
      message({ id: 2, from: 'agent', agent: 'Samali', agent_id: 4, body: BOLD, at: ago(30_000) }),
    ]);
    wrap(<WebsiteThread id="41" row={row()} />);
    const pane = await screen.findByRole('region', { name: 'Chat with Anne Fernando' });
    const strong = within(pane).getByText('Windows + I');
    expect(strong.tagName).toBe('STRONG');
    const items = pane.querySelectorAll('ol > li');
    expect([...items].map((li) => li.textContent)).toEqual(['Go to Windows Update', 'Click Check for updates']);
    const link = within(pane).getByRole('link', { name: 'Windows Update' });
    expect(link.getAttribute('href')).toBe('https://support.microsoft.com/update');
    expect(within(pane).getByText('Check for updates').tagName).toBe('EM');
    expect(pane.textContent).not.toMatch(/\*\*|\]\(/);
    // The visitor's plain question is drawn as it always was: no paragraphs, no list.
    const plain = within(pane).getByText('How do I check for updates?');
    expect(plain.closest('[data-bubble-body]')!.querySelector('p, ul, ol')).toBeNull();
  });

  it('only where the channel formats: Team Chat\'s bubbles keep the words as written', () => {
    const k = fromWebsiteMessage(message({ id: 3, body: 'Use **this** one' }), { me: null, visitor: 'Anne', canReply: false });
    const { container, unmount } = wrap(<MessageList items={[k]} caps={TEAM_CAPS} look="page" handlers={{}} />);
    expect(container.textContent).toContain('Use **this** one');
    unmount();
    const site = wrap(<MessageList items={[k]} caps={WEBSITE_CAPS} look="page" handlers={{}} />);
    expect(site.container.querySelector('strong')?.textContent).toBe('this');
  });

  it('on my own indigo bubble a link stays white; on a colleague\'s it is indigo', async () => {
    app.set({ auth: { user: { id: '7' } } } as never);
    answer = conversation([
      message({ id: 2, from: 'agent', agent: 'Me', agent_id: 7, body: 'See [the guide](https://techubiz.com/guide)' }),
      message({ id: 3, from: 'agent', agent: 'Nuwan', agent_id: 4, body: 'Or [the video](https://techubiz.com/video)', at: ago(30_000) }),
    ]);
    wrap(<WebsiteThread id="41" row={row()} />);
    expect((await screen.findByRole('link', { name: 'the guide' })).className).toContain('text-white');
    expect(screen.getByRole('link', { name: 'the video' }).className).toContain('text-primary');
  });
});

describe('Markdown for a preview, and for a visitor who cannot see it (#261)', () => {
  it('knows Markdown from plain words', () => {
    expect(hasMarkdown('Hello there, 5 * 3 = 15')).toBe(false);
    expect(hasMarkdown('Price: $5 [approx]')).toBe(false);
    expect(hasMarkdown('Press **Windows**')).toBe(true);
    expect(hasMarkdown('- one\n- two')).toBe(true);
    expect(hasMarkdown('See [docs](https://x.lk)')).toBe(true);
  });

  it('one line for a preview', () => {
    expect(markdownLine(BOLD)).toBe('You can open Settings by pressing Windows + I. 1. Go to Windows Update 2. Click Check for updates');
    expect(markdownLine('# Heading\n> quoted `code`')).toBe('Heading quoted code');
    expect(markdownLine('')).toBe('');
  });

  it('plain text for a visitor: lines and list items kept, a link\'s address after its words', () => {
    expect(markdownText(BOLD)).toBe('You can open Settings by pressing Windows + I.\n\n1. Go to Windows Update (https://support.microsoft.com/update)\n2. Click Check for updates');
    expect(markdownText('- **one**\n  - two\n- [https://x.lk](https://x.lk)')).toBe('• one\n  • two\n• https://x.lk/');
    // Line by line, so the lines stay where they were: a heading's and a quote's sign go, code stays as written.
    expect(markdownText('# Steps\n> Note: **read** this\n```\nkeep **this**\n```\n---\n3) Done')).toBe('Steps\nNote: read this\nkeep **this**\n\n3) Done');
    // Words without Markdown are sent exactly as typed, blank lines and all.
    const typed = 'Hi Anne,\n\n  Thanks for waiting.\n';
    expect(markdownText(typed)).toBe(typed);
  });
});
