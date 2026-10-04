// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Website chats › Widgets & embed › a widget › Chatbot (S-05; WS-WCHAT X-UI-18, UX-SET-07; BOT-01…06) and Website chats
 * › Automated messages (S-07; X-UI-19, UX-SET-08; TRG-01…03): the design's words and fields, saves that send only what
 * changed, Try it answering a test chat and handing it to a person; the rules with their counts and switches, the
 * editor's WHEN, widget, frequency, posts-as and message, New rule, Delete — and the SETUP menu item that opens it.
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
import { AutomatedMessages } from '../../../src/modules/chat/website/Automated';
import { changedRule, draftOf, ruleCounts, ruleProblems, ruleSummary, type Rule } from '../../../src/modules/chat/website/automatedRules';
import { chatbotProblems, handoverOptions, modelOptions, outcomeLine, sourceOptions, type ChatbotPayload } from '../../../src/modules/chat/website/widget/chatbot';
import type { DesignPayload, WidgetDesign, WidgetRow } from '../../../src/modules/chat/website/widget/design';
import { WidgetSettings } from '../../../src/modules/chat/website/widget/WidgetSettings';
import { WebsiteWorkspace } from '../../../src/modules/chat/website/WebsiteWorkspace';

const A = '/api/chat/widget-admin';
const ROWS: WidgetRow[] = [
  { id: 1, name: 'Techubiz support', website_name: 'Techubiz', status: 'active', allowed_domains: 'techubiz.com', bot_name: 'Aria' },
  { id: 2, name: 'TechHub Lanka', website_name: 'TechHub', status: 'active', allowed_domains: 'techhub.com.lk', bot_name: null },
];

const design: WidgetDesign = {
  name: 'Techubiz support', header_title: 'Techubiz support', welcome_message: null, accent_color: '#2F9E67', border_radius: 16, auto_open_delay: 0,
  website_name: 'Techubiz', brand_color: '#273498', logo_url: null, greeting: null, header_subtitle: null, quick_links: [], staff_display: 'name_role',
  show_agents: true, offline_message: null, whatsapp_number: null, launcher_style: 'bubble', position: 'bottom_right', greeting_delay: 0, greeting_text: null,
  theme: 'light', launcher_offset_bottom: 20, launcher_offset_right: 20, launcher_offset_left: 20,
};
const payload: DesignPayload = {
  widget: { id: 1, name: 'Techubiz support', widget_key: 'wk', status: 'active', domain: 'techubiz.com' }, design,
  agents: [], preview_agents: [], away: null, hours: null, reply_time: null, installed: true, can_manage: true,
};

let bot: ChatbotPayload;
let rules: Rule[];
let manage: boolean;

const rule = (over: Partial<Rule>): Rule => ({
  id: 1, widget_id: 1, site: 'Techubiz', widget_name: 'Techubiz support', name: 'Pricing page nudge', is_active: true, event: 'page_match', seconds: 30,
  match_text: '/pricing', message: 'Comparing plans? I can help you pick the right licence — just ask.', repeatable: true, skip_if_chatting: true,
  only_in_hours: false, posts_as: 'widget', fires: 212, replied: 31, ...over,
});

