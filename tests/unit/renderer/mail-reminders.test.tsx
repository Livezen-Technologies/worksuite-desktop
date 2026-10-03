// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Tabs from '../../../src/core/tabs';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/access', () => ({ canOpen: () => true }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: nav.navigate }));

import { apiGet, apiGetMeta, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { setRegional } from '../../../src/core/time';
import { MailReminders, reminderWhen } from '../../../src/modules/mail/Reminders';
import { dueReminders, pruneMemory, snoozeUntil } from '../../../src/modules/mail/reminderTimes';
import type { MessageStates } from '../../../src/modules/mail/states';

/**
 * The reminder window and its local scheduler (ENH-MAIL-03 DMO-NTF-05,
 * DMO-TSK-02, WF-DO11): due flags, snoozes and events, worked out on this
 * computer so they come up offline too.
 */

const NOW = Date.parse('2026-10-05T04:00:00Z');
const flag = (over: Partial<MessageStates['flags'][string]> = {}) => ({ start_at: null, due_at: '2026-10-05 11:30:00', reminder_at: '2026-10-05 03:30:00', completed_at: null, task_id: 3, mailbox: 4, folder: 'inbox', uid: '12', subject: 'Send the BOQ', from_name: 'Pat', from_email: 'pat@x.org', ...over });
const STATES: MessageStates = {
  pins: {},
  snoozed: {},
  returned: { '4:inbox:13': '2026-10-05 03:50:00', '4:inbox:14': '2026-10-03 03:50:00' },
  flags: { '4:inbox:12': flag(), '4:inbox:15': flag({ uid: '15', subject: 'Later', reminder_at: '2026-10-05 09:00:00' }), '4:inbox:16': flag({ uid: '16', subject: 'Done', completed_at: '2026-10-05 01:00:00' }) },
  focus: {},
  categories: {},
};
const EVENTS = [
  { id: 7, title: 'Site visit', start_at: '2026-10-05 04:10:00', remind_minutes: 15 },
  { id: 8, title: 'Lunch', start_at: '2026-10-05 07:00:00', remind_minutes: 15 },
  { id: 9, title: 'Holiday', start_at: '2026-10-05 00:00:00', remind_minutes: 15, all_day: true },
];

describe('what is due', () => {
  it('lists due flags, snoozes back in the last day and events about to start; not what is done, later or dismissed', () => {
    const due = dueReminders(STATES, EVENTS, { dismissed: {}, snoozed: {} }, NOW);
    expect(due.map((d) => [d.kind, d.title])).toEqual([['event', 'Site visit'], ['snooze', ''], ['flag', 'Send the BOQ']]);
    expect(due.find((d) => d.kind === 'flag')).toMatchObject({ route: '/mail?msg=12&mbx=4&mf=inbox', ref: { mailbox: 4, folder: 'inbox', uid: '12' } });
    const key = due.find((d) => d.kind === 'flag')!.key;
    expect(dueReminders(STATES, EVENTS, { dismissed: { [key]: '2026-10-05T04:00:00Z' }, snoozed: {} }, NOW).some((d) => d.kind === 'flag')).toBe(false);
    expect(dueReminders(STATES, EVENTS, { dismissed: {}, snoozed: { [key]: '2026-10-05T05:00:00Z' } }, NOW).some((d) => d.kind === 'flag')).toBe(false);
    expect(dueReminders(STATES, EVENTS, { dismissed: {}, snoozed: { [key]: '2026-10-05T03:59:00Z' } }, NOW).some((d) => d.kind === 'flag')).toBe(true);
    // A reminder moved on the server is a new reminder.
    expect(dueReminders({ ...STATES, flags: { '4:inbox:12': flag({ reminder_at: '2026-10-05 03:45:00' }) } }, [], { dismissed: { [key]: 'x' }, snoozed: {} }, NOW)).toHaveLength(2);
  });

  it('snoozes for 5 minutes, an hour or until tomorrow morning, and forgets old answers', () => {
    const now = new Date('2026-10-05T04:00:00Z');
    expect(snoozeUntil('5m', now).toISOString()).toBe('2026-10-05T04:05:00.000Z');
    expect(snoozeUntil('1h', now).toISOString()).toBe('2026-10-05T05:00:00.000Z');
    expect(snoozeUntil('tomorrow', now, () => new Date('2026-10-06T03:30:00Z')).toISOString()).toBe('2026-10-06T03:30:00.000Z');
    expect(pruneMemory({ dismissed: { a: '2026-09-01T00:00:00Z', b: '2026-10-05T00:00:00Z' }, snoozed: {} }, NOW)).toEqual({ dismissed: { b: '2026-10-05T00:00:00Z' }, snoozed: {} });
  });
});

const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

describe('the reminder window', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    setRegional({ timezone: 'Asia/Colombo', locale: 'en-GB', timeFormat: '24' });
    window.localStorage.clear();
    vi.mocked(apiGet).mockReset().mockResolvedValue(STATES as never);
    vi.mocked(apiGetMeta).mockReset().mockResolvedValue({ data: { events: EVENTS }, offline: false } as never);
    vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
    vi.mocked(call).mockReset().mockResolvedValue(null as never);
    nav.navigate.mockReset();
    app.set((s) => ({ ...s, status: { ...(s.status ?? {}), network: 'ONLINE' } as never }));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows what is due with Open, Snooze, Mark complete and Dismiss, and Dismiss all', async () => {
    wrap(<MailReminders />);
    const panel = await screen.findByRole('dialog', { name: 'Reminders' });
    await within(panel).findByText('Send the BOQ');
    expect(within(panel).getByText('Reminders · 3')).toBeTruthy();
    expect(within(panel).getByText('Starts in 10 min')).toBeTruthy();
    const flagRow = within(panel).getByText('Send the BOQ').closest('li')!;
    expect(flagRow.textContent).toMatch(/Due .*17:00/);

    const sel = within(flagRow).getByLabelText('Snooze') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: '1h' } });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/states', { action: 'remind', items: [{ mailbox: 4, folder: 'inbox', uid: '12' }], at: expect.stringMatching(/^2026-10-05T05:00:00/) }));
    expect(within(panel).queryByText('Send the BOQ')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('ws-mail-reminders')!).snoozed).toHaveProperty(['flag:4:inbox:12:2026-10-05 03:30:00']);

    fireEvent.click(within(within(panel).getByText('Site visit').closest('li')!).getByRole('button', { name: 'Open' }));
    expect(nav.navigate).toHaveBeenCalledWith('/calendar?event=7');

    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss all' }));
    expect(screen.queryByRole('dialog', { name: 'Reminders' })).toBeNull();
  });

  it('completes a flag on the server and, offline, raises the system notification itself', async () => {
    app.set((s) => ({ ...s, status: { ...(s.status ?? {}), network: 'OFFLINE' } as never }));
    wrap(<MailReminders />);
    const panel = await screen.findByRole('dialog', { name: 'Reminders' });
    await within(panel).findByText('Send the BOQ');
    await waitFor(() => expect(call).toHaveBeenCalledWith('notifications:reminder', expect.objectContaining({ title: 'Follow up: Send the BOQ', route: '/mail?msg=12&mbx=4&mf=inbox', flag: { mailbox: 4, folder: 'inbox', uid: '12' } })));
    expect(vi.mocked(call).mock.calls.filter(([c]) => c === 'notifications:reminder')).toHaveLength(3);
    const flagRow = within(panel).getByText('Send the BOQ').closest('li')!;
    expect(within(flagRow).getByRole('button', { name: 'Mark complete' })).toHaveProperty('disabled', true);
    act(() => app.set((s) => ({ ...s, status: { ...(s.status ?? {}), network: 'ONLINE' } as never })));
    fireEvent.click(within(flagRow).getByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/states', { action: 'complete', items: [{ mailbox: 4, folder: 'inbox', uid: '12' }] }));
    expect(within(panel).queryByText('Send the BOQ')).toBeNull();
  });

  it('says when an event starts and when a snooze came back', () => {
    expect(reminderWhen({ key: 'k', kind: 'event', title: 't', at: '2026-10-05T03:55:00.000Z', since: '', route: '/' }, NOW)).toBe('Started 5 min ago');
    expect(reminderWhen({ key: 'k', kind: 'snooze', title: 't', at: null, since: '', route: '/' }, NOW)).toBe('Back from snooze');
  });
});
