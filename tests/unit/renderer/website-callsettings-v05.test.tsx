// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Widget settings › Live status & calls (V-05, VOICE-UI-04): a tab of the desktop's widget settings beside the design
 * (#199). WHAT THE VISITOR SEES — typing and read receipts (LIVE-09, LIVE-10); VOICE CALLS — let visitors call, when
 * the button shows, when a call back is offered, who can take calls, and recording, shown as Off and not offered
 * (VOICE-01, VOICE-04, VOICE-11, VOICE-20…22). Saving sends only what changed, to `widgets/{id}/calls`.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPut: vi.fn(), apiPost: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
let tabQuery = new URLSearchParams();
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ query: tabQuery, path: ['chat'], go: vi.fn(), active: true }), useTabTitle: () => undefined }));

import { ApiError, apiGet, apiPut } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { changedFields, waitLabel, waitOptions, type CallSettingsPayload } from '../../../src/modules/chat/website/widget/callSettings';
import { WidgetSettings } from '../../../src/modules/chat/website/widget/WidgetSettings';

let calls: CallSettingsPayload;
let callsError: Error | null;

const design = {
  widget: { id: 1, name: 'Main', widget_key: 'k', status: 'active' },
  design: {
    website_name: 'techubiz.com', brand_color: '#2F3FB5', logo_url: null, greeting: null, header_subtitle: null, quick_links: [], staff_display: 'name_role', show_agents: true,
    offline_message: null, whatsapp_number: null, launcher_style: 'pill', position: 'bottom_right', greeting_delay: 0, greeting_text: null, theme: 'auto',
    launcher_offset_bottom: 20, launcher_offset_right: 20, launcher_offset_left: 20,
  },
  agents: [], preview_agents: [], away: null, hours: null, reply_time: null, installed: true, can_manage: true,
};

beforeEach(() => {
  tabQuery = new URLSearchParams();
  callsError = null;
  calls = {
    settings: { show_typing_to_visitor: true, show_receipts_to_visitor: true, voice_enabled: true, voice_offer: 'available', voice_max_wait_seconds: 60, voice_record: false },
    installed: { live_status: true, voice: true },
    recording_available: false,
    media_ready: true,
    takers: { assigned: true, people: [{ user_id: 7, name: 'Nimal Silva', available: true }, { user_id: 3, name: 'Samali Perera', available: false }] },
    can_manage: true,
  };
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/widgets') return { widgets: [{ id: 1, name: 'Main', website_name: 'techubiz.com', status: 'active' }] };
    if (path === '/api/chat/widget-admin/widgets/1/design') return design;
    if (path === '/api/chat/widget-admin/widgets/1/hours') return { hours: [] };
    if (path === '/api/chat/widget-admin/widgets/1/calls') {
      if (callsError) throw callsError;
      return calls;
    }
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiPut).mockReset().mockImplementation((async (_path: string, body: unknown) => ({ ...calls, settings: { ...calls.settings, ...(body as object) } })) as never);
  vi.mocked(toast).mockClear();
  vi.mocked(call).mockClear();
});
afterEach(() => cleanup());

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WidgetSettings />
    </QueryClientProvider>,
  );

/** Open the tab the way a person does: from the Appearance tab the page opens on. */
async function openTab() {
  mount();
  fireEvent.click(await screen.findByRole('tab', { name: 'Live status & calls' }));
  return within(await screen.findByRole('form', { name: 'Live status and calls' }));
}

