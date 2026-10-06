// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * worksuite-desktop#259. PART A: the app reads what the server's Communication module has (`GET /api/capabilities`,
 * or each screen's own 404 on a server without that list); a screen it lacks is left out, and whoever can change
 * widgets reads at the top what needs updating — "Behaviour and Insights need … (server has 2.3.1). Update server ·
 * Learn more". PART B: a save's refusal is shown under its field, on its tab, with "Appearance •" while another tab
 * is open, not as a toast; a web address typed as the company's name offers "Use 'Techubiz' as the name?"; and the
 * title is the company's name, capitalised, rather than the site's slug.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPut: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
let tabQuery = new URLSearchParams();
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ query: tabQuery, path: ['chat'], go: vi.fn(), active: true }), useTabTitle: () => undefined }));

import { ApiError, apiGet, apiPut } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { parseCapabilities, versionAtLeast } from '../../../src/core/capabilities';
import { toast } from '../../../src/core/toasts';
import type { BehaviourPayload } from '../../../src/modules/chat/website/widget/behaviourSettings';
import { nameFromAddress, widgetTitle, type DesignPayload, type WidgetDesign, type WidgetRow } from '../../../src/modules/chat/website/widget/design';
import { MIN_COMMUNICATION, lacks, useInsightsShown, versionNotice } from '../../../src/modules/chat/website/widget/serverSupport';
import { WidgetSettings } from '../../../src/modules/chat/website/widget/WidgetSettings';

const ADDRESS_RULE = "Enter the company's name here, not its web address: the widget shows it in its header";

const design = (extra: Partial<WidgetDesign> = {}): WidgetDesign => ({
  name: 'Techubiz support', header_title: null, welcome_message: null, accent_color: '#2F9E67', border_radius: 16, auto_open_delay: 0,
  website_name: 'Techubiz', brand_color: '#273498', logo_url: null, greeting: null, header_subtitle: null, quick_links: [{ label: 'Pricing', url: 'https://techubiz.com/pricing' }],
  staff_display: 'name_role', show_agents: true, offline_message: null, whatsapp_number: null,
  launcher_style: 'bubble', position: 'bottom_right', greeting_delay: 0, greeting_text: null, theme: 'light',
  launcher_offset_bottom: 20, launcher_offset_right: 20, launcher_offset_left: 20, ...extra,
});

let row: WidgetRow;
let payload: DesignPayload;
let caps: unknown;
let behaviour: BehaviourPayload | ApiError;
let whatsapp: unknown;

beforeEach(() => {
  tabQuery = new URLSearchParams('widget=1');
  row = { id: 1, name: 'Techubiz support', website_name: 'Techubiz', status: 'active' };
  payload = {
    widget: { id: 1, name: 'Techubiz support', widget_key: 'KEY1', status: 'active', domain: 'techubiz.com' },
    design: design(), agents: [], preview_agents: [], away: null, hours: null, reply_time: null, installed: true, can_manage: true,
  };
  caps = new ApiError(404, 'Not found', null);
  behaviour = {
    settings: { assignment_rule: 'round_robin', default_agent_id: null, ask_details_after_minutes: 2, missed_after_minutes: 5, inactive_after_minutes: 30, visitor_alerts: 'engaged', visitor_alert_pages: 3, allowed_domains: ['techubiz.com'] },
    embed_code: '<script src="https://suite.techubiz.com/widget.js" data-widget-id="k" async></script>', seen: null, people: [], can_manage: true,
  };
  whatsapp = { numbers: [], can_manage: true };
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    const answer = (v: unknown) => {
      if (v instanceof ApiError) throw v;
      return v;
    };
    if (path === '/api/capabilities') return answer(caps);
    if (path === '/api/chat/widget-admin/widgets') return { widgets: [row], can: { manage: payload.can_manage } };
    if (path === '/api/chat/widget-admin/widgets/1/design') return payload;
    if (path === '/api/chat/widget-admin/widgets/1/hours') return { hours: [] };
    if (path === '/api/chat/widget-admin/widgets/1/behaviour') return answer(behaviour);
    if (path === '/api/chat/widget-admin/widgets/1/whatsapp') return answer(whatsapp);
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiPut).mockReset().mockImplementation((async (_path: string, body: unknown) => ({ ...payload, design: { ...payload.design, ...(body as object) } })) as never);
  vi.mocked(toast).mockClear();
  vi.mocked(call).mockClear();
});
afterEach(() => cleanup());

