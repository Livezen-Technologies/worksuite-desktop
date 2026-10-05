// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Website chats › Widgets & embed (S-01; WS-WCHAT X-UI-14, UX-SET-01, WGT-01, WGT-02) and a widget's editor with
 * Appearance and its live preview (S-02; X-UI-15, UX-SET-02, UX-SET-03, WGT-03, WGT-05): the cards with their open
 * state, counts and chips, Customise and Embed code, this week's figures from Insights, New widget; and the seven tabs,
 * the design's fields, the preview following them, and a save that sends them.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPut: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
let tabQuery = new URLSearchParams();
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ query: tabQuery, path: ['chat'], go: vi.fn(), active: true }), useTabTitle: () => undefined }));

import { apiGet, apiPost, apiPut } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { problems, withDefaults, type DesignPayload, type WidgetDesign, type WidgetRow } from '../../../src/modules/chat/website/widget/design';
import { featureChips, siteOf, WebsiteWidgets } from '../../../src/modules/chat/website/widget/Widgets';
import { tabOf, WidgetSettings } from '../../../src/modules/chat/website/widget/WidgetSettings';

const ROWS: WidgetRow[] = [
  {
    id: 1, name: 'Techubiz support', website_name: 'Techubiz', status: 'active', allowed_domains: 'techubiz.com\n.shop.techubiz.com', brand_color: '#273498',
    embed_code: '<script src="https://ws.example/widget.js" data-widget-id="KEY1" charset="utf-8" async></script>',
    ai_enabled: true, voice_enabled: true, open_conversations: 3, open_now: true, opens_at: null, online: 11, staff: 4, starters: 5, rules: 0,
  },
  { id: 2, name: 'TechHub Lanka', website_name: 'TechHub', status: 'active', allowed_domains: 'techhub.com.lk', brand_color: '#1f7a6e', ai_enabled: false, voice_enabled: false, open_conversations: 1, open_now: true, online: 5, staff: 2, starters: 0, rules: 2 },
  { id: 3, name: 'License Paluk', website_name: null, status: 'active', allowed_domains: 'licensepaluk.lk', brand_color: '#8a5a2b', ai_enabled: true, voice_enabled: true, open_conversations: 0, open_now: false, opens_at: '08:30', online: 2, staff: 3, starters: 1, rules: 0 },
];

const WEEK = {
  period: '7d', since: null, until: '2026-10-04', widget_id: null, widgets: [],
  conversations: { value: 96, previous: 80 }, first_response: { value: 48, previous: 50 }, resolution: { value: 600, previous: null },
  rating: { value: 4.7, rated: 20, previous: null }, missed: { value: 4, share: 4, previous: 2 }, visitors: { value: 400, returning: 116, returning_share: 29 },
  days: [], sources: [], devices: [], agents: [], join_median_seconds: null,
};

const design = (extra: Partial<WidgetDesign> = {}): WidgetDesign => ({
  name: 'Techubiz support', header_title: 'Techubiz support', welcome_message: 'Hi! How can we help?', accent_color: '#2F9E67', border_radius: 16, auto_open_delay: 0,
  website_name: 'Techubiz', brand_color: '#273498', logo_url: null, greeting: null, header_subtitle: 'We usually reply in minutes', quick_links: [],
  staff_display: 'name_role', show_agents: true, offline_message: 'We\'re away right now. Leave your email and we\'ll reply first thing.', whatsapp_number: null,
  launcher_style: 'bubble', position: 'bottom_right', greeting_delay: 0, greeting_text: null, theme: 'light',
  launcher_offset_bottom: 20, launcher_offset_right: 20, launcher_offset_left: 20, ...extra,
});

let payload: DesignPayload;
let manage: boolean;

