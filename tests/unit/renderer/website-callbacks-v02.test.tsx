// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatRingState } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

/**
 * V-02, Voice calls › Call-backs (X-UI-09; UX-CALL-03/04; WF-X2): the hub's Call-backs half under the Voice calls
 * heading with its own words; Open / Mine / Done with their counts; each request a card — who and their company, when
 * they called, how long they waited and the page, the best time (red while it is now); the opened one's Phone, Asked
 * about and Assigned to with Call back, Copy number, Open chat and Mark done…; the others' Call back, Assign ▾ and who
 * has them with the attempts; Call back on the WorkSuite phone, else the number copied, logged on the request; and
 * Mark done… with how it went and a staff note.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })) }));
vi.mock('../../../src/modules/chat/website/WebsiteThread', () => ({ WebsiteThread: ({ id }: { id: string }) => <div>Thread {id}</div> }));
vi.mock('../../../src/modules/chat/website/widget/WidgetSettings', () => ({ WidgetSettings: () => <div>The widget settings</div> }));
const tab = { route: '/chat?view=website&section=calls&show=callbacks', go: vi.fn(), active: true };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, active: tab.active, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { apiGet, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { timeLabel } from '../../../src/core/time';
import { toast } from '../../../src/core/toasts';
import type { WebsiteCallback } from '../../../src/modules/chat/website/api';
import { bestTimeNow, requestLine } from '../../../src/modules/chat/website/Callbacks';
import { whenLabel } from '../../../src/modules/chat/website/rowParts';
import { WebsiteWorkspace } from '../../../src/modules/chat/website/WebsiteWorkspace';

const at = (d: Date) => d.toISOString();
const today = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};
/** Last Saturday, 22:41 (a week ago when today is Saturday). */
const saturday = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7 || 7));
  d.setHours(22, 41, 0, 0);
  return d;
};

const cb = (over: Partial<WebsiteCallback>): WebsiteCallback => ({
  id: 1, conversation_id: 11, phone: '+94 77 312 4455', best_time: 'now – 12:00', visitor: 'Ravi Silva', site: 'techubiz.com', missed_call: true,
  created_at: at(today(9, 16)), reference: 'CB-1001', channel: 'call', how: 'by phone', message: 'CorelDRAW for Mac', due_at: at(new Date(Date.now() - 60_000)), overdue: true,
  status: 'open', attempts: 0, waited_seconds: 60, assigned_to: 7, assignee: 'Nuwan Perera', source: 'call', company: null,
  page_url: 'https://techubiz.com/shop/coreldraw', outside_hours: false, called_at: null, ...over,
});
const RAVI = cb({});
const MALINI = cb({
  id: 2, conversation_id: 12, phone: '+94 77 123 4567', visitor: 'Malini Perera', company: 'Lanka Traders', best_time: 'Mon morning', created_at: at(saturday()),
  missed_call: false, source: 'call', waited_seconds: null, page_url: null, site: 'licensepaluk.lk', outside_hours: true, due_at: at(new Date(Date.now() + 2 * 86400_000)),
  overdue: false, status: 'unreachable', attempts: 1, assigned_to: null, assignee: null, message: null,
});
const DONE = cb({ id: 3, conversation_id: 13, visitor: 'Kamal Fernando', status: 'done', outcome: 'sorted', handled_by: 'Nuwan Perera', attempts: 1 });

let lists: Record<string, WebsiteCallback[]> = {};
let voip: 'ok' | 'none' = 'ok';
const counts = { todo: 2, overdue: 1, mine: 1, done: 21 };

