// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('sip.js', () => ({ Invitation: class {}, Inviter: class {}, Registerer: class {}, RegistererState: {}, SessionState: {}, UserAgent: { makeURI: () => undefined } }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn(), ringVolume: () => 0.5 }));
const tab = { route: '/phone', go: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, navigate: vi.fn(), openInNewTab: vi.fn(), active: true, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { ApiError, apiGet, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { MY_PRESENCE_KEY, refreshMyPresence } from '../../../src/core/presence';
import { setRegional } from '../../../src/core/time';
import { toast } from '../../../src/core/toasts';
import { atLabel, awayForwardTo, awayHint, dndEnd, expiry, fromPresence, parsePrefs, resolveStatus, statusLabel, switchNote, type CallStatus } from '../../../src/modules/phone/lib/callstatus';
import { callStatusStore, resetCallStatus, useCallStatusSync } from '../../../src/modules/phone/status';
import { StatusMenu } from '../../../src/modules/phone/StatusMenu';
import PhonePage from '../../../src/modules/phone/PhonePage';

/**
 * The Phone's status (worksuite-desktop#288): a pill and the shared menu instead of the system dropdown, Do not
 * disturb for a while that ends on its own, one status with the top bar (Chat's presence) in both directions, and
 * calls' own status when they should differ.
 */

/** The server: my presence as Chat keeps it, and whether it has the proposed `PUT voip/me/dnd`. */
const server = { choice: 'available', switchOffered: false, switchKeeps: false };

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

let qc: QueryClient;
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);

const applied: CallStatus[] = [];
const apply = (s: CallStatus) => void applied.push(s);

/** What PhoneHost does, with the status pill beside it. */
function Host() {
  useCallStatusSync(apply);
  return (
    <div>
      <button type="button">Elsewhere</button>
      <StatusMenu />
    </div>
  );
}

const pill = () => screen.getByRole('button', { name: /^Status:/ });
const openMenu = () => {
  fireEvent.pointerDown(pill());
  fireEvent.click(pill());
  return screen.getByRole('menu', { name: 'Status' });
};
const focused = () => document.activeElement as HTMLElement;
const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k });
const description = (el: HTMLElement) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '';

beforeEach(() => {
  server.choice = 'available';
  server.switchOffered = false;
  server.switchKeeps = false;
  applied.length = 0;
  tab.route = '/phone';
  tab.go.mockReset();
  localStorage.clear();
  resetCallStatus();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setRegional({ timezone: 'Asia/Colombo', locale: 'en-US', timeFormat: '12' });
  app.set({ apps: [{ id: 'chat' }, { id: 'phone' }] as never, auth: { user: { id: 7 } } as never, bootstrap: { permissions: [] } as never });
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(apiPut).mockReset();
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/chat/presence/me') return { status: server.choice === 'available' ? 'online' : server.choice, choice: server.choice };
    if (path === '/api/voip/extensions') return { extensions: [] };
    if (path === '/api/voip/status') return { pbx: { ok: true }, counts: { extensions: 0, trunks: 0, gateways: 0, queues: 0 }, secrets: true, websocket: { path: '/ws', domain: 'pbx.example.lk' }, message: null };
    if (path === '/api/voip/calls') return { calls: [], page: 1, per_page: 30, total: 0 };
    if (path === '/api/voip/recordings') return { recordings: [], page: 1, per_page: 50, total: 0, retention_note: '' };
    throw new ApiError(404, 'The server answered 404.', null);
  }) as never);
  vi.mocked(apiPost).mockImplementation((async (path: string, body: { status?: string }) => {
    if (path === '/api/chat/presence') {
      server.choice = body.status!;
      return { status: body.status };
    }
    throw new ApiError(404, 'The server answered 404.', null);
  }) as never);
  vi.mocked(apiPut).mockImplementation((async (path: string, body: { dnd: boolean; status: string; until: string | null }) => {
    if (path === '/api/voip/me/dnd' && server.switchOffered) return server.switchKeeps ? { dnd: body.dnd, status: body.status, until: body.until } : { dnd: body.dnd };
    throw new ApiError(404, 'The server answered 404.', null);
  }) as never);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setRegional({});
  app.set({ apps: [], auth: null, bootstrap: null });
});