beforeEach(() => {
  tabQuery = new URLSearchParams('widget=1&tab=chatbot');
  manage = true;
  bot = {
    settings: { ai_enabled: true, bot_name: 'Aria', avatar_url: null, ai_model: 'auto', ai_assistant_id: null, ai_handover_after: 0, ai_max_replies: 4 },
    installed: true, articles: 42, can_manage: true,
  };
  rules = [
    rule({}),
    rule({ id: 2, name: 'Returning visitor welcome', event: 'returning', seconds: 10, match_text: null, repeatable: false, posts_as: 'assistant', fires: 88, replied: 9 }),
    rule({ id: 3, name: 'Checkout help', match_text: '/checkout', seconds: 60, repeatable: false, is_active: false, fires: 4, replied: 0 }),
  ];
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === `${A}/widgets`) return { widgets: ROWS, can: { view: true, reply: true, manage } };
    if (path === `${A}/widgets/1/design`) return payload;
    if (path === `${A}/widgets/1/hours`) return { hours: [] };
    if (path === `${A}/widgets/1/behaviour`) return { settings: null, embed_code: '', seen: null, people: [], can_manage: true };
    if (path === `${A}/widgets/1/chatbot`) return bot;
    if (path === `${A}/widgets/1/chatbot/models`) return { configured: true, models: ['llama3.1:8b', 'qwen2.5:14b'] };
    if (path === '/api/ai/assistants') return { assistants: [{ id: 5, name: 'Licence helper', status: 'published', model: 'qwen2.5:14b' }, { id: 6, name: 'Draft', status: 'draft', model: 'x' }] };
    if (path === `${A}/triggers`) return { triggers: rules, can: { view: true, reply: true, manage } };
    // The Website chats workspace around the menu.
    if (path === `${A}/conversations`) return { conversations: [], can: { view: true, reply: true, manage } };
    if (path === `${A}/visitors`) return { visitors: [] };
    if (path === `${A}/missed/count`) return { count: 0 };
    if (path === `${A}/callbacks/counts`) return { todo: 0, overdue: 0, mine: 0 };
    if (path === `${A}/callbacks`) return { callbacks: [] };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiPut).mockReset().mockImplementation((async (path: string, body: Record<string, unknown>) =>
    path.endsWith('/chatbot') ? { ...bot, settings: { ...bot.settings, ...body } } : { trigger: null }) as never);
  vi.mocked(apiPost).mockReset().mockImplementation((async () => ({ outcome: 'answered', reply: 'Yes — Office Home 2024 is a one-time purchase.' })) as never);
  vi.mocked(apiDelete).mockReset().mockImplementation((async () => ({})) as never);
  vi.mocked(toast).mockClear();
  vi.mocked(call).mockReset().mockImplementation((async () => null) as never);
  go.mockClear();
});
afterEach(() => cleanup());

