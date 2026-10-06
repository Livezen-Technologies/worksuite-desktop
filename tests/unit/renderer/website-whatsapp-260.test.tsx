// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Widget settings › Contact options (worksuite-desktop#260): the WhatsApp numbers the widget offers. Added from
 * WorkSuite's own WhatsApp (each number once, however many connections share it, with Connected / Not connected) or
 * typed in with a country (Sri Lanka unless another is picked) and kept in E.164; each with a label, a pre-filled
 * message and when it shows; reordered by dragging or with its arrows, edited, removed and tested; saved as one list
 * with "Saved · live on techubiz.com within 1 minute"; the server's refusals under their field; and on a server
 * without the list, the notice that it needs updating, with the away screen's one number kept as it was.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPut: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
let tabQuery = new URLSearchParams();
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ query: tabQuery, path: ['chat'], go: vi.fn(), active: true }), useTabTitle: () => undefined }));

import { ApiError, apiGet, apiPost, apiPut } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import type { DesignPayload, WidgetDesign } from '../../../src/modules/chat/website/widget/design';
import { WidgetSettings } from '../../../src/modules/chat/website/widget/WidgetSettings';
import {
  connectionNote,
  connectionOf,
  defaultMessage,
  moveRow,
  numberOf,
  pickerChoices,
  rowProblems,
  rowsOf,
  savedText,
  serverIssues,
  typedProblem,
  unlistedNames,
  waLink,
  wireNumbers,
  type WaPickAccount,
  type WidgetWaNumber,
  type WidgetWaPayload,
} from '../../../src/modules/chat/website/widget/whatsappNumbers';

// "hasa" and "Support" are two WorkSuite connections on the same number (the duplicate number bug).
const ACCOUNTS: WaPickAccount[] = [
  { id: 1, name: 'hasa', phone: '94769136424', status: 'connected', provider: 'web_js', connected_at: '2026-10-01 09:00:00' },
  { id: 2, name: 'Support', phone: '+94 76 913 6424', status: 'disconnected', provider: 'web_js', connected_at: '2026-09-20 09:00:00' },
  { id: 3, name: 'Sales line', phone: '0771234567', status: 'disconnected', provider: 'cloud_api' },
  { id: 4, name: 'New phone', phone: null, status: 'qr_required', provider: 'web_js' },
];

const number = (extra: Partial<WidgetWaNumber> = {}): WidgetWaNumber => ({
  id: 11, source: 'manual', account_id: null, phone: '+94712345678', label: 'Sales', message: "Hi, I'm on techubiz.com (ref {visitor_ref})", show: 'always', ...extra,
});

const design = (extra: Partial<WidgetDesign> = {}): WidgetDesign => ({
  name: 'Techubiz support', header_title: null, welcome_message: null, accent_color: '#2F9E67', border_radius: 16, auto_open_delay: 0,
  website_name: 'Techubiz', brand_color: '#273498', logo_url: null, greeting: null, header_subtitle: null, quick_links: [],
  staff_display: 'name_role', show_agents: true, offline_message: null, whatsapp_number: null,
  launcher_style: 'bubble', position: 'bottom_right', greeting_delay: 0, greeting_text: null, theme: 'light',
  launcher_offset_bottom: 20, launcher_offset_right: 20, launcher_offset_left: 20, ...extra,
});

let payload: DesignPayload;
let wa: WidgetWaPayload | ApiError;

