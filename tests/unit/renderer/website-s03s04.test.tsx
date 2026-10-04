// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Website chats › Widgets & embed › a widget, Behaviour and Embed code (S-03; WS-WCHAT X-UI-16, UX-SET-04, UX-SET-05;
 * WGT-06, WGT-07, WGT-10, WGT-18, GATE-01) and Staff (S-04; X-UI-17, UX-SET-06; STF-01…03): the design's cards and
 * words, a save that sends only what changed, the domains as chips, the snippet with Copy, the install check and the
 * install guides; and the staff table with now, priority, voice calls, status and the lost-permission row, Add people,
 * Edit and Remove.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPut: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
let tabQuery = new URLSearchParams();
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ query: tabQuery, path: ['chat'], go: vi.fn(), active: true }), useTabTitle: () => undefined }));

import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { agoText, behaviourProblems, domainOf, seenText, snippetLines, type BehaviourPayload, type BehaviourSettings } from '../../../src/modules/chat/website/widget/behaviourSettings';
import type { DesignPayload, WidgetDesign, WidgetRow } from '../../../src/modules/chat/website/widget/design';
import { nowOf, type StaffPayload } from '../../../src/modules/chat/website/widget/staff';
import { WidgetSettings } from '../../../src/modules/chat/website/widget/WidgetSettings';

const CODE = '<script src="https://suite.techubiz.com/widget.js" data-widget-id="wk_7f3a21c21e" charset="utf-8" async></script>';
const ROWS: WidgetRow[] = [{ id: 1, name: 'Techubiz support', website_name: 'Techubiz', status: 'active', allowed_domains: 'techubiz.com\nwww.techubiz.com', embed_code: CODE }];

const design: WidgetDesign = {
  name: 'Techubiz support', header_title: 'Techubiz support', welcome_message: null, accent_color: '#2F9E67', border_radius: 16, auto_open_delay: 0,
  website_name: 'Techubiz', brand_color: '#273498', logo_url: null, greeting: null, header_subtitle: null, quick_links: [], staff_display: 'name_role',
  show_agents: true, offline_message: null, whatsapp_number: null, launcher_style: 'bubble', position: 'bottom_right', greeting_delay: 0, greeting_text: null,
  theme: 'light', launcher_offset_bottom: 20, launcher_offset_right: 20, launcher_offset_left: 20,
};

const SETTINGS: BehaviourSettings = {
  assignment_rule: 'round_robin', default_agent_id: null, ask_details_after_minutes: 2, missed_after_minutes: 5, inactive_after_minutes: 30,
  visitor_alerts: 'engaged', visitor_alert_pages: 3, allowed_domains: ['techubiz.com', 'www.techubiz.com'],
};

let behaviour: BehaviourPayload;
let staff: StaffPayload;
let staffError: unknown;

