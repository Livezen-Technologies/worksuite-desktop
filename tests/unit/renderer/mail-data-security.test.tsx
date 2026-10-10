// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Tabs from '../../../src/core/tabs';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
const bridge = vi.hoisted(() => ({ listeners: new Map<string, (p: unknown) => void>() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => null),
  on: (channel: string, cb: (p: unknown) => void) => {
    bridge.listeners.set(channel, cb);
    return () => bridge.listeners.delete(channel);
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isMac: false,
  hasDesktop: () => true,
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: nav.navigate }));

import { ApiError, apiGet, apiPost } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { setRegional } from '../../../src/core/time';
import { toast } from '../../../src/core/toasts';
import { composeBody, voteChoices, withVotePrompt } from '../../../src/modules/mail/composeHtml';
import { DataFileImport, ExportDialog, folderLabel, planEntries, progressWords } from '../../../src/modules/mail/DataFiles';
import { fileReplyRoute } from '../../../src/modules/mail/FileViewer';
import { MailLinkGuard, judgeLink, reasonWords } from '../../../src/modules/mail/LinkGuard';
import { MarkerChips, RecallDialog, ReceiptBar, ReportDialog, SmimeChip, VoteBar, VoteTally, recallStateWords } from '../../../src/modules/mail/MessageExtras';
import { blockedImageUrls, sanitizeMailHtml, withProxiedImages } from '../../../src/modules/mail/sanitize';
import { parseSafeLink } from '@shared/mail-files';
import type { ImportProgress, MailFileView } from '@shared/mail-files';

/**
 * ENH-MAIL-03 P4 in the window: importing a data file (DMO-DAT-01/02,
 * AC-DMO-10), export (DMO-DAT-03), a message file to read (DMO-DAT-04),
 * safe links (DMO-SEC-03), report phishing (DMO-SEC-02, AC-DMO-13), recall
 * (DMO-CMP-10, AC-DMO-08) and voting (DMO-CMP-12) — each honest about what it
 * can and cannot do.
 */

const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
const REF = { uid: '7', folder: 'inbox', mailbox: '4' };

beforeEach(() => {
  setRegional({ timezone: 'Asia/Colombo', locale: 'en-GB', timeFormat: '24' });
  vi.mocked(toast).mockReset();
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiGet).mockReset();
  vi.mocked(call).mockReset().mockResolvedValue(null as never);
  nav.navigate.mockReset();
  bridge.listeners.clear();
});
afterEach(() => cleanup());