describe('what each status does, and how calls take the WorkSuite status', () => {
  it('maps the WorkSuite status: Appear offline is Away, anything unknown is nothing', () => {
    expect(fromPresence('available')).toBe('available');
    expect(fromPresence('dnd')).toBe('dnd');
    expect(fromPresence('offline')).toBe('away');
    expect(fromPresence('in_meeting')).toBeNull();
    expect(fromPresence(undefined)).toBeNull();
  });

  it('follows the WorkSuite status unless calls have their own', () => {
    expect(resolveStatus({ own: null, timer: null }, 'busy', 0)).toEqual({ status: 'busy', linked: true, until: null });
    expect(resolveStatus({ own: 'dnd', timer: null }, 'available', 0)).toEqual({ status: 'dnd', linked: false, until: null });
    // No WorkSuite status (no Chat app): calls' own, Available until chosen.
    expect(resolveStatus({ own: null, timer: null }, undefined, 0)).toEqual({ status: 'available', linked: false, until: null });
  });

  it('reads what was kept, drops anything malformed, and carries the old Do not disturb over', () => {
    expect(parsePrefs(JSON.stringify({ own: 'busy', timer: { until: 5, back: 'available', scope: 'calls' } }))).toEqual({ own: 'busy', timer: { until: 5, back: 'available', scope: 'calls' } });
    expect(parsePrefs(JSON.stringify({ own: 'loud', timer: { until: 'soon' } }))).toEqual({ own: null, timer: null });
    expect(parsePrefs('{not json', '1')).toEqual({ own: 'dnd', timer: null });
    expect(parsePrefs(null, '0')).toEqual({ own: null, timer: null });
  });

  it('says where Away sends calls, and plainly when nothing forwards them', () => {
    const rule = { id: 1, extension_id: 3, department_id: null, condition: 'busy', destination_kind: 'mobile', destination: '0771234567', ring_seconds: 20, time_spec: null, priority: 1, enabled: true, summary: '' } as never;
    expect(awayForwardTo([rule], 3)).toBe('0771234567');
    expect(awayForwardTo([{ ...(rule as object), enabled: false } as never], 3)).toBeNull();
    expect(awayForwardTo([{ ...(rule as object), destination_kind: 'voicemail' } as never], 3)).toBeNull();
    expect(awayForwardTo([], 3, '+94112447000')).toBe('+94112447000');
    expect(awayHint(null)).toBe('Calls forward to your phone (if set). None is set, so they go to voicemail');
    expect(awayHint('0771234567')).toMatch(/^Calls forward to /);
  });

  it('tells the person what the phone system could not take', () => {
    expect(switchNote('dnd', 'all')).toBeNull();
    expect(switchNote('available', 'local')).toBeNull();
    expect(switchNote('dnd', 'local')).toMatch(/your other phones still ring/);
    expect(switchNote('busy', 'dnd')).toMatch(/Only this computer rings quietly/);
    expect(switchNote('away', 'dnd')).toMatch(/can’t forward them for Away yet/);
  });
});

