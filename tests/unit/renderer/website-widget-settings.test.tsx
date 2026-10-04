// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Website chats → Widget (worksuite-desktop#199): the visitor widget's design edited beside a live preview — the brand
 * colour and its contrast, the greeting and quick links, whose photos are shown and how they are named, business hours
 * and the away screen, the launcher and its greeting card — and a save that sends the design and nothing else.
 *
 * #207: the theme, the launcher's offsets, a company name that is never a web address, and the preview as the widget
 * now draws itself (expand and minimise in its header, who is online over when they reply, a start card that is just the
 * message box).
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPut: vi.fn(), apiPost: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ query: new URLSearchParams(), path: ['chat'], go: vi.fn(), active: true }), useTabTitle: () => undefined }));

import { apiGet, apiPut } from '../../../src/core/api';
import { toast } from '../../../src/core/toasts';
import { clampOffset, contrast, hoursText, looksLikeAddress, namesLine, palette, previewPeople, problems, siteNameOf, weekOf, withDefaults, type DesignPayload, type WidgetDesign } from '../../../src/modules/chat/website/widget/design';
import { WidgetSettings } from '../../../src/modules/chat/website/widget/WidgetSettings';

const design = (extra: Partial<WidgetDesign> = {}): WidgetDesign => ({
  name: 'Main', header_title: 'Chat with us', welcome_message: null, accent_color: '#2F3FB5', border_radius: 16, auto_open_delay: 0,
  website_name: 'Livezen Technologies', brand_color: '#2F3FB5', logo_url: null, greeting: 'Hi there,\nhow can we help?', header_subtitle: null,
  quick_links: [{ label: 'Pricing and plans', url: 'https://livezen.example/pricing' }], staff_display: 'name_role', show_agents: true,
  offline_message: null, whatsapp_number: '+94771234567', launcher_style: 'pill', position: 'bottom_right', greeting_delay: 5,
  greeting_text: 'Hi there. Looking for hosting, a website or WorkSuite?', theme: 'auto', dark_mode: 'auto',
  launcher_offset_bottom: 20, launcher_offset_right: 20, launcher_offset_left: 20, ...extra,
});

let payload: DesignPayload;
const hours = { hours: [1, 2, 3, 4, 5].map((d) => ({ weekday: d, is_open: true, opens_at: '09:00:00', closes_at: '17:00:00', timezone: 'Asia/Colombo' })), default_timezone: 'Asia/Colombo' };

beforeEach(() => {
  payload = {
    widget: { id: 1, name: 'Main', widget_key: 'k', status: 'active' },
    design: design(),
    agents: [
      { user_id: 3, name: 'Samali Gunawardane', role: 'Customer success', avatar: null, shown: true, active: true, presence: 'online' },
      { user_id: 7, name: 'Dimuthu Abeysekara', role: 'Sales', avatar: null, shown: true, active: true, presence: 'away' },
      { user_id: 8, name: 'Kasun Jayasuriya', role: 'Support', avatar: null, shown: false, active: true, presence: 'online' },
    ],
    preview_agents: [],
    away: null,
    hours: { timezone: 'Asia/Colombo', zone: 'Sri Lanka time', text: 'Mon–Fri, 9:00 AM–5:00 PM', open_now: false, back_at: '9:00 AM tomorrow' },
    reply_time: 'Usually replies in a few minutes',
    installed: true,
    can_manage: true,
  };
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/widgets') return { widgets: [{ id: 1, name: 'Main', website_name: 'Livezen Technologies', status: 'active' }] };
    if (path === '/api/chat/widget-admin/widgets/1/design') return payload;
    if (path === '/api/chat/widget-admin/widgets/1/hours') return hours;
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiPut).mockReset().mockImplementation((async (_path: string, body: unknown) => ({ ...payload, design: { ...payload.design, ...(body as object) } })) as never);
  vi.mocked(toast).mockClear();
});
afterEach(() => cleanup());

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WidgetSettings />
    </QueryClientProvider>,
  );
const preview = () => within(screen.getByTestId('widget-preview'));