beforeEach(() => {
  tabQuery = new URLSearchParams('widget=1&tab=behaviour');
  staffError = null;
  behaviour = {
    settings: SETTINGS, embed_code: CODE, seen: { host: 'techubiz.com', at: '2026-10-04 10:00:00', seconds_ago: 130 },
    people: [{ id: 3, name: 'Nuwan Silva' }, { id: 7, name: 'Dilini Perera' }], can_manage: true,
  };
  staff = {
    staff: [
      { id: 1, user_id: 3, name: 'Nuwan Silva', email: 'n@x', priority: true, is_active: true, permitted: true, role: 'Support lead', avatar: null, status: 'available', open_chats: 2, voice: true },
      { id: 2, user_id: 7, name: 'Dilini Perera', email: 'd@x', priority: true, is_active: true, permitted: true, role: 'Education sales', avatar: null, status: 'available', open_chats: 1, voice: true },
      { id: 3, user_id: 8, name: 'Kasun Jayasinghe', email: 'k@x', priority: false, is_active: true, permitted: true, role: 'Support', avatar: null, status: 'busy', open_chats: 3, voice: false },
      { id: 4, user_id: 9, name: 'Amal Ranasinghe', email: 'a@x', priority: false, is_active: false, permitted: false, role: null, avatar: null, status: 'offline', open_chats: 0, voice: false },
    ],
    available: [{ id: 10, name: 'Sachini Fernando', email: 's@x', role: 'Sales' }, { id: 11, name: 'Ruwan Dias', email: 'r@x', role: null }],
  };
  const payload: DesignPayload = {
    widget: { id: 1, name: 'Techubiz support', widget_key: 'wk', status: 'active', domain: 'techubiz.com' }, design,
    agents: [{ user_id: 3, name: 'Nuwan Silva', role: 'Support lead', avatar: null, shown: true, active: true, presence: 'online' }],
    preview_agents: [], away: null, hours: null, reply_time: null, installed: true, can_manage: true,
  };
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/widgets') return { widgets: ROWS, can: { view: true, reply: true, manage: true } };
    if (path === '/api/chat/widget-admin/widgets/1/design') return payload;
    if (path === '/api/chat/widget-admin/widgets/1/hours') return { hours: [] };
    if (path === '/api/chat/widget-admin/widgets/1/behaviour') return behaviour;
    if (path === '/api/chat/widget-admin/widgets/1/staff') {
      if (staffError) throw staffError;
      return staff;
    }
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiPut).mockReset().mockImplementation((async (_p: string, body: Partial<BehaviourSettings>) => ({ ...behaviour, settings: { ...behaviour.settings, ...body } })) as never);
  vi.mocked(apiPost).mockReset().mockImplementation((async () => ({ staff: [] })) as never);
  vi.mocked(apiDelete).mockReset().mockImplementation((async () => ({ staff: [] })) as never);
  vi.mocked(toast).mockClear();
  vi.mocked(call).mockClear();
});
afterEach(() => cleanup());