const wrap = (ui: ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const mount = async () => {
  wrap(<WidgetSettings />);
  await screen.findByRole('form', { name: 'Widget settings' });
};
const tabs = () => screen.getAllByRole('tab').filter((t) => t.id.startsWith('widget-tab-')).map((t) => t.textContent);
const notice = () => screen.queryByRole('region', { name: 'Server update needed' });

describe('what the server has (#259, part A)', () => {
  it('reads the server\'s capabilities, and nothing that is not them', () => {
    const c = parseCapabilities({ communication: '2.3.1', features: ['widget.behaviour', ' chat.insights '], update_url: '/admin/modules?tab=updates', can_update: true })!;
    expect(c.versions).toEqual({ communication: '2.3.1' });
    expect([...c.features]).toEqual(['widget.behaviour', 'chat.insights']);
    expect(c.updatePath).toBe('/admin/modules?tab=updates');
    expect(parseCapabilities({ modules: { Communication: '2.4.0' }, features: [] })!.versions).toEqual({ communication: '2.4.0' });
    // "Update server" only where the server says this person may, and only to a page of its own.
    expect(parseCapabilities({ features: [], update_url: '/admin/modules', can_update: false })!.updatePath).toBeNull();
    expect(parseCapabilities({ features: [], update_url: '//evil.example/x', can_update: true })!.updatePath).toBeNull();
    expect(parseCapabilities({ features: [], update_url: 'https://evil.example/x', can_update: true })!.updatePath).toBeNull();
    expect(parseCapabilities({ widgets: [] })).toBeNull();
    expect(parseCapabilities(null)).toBeNull();
  });

  it('compares versions as numbers, and lets a screen\'s own endpoint have the last word', () => {
    expect([versionAtLeast('2.10.0', '2.4'), versionAtLeast('2.3.1', '2.4'), versionAtLeast('2.4', '2.4.0'), versionAtLeast(null, '1'), versionAtLeast('x', '1')]).toEqual([true, false, true, false, false]);
    const c = parseCapabilities({ features: ['widget.behaviour'] });
    expect(lacks('chat.insights', c)).toBe(true);
    expect(lacks('chat.insights', c, 'ok')).toBe(false);
    expect(lacks('widget.behaviour', c, 'missing')).toBe(true);
    expect(lacks('chat.insights', null)).toBe(false);
  });

  it('words the notice with the versions it knows', () => {
    expect(versionNotice(['chat.insights'], '1.40.2')).toBe('Insights needs Communication module 1.41 or later (server has 1.40.2).');
    expect(versionNotice(['chat.insights'], null)).toBe('Insights needs Communication module 1.41 or later.');
    // A version is named only when every feature's is known, and only one the server has not reached.
    expect(versionNotice(['widget.behaviour', 'chat.insights'], '2.3.1')).toBe('Behaviour and Insights need a newer Communication module (server has 2.3.1).');
    expect(versionNotice(['chat.insights'], '2.0.0')).toBe('Insights needs a newer Communication module (server has 2.0.0).');
    expect(versionNotice(['widget.whatsapp'], null)).toBe('WhatsApp numbers need a newer Communication module.');
    MIN_COMMUNICATION['widget.behaviour'] = '2.4';
    try {
      expect(versionNotice(['chat.insights', 'widget.behaviour'], '2.3.1')).toBe('Behaviour and Insights need Communication module 2.4 or later (server has 2.3.1).');
    } finally {
      delete MIN_COMMUNICATION['widget.behaviour'];
    }
    expect(versionNotice([], '2.3.1')).toBe('');
  });

  it('leaves the screens the server lacks out for somebody who cannot change widgets, with no notice', async () => {
    caps = { communication: '2.3.1', features: ['widget.behaviour'] };
    payload = { ...payload, can_manage: false };
    whatsapp = new ApiError(404, 'Not found', null);
    await mount();
    await waitFor(() => expect(tabs()).not.toContain('Contact options'));
    expect(tabs()).toContain('Behaviour');
    expect(notice()).toBeNull();
  });

  it('tells whoever can change widgets what the server lacks, and lands on Appearance instead of a missing tab', async () => {
    tabQuery = new URLSearchParams('widget=1&tab=behaviour');
    caps = { communication: '2.3.1', features: ['widget.whatsapp'] };
    behaviour = new ApiError(404, 'Not found', null);
    await mount();
    const n = await screen.findByRole('region', { name: 'Server update needed' });
    expect(n.textContent).toContain('Behaviour and Insights need a newer Communication module (server has 2.3.1).');
    expect(tabs()).not.toContain('Behaviour');
    expect(tabs()).toContain('Contact options');
    expect(screen.getByRole('tab', { name: 'Appearance' }).getAttribute('aria-selected')).toBe('true');
    // Nobody here may update the server: no button; Learn more says what it means.
    expect(within(n).queryByRole('button', { name: 'Update server' })).toBeNull();
    const more = within(n).getByRole('button', { name: 'Learn more' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(within(n).getByText(/This app is newer than the Communication module on your WorkSuite server/)).toBeTruthy();
    expect(within(n).getByText(/Ask whoever runs your WorkSuite server to update it/)).toBeTruthy();
  });

  it('offers Update server to somebody the server says may update it', async () => {
    caps = { communication: '2.3.1', features: ['widget.behaviour', 'widget.whatsapp'], update_url: '/admin/modules', can_update: true };
    await mount();
    const n = await screen.findByRole('region', { name: 'Server update needed' });
    expect(n.textContent).toContain('Insights needs a newer Communication module (server has 2.3.1).');
    fireEvent.click(within(n).getByRole('button', { name: 'Update server' }));
    expect(call).toHaveBeenCalledWith('app:openInBrowser', { path: '/admin/modules' });
  });

  it('on a server without the list, finds out from the screens themselves, as before', async () => {
    behaviour = new ApiError(404, 'Not found', null);
    await mount();
    await waitFor(() => expect(tabs()).not.toContain('Behaviour'));
    expect(notice()!.textContent).toContain('Behaviour needs a newer Communication module.');
    expect(notice()!.textContent).not.toContain('server has');
    // Everything else is there.
    expect(tabs()).toEqual(['Appearance', 'Live status & calls', 'Contact options', 'Staff', 'Hours', 'Chatbot', 'Embed code']);
  });

  it('offers Insights unless the server leaves it out, and always to whoever can change widgets', async () => {
    const Probe = ({ admin }: { admin: boolean }) => <span data-testid="insights">{String(useInsightsShown(admin))}</span>;
    caps = { communication: '2.3.1', features: ['widget.behaviour'] };
    wrap(<><Probe admin={false} /><Probe admin /></>);
    await waitFor(() => expect(screen.getAllByTestId('insights').map((e) => e.textContent)).toEqual(['false', 'true']));
    cleanup();
    caps = new ApiError(404, 'Not found', null);
    wrap(<Probe admin={false} />);
    await waitFor(() => expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/api/capabilities', undefined, expect.anything()));
    expect(screen.getByTestId('insights').textContent).toBe('true');
  });
});

describe('a refusal under its field, on its tab (#259, part B)', () => {
  it('shows the company name\'s refusal of a Behaviour save under the field on Appearance, and marks that tab', async () => {
    tabQuery = new URLSearchParams('widget=1&tab=behaviour');
    vi.mocked(apiPut).mockRejectedValueOnce(new ApiError(422, ADDRESS_RULE, null, { website_name: [ADDRESS_RULE] }));
    wrap(<WidgetSettings />);
    fireEvent.change(await screen.findByRole('spinbutton', { name: 'Count as missed after (minutes)' }), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByText("Couldn't save: fix the highlighted field on Appearance.")).getAttribute('role')).toBe('alert');
    expect(toast).not.toHaveBeenCalledWith('error', expect.anything());
    const appearance = screen.getByRole('tab', { name: 'Appearance' });
    expect(appearance.textContent).toBe('Appearance •');
    expect(appearance.getAttribute('title')).toBe('A field here needs fixing');

    fireEvent.click(appearance);
    expect(screen.getByRole('tab', { name: 'Appearance' }).textContent).toBe('Appearance');
    const field = screen.getByRole('textbox', { name: /^Website name/ });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.parentElement!.textContent).toContain(ADDRESS_RULE);
    // Changing the field takes the server's word away.
    fireEvent.change(field, { target: { value: 'Techubiz Lanka' } });
    expect(screen.queryByText(ADDRESS_RULE)).toBeNull();
  });

  it('reads a refusal that names no field but is the company name\'s rule as that field\'s', async () => {
    tabQuery = new URLSearchParams('widget=1&tab=behaviour');
    vi.mocked(apiPut).mockRejectedValueOnce(new ApiError(422, ADDRESS_RULE, null));
    wrap(<WidgetSettings />);
    fireEvent.change(await screen.findByRole('spinbutton', { name: 'Count as missed after (minutes)' }), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText("Couldn't save: fix the highlighted field on Appearance.");
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows the server\'s refusal of a design field under it, and one with no line of its own at the top of the form', async () => {
    vi.mocked(apiPut).mockRejectedValueOnce(new ApiError(422, 'Not saved', null, { 'quick_links.0.url': 'That page does not answer', greeting_text: 'Too long for the card' }));
    await mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Header title' }), { target: { value: 'Chat with Techubiz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Too long for the card', 'That page does not answer']));
    expect(toast).not.toHaveBeenCalledWith('error', expect.anything());
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Link 1 address'), { target: { value: 'https://techubiz.com/plans' } });
    expect(screen.queryByText('That page does not answer')).toBeNull();
  });

  it('keeps an error that is about no field a toast', async () => {
    vi.mocked(apiPut).mockRejectedValueOnce(new ApiError(500, 'Server error', null));
    await mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Header title' }), { target: { value: 'Chat with Techubiz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', expect.stringContaining('Server error')));
  });

  it('suggests the name a web address stands for, one click away: a hint for a bare domain, with the refusal for a full address', async () => {
    await mount();
    const field = screen.getByRole('textbox', { name: /^Website name/ });
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    fireEvent.change(field, { target: { value: 'techubiz.com' } });
    expect(screen.getByText("Use 'Techubiz' as the name?")).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(save.disabled).toBe(false);

    fireEvent.change(field, { target: { value: 'https://www.techubiz.com/' } });
    expect(screen.getByText("Use 'Techubiz' as the name?")).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Use it' }));
    expect((field as HTMLInputElement).value).toBe('Techubiz');
    expect(screen.queryByText("Use 'Techubiz' as the name?")).toBeNull();
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(save.disabled).toBe(false);
    // "Booking.com" is a name, not a slip.
    fireEvent.change(field, { target: { value: 'Booking.com' } });
    expect(screen.queryByRole('button', { name: 'Use it' })).toBeNull();
  });
});

describe('the title (#259)', () => {
  it('reads a name from a web address, and titles a widget named for its site by the company', () => {
    expect([nameFromAddress('techubiz.com'), nameFromAddress('https://www.tender-hub.co.uk/contact'), nameFromAddress('shop.techhub.com.lk'), nameFromAddress('techubiz'), nameFromAddress('')]).toEqual(['Techubiz', 'Tender Hub', 'Techhub', 'Techubiz', null]);
    expect(widgetTitle('techubiz', null)).toBe('Techubiz');
    expect(widgetTitle('techubiz.com', 'Techubiz Lanka')).toBe('Techubiz Lanka');
    expect(widgetTitle('techubiz', 'https://techubiz.com')).toBe('Techubiz');
    expect(widgetTitle('Techubiz support', 'Something else')).toBe('Techubiz support');
    expect(widgetTitle('LP support', null)).toBe('LP support');
  });

  it('shows the company\'s name over a slug, following the field', async () => {
    row = { ...row, name: 'techubiz', website_name: null };
    payload = { ...payload, widget: { ...payload.widget, name: 'techubiz' }, design: design({ name: 'techubiz', website_name: null }) };
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Techubiz');
    fireEvent.change(screen.getByRole('textbox', { name: /^Website name/ }), { target: { value: 'Techubiz Lanka (Pvt) Ltd' } });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Techubiz Lanka (Pvt) Ltd');
  });
});