beforeEach(() => {
  tabQuery = new URLSearchParams();
  manage = true;
  payload = {
    widget: { id: 1, name: 'Techubiz support', widget_key: 'KEY1', status: 'active', domain: 'techubiz.com' },
    design: design(),
    starters: ['How much is a licence?', 'Track my order'],
    agents: [], preview_agents: [], away: null, hours: null, reply_time: null, installed: true, can_manage: true,
  };
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string, params?: Record<string, unknown>) => {
    if (path === '/api/chat/widget-admin/widgets') return { widgets: ROWS, can: { view: true, reply: true, manage } };
    if (path === '/api/chat/widget-admin/insights') return { ...WEEK, period: params?.period };
    if (/\/widgets\/\d+\/design$/.test(path)) return payload;
    if (/\/widgets\/\d+\/hours$/.test(path)) return { hours: [] };
    if (/\/widgets\/\d+\/calls$/.test(path)) throw new Error('not here');
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiPut).mockReset().mockImplementation((async (_path: string, body: unknown) => ({ ...payload, design: { ...payload.design, ...(body as object) } })) as never);
  vi.mocked(apiPost).mockReset().mockImplementation((async () => ({ id: 9, widget_key: 'NEW' })) as never);
  vi.mocked(toast).mockClear();
  vi.mocked(call).mockClear();
});
afterEach(() => cleanup());