const wrap = (ui: ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const behaviourForm = async () => within(await screen.findByRole('form', { name: 'Behaviour' }));
const num = (name: string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

describe('S-03 · Behaviour', () => {
  it('lays out NEW CHATS, VISITOR ALERTS and Allowed domains with the design\'s words and the saved values', async () => {
    wrap(<WidgetSettings />);
    const f = await behaviourForm();
    expect(screen.getByRole('tab', { name: 'Behaviour' }).getAttribute('aria-selected')).toBe('true');
    expect(f.getByText('New chats').className).toContain('uppercase');
    expect(f.getByText('Visitor alerts').className).toContain('uppercase');

    expect(f.getByText('Who gets a new chat')).toBeTruthy();
    expect(f.getByRole('combobox', { name: 'Who gets a new chat' }).textContent).toContain('Next available (round robin)');
    expect(f.getByText('Round robin among available staff on this widget, priority staff first.')).toBeTruthy();
    expect(num('Ask for contact details after (minutes)').value).toBe('2');
    expect(f.getByText('If nobody has replied yet, the widget asks for name and email.')).toBeTruthy();
    expect(num('Count as missed after (minutes)').value).toBe('5');
    expect(f.getByText('A visitor who leaves unanswered this long goes to Missed chats.')).toBeTruthy();
    expect(num('Go inactive after (minutes)').value).toBe('30');
    expect(f.getByText('Quiet chats close on their own.')).toBeTruthy();

    expect(f.getByRole('switch', { name: 'Tell agents when somebody is browsing' }).getAttribute('aria-checked')).toBe('true');
    expect(f.getByText('A quiet card for a visitor who is reading closely.')).toBeTruthy();
    expect(num('Pages before they count as reading').value).toBe('3');

    const domains = within(f.getByRole('group', { name: 'Allowed domains' }));
    expect(domains.getByText('techubiz.com')).toBeTruthy();
    expect(domains.getByText('www.techubiz.com')).toBeTruthy();
    expect((domains.getByRole('textbox', { name: 'Add a domain' }) as HTMLInputElement).placeholder).toBe('Add a domain…');
    expect(domains.getByText('The widget refuses to load on any other site.')).toBeTruthy();

    // The header's Cancel and Save act on Behaviour; nothing to save yet.
    expect(saveButton().disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the embed code beside the rules: Copy, the line to paste it by, the install check and the guides', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    wrap(<WidgetSettings />);
    await behaviourForm();
    const panel = within(screen.getByRole('tabpanel', { name: 'Behaviour' }));
    expect(panel.getByRole('heading', { name: 'Embed code' })).toBeTruthy();
    expect(panel.getByText('Paste before </body> on every page of techubiz.com.')).toBeTruthy();
    expect(panel.getByLabelText('Embed code').textContent).toBe('<script src="https://suite.techubiz.com/widget.js"\n  data-widget-id="wk_7f3a21c21e"\n  charset="utf-8"\n  async></script>');
    expect(panel.getByRole('status', { name: 'Install check' }).textContent).toBe('Seen on techubiz.com 2 minutes ago');
    fireEvent.click(panel.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODE));

    expect(panel.getByRole('heading', { name: 'Install guides' })).toBeTruthy();
    const wp = panel.getByRole('button', { name: 'WordPress — paste in a header/footer plugin' });
    expect(panel.getByRole('button', { name: 'Shopify — theme.liquid before </body>' })).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Google Tag Manager — Custom HTML tag' })).toBeTruthy();
    expect(panel.getByText('The script is small, loads after the page, and fails silently if WorkSuite cannot be reached.')).toBeTruthy();
    expect(wp.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(wp);
    expect(wp.getAttribute('aria-expanded')).toBe('true');
    expect(panel.getByText('Install a header and footer plugin, such as WPCode.')).toBeTruthy();
  });

  it('saves only what changed: the timers, the alerts and the domains, normalised as the server stores them', async () => {
    wrap(<WidgetSettings />);
    const f = await behaviourForm();
    fireEvent.change(num('Count as missed after (minutes)'), { target: { value: '10' } });
    fireEvent.change(num('Ask for contact details after (minutes)'), { target: { value: '' } });
    expect(num('Ask for contact details after (minutes)').placeholder).toBe('Off');
    fireEvent.click(f.getByRole('switch', { name: 'Tell agents when somebody is browsing' }));
    expect(num('Pages before they count as reading').disabled).toBe(true);

    const domains = within(f.getByRole('group', { name: 'Allowed domains' }));
    fireEvent.click(domains.getByRole('button', { name: 'Remove www.techubiz.com' }));
    const add = domains.getByRole('textbox', { name: 'Add a domain' });
    fireEvent.change(add, { target: { value: 'tech!ubiz.com' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    expect(domains.getByRole('alert').textContent).toBe('“tech!ubiz.com” is not a domain. Enter one like techubiz.com, or .techubiz.com for its sub-domains too.');
    fireEvent.change(add, { target: { value: 'https://Shop.Techubiz.com/contact' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    expect(domains.getByText('shop.techubiz.com')).toBeTruthy();
    expect(domains.queryByRole('alert')).toBeNull();

    fireEvent.click(saveButton());
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(vi.mocked(apiPut).mock.calls[0]).toEqual(['/api/chat/widget-admin/widgets/1/behaviour', {
      ask_details_after_minutes: 0, missed_after_minutes: 10, visitor_alerts: 'off', allowed_domains: ['techubiz.com', 'shop.techubiz.com'],
    }]);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Widget saved — visitors see it on their next page'));
  });

  it('holds Save back while a field is wrong, and Cancel puts back what is saved', async () => {
    wrap(<WidgetSettings />);
    const f = await behaviourForm();
    fireEvent.change(num('Go inactive after (minutes)'), { target: { value: '1' } });
    expect(f.getByRole('alert').textContent).toBe('2 to 1440 minutes; 0 is off');
    expect(num('Go inactive after (minutes)').getAttribute('aria-invalid')).toBe('true');
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText('Fix the highlighted fields to save.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(num('Go inactive after (minutes)').value).toBe('30');
    expect(saveButton().disabled).toBe(true);
  });

  it('asks who gets every chat when the rule is always the same person', async () => {
    behaviour = { ...behaviour, settings: { ...SETTINGS, assignment_rule: 'manual', default_agent_id: null } };
    wrap(<WidgetSettings />);
    const f = await behaviourForm();
    expect(f.getByText('Every new chat goes to one person, even when they are away.')).toBeTruthy();
    expect(f.getByRole('combobox', { name: 'Who gets every new chat' })).toBeTruthy();
    expect(f.getByText('Choose the person who gets every new chat.')).toBeTruthy();
    expect(behaviourProblems({ ...SETTINGS, assignment_rule: 'manual', default_agent_id: 7 })).toEqual({});
  });

  it('lets somebody who cannot configure widgets look, not change', async () => {
    behaviour = { ...behaviour, can_manage: false };
    wrap(<WidgetSettings />);
    const f = await behaviourForm();
    expect(f.getByText('You can look at these settings. Changing them needs the “Create and configure chat widgets” permission.')).toBeTruthy();
    expect(f.getByRole('switch', { name: 'Tell agents when somebody is browsing' }).matches(':disabled')).toBe(true);
    expect(saveButton().disabled).toBe(true);
  });

  it('says so on a server from before S-03, and still offers the snippet', async () => {
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path === '/api/chat/widget-admin/widgets') return { widgets: ROWS };
      if (path === '/api/chat/widget-admin/widgets/1/behaviour') throw new ApiError(404, 'Not found', null);
      throw new Error(`unexpected ${path}`);
    }) as never);
    wrap(<WidgetSettings />);
    expect(await screen.findByText('Not on this server yet')).toBeTruthy();
    expect(screen.getByLabelText('Embed code').textContent).toContain('data-widget-id="wk_7f3a21c21e"');
    expect(screen.queryByRole('status', { name: 'Install check' })).toBeNull();
  });

  it('shows the Embed code tab on its own, and a widget that has not loaded anywhere yet', async () => {
    tabQuery = new URLSearchParams('widget=1&tab=embed');
    behaviour = { ...behaviour, seen: null };
    wrap(<WidgetSettings />);
    const panel = within(await screen.findByRole('tabpanel', { name: 'Embed code' }));
    expect((await panel.findByRole('status', { name: 'Install check' })).textContent).toBe('Not seen on techubiz.com yet. This turns green once the widget first loads there.');
    expect(panel.getByRole('heading', { name: 'Install guides' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Behaviour' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('words the install check, sets out the snippet and reads a domain as the server does', () => {
    expect([agoText(5), agoText(60), agoText(130), agoText(3600), agoText(7300), agoText(86_400), agoText(3 * 86_400)]).toEqual(['just now', '1 minute ago', '2 minutes ago', '1 hour ago', '2 hours ago', 'yesterday', '3 days ago']);
    expect(seenText({ host: null, at: '', seconds_ago: 90 }, 'techubiz.com')).toBe('Seen 1 minute ago');
    expect(snippetLines('<script src="x/widget.js" data-widget-id="K" async></script>')).toBe('<script src="x/widget.js"\n  data-widget-id="K"\n  async></script>');
    expect(snippetLines('something else')).toBe('something else');
    expect([domainOf('techubiz.com'), domainOf('*.techubiz.com'), domainOf('.Techubiz.com'), domainOf('techubiz.com:8080/x'), domainOf('http://www.techubiz.com/a?b'), domainOf('tech ubiz'), domainOf('-x.com')])
      .toEqual(['techubiz.com', '.techubiz.com', '.techubiz.com', 'techubiz.com', 'www.techubiz.com', null, null]);
  });
});

describe('S-04 · Staff', () => {
  const openStaff = async () => {
    tabQuery = new URLSearchParams('widget=1&tab=staff');
    wrap(<WidgetSettings />);
    return within(await screen.findByRole('table', { name: 'Widget staff' }));
  };
  const row = (t: ReturnType<typeof within>, name: string) => within(t.getByRole('row', { name }));

  it('has the design\'s words, Add people in the header and a row per person: now, priority, voice calls and status', async () => {
    const t = await openStaff();
    expect(screen.getByText('Who answers this widget. Priority staff are rung first; suspended staff keep their history but get no chats. Everyone needs the "See website chats" permission.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add people' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(t.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['PERSON', 'NOW', 'PRIORITY', 'VOICE CALLS', 'STATUS', 'Actions']);

    const nuwan = row(t, 'Nuwan Silva');
    expect(nuwan.getByText('Support lead')).toBeTruthy();
    expect(nuwan.getByText('NS')).toBeTruthy();
    expect(nuwan.getByText('Online · 2 chats').className).toContain('text-success');
    expect(nuwan.getByText('Priority')).toBeTruthy();
    expect(nuwan.getByLabelText('Takes voice calls').textContent).toBe('✓');
    expect(nuwan.getByText('Active')).toBeTruthy();
    expect(nuwan.getByRole('button', { name: 'Edit Nuwan Silva' }).textContent).toBe('Edit');
    expect(row(t, 'Dilini Perera').getByText('Online · 1 chat')).toBeTruthy();

    const kasun = row(t, 'Kasun Jayasinghe');
    expect(kasun.getByText('Busy · 3 chats').className).toContain('text-warning');
    expect(kasun.queryByText('Priority')).toBeNull();
    expect(kasun.getByLabelText('No voice calls').textContent).toBe('—');

    const amal = t.getByRole('row', { name: 'Amal Ranasinghe' });
    expect(amal.className).toContain('bg-danger-bg');
    expect(within(amal).getByText('Lost "See website chats" — skipped for notifications')).toBeTruthy();
    expect(within(amal).getByText('Offline')).toBeTruthy();
    expect(within(amal).getByText('Suspended')).toBeTruthy();
    expect(within(amal).getByRole('button', { name: 'Remove Amal Ranasinghe' }).textContent).toBe('Remove');
    expect(screen.getByText('With nobody added, every person who can see website chats covers this widget.')).toBeTruthy();
  });

  it('edits priority and suspends, sending both flags', async () => {
    const t = await openStaff();
    fireEvent.click(t.getByRole('button', { name: 'Edit Kasun Jayasinghe' }));
    const d = within(screen.getByRole('dialog', { name: 'Kasun Jayasinghe' }));
    expect((d.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(d.getByRole('switch', { name: 'Priority' }));
    fireEvent.click(d.getByRole('switch', { name: 'Active' }));
    fireEvent.click(d.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/widgets/1/staff', { user_id: 8, priority: true, is_active: false }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('removes somebody who lost the permission, after asking', async () => {
    const t = await openStaff();
    fireEvent.click(t.getByRole('button', { name: 'Remove Amal Ranasinghe' }));
    const d = within(screen.getByRole('dialog', { name: 'Remove Amal Ranasinghe?' }));
    expect(d.getByText('They stop covering Techubiz support. Their permissions are not changed.')).toBeTruthy();
    fireEvent.click(d.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/chat/widget-admin/widgets/1/staff/9'));
  });

  it('adds people who can see website chats', async () => {
    await openStaff();
    fireEvent.click(screen.getByRole('button', { name: 'Add people' }));
    const d = within(screen.getByRole('dialog', { name: 'Add people' }));
    expect(d.getByText('Only people with the “See website chats” permission are listed.')).toBeTruthy();
    expect((d.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(d.getByRole('checkbox', { name: 'Sachini Fernando' }));
    fireEvent.click(d.getByRole('checkbox', { name: 'Ruwan Dias' }));
    fireEvent.click(d.getByRole('button', { name: 'Add 2 people' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(vi.mocked(apiPost).mock.calls.map((c) => c[1])).toEqual([{ user_id: 10, is_active: true }, { user_id: 11, is_active: true }]);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', '2 people added'));
  });

  it('says what is needed to choose staff when the server refuses the list', async () => {
    staffError = new ApiError(403, 'You need the "Assign website chat staff" permission', null);
    tabQuery = new URLSearchParams('widget=1&tab=staff');
    wrap(<WidgetSettings />);
    expect(await screen.findByText('Choosing who answers this widget needs the “Assign website chat staff” permission.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add people' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the team photos with Appearance, and Manage staff opens the Staff tab rather than the web', async () => {
    tabQuery = new URLSearchParams('widget=1');
    wrap(<WidgetSettings />);
    await screen.findByTestId('widget-preview');
    expect(screen.getByRole('heading', { name: 'Team photos' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Show Nuwan Silva to visitors' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manage staff' }));
    expect(screen.getByRole('tab', { name: 'Staff' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('table', { name: 'Widget staff' })).toBeTruthy();
    expect(call).not.toHaveBeenCalled();
  });

  it('words the NOW column', () => {
    expect([nowOf({ status: 'available', open_chats: 0 }), nowOf({ status: 'busy', open_chats: 1 }), nowOf({ status: 'away', open_chats: 2 }), nowOf({})].map((n) => n.label))
      .toEqual(['Online', 'Busy · 1 chat', 'Away · 2 chats', 'Offline']);
  });
});