describe('safe links (DMO-SEC-03)', () => {
  it('point every shown link at the app, with the real address on hover; a copy kept elsewhere keeps real links', () => {
    const html = '<a href="https://www.paypal.com.bad.example/login">www.paypal.com</a><a href="#top">top</a><a href="file:///etc/passwd">f</a>';
    const shown = sanitizeMailHtml(html);
    const doc = new DOMParser().parseFromString(shown.html, 'text/html');
    const [a, top, file] = [...doc.querySelectorAll('a')];
    expect(parseSafeLink(a!.getAttribute('href')!)).toEqual({ url: 'https://www.paypal.com.bad.example/login', text: 'www.paypal.com' });
    expect(a!.getAttribute('title')).toBe('https://www.paypal.com.bad.example/login');
    expect(top!.getAttribute('href')).toBe('#top');
    expect(file!.hasAttribute('href')).toBe(false);
    expect(sanitizeMailHtml(html, { safeLinks: false }).html).toContain('href="https://www.paypal.com.bad.example/login"');
  });

  it('take the server’s word only when it is worse, and fall back to this computer’s check', async () => {
    const ask = vi.fn(async () => ({ verdict: 'blocked' as const, reasons: ['blocked_domain'] }));
    expect(await judgeLink({ url: 'https://evil.test/x', text: 'Click' }, true, ask)).toMatchObject({ verdict: 'blocked', reasons: ['blocked_domain'] });
    expect(await judgeLink({ url: 'https://evil.test/x', text: 'Click' }, false, ask)).toMatchObject({ verdict: 'ok' });
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await judgeLink({ url: 'https://bit.ly/x', text: '' }, true, failing)).toMatchObject({ verdict: 'caution', reasons: ['shortener'] });
    expect(reasonWords('text_mismatch', { host: 'login.bad.example', text: 'www.paypal.com' })).toBe('The link says paypal.com, but it goes to login.bad.example.');
  });

  it('open a clean link straight away, stop on a suspicious one with the real address, and write mail for mailto:', async () => {
    vi.mocked(apiPost).mockImplementation((async (path: string, body: { url: string }) => (path === '/api/mail/links/check' ? { verdict: body.url.includes('evil') ? 'blocked' : 'ok', reasons: body.url.includes('evil') ? ['blocked_domain'] : [] } : {})) as never);
    wrap(<MailLinkGuard />);
    const fire = (url: string, text = '') => act(() => bridge.listeners.get('mail:link')!({ url, text }));
    fire('https://www.livezen.lk/news', 'livezen.lk/news');
    await waitFor(() => expect(call).toHaveBeenCalledWith('mail:openLink', { url: 'https://www.livezen.lk/news', confirmed: true }));

    fire('https://login.bad.example/x', 'www.paypal.com');
    const dialog = await screen.findByRole('dialog', { name: 'Check this link before you open it' });
    expect(within(dialog).getByText('The link says paypal.com, but it goes to login.bad.example.')).toBeTruthy();
    expect(within(dialog).getByText('https://login.bad.example/x')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Go back' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(call).not.toHaveBeenCalledWith('mail:openLink', expect.objectContaining({ url: 'https://login.bad.example/x' }));

    fire('https://evil.test/', 'Invoice');
    const blocked = await screen.findByRole('dialog', { name: 'This link is blocked' });
    expect(within(blocked).queryByRole('button', { name: 'Open anyway' })).toBeNull();
    fireEvent.click(within(blocked).getByRole('button', { name: 'Go back' }));

    fire('http://intranet.livezen.lk/', 'Intranet');
    const caution = await screen.findByRole('dialog');
    fireEvent.click(within(caution).getByRole('button', { name: 'Open anyway' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('mail:openLink', { url: 'http://intranet.livezen.lk/', confirmed: true }));

    fire('mailto:asha@livezen.lk?subject=Hi');
    expect(nav.navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/mail\?compose=1.*to=asha%40livezen\.lk/));
  });
});

describe('report phishing (DMO-SEC-02, AC-DMO-13)', () => {
  it('reports to mail protection: held in the reporter’s quarantine, links blocked, the sender on their block list (ENH-MAIL-04)', async () => {
    vi.mocked(apiPost).mockResolvedValue({} as never);
    const done = vi.fn();
    wrap(<ReportDialog kind="phishing" msgRef={REF} from="It@Bad.example" subject="Password expires" canBlock onDone={done} onClose={() => undefined} />);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Report phishing' })).getByRole('button', { name: 'Report phishing' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith('/api/mail/messages/7/report-phish', { folder: 'inbox', mailbox: '4' });
    expect(apiPost).toHaveBeenCalledWith('/api/mail/protection/lists/me', { kind: 'block', value: 'it@bad.example' });
    expect(apiPost).not.toHaveBeenCalledWith('/api/mail/messages/7/report', expect.anything());
    expect(vi.mocked(toast).mock.calls[0]![1]).toBe('Reported — it is held in your quarantine, and its links are blocked for everyone in your organisation. It@Bad.example is blocked.');
  });

  it('on a server without mail protection, reports, says where the message went and that the security team has it, and blocks the sender when chosen', async () => {
    vi.mocked(apiPost).mockImplementation((async (path: string) => {
      if (path.endsWith('/report-phish')) throw new ApiError(404, 'Not found', null);
      return path.endsWith('/report') ? { moved_to: 'junk', forwarded_to: 'security@livezen.lk', security_mailbox: true } : {};
    }) as never);
    const done = vi.fn();
    wrap(<ReportDialog kind="phishing" msgRef={REF} from="it@bad.example" subject="Password expires" canBlock onDone={done} onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'Report phishing' });
    expect(within(dialog).getByRole('checkbox', { name: 'Also block it@bad.example' })).toHaveProperty('checked', true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Report phishing' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith('/api/mail/messages/7/report', { folder: 'inbox', kind: 'phishing', block: true, mailbox: '4' });
    expect(apiPost).toHaveBeenCalledWith('/api/mail/rules/sender', { email: 'it@bad.example', action: 'block', mailbox: '4' });
    expect(vi.mocked(toast).mock.calls[0]![1]).toBe('Reported — moved to Junk. Your security team has a copy. it@bad.example is blocked.');
  });

  it('as junk, does not block unless asked and never claims a forward', async () => {
    vi.mocked(apiPost).mockResolvedValue({ moved_to: 'junk', forwarded_to: null, security_mailbox: false } as never);
    wrap(<ReportDialog kind="junk" msgRef={REF} from="deals@shop.example" subject="Deals" canBlock onDone={() => undefined} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Report junk' }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast).mock.calls[0]![1]).toBe('Reported — moved to Junk.');
  });
});

describe('recall (DMO-CMP-10, AC-DMO-08)', () => {
  it('says first that only colleagues’ unread copies can be recalled, then reports each recipient', async () => {
    vi.mocked(apiGet).mockResolvedValue({ recallable: true, reason: null, days: 7, recipients: [{ address: 'omar@livezen.lk', recallable: true, reason: null }, { address: 'pat@client.example', recallable: false, reason: 'external' }], recalls: [] } as never);
    vi.mocked(apiPost).mockResolvedValue({ id: 1, mode: 'delete', created_at: '', counts: {}, results: [{ recipient: 'omar@livezen.lk', state: 'deleted', detail: null }, { recipient: 'nimal@livezen.lk', state: 'read', detail: null }, { recipient: 'pat@client.example', state: 'external', detail: null }] } as never);
    wrap(<RecallDialog messageId="<ws-1@livezen.lk>" onReplace={() => undefined} onClose={() => undefined} />);
    const dialog = await screen.findByRole('dialog', { name: 'Recall this message' });
    expect(within(dialog).getByRole('note').textContent).toContain('Recall only works for colleagues with a WorkSuite mailbox in your organisation');
    await within(dialog).findByText('Outside your organisation');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete unread copies' }));
    await within(dialog).findByText('Already read — left where it is');
    expect(apiPost).toHaveBeenCalledWith('/api/mail/recalls', { message_id: '<ws-1@livezen.lk>', mode: 'delete' });
    expect(within(dialog).getByText('Removed before it was read')).toBeTruthy();
    expect(within(dialog).getByText('Outside your organisation — not recalled')).toBeTruthy();
    expect(recallStateWords('unreachable')).toBe('Could not be reached');
  });

  it('offers nothing to do for a message not sent from WorkSuite or too old', async () => {
    vi.mocked(apiGet).mockResolvedValue({ recallable: false, reason: 'too_old', days: 7, recipients: [], recalls: [] } as never);
    wrap(<RecallDialog messageId="<x@y>" onReplace={() => undefined} onClose={() => undefined} />);
    expect(await screen.findByText('It is older than 7 days, your organisation’s recall window.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete unread copies' })).toHaveProperty('disabled', true);
  });
});

describe('voting buttons (DMO-CMP-12)', () => {
  it('compose sends the choices and a line anybody can answer by reply', () => {
    expect(voteChoices(['Ship it', 'ship it', 'Wait', ''])).toEqual(['Ship it', 'Wait']);
    expect(voteChoices(['Only'])).toEqual([]);
    const out = withVotePrompt(composeBody('<div>Please decide.</div>', ''), ['Approve', 'Reject'], 'Vote by replying with one of: Approve, Reject.');
    expect(out.html).toContain('<p style="color:#555">Vote by replying with one of: Approve, Reject.</p>');
    expect(out.text.endsWith('Vote by replying with one of: Approve, Reject.')).toBe(true);
  });

  it('a recipient on this server votes with a button; otherwise the choice becomes a reply', async () => {
    vi.mocked(apiGet).mockResolvedValue({ choices: ['Approve', 'Reject'], counted: true, mine: null } as never);
    const reply = vi.fn();
    wrap(<VoteBar msgRef={REF} choices={['Approve', 'Reject']} subject="Budget" onReply={reply} />);
    const bar = screen.getByRole('group', { name: 'Voting buttons' });
    await within(bar).findByText('Counted for the sender in WorkSuite.');
    fireEvent.click(within(bar).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/messages/7/vote', { folder: 'inbox', choice: 'Approve', mailbox: '4' }));
    expect(reply).not.toHaveBeenCalled();

    cleanup();
    vi.mocked(apiGet).mockResolvedValue({ choices: ['Yes', 'No'], counted: false, mine: null } as never);
    wrap(<VoteBar msgRef={REF} choices={['Yes', 'No']} subject="Lunch" onReply={reply} />);
    expect(await screen.findByText('The sender is not on this WorkSuite server — your choice goes back as a reply about “Lunch”.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(reply).toHaveBeenCalledWith('Yes');
  });

  it('a 409 from the server also turns the vote into a reply', async () => {
    vi.mocked(apiGet).mockResolvedValue({ choices: ['A', 'B'], counted: true, mine: null } as never);
    vi.mocked(apiPost).mockRejectedValue(new ApiError(409, '/x', null));
    const reply = vi.fn();
    wrap(<VoteBar msgRef={REF} choices={['A', 'B']} subject="S" onReply={reply} />);
    await screen.findByText('Counted for the sender in WorkSuite.');
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    await waitFor(() => expect(reply).toHaveBeenCalledWith('B'));
  });

  it('the sender sees the tally on the sent item', async () => {
    vi.mocked(apiGet).mockResolvedValue({ options: ['Approve', 'Reject'], counts: { Approve: 2, Reject: 1 }, responses: [], waiting: ['pat@client.example'] } as never);
    wrap(<VoteTally messageId="<ws-2@livezen.lk>" />);
    const s = await screen.findByRole('status', { name: 'Voting results' });
    expect(s.textContent).toContain('Approve 2');
    expect(s.textContent).toContain('1 not voted yet');
    expect(s.textContent).toContain('arrive as replies');
  });
});

describe('importing a data file (DMO-DAT-01/02)', () => {
  it('only sends the folders the plan puts somewhere, and says how far it got', () => {
    const folders = [{ id: 1, path: 'Inbox', count: 5, mail: true }, { id: 2, path: 'Calendar', count: 3, mail: false }, { id: 3, path: 'Junk', count: 9, mail: true }];
    expect(planEntries(folders, [
      { source: 'Inbox', destination: 'INBOX', skip_reason: null, label: 'Inbox' },
      { source: 'Calendar', destination: null, skip_reason: 'Not a mail folder', label: 'Calendar' },
      { source: 'Junk', destination: null, skip_reason: 'Junk and spam are not copied.', label: 'Junk' },
    ])).toEqual([{ folder: 1, source: 'Inbox', destination: 'INBOX' }]);
    const p: ImportProgress = { handle: 'h', importId: 1, state: 'running', folder: 'Inbox', done: 10, total: 40, copied: 8, skipped: 2, failed: 0, error: null, unreadable: [] };
    expect(progressWords(p)).toBe('10 of 40 read · 8 copied');
    expect(progressWords({ ...p, state: 'paused', error: 'Offline' })).toBe('Paused after 10 of 40: Offline');
    expect(progressWords({ ...p, state: 'done' })).toBe('Done: 8 copied, 2 already there or left out, 0 could not be copied.');
    expect(folderLabel('Imported/old.pst/Clients')).toBe('Imported › old.pst › Clients');
    expect(folderLabel('INBOX')).toBe('Inbox');
    expect(folderLabel('Imported/&AMk-t&AOk-')).toBe('Imported › Été');
  });

  it('picks a file, shows where each folder goes, starts the import and follows its progress', async () => {
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path === '/api/mail/imports/datafile/policy') return { import: true, export: false, max_mb: 0 };
      if (path === '/api/mail/mailboxes') return { mailboxes: [{ id: 4, email: 'asha@livezen.lk', shared: false, is_default: true, unread: 0, display_name: null }] };
      if (path === '/api/mail/imports/datafile') return { imports: [] };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(call).mockImplementation((async (channel: string) => {
      if (channel === 'mailfile:pick') return { id: 'h1', name: 'old.pst', kind: 'pst', size: 1_048_576, folder: false };
      if (channel === 'mailfile:scan') return { folders: [{ id: 1, path: 'Inbox', count: 5, mail: true }, { id: 2, path: 'Calendar', count: 3, mail: false }], unreadable: ['Search Folders'] };
      if (channel === 'mailfile:import') return { handle: 'h1', importId: 9, state: 'running', folder: 'Inbox', done: 0, total: 5, copied: 0, skipped: 0, failed: 0, error: null, unreadable: [] };
      return null;
    }) as never);
    vi.mocked(apiPost).mockImplementation((async (path: string) => {
      if (path === '/api/mail/imports/datafile/plan') return { folders: [{ source: 'Inbox', destination: 'Imported/old.pst', destination_label: 'Imported › old.pst', skip_reason: null, label: 'Inbox' }, { source: 'Calendar', destination: null, skip_reason: 'Not a mail folder worth copying (Calendar).', label: 'Calendar' }] };
      if (path === '/api/mail/imports/datafile') return { id: 9 };
      return {};
    }) as never);
    wrap(<DataFileImport />);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a .pst or .mbox file…' }));
    expect(await screen.findByText('These parts of the file could not be read and are left out: Search Folders')).toBeTruthy();
    expect(screen.getByText(/5 messages in 1 folders/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See where each folder goes' }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Imported › old.pst')).toBeTruthy();
    expect(within(table).getByText('Left out — Not a mail folder worth copying (Calendar).')).toBeTruthy();
    expect(apiPost).toHaveBeenCalledWith('/api/mail/imports/datafile/plan', expect.objectContaining({ connection_id: 4, own_folder: true, folders: [{ path: 'Inbox', count: 5, mail: true }, { path: 'Calendar', count: 3, mail: false }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('mailfile:import', { handle: 'h1', importId: 9, plan: [{ folder: 1, source: 'Inbox', destination: 'Imported/old.pst' }] }));
    act(() => bridge.listeners.get('mailfile:changed')!({ handle: 'h1', importId: 9, state: 'paused', folder: 'Inbox', done: 2, total: 5, copied: 2, skipped: 0, failed: 0, error: 'Offline', unreadable: [] }));
    expect(screen.getByText('Paused after 2 of 5: Offline')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(vi.mocked(call).mock.calls.filter(([c]) => c === 'mailfile:import')).toHaveLength(2));
  });

  it('says so when the organisation does not allow it', async () => {
    vi.mocked(apiGet).mockImplementation((async (path: string) => (path.endsWith('/policy') ? { import: false, export: false, max_mb: 0 } : { mailboxes: [] })) as never);
    wrap(<DataFileImport />);
    expect(await screen.findByText(/does not allow importing/)).toBeTruthy();
  });
});

describe('export (DMO-DAT-03)', () => {
  it('is refused in words when the organisation does not allow it, and exports otherwise', async () => {
    vi.mocked(apiGet).mockResolvedValue({ import: true, export: false, max_mb: 0 } as never);
    wrap(<ExportDialog mailbox="4" folder="inbox" folderName="Inbox" onClose={() => undefined} />);
    expect(await screen.findByText(/does not allow exporting mail/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export…' })).toHaveProperty('disabled', true);
    cleanup();

    vi.mocked(apiGet).mockResolvedValue({ import: true, export: true, max_mb: 0 } as never);
    vi.mocked(call).mockResolvedValue({ count: 12, failed: 0, cancelled: false, name: 'Inbox.zip' } as never);
    const close = vi.fn();
    wrap(<ExportDialog mailbox="4" folder="inbox" folderName="Inbox" onClose={close} />);
    fireEvent.click(await screen.findByRole('radio', { name: /zip of \.eml/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(call).toHaveBeenCalledWith('mail:export', { mailbox: '4', folder: 'inbox', folderName: 'Inbox', format: 'eml' });
    expect(vi.mocked(toast).mock.calls[0]![1]).toBe('12 messages exported to Inbox.zip.');
  });
});

describe('a message file opened to read (DMO-DAT-04)', () => {
  it('replies from the default account, quoted and threaded', () => {
    const v: MailFileView = { subject: 'Plan', from: { name: 'Pat', email: 'pat@client.example' }, to: [{ name: 'Asha', email: 'asha@livezen.lk' }], cc: [{ name: '', email: 'omar@livezen.lk' }], date: '2026-10-05T04:30:00.000Z', html: '', text: 'Hello', messageId: '<m1@client.example>', attachments: [] };
    const reply = new URLSearchParams(fileReplyRoute(v, 'reply_all', 'asha@livezen.lk', 'Hello').split('?')[1]);
    expect(reply.get('mode')).toBe('reply_all');
    expect(reply.get('to')).toBe('pat@client.example, omar@livezen.lk');
    expect(reply.get('subject')).toBe('Re: Plan');
    expect(reply.get('irt')).toBe('<m1@client.example>');
    expect(reply.get('quote')).toContain('> Hello');
    const fwd = new URLSearchParams(fileReplyRoute(v, 'forward', null, 'Hello').split('?')[1]);
    expect([fwd.get('subject'), fwd.get('to')]).toEqual(['Fwd: Plan', null]);
  });
});

describe('S/MIME in the reader (DMO-SEC-05)', () => {
  it('says verified only on the main process’s word, keeps the signer’s certificate, and names any failure', async () => {
    vi.mocked(call).mockResolvedValue({ state: 'verified', signer: { name: 'Asha', email: 'asha@livezen.lk', issuer: 'CA', notAfter: null, fingerprint: 'f' }, detail: 'Signed by Asha', certificate: 'MIIB' } as never);
    wrap(<SmimeChip msgRef={REF} from="asha@livezen.lk" mailbox="4" />);
    expect(await screen.findByText('Signed · verified')).toBeTruthy();
    expect(call).toHaveBeenCalledWith('smime:verify', { uid: '7', folder: 'inbox', mailbox: '4' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/certificates', { address: 'asha@livezen.lk', certificate: 'MIIB', source: 'collected', mailbox: '4' }));
    cleanup();
    vi.mocked(apiPost).mockClear();
    vi.mocked(call).mockResolvedValue({ state: 'untrusted', signer: null, detail: 'not trusted', certificate: 'MIIB' } as never);
    wrap(<SmimeChip msgRef={REF} from="asha@livezen.lk" mailbox="4" />);
    expect(await screen.findByText('Signed · not trusted')).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
    cleanup();
    vi.mocked(call).mockRejectedValue(new Error('no source'));
    wrap(<SmimeChip msgRef={REF} from="asha@livezen.lk" mailbox="4" />);
    expect(await screen.findByText('Signed · not checked')).toBeTruthy();
  });

  it('shows the sender’s importance and sensitivity', () => {
    wrap(<MarkerChips markers={{ vote: [], read_receipt_to: null, smime: null, sensitivity: 'confidential', importance: 'high' }} />);
    expect(screen.getByText('High importance')).toBeTruthy();
    expect(screen.getByText('Confidential')).toBeTruthy();
  });
});

describe('read receipts (DMO-CMP-11)', () => {
  it('asks, and sends a short receipt only when the person says so', async () => {
    const answered = vi.fn();
    wrap(<ReceiptBar to="pat@client.example" subject="Plan" mailbox="4" onAnswered={answered} />);
    expect(screen.getByText('pat@client.example asked to be told when you read this.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send receipt' }));
    await waitFor(() => expect(answered).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith('/api/mail/send', expect.objectContaining({ to: ['pat@client.example'], subject: 'Read: Plan', track: false, mailbox: 4 }));
    cleanup();
    vi.mocked(apiPost).mockClear();
    wrap(<ReceiptBar to="pat@client.example" subject="Plan" mailbox="4" onAnswered={answered} />);
    fireEvent.click(screen.getByRole('button', { name: 'Don’t send' }));
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe('pictures on request, through WorkSuite (DMO-SEC-07, DMO-RD-02)', () => {
  it('holds remote pictures back and shows them only through the signed proxy links', () => {
    const clean = sanitizeMailHtml('<p>Hi</p><img src="https://t.example/p.gif" alt="logo"><img src="http://x.example/a.png"><img src="data:image/png;base64,AAAA">');
    expect(clean.blockedImages).toBe(2);
    expect(clean.html).not.toContain(' src="https://t.example');
    expect(clean.html).not.toContain('t.example');
    expect(blockedImageUrls(clean)).toEqual(['https://t.example/p.gif', 'http://x.example/a.png']);
    const shown = withProxiedImages(clean.html, clean.remoteImages, { 'https://t.example/p.gif': '/mail-image?t=abc&s=def', 'http://x.example/a.png': 'https://elsewhere.example/x' }, 'https://ws.example');
    expect(shown).toContain('src="https://ws.example/mail-image?t=abc&amp;s=def"');
    expect(shown).not.toContain('elsewhere.example');
    // A sender's own marker on a picture that already shows is dropped.
    expect(sanitizeMailHtml('<img src="data:image/png;base64,AA" data-ws-img="0">').html).not.toContain('data-ws-img');
  });
});