function serve() {
  vi.mocked(apiGet).mockImplementation((async (path: string, q?: Record<string, string>) => {
    if (path === '/api/chat/widget-admin/conversations') return { conversations: [], can: { view: true, reply: true, manage: false } };
    if (path === '/api/chat/widget-admin/visitors') return { visitors: [] };
    if (path === '/api/chat/widget-admin/missed/count') return { count: 0 };
    if (path === '/api/chat/widget-admin/callbacks/counts') return counts;
    if (path === '/api/chat/widget-admin/callbacks') return { callbacks: lists[q?.status === 'handled' ? 'done' : q?.mine ? 'mine' : 'open'] ?? [], counts };
    if (path === '/api/chat/widget-admin/agents') return { agents: [{ id: 7, name: 'Nuwan Perera', email: null }, { id: 8, name: 'Dilini Fernando', email: null }] };
    if (path === '/api/chat/widget-admin/calls') return { installed: true, live: [], calls: [], total: 0, page: 1, has_more: false };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiPost).mockImplementation((async (path: string) => {
    if (path === '/api/voip/call' && voip === 'none') throw new Error('You do not have an extension');
    return {};
  }) as never);
  const state: WebchatRingState = { chats: [], handoffs: [], tone: 'off', volume: 80, outcome: null, hidden: false, shortcut: false };
  vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'ring:state' ? state : null)) as never);
}

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const view = () => screen.getByRole('main', { name: 'Voice calls' });
const card = (name: string) => within(screen.getByRole('list', { name: 'Call-backs' })).getByRole('listitem', { name });
const posted = () => vi.mocked(apiPost).mock.calls.map(([p, b]) => [p, b]);
const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  writeText.mockClear();
  lists = { open: [RAVI, MALINI], mine: [RAVI], done: [DONE] };
  voip = 'ok';
  tab.route = '/chat?view=website&section=calls&show=callbacks';
  tab.go.mockReset();
  vi.mocked(apiGet).mockClear();
  vi.mocked(apiPost).mockClear();
  vi.mocked(toast).mockClear();
  app.set({ auth: { stage: 'ready', user: { id: '7' } } as never });
  serve();
});
afterEach(() => cleanup());

