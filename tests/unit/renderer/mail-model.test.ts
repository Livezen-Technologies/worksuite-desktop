// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setRegional } from '../../../src/core/time';
import { CHIPS, SMART_VIEWS, accountTone, agoShort, applyFilters, dateBand, filtersFor, folderName, groupRows, mailboxBadge, mailboxLetter, plainText, queueKey, queuedByMessage, securityVerdict, smartView, sortRows, step, stripPrefix } from '../../../src/modules/mail/model';
import { afterClose, withTab, MAX_TABS, type OpenTab } from '../../../src/modules/mail/ReadingPane';
import { matches, parseQuery, serverTerm } from '../../../src/modules/mail/SearchView';
import { laterChoices, draftContext } from '../../../src/modules/mail/Compose';
import { sendAfterUndoWindow, undoSend } from '../../../src/modules/mail/outgoing';
import { joinQuote, splitQuote, unquote } from '../../../src/modules/mail/MailPage';
import { mailFrameDoc, sanitizeMailHtml } from '../../../src/modules/mail/sanitize';
import type { MessageRow } from '../../../src/modules/mail/types';
import type { OfflineMutation } from '../../../shared/types';

/**
 * Mail's list logic (the WorkSuite Mail design): smart views and quick filters,
 * sorting and date bands, account tags, the security chip, the offline queue's
 * rows, the reading pane's tabs, search operators, send later and undo send.
 */

const row = (id: number, over: Partial<MessageRow> = {}): MessageRow => ({
  id,
  from_name: `Sender ${id}`,
  from_email: `s${id}@example.org`,
  subject: `Subject ${id}`,
  preview: '',
  is_read: true,
  is_starred: false,
  has_attachment: false,
  created_at: '2026-10-02 08:00:00',
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('smart views and quick filters', () => {
  it('maps each smart view to what the server is asked, and merges the chips once', () => {
    expect(SMART_VIEWS.map((v) => v.id)).toEqual(['unread', 'starred', 'important', 'today', 'attachments', 'scheduled', 'drafts', 'vip']);
    expect(smartView('unread')).toMatchObject({ folder: 'inbox', filters: ['unread'] });
    expect(smartView('drafts')).toMatchObject({ folder: 'drafts', filters: [] });
    expect(smartView('nope')).toBeNull();
    expect(CHIPS.map((c) => c.label)).toEqual(['Unread', 'Has files', 'Starred', 'Last 7 days']);
    expect(filtersFor(smartView('unread'), ['unread', 'attachments'])).toEqual(['unread', 'attachments']);
  });

  it('applies the filters again to what came back', () => {
    const now = Date.parse('2026-10-02T10:00:00Z');
    const rows = [row(1, { is_read: false }), row(2, { is_starred: true }), row(3, { has_attachment: true, created_at: '2026-09-01 08:00:00' })];
    expect(applyFilters(rows, ['unread'], now).map((r) => r.id)).toEqual([1]);
    expect(applyFilters(rows, ['starred'], now).map((r) => r.id)).toEqual([2]);
    expect(applyFilters(rows, ['attachments'], now).map((r) => r.id)).toEqual([3]);
    expect(applyFilters(rows, ['week'], now).map((r) => r.id)).toEqual([1, 2]);
  });
});

describe('sorting and grouping', () => {
  it('sorts newest first by default, by sender ignoring case, and strips Re:', () => {
    const rows = [row(1, { created_at: '2026-10-01 08:00:00', from_name: 'bea' }), row(2, { created_at: '2026-10-02 08:00:00', from_name: 'Ann' })];
    expect(sortRows(rows).map((r) => r.id)).toEqual([2, 1]);
    expect(sortRows(rows, 'date', 'asc').map((r) => r.id)).toEqual([1, 2]);
    expect(sortRows(rows, 'sender', 'asc').map((r) => r.id)).toEqual([2, 1]);
    expect(stripPrefix('Re: Fwd: Hello')).toBe('Hello');
  });

  it('bands by date — Today, Yesterday, Earlier this week, Last week, then months — on the reader’s calendar', () => {
    setRegional({ timezone: 'Asia/Colombo', locale: 'en-GB', timeFormat: '24' });
    const today = '2026-10-02';
    expect(dateBand('2026-10-02 05:00:00', today).key).toBe('today');
    expect(dateBand('2026-10-01 05:00:00', today).key).toBe('yesterday');
    expect(dateBand('2026-09-28 05:00:00', today).label).toBe('Earlier this week');
    expect(dateBand('2026-09-22 05:00:00', today).label).toBe('Last week');
    expect(dateBand('2026-08-02 05:00:00', today).key).toBe('m:2026-08');
    const groups = groupRows([row(1, { created_at: '2026-10-02 05:00:00' }), row(2, { created_at: '2026-10-02 04:00:00' }), row(3, { created_at: '2026-10-01 05:00:00' })], 'date', today);
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
    ]);
    expect(groupRows([row(1)], 'none')).toEqual([{ key: 'all', label: '', rows: [row(1)] }]);
    expect(groupRows([row(1, { from_email: 'a@x' }), row(2, { from_email: 'A@x' })], 'sender')).toHaveLength(1);
  });

  it('names nested folders with a chevron', () => {
    expect(folderName('Clients/CreativeFX')).toBe('Clients › CreativeFX');
    expect(folderName('INBOX/Tenders')).toBe('Tenders');
  });
});

