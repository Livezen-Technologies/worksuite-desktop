// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Website chats › Conversation starters (S-08; WS-WCHAT X-UI-20, UX-SET-09; STR-01…04), Saved replies (S-09; X-UI-21,
 * UX-SET-10; CAN-01, RDC-03) and Business hours (S-10; X-UI-22, UX-SET-11; HRS-01): the three SETUP items as this
 * app's own screens in place of links to the web, in the design's words — the starters table with its switch, drag
 * handle, editor and preview; the replies with search, editor, "Available on", this month's uses and the "/" list as
 * the composer shows it; the week with its timezone, "Open now · closes 17:30", the bars and what visitors see.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPut: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn() }));
let tabQuery = new URLSearchParams();
const go = vi.fn();
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: tabQuery, path: ['chat'], go, active: true, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));

import { apiDelete, apiGet, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { BusinessHours } from '../../../src/modules/chat/website/BusinessHours';
import type { SavedReply } from '../../../src/modules/chat/website/profile';
import { SavedRepliesScreen } from '../../../src/modules/chat/website/SavedReplies';
import { cleanShortcut, monthLine, replyProblems } from '../../../src/modules/chat/website/savedReplyList';
import { ConversationStarters } from '../../../src/modules/chat/website/Starters';
import { answerLine, moved, previewLabels, starterProblems, type Starter } from '../../../src/modules/chat/website/starterList';
import type { DesignPayload, HoursDay, WidgetDesign, WidgetRow } from '../../../src/modules/chat/website/widget/design';
import { openLine, openState, weekBars, weekProblems, zoneLabel } from '../../../src/modules/chat/website/widget/hours';
import { WidgetSettings } from '../../../src/modules/chat/website/widget/WidgetSettings';
import { WebsiteWorkspace } from '../../../src/modules/chat/website/WebsiteWorkspace';

const A = '/api/chat/widget-admin';
const ROWS: WidgetRow[] = [
  { id: 1, name: 'Techubiz support', website_name: 'Techubiz', status: 'active', allowed_domains: 'techubiz.com' },
  { id: 2, name: 'TechHub Lanka', website_name: 'TechHub', status: 'active', allowed_domains: 'techhub.com.lk' },
];

const design: WidgetDesign = {
  name: 'Techubiz support', header_title: 'Techubiz support', welcome_message: 'Hi! How can we help?', accent_color: '#2F9E67', border_radius: 16, auto_open_delay: 0,
  website_name: 'Techubiz', brand_color: '#273498', logo_url: null, greeting: null, header_subtitle: null, quick_links: [], staff_display: 'name_role',
  show_agents: true, offline_message: "We're away right now. Leave your email and we'll reply first thing.", whatsapp_number: null, launcher_style: 'bubble',
  position: 'bottom_right', greeting_delay: 0, greeting_text: null, theme: 'light', launcher_offset_bottom: 20, launcher_offset_right: 20, launcher_offset_left: 20,
};
const payload: DesignPayload = {
  widget: { id: 1, name: 'Techubiz support', widget_key: 'wk', status: 'active', domain: 'techubiz.com' }, design,
  agents: [], preview_agents: [], away: null, hours: null, reply_time: null, installed: true, can_manage: true,
};

const starter = (over: Partial<Starter>): Starter => ({
  id: 1, widget_id: 1, site: 'Techubiz', label: 'How much is a licence?', question: null, answer: 'Prices start at [PRICE]. Which product?', sort_order: 0, is_active: true, clicks: 142, ...over,
});

const week = (tz = 'Asia/Colombo') => [0, 1, 2, 3, 4, 5, 6].map((d) => ({
  weekday: d, is_open: d !== 0, opens_at: d === 6 ? '09:00:00' : '08:30:00', closes_at: d === 6 ? '13:00:00' : '17:30:00', timezone: tz,
}));

let starters: Starter[];
let replies: SavedReply[];
let hours: ReturnType<typeof week>;
let manage: boolean;

beforeEach(() => {
  tabQuery = new URLSearchParams('view=website');
  manage = true;
  starters = [
    starter({}),
    starter({ id: 2, label: 'Track my order', answer: null, sort_order: 1, clicks: 61 }),
    starter({ id: 3, label: 'Activation help', answer: "Sorry about that! Send the error and we'll fix it.", sort_order: 2, clicks: 38 }),
    starter({ id: 4, label: 'Bank transfer?', answer: 'Yes — details are on the checkout page.', sort_order: 3, clicks: 12, is_active: false }),
    starter({ id: 9, widget_id: 2, site: 'TechHub', label: 'Opening hours?', sort_order: 0, clicks: 3 }),
  ];
  replies = [
    { id: 1, shortcut: 'education', title: 'Education discount', body: "Students and schools get a discount on Creative Cloud. Send proof of enrolment and we'll quote within the hour. Seats: [NUMBER].", uses: 300, widget_id: null, month_uses: 54 },
    { id: 2, shortcut: 'edu-proof', title: 'Proof of enrolment', body: 'Please send a photo of your student ID…', uses: 20, widget_id: null, month_uses: 1 },
    { id: 3, shortcut: 'activate', title: 'Activation steps', body: 'Sign out, then sign in with the email on your order…', uses: 90, widget_id: null, month_uses: 0 },
    { id: 4, shortcut: 'bank', title: 'Bank transfer details', body: 'You can pay to [BANK DETAILS] and send the slip here…', uses: 4, widget_id: 2, month_uses: 2 },
  ];
  hours = week();
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === `${A}/widgets`) return { widgets: ROWS, can: { view: true, reply: true, manage } };
    if (path === `${A}/widgets/1/design`) return { ...payload, can_manage: manage };
    if (path === `${A}/widgets/2/design`) return { ...payload, widget: { ...payload.widget, id: 2 }, can_manage: manage };
    if (/\/widgets\/\d+\/hours$/.test(path)) return { hours, default_timezone: 'Asia/Colombo' };
    if (path === `${A}/widgets/1/behaviour`) return { settings: null, embed_code: '', seen: null, people: [], can_manage: true };
    if (path === `${A}/starters`) return { starters, can: { view: true, reply: true, manage } };
    if (path === `${A}/canned`) return { responses: replies, can: { view: true, reply: true, manage } };
    // The Website chats workspace around the menu.
    if (path === `${A}/conversations`) return { conversations: [], can: { view: true, reply: true, manage } };
    if (path === `${A}/visitors`) return { visitors: [] };
    if (path === `${A}/missed/count`) return { count: 0 };
    if (path === `${A}/callbacks/counts`) return { todo: 0, overdue: 0, mine: 0 };
    if (path === `${A}/callbacks`) return { callbacks: [] };
    if (path === `${A}/triggers`) return { triggers: [], can: { view: true, reply: true, manage } };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiPut).mockReset().mockImplementation((async () => ({})) as never);
  vi.mocked(apiPost).mockReset().mockImplementation((async () => ({ id: 77 })) as never);
  vi.mocked(apiDelete).mockReset().mockImplementation((async () => ({})) as never);
  vi.mocked(toast).mockClear();
  vi.mocked(call).mockReset().mockImplementation((async () => null) as never);
  go.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wrap = (ui: ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const combo = (name: string) => screen.getByRole('combobox', { name });

describe('SETUP · the three screens are this app’s own', () => {
  it.each([
    ['Conversation starters', 'starters', 'Conversation starters'],
    ['Saved replies', 'saved', 'Saved replies'],
    ['Business hours', 'hours', 'Business hours'],
  ])('%s opens here, lit while open, with no link to the web', async (label, section, heading) => {
    tabQuery = new URLSearchParams(`view=website&section=${section}`);
    app.set({ auth: { stage: 'ready', user: { id: '7' } } as never });
    wrap(<WebsiteWorkspace />);
    const nav = within(screen.getByRole('navigation', { name: 'Website chats' }));
    const names = nav.getAllByRole('button').map((b) => b.textContent);
    const at = names.indexOf('Automated messages');
    expect(names.slice(at + 1, at + 4)).toEqual(['Conversation starters', 'Saved replies', 'Business hours']);
    const item = nav.getByRole('button', { name: label });
    expect(item.getAttribute('aria-current')).toBe('page');
    expect(item.getAttribute('title')).toBeNull();
    expect(item.textContent).not.toContain('↗');
    expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeTruthy();
    fireEvent.click(item);
    expect(go).toHaveBeenLastCalledWith(`/chat?view=website&section=${section}`);
    expect(call).not.toHaveBeenCalledWith('app:openInBrowser', expect.anything());
  });
});

describe('S-08 · Conversation starters', () => {
  it('lays out the design: the words, the table, the editor and the preview', async () => {
    wrap(<ConversationStarters widget={null} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Conversation starters' })).toBeTruthy();
    expect(screen.getByText('Buttons under the welcome message. A starter with an instant answer replies at once; without one, an agent replies.')).toBeTruthy();
    const table = within(await screen.findByRole('table', { name: 'Starters' }));
    expect(table.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'BUTTON', 'INSTANT ANSWER', 'USED', 'ON']);
    const rows = table.getAllByRole('row').slice(1);
    // Only this widget's, in order; the other site's starter is not here.
    expect(rows.map((r) => r.textContent)).toEqual([
      '⋮⋮How much is a licence?Prices start at [PRICE]. Which product?142',
      '⋮⋮Track my orderAn agent will reply61',
      "⋮⋮Activation helpSorry about that! Send the error and we'll fix it.38",
      '⋮⋮Bank transfer?Yes — details are on the checkout page.12',
    ]);
    expect(table.getByRole('switch', { name: 'Bank transfer? on' }).getAttribute('aria-checked')).toBe('false');
    expect(rows[0]!.getAttribute('aria-selected')).toBe('true');
    expect(combo('Widget').textContent).toContain('techubiz.com');
    expect(screen.getByRole('button', { name: 'New starter' })).toBeTruthy();

    const form = within(screen.getByRole('form', { name: 'Edit starter' }));
    expect(form.getByRole('heading', { name: 'Edit starter' })).toBeTruthy();
    expect((form.getByLabelText('Title') as HTMLInputElement).value).toBe('How much is a licence?');
    expect((form.getByLabelText('Order') as HTMLInputElement).value).toBe('1');
    expect((form.getByLabelText('Instant answer') as HTMLTextAreaElement).value).toBe('Prices start at [PRICE]. Which product?');
    expect(form.getByText('Leave empty and an agent will reply.')).toBeTruthy();

    // The preview: the widget's header and welcome, and the starters that are on.
    const preview = within(screen.getByRole('complementary', { name: 'Preview' }));
    expect(preview.getByText('PREVIEW')).toBeTruthy();
    expect(await preview.findByText('Hi! How can we help?')).toBeTruthy();
    expect(preview.getByText('Techubiz support')).toBeTruthy();
    expect(preview.getByText('Track my order')).toBeTruthy();
    expect(preview.queryByText('Bank transfer?')).toBeNull();
    expect(screen.queryByTestId('preview-button')).toBeNull();
  });

  it('saves a switch as it is flipped, sending only that', async () => {
    wrap(<ConversationStarters widget={1} selected={null} onSelect={vi.fn()} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Bank transfer? on' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(`${A}/starters/4`, { is_active: true }));
  });

  it('moves a starter with the handle’s arrow keys, and the editor’s Order', async () => {
    const onSelect = vi.fn();
    wrap(<ConversationStarters widget={1} selected="2" onSelect={onSelect} />);
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Move How much is a licence?' }), { key: 'ArrowDown' });
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(`${A}/starters/order`, { widget_id: 1, ids: [2, 1, 3, 4] }));

    vi.mocked(apiPut).mockClear();
    const form = within(screen.getByRole('form', { name: 'Edit starter' }));
    fireEvent.change(form.getByLabelText('Instant answer'), { target: { value: 'Orders ship in a day.' } });
    fireEvent.change(form.getByLabelText('Order'), { target: { value: '4' } });
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(`${A}/starters/2`, { answer: 'Orders ship in a day.' }));
    expect(apiPut).toHaveBeenCalledWith(`${A}/starters/order`, { widget_id: 1, ids: expect.arrayContaining([2]) });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Starter saved'));
  });

  it('drags a row onto another', async () => {
    wrap(<ConversationStarters widget={1} selected={null} onSelect={vi.fn()} />);
    const rows = within(await screen.findByRole('table', { name: 'Starters' })).getAllByRole('row').slice(1);
    const dt = { effectAllowed: '', setData: vi.fn(), getData: vi.fn() };
    fireEvent.dragStart(rows[3]!, { dataTransfer: dt });
    fireEvent.dragOver(rows[0]!, { dataTransfer: dt });
    fireEvent.drop(rows[0]!, { dataTransfer: dt });
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(`${A}/starters/order`, { widget_id: 1, ids: [4, 1, 2, 3] }));
  });

  it('New starter is checked, then made at the place chosen; the preview follows what is typed', async () => {
    const onSelect = vi.fn();
    wrap(<ConversationStarters widget={1} selected="new" onSelect={onSelect} />);
    const form = within(await screen.findByRole('form', { name: 'New starter' }));
    expect(form.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect((form.getByLabelText('Order') as HTMLInputElement).value).toBe('5');
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    expect(await form.findByText('Give the button some words')).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();

    // The message is read with the field's name.
    fireEvent.change(form.getByLabelText(/^Title/), { target: { value: 'Do you ship abroad?' } });
    fireEvent.change(form.getByLabelText('Order'), { target: { value: '1' } });
    const preview = within(screen.getByRole('complementary', { name: 'Preview' }));
    expect(await preview.findByText('Do you ship abroad?')).toBeTruthy();
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`${A}/starters`, { widget_id: 1, label: 'Do you ship abroad?', answer: '', is_active: true, sort_order: 4 }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(`${A}/starters/order`, { widget_id: 1, ids: [77, 1, 2, 3, 4] }));
    expect(onSelect).toHaveBeenCalledWith(1, '77');
  });

  it('deletes after asking', async () => {
    const onSelect = vi.fn();
    wrap(<ConversationStarters widget={1} selected="3" onSelect={onSelect} />);
    fireEvent.click(within(await screen.findByRole('form', { name: 'Edit starter' })).getByRole('button', { name: 'Delete' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Delete “Activation help”?')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith(`${A}/starters/3`));
    expect(onSelect).toHaveBeenCalledWith(1, null);
  });

  it('can only be looked at without the permission', async () => {
    manage = false;
    wrap(<ConversationStarters widget={1} selected={null} onSelect={vi.fn()} />);
    expect(await screen.findByText('You can look at these starters. Changing them needs the “Create and configure chat widgets” permission.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New starter' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('switch', { name: 'Track my order on' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('works the order, the answer column and the preview out as the design says', () => {
    expect(answerLine({ answer: null })).toBe('An agent will reply');
    expect(answerLine({ answer: '  ' })).toBe('An agent will reply');
    expect(moved([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moved([1, 2, 3], 0, 9)).toEqual([2, 3, 1]);
    expect(starterProblems({ label: '', answer: '', order: 1 }, 3)).toEqual({ label: 'Give the button some words' });
    expect(starterProblems({ label: 'x'.repeat(81), answer: '', order: 4 }, 3)).toEqual({ label: 'Keep the button under 80 characters — it has to fit on a phone', order: '1 to 3' });
    const list = starters.slice(0, 4);
    expect(previewLabels(list, null)).toEqual(['How much is a licence?', 'Track my order', 'Activation help']);
    expect(previewLabels(list, { id: 3, label: 'Activation', order: 1 })).toEqual(['Activation', 'How much is a licence?', 'Track my order']);
  });
});

describe('S-09 · Saved replies', () => {
  it('lays out the design: the list, the editor, this month’s uses and the composer', async () => {
    wrap(<SavedRepliesScreen selected="1" onSelect={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Saved replies' })).toBeTruthy();
    expect(screen.getByText('Type "/" in a chat to insert one')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Search replies' }) as HTMLInputElement).placeholder).toBe('Search replies…');
    const list = within(await screen.findByRole('list', { name: 'Replies' }));
    // In the shortcut's order, each its shortcut, title and words.
    expect(list.getAllByRole('button').map((b) => b.textContent?.slice(0, 30))).toEqual([
      '/activateActivation stepsSign ',
      '/bankBank transfer detailsYou ',
      '/edu-proofProof of enrolmentPl',
      '/educationEducation discountSt',
    ]);
    expect(list.getByRole('button', { current: true }).textContent).toContain('Education discount');

    const form = within(screen.getByRole('form', { name: 'Saved reply' }));
    expect(form.getByRole('heading', { name: 'Education discount' })).toBeTruthy();
    expect((form.getByLabelText('Title') as HTMLInputElement).value).toBe('Education discount');
    expect((form.getByLabelText('Shortcut') as HTMLInputElement).value).toBe('education');
    expect((form.getByLabelText('Reply') as HTMLTextAreaElement).value).toContain('Students and schools get a discount');
    expect(form.getByText('Available on')).toBeTruthy();
    expect(combo('Available on').textContent).toContain('All widgets');
    expect(form.getByText('Used 54 times this month')).toBeTruthy();
    expect(form.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect((form.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);

    // IN THE COMPOSER: "/edu" typed, and the "/" list's lines.
    const composer = within(form.getByRole('region', { name: 'In the composer' }));
    expect(composer.getByText('IN THE COMPOSER')).toBeTruthy();
    expect(composer.getByText('/edu')).toBeTruthy();
    const lines = composer.getAllByText(/^\/edu/, { selector: 'b span' }).map((s) => s.textContent);
    expect(lines).toEqual(['/education · ', '/edu-proof · ']);
    expect(composer.getByText('Proof of enrolment')).toBeTruthy();
  });

  it('searches the shortcut, the title and the words', async () => {
    wrap(<SavedRepliesScreen selected={null} onSelect={vi.fn()} />);
    const list = await screen.findByRole('list', { name: 'Replies' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search replies' }), { target: { value: 'student id' } });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['/edu-proofProof of enrolmentPlease send a photo of your student ID…']);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search replies' }), { target: { value: 'zzz' } });
    expect(await screen.findByText('Nothing matches “zzz”')).toBeTruthy();
  });

  it('saves the reply for one widget, and checks the shortcut first', async () => {
    const onSelect = vi.fn();
    wrap(<SavedRepliesScreen selected="2" onSelect={onSelect} />);
    const form = within(await screen.findByRole('form', { name: 'Saved reply' }));
    fireEvent.change(form.getByLabelText('Shortcut'), { target: { value: 'Bank' } });
    expect(form.getByText('That shortcut is already used')).toBeTruthy();
    expect((form.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    expect(apiPut).not.toHaveBeenCalled();

    fireEvent.change(form.getByLabelText('Shortcut'), { target: { value: '/edu-photo' } });
    fireEvent.click(combo('Available on'));
    fireEvent.click(await screen.findByRole('option', { name: 'techhub.com.lk' }));
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(`${A}/canned/2`, { title: 'Proof of enrolment', shortcut: 'edu-photo', body: 'Please send a photo of your student ID…', widget_id: 2 }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Saved reply saved'));
    expect(onSelect).toHaveBeenCalledWith('2');
  });

  it('New reply is for every widget until another is chosen', async () => {
    const onSelect = vi.fn();
    wrap(<SavedRepliesScreen selected="new" onSelect={onSelect} />);
    const form = within(await screen.findByRole('form', { name: 'Saved reply' }));
    expect(form.getByRole('heading', { name: 'New reply' })).toBeTruthy();
    expect(form.queryByRole('button', { name: 'Delete' })).toBeNull();
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    expect(await form.findByText('A shortcut is lower-case letters, digits and dashes')).toBeTruthy();
    fireEvent.change(form.getByLabelText('Title'), { target: { value: 'Delivery time' } });
    fireEvent.change(form.getByLabelText('Shortcut'), { target: { value: 'delivery' } });
    fireEvent.change(form.getByLabelText('Reply'), { target: { value: 'Keys arrive by email within 15 minutes of payment.' } });
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`${A}/canned`, { title: 'Delivery time', shortcut: 'delivery', body: 'Keys arrive by email within 15 minutes of payment.', widget_id: null }));
    expect(onSelect).toHaveBeenCalledWith('77');
  });

  it('deletes after asking', async () => {
    const onSelect = vi.fn();
    wrap(<SavedRepliesScreen selected="3" onSelect={onSelect} />);
    fireEvent.click(within(await screen.findByRole('form', { name: 'Saved reply' })).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith(`${A}/canned/3`));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('words the month and checks a draft as the server would', () => {
    expect(monthLine({ month_uses: 54 })).toBe('Used 54 times this month');
    expect(monthLine({ month_uses: 1 })).toBe('Used once this month');
    expect(monthLine({ month_uses: 0 })).toBe('Not used this month');
    expect(monthLine({})).toBeNull();
    expect(cleanShortcut(' /Edu Proof ')).toBe('edu-proof');
    expect(replyProblems({ title: '', shortcut: 'x', body: '', widget_id: null }, replies, null)).toEqual({
      shortcut: 'A shortcut is lower-case letters, digits and dashes', title: 'A title and body are required', body: 'A title and body are required',
    });
    expect(replyProblems({ title: 'A', shortcut: 'education', body: 'B', widget_id: null }, replies, 1)).toEqual({});
  });
});

describe('S-10 · Business hours', () => {
  // Monday 5 October 2026, 10:00 in Colombo.
  const MONDAY_10 = new Date('2026-10-05T04:30:00Z');

  it('lays out the design: the timezone, open now, the week, the chart and what visitors see', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MONDAY_10);
    wrap(<BusinessHours widget={1} onWidget={vi.fn()} onAppearance={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Business hours' })).toBeTruthy();
    expect(screen.getByText('Outside these hours the widget takes offline enquiries and nothing rings.')).toBeTruthy();
    expect(combo('Widget').textContent).toContain('techubiz.com');
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Open now · closes 17:30');
    expect(screen.getByText('Timezone')).toBeTruthy();
    expect(combo('Timezone').textContent).toContain('Asia/Colombo (UTC+05:30)');

    const days = within(screen.getByRole('list', { name: 'Week' })).getAllByRole('listitem');
    expect(days.map((d) => d.querySelector('span')?.textContent)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    expect((within(days[0]!).getByLabelText('Monday opens') as HTMLInputElement).value).toBe('08:30');
    expect((within(days[0]!).getByLabelText('Monday closes') as HTMLInputElement).value).toBe('17:30');
    expect(within(days[0]!).getByText('to')).toBeTruthy();
    expect((within(days[5]!).getByLabelText('Saturday opens') as HTMLInputElement).value).toBe('09:00');
    expect(within(days[6]!).getByRole('switch', { name: 'Open on Sunday' }).getAttribute('aria-checked')).toBe('false');
    expect(within(days[6]!).getByText('Closed all day')).toBeTruthy();

    const chart = within(screen.getByRole('region', { name: 'This week' }));
    expect(chart.getByRole('heading', { name: 'This week' })).toBeTruthy();
    expect(chart.getByRole('img').getAttribute('aria-label')).toBe('Mon 08:30–17:30, Tue 08:30–17:30, Wed 08:30–17:30, Thu 08:30–17:30, Fri 08:30–17:30, Sat 09:00–13:00, Sun closed');

    const away = within(screen.getByRole('region', { name: 'Outside hours, visitors see' }));
    expect(await away.findByText("We're away right now. Leave your email and we'll reply first thing.")).toBeTruthy();
    expect(away.getByRole('button', { name: 'Edit offline message in Appearance →' })).toBeTruthy();
    // Nothing changed yet.
    expect((screen.getByRole('button', { name: 'Save hours' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the week in its timezone, and holds back a day that closes before it opens', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MONDAY_10);
    wrap(<BusinessHours widget={1} onWidget={vi.fn()} onAppearance={vi.fn()} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Open on Monday' }));
    // Closed on Monday: it opens again on Tuesday morning.
    expect(screen.getByRole('status').textContent).toBe('Closed now · opens 08:30 tomorrow');
    fireEvent.change(screen.getByLabelText('Friday closes'), { target: { value: '08:00' } });
    expect(screen.getByText('Friday closes before it opens')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save hours' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Friday closes'), { target: { value: '16:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(`${A}/widgets/1/hours`, expect.objectContaining({ timezone: 'Asia/Colombo' })));
    const sent = vi.mocked(apiPut).mock.calls[0]![1] as { days: HoursDay[] };
    expect(sent.days.find((d) => d.weekday === 1)!.is_open).toBe(false);
    expect(sent.days.find((d) => d.weekday === 5)!.closes_at).toBe('16:00');
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Business hours saved'));
  });

  it('says when a widget has no hours yet, and the link goes to Appearance', async () => {
    hours = [];
    const onAppearance = vi.fn();
    wrap(<BusinessHours widget={1} onWidget={vi.fn()} onAppearance={onAppearance} />);
    expect(await screen.findByText('This widget has no business hours yet: it is open whenever somebody is online. Save hours to keep to the week below.')).toBeTruthy();
    // The usual week can be saved as it stands.
    expect((screen.getByRole('button', { name: 'Save hours' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit offline message in Appearance →' }));
    expect(onAppearance).toHaveBeenCalledWith(1);
  });

  it('the widget editor’s Hours tab is the same week', async () => {
    tabQuery = new URLSearchParams('widget=1&tab=hours');
    wrap(<WidgetSettings />);
    const panel = within(await screen.findByRole('tabpanel', { name: 'Hours' }));
    expect(panel.getByRole('switch', { name: 'Business hours' }).getAttribute('aria-checked')).toBe('true');
    expect(await panel.findByRole('list', { name: 'Week' })).toBeTruthy();
    expect(panel.getByText('Closed all day')).toBeTruthy();
    expect(panel.getByRole('region', { name: 'This week' })).toBeTruthy();
    expect(combo('Timezone').textContent).toContain('Asia/Colombo (UTC+05:30)');
  });

  it('works open now, the bars and the zone out as the server would', () => {
    const days: HoursDay[] = week().map((d) => ({ weekday: d.weekday, is_open: d.is_open, opens_at: d.opens_at.slice(0, 5), closes_at: d.closes_at.slice(0, 5) }));
    expect(openLine(openState(days, 'Asia/Colombo', MONDAY_10))).toBe('Open now · closes 17:30');
    // Saturday 14:00 in Colombo: closed, and Sunday is closed all day.
    expect(openLine(openState(days, 'Asia/Colombo', new Date('2026-10-10T08:30:00Z')))).toBe('Closed now · opens 08:30 Monday');
    // Monday 07:00: later today.
    expect(openLine(openState(days, 'Asia/Colombo', new Date('2026-10-05T01:30:00Z')))).toBe('Closed now · opens 08:30');
    expect(openLine(openState(days.map((d) => ({ ...d, is_open: false })), 'UTC', MONDAY_10))).toBe('Closed all week');
    const bars = weekBars(days);
    expect(bars.map((b) => [b.label, b.tone])).toEqual([['Mon', 'usual'], ['Tue', 'usual'], ['Wed', 'usual'], ['Thu', 'usual'], ['Fri', 'usual'], ['Sat', 'other'], ['Sun', 'closed']]);
    expect(bars[0]!.start).toBeCloseTo(8.5 / 24);
    expect(bars[0]!.span).toBeCloseTo(9 / 24);
    expect(zoneLabel('Asia/Colombo', MONDAY_10)).toBe('Asia/Colombo (UTC+05:30)');
    expect(zoneLabel('America/New_York', MONDAY_10)).toBe('America/New York (UTC−04:00)');
    expect(zoneLabel('UTC', MONDAY_10)).toBe('UTC (UTC+00:00)');
    expect(weekProblems([{ weekday: 2, is_open: true, opens_at: '09:00', closes_at: '09:00' }, { weekday: 3, is_open: false, opens_at: '09:00', closes_at: '08:00' }])).toEqual({ 2: 'Tuesday closes before it opens' });
  });
});