const wrap = (ui: ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const combo = (name: string) => screen.getByRole('combobox', { name });
const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

describe('S-05 · Chatbot', () => {
  it('lays out the design: the switch, the six fields, the hand-off note and Try it', async () => {
    wrap(<WidgetSettings />);
    const form = within(await screen.findByRole('form', { name: 'Chatbot' }));
    expect(screen.getByRole('tab', { name: 'Chatbot' }).getAttribute('aria-selected')).toBe('true');

    expect(form.getByRole('switch', { name: 'Assistant answers first' }).getAttribute('aria-checked')).toBe('true');
    expect(form.getByText('Answers from your knowledge base, then hands the chat to a person. Its replies never count as a staff reply.')).toBeTruthy();
    expect((form.getByLabelText('Assistant name') as HTMLInputElement).value).toBe('Aria');
    expect((form.getByLabelText('Assistant avatar URL') as HTMLInputElement).placeholder).toBe('https://…/avatar.png');
    expect(combo('Model').textContent).toContain('Organisation default (AI Gateway)');
    expect(combo('Answers from').textContent).toContain('Support › Knowledge base · 42 articles');
    expect(combo('Hand to a person after').textContent).toContain("The visitor asks, or it isn't sure");
    expect((form.getByLabelText('Replies before it stops') as HTMLInputElement).value).toBe('4');
    expect(form.getByText("When staff are online the hand-off rings them like any new chat. Outside hours the assistant takes the visitor's email instead.")).toBeTruthy();

    const tryIt = within(screen.getByRole('region', { name: 'Try it' }));
    expect(tryIt.getByText('TRY IT')).toBeTruthy();
    expect((tryIt.getByRole('textbox', { name: 'Ask the assistant' }) as HTMLInputElement).placeholder).toBe('Ask the assistant…');
    expect(tryIt.getByText('Test chats are not saved and do not ring anyone.')).toBeTruthy();

    // The design's header: Save alone, and nothing to save yet.
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open on the web ↗' })).toBeNull();
  });

  it('saves only what changed, and holds back an avatar a browser cannot load', async () => {
    wrap(<WidgetSettings />);
    const form = within(await screen.findByRole('form', { name: 'Chatbot' }));
    fireEvent.change(form.getByLabelText('Assistant name'), { target: { value: 'Nova' } });
    fireEvent.change(form.getByLabelText('Assistant avatar URL'), { target: { value: 'javascript:alert(1)' } });
    expect(form.getByText('The avatar must be a web address starting with https://')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText('Fix the highlighted fields to save.')).toBeTruthy();

    // The field's label carries its problem while there is one.
    fireEvent.change(form.getByLabelText(/^Assistant avatar URL/), { target: { value: 'https://cdn.techubiz.com/nova.png' } });
    fireEvent.click(combo('Hand to a person after'));
    fireEvent.click(await screen.findByRole('option', { name: '2 replies' }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(`${A}/widgets/1/chatbot`, { bot_name: 'Nova', avatar_url: 'https://cdn.techubiz.com/nova.png', ai_handover_after: 2 }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Widget saved — visitors see it on their next page'));
  });

  it('switched on with no model, it takes the organisation default; an assistant brings its own model', async () => {
    bot = { ...bot, settings: { ...bot.settings, ai_enabled: false, ai_model: null } };
    wrap(<WidgetSettings />);
    const form = within(await screen.findByRole('form', { name: 'Chatbot' }));
    fireEvent.click(form.getByRole('switch', { name: 'Assistant answers first' }));
    fireEvent.click(combo('Answers from'));
    fireEvent.click(await screen.findByRole('option', { name: 'Licence helper · AI assistant' }));
    await waitFor(() => expect((combo('Model') as HTMLButtonElement).disabled).toBe(true));
    expect(form.getByText('The assistant brings its own model.')).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(`${A}/widgets/1/chatbot`, { ai_enabled: true, ai_model: 'auto', ai_assistant_id: 5 }));
  });

  it('Try it answers with the settings on screen, then hands the chat to a person', async () => {
    wrap(<WidgetSettings />);
    await screen.findByRole('form', { name: 'Chatbot' });
    const tryIt = within(screen.getByRole('region', { name: 'Try it' }));
    const box = tryIt.getByRole('textbox', { name: 'Ask the assistant' });

    fireEvent.change(box, { target: { value: 'Is Office 2024 a one-time payment?' } });
    fireEvent.click(tryIt.getByRole('button', { name: 'Send' }));
    expect(await tryIt.findByText('Yes — Office Home 2024 is a one-time purchase.')).toBeTruthy();
    expect(tryIt.getByText('Aria · assistant')).toBeTruthy();
    expect(apiPost).toHaveBeenLastCalledWith(`${A}/widgets/1/chatbot/try`, {
      message: 'Is Office 2024 a one-time payment?', history: [],
      settings: { bot_name: 'Aria', ai_model: 'auto', ai_assistant_id: null, ai_max_replies: 4, ai_handover_after: 0 },
    });

    vi.mocked(apiPost).mockImplementationOnce((async () => ({ outcome: 'handover', reply: null })) as never);
    fireEvent.change(box, { target: { value: 'Yes please' } });
    fireEvent.click(tryIt.getByRole('button', { name: 'Send' }));
    expect(await tryIt.findByText('Handed to a person · ringing the team')).toBeTruthy();
    expect(vi.mocked(apiPost).mock.calls.at(-1)![1]).toMatchObject({
      message: 'Yes please',
      history: [{ from: 'visitor', body: 'Is Office 2024 a one-time payment?' }, { from: 'bot', body: 'Yes — Office Home 2024 is a one-time purchase.' }],
    });

    fireEvent.click(tryIt.getByRole('button', { name: 'Start again' }));
    expect(tryIt.queryByText('Yes please')).toBeNull();
  });

  it('read-only without the permission, and says so', async () => {
    bot = { ...bot, can_manage: false };
    wrap(<WidgetSettings />);
    const form = within(await screen.findByRole('form', { name: 'Chatbot' }));
    expect(form.getByText('You can look at these settings. Changing them needs the “Create and configure chat widgets” permission.')).toBeTruthy();
    expect((form.getByLabelText('Assistant name') as HTMLInputElement).closest('fieldset')!.disabled).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Ask the assistant' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('words its lists and checks as the server does', () => {
    expect(handoverOptions(0).slice(0, 3).map((o) => o.label)).toEqual(["The visitor asks, or it isn't sure", '1 reply', '2 replies']);
    expect(handoverOptions(15).at(-1)).toEqual({ value: 15, label: '15 replies' });
    expect(modelOptions(['llama3.1:8b'], 'mistral:7b').map((o) => o.label)).toEqual(['Organisation default (AI Gateway)', 'mistral:7b', 'llama3.1:8b']);
    expect(sourceOptions(null, [], 9).map((o) => o.label)).toEqual(['Support › Knowledge base', 'Assistant #9 · not published']);
    expect(chatbotProblems({ ...bot.settings, ai_max_replies: 21 })).toEqual({ ai_max_replies: 'Replies before it stops must be 1 to 20' });
    expect(outcomeLine('handover')).toBe('Handed to a person · ringing the team');
    expect(outcomeLine('answered')).toBeNull();
  });
});

describe('S-07 · Automated messages', () => {
  it('is under SETUP, after Widgets & embed, and lit while open', async () => {
    tabQuery = new URLSearchParams('view=website&section=automated');
    app.set({ auth: { stage: 'ready', user: { id: '7' } } as never });
    wrap(<WebsiteWorkspace />);
    const nav = within(screen.getByRole('navigation', { name: 'Website chats' }));
    const setup = nav.getAllByRole('button').map((b) => b.textContent);
    const at = setup.indexOf('Widgets & embed');
    expect(setup[at + 1]).toBe('Automated messages');
    expect(nav.getByRole('button', { name: 'Automated messages' }).getAttribute('aria-current')).toBe('page');
    // No longer a link to the web.
    expect(nav.getByRole('button', { name: 'Automated messages' }).getAttribute('title')).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Automated messages' })).toBeTruthy();
    fireEvent.click(nav.getByRole('button', { name: 'Automated messages' }));
    expect(go).toHaveBeenLastCalledWith('/chat?view=website&section=automated');
    expect(call).not.toHaveBeenCalledWith('app:openInBrowser', expect.anything());
  });

  it('lists the rules with their condition, counts and switch, and opens the first', async () => {
    wrap(<AutomatedMessages selected={null} onSelect={vi.fn()} />);
    expect(await screen.findByText('Proactive messages sent by rules')).toBeTruthy();
    const list = within(await screen.findByRole('list', { name: 'Rules' }));
    expect(list.getByText('Address contains /pricing · after 30 s · once per visit')).toBeTruthy();
    expect(list.getByText('Sent 212 · 31 replied')).toBeTruthy();
    expect(list.getByText('Returning visitor · after 10 s')).toBeTruthy();
    expect(list.getByText('Sent 88 · 9 replied')).toBeTruthy();
    expect(list.getByText('Address contains /checkout · after 60 s')).toBeTruthy();
    expect(list.getByText('Paused')).toBeTruthy();
    expect(list.getByRole('switch', { name: 'Checkout help on' }).getAttribute('aria-checked')).toBe('false');

    // The first rule is open, as the design shows it.
    const form = within(await screen.findByRole('form', { name: 'Automated message' }));
    expect((form.getByRole('textbox', { name: 'Rule name' }) as HTMLInputElement).value).toBe('Pricing page nudge');
    expect(form.getByText('When')).toBeTruthy();
    expect(combo('Condition').textContent).toContain('Address contains');
    expect((form.getByRole('textbox', { name: 'Address contains' }) as HTMLInputElement).value).toBe('/pricing');
    expect(form.getByText('and they have been on the page for')).toBeTruthy();
    expect((form.getByRole('spinbutton', { name: 'Seconds' }) as HTMLInputElement).value).toBe('30');
    expect(form.getByText('seconds')).toBeTruthy();
    expect(combo('Widget').textContent).toContain('techubiz.com');
    expect(combo('Send it').textContent).toContain('Once per visit');
    expect((form.getByRole('checkbox', { name: 'Never to a visitor already chatting.' }) as HTMLInputElement).checked).toBe(true);
    expect(form.getByText('Message')).toBeTruthy();
    expect(combo('Posts as').textContent).toContain('The widget (Techubiz support)');
    expect((form.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('Comparing plans? I can help you pick the right licence — just ask.');
    expect(form.getByText('Automated messages never count as the team answering, so they do not stop ringing or first-response timers.')).toBeTruthy();
    expect(form.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect((form.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('switches a rule on from the list, sending only that', async () => {
    wrap(<AutomatedMessages selected={null} onSelect={vi.fn()} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Checkout help on' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(`${A}/triggers/3`, { is_active: true }));
  });

  it('saves only what changed in the editor', async () => {
    const onSelect = vi.fn();
    wrap(<AutomatedMessages selected="2" onSelect={onSelect} />);
    const form = within(await screen.findByRole('form', { name: 'Automated message' }));
    expect(combo('Posts as').textContent).toContain('The assistant (Aria)');
    expect(combo('Send it').textContent).toContain('Once per visitor');
    fireEvent.change(form.getByRole('spinbutton', { name: 'Seconds' }), { target: { value: '20' } });
    fireEvent.click(combo('Send it'));
    fireEvent.click(await screen.findByRole('option', { name: 'Once per visit' }));
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(`${A}/triggers/2`, { seconds: 20, repeatable: true }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Automated message saved'));
    expect(onSelect).toHaveBeenCalledWith('2');
  });

  it('New rule starts as the design does and is checked before it is sent', async () => {
    vi.mocked(apiPost).mockImplementation((async () => ({ id: 9 })) as never);
    const onSelect = vi.fn();
    wrap(<AutomatedMessages selected="new" onSelect={onSelect} />);
    const form = within(await screen.findByRole('form', { name: 'Automated message' }));
    expect(form.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(combo('Send it').textContent).toContain('Once per visit');
    expect(combo('Posts as').textContent).toContain('The widget (Techubiz support)');

    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    expect(await form.findByText('Name this rule')).toBeTruthy();
    expect(form.getByText('Write the message it sends')).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();

    fireEvent.change(form.getByRole('textbox', { name: 'Rule name' }), { target: { value: 'Leaving?' } });
    fireEvent.click(combo('Condition'));
    fireEvent.click(await screen.findByRole('option', { name: 'About to leave' }));
    // No seconds for a visitor about to leave.
    expect(form.queryByRole('spinbutton', { name: 'Seconds' })).toBeNull();
    fireEvent.change(form.getByRole('textbox', { name: 'Message' }), { target: { value: 'Before you go — any questions?' } });
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`${A}/triggers`, {
      widget_id: 1, name: 'Leaving?', is_active: true, event: 'exit_intent', seconds: 30, match_text: '', message: 'Before you go — any questions?',
      repeatable: true, skip_if_chatting: true, only_in_hours: false, posts_as: 'widget',
    }));
    expect(onSelect).toHaveBeenCalledWith('9');
  });

  it('Delete asks first', async () => {
    const onSelect = vi.fn();
    wrap(<AutomatedMessages selected="1" onSelect={onSelect} />);
    const form = within(await screen.findByRole('form', { name: 'Automated message' }));
    fireEvent.click(form.getByRole('button', { name: 'Delete' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Delete “Pricing page nudge”?')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith(`${A}/triggers/1`));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('read-only without the permission', async () => {
    manage = false;
    wrap(<AutomatedMessages selected={null} onSelect={vi.fn()} />);
    const form = within(await screen.findByRole('form', { name: 'Automated message' }));
    expect(form.getByText('You can look at these rules. Changing them needs the “Create and configure chat widgets” permission.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New rule' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('switch', { name: 'Pricing page nudge on' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('words the list and checks a rule as the server does', () => {
    expect(ruleSummary({ event: 'time_on_site', match_text: null, seconds: 45, repeatable: false })).toBe('Anywhere on the site · after 45 s');
    expect(ruleSummary({ event: 'exit_intent', match_text: null, seconds: 3, repeatable: true })).toBe('About to leave · once per visit');
    expect(ruleCounts({ is_active: true, fires: 5, replied: undefined })).toBe('Sent 5');
    const d = draftOf(rule({ match_text: null }));
    expect(ruleProblems({ ...d, seconds: 2 })).toEqual({ match_text: 'Give the text the address must contain', seconds: '3 to 3600 seconds' });
    expect(changedRule(d, { ...d, name: 'Pricing' })).toEqual({ name: 'Pricing' });
  });
});
