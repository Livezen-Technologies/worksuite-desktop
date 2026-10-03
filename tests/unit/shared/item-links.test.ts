import { describe, expect, it } from 'vitest';
import { findDeepLinkInArgv, parseDeepLink } from '@shared/deeplink';
import {
  cardActions,
  isDataChanging,
  isVerifiedWorkSuiteMail,
  itemApp,
  itemAppLink,
  itemRoute,
  itemWebLink,
  looksLikeItemLink,
  parseItemHeader,
  parseItemLink,
  workSuiteWebPath,
  type ItemLink,
} from '@shared/item-links';
import { DEFAULT_LINK_PREFS, linkPrefs } from '@shared/link-prefs';

const ok = (raw: string, hosts: string[] = []): ItemLink => {
  const r = parseItemLink(raw, { hosts });
  if (!r.ok) throw new Error(`${raw} was refused: ${r.reason}`);
  return r.link;
};
const reason = (raw: string, hosts: string[] = []) => {
  const r = parseItemLink(raw, { hosts });
  return r.ok ? 'accepted' : r.reason;
};

describe('item links (#170): parsing', () => {
  it('accepts the web and the app form of the same link alike', () => {
    const web = ok('https://app.worksuite.lk/o/7/file/128?action=download');
    const app = ok('worksuite://7/file/128?action=download');
    expect(web).toMatchObject({ org: '7', type: 'file', id: '128', action: 'download', explicitAction: true, format: 'web' });
    expect(app).toMatchObject({ org: '7', type: 'file', id: '128', action: 'download', explicitAction: true, format: 'app' });
    expect(ok('worksuite:///7/task/9').type).toBe('task');
    expect(ok('https://app.worksuite.lk/o/7/task/9/').id).toBe('9');
  });

  it('opens when the link names no action', () => {
    expect(ok('worksuite://7/note/5')).toMatchObject({ action: 'open', explicitAction: false });
    expect(ok('worksuite://7/meeting/0f8fad5b-d9cb-469f-a165-70867728950e')).toMatchObject({ action: 'join', explicitAction: false });
  });

  it('accepts the signed-in server’s own host, and no other', () => {
    expect(ok('https://work.example.lk/o/3/task/1', ['work.example.lk']).org).toBe('3');
    expect(reason('https://work.example.lk/o/3/task/1')).toBe('unknown_host');
    expect(reason('https://app.worksuite.lk.evil.com/o/3/task/1')).toBe('unknown_host');
    expect(reason('https://evil.com/o/3/task/1')).toBe('unknown_host');
  });

  it('refuses plain http, other schemes, credentials and ports', () => {
    expect(reason('http://app.worksuite.lk/o/7/file/1')).toBe('insecure');
    expect(reason('ftp://app.worksuite.lk/o/7/file/1')).toBe('bad_scheme');
    expect(reason('javascript://7/file/1')).toBe('bad_scheme');
    expect(reason('https://user:pw@app.worksuite.lk/o/7/file/1')).toBe('forbidden_characters');
    expect(reason('https://app.worksuite.lk:8443/o/7/file/1')).toBe('forbidden_characters');
  });

  it('refuses unknown organisations, types, ids, actions and parameters', () => {
    expect(reason('worksuite://acme/file/1')).toBe('unknown_org');
    expect(reason('worksuite://0/file/1')).toBe('unknown_org');
    expect(reason('worksuite://7/payroll/1')).toBe('unknown_type');
    expect(reason('worksuite://7/constructor/1')).toBe('unknown_type');
    expect(reason('worksuite://7/file/abc')).toBe('bad_id');
    expect(reason('worksuite://7/alert/billing')).toBe('bad_id');
    expect(reason('worksuite://7/file/1?action=delete')).toBe('unknown_action');
    expect(reason('worksuite://7/note/1?action=done')).toBe('unknown_action');
    expect(reason('worksuite://7/file/1?token=abc')).toBe('unknown_parameter');
    expect(reason('worksuite://7/file/1?action=open&action=download')).toBe('unknown_parameter');
    expect(reason('worksuite://7/chat/1?message=x')).toBe('unknown_parameter');
    expect(reason('worksuite://7/file/1?src=browser')).toBe('unknown_parameter');
  });

  it('refuses traversal, encodings, fragments and over-long input', () => {
    expect(reason('worksuite://7/file/../../etc')).toBe('malformed');
    expect(reason('worksuite://7/file/%2e%2e')).toBe('forbidden_characters');
    expect(reason('https://app.worksuite.lk/o/7/file/1#x')).toBe('malformed');
    expect(reason('https://app.worksuite.lk/x/7/file/1')).toBe('malformed');
    expect(reason('worksuite://7/file')).toBe('malformed');
    expect(reason(`worksuite://7/file/1?comment=${'1'.repeat(2000)}`)).toBe('too_long');
  });

  it('tells item links from the older worksuite:// grammar, which still parses as before', () => {
    expect(looksLikeItemLink('worksuite://7/file/1')).toBe(true);
    expect(looksLikeItemLink('https://app.worksuite.lk/o/7/file/1')).toBe(true);
    expect(looksLikeItemLink('worksuite://crm/leads/128')).toBe(false);
    expect(parseDeepLink('worksuite://crm/leads/128').ok).toBe(true);
    expect(findDeepLinkInArgv(['/app', 'worksuite://7/task/3'])).toBe('worksuite://7/task/3');
  });
});