describe('Do not disturb for a while (mocked clock, Colombo time)', () => {
  // 2:30 PM in Colombo (UTC+5:30).
  const now = Date.parse('2026-10-07T09:00:00Z');

  it('ends after 30 minutes, 1 hour, 2 hours, tomorrow morning, or never', () => {
    expect(dndEnd('30m', now)).toBe(now + 30 * 60_000);
    expect(dndEnd('1h', now)).toBe(now + 60 * 60_000);
    expect(dndEnd('2h', now)).toBe(now + 120 * 60_000);
    expect(new Date(dndEnd('tomorrow', now)!).toISOString()).toBe('2026-10-08T02:30:00.000Z');
    expect(dndEnd('off', now)).toBeNull();
  });

  it('says when it ends on the person’s clock and in their format', () => {
    expect(norm(atLabel(now + 60 * 60_000, now))).toBe('3:30 PM');
    expect(norm(atLabel(dndEnd('tomorrow', now)!, now))).toBe('tomorrow 8:00 AM');
    expect(norm(statusLabel({ status: 'dnd', until: now + 60 * 60_000 }, now))).toBe('Do not disturb · until 3:30 PM');
    expect(statusLabel({ status: 'busy', until: null }, now)).toBe('Busy');
    setRegional({ timezone: 'Asia/Colombo', locale: 'en-GB', timeFormat: '24' });
    expect(norm(atLabel(now + 60 * 60_000, now))).toBe('15:30');
  });

  it('puts back what was there before once its time is up — unless the status was changed since', () => {
    const calls = { own: 'dnd' as const, timer: { until: now, back: 'busy', scope: 'calls' as const } };
    expect(expiry(calls, 'available', now - 1)).toBeNull();
    expect(expiry(calls, 'available', now)).toEqual({ prefs: { own: 'busy', timer: null }, presence: null });
    const everywhere = { own: null, timer: { until: now, back: 'away', scope: 'everywhere' as const } };
    expect(expiry(everywhere, 'dnd', now)).toEqual({ prefs: { own: null, timer: null }, presence: 'away' });
    // Set to Available from the top bar meanwhile: the timer only goes.
    expect(expiry(everywhere, 'available', now)).toEqual({ prefs: { own: null, timer: null }, presence: null });
    // The pill stops saying "until" the moment it has passed.
    expect(resolveStatus(everywhere, 'dnd', now + 1).until).toBeNull();
  });

  it('shows "until …" on the pill, then goes back to Available by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(now);
    wrap(<Host />);
    await waitFor(() => expect(applied.at(-1)).toBe('available'));
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Do not disturb for/ }));
    const lengths = screen.getAllByRole('menu').at(-1)!;
    // Each length says when it would end.
    expect(norm(within(lengths).getByRole('menuitem', { name: /1 hour/ }).textContent)).toContain('3:30 PM');
    fireEvent.click(within(lengths).getByRole('menuitem', { name: /30 minutes/ }));
    await waitFor(() => expect(norm(pill().textContent)).toBe('Do not disturb · until 3:00 PM'));
    expect(apiPost).toHaveBeenCalledWith('/api/chat/presence', { status: 'dnd', active: true });
    expect(applied.at(-1)).toBe('dnd');
    expect(callStatusStore.get().prefs.timer).toMatchObject({ back: 'available', scope: 'everywhere' });
    // Measured from the moment it was chosen.
    expect(callStatusStore.get().prefs.timer!.until - now).toBeGreaterThanOrEqual(30 * 60_000);
    expect(callStatusStore.get().prefs.timer!.until - now).toBeLessThan(30 * 60_000 + 5_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60_000 + 1_000);
    });
    await waitFor(() => expect(norm(pill().textContent)).toBe('Available'));
    expect(apiPost).toHaveBeenLastCalledWith('/api/chat/presence', { status: 'available', active: true });
    expect(applied.at(-1)).toBe('available');
    expect(callStatusStore.get().prefs.timer).toBeNull();
  });

  it('ends a Do not disturb that ran out while the desktop was closed, at the next start', async () => {
    const past = Date.now() - 60_000;
    localStorage.setItem('ws.phone.status.7', JSON.stringify({ own: 'dnd', timer: { until: past, back: 'busy', scope: 'calls' } }));
    wrap(<Host />);
    await waitFor(() => expect(applied.at(-1)).toBe('busy'));
    expect(norm(pill().textContent)).toBe('Busy');
  });
});