const wrap = (ui: ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const card = (name: string) => within(screen.getByRole('article', { name }));

describe('S-01 · the widgets list', () => {
  it('names a widget by its first allowed domain, and says what it does in chips', () => {
    expect(siteOf(ROWS[0]!)).toBe('techubiz.com');
    expect(siteOf({ allowed_domains: '', website_name: 'Shop', name: 'Main' })).toBe('Shop');
    expect(featureChips(ROWS[0]!).map((c) => c.label)).toEqual(['Chatbot on', 'Voice calls on', '5 starters']);
    expect(featureChips(ROWS[1]!).map((c) => c.label)).toEqual(['Chatbot off', '2 rules']);
    // Closed: what matters is that it still takes enquiries.
    expect(featureChips(ROWS[2]!)).toEqual([{ label: 'Takes offline enquiries', tone: 'warning' }]);
    expect(featureChips({ ...ROWS[1]!, starters: 1, rules: 1 }).map((c) => c.label)).toEqual(['Chatbot off', '1 starter', '1 rule']);
  });

  it('shows the design\'s heading, a card per widget with its state, counts and chips, and Customise and Embed code', async () => {
    const onOpen = vi.fn();
    wrap(<WebsiteWidgets onOpen={onOpen} onInsights={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Website widgets' })).toBeTruthy();
    expect(screen.getByText('One widget per website. Each has its own look, staff, hours and rules.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New widget' })).toBeTruthy();

    await screen.findByRole('article', { name: 'Techubiz support' });
    const tb = card('Techubiz support');
    expect(tb.getByText('techubiz.com')).toBeTruthy();
    expect(tb.getByText('TS')).toBeTruthy();
    expect(tb.getByText('Open now')).toBeTruthy();
    expect(tb.getByRole('listitem', { name: 'Online: 11' })).toBeTruthy();
    expect(tb.getByRole('listitem', { name: 'Open chats: 3' })).toBeTruthy();
    expect(tb.getByRole('listitem', { name: 'Staff: 4' })).toBeTruthy();
    expect(tb.getByRole('list', { name: 'Features' }).textContent).toBe('Chatbot onVoice calls on5 starters');

    expect(card('TechHub Lanka').getByRole('list', { name: 'Features' }).textContent).toBe('Chatbot off2 rules');
    const lp = card('License Paluk');
    expect(lp.getByText('Closed · opens 08:30')).toBeTruthy();
    expect(lp.getByRole('list', { name: 'Features' }).textContent).toBe('Takes offline enquiries');
    expect(lp.getByRole('listitem', { name: 'Open chats: 0' })).toBeTruthy();

    fireEvent.click(tb.getByRole('button', { name: 'Customise Techubiz support' }));
    expect(onOpen).toHaveBeenLastCalledWith(1);
    expect(tb.getByRole('button', { name: 'Embed code for Techubiz support' }).textContent).toBe('Embed code');
    fireEvent.click(tb.getByRole('button', { name: 'Embed code for Techubiz support' }));
    expect(onOpen).toHaveBeenLastCalledWith(1, 'embed');
  });

  it('shows this week across every widget, from Insights\' last 7 days, and opens Insights', async () => {
    const onInsights = vi.fn();
    wrap(<WebsiteWidgets onOpen={vi.fn()} onInsights={onInsights} />);
    const week = within(await screen.findByRole('region', { name: 'Widget analytics · this week' }));
    await waitFor(() => expect(week.getByRole('listitem', { name: 'Conversations: 96' })).toBeTruthy());
    expect(week.getByRole('listitem', { name: 'Avg first response: 0:48' })).toBeTruthy();
    expect(week.getByRole('listitem', { name: 'Avg rating: 4.7' })).toBeTruthy();
    expect(week.getByRole('listitem', { name: 'Missed: 4' }).querySelector('b')!.className).toContain('text-danger');
    expect(week.getByRole('listitem', { name: 'Returning visitors: 29%' })).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/insights', { period: '7d' }, expect.anything());
    fireEvent.click(week.getByRole('button', { name: 'Open Insights →' }));
    expect(onInsights).toHaveBeenCalled();
  });

  it('creates a widget from its name and site, and opens it', async () => {
    const onOpen = vi.fn();
    wrap(<WebsiteWidgets onOpen={onOpen} onInsights={vi.fn()} />);
    await screen.findByRole('article', { name: 'Techubiz support' });
    fireEvent.click(screen.getByRole('button', { name: 'New widget' }));
    const dialog = within(screen.getByRole('dialog', { name: 'New widget' }));
    expect((dialog.getByRole('button', { name: 'Create widget' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(dialog.getByRole('textbox', { name: 'Widget name' }), { target: { value: 'Shop support' } });
    fireEvent.change(dialog.getByRole('textbox', { name: /Website/ }), { target: { value: 'shop.example' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Create widget' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(9));
    expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/widgets', { name: 'Shop support', allowed_domains: 'shop.example' });
  });

  it('keeps New widget for those who may configure widgets', async () => {
    manage = false;
    wrap(<WebsiteWidgets onOpen={vi.fn()} onInsights={vi.fn()} />);
    await screen.findByRole('article', { name: 'Techubiz support' });
    expect((screen.getByRole('button', { name: 'New widget' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('S-02 · a widget\'s editor and Appearance with live preview', () => {
  const preview = () => within(screen.getByTestId('widget-preview'));
  const mount = async () => {
    wrap(<WidgetSettings onList={vi.fn()} />);
    await screen.findByTestId('widget-preview');
  };

  it('reads the tab from the address, `design` being Appearance\'s older name', () => {
    expect([tabOf(null), tabOf('design'), tabOf('calls'), tabOf('embed'), tabOf('nonsense')]).toEqual(['appearance', 'appearance', 'calls', 'embed', 'appearance']);
  });

  it('has the breadcrumb, the widget\'s name, Cancel and Save, and the seven tabs in the design\'s order', async () => {
    const onList = vi.fn();
    wrap(<WidgetSettings onList={onList} />);
    await screen.findByTestId('widget-preview');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe('Widgets & embed › techubiz.com');
    expect(screen.getByRole('heading', { name: 'Techubiz support' })).toBeTruthy();
    expect(screen.getAllByRole('tab').slice(0, 7).map((t) => t.textContent)).toEqual(['Appearance', 'Behaviour', 'Live status & calls', 'Staff', 'Hours', 'Chatbot', 'Embed code']);
    expect(screen.getByRole('tab', { name: 'Appearance' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Widgets & embed' }));
    expect(onList).toHaveBeenCalled();
  });

  it('lays out the design\'s fields with its words', async () => {
    await mount();
    expect((screen.getByRole('textbox', { name: 'Widget name' }) as HTMLInputElement).value).toBe('Techubiz support');
    expect((screen.getByRole('textbox', { name: 'Website name' }) as HTMLInputElement).value).toBe('Techubiz');
    expect((screen.getByRole('textbox', { name: 'Header title' }) as HTMLInputElement).value).toBe('Techubiz support');
    expect((screen.getByRole('textbox', { name: 'Header subtitle' }) as HTMLInputElement).value).toBe('We usually reply in minutes');
    expect((screen.getByRole('textbox', { name: 'Welcome message' }) as HTMLInputElement).value).toBe('Hi! How can we help?');
    expect((screen.getByLabelText('Offline message') as HTMLTextAreaElement).value).toBe('We\'re away right now. Leave your email and we\'ll reply first thing.');
    expect(screen.getByRole('radiogroup', { name: 'Brand colour' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '#273498' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radiogroup', { name: 'Accent colour' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '#2F9E67' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Bottom right' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Corner radius · 16 px')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Icon' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Icon + "Chat with us"' })).toBeTruthy();
    const auto = screen.getByRole('spinbutton', { name: 'Auto-open after (seconds)' }) as HTMLInputElement;
    expect([auto.value, auto.placeholder]).toEqual(['', 'Never']);
    expect(screen.getByText('LIVE PREVIEW')).toBeTruthy();
  });

  it('previews the new chat as the design draws it, from the saved settings', async () => {
    await mount();
    expect(screen.getByRole('img', { name: 'Preview of a new chat' })).toBeTruthy();
    expect(preview().getByText('TS')).toBeTruthy();
    expect(preview().getByText('Techubiz support')).toBeTruthy();
    expect(preview().getByText('We usually reply in minutes')).toBeTruthy();
    expect(preview().getByText('Hi! How can we help?')).toBeTruthy();
    expect(preview().getByText('How much is a licence?')).toBeTruthy();
    expect(preview().getByText('Track my order')).toBeTruthy();
    expect(preview().getByText('Write a message…')).toBeTruthy();
    expect(screen.getByTestId('preview-send').style.background).toBe('rgb(47, 158, 103)');
    expect(screen.getByTestId('preview-panel').style.borderRadius).toBe('16px');
    expect(screen.getByTestId('preview-button').textContent).toBe('');
  });

  it('follows every field before it is saved', async () => {
    await mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Header title' }), { target: { value: 'License Paluk help' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Header subtitle' }), { target: { value: 'Back by 9' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Welcome message' }), { target: { value: 'Ayubowan!' } });
    fireEvent.click(screen.getByRole('radio', { name: '#B4322B' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Accent colour' }), { target: { value: '#E8A33D' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Corner radius' }), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Icon + "Chat with us"' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Bottom left' }));

    // In the header, and on the button now that it has its words.
    expect(preview().getAllByText('License Paluk help')).toHaveLength(2);
    expect(preview().getByText('LH')).toBeTruthy();
    expect(preview().getByText('Back by 9')).toBeTruthy();
    expect(preview().getByText('Ayubowan!')).toBeTruthy();
    expect((preview().getByText('LH').parentElement as HTMLElement).style.background).toBe('rgb(180, 50, 43)');
    expect(screen.getByTestId('preview-send').style.background).toBe('rgb(232, 163, 61)');
    expect(screen.getByText('Corner radius · 4 px')).toBeTruthy();
    expect(screen.getByTestId('preview-panel').style.borderRadius).toBe('4px');
    expect(screen.getByTestId('preview-button').textContent).toBe('License Paluk help');
    expect(screen.getByTestId('preview-start-chat').className).toContain('items-start');
    // The breadcrumb's heading follows the name being typed.
    fireEvent.change(screen.getByRole('textbox', { name: 'Widget name' }), { target: { value: 'LP support' } });
    expect(screen.getByRole('heading', { name: 'LP support' })).toBeTruthy();
  });

  it('saves the design\'s fields, and Cancel puts back what is saved', async () => {
    await mount();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Welcome message' }), { target: { value: 'Hello there' } });
    expect(cancel.disabled).toBe(false);
    fireEvent.click(cancel);
    expect((screen.getByRole('textbox', { name: 'Welcome message' }) as HTMLInputElement).value).toBe('Hi! How can we help?');

    fireEvent.change(screen.getByRole('textbox', { name: 'Widget name' }), { target: { value: 'Techubiz help' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Accent colour' }), { target: { value: '#e8a33d' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Corner radius' }), { target: { value: '24' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Auto-open after (seconds)' }), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Icon + "Chat with us"' }));
    fireEvent.click(save);

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/chat/widget-admin/widgets/1/design', expect.anything()));
    const body = vi.mocked(apiPut).mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'Techubiz help', header_title: 'Techubiz support', header_subtitle: 'We usually reply in minutes', welcome_message: 'Hi! How can we help?',
      accent_color: '#E8A33D', border_radius: 24, auto_open_delay: 30, launcher_style: 'pill', position: 'bottom_right', brand_color: '#273498',
    });
    expect(body).not.toHaveProperty('allowed_domains');
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Widget saved — visitors see it on their next page'));
  });

  it('will not save without a name, or with an accent that is not a colour', async () => {
    await mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Widget name' }), { target: { value: '  ' } });
    expect(screen.getByText('Name this widget')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Fix the highlighted fields to save.')).toBeTruthy();
    expect(problems(design({ accent_color: 'green' })).accent_color).toBe('Use a six-digit hex colour, like #2F9E67');
    expect(problems(design({ border_radius: 40 })).border_radius).toBe('A number of pixels, 0 to 32');
  });

  it('reads a server from before S-02: the widget\'s own name, the brand as the accent, 16px and Never', () => {
    const { name: _n, header_title: _h, welcome_message: _w, accent_color: _a, border_radius: _r, auto_open_delay: _o, ...older } = design();
    void [_n, _h, _w, _a, _r, _o];
    expect(withDefaults(older as WidgetDesign, 'Main')).toMatchObject({ name: 'Main', header_title: null, welcome_message: null, accent_color: '#273498', border_radius: 16, auto_open_delay: 0 });
    expect(problems(withDefaults(older as WidgetDesign, 'Main'))).toEqual({});
  });

  it('keeps the other screens of the preview, and the rest of the look below the design\'s cards', async () => {
    await mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    expect(screen.getByRole('img', { name: 'Preview of the home screen' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Logo and theme' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Launcher' })).toBeTruthy();
    // Each is a section that folds under its header (#244), open until the person folds it.
    for (const name of ['Logo and theme', 'Home screen', 'Away screen', 'Launcher', 'Team photos']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-expanded')).toBe('true');
    }
  });

  it('opens a widget and a tab from the address: Embed code with Copy', async () => {
    tabQuery = new URLSearchParams('widget=1&tab=embed');
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    wrap(<WidgetSettings />);
    const panel = within(await screen.findByRole('tabpanel', { name: 'Embed code' }));
    expect(screen.getByRole('tab', { name: 'Embed code' }).getAttribute('aria-selected')).toBe('true');
    // Set out as the design sets it (S-03): the tag and its address, then an attribute a line; Copy copies one line.
    expect((await panel.findByLabelText('Embed code')).textContent).toBe('<script src="https://ws.example/widget.js"\n  data-widget-id="KEY1"\n  charset="utf-8"\n  async></script>');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    fireEvent.click(panel.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ROWS[0]!.embed_code));
  });

  it('opens the widget the address names, and the Chatbot is the app\'s own (S-05)', async () => {
    tabQuery = new URLSearchParams('widget=2');
    payload = { ...payload, widget: { ...payload.widget, id: 2, name: 'TechHub Lanka', domain: 'techhub.com.lk' }, design: design({ name: 'TechHub Lanka' }) };
    wrap(<WidgetSettings />);
    await screen.findByTestId('widget-preview');
    expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/widgets/2/design', undefined, expect.anything());
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe('Widgets & embed › techhub.com.lk');

    // Behaviour is built in the app since S-03 (website-s03s04.test.tsx), the Chatbot since S-05 (website-s05s07.test.tsx).
    fireEvent.click(screen.getByRole('tab', { name: 'Chatbot' }));
    expect(screen.getByRole('tab', { name: 'Chatbot' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Chatbot' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open on the web ↗' })).toBeNull();
    expect(call).not.toHaveBeenCalledWith('app:openInBrowser', expect.anything());
  });
});