describe('item links (#170): where each type opens', () => {
  const route = (raw: string) => itemRoute(ok(raw));
  it('routes every type to its module', () => {
    expect(route('worksuite://7/file/12')).toBe('/files?file=12&play=1');
    expect(route('worksuite://7/file/12?action=show')).toBe('/files?file=12');
    expect(route('worksuite://7/folder/4')).toBe('/files?folder=4');
    expect(route('worksuite://7/shared/12')).toBe('/files?view=shared&file=12');
    expect(route('worksuite://7/meeting/0f8fad5b-d9cb-469f-a165-70867728950e')).toBe('/meet/0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(route('worksuite://7/meeting/0f8fad5b-d9cb-469f-a165-70867728950e?action=details')).toBe('/meet/0f8fad5b-d9cb-469f-a165-70867728950e?details=1');
    expect(route('worksuite://7/meeting/41')).toBe('/meetings?meeting=41');
    expect(itemApp(ok('worksuite://7/meeting/41'))).toBe('meetings');
    expect(route('worksuite://7/event/5?action=accept')).toBe('/calendar?event=5');
    expect(route('worksuite://7/note/5')).toBe('/notes?note=5');
    expect(route('worksuite://7/task/5?comment=9')).toBe('/tasks?task=5&comment=9');
    expect(route('worksuite://7/reminder/5?run=77&action=snooze')).toBe('/tasks?task=5&reminder=77');
    expect(route('worksuite://7/alert/security')).toBe('/settings/security');
    expect(route('worksuite://7/alert/storage')).toBe('/files?view=storage');
    expect(route('worksuite://7/alert/overdue')).toBe('/tasks?scope=overdue');
    expect(route('worksuite://7/mention/42?message=901')).toBe('/chat/42?message=901');
    expect(route('worksuite://7/tender/3')).toBe('/tenders/3');
    expect(route('worksuite://7/invoice/3?action=approve')).toBe('/billing?invoice=3&review=1');
    expect(route('worksuite://7/expense/3?action=review')).toBe('/expenses?claim=3&review=1');
    expect(route('worksuite://7/lead/3')).toBe('/crm/leads/3');
    expect(route('worksuite://7/deal/3')).toBe('/crm?deal=3');
  });

  it('names the app each opens in (an alert by what it is about)', () => {
    expect(itemApp(ok('worksuite://7/file/1'))).toBe('files');
    expect(itemApp(ok('worksuite://7/alert/sync'))).toBe('files');
    expect(itemApp(ok('worksuite://7/alert/security'))).toBe('settings');
    expect(itemApp(ok('worksuite://7/expense/1'))).toBe('expenses');
  });

  it('builds both forms back, round-trip', () => {
    const l = ok('worksuite://7/reminder/5?action=snooze&run=77');
    expect(itemAppLink(l)).toBe('worksuite://7/reminder/5?action=snooze&run=77');
    expect(itemWebLink(l)).toBe('https://app.worksuite.lk/o/7/reminder/5?action=snooze&run=77');
    expect(ok(itemWebLink(l))).toMatchObject({ type: 'reminder', action: 'snooze', run: '77' });
    expect(itemAppLink(ok('worksuite://7/note/5'))).toBe('worksuite://7/note/5');
  });

  it('marks the actions that change data', () => {
    for (const a of ['done', 'snooze', 'accept', 'decline', 'maybe', 'approve', 'reject', 'request-access'] as const) expect(isDataChanging(a), a).toBe(true);
    for (const a of ['open', 'download', 'show', 'join', 'details', 'review'] as const) expect(isDataChanging(a), a).toBe(false);
  });

  it('offers card buttons by type', () => {
    expect(cardActions('file')).toEqual(['open', 'download', 'show']);
    expect(cardActions('meeting')).toEqual(['join', 'details']);
    expect(cardActions('reminder')).toEqual(['open', 'snooze', 'done']);
    expect(cardActions('task')).toEqual(['open', 'done']);
  });
});

describe('item links (#170): mail', () => {
  it('reads X-WorkSuite-Item against the same allow-list', () => {
    expect(parseItemHeader('type=file;id=12;org=3')).toMatchObject({ type: 'file', id: '12', org: '3', action: 'open' });
    expect(parseItemHeader(' type=reminder ; id=5 ; org=3 ; action=snooze ; run=9 ')).toMatchObject({ type: 'reminder', action: 'snooze', run: '9' });
    expect(parseItemHeader('type=file;id=12')).toBeNull();
    expect(parseItemHeader('type=file;id=12;org=3;token=x')).toBeNull();
    expect(parseItemHeader('type=file;id=12;org=3;type=task')).toBeNull();
    expect(parseItemHeader('type=shell;id=12;org=3')).toBeNull();
    expect(parseItemHeader('type=file;id=12;org=3;action=delete')).toBeNull();
    expect(parseItemHeader(null)).toBeNull();
  });

  const pass = { available: true, spf: 'pass', dkim: 'pass', dmarc: 'pass' };
  it('trusts only WorkSuite’s sender with SPF, DKIM and DMARC passing, and the server agreeing', () => {
    expect(isVerifiedWorkSuiteMail({ from: 'no-reply@worksuite.lk', security: pass, serverVerified: true })).toBe(true);
    expect(isVerifiedWorkSuiteMail({ from: 'No-Reply@WorkSuite.lk', security: pass, serverVerified: true })).toBe(true);
    expect(isVerifiedWorkSuiteMail({ from: 'no-reply@worksuite.lk', security: { ...pass, dkim: 'fail' }, serverVerified: true })).toBe(false);
    expect(isVerifiedWorkSuiteMail({ from: 'no-reply@worksuite.lk', security: { ...pass, dmarc: 'none' }, serverVerified: true })).toBe(false);
    expect(isVerifiedWorkSuiteMail({ from: 'no-reply@worksuite.lk', security: { ...pass, spf: 'softfail' }, serverVerified: true })).toBe(false);
    expect(isVerifiedWorkSuiteMail({ from: 'no-reply@worksuite.lk', security: pass, serverVerified: false })).toBe(false);
    expect(isVerifiedWorkSuiteMail({ from: 'no-reply@worksuite.lk.evil.com', security: pass, serverVerified: true })).toBe(false);
    expect(isVerifiedWorkSuiteMail({ from: 'no-reply@worksuite.lk', security: { available: false }, serverVerified: true })).toBe(false);
    expect(isVerifiedWorkSuiteMail({ from: 'no-reply@worksuite.lk', security: null, serverVerified: true })).toBe(false);
  });

  it('finds the path of a WorkSuite page link, and nothing else', () => {
    expect(workSuiteWebPath('https://app.worksuite.lk/tasks?task=4')).toBe('/tasks?task=4');
    expect(workSuiteWebPath('http://app.worksuite.lk/tasks')).toBeNull();
    expect(workSuiteWebPath('https://example.com/tasks')).toBeNull();
  });
});

describe('link settings (#170)', () => {
  it('fills what was never saved with the defaults, and keeps what was', () => {
    expect(linkPrefs(null)).toEqual(DEFAULT_LINK_PREFS);
    expect(DEFAULT_LINK_PREFS).toEqual({ openInApp: true, mailLinks: 'new-tab', confirmActions: true });
    expect(linkPrefs({ links: { mailLinks: 'current-tab' } })).toEqual({ openInApp: true, mailLinks: 'current-tab', confirmActions: true });
    expect(linkPrefs({ links: { openInApp: false, confirmActions: false } })).toMatchObject({ openInApp: false, confirmActions: false });
    expect(linkPrefs({ links: { mailLinks: 'window' as never } }).mailLinks).toBe('new-tab');
  });
});