describe('the pill and the menu (no system dropdown)', () => {
  it('replaces the native Status select in the Phone’s header with a compact pill', async () => {
    wrap(<PhonePage tabId="t" route="/phone" active />);
    const status = await screen.findByRole('button', { name: /^Status: Available/ });
    expect(status.tagName).toBe('BUTTON');
    expect(status.getAttribute('aria-haspopup')).toBe('menu');
    expect(screen.queryByRole('combobox', { name: /status/i })).toBeNull();
    expect(status.closest('header')!.querySelector('select')).toBeNull();
    // Styled like the header's other buttons (Compact phone): 32px, a 1px line, the surface, a light hover.
    expect(status.className).toMatch(/(^|\s)h-8(\s|$)/);
    expect(status.className).toContain('border-line');
    expect(status.className).toContain('hover:bg-subtle');
    expect(status.querySelector('.rounded-full')!.className).toContain('bg-success');
  });

  it('draws a focus ring only for the keyboard: nothing on focus, none after a choice made with the pointer', async () => {
    wrap(<Host />);
    await waitFor(() => expect(applied.at(-1)).toBe('available'));
    // No `focus:` style of its own and no glow: the app's `:focus-visible` outline is the only ring.
    expect(pill().className.split(/\s+/).filter((c) => /^focus:|ring|shadow/.test(c))).toEqual([]);
    const menu = openMenu();
    fireEvent.pointerDown(within(menu).getByRole('menuitemradio', { name: /Busy/ }));
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Busy/ }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(focused()).toBe(pill());
    expect(pill().hasAttribute('data-pointer-focus')).toBe(true);
    // A key brings the ring back.
    fireEvent.keyDown(pill(), { key: 'Tab' });
    expect(pill().hasAttribute('data-pointer-focus')).toBe(false);
    const css = readFileSync(join(__dirname, '../../../src/styles.css'), 'utf8');
    expect(css).toMatch(/\[data-pointer-focus\]:focus-visible\s*\{\s*outline:\s*none;/);
  });

  it('lists four statuses with dots, what each does, and the chosen one ticked', async () => {
    wrap(<Host />);
    await waitFor(() => expect(applied.at(-1)).toBe('available'));
    const menu = openMenu();
    const radios = within(menu).getAllByRole('menuitemradio');
    expect(radios.map((r) => document.getElementById(r.getAttribute('aria-labelledby')!)!.textContent)).toEqual(['Available', 'Busy', 'Do not disturb', 'Away']);
    expect(radios.map((r) => description(r))).toEqual(['Calls ring on this computer', 'Calls ring quietly, no sound', 'Calls go to voicemail or the next person in your team', 'Calls forward to your phone (if set). None is set, so they go to voicemail']);
    expect(radios.map((r) => r.querySelector('[data-status-dot] span')!.className.match(/bg-[\w-]+/)![0])).toEqual(['bg-success', 'bg-warning', 'bg-danger', 'bg-ink-3']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
    // Chosen: a tick and accent text; never the bright selection background.
    expect(radios[0]!.querySelector('svg')).not.toBeNull();
    expect(radios[0]!.className).toContain('text-primary');
    expect(radios[0]!.className).not.toMatch(/(^|\s)bg-selection/);
    const submenu = within(menu).getByRole('menuitem', { name: /Do not disturb for/ });
    expect(submenu.getAttribute('aria-haspopup')).toBe('menu');
    expect(within(menu).getByRole('menuitemcheckbox', { name: /Same status for Chat and Website chats/ }).getAttribute('aria-checked')).toBe('true');
    // Call settings opens the Phone's own settings (forwarding, voicemail, the devices that ring).
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Call settings' }));
    expect(tab.go).toHaveBeenCalledWith('/phone/forwarding');
  });

  it('works from the keyboard: arrows, Right into Do not disturb for…, Escape back, Enter to choose', async () => {
    wrap(<Host />);
    await waitFor(() => expect(applied.at(-1)).toBe('available'));
    fireEvent.click(pill());
    expect(pill().getAttribute('aria-expanded')).toBe('true');
    // It opens on the chosen status.
    expect(focused().getAttribute('aria-checked')).toBe('true');
    key('ArrowDown');
    expect(norm(focused().textContent)).toMatch(/^Busy/);
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown');
    expect(norm(focused().textContent)).toMatch(/^Do not disturb for…/);
    key('ArrowRight');
    expect(focused().textContent).toMatch(/30 minutes/);
    expect(screen.getByRole('menuitem', { name: /Do not disturb for/ }).getAttribute('aria-expanded')).toBe('true');
    key('Escape');
    expect(norm(focused().textContent)).toMatch(/^Do not disturb for…/);
    key('ArrowUp');
    key('ArrowUp');
    expect(norm(focused().textContent)).toMatch(/^Do not disturb/);
    key('Enter');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(focused()).toBe(pill());
    // Chosen with the keyboard: the ring stays.
    expect(pill().hasAttribute('data-pointer-focus')).toBe(false);
    await waitFor(() => expect(applied.at(-1)).toBe('dnd'));
    fireEvent.click(pill());
    key('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(focused()).toBe(pill());
  });
});

describe('one status across WorkSuite', () => {
  it('follows the top bar: a change there reaches the phone at once', async () => {
    wrap(<Host />);
    await waitFor(() => expect(applied.at(-1)).toBe('available'));
    // What the top bar's Show me as does: set it, then refresh every copy.
    server.choice = 'dnd';
    await act(async () => {
      await refreshMyPresence(qc);
    });
    await waitFor(() => expect(applied.at(-1)).toBe('dnd'));
    expect(norm(pill().textContent)).toBe('Do not disturb');
    // A realtime `chat.presence` refreshes the same copy.
    server.choice = 'busy';
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['chat', 'presence'] });
    });
    await waitFor(() => expect(applied.at(-1)).toBe('busy'));
  });

  it('sets the WorkSuite status from here: the top bar, Chat and Website chats show it at once', async () => {
    qc.setQueryData(['account', 'presence'], { status: 'online', choice: 'available' });
    wrap(<Host />);
    await waitFor(() => expect(applied.at(-1)).toBe('available'));
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Away/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/presence', { status: 'away', active: true }));
    expect(qc.getQueryData<{ choice: string }>(['account', 'presence'])!.choice).toBe('away');
    expect(qc.getQueryData<{ choice: string }>(MY_PRESENCE_KEY)!.choice).toBe('away');
    await waitFor(() => expect(applied.at(-1)).toBe('away'));
    // This server has no `PUT voip/me/dnd`: it works here, and the person is told what it can't do.
    expect(apiPut).toHaveBeenCalledWith('/api/voip/me/dnd', { dnd: true, sync_presence: true, status: 'away', until: null });
    expect(toast).toHaveBeenCalledWith('info', expect.stringMatching(/your other phones still ring/));
  });

  it('tells a server that has the route the status and when it ends, and says nothing more when it keeps them', async () => {
    server.switchOffered = true;
    server.switchKeeps = true;
    wrap(<Host />);
    await waitFor(() => expect(applied.at(-1)).toBe('available'));
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /^Busy/ }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/voip/me/dnd', { dnd: false, sync_presence: true, status: 'busy', until: null }));
    expect(toast).not.toHaveBeenCalled();
    // A change from the top bar reaches the switch too, once.
    server.choice = 'dnd';
    await act(async () => {
      await refreshMyPresence(qc);
    });
    await waitFor(() => expect(apiPut).toHaveBeenLastCalledWith('/api/voip/me/dnd', { dnd: true, sync_presence: true, status: 'dnd', until: null }));
    expect(vi.mocked(apiPut).mock.calls.filter((c) => (c[1] as { status: string }).status === 'dnd')).toHaveLength(1);
  });

  it('gives calls their own status: Available for chats, Do not disturb for calls', async () => {
    wrap(<Host />);
    await waitFor(() => expect(applied.at(-1)).toBe('available'));
    let menu = openMenu();
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: /Same status for Chat and Website chats/ }));
    menu = openMenu();
    expect(within(menu).getByText('Calls only')).toBeTruthy();
    const share = within(menu).getByRole('menuitemcheckbox', { name: /Same status for Chat and Website chats/ });
    expect(share.getAttribute('aria-checked')).toBe('false');
    expect(description(share)).toBe('Calls have their own. Your WorkSuite status is Available');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /^Do not disturb/ }));
    await waitFor(() => expect(applied.at(-1)).toBe('dnd'));
    // WorkSuite's status is left alone: chats still come in.
    expect(apiPost).not.toHaveBeenCalled();
    expect(server.choice).toBe('available');
    expect(pill().getAttribute('title')).toBe('For calls only. Your WorkSuite status is Available.');
    // The top bar changes; calls keep their own.
    server.choice = 'away';
    await act(async () => {
      await refreshMyPresence(qc);
    });
    await waitFor(() => expect(qc.getQueryData<{ choice: string }>(MY_PRESENCE_KEY)!.choice).toBe('away'));
    expect(applied.at(-1)).toBe('dnd');
    // Sharing again: calls take the WorkSuite status.
    menu = openMenu();
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: /Same status for Chat and Website chats/ }));
    await waitFor(() => expect(applied.at(-1)).toBe('away'));
    // Kept for this person on this computer.
    expect(JSON.parse(localStorage.getItem('ws.phone.status.7')!)).toMatchObject({ own: null, seen: 'away' });
  });

  it('a Do not disturb for calls alone ends back on calls’ own status, never touching the WorkSuite status', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.parse('2026-10-07T09:00:00Z'));
    localStorage.setItem('ws.phone.status.7', JSON.stringify({ own: 'busy', timer: null }));
    wrap(<Host />);
    await waitFor(() => expect(applied.at(-1)).toBe('busy'));
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Do not disturb for/ }));
    fireEvent.click(within(screen.getAllByRole('menu').at(-1)!).getByRole('menuitem', { name: /2 hours/ }));
    await waitFor(() => expect(norm(pill().textContent)).toBe('Do not disturb · until 4:30 PM'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 60_000 + 1_000);
    });
    await waitFor(() => expect(norm(pill().textContent)).toBe('Busy'));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('without Chat there is no WorkSuite status to share: calls have their own', async () => {
    app.set({ apps: [{ id: 'phone' }] as never });
    wrap(<Host />);
    await waitFor(() => expect(applied.at(-1)).toBe('available'));
    const menu = openMenu();
    expect(within(menu).queryByRole('menuitemcheckbox')).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /^Busy/ }));
    await waitFor(() => expect(applied.at(-1)).toBe('busy'));
    expect(apiGet).not.toHaveBeenCalledWith('/api/chat/presence/me', undefined, expect.anything());
    expect(apiPost).not.toHaveBeenCalled();
  });
});