describe('accounts', () => {
  it('tags each account the way the combined list shows it', () => {
    expect(mailboxBadge({ email: 'sales@example.lk', shared: true })).toBe('SALES');
    expect(mailboxBadge({ email: 'me@gmail.com' })).toBe('GMAIL');
    expect(mailboxBadge({ email: 'me@example.lk', provider: 'google' })).toBe('GMAIL');
    expect(mailboxBadge({ email: 'me@example.lk', account_type: 'local_mailbox' })).toBe('WS');
    expect(mailboxBadge({ email: 'me@livezen.lk' })).toBe('LI');
    expect(mailboxLetter({ email: 'me@x.lk', account_type: 'local_mailbox' })).toBe('W');
    expect(mailboxLetter({ email: 'me@x.lk', provider: 'gmail' })).toBe('G');
    expect(mailboxLetter({ email: 'hm@x.lk' })).toBe('H');
    expect(accountTone('orange')).toBe('amber');
    expect(accountTone(null)).toBe('slate');
  });

  it('says Verified only when every recorded check passed', () => {
    expect(securityVerdict({ available: true, spf: 'pass', dkim: 'pass', dmarc: 'pass' })).toMatchObject({ tone: 'success', label: 'Verified · SPF, DKIM, DMARC' });
    expect(securityVerdict({ available: true, spf: 'pass', dkim: 'fail', dmarc: 'pass' })).toMatchObject({ tone: 'warning', label: 'Not verified · DKIM failed' });
    expect(securityVerdict({ available: true, spf: 'unknown', dkim: 'unknown', dmarc: 'unknown' })).toBeNull();
    expect(securityVerdict({ available: false, reason: 'no headers' })).toBeNull();
  });

  it('says how long ago, short', () => {
    expect(agoShort(12)).toBe('12 s ago');
    expect(agoShort(300)).toBe('5 min ago');
    expect(agoShort(null)).toBeNull();
  });
});

describe('the offline queue on the list', () => {
  it('finds each message’s waiting action by mailbox, folder and uid', () => {
    const m = (over: Partial<OfflineMutation>): OfflineMutation => ({ id: 'x', idempotencyKey: 'k', module: 'mail', entity: 'message.archive', entityId: queueKey('1', 'inbox', 7), label: 'Archive', method: 'POST', path: '/api/mail/messages/7/action', state: 'PENDING', attempts: 0, error: null, createdAt: '', ...over });
    const map = queuedByMessage([m({}), m({ entity: 'message.star', entityId: queueKey('2', 'inbox', 9) }), m({ module: 'tasks', entityId: 'z' }), m({ entityId: queueKey('3', 'inbox', 1), state: 'DONE' })]);
    expect(map.get('1:inbox:7')).toBe('archive');
    expect(map.get('2:inbox:9')).toBe('star');
    expect(map.size).toBe(2);
  });

  it('steps through the list and stays on its ends', () => {
    expect(step([1, 2, 3], -1, 1)).toBe(0);
    expect(step([1, 2, 3], 2, 1)).toBe(2);
    expect(step([1, 2, 3], 0, -1)).toBe(0);
    expect(step([], 0, 1)).toBe(-1);
  });
});