describe('the Call-backs half of Voice calls (X-UI-09)', () => {
  it('heads it Voice calls with the design’s words, Call-backs on with its amber count; Calls goes back', async () => {
    wrap(<WebsiteWorkspace />);
    expect(await within(view()).findByRole('heading', { name: 'Voice calls' })).toBeTruthy();
    expect(within(view()).getByText('Visitors who called when nobody could answer and asked us to call them back.')).toBeTruthy();
    const show = within(view()).getByRole('radiogroup', { name: 'Show' });
    const backs = within(show).getByRole('radio', { name: /Call-backs/ });
    expect(backs.getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(backs.textContent).toBe('Call-backs 2'));
    expect(backs.querySelector('.bg-warning-bg')?.textContent).toBe('2');
    // No site or period here, and no calls asked for.
    expect(within(view()).queryByRole('combobox', { name: 'Site' })).toBeNull();
    expect(vi.mocked(apiGet).mock.calls.some(([p]) => p === '/api/chat/widget-admin/calls')).toBe(false);
    fireEvent.click(within(show).getByRole('radio', { name: 'Calls' }));
    expect(tab.go).toHaveBeenCalledWith('/chat?view=website&section=calls');
    // The menu's Voice calls entry stays lit.
    const nav = screen.getByRole('navigation', { name: 'Website chats' });
    expect(within(nav).getByRole('button', { name: /Voice calls/ }).getAttribute('aria-current')).toBe('page');
  });

  it('has Open · 2, Mine · 1, Done · 21, each its own list', async () => {
    wrap(<WebsiteWorkspace />);
    const pills = await within(view()).findByRole('group', { name: 'Show call-backs' });
    await waitFor(() => expect(within(pills).getAllByRole('button').map((b) => b.textContent)).toEqual(['Open · 2', 'Mine · 1', 'Done · 21']));
    expect(within(pills).getByRole('button', { name: 'Open · 2' }).getAttribute('aria-pressed')).toBe('true');
    await screen.findByRole('listitem', { name: 'Malini Perera · Lanka Traders' });

    fireEvent.click(within(pills).getByRole('button', { name: 'Mine · 1' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Malini Perera · Lanka Traders' })).toBeNull());
    expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/api/chat/widget-admin/callbacks', { status: 'todo', mine: '1' }, expect.anything());

    fireEvent.click(within(pills).getByRole('button', { name: 'Done · 21' }));
    const done = await screen.findByRole('listitem', { name: 'Kamal Fernando' });
    expect(done.textContent).toContain('Reached — sorted · Nuwan Perera');
    fireEvent.click(within(done).getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(posted()).toContainEqual(['/api/chat/widget-admin/callbacks/3/reopen', {}]));
  });

  it('opens the first request: who, when, how long they waited and the page, best time in red, Phone / Asked about / Assigned to', async () => {
    wrap(<WebsiteWorkspace />);
    const ravi = await screen.findByRole('listitem', { name: 'Ravi Silva' });
    expect(ravi.getAttribute('aria-current')).toBe('true');
    expect(ravi.textContent).toContain(`Missed call today ${timeLabel(RAVI.created_at)} · waited 1:00 · techubiz.com/shop/coreldraw`);
    const best = within(ravi).getByText('Best time: now – 12:00');
    expect(best.className).toContain('bg-danger-bg');
    const terms = within(ravi).getAllByRole('term').map((t) => t.textContent);
    expect(terms).toEqual(['Phone', 'Asked about', 'Assigned to']);
    expect(within(ravi).getAllByRole('definition').map((d) => d.textContent)).toEqual(['+94 77 312 4455', 'CorelDRAW for Mac', 'You']);
    expect(within(ravi).getAllByRole('button').map((b) => b.textContent)).toEqual(expect.arrayContaining(['Call back', 'Copy number', 'Open chat', 'Mark done…']));

    // The other: Call back and Assign ▾, who has it and how many tries; its best time grey.
    const malini = card('Malini Perera · Lanka Traders');
    expect(malini.getAttribute('aria-current')).toBeNull();
    // "Called Sat 22:41": the day as the lists say it ("Yesterday" on a Sunday).
    expect(malini.textContent).toContain(`Called ${whenLabel(MALINI.created_at)} (outside hours) · licensepaluk.lk`);
    expect(within(malini).getByText('Best time: Mon morning').className).toContain('bg-subtle');
    expect(within(malini).getAllByRole('button').map((b) => b.textContent).slice(1)).toEqual(['Call back', 'Assign ▾']);
    expect(malini.textContent).toContain('Unassigned · 1 attempt (no answer)');

    // Picking it puts it in the address.
    fireEvent.click(within(malini).getAllByRole('button')[0]!);
    expect(tab.go).toHaveBeenCalledWith('/chat?view=website&section=calls&show=callbacks&callback=2');
  });

  it('Copy number and Open chat', async () => {
    wrap(<WebsiteWorkspace />);
    const ravi = await screen.findByRole('listitem', { name: 'Ravi Silva' });
    fireEvent.click(within(ravi).getByRole('button', { name: 'Copy number' }));
    expect(writeText).toHaveBeenCalledWith('+94 77 312 4455');
    fireEvent.click(within(ravi).getByRole('button', { name: 'Open chat' }));
    expect(tab.go).toHaveBeenCalledWith('/chat?view=website&section=inbox&website=11');
  });

  it('Assign ▾ goes to a colleague, to me, or to nobody', async () => {
    wrap(<WebsiteWorkspace />);
    await screen.findByRole('listitem', { name: 'Ravi Silva' });
    fireEvent.click(within(card('Malini Perera · Lanka Traders')).getByRole('button', { name: 'Assign ▾' }));
    const menu = await screen.findByRole('menu', { name: 'Assign to' });
    fireEvent.click(await within(menu).findByRole('menuitemradio', { name: /Dilini Fernando/ }));
    await waitFor(() => expect(posted()).toContainEqual(['/api/chat/widget-admin/callbacks/2/assign', { user_id: 8 }]));
  });
});

describe('Call back (UX-CALL-04)', () => {
  it('rings on the WorkSuite phone when it is connected, and logs the attempt', async () => {
    wrap(<WebsiteWorkspace />);
    const ravi = await screen.findByRole('listitem', { name: 'Ravi Silva' });
    fireEvent.click(within(ravi).getByRole('button', { name: 'Call back' }));
    await waitFor(() => expect(posted()).toContainEqual(['/api/chat/widget-admin/callbacks/1/call', { via: 'phone' }]));
    expect(posted()[0]).toEqual(['/api/voip/call', { number: '+94773124455' }]);
    expect(writeText).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('success', 'Calling +94 77 312 4455 on your WorkSuite phone');
  });

  it('otherwise copies the number, and still logs the attempt', async () => {
    voip = 'none';
    wrap(<WebsiteWorkspace />);
    await screen.findByRole('listitem', { name: 'Ravi Silva' });
    fireEvent.click(within(card('Malini Perera · Lanka Traders')).getByRole('button', { name: 'Call back' }));
    await waitFor(() => expect(posted()).toContainEqual(['/api/chat/widget-admin/callbacks/2/call', { via: 'copied' }]));
    expect(writeText).toHaveBeenCalledWith('+94 77 123 4567');
    expect(toast).toHaveBeenCalledWith('success', 'No WorkSuite phone connected — number copied');
  });
});

describe('Mark done… (UX-CALL-03)', () => {
  it('asks how it went, Reached — sorted first, and takes a staff note', async () => {
    wrap(<WebsiteWorkspace />);
    const ravi = await screen.findByRole('listitem', { name: 'Ravi Silva' });
    fireEvent.click(within(ravi).getByRole('button', { name: 'Mark done…' }));
    const panel = screen.getByRole('complementary', { name: 'Mark call-back done' });
    expect(within(panel).getByRole('heading', { name: 'Mark call-back done' })).toBeTruthy();
    expect(panel.textContent).toContain('Ravi Silva · +94 77 312 4455');
    const how = within(panel).getByRole('radiogroup', { name: 'How did it go?' });
    const radios = within(how).getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual(['Reached — sorted', 'Reached — needs a follow-up', 'No answer — keep it open', 'Wrong number']);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Note (staff only)' }), { target: { value: 'Mac version available; sent the link by email.' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(posted()).toContainEqual(['/api/chat/widget-admin/callbacks/1/done', { outcome: 'sorted', note: 'Mac version available; sent the link by email.' }]));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Mark call-back done' })).toBeNull());
  });

  it('No answer — keep it open keeps it open; Cancel closes the panel', async () => {
    wrap(<WebsiteWorkspace />);
    const ravi = await screen.findByRole('listitem', { name: 'Ravi Silva' });
    fireEvent.click(within(ravi).getByRole('button', { name: 'Mark done…' }));
    let panel = screen.getByRole('complementary', { name: 'Mark call-back done' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'No answer — keep it open' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(posted()).toContainEqual(['/api/chat/widget-admin/callbacks/1/done', { outcome: 'no_answer', keep_open: true }]));

    fireEvent.click(within(await screen.findByRole('listitem', { name: 'Ravi Silva' })).getByRole('button', { name: 'Mark done…' }));
    panel = screen.getByRole('complementary', { name: 'Mark call-back done' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Reached — needs a follow-up' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('complementary', { name: 'Mark call-back done' })).toBeNull();
  });
});

describe('the pieces', () => {
  it('says when and where in one line, and when the best time is now', () => {
    const now = new Date();
    const early = at(today(8, 5));
    expect(requestLine(cb({ missed_call: false, source: 'queue', waited_seconds: null, page_url: null, created_at: early }), now)).toBe(`Asked today ${timeLabel(early)} · techubiz.com`);
    expect(bestTimeNow({ overdue: false, due_at: at(new Date(Date.now() + 30 * 60_000)) })).toBe(true);
    expect(bestTimeNow({ overdue: false, due_at: at(new Date(Date.now() + 3 * 3600_000)) })).toBe(false);
    expect(bestTimeNow({ overdue: true, due_at: null })).toBe(true);
  });

  it('on a server without Call-backs, Voice calls’ switch still goes to Missed chats', async () => {
    tab.route = '/chat?view=website&section=calls';
    const base = vi.mocked(apiGet).getMockImplementation()!;
    vi.mocked(apiGet).mockImplementation((async (path: string, q?: Record<string, string>, s?: AbortSignal) => {
      if (path === '/api/chat/widget-admin/callbacks/counts') throw new Error('404');
      if (path === '/api/chat/widget-admin/callbacks') return { callbacks: [] };
      return base(path, q, s);
    }) as never);
    wrap(<WebsiteWorkspace />);
    const show = await within(view()).findByRole('radiogroup', { name: 'Show' });
    await waitFor(() => expect(vi.mocked(apiGet).mock.calls.some(([p]) => p === '/api/chat/widget-admin/callbacks')).toBe(true));
    fireEvent.click(within(show).getByRole('radio', { name: /Call-backs/ }));
    expect(tab.go).toHaveBeenCalledWith('/chat?view=website&section=missed');
  });
});
