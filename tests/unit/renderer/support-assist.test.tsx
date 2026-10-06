// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import { READY, serveWith, show, ticket, type Call } from './support-fixtures';

/**
 * The KB & AI side panel, D-10 (desktop T28; FR-KB-06/08, FR-AI-01…03, AC-17): ⌘J opens it in a ticket's tab; articles
 * for the ticket or a search, inserted as a link (public only) or text into the composer; the thread's summary; a
 * suggested reply in a tone, put into the composer as a draft; detected fields applied through PATCH with the
 * version; the composer's writing assistant; `503 AI_UNAVAILABLE` said quietly; nothing sent by itself. Also the
 * composer's draft kept on the server, and the palette's knowledge results.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't2', route: '/support/ticket/1284', active: true, path: ['support', 'ticket', '1284'], query: new URLSearchParams(), go: vi.fn(), navigate: vi.fn(), openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));

const { ApiError, request } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { default: SupportPage } = await import('../../../src/modules/support/SupportPage');
const { resetApiFamily } = await import('../../../src/modules/support/api');
const { classifyChanges, kbInsertText, scoreLabel } = await import('../../../src/modules/support/Assist');
const { insertAt, SERVER_DRAFT_MS } = await import('../../../src/modules/support/Composer');
const { articleSubtitle, searchArticles, ticketCommands, ticketInFront } = await import('../../../src/modules/support/palette');

const ARTICLES = {
  articles: [
    { id: 31, title: 'Fix 0xC004C003 after M365 renewal', excerpt: 'After a renewal, seats can stay unassigned.', visibility: 'public', language: 'en', url: 'https://help.cfx.lk/kb/fix-0xc004c003', score: 0.92 },
    { id: 32, title: 'Reassign M365 licences in admin centre', excerpt: 'Internal steps.', visibility: 'internal', language: 'en', url: null, score: 0.81 },
  ],
};

let log: Call[];
let served: Record<string, unknown>;
let drafts: Record<string, unknown>;
function serve(over: Record<string, unknown> = {}) {
  served = {
    'GET /api/support/v1/meta': { statuses: [], priorities: [], types: [], sources: [], views: [], sorts: [], organizations: [], departments: [], teams: [], categories: [], tags: [], can: {} },
    'GET /api/support/v1/tickets/1284': show(1284, { ticket: ticket(1284, { reference: 'CFX-001284', language: 'en', priority: 'high' }) }),
    'GET /api/support/v1/tickets/1284/links': { links: [] },
    'GET /api/support/v1/tickets/1284/presence': { present: [] },
    'POST /api/support/v1/tickets/1284/presence': { present: [] },
    'POST /api/support/v1/tickets/1284/read': {},
    'GET /api/support/v1/tickets/1284/draft': { draft: null },
    'PUT /api/support/v1/tickets/1284/draft': { draft: null },
    'GET /api/support/v1/tickets/1284/kb': (q: Record<string, unknown>) => (q.q ? { articles: [ARTICLES.articles[0]] } : ARTICLES),
    'POST /api/support/v1/tickets/1284/kb/insert': (_q: unknown, b: { article_id: number; mode: string }) =>
      b.article_id === 31 ? { url: 'https://help.cfx.lk/kb/fix-0xc004c003', text: '1. Open the admin centre.\n2. Assign the seats.', title: 'Fix 0xC004C003 after M365 renewal' } : { url: null, text: 'Internal steps in full.', title: 'Reassign M365 licences' },
    'POST /api/support/v1/tickets/1284/ai/summary': (_q: unknown, b: { refresh?: boolean }) => ({ text: b?.refresh ? '• Fresh summary' : '• 25 seats renewed; 3 users get 0xC004C003', model: 'm', cached: !b?.refresh, at: '2026-10-04T09:43:00+05:30' }),
    'POST /api/support/v1/tickets/1284/ai/reply': { draft: 'Hi Saman, I have re-assigned the 3 seats.', sources: [{ id: 31, title: 'Fix 0xC004C003 after M365 renewal', url: 'https://help.cfx.lk/kb/fix-0xc004c003' }], model: 'm' },
    'POST /api/support/v1/tickets/1284/ai/classify': { category_id: 9, category: 'M365 · Activation', priority: 'urgent', language: 'en', sentiment: 'negative', model: 'm' },
    'PATCH /api/support/v1/tickets/1284': { ticket: ticket(1284, { version: 8 }) },
    'POST /api/support/v1/ai/rewrite': (_q: unknown, b: { text: string; mode: string }) => ({ text: `${b.mode}: ${b.text}`, model: 'm' }),
    ...over,
  };
  log = serveWith(request, served);
}
const calls = (method: string, path: string) => log.filter((c) => c.method === method && c.path === path);
const renderTab = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupportPage tabId="t2" route="/support/ticket/1284" active />
    </QueryClientProvider>,
  );
};
const composer = () => screen.getByRole('textbox', { name: /^(Internal note|Reply to Requester 1284)$/ });
const panel = () => screen.getByRole('complementary', { name: 'KB & AI' });

beforeEach(() => {
  resetApiFamily();
  vi.mocked(toast).mockReset();
  drafts = {};
  vi.mocked(call).mockImplementation((async (channel: string, input: { module?: string; context?: string; content?: unknown }) => {
    if (channel === 'offline:getDraft') return drafts[`${input.module}:${input.context}`] ?? null;
    if (channel === 'offline:saveDraft') drafts[`${input.module}:${input.context}`] = { content: input.content };
    return undefined;
  }) as never);
  serve();
  app.set(READY as never);
  try {
    localStorage.clear();
  } catch {
    /* none */
  }
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the pieces', () => {
  it('says a score, what an insert puts in, and what a classification would change', () => {
    expect(scoreLabel(0.92)).toBe('92%');
    expect(scoreLabel(74)).toBe('74%');
    expect(scoreLabel(null)).toBeNull();
    expect(kbInsertText('link', { url: 'https://h/kb/1', text: 'x', title: 'Fix it' })).toBe('Fix it: https://h/kb/1');
    expect(kbInsertText('text', { url: null, text: '  Steps  ', title: 'Fix it' })).toBe('Steps');
    const t = ticket(1, { priority: 'urgent', category: { id: 9, name: 'M365' }, language: 'si' }) as never;
    const c = { category_id: 9, category: 'M365', priority: 'high' as const, language: 'en', sentiment: 'angry', model: null };
    expect(classifyChanges(c, t).map((x) => [x.key, x.changes])).toEqual([
      ['priority', { priority: 'high' }],
      ['language', { language: 'en' }],
    ]);
  });

  it('puts inserted text at the caret, on a line of its own when it is a block', () => {
    expect(insertAt('Hi Saman,', 9, 'Steps:\n1. Go')).toEqual({ text: 'Hi Saman,\n\nSteps:\n1. Go', caret: 23 });
    expect(insertAt('See  thanks', 4, 'https://h/kb/1')).toEqual({ text: 'See https://h/kb/1 thanks', caret: 18 });
    expect(insertAt('See', 3, 'link')).toEqual({ text: 'See link', caret: 8 });
  });

  it('adds the KB commands for a ticket that takes replies', () => {
    const ids = ticketCommands({ id: 1, reference: 'CFX-1', take: null, resolve: null, canned: null, assist: vi.fn(), kbLink: vi.fn() }).map((c) => c.id);
    expect(ids).toEqual(['support-kb-link', 'support-assist', 'support-quick', 'support-copy-link']);
    expect(articleSubtitle({ id: 1, title: 't', excerpt: null, visibility: 'public', language: 'en', url: null }, 'CFX-1')).toBe('Public · EN · Insert link into CFX-1');
    expect(articleSubtitle({ id: 1, title: 't', excerpt: null, visibility: 'internal', language: null, url: null }, null)).toBe('Internal · Knowledge base');
  });
});