describe('the reading pane’s tabs', () => {
  const tab = (n: number): OpenTab => ({ key: `1:inbox:${n}`, ref: { uid: String(n), folder: 'inbox', mailbox: '1' }, subject: `S${n}`, from: 'A' });
  it('keeps an open message where it is, adds a new one at the end, and stays within the limit', () => {
    let tabs = [tab(1), tab(2)];
    tabs = withTab(tabs, tab(1), '1:inbox:1');
    expect(tabs.map((t) => t.key)).toEqual(['1:inbox:1', '1:inbox:2']);
    for (let i = 3; i < 3 + MAX_TABS; i++) tabs = withTab(tabs, tab(i), tab(i).key);
    expect(tabs).toHaveLength(MAX_TABS);
    expect(tabs.at(-1)!.key).toBe(`1:inbox:${2 + MAX_TABS}`);
  });
  it('shows the right-hand neighbour after closing the active tab', () => {
    const tabs = [tab(1), tab(2), tab(3)];
    expect(afterClose(tabs, '1:inbox:2', '1:inbox:2')).toEqual({ tabs: [tab(1), tab(3)], active: '1:inbox:3' });
    expect(afterClose(tabs, '1:inbox:3', '1:inbox:3').active).toBe('1:inbox:2');
    expect(afterClose(tabs, '1:inbox:1', '1:inbox:3').active).toBe('1:inbox:3');
  });
});

describe('search', () => {
  it('reads operators and asks the server for the words', () => {
    const p = parseQuery('BOQ from:sfcl.lk has:attachment is:unread before:2026-09-01');
    expect(p).toMatchObject({ words: 'BOQ', from: 'sfcl.lk', attachment: true, unread: true, before: '2026-09-01' });
    expect(serverTerm(p)).toBe('BOQ');
    expect(serverTerm(parseQuery('from:ann@x.org'))).toBe('ann@x.org');
    expect(matches(row(1, { from_email: 'nimal@sfcl.lk', has_attachment: true, is_read: false, created_at: '2026-08-01 10:00:00' }), p)).toBe(true);
    expect(matches(row(1, { from_email: 'nimal@other.lk', has_attachment: true, is_read: false }), p)).toBe(false);
  });
});

describe('writing', () => {
  it('offers tomorrow at 8 and Monday at 8 on the reader’s clock', () => {
    setRegional({ timezone: 'Asia/Colombo', locale: 'en-GB', timeFormat: '24' });
    const [tomorrow, monday] = laterChoices('2026-10-02');
    expect(tomorrow!.at).toBe('2026-10-03T02:30:00.000Z');
    expect(monday!.at).toBe('2026-10-05T02:30:00.000Z');
    expect(draftContext({ mode: 'reply', inReplyTo: '<a@b>' })).toBe('compose:reply:<a@b>');
  });

  it('sends after the undo window, and Undo takes it back', () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    const undo = vi.fn();
    const a = sendAfterUndoWindow('A', send, undo, 8);
    vi.advanceTimersByTime(7_900);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(undoSend(a)).toBe(false);
    const b = sendAfterUndoWindow('B', send, undo, 8);
    expect(undoSend(b)).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('keeps the quote helpers the AI tools rely on', () => {
    const quote = '\n\nOn 1 Oct Ann wrote:\n> Hi\n> there';
    expect(splitQuote(`Thanks${quote}`, quote)).toEqual(['Thanks', quote]);
    expect(joinQuote('New ', quote)).toBe(`New${quote}`);
    expect(unquote(quote)).toBe('On 1 Oct Ann wrote:\nHi\nthere');
  });

  it('keeps line breaks when an email or a signature becomes text', () => {
    expect(plainText('<p>Ann Example<br>Example Ltd</p><p>Next</p>')).toBe('Ann Example\nExample Ltd\nNext');
  });
});

describe('mail HTML stays sanitized', () => {
  it('drops scripts and handlers, blocks remote images, and frames the body at the reader’s zoom', () => {
    const r = sanitizeMailHtml('<p onclick="x()">Hi</p><script>alert(1)</script><img src="https://t.example/p.gif"><a href="javascript:x()">x</a>');
    expect(r.html).not.toContain('script');
    expect(r.html).not.toContain('onclick');
    expect(r.html).not.toContain('https://t.example');
    expect(r.html).not.toContain('javascript:');
    expect(r.blockedImages).toBe(1);
    expect(mailFrameDoc(r.html, 120)).toContain('zoom:120%');
    expect(mailFrameDoc(r.html, 9999)).toContain('zoom:300%');
    expect(mailFrameDoc(r.html)).toContain('zoom:100%');
  });
});