const pick = (name: string, option: string) => {
  fireEvent.click(screen.getByRole('combobox', { name }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};

describe('the call back offer and what a save sends', () => {
  it('words the give-up times in seconds, then whole minutes, and keeps a stored value that is not a choice', () => {
    expect([waitLabel(45), waitLabel(90), waitLabel(120), waitLabel(300)]).toEqual(['45 seconds', '90 seconds', '2 minutes', '5 minutes']);
    expect(waitOptions(60).map((o) => o.value)).toEqual([20, 30, 45, 60, 90, 120, 180, 300]);
    expect(waitOptions(75).map((o) => o.value)).toContain(75);
  });

  it('sends only the fields that changed', () => {
    const saved = calls.settings;
    expect(changedFields(saved, { ...saved })).toEqual({});
    expect(changedFields(saved, { ...saved, voice_enabled: false, voice_max_wait_seconds: 90 })).toEqual({ voice_enabled: false, voice_max_wait_seconds: 90 });
  });
});

describe('Widget settings › Live status & calls (V-05)', () => {
  it('is a tab beside the design, with the design\'s two groups and every row', async () => {
    const form = await openTab();
    expect(screen.getByRole('tab', { name: 'Appearance' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Live status & calls' }).getAttribute('aria-selected')).toBe('true');

    expect(form.getByText('What the visitor sees')).toBeTruthy();
    expect(form.getByRole('switch', { name: 'Show when staff are typing' }).getAttribute('aria-checked')).toBe('true');
    expect(form.getByText('“Nuwan is typing…” in the widget.')).toBeTruthy();
    expect(form.getByRole('switch', { name: 'Show delivered and read to the visitor' }).getAttribute('aria-checked')).toBe('true');
    expect(form.getByText('“Read by Nuwan”. Staff always see the visitor\'s status.')).toBeTruthy();

    expect(form.getByText('Voice calls')).toBeTruthy();
    expect(form.getByRole('switch', { name: 'Let visitors call from the widget' }).getAttribute('aria-checked')).toBe('true');
    expect(form.getByText('Audio only, in the browser. Off until you turn it on.')).toBeTruthy();
    expect(form.getByRole('combobox', { name: 'Show the call button' }).textContent).toContain('When someone who takes calls is available');
    expect(form.getByRole('combobox', { name: 'Offer a call back after' }).textContent).toContain('60 seconds');
    expect(form.getByText('This widget\'s staff with “Take website voice calls”.')).toBeTruthy();
    expect(form.getByRole('combobox', { name: 'Record calls' }).textContent).toContain('Off');
    expect(form.getByText('When on, the visitor is told first and sees a Recording badge.', { exact: false })).toBeTruthy();
    expect(form.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(form.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('opens straight on the tab from ?tab=calls', async () => {
    tabQuery = new URLSearchParams('tab=calls');
    mount();
    expect(await screen.findByRole('form', { name: 'Live status and calls' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Live status & calls' }).getAttribute('aria-selected')).toBe('true');
  });

  it('lists who can take calls and who could be rung now, and opens the editor\'s Staff tab (S-04)', async () => {
    const form = await openTab();
    const who = form.getByRole('group', { name: 'People who take calls' });
    expect(who.textContent).toContain('Nimal Silva · available now');
    expect(who.textContent).toContain('Samali Perera');
    fireEvent.click(form.getByRole('button', { name: 'Manage staff' }));
    expect(screen.getByRole('tab', { name: 'Staff' }).getAttribute('aria-selected')).toBe('true');
    expect(call).not.toHaveBeenCalledWith('app:openInBrowser', { path: '/website-chats?tab=widgets' });
  });

  it('says when nobody can take calls, so the button stays hidden', async () => {
    calls.takers = { assigned: false, people: [] };
    const form = await openTab();
    expect(form.getByText(/everybody covering it with “Take website voice calls”/)).toBeTruthy();
    expect(form.getByText(/Nobody can take calls yet, so the call button stays hidden/)).toBeTruthy();
  });

  it('saves only what changed, then holds nothing unsaved', async () => {
    const form = await openTab();
    expect((form.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(form.getByRole('switch', { name: 'Show when staff are typing' }));
    pick('Show the call button', 'After the visitor has sent a message');
    pick('Offer a call back after', '2 minutes');
    fireEvent.click(form.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith('/api/chat/widget-admin/widgets/1/calls', { show_typing_to_visitor: false, voice_offer: 'after_message', voice_max_wait_seconds: 120 });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', expect.any(String)));
    expect((form.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    expect(form.getByRole('combobox', { name: 'Offer a call back after' }).textContent).toContain('2 minutes');
  });

  it('Cancel puts back what is saved', async () => {
    const form = await openTab();
    fireEvent.click(form.getByRole('switch', { name: 'Let visitors call from the widget' }));
    expect(form.getByRole('switch', { name: 'Let visitors call from the widget' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(form.getByRole('button', { name: 'Cancel' }));
    expect(form.getByRole('switch', { name: 'Let visitors call from the widget' }).getAttribute('aria-checked')).toBe('true');
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('shows the server\'s refusal and keeps the change to fix', async () => {
    vi.mocked(apiPut).mockRejectedValueOnce(new ApiError(422, 'Choose when the call button shows', null));
    const form = await openTab();
    fireEvent.click(form.getByRole('switch', { name: 'Show delivered and read to the visitor' }));
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', expect.stringContaining('Choose when the call button shows')));
    expect(form.getByRole('switch', { name: 'Show delivered and read to the visitor' }).getAttribute('aria-checked')).toBe('false');
  });

  it('never offers recording, which is not built (VOICE-22)', async () => {
    const form = await openTab();
    expect((form.getByRole('combobox', { name: 'Record calls' }) as HTMLButtonElement).disabled).toBe(true);
    expect(form.getByText('Recording is not available yet.')).toBeTruthy();
  });

  it('warns that the call button is hidden without the voice server', async () => {
    calls.media_ready = false;
    const form = await openTab();
    expect(form.getByText(/The voice server is not set up on WorkSuite yet/)).toBeTruthy();
  });

  it('lets somebody who cannot configure widgets look, not change', async () => {
    calls.can_manage = false;
    const form = await openTab();
    expect(form.getByText(/Changing them needs the “Create and configure chat widgets” permission/)).toBeTruthy();
    // Inside the disabled fieldset, as the design tab's fields are.
    expect(form.getByRole('switch', { name: 'Show when staff are typing' }).matches(':disabled')).toBe(true);
    expect((form.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('on a server without the switches, says so and leaves them as they are', async () => {
    calls.installed = { live_status: false, voice: true };
    const form = await openTab();
    expect(form.getByText(/not been updated for live status yet/)).toBeTruthy();
    expect((form.getByRole('switch', { name: 'Show when staff are typing' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('on a server without the page at all, says to update it', async () => {
    callsError = new ApiError(404, 'Not found', null);
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Live status & calls' }));
    expect(await screen.findByText('Not on this server yet')).toBeTruthy();
  });

  it('keeps an unsaved design when switching tabs and back', async () => {
    mount();
    const name = await screen.findByRole('textbox', { name: /Website name/ });
    fireEvent.change(name, { target: { value: 'Techubiz' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Live status & calls' }));
    await screen.findByRole('form', { name: 'Live status and calls' });
    fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
    expect((screen.getByRole('textbox', { name: /Website name/ }) as HTMLInputElement).value).toBe('Techubiz');
  });
});
