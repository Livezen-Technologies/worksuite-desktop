// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { ApiError, apiGet, apiGetMeta, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import { toast } from '../../../src/core/toasts';
import MailPage from '../../../src/modules/mail/MailPage';
import { Rules, Signatures, exportRules, importRules, type MailFilter } from '../../../src/modules/mail/MailRules';
import { QuickStepsSettings } from '../../../src/modules/mail/QuickStepsUi';
import { freshRows, markSeen, myRules, rowMatches, ruleTakes } from '../../../src/modules/mail/clientRules';
import { pickSignature, sendChecks } from '../../../src/modules/mail/composeHtml';
import { answered, needsAsking, removesMessages, runQuickStep, type QuickStep, type Runner } from '../../../src/modules/mail/quickSteps';
import type { MessageRow } from '../../../src/modules/mail/types';

/**
 * ENH-MAIL-03 P2 — productivity: Quick Steps (DMO-QS-01…06, WF-DO03,
 * AC-DMO-05), rules with exceptions, this-computer rules, import/export and
 * Run now (DMO-RUL-01…08, WF-DO04, AC-DMO-06), signatures per account
 * (DMO-CMP-06), Quick Parts (DMO-CMP-07) and the send checks (DMO-CMP-16).
 */

const row = (id: number, over: Partial<MessageRow> = {}): MessageRow => ({ id, from_name: `Sender ${id}`, from_email: `s${id}@example.org`, subject: `Subject ${id}`, preview: '', is_read: true, is_starred: false, has_attachment: false, created_at: '2026-10-05 09:00:00', folder_slug: 'inbox', ...over });
const step = (over: Partial<QuickStep> = {}): QuickStep => ({ id: 1, name: 'To manager', icon: 'zap', shortcut: 1, tooltip: null, actions: [{ type: 'archive' }, { type: 'read' }], ask_fields: [], org: false, position: 0, ...over });
const filter = (over: Partial<MailFilter> = {}): MailFilter => ({ name: null, field: 'from', op: 'contains', value: 'example.org', action: 'fileinto', action_arg: 'Clients', stop: true, enabled: true, ...over });

beforeEach(() => {
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
  window.localStorage.clear();
  vi.mocked(toast).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Quick Steps', () => {
  const fake = () => {
    const calls: string[] = [];
    const r: Runner = {
      action: vi.fn(async (ref, a) => (calls.push(`${a}:${ref.uid}`), 'done' as const)),
      move: vi.fn(async (ref, to) => (calls.push(`move ${to}:${ref.uid}`), 'done' as const)),
      state: vi.fn(async (a, items) => (calls.push(`${a}:${String(items[0]!.uid)}`), 'done' as const)),
      post: vi.fn(async (path: string) => (calls.push(`post ${path}`), {})) as unknown as Runner['post'],
      get: vi.fn(async () => ({ attachments: [] })) as unknown as Runner['get'],
    };
    return { r, calls };
  };

  it('runs every action on every message in order, each in its own account, and prefills replies instead of sending (WF-DO03)', async () => {
    const { r, calls } = fake();
    const s = step({ actions: [{ type: 'move', folder: 'label:Clients' }, { type: 'category', category_id: 3 }, { type: 'flag', when: 'today' }, { type: 'reply', template_id: 9 }] });
    const report = await runQuickStep(s, [{ row: row(1), mailbox: '4', folder: 'inbox' }, { row: row(2, { subject: 'Re: Plan' }), mailbox: '7', folder: 'inbox' }], r);
    expect(calls).toEqual(['move label:Clients:1', 'categorise:1', 'flag:1', 'star:1', 'move label:Clients:2', 'categorise:2', 'flag:2', 'star:2']);
    expect(vi.mocked(r.move).mock.calls.map((c) => c[0].mailbox)).toEqual(['4', '7']);
    expect(report).toEqual({ done: 2, failed: 0, errors: [], compose: [expect.objectContaining({ mode: 'reply', to: 's1@example.org', subject: 'Re: Subject 1', mailbox: '4', templateId: 9 }), expect.objectContaining({ subject: 'Re: Plan', mailbox: '7' })] });
  });

  it('stops the rest of the actions for a message that fails, and carries on with the others', async () => {
    const { r, calls } = fake();
    vi.mocked(r.action).mockImplementation(async (ref, a) => {
      if (ref.uid === '1' && a === 'archive') throw new Error('Mailbox is read-only');
      calls.push(`${a}:${ref.uid}`);
      return 'done';
    });
    const report = await runQuickStep(step(), [{ row: row(1), mailbox: '4', folder: 'inbox' }, { row: row(2), mailbox: '4', folder: 'inbox' }], r);
    expect(calls).toEqual(['archive:2', 'read:2']);
    expect(report.done).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.errors).toEqual(['Subject 1: Mailbox is read-only']);
  });

  it('asks for a folder or an address once, then keeps the answer (DMO-QS-04)', () => {
    const s = step({ actions: [{ type: 'move', ask: true }, { type: 'forward', ask: true }, { type: 'read' }] });
    expect(needsAsking(s)).toEqual(['folder', 'to']);
    const a = answered(s, { folder: 'label:Clients', to: 'boss@example.org' });
    expect(a.actions).toEqual([{ type: 'move', ask: false, folder: 'label:Clients' }, { type: 'forward', ask: false, to: 'boss@example.org' }, { type: 'read' }]);
    expect(needsAsking(a)).toEqual([]);
    expect(removesMessages(s)).toBe(true);
    expect(removesMessages(step({ actions: [{ type: 'read' }, { type: 'pin' }] }))).toBe(false);
  });
});

