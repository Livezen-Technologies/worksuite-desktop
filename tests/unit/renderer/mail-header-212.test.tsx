// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Tabs from '../../../src/core/tabs';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: nav.navigate }));

import { ApiError, apiGet, apiGetMeta, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import { toast } from '../../../src/core/toasts';
import { MessageView } from '../../../src/modules/mail/MessageView';
import { headerDate, headerDensity, recipientSummary, securityVerdict, shieldTitle } from '../../../src/modules/mail/model';
import type { MailPrefs, Mailbox, MessageContext, MessageRef, MessageRow } from '../../../src/modules/mail/types';

/**
 * worksuite-desktop#212: a compact reading-pane header. The subject with the folder and External badges;
 * the sender on one line with the verification shield; "to me ▾" opening every header; the short date,
 * Star and More; a 48px bar once scrolled; three densities and a narrow layout.
 */

const NOW = new Date('2026-10-03T16:00:00Z');
const ACCOUNT: Mailbox = { id: 2, email: 'hasarinda@livezentech.example', display_name: 'Hasarinda', shared: false, unread: 2, in_unified: true, provider: 'imap', provider_label: 'Custom IMAP', colour: 'indigo', auth_state: 'ok' };
const OTHER: Mailbox = { id: 1, email: 'me@livezentech.example', display_name: 'me', shared: false, unread: 0, in_unified: true, provider: 'imap', colour: 'blue', auth_state: 'ok' };
const REF: MessageRef = { uid: '102', folder: 'inbox', mailbox: '2' };
const PASS = { available: true, spf: 'pass', dkim: 'pass', dmarc: 'pass' };

let message: Record<string, unknown>;
let context: Partial<MessageContext>;

const base = () => ({
  id: 102,
  message_id: '<verify-1@dynadot.example>',
  from_name: 'Dynadot Accounts',
  from_email: 'accounts@dynadot.example',
  subject: 'Account Info Verification',
  to: ['hasarinda@livezentech.example'],
  cc: [],
  body_html: '<p>Please verify your account details</p>',
  is_starred: false,
  is_read: true,
  attachments: [],
  created_at: '2026-10-03 15:26:00',
});

function Harness(props: { prefs?: MailPrefs; combined?: boolean; onOpenFolder?: (r: MessageRef) => void; onPrefs?: (p: Partial<MailPrefs>) => void; marks?: MessageRow | null }) {
  const [prefs, setPrefs] = useState<MailPrefs>(props.prefs ?? {});
  return (
    <TabProvider tabId="t" route="/mail" active>
      <MessageView
        msgRef={REF}
        backLabel="Inbox"
        onBack={() => undefined}
        onReply={() => undefined}
        onGone={() => undefined}
        onPrev={null}
        onNext={null}
        prefs={prefs}
        onPrefs={(patch) => {
          props.onPrefs?.(patch);
          setPrefs((p) => ({ ...p, ...patch }));
        }}
        focus={false}
        onFocus={() => undefined}
        boxes={[OTHER, ACCOUNT]}
        localStore={false}
        offline={false}
        account={ACCOUNT}
        combined={props.combined}
        onOpenFolder={props.onOpenFolder}
        marks={props.marks ?? null}
      />
    </TabProvider>
  );
}

function show(props: Parameters<typeof Harness>[0] = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

async function header(): Promise<HTMLElement> {
  // The list row's saved header shows first while the body downloads (#209): wait for the real one.
  return waitFor(() => {
    const h = document.querySelector('[data-message-header]');
    if (!h) throw new Error('no header yet');
    return h as HTMLElement;
  });
}

const clipboard = { writeText: vi.fn(async () => undefined) };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setRegional({ timezone: 'UTC', locale: 'en-US', timeFormat: '12' });
  message = base();
  context = { sender: { email: 'accounts@dynadot.example', name: 'Dynadot Accounts', contact_id: null, user_id: null, is_colleague: false, company: null }, security: PASS, history: { total: 4, first: null, last: null, messages: [] } };
  app.set({ status: { network: 'ONLINE' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@livezentech.example' } } as never, auth: { server: { origin: 'https://app.worksuite.example' } } as never, apps: [{ id: 'contacts' }, { id: 'meet' }, { id: 'crm' }, { id: 'tasks' }, { id: 'chat' }] as never });
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  clipboard.writeText.mockClear();
  vi.mocked(toast).mockReset();
  nav.navigate.mockReset();
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/mail/messages/102/context') return context;
    if (path === '/api/crm/leads') return { leads: [{ id: 7, name: 'Dynadot', email: 'accounts@dynadot.example' }] };
    if (path === '/api/mail/vips') return { vips: [] };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/mail/messages/102') return { data: message, offline: false, cachedAt: null };
    throw new ApiError(404, path, null);
  }) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(call).mockReset().mockImplementation((async (channel: string) => (channel === 'offline:pending' ? [] : null)) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the header’s parts (#212)', () => {
  it('shortens the date: the time today, the day this year, the year before that, and the whole date as the tooltip', () => {
    expect(headerDate('2026-10-03 15:26:00', '2026-10-03')).toEqual({ short: '3:26 PM', full: 'Saturday, October 3, 2026, 3:26 PM' });
    expect(headerDate('2026-09-30 15:26:00', '2026-10-03').short).toBe('Sep 30, 3:26 PM');
    expect(headerDate('2025-12-30 09:05:00', '2026-10-03').short).toBe('Dec 30, 2025, 9:05 AM');
  });

  it('sums up who it went to: the reader first as "me", two names and how many more', () => {
    const mine = ['hasarinda@livezentech.example'];
    expect(recipientSummary(['hasarinda@livezentech.example'], [], mine)).toBe('to me');
    expect(recipientSummary(['Dimuthu Perera <dimuthu@x.example>', 'Hasarinda <HASARINDA@livezentech.example>', 'ann@x.example'], ['ravi@x.example'], mine)).toBe('to me, Dimuthu +2');
    expect(recipientSummary(['ann@x.example', 'ravi@x.example'], [], mine)).toBe('to ann, ravi');
    expect(recipientSummary([], [], mine)).toBe('to undisclosed recipients');
  });

  it('words the shield for a pass, a partial pass and a failure', () => {
    expect(shieldTitle(securityVerdict(PASS)!)).toBe('Verified · SPF, DKIM, DMARC passed');
    expect(securityVerdict({ available: true, spf: 'pass', dkim: 'none', dmarc: 'none' })).toMatchObject({ state: 'partial' });
    expect(securityVerdict({ available: true, spf: 'fail', dkim: 'pass', dmarc: 'fail' })).toMatchObject({ state: 'fail', checks: 'SPF, DMARC' });
  });

  it('follows the Mail density setting; the full list reads as Compact', () => {
    expect(headerDensity(undefined)).toBe('compact');
    expect(headerDensity('table')).toBe('compact');
    expect(headerDensity('super')).toBe('super');
    expect(headerDensity('classic')).toBe('classic');
  });
});

describe('the reading pane header (#212)', { timeout: 20_000 }, () => {
  it('Compact: the subject row with its badges, the sender on one line, the date and two buttons', async () => {
    const onOpenFolder = vi.fn();
    show({ onOpenFolder });
    const h = await header();
    expect(h.dataset.density).toBe('compact');
    const subject = within(h).getByRole('heading', { name: 'Account Info Verification' });
    expect(subject.getAttribute('title')).toBe('Account Info Verification');
    expect(subject.className).toContain('line-clamp-2');
    expect(subject.className).toContain('text-[20px]');
    const badges = within(h).getByRole('group', { name: 'About this message' });
    expect(await within(badges).findByText('External')).toBeTruthy();
    fireEvent.click(within(badges).getByRole('button', { name: 'Open Inbox' }));
    expect(onOpenFolder).toHaveBeenCalledWith(REF);
    // One line for the sender: name, muted address and the shield.
    const name = within(h).getByRole('button', { name: 'Dynadot Accounts' });
    const line = name.parentElement as HTMLElement;
    expect(within(line).getByRole('button', { name: 'Copy address accounts@dynadot.example' }).textContent).toBe('<accounts@dynadot.example>');
    expect(await within(line).findByRole('img', { name: 'Verified · SPF, DKIM, DMARC passed' })).toBeTruthy();
    // The date, short, with the whole date as its tooltip; Star and More only, each with a tooltip.
    const date = h.querySelector('time') as HTMLElement;
    expect(date.textContent).toBe('3:26 PM');
    expect(date.getAttribute('title')).toBe('Saturday, October 3, 2026, 3:26 PM');
    expect(within(h).getByRole('button', { name: 'Star (S)' }).getAttribute('title')).toBe('Star (S)');
    expect(within(h).getByRole('button', { name: 'More actions for this email' }).getAttribute('title')).toBe('More actions for this email');
    expect(within(h).queryByRole('button', { name: 'Remind me about this' })).toBeNull();
    // Not a combined view: no account dot; a pass needs no warning.
    expect(h.querySelector('[data-account-dot]')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(h.className).toContain('px-5 py-4');
    expect(h.className).toContain('border-b');
  });

  it('shows the account as a dot by the date only in a combined view', async () => {
    show({ combined: true });
    const h = await header();
    const dot = within(h).getByRole('img', { name: 'hasarinda@livezentech.example · Custom IMAP' });
    expect(dot.getAttribute('title')).toBe('hasarinda@livezentech.example · Custom IMAP');
  });

  it('shows External only for senders outside the organisation', async () => {
    message = { ...base(), from_name: 'Dimuthu', from_email: 'dimuthu@livezentech.example' };
    context = { ...context, sender: { email: 'dimuthu@livezentech.example', name: 'Dimuthu', contact_id: null, user_id: 3, is_colleague: true, company: null } };
    show();
    const h = await header();
    await within(h).findByRole('img', { name: /Verified/ });
    expect(within(h).queryByText('External')).toBeNull();
  });

  it('warns clearly when the checks failed, with a bar above the body, and in amber when partly verified', async () => {
    context = { ...context, security: { available: true, spf: 'fail', dkim: 'pass', dmarc: 'fail' } };
    show();
    let h = await header();
    const shield = await within(h).findByRole('img', { name: /^Not verified · SPF, DMARC failed/ });
    expect(shield.dataset.shield).toBe('fail');
    expect(shield.className).toContain('text-danger');
    expect(within(shield).getByText('Not verified')).toBeTruthy();
    const bar = screen.getByRole('alert');
    expect(bar.textContent).toContain('This email failed its sender checks (SPF, DMARC).');
    // Above the body.
    expect(bar.compareDocumentPosition(document.querySelector('iframe')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();

    context = { ...context, security: { available: true, spf: 'pass', dkim: 'none', dmarc: 'none' } };
    show();
    h = await header();
    const partial = await within(h).findByRole('img', { name: /^Partly verified/ });
    expect(partial.className).toContain('text-warning');
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();

    context = { ...context, security: PASS };
    show();
    h = await header();
    const pass = await within(h).findByRole('img', { name: 'Verified · SPF, DKIM, DMARC passed' });
    expect(pass.className).toContain('text-success');
    expect(pass.textContent).toBe('');
  });

  it('sums up the recipients as "to me, Dimuthu +2" and opens every header from it', async () => {
    message = { ...base(), to: ['hasarinda@livezentech.example', 'Dimuthu Perera <dimuthu@x.example>'], cc: ['ann@x.example', 'ravi@x.example'], reply_to: 'billing@dynadot.example' };
    show({ combined: true });
    const h = await header();
    const toggle = within(h).getByRole('button', { name: 'to me, Dimuthu +2' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const details = await within(h).findByLabelText('Message details');
    const row = (k: string) => within(details).getByText(k).nextElementSibling?.textContent;
    expect(row('From')).toBe('Dynadot Accounts <accounts@dynadot.example>');
    expect(row('To')).toBe('hasarinda@livezentech.example, Dimuthu Perera <dimuthu@x.example>');
    expect(row('Cc')).toBe('ann@x.example, ravi@x.example');
    expect(row('Reply-To')).toBe('billing@dynadot.example');
    expect(row('Date')).toBe('Saturday, October 3, 2026, 3:26 PM');
    await waitFor(() => expect(row('Mailed-by')).toBe('dynadot.example'));
    expect(row('Signed-by')).toBe('dynadot.example');
    expect(row('Account')).toBe('hasarinda@livezentech.example · Custom IMAP');
    expect(row('Folder')).toBe('Inbox');
    fireEvent.click(toggle);
    expect(within(h).queryByLabelText('Message details')).toBeNull();
  });

  it('copies the sender’s address with a click on it', async () => {
    show();
    const h = await header();
    fireEvent.click(within(h).getByRole('button', { name: 'Copy address accounts@dynadot.example' }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('accounts@dynadot.example'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', 'Address copied.'));
  });

  it('opens the sender’s card from the name: Add to contacts, Create meeting, New email and View in CRM', async () => {
    show();
    const h = await header();
    fireEvent.click(within(h).getByRole('button', { name: 'Dynadot Accounts' }));
    const card = await screen.findByRole('dialog', { name: 'About Dynadot Accounts' });
    for (const name of ['New email', 'Create meeting', 'Add to contacts', 'View in CRM']) expect(within(card).getByRole('button', { name })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'View in CRM' }));
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('/crm?lead=7'));
  });

  it('keeps the rest in ⋯: follow up, the sender, copy, source, print and the .eml', async () => {
    const onPrefs = vi.fn();
    show({ onPrefs });
    const h = await header();
    fireEvent.click(within(h).getByRole('button', { name: 'More actions for this email' }));
    const menu = await screen.findByRole('menu', { name: 'More actions for this email' });
    const items = [...menu.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent ?? '');
    for (const want of ['Remind me about this', 'Add sender to contacts', 'Create meeting with sender', 'New email to sender', 'Copy link', 'Copy sender address', 'Copy subject', 'View source', 'Print', 'Download .eml', 'Show more buttons in the header']) {
      expect(items.some((t) => t.startsWith(want))).toBe(true);
    }
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Copy subject/ }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('Account Info Verification'));
    // More buttons in the row, when asked for.
    fireEvent.click(within(h).getByRole('button', { name: 'More actions for this email' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', { name: /Show more buttons in the header/ }));
    expect(onPrefs).toHaveBeenCalledWith({ headerIcons: 'more' });
    for (const name of ['Remind me about this', 'Add sender to contacts', 'Create meeting with sender', 'View source', 'Print this email']) expect(within(h).getByRole('button', { name }).getAttribute('title')).toBe(name);
    // View source opens the original.
    vi.mocked(apiGet).mockImplementationOnce((async () => ({ source: 'Received: from mx' })) as never);
    fireEvent.click(within(h).getByRole('button', { name: 'View source' }));
    expect(await screen.findByText('Received: from mx')).toBeTruthy();
  });

  it('collapses to a 48px bar with the subject and sender when scrolled, and back at the top', async () => {
    show();
    await header();
    const scroller = document.querySelector('[data-reader-scroll]') as HTMLElement;
    expect(document.querySelector('[data-collapsed-header]')).toBeNull();
    scroller.scrollTop = 240;
    fireEvent.scroll(scroller);
    const bar = document.querySelector('[data-collapsed-header]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.className).toContain('h-12');
    expect(bar.textContent).toContain('Account Info Verification');
    expect(bar.textContent).toContain('Dynadot Accounts');
    expect(bar.parentElement?.className).toContain('sticky');
    fireEvent.click(bar);
    expect(scroller.scrollTop).toBe(0);
    expect(document.querySelector('[data-collapsed-header]')).toBeNull();
  });

  it('Super compact puts the subject and the sender on one line; Classic is roomier and lists everyone', async () => {
    show({ prefs: { view: 'super' } });
    let h = await header();
    expect(h.dataset.density).toBe('super');
    const subject = within(h).getByRole('heading', { name: 'Account Info Verification' });
    const sender = within(h).getByRole('button', { name: 'Dynadot Accounts' });
    expect(subject.parentElement).toBe(sender.closest('div.flex'));
    expect(within(h).getByRole('button', { name: 'Star (S)' })).toBeTruthy();
    cleanup();

    message = { ...base(), cc: ['ann@x.example'] };
    show({ prefs: { view: 'classic' } });
    h = await header();
    expect(h.dataset.density).toBe('classic');
    expect(within(h).getByRole('heading', { name: 'Account Info Verification' }).className).toContain('text-[22px]');
    expect(within(h).getByRole('button', { name: 'to hasarinda@livezentech.example · cc ann@x.example' })).toBeTruthy();
  });

  it('in a narrow pane, puts the badges under the subject and the date under the sender', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private cb: ResizeObserverCallback) {}
        observe() {
          this.cb([{ contentRect: { width: 420 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        disconnect() {}
        unobserve() {}
      },
    );
    show();
    const h = await header();
    await waitFor(() => expect(h.dataset.narrow).toBe('true'));
    const subjectRow = within(h).getByRole('heading', { name: 'Account Info Verification' }).parentElement as HTMLElement;
    expect(subjectRow.className).toContain('flex-col');
    expect(within(subjectRow).getByRole('group', { name: 'About this message' })).toBeTruthy();
    const toLine = within(h).getByRole('button', { name: 'to me' }).parentElement as HTMLElement;
    expect(toLine.querySelector('time')?.textContent).toBe('3:26 PM');
  });

  it('keeps the reader’s own features: star, pinned and flag chips, labels, and Saved on this computer', async () => {
    const marks = { id: 102, subject: 'Account Info Verification', from_name: '', from_email: '', preview: '', is_read: true, is_starred: false, has_attachment: false, created_at: '', pinned: true, flag: { due_at: null, completed_at: null } } as unknown as MessageRow;
    message = { ...base(), labels: [{ id: 4, name: 'Billing', color: null }] };
    vi.mocked(apiGetMeta).mockImplementation((async () => ({ data: message, offline: true, cachedAt: null })) as never);
    show({ marks });
    const h = await header();
    const badges = within(h).getByRole('group', { name: 'About this message' });
    expect(within(badges).getByText('Pinned')).toBeTruthy();
    expect(within(badges).getByText('Flagged')).toBeTruthy();
    expect(within(badges).getByText('Billing')).toBeTruthy();
    expect(within(h).getByText('Saved on this computer')).toBeTruthy();
    fireEvent.click(within(h).getByRole('button', { name: 'Star (S)' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('offline:submit', expect.objectContaining({ entity: 'message.star' })));
    // The toolbar above is unchanged.
    expect(screen.getByRole('button', { name: 'Archive (E)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download original (.eml)' })).toBeTruthy();
  });
});