describe('the design rules, as the widget and the server keep them', () => {
  it('puts white on a deep brand colour and ink on a light one, and darkens the colour where it is text on white', () => {
    expect(palette('#2F3FB5')).toMatchObject({ onAccent: '#ffffff', lightBrand: false });
    const yellow = palette('#FACC15');
    expect(yellow).toMatchObject({ onAccent: '#121633', lightBrand: true });
    expect(yellow.accentText).not.toBe('#facc15');
  });

  it('refuses what the server would: a bad colour, a script link, a sixth link, a number without enough digits', () => {
    expect(problems(design())).toEqual({});
    expect(problems(design({ brand_color: 'blue' })).brand_color).toBeTruthy();
    expect(problems(design({ logo_url: 'javascript:alert(1)' })).logo_url).toBeTruthy();
    expect(problems(design({ quick_links: [{ label: 'x', url: 'javascript:alert(1)' }] })).quick_links).toBe('Quick links must start with https://, mailto: or tel:');
    expect(problems(design({ quick_links: Array(6).fill({ label: 'x', url: 'https://a.b' }) })).quick_links).toBe('Up to 5 quick links');
    expect(problems(design({ whatsapp_number: '123' })).whatsapp_number).toBeTruthy();
  });

  it('words the hours as the away screen does, and reads midnight-to-midnight as no hours at all', () => {
    expect(hoursText(weekOf(hours).days)).toBe('Mon–Fri, 9:00 AM–5:00 PM');
    const always = { hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, is_open: true, opens_at: '00:00:00', closes_at: '23:59:59', timezone: 'UTC' })) };
    expect(weekOf(always).configured).toBe(false);
    expect(weekOf(undefined).timezone).toBe('Asia/Colombo');
  });

  it('previews the staffed people whose photos are shown, as the setting names them', () => {
    const { people } = previewPeople(payload, design({ staff_display: 'first_name' }), {});
    expect(people.map((p) => [p.name, p.role])).toEqual([['Samali', null], ['Dimuthu', null]]);
    expect(previewPeople(payload, design(), { 8: true, 3: false }).people.map((p) => p.name)).toEqual(['Kasun Jayasuriya', 'Dimuthu Abeysekara']);
    expect(previewPeople({ agents: [], preview_agents: [] }, design(), {}).sample).toBe(true);
    expect(namesLine(['Dimuthu', 'Samali', 'Hasarinda', 'Kasun'])).toBe('Dimuthu, Samali, Hasarinda and 1 more');
  });

  it('never names the company by its web address: refused, and the organisation\'s name in its place (#207)', () => {
    for (const address of ['https://tenderhub.lk/', 'http://tenderhub.lk', 'www.tenderhub.lk', 'tenderhub.lk/contact']) {
      expect(looksLikeAddress(address)).toBe(true);
      expect(problems(design({ website_name: address })).website_name).toBe('Enter the company\'s name, not its web address: the widget shows it in its header');
      expect(siteNameOf({ website_name: address }, 'Tender Hub (Pvt) Ltd')).toBe('Tender Hub (Pvt) Ltd');
    }
    expect(looksLikeAddress('Booking.com')).toBe(false);
    expect(siteNameOf({ website_name: 'Tender Hub' }, 'Org')).toBe('Tender Hub');
    expect(siteNameOf({ website_name: null }, null)).toBeNull();
  });

  it('holds the launcher\'s offsets to 0–200px, reads a server from before #207, and darkens the header for the dark theme', () => {
    expect([clampOffset(-4), clampOffset(36.4), clampOffset(900), clampOffset(Number.NaN)]).toEqual([0, 36, 200, 20]);
    expect(problems(design({ launcher_offset_bottom: 250 })).launcher_offset_bottom).toBe('A number of pixels, 0 to 200');
    const older = { ...design(), theme: undefined, launcher_offset_bottom: undefined, launcher_offset_right: undefined, launcher_offset_left: undefined, dark_mode: 'dark' } as unknown as WidgetDesign;
    expect(withDefaults(older)).toMatchObject({ theme: 'dark', launcher_offset_bottom: 20, launcher_offset_right: 20, launcher_offset_left: 20 });

    const hd = palette('#3B82F6').darkHeader;
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    expect(contrast([255, 255, 255], rgb(hd))).toBeGreaterThanOrEqual(5.5);
    expect(hd).not.toBe('#3b82f6');
  });
});