describe('rules', () => {
  it('exports and imports rules with exceptions and where they run; an Outlook .rwz file is refused plainly (DMO-RUL-07)', () => {
    const rules = [filter({ name: 'Clients', exceptions: [{ field: 'subject', op: 'contains', value: 'newsletter' }] }), filter({ value: 'boss@example.org', action: 'star', action_arg: null, run_location: 'client', client_actions: ['alert', 'sound'] })];
    const back = importRules(exportRules(rules));
    expect('rules' in back && back.rules).toEqual([
      expect.objectContaining({ name: 'Clients', field: 'from', value: 'example.org', action: 'fileinto', action_arg: 'Clients', exceptions: [{ field: 'subject', op: 'contains', value: 'newsletter' }], run_location: 'server' }),
      expect.objectContaining({ value: 'boss@example.org', action: 'star', run_location: 'client', client_actions: ['alert', 'sound'] }),
    ]);
    expect(importRules('RWZ\u0000binary')).toEqual({ error: expect.stringMatching(/Outlook \.rwz rules cannot be read/) });
    expect(importRules('{"rules":[{"field":"evil","op":"exec","value":"x","action":"rm"}]}')).toEqual({ rules: [expect.objectContaining({ field: 'from', op: 'contains', action: 'fileinto' })] });
  });

  it('matches conditions and leaves out exceptions (DMO-RUL-03)', () => {
    const m = { from_name: 'Pat Lee', from_email: 'pat@client.example', subject: 'Weekly newsletter' };
    expect(rowMatches({ field: 'from', op: 'contains', value: 'client.example' }, m)).toBe(true);
    expect(rowMatches({ field: 'from', op: 'is', value: 'pat@client.example' }, m)).toBe(true);
    expect(rowMatches({ field: 'subject', op: 'matches', value: 'weekly *' }, m)).toBe(true);
    expect(rowMatches({ field: 'subject', op: 'contains', value: '' }, m)).toBe(false);
    const rule = filter({ value: 'client.example', run_location: 'client', exceptions: [{ field: 'subject', op: 'contains', value: 'newsletter' }] });
    expect(ruleTakes(rule, m)).toBe(false);
    expect(ruleTakes(rule, { ...m, subject: 'Invoice' })).toBe(true);
    expect(ruleTakes({ ...rule, enabled: false }, { ...m, subject: 'Invoice' })).toBe(false);
  });

  it('runs this-computer rules only here, on mail not handled before, quietly for old mail (DMO-RUL-04, WF-DO04)', () => {
    const rules = [filter({ run_location: 'client', device_id: 'dev-here' }), filter({ run_location: 'client', device_id: 'dev-other' }), filter({ run_location: 'server' })];
    expect(myRules(rules, 'dev-here')).toEqual([rules[0]]);
    const now = new Date('2026-10-05T10:00:00Z').getTime();
    window.localStorage.setItem('ws.mail.clientRules.since', String(now - 86_400_000));
    const rows = [row(1, { created_at: '2026-10-05 09:58:00' }), row(2, { created_at: '2026-10-05 08:00:00' }), row(3, { created_at: '2026-09-01 08:00:00' })];
    const key = (m: MessageRow) => String(m.id);
    const first = freshRows(rows, key, now);
    expect(first.rows.map(key)).toEqual(['1', '2']);
    expect([...first.old]).toEqual(['2']);
    markSeen(first.rows.map(key));
    expect(freshRows(rows, key, now).rows).toEqual([]);
  });
});

