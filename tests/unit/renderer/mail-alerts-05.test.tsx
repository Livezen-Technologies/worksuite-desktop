// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailAlertCard, MailAlertState } from '../../../shared/mail-alerts';

const bus = vi.hoisted(() => new Map<string, (p: unknown) => void>());
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => null),
  on: (channel: string, cb: (p: unknown) => void) => {
    bus.set(channel, cb);
    return () => bus.delete(channel);
  },
  hasDesktop: () => true,
  errorMessage: (e: Error) => e.message,
  isMac: false,
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  const app = createStore({ prefs: { mailAlertSound: true } as Record<string, unknown> });
  return {
    app,
    updatePrefs: vi.fn(async (p: Record<string, unknown>) => app.set((s) => ({ prefs: { ...s.prefs, ...p } }))),
  };
});

import { call } from '../../../src/core/bridge';
import { app, updatePrefs } from '../../../src/core/app-state';
import { MailAlertCards } from '../../../src/modules/mail/alerts/MailAlertCards';
import { MailAlertSettings } from '../../../src/modules/mail/alerts/MailAlertSettings';

/**
 * The in-app new-mail card (ENH-MAIL-05 D27, MNA-APP, MNA-A11) and Settings › Mail's alert settings (MNA-PRV-01,
 * MNA-WIN-07, MNA-TRY-02).
 */

const row = (over: Partial<MailAlertCard['rows'][number]> = {}): MailAlertCard['rows'][number] => ({
  key: '3:inbox:41',
  mailbox: 3,
  folder: 'inbox',
  uid: 41,
  account: 'Hasarinda · WorkSuite',
  sender: 'Dinesh Perera',
  address: 'dinesh@example.lk',
  initials: 'DP',
  subject: 'Q4 budget — need your numbers by 3 pm',
  preview: 'Hi Hasarinda, can you send the hosting and licence lines for Q4?',
  high: false,
  attachments: 1,
  checked: true,
  external: false,
  at: new Date().toISOString(),
  ...over,
});

const single = (over: Partial<MailAlertCard> = {}): MailAlertCard => ({
  id: 'mail-1',
  kind: 'single',
  title: 'Dinesh Perera',
  subtitle: 'Hasarinda · WorkSuite',
  rows: [row()],
  more: 0,
  high: false,
  level: 'full',
  replyable: true,
  inbox: { label: 'Open Inbox', route: '/mail?box=unified&folder=inbox' },
  at: new Date().toISOString(),
  ...over,
});

const group = (): MailAlertCard => ({
  ...single({ id: 'mail-group-1', kind: 'accounts', title: '5 new emails', subtitle: '3 accounts · last 2 min', replyable: false }),
  rows: [row(), row({ key: '5:inbox:2', mailbox: 5, uid: 2, sender: 'SFCL Procurement', subject: 'Clarification #2 for the website tender', account: 'Sales · shared' }), row({ key: '5:inbox:3', mailbox: 5, uid: 3, sender: 'Ravi · Ceylon Print', subject: 'Proof ready for approval — brochure v3', account: 'Sales · shared' })],
  more: 2,
});

const show = (card: MailAlertCard, extra: Record<string, unknown> = {}) => act(() => bus.get('mail-alert:show')!({ card, sound: false, ...extra }));