beforeEach(() => {
  tabQuery = new URLSearchParams({ tab: 'contact' });
  payload = {
    widget: { id: 1, name: 'Techubiz support', widget_key: 'KEY1', status: 'active', domain: 'techubiz.com' },
    design: design(), agents: [], preview_agents: [], away: null, hours: null, reply_time: null, installed: true, can_manage: true,
  };
  wa = {
    numbers: [number(), number({ id: 12, source: 'worksuite', account_id: 2, phone: '+94769136424', label: 'Support', show: 'connected' })],
    can_manage: true, cache_seconds: 60, can_refresh: true,
  };
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/widgets') return { widgets: [{ id: 1, name: 'Techubiz support', website_name: 'Techubiz', status: 'active' }], can: { manage: true } };
    if (path === '/api/chat/widget-admin/widgets/1/design') return payload;
    if (path === '/api/chat/widget-admin/widgets/1/hours') return { hours: [] };
    if (path === '/api/chat/widget-admin/widgets/1/whatsapp') {
      if (wa instanceof ApiError) throw wa;
      return wa;
    }
    if (path === '/api/whatsapp/accounts') return { accounts: ACCOUNTS, default_id: 1 };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiPut).mockReset().mockImplementation((async (path: string, body: { numbers?: WidgetWaNumber[] }) => {
    if (path.endsWith('/whatsapp')) return { ...(wa as WidgetWaPayload), numbers: body.numbers!.map((n, i) => ({ ...n, id: n.id ?? 100 + i })) };
    return { ...payload, design: { ...payload.design, ...(body as object) } };
  }) as never);
  vi.mocked(apiPost).mockReset().mockImplementation((async () => ({ refreshed_at: '2026-10-06 10:00:00' })) as never);
  vi.mocked(toast).mockClear();
  vi.mocked(call).mockClear();
});
afterEach(() => cleanup());