describe('compose helpers', () => {
  it('asks before sending when an attachment is mentioned but missing, or the subject is empty (DMO-CMP-16)', () => {
    expect(sendChecks({ subject: 'Plan', attachments: [] }, 'Please see the attached plan')).toEqual(['attachment']);
    expect(sendChecks({ subject: 'Plan', attachments: [{ token: 't', name: 'a.pdf', size: 1 }] as never }, 'see attached')).toEqual([]);
    expect(sendChecks({ subject: ' ', attachments: [] }, 'Hello')).toEqual(['subject']);
  });

  it('picks the account’s own signature for new mail or replies, then the one for every account (DMO-CMP-06)', () => {
    const sigs = [
      { id: 1, is_default: true, mailbox: null, default_new: false, default_reply: false },
      { id: 2, is_default: false, mailbox: null, default_new: true, default_reply: false },
      { id: 3, is_default: false, mailbox: 7, default_new: true, default_reply: false },
      { id: 4, is_default: false, mailbox: 7, default_new: false, default_reply: true },
    ];
    expect(pickSignature(sigs, '7', 'new')?.id).toBe(3);
    expect(pickSignature(sigs, '7', 'reply')?.id).toBe(4);
    expect(pickSignature(sigs, '4', 'new')?.id).toBe(2);
    expect(pickSignature(sigs, '4', 'forward')?.id).toBe(1);
    expect(pickSignature([], '4', 'new')).toBeNull();
  });
});

// ---- screens ------------------------------------------------------------------------------------

const BOX = { id: 4, email: 'me@example.test', display_name: 'me', shared: false, unread: 1, in_unified: true, is_default: true, provider: 'office365', provider_label: 'Microsoft 365', colour: 'blue', auth_state: 'ok' };
const BOX2 = { ...BOX, id: 7, email: 'sales@example.test', is_default: false };

const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