beforeEach(() => {
  bus.clear();
  vi.mocked(call).mockReset();
  vi.mocked(call).mockResolvedValue(null as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the in-app card (D27, MNA-APP-01…05)', () => {
  it('shows one email politely, with named actions and the tags in words', () => {
    render(<MailAlertCards />);
    show(single({ high: true, rows: [row({ high: true })] }));
    const card = screen.getByRole('status', { name: 'New email from Dinesh Perera' });
    expect(card.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText('Q4 budget — need your numbers by 3 pm')).toBeTruthy();
    expect(screen.getByText('High importance')).toBeTruthy();
    expect(screen.getByText('Checked')).toBeTruthy();
    expect(screen.getByText('1 attachment')).toBeTruthy();
    for (const name of ['Reply', 'Mark as read', 'Archive', 'Flag', 'Open', 'Dismiss']) expect(screen.getByRole('button', { name })).toBeTruthy();
    // It never takes the keyboard.
    expect(document.activeElement).toBe(document.body);
  });

  it('acts on the message: Mark as read, Archive, Flag go to the main process', async () => {
    render(<MailAlertCards />);
    show(single());
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Flag' }));
    await waitFor(() => expect(call).toHaveBeenCalledTimes(3));
    expect(call).toHaveBeenCalledWith('mailAlert:action', { id: 'mail-1', key: '3:inbox:41', action: 'read', text: null });
    expect(call).toHaveBeenCalledWith('mailAlert:action', { id: 'mail-1', key: '3:inbox:41', action: 'archive', text: null });
    expect(call).toHaveBeenCalledWith('mailAlert:action', { id: 'mail-1', key: '3:inbox:41', action: 'flag', text: null });
  });

  it('goes after 8 s, 15 s at high importance, and waits while hovered (MNA-APP-04)', () => {
    vi.useFakeTimers();
    render(<MailAlertCards />);
    show(single());
    act(() => void vi.advanceTimersByTime(7_900));
    expect(screen.queryByRole('status')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByRole('status')).toBeNull();

    show(single({ id: 'mail-2', high: true }));
    act(() => void vi.advanceTimersByTime(14_000));
    expect(screen.queryByRole('status')).toBeTruthy();
    fireEvent.mouseEnter(screen.getByRole('status'));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.queryByRole('status')).toBeTruthy();
    fireEvent.mouseLeave(screen.getByRole('status'));
    act(() => void vi.advanceTimersByTime(1_000));
    expect(screen.queryByRole('status')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1_000));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('takes a quick reply in the card, stays while typing, and offers Undo while it waits (MNA-APP-03)', async () => {
    vi.mocked(call).mockResolvedValue({ ok: true, sending: { id: 'reply-1', at: Date.now() + 8_000 } } as never);
    render(<MailAlertCards />);
    show(single());
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const box = screen.getByRole('textbox', { name: 'Reply to Dinesh Perera' });
    fireEvent.change(box, { target: { value: 'Sending them in 10 minutes.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('mailAlert:action', { id: 'mail-1', key: '3:inbox:41', action: 'reply', text: 'Sending them in 10 minutes.' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(call).toHaveBeenCalledWith('mailAlert:action', { id: 'reply-1', action: 'undo' });
  });

  it('says a reply was not sent, with Open draft', () => {
    render(<MailAlertCards />);
    show(single());
    act(() => bus.get('mail-alert:clear')!({ failed: { key: '3:inbox:41', error: 'Sending is paused for this mailbox.' } }));
    expect(screen.getByRole('alert').textContent).toContain('Sending is paused for this mailbox.');
    expect(screen.getByRole('button', { name: 'Open draft' })).toBeTruthy();
  });

  it('groups a burst: rows with their own actions, “and N more”, Mark all as read and Open Inbox (MNA-GRP-01)', () => {
    render(<MailAlertCards />);
    show(group());
    expect(screen.getByRole('status', { name: '5 new emails' })).toBeTruthy();
    expect(screen.getByText('3 accounts · last 2 min')).toBeTruthy();
    expect(screen.getByText('and 2 more')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reply to SFCL Procurement' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Mark as read' })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    expect(call).toHaveBeenCalledWith('mailAlert:action', { id: 'mail-group-1', key: null, action: 'read-all', text: null });
    fireEvent.click(screen.getByRole('button', { name: 'Open Inbox' }));
    expect(call).toHaveBeenCalledWith('mailAlert:action', { id: 'mail-group-1', key: null, action: 'open-inbox', text: null });
  });

  it('leaves when the message is read elsewhere (MNA-EVT-06)', () => {
    render(<MailAlertCards />);
    show(single());
    act(() => bus.get('mail-alert:clear')!({ ids: ['mail-1'] }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('opens the latest alert with Ctrl+Shift+N, and leaves the keys alone when there is none (MNA-A11-01)', async () => {
    render(<MailAlertCards />);
    const none = new KeyboardEvent('keydown', { key: 'N', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(none);
    expect(none.defaultPrevented).toBe(false);

    act(() => bus.get('mail-alert:state')!({ hasLatest: true }));
    vi.mocked(call).mockResolvedValueOnce(single({ id: 'mail-9' }) as never);
    const press = new KeyboardEvent('keydown', { key: 'N', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(call).toHaveBeenCalledWith('mailAlert:latest');
    await screen.findByRole('status', { name: 'New email from Dinesh Perera' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-mail-alert')).toBe('mail-9'));
  });

  it('shows nothing of the message at Hidden', () => {
    render(<MailAlertCards />);
    show(single({ title: 'New email in Hasarinda · WorkSuite', level: 'hidden', replyable: false, rows: [row({ sender: 'New email', subject: null, preview: null, address: null, checked: false, attachments: 0, initials: '✉' })] }));
    expect(screen.queryByText(/Dinesh/)).toBeNull();
    expect(screen.queryByText(/Q4 budget/)).toBeNull();
    expect(screen.getAllByText('New email in Hasarinda · WorkSuite').length).toBeGreaterThan(0);
  });

  it('appears without the slide where motion is reduced (MNA-A11-03)', () => {
    render(<MailAlertCards />);
    show(single());
    expect(screen.getByRole('status').className).toContain('motion-safe:animate-');
    expect(screen.getByRole('status').className).not.toMatch(/(^|\s)animate-/);
  });
});

describe('Settings › Mail › new-mail alerts (MNA-PRV-01, MNA-WIN-07, MNA-TRY-02)', () => {
  const state = (over: Partial<MailAlertState> = {}): MailAlertState => ({
    pause: null,
    paused: false,
    pauseLabel: null,
    pauseChoices: [
      { mode: '1h', label: 'For 1 hour', detail: 'until 11:42' },
      { mode: 'tomorrow', label: 'Until tomorrow', detail: '08:00' },
      { mode: 'manual', label: 'Until I turn them on', detail: '' },
    ],
    hoursNote: 'Outside working hours needs your working hours in HR.',
    preview: 'full',
    minPreview: null,
    sharing: false,
    sound: true,
    accounts: [{ id: 3, label: 'Hasarinda · WorkSuite', unread: 2, problem: false }],
    unread: 2,
    hasLatest: false,
    ...over,
  });

  it('chooses the preview level and Mail sound, here and on the server', async () => {
    vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'mailAlert:state' || channel === 'mailAlert:prefs' ? state() : null)) as never);
    render(<MailAlertSettings />);
    await screen.findByText('New email in Hasarinda · WorkSuite');
    fireEvent.click(screen.getByRole('radio', { name: /Hidden/ }));
    expect(updatePrefs).toHaveBeenCalledWith({ mailAlertPreview: 'hidden' });
    expect(call).toHaveBeenCalledWith('mailAlert:prefs', { preview: 'hidden' });
    await waitFor(() => expect((screen.getByRole('radio', { name: /Hidden/ }) as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mail sound' }));
    expect(updatePrefs).toHaveBeenCalledWith({ mailAlertSound: false });
    expect(call).toHaveBeenCalledWith('mailAlert:prefs', { sound: false });
  });

  it('keeps to the organisation’s minimum', async () => {
    app.set({ prefs: { mailAlertSound: true } as never });
    vi.mocked(call).mockImplementation((async () => state({ minPreview: 'sender', preview: 'sender' })) as never);
    render(<MailAlertSettings />);
    await screen.findByText('Your organization shows at most the sender in new-mail alerts.');
    expect((screen.getByRole('radio', { name: /Sender and preview/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: /Sender only/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('pauses and resumes, and says why Outside working hours is missing', async () => {
    app.set({ prefs: { mailAlertSound: true } as never });
    vi.mocked(call).mockImplementation((async (channel: string, input?: { mode?: string | null }) =>
      channel === 'mailAlert:pause' && input?.mode ? state({ pause: { mode: '1h', since: new Date().toISOString(), until: new Date(Date.now() + 3_600_000).toISOString() }, paused: true, pauseLabel: 'Paused until 11:42' }) : state()) as never);
    render(<MailAlertSettings />);
    await screen.findByText('Outside working hours needs your working hours in HR.');
    fireEvent.click(screen.getByRole('button', { name: /For 1 hour/ }));
    expect(call).toHaveBeenCalledWith('mailAlert:pause', { mode: '1h' });
    await screen.findByText('Mail alerts: Paused until 11:42');
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(call).toHaveBeenCalledWith('mailAlert:pause', { mode: null });
  });
});