describe('Website chats → Widget', () => {
  it('previews the home screen from the saved design: greeting, photos with green dots, reply time and quick help', async () => {
    mount();
    await screen.findByTestId('widget-preview');
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    expect(screen.getByRole('img', { name: 'Preview of the home screen' })).toBeTruthy();
    expect(preview().getByText(/Hi there,/)).toBeTruthy();
    // One status line (#207).
    expect(preview().getByText('Samali and Dimuthu are online')).toBeTruthy();
    expect(preview().getByText('Usually replies in a few minutes')).toBeTruthy();
    expect(preview().getByText('Pricing and plans')).toBeTruthy();
    expect(preview().getByText('SG')).toBeTruthy();
  });

  it('follows every edit before it is saved: the colour, the greeting, the names', async () => {
    mount();
    await screen.findByTestId('widget-preview');

    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Brand colour' }), { target: { value: '#FACC15' } });
    fireEvent.change(screen.getByLabelText('Greeting'), { target: { value: 'Welcome to Livezen' } });
    // Whose photos and how they are named: the Team photos card under Appearance, since S-04 gave Staff its table.
    fireEvent.click(screen.getByRole('radio', { name: 'First name only' }));

    expect(preview().getByText('Welcome to Livezen')).toBeTruthy();
    // Light brand: the header's text turns ink so it stays readable.
    expect((preview().getByText('Welcome to Livezen').closest('[style]') as HTMLElement).style.color).toBe('rgb(18, 22, 51)');
    expect(screen.getByText('A light colour: text on it will be dark, so it stays readable.')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
    expect(preview().getByText('Samali')).toBeTruthy();
    expect(preview().queryByText(/Customer success/)).toBeNull();
  });

  it('shows the away screen with the hours being edited, the away message and WhatsApp', async () => {
    mount();
    await screen.findByTestId('widget-preview');
    // The design's "Offline message" (S-02) is the away screen's message; the hours are on the Hours tab.
    fireEvent.change(screen.getByLabelText('Offline message'), { target: { value: 'We are closed for the holiday.' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Hours' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Open on Saturday' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Away' }));

    expect(preview().getByText('We are closed for the holiday.')).toBeTruthy();
    expect(preview().getByText('Back at 9:00 AM tomorrow')).toBeTruthy();
    expect(preview().getByText('Business hours: Mon–Sat, 9:00 AM–5:00 PM (Sri Lanka time)')).toBeTruthy();
    expect(preview().getByText('+94771234567')).toBeTruthy();
  });

  it('previews the launcher with its greeting card, or without one when its delay is off', async () => {
    mount();
    await screen.findByTestId('widget-preview');
    fireEvent.click(screen.getByRole('tab', { name: 'Launcher' }));
    expect(preview().getByText('Hi there. Looking for hosting, a website or WorkSuite?')).toBeTruthy();
    expect(preview().getByText('Samali from Livezen Technologies')).toBeTruthy();
    expect(preview().getByText('Chat with us')).toBeTruthy();

    fireEvent.change(screen.getByRole('spinbutton', { name: /Greeting card after \(seconds\)/ }), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Icon' }));
    expect(preview().queryByText('Hi there. Looking for hosting, a website or WorkSuite?')).toBeNull();
    expect(preview().queryByText('Chat with us')).toBeNull();
  });

  it('saves the design and whose photos are shown — never the widget\'s domains or status — and the hours', async () => {
    mount();
    await screen.findByTestId('widget-preview');
    fireEvent.change(screen.getByLabelText('Link 1 label'), { target: { value: 'Plans' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a link' }));
    fireEvent.change(screen.getByLabelText('Link 2 label'), { target: { value: 'Book a demo' } });
    fireEvent.change(screen.getByLabelText('Link 2 address'), { target: { value: 'https://livezen.example/demo' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Show Kasun Jayasuriya to visitors' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Hours' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Open on Saturday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/chat/widget-admin/widgets/1/design', expect.anything()));
    const body = vi.mocked(apiPut).mock.calls.find(([p]) => p === '/api/chat/widget-admin/widgets/1/design')![1] as Record<string, unknown>;
    expect(body.quick_links).toEqual([{ label: 'Plans', url: 'https://livezen.example/pricing' }, { label: 'Book a demo', url: 'https://livezen.example/demo' }]);
    expect(body.agents).toEqual([{ user_id: 8, shown: true }]);
    expect(body).not.toHaveProperty('allowed_domains');
    // The widget's name is on the Appearance tab since S-02; its domains and status are still the web's.
    expect(body.name).toBe('Main');
    expect(body).not.toHaveProperty('status');
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/chat/widget-admin/widgets/1/hours', expect.objectContaining({ timezone: 'Asia/Colombo' })));
    const week = (vi.mocked(apiPut).mock.calls.find(([p]) => p === '/api/chat/widget-admin/widgets/1/hours')![1] as { days: Array<{ weekday: number; is_open: boolean }> }).days;
    expect(week.find((d) => d.weekday === 6)!.is_open).toBe(true);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Widget saved — visitors see it on their next page'));
  });

  it('will not save a link that would put a script on the customer\'s page, and says why', async () => {
    mount();
    await screen.findByTestId('widget-preview');
    fireEvent.change(screen.getByLabelText('Link 1 address'), { target: { value: 'javascript:alert(1)' } });
    expect(screen.getByRole('alert').textContent).toBe('Quick links must start with https://, mailto: or tel:');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('previews the header as the widget draws it now: the name, expand and minimise (W-02), and a start card that is just the box (#207)', async () => {
    mount();
    await screen.findByTestId('widget-preview');
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    expect(preview().getByText('Livezen Technologies')).toBeTruthy();
    expect(screen.getByTestId('preview-logo').textContent).toBe('L');
    const controls = within(screen.getAllByTestId('preview-controls')[0]!);
    expect(controls.getAllByTitle(/chat$/).map((c) => c.getAttribute('title'))).toEqual(['Expand chat', 'Minimise chat']);
    expect(preview().queryByText('Start a conversation')).toBeNull();
    expect(preview().queryByText('We are online')).toBeNull();
    expect(preview().queryByText(/Type your question/)).toBeNull();
    expect(screen.getByTestId('preview-start').textContent).toBe('Write a message…');

    fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
    expect(screen.getAllByTestId('preview-controls')).toHaveLength(1);
  });

  it('shows the organisation\'s name in place of a web address, and will not save the address (#207)', async () => {
    payload = { ...payload, fallback_name: 'Livezen Technologies (Pvt) Ltd', design: design({ website_name: 'https://tenderhub.lk/' }) };
    mount();
    await screen.findByTestId('widget-preview');
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    expect(preview().getByText('Livezen Technologies (Pvt) Ltd')).toBeTruthy();
    expect(preview().queryByText(/tenderhub/)).toBeNull();
    expect(screen.getByTestId('preview-logo').textContent).toBe('L');
    expect(screen.getByText('Enter the company\'s name, not its web address: the widget shows it in its header')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox', { name: /Website name/ }), { target: { value: '' } });
    expect(preview().getByText('Livezen Technologies (Pvt) Ltd')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('previews the dark theme with a darker brand header, and the launcher where its offsets put it (#207)', async () => {
    mount();
    await screen.findByTestId('widget-preview');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    const header = preview().getByText(/Hi there,/).closest('[style]') as HTMLElement;
    expect(header.style.background).not.toBe('');
    expect(header.style.color).toBe('rgb(255, 255, 255)');
    const dark = palette('#2F3FB5').darkHeader;
    expect(header.style.background).toBe(`rgb(${[1, 3, 5].map((i) => parseInt(dark.slice(i, i + 2), 16)).join(', ')})`);

    fireEvent.click(screen.getByRole('tab', { name: 'Launcher' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /From the bottom \(px\)/ }), { target: { value: '90' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /From the right \(px\)/ }), { target: { value: '999' } });
    const corner = screen.getByTestId('preview-corner');
    expect([corner.style.bottom, corner.style.right]).toEqual(['90px', '200px']);
    expect(preview().getByText('90px from the bottom, 200px from the right')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Bottom left' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /From the left \(px\)/ }), { target: { value: '12' } });
    expect([corner.style.bottom, corner.style.left]).toEqual(['90px', '12px']);
  });

  it('saves the theme as `theme` and the offsets, never the older `dark_mode` (#207)', async () => {
    mount();
    await screen.findByTestId('widget-preview');
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /From the bottom \(px\)/ }), { target: { value: '84' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/chat/widget-admin/widgets/1/design', expect.anything()));
    const body = vi.mocked(apiPut).mock.calls.find(([p]) => p === '/api/chat/widget-admin/widgets/1/design')![1] as Record<string, unknown>;
    expect(body).toMatchObject({ theme: 'light', launcher_offset_bottom: 84, launcher_offset_right: 20, launcher_offset_left: 20 });
    expect(body).not.toHaveProperty('dark_mode');
  });

  it('reads a server from before #207: the theme from `dark_mode`, and the offsets at 20px', async () => {
    const { theme: _t, launcher_offset_bottom: _b, launcher_offset_right: _r, launcher_offset_left: _l, ...older } = design({ dark_mode: 'dark' });
    void [_t, _b, _r, _l];
    payload = { ...payload, design: older as WidgetDesign };
    mount();
    await screen.findByTestId('widget-preview');
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('spinbutton', { name: /From the bottom \(px\)/ }) as HTMLInputElement).value).toBe('20');
  });

  it('lets somebody without the permission look but not change anything', async () => {
    payload = { ...payload, can_manage: false };
    mount();
    await screen.findByTestId('widget-preview');
    expect(screen.getByRole('note').textContent).toContain('Create and configure chat widgets');
    expect((screen.getByLabelText('Greeting') as HTMLTextAreaElement).closest('fieldset')!.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