describe('settings screens', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/quick-steps') return { quick_steps: [step(), step({ id: 2, name: 'Team rules', shortcut: null, org: true })] };
      if (path === '/api/mail/quick-parts') return { quick_parts: [{ id: 5, name: 'Directions', html: '<div>Gate 2, ground floor</div>', org: false }] };
      if (path === '/api/mail/signatures') return { signatures: [] };
      if (path === '/api/mail/mailboxes') return { mailboxes: [BOX, BOX2] };
      if (path === '/api/mail/rules') return { server_rules: { available: true, reason: null }, vacation: { enabled: false, subject: '', message: '', start_date: null, end_date: null }, filters: [filter({ id: 12, name: 'Clients' }), filter({ id: 13, name: 'Alerts', run_location: 'client', device_id: 'dev-other', client_actions: ['alert'] })] };
      if (path === '/api/mail/folders') return { folders: [{ id: 1, name: 'Inbox', slug: 'inbox', type: 'system', total: 3, unread: 0 }] };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiPost).mockReset().mockResolvedValue({ checked: 40, matched: 6, done: 6 } as never);
    vi.mocked(apiPut).mockReset().mockResolvedValue({} as never);
  });

  it('lists Quick Steps with their actions and keys; organisation steps are read-only; Quick Parts are added there (DMO-QS-02, DMO-CMP-07)', async () => {
    wrap(<QuickStepsSettings />);
    expect(await screen.findAllByText('Archive → Mark as read')).toHaveLength(2);
    expect(screen.getByText('Ctrl+Shift+1')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2); // one Quick Step + one Quick Part
    expect(screen.queryByRole('button', { name: 'Delete Team rules' })).toBeNull();
    const parts = screen.getByRole('region', { name: 'Quick Parts' });
    expect(await within(parts).findByText('Gate 2, ground floor')).toBeTruthy();
    fireEvent.click(within(parts).getByRole('button', { name: 'New Quick Part' }));
    fireEvent.change(within(parts).getByLabelText('Name'), { target: { value: 'Bank details' } });
    fireEvent.change(within(parts).getByLabelText('Text'), { target: { value: 'Account 1234' } });
    fireEvent.click(within(parts).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/quick-parts', { name: 'Bank details', html: expect.stringContaining('Account 1234') }));
  });

  it('saves a signature for one account, as the default for replies only (DMO-CMP-06)', async () => {
    wrap(<Signatures />);
    fireEvent.click(await screen.findByRole('button', { name: 'New signature' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sales' } });
    fireEvent.change(screen.getByLabelText('Signature'), { target: { value: 'Sales team' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/mail/mailboxes'));
    fireEvent.click(screen.getByRole('combobox', { name: 'For' }));
    fireEvent.click(await screen.findByRole('option', { name: 'sales@example.test' }));
    fireEvent.click(screen.getByLabelText('Use for new messages'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/signatures', expect.objectContaining({ name: 'Sales', mailbox: 7, default_new: false, default_reply: true, html: expect.stringContaining('Sales team') })));
  });

  it('shows where each rule runs, and runs a server rule now on a folder (DMO-RUL-04/05, AC-DMO-06)', async () => {
    wrap(<Rules mailbox="4" />);
    const rules = within(await screen.findByRole('region', { name: 'Filter rules' }));
    const items = await rules.findAllByRole('listitem');
    expect(within(items[0]!).getByText('On the server')).toBeTruthy();
    expect(within(items[1]!).getByText('On another computer')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Run now' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/rules/12/run', { mailbox: '4', folder: 'inbox', since: null, until: null }));
    expect(await within(dialog).findByText('Checked 40 · 6 matched · 6 changed.')).toBeTruthy();
  });
});

const ROWS = [row(11, { from_name: 'Colleague', from_email: 'colleague@example.org', subject: 'Budget review', is_read: false })];

function Page() {
  const [route, setRoute] = useState('/mail');
  return (
    <TabProvider tabId="t" route={route} active onGo={setRoute}>
      <MailPage active tabId="t" route={route} />
    </TabProvider>
  );
}

describe('Quick Steps on the Mail screen (AC-DMO-05)', () => {
  beforeEach(() => {
    app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [] });
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/mailboxes') return { mailboxes: [BOX] };
      if (path === '/api/mail/prefs') return { prefs: { firstRun: 'done', focused: false } };
      if (path === '/api/mail/quick-steps') return { quick_steps: [step()] };
      if (path === '/api/mail/folders') return { folders: [{ id: 1, name: 'Inbox', slug: 'inbox', type: 'system', total: 1, unread: 1 }] };
      if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: [], accounts: [] };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/messages') return { data: { messages: ROWS, total: 1, has_more: false }, offline: false, cachedAt: null };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(call).mockReset().mockImplementation((async (channel: string) => {
      if (channel === 'offline:pending') return [];
      if (channel === 'offline:submit') return { delivered: true, queued: false, id: null, status: 200, data: null, error: null, code: null };
      return null;
    }) as never);
  });

  const submitted = () => vi.mocked(call).mock.calls.filter(([c]) => c === 'offline:submit').map(([, i]) => (i as { entity: string }).entity);

  it('runs from the right-click menu: the message goes at once, Undo brings it back and nothing is changed', async () => {
    wrap(<Page />);
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    fireEvent.contextMenu(await within(list).findByText('Colleague'));
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /To manager/ }));
    await waitFor(() => expect(within(list).queryByText('Colleague')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await within(list).findByText('Colleague')).toBeTruthy();
    expect(submitted()).toEqual([]);
  });

  it('does every action after the undo window, through the offline queue', async () => {
    wrap(<Page />);
    const list = await screen.findByRole('listbox', { name: 'Messages' });
    fireEvent.contextMenu(await within(list).findByText('Colleague'));
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /To manager/ }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    vi.useRealTimers();
    await waitFor(() => expect(submitted()).toEqual(['message.archive', 'message.read']));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Done: “To manager” on “Budget review”.'));
  });
});