describe('the panel in a ticket', () => {
  it('opens with ⌘J (Ctrl+J), before the shell’s assistant, and closes again', async () => {
    renderTab();
    await screen.findByRole('heading', { name: 'Subject 1284' });
    const shell = vi.fn();
    window.addEventListener('keydown', shell);
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(await screen.findByRole('complementary', { name: 'KB & AI' })).toBeTruthy();
    expect(shell).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'KB & AI' })).toBeNull());
    window.removeEventListener('keydown', shell);
  });

  it('lists the ticket’s articles, searches, and inserts a link or the text into the composer', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /KB & AI/ }));
    const list = await within(panel()).findByRole('list', { name: 'Articles' });
    expect(within(list).getByText('92%')).toBeTruthy();
    // An internal article has no link to send.
    const internal = within(list).getByText('Reassign M365 licences in admin centre').closest('li')!;
    expect((within(internal).getByRole('button', { name: 'Insert link' }) as HTMLButtonElement).disabled).toBe(true);
    const pub = within(list).getByText('Fix 0xC004C003 after M365 renewal').closest('li')!;
    fireEvent.click(within(pub).getByRole('button', { name: 'Insert link' }));
    await waitFor(() => expect((composer() as HTMLTextAreaElement).value).toBe('Fix 0xC004C003 after M365 renewal: https://help.cfx.lk/kb/fix-0xc004c003'));
    expect(calls('POST', '/api/support/v1/tickets/1284/kb/insert')[0]!.body).toEqual({ article_id: 31, mode: 'link' });
    fireEvent.click(within(internal).getByRole('button', { name: 'Insert text' }));
    await waitFor(() => expect((composer() as HTMLTextAreaElement).value).toContain('Internal steps in full.'));
    // Nothing went out.
    expect(calls('POST', '/api/support/v1/tickets/1284/messages')).toHaveLength(0);

    fireEvent.change(within(panel()).getByLabelText('Search the knowledge base'), { target: { value: 'renewal' } });
    await waitFor(() => expect(calls('GET', '/api/support/v1/tickets/1284/kb').some((c) => c.query?.q === 'renewal')).toBe(true));
    expect(await within(panel()).findByText('Results for “renewal”')).toBeTruthy();
  });

  it('summarises the thread, refreshes on request, and puts a suggested reply in as a draft', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /KB & AI/ }));
    fireEvent.click(within(panel()).getByRole('tab', { name: 'AI assist' }));
    expect(await within(panel()).findByText('• 25 seats renewed; 3 users get 0xC004C003')).toBeTruthy();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Summarise again' }));
    expect(await within(panel()).findByText('• Fresh summary')).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(panel()).getByRole('checkbox', { name: 'Use internal notes' }));
    });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Suggest a reply' }));
    const draft = (await within(panel()).findByRole('textbox', { name: 'Suggested reply' })) as HTMLTextAreaElement;
    expect(draft.value).toBe('Hi Saman, I have re-assigned the 3 seats.');
    expect(calls('POST', '/api/support/v1/tickets/1284/ai/reply')[0]!.body).toEqual({ tone: 'friendly', include_notes: true });
    expect(within(panel()).getByText('Fix 0xC004C003 after M365 renewal')).toBeTruthy();
    fireEvent.change(draft, { target: { value: 'Hi Saman, done.' } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Insert into composer' }));
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Reply to Requester 1284' }) as HTMLTextAreaElement).value).toBe('Hi Saman, done.'));
    expect(screen.getByRole('radio', { name: 'Reply to requester' }).getAttribute('aria-checked')).toBe('true');
    expect(calls('POST', '/api/support/v1/tickets/1284/messages')).toHaveLength(0);
  });

  it('applies a detected field through PATCH with the version shown', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /KB & AI/ }));
    fireEvent.click(within(panel()).getByRole('tab', { name: 'AI assist' }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Detect' }));
    const section = await within(panel()).findByRole('region', { name: 'Detected' });
    expect(await within(section).findByText('M365 · Activation')).toBeTruthy();
    expect(within(section).getByText('Negative')).toBeTruthy();
    // The language is already English: nothing to apply for it.
    expect(within(section).queryByText('English')).toBeNull();
    fireEvent.click(within(section).getAllByRole('button', { name: 'Apply' })[1]!);
    await waitFor(() => expect(calls('PATCH', '/api/support/v1/tickets/1284')[0]?.body).toEqual({ priority: 'urgent', version: 7 }));
  });

  it('says quietly when the assistant is away, and the rest works', async () => {
    serve({ 'POST /api/support/v1/tickets/1284/ai/summary': new ApiError(503, 'The AI assistant could not answer just now.', 'AI_UNAVAILABLE') });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /KB & AI/ }));
    fireEvent.click(within(panel()).getByRole('tab', { name: 'AI assist' }));
    expect((await within(panel()).findByRole('alert')).textContent).toMatch(/not available just now/);
    fireEvent.click(within(panel()).getByRole('tab', { name: 'Knowledge' }));
    expect(await within(panel()).findByRole('list', { name: 'Articles' })).toBeTruthy();
  });

  it('rewrites the composer’s text only when asked, and replaces it only on Replace', async () => {
    renderTab();
    await screen.findByRole('heading', { name: 'Subject 1284' });
    fireEvent.change(composer(), { target: { value: 'pls sign out and in' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Writing assistant' }));
    fireEvent.click(await within(await screen.findByRole('listbox', { name: 'Writing assistant' })).findByRole('option', { name: 'More professional' }));
    const box = await screen.findByRole('region', { name: 'Writing assistant' });
    expect(await within(box).findByText('professional: pls sign out and in')).toBeTruthy();
    expect((composer() as HTMLTextAreaElement).value).toBe('pls sign out and in');
    fireEvent.click(within(box).getByRole('button', { name: 'Replace my text' }));
    expect((composer() as HTMLTextAreaElement).value).toBe('professional: pls sign out and in');
  });
});

describe('the draft on the server (FR-CRT-10)', () => {
  it('offers the server’s draft when this computer has none, and keeps it in step after typing stops', async () => {
    serve({ 'GET /api/support/v1/tickets/1284/draft': { draft: { mode: 'reply', body: 'Started on my phone', body_html: null, cc: [], updated_at: null } } });
    renderTab();
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Reply to Requester 1284' }) as HTMLTextAreaElement).value).toBe('Started on my phone'));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(composer(), { target: { value: 'Started on my phone, finished here' } });
    expect(calls('PUT', '/api/support/v1/tickets/1284/draft')).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(SERVER_DRAFT_MS + 50);
    });
    await waitFor(() => expect(calls('PUT', '/api/support/v1/tickets/1284/draft').at(-1)?.body).toEqual({ mode: 'reply', body: 'Started on my phone, finished here' }));
  });

  it('keeps this computer’s draft over the server’s', async () => {
    drafts['support:ticket:1284'] = { content: { body: 'Mine here', mode: 'note' } };
    serve({ 'GET /api/support/v1/tickets/1284/draft': { draft: { mode: 'reply', body: 'From the server', body_html: null, cc: [], updated_at: null } } });
    renderTab();
    await waitFor(() => expect((composer() as HTMLTextAreaElement).value).toBe('Mine here'));
    await waitFor(() => expect(calls('GET', '/api/support/v1/tickets/1284/draft')).toHaveLength(1));
    expect((composer() as HTMLTextAreaElement).value).toBe('Mine here');
  });
});

describe('knowledge in the palette', () => {
  it('searches the ticket in front’s articles, or published ones', async () => {
    expect(ticketInFront()).toBeNull();
    serve({ 'GET /api/support/v1/kb/articles': { articles: [{ id: 5, title: 'VPN setup', visibility: 'public', language: 'en' }] } });
    const r = await searchArticles('vpn');
    expect(r).toEqual({ ticket: null, articles: [{ id: 5, title: 'VPN setup', excerpt: null, visibility: 'public', language: 'en', url: null }] });
    expect(calls('GET', '/api/support/v1/kb/articles')[0]!.query).toEqual({ q: 'vpn', status: 'published', per: 5 });
    serve({ 'GET /api/support/v1/kb/articles': new ApiError(403, 'No', null) });
    expect(await searchArticles('vpn')).toEqual({ ticket: null, articles: [] });
    expect(await searchArticles('v')).toEqual({ ticket: null, articles: [] });
  });
});