const mount = async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WidgetSettings />
    </QueryClientProvider>,
  );
  await screen.findByRole('list', { name: 'WhatsApp numbers' });
};
const list = () => within(screen.getByRole('list', { name: 'WhatsApp numbers' }));
const saveNow = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
const sent = () => (vi.mocked(apiPut).mock.calls.find(([p]) => p === '/api/chat/widget-admin/widgets/1/whatsapp')![1] as { numbers: WidgetWaNumber[] }).numbers;
const pick = (name: string, option: string | RegExp) => {
  fireEvent.click(screen.getByRole('combobox', { name }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};

describe('reading and checking WhatsApp numbers (#260)', () => {
  it('keeps every number in E.164, reading a local one or one with spaces in Sri Lanka unless another country is picked', () => {
    expect(numberOf('0769 136 424')).toBe('+94769136424');
    expect(numberOf('076-913-6424')).toBe('+94769136424');
    expect(numberOf('+94 76 913 6424')).toBe('+94769136424');
    expect(numberOf('0094769136424')).toBe('+94769136424');
    expect(numberOf('07911 123456', 'GB')).toBe('+447911123456');
    expect(numberOf('12')).toBeNull();
    expect(typedProblem('0769 136 424')).toBeNull();
    expect(typedProblem('123')).toBe('Enter a valid number');
    expect(typedProblem('')).toBe('Enter a valid number');
  });

  it('says what is wrong with a number in the list, beside the field it is about', () => {
    const rows = rowsOf([
      number({ label: '' }),
      number({ id: 12, phone: '+94 71 234 5678', label: 'Twice' }),
      number({ id: 13, phone: '12', label: 'Short' }),
      number({ id: 14, phone: '+94771234567', label: 'Typed', show: 'connected' }),
      number({ id: 15, source: 'worksuite', account_id: null, phone: '+94769136424', label: 'Picked' }),
    ]);
    const p = rowProblems(rows);
    expect(p[rows[0]!.key]).toEqual({ label: 'Give it a label, like Sales or Support' });
    expect(p[rows[1]!.key]).toEqual({ phone: 'This number is already on the list' });
    expect(p[rows[2]!.key]).toEqual({ phone: 'Enter a valid number' });
    expect(p[rows[3]!.key]).toEqual({ show: 'Only a WorkSuite WhatsApp number can follow its connection' });
    expect(p[rows[4]!.key]).toEqual({ phone: 'Choose a WorkSuite WhatsApp number' });
    expect(rowProblems(rowsOf([number()]))).toEqual({});
  });

  it('offers each WorkSuite number once, with every connection on it, connected when any of them is', () => {
    expect(pickerChoices(ACCOUNTS)).toEqual([
      { phone: '+94769136424', names: ['hasa', 'Support'], account_id: 1, account_ids: [1, 2], connected: true },
      { phone: '+94771234567', names: ['Sales line'], account_id: 3, account_ids: [3], connected: false },
    ]);
    expect(unlistedNames(ACCOUNTS)).toEqual(['New phone']);
    // The connected one answers, whichever comes first.
    const reversed = pickerChoices([ACCOUNTS[1]!, ACCOUNTS[0]!]);
    expect(reversed[0]).toMatchObject({ names: ['Support', 'hasa'], account_id: 1, connected: true });
  });

  it('reads a WorkSuite number\'s connection from WhatsApp, else the server, and says what a disconnected one means', () => {
    const support = number({ source: 'worksuite', account_id: 2, phone: '+94769136424', show: 'connected' });
    const sales = number({ source: 'worksuite', account_id: 3, phone: '+94771234567', show: 'connected' });
    expect(connectionOf(support, ACCOUNTS)).toBe(true);
    expect(connectionOf(sales, ACCOUNTS)).toBe(false);
    expect(connectionOf({ ...sales, account_id: 99, phone: '+94700000000', connected: true }, ACCOUNTS)).toBe(true);
    expect(connectionOf(number(), ACCOUNTS)).toBeNull();
    expect(connectionNote(sales, false)).toBe("This number isn't connected; the widget will hide it until it's linked");
    expect(connectionNote({ ...sales, show: 'always' }, false)).toBe("This number isn't connected, so replies won't come into WorkSuite until it's linked");
    expect(connectionNote(sales, true)).toBeNull();
  });

  it('sends the list in its order, numbers in E.164, a typed one without an account; and says when it is live', () => {
    const rows = rowsOf([number({ phone: '0712 345 678 ', label: ' Sales ' }), number({ id: null, source: 'worksuite', account_id: 1, phone: '+94769136424', label: 'Support' })]);
    expect(wireNumbers(moveRow(rows, rows[1]!.key, 0))).toEqual([
      { source: 'worksuite', account_id: 1, phone: '+94769136424', label: 'Support', message: "Hi, I'm on techubiz.com (ref {visitor_ref})", show: 'always' },
      { id: 11, source: 'manual', account_id: null, phone: '+94712345678', label: 'Sales', message: "Hi, I'm on techubiz.com (ref {visitor_ref})", show: 'always' },
    ]);
    expect(defaultMessage('techubiz.com')).toBe("Hi, I'm on techubiz.com (ref {visitor_ref})");
    expect(waLink('0769 136 424', defaultMessage('techubiz.com'))).toBe("https://wa.me/94769136424?text=Hi%2C%20I'm%20on%20techubiz.com%20(ref%20TEST)");
    expect(savedText('techubiz.com', 60)).toBe('Saved · live on techubiz.com within 1 minute');
    expect(savedText('techubiz.com', 300)).toBe('Saved · live on techubiz.com within 5 minutes');
    expect(savedText('techubiz.com', null)).toBe("Saved · live on techubiz.com on visitors' next page");
  });

  it('puts the server\'s refusal under the number it is about', () => {
    const rows = rowsOf([number(), number({ id: 12, phone: '+94769136424' })]);
    const e = new ApiError(422, 'The numbers could not be saved.', null, { 'numbers.1.phone': ['This number is not on WhatsApp'], numbers: 'Up to 5 numbers' });
    expect(serverIssues(e, rows)).toEqual({ rows: { [rows[1]!.key]: { phone: 'This number is not on WhatsApp' } }, general: 'Up to 5 numbers' });
    expect(serverIssues(new Error('offline'), rows)).toEqual({ rows: {}, general: null });
  });
});

describe('Widget settings › Contact options (#260)', () => {
  it('lists the numbers with where each comes from, its connection and when it shows', async () => {
    await mount();
    expect(screen.getByRole('tab', { name: 'Contact options' }).getAttribute('aria-selected')).toBe('true');
    const rows = list().getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Sales · +94 71 234 5678', 'Support · +94 76 913 6424']);
    expect(within(rows[0]!).getByText('Entered number · Always')).toBeTruthy();
    // "Support" shares its number with the connected "hasa": the number is connected.
    await waitFor(() => expect(within(rows[1]!).getByText('Connected')).toBeTruthy());
    expect(within(rows[1]!).getByText('WorkSuite WhatsApp · hasa, Support · Only when connected')).toBeTruthy();
  });

  it('adds a typed number, converted from its local form, with the default message, and saves it', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add WhatsApp number' }));
    fireEvent.click(screen.getByRole('button', { name: /Enter a number/ }));
    expect(screen.getByRole('combobox', { name: 'Country' }).textContent).toContain('Sri Lanka (+94)');
    fireEvent.change(screen.getByRole('textbox', { name: /^WhatsApp number/ }), { target: { value: '0777 654 321' } });
    expect(screen.getByText('Saved as +94 77 765 4321')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Support desk' } });
    expect((screen.getByLabelText('Pre-filled message') as HTMLTextAreaElement).value).toBe("Hi, I'm on techubiz.com (ref {visitor_ref})");
    pick('When to show', 'Only outside business hours');
    // A typed number has no connection to follow.
    fireEvent.click(screen.getByRole('combobox', { name: 'When to show' }));
    expect(screen.queryByRole('option', { name: 'Only when connected' })).toBeNull();
    fireEvent.click(screen.getByRole('combobox', { name: 'When to show' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add number' }));
    expect(list().getAllByRole('listitem')).toHaveLength(3);

    saveNow();
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/chat/widget-admin/widgets/1/whatsapp', expect.anything()));
    expect(sent()[2]).toEqual({ source: 'manual', account_id: null, phone: '+94777654321', label: 'Support desk', message: "Hi, I'm on techubiz.com (ref {visitor_ref})", show: 'outside_hours' });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Saved · live on techubiz.com within 1 minute'));
    expect(screen.getByRole('status').textContent).toBe('Saved · live on techubiz.com within 1 minute');

    // The server can end the widget's cache.
    fireEvent.click(screen.getByRole('button', { name: 'Refresh widget now' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/widgets/1/refresh'));
  });

  it('says "Enter a valid number" under the field, and adds nothing', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add WhatsApp number' }));
    fireEvent.click(screen.getByRole('button', { name: /Enter a number/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /^WhatsApp number/ }), { target: { value: '123' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Typo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add number' }));
    const field = screen.getByRole('textbox', { name: /^WhatsApp number/ });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.parentElement!.textContent).toContain('Enter a valid number');
    // The same number twice is refused too.
    fireEvent.change(field, { target: { value: '0769 136 424' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add number' }));
    expect(field.parentElement!.textContent).toContain('This number is already on the list');
    expect(list().getAllByRole('listitem')).toHaveLength(2);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('chooses a WorkSuite number from the picker, each number once, and warns when it is not connected', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add WhatsApp number' }));
    fireEvent.click(screen.getByRole('button', { name: /Choose from WorkSuite WhatsApp/ }));
    await screen.findByRole('combobox', { name: 'WorkSuite WhatsApp number' });
    fireEvent.click(screen.getByRole('combobox', { name: 'WorkSuite WhatsApp number' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['+94 76 913 6424 · hasa, SupportConnected', '+94 77 123 4567 · Sales lineNot connected']);
    fireEvent.click(screen.getByRole('option', { name: /Sales line/ }));
    expect(screen.getByText('Not listed until a number is linked: New phone')).toBeTruthy();
    // The label follows the number's name until one is typed.
    expect((screen.getByRole('textbox', { name: 'Label' }) as HTMLInputElement).value).toBe('Sales line');
    pick('When to show', 'Only when connected');
    expect(screen.getByText("This number isn't connected; the widget will hide it until it's linked")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add number' }));
    const added = list().getAllByRole('listitem')[2]!;
    expect(within(added).getByText('Not connected')).toBeTruthy();
    expect(within(added).getByText("This number isn't connected; the widget will hide it until it's linked")).toBeTruthy();

    saveNow();
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(sent()[2]).toMatchObject({ source: 'worksuite', account_id: 3, phone: '+94771234567', label: 'Sales line', show: 'connected' });
  });

  it('reorders with the arrows and by dragging, edits and removes, and saves the list in its new order', async () => {
    wa = { ...(wa as WidgetWaPayload), numbers: [...(wa as WidgetWaPayload).numbers, number({ id: 13, phone: '+94112345678', label: 'Office' })] };
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Move Office up' }));
    expect(list().getAllByRole('listitem').map((r) => r.getAttribute('aria-label')?.split(' · ')[0])).toEqual(['Sales', 'Office', 'Support']);
    expect((screen.getByRole('button', { name: 'Move Sales up' }) as HTMLButtonElement).disabled).toBe(true);

    // Support dragged onto Sales takes its place.
    const [sales, , support] = list().getAllByRole('listitem');
    fireEvent.dragStart(support!);
    fireEvent.dragOver(sales!);
    fireEvent.drop(sales!);
    expect(list().getAllByRole('listitem').map((r) => r.getAttribute('aria-label')?.split(' · ')[0])).toEqual(['Support', 'Sales', 'Office']);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Office' }));
    fireEvent.change(screen.getByRole('textbox', { name: /^WhatsApp number/ }), { target: { value: '011 234 5679' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Head office' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sales' }));

    saveNow();
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(sent().map((n) => [n.id, n.label, n.phone])).toEqual([[12, 'Support', '+94769136424'], [13, 'Head office', '+94112345679']]);
  });

  it('keeps a WorkSuite number that is not shared with this admin when only its label is edited', async () => {
    wa = { ...(wa as WidgetWaPayload), numbers: [number({ id: 21, source: 'worksuite', account_id: 9, phone: '+94701234567', label: 'Branch', connected: false })] };
    await mount();
    expect(within(list().getByRole('listitem')).getByText('Not connected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Branch' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Kandy branch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    saveNow();
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(sent()).toEqual([expect.objectContaining({ id: 21, source: 'worksuite', account_id: 9, phone: '+94701234567', label: 'Kandy branch' })]);
  });

  it('tests a number by opening its wa.me link with the message', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Test Sales' }));
    expect(call).toHaveBeenCalledWith('app:openExternal', { url: "https://wa.me/94712345678?text=Hi%2C%20I'm%20on%20techubiz.com%20(ref%20TEST)" });
  });

  it('shows the server\'s refusal under the number, not in a toast', async () => {
    vi.mocked(apiPut).mockRejectedValueOnce(new ApiError(422, 'The numbers could not be saved.', null, { 'numbers.0.phone': 'This number is not on WhatsApp' }));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Support' }));
    saveNow();
    await waitFor(() => expect(within(list().getAllByRole('listitem')[0]!).getByRole('alert').textContent).toBe('This number is not on WhatsApp'));
    expect(toast).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('on a server without the list, an admin is told it needs updating (#259), and the away screen keeps its one number, kept in E.164', async () => {
    wa = new ApiError(404, 'Not found', null);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WidgetSettings />
      </QueryClientProvider>,
    );
    expect((await screen.findByRole('region', { name: 'Server update needed' })).textContent).toContain('WhatsApp numbers need a newer Communication module.');
    // The tab is left out rather than opened onto nothing; the address's tab falls back to Appearance.
    expect(screen.queryByRole('tab', { name: 'Contact options' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Appearance' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.change(screen.getByRole('textbox', { name: /^WhatsApp number/ }), { target: { value: '0769 136 424' } });
    expect(screen.getByText('Saved as +94 76 913 6424')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/chat/widget-admin/widgets/1/design', expect.objectContaining({ whatsapp_number: '+94769136424' })));
  });

  it('a save the server has no route for shows the same notice instead of failing silently', async () => {
    vi.mocked(apiPut).mockRejectedValueOnce(new ApiError(404, 'Not found', null));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Support' }));
    saveNow();
    expect((await screen.findByRole('region', { name: 'Server update needed' })).textContent).toContain('WhatsApp numbers need a newer Communication module.');
    expect(screen.queryByRole('tab', { name: 'Contact options' })).toBeNull();
    expect(toast).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('shows the list on the away screen, and its labels in the preview, where the server has one', async () => {
    tabQuery = new URLSearchParams();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WidgetSettings />
      </QueryClientProvider>,
    );
    const away = await screen.findByRole('list', { name: 'WhatsApp numbers on the away screen' });
    expect(within(away).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Sales · +94 71 234 5678', 'Support · +94 76 913 6424']);
    expect(screen.queryByRole('textbox', { name: /^WhatsApp number/ })).toBeNull();
    // Folded, the section's header sums it up.
    fireEvent.click(screen.getByRole('button', { name: 'Away screen' }));
    expect(within(screen.getByRole('button', { name: 'Away screen' })).getByText('WhatsApp: Sales, Support')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Away screen' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Away' }));
    expect(within(screen.getByTestId('widget-preview')).getByText('Sales · Support')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit WhatsApp numbers' }));
    expect(screen.getByRole('tab', { name: 'Contact options' }).getAttribute('aria-selected')).toBe('true');
  });

  it('lets somebody without the permission look but not change the numbers', async () => {
    wa = { ...(wa as WidgetWaPayload), can_manage: false };
    await mount();
    expect(screen.getByText(/Changing them needs the “Create and configure chat widgets” permission/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add WhatsApp number' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Sales' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Test Sales' })).toBeTruthy();
  });
});
