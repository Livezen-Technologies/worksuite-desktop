import { describe, expect, it } from 'vitest';
import { pageTitle, pageTitleLine, pathOf, recordsIn, refOf, shareLink, webPathOfRoute, withoutRecordLines, type RecordRef } from '../../../src/modules/chat/cards/recordLinks';

const origin = 'https://app.worksuite.lk';
const uuid = 'd9de3234-a5a2-4d13-8bd6-b2972e1043ef';

describe('records named in a message', () => {
  it('finds a meeting invitation, once, however often it is named', () => {
    const text = `Dimuthu Anuraj invites you to “Instant meeting”.\nJoin: https://app.worksuite.lk/meet/${uuid}\nMeeting ID: ${uuid}`;
    expect(recordsIn(text, origin)).toEqual([{ kind: 'meet', uuid }]);
  });

  it('reads the addresses Attach record sends, as bare paths', () => {
    expect(recordsIn('Send revised proposal\n/tasks?task=1482', origin)).toEqual([{ kind: 'task', id: 1482 }]);
    expect(recordsIn('/crm/leads/77', origin)).toEqual([{ kind: 'lead', id: 77 }]);
    expect(recordsIn('Deal: /crm?tab=pipe&deal=291.', origin)).toEqual([{ kind: 'deal', id: 291 }]);
    expect(recordsIn('/files?folder=12 and /files?file=9', origin)).toEqual([{ kind: 'folder', id: 12 }, { kind: 'file', id: 9 }]);
  });

  it("ignores other sites' addresses and paths that are not records", () => {
    expect(recordsIn('see https://example.com/tasks?task=3 and /usr/local/bin', origin)).toEqual([]);
    expect(recordsIn('https://app.worksuite.lk/tasks', origin)).toEqual([]);
    expect(refOf('/meet/not-a-uuid')).toBeNull();
  });

  it('shows at most four cards for one message', () => {
    expect(recordsIn('/tasks?task=1 /tasks?task=2 /tasks?task=3 /tasks?task=4 /tasks?task=5', origin)).toHaveLength(4);
  });

  it('reads back every address it shares as the same record', () => {
    const all: RecordRef[] = [
      { kind: 'meet', uuid },
      ...(['file', 'folder', 'task', 'note', 'event', 'deal', 'lead', 'account', 'invoice', 'contact', 'meeting'] as const).map((kind) => ({ kind, id: 42 }) as RecordRef),
    ];
    for (const r of all) expect(recordsIn(`${origin}${pathOf(r)}`, origin)).toEqual([r]);
    // The web app's CRM reads ?deal= and ?account=; the desktop's works out the view from them.
    expect(pathOf({ kind: 'deal', id: 7 })).toBe('/crm?deal=7');
    expect(pathOf({ kind: 'contact', id: 7 })).toBe('/contacts?open=7');
  });
});

describe('shared pages and item links (#266)', () => {
  const hr = { kind: 'page', app: 'hr', page: 'announcements' } as const;

  it('reads item links as cards: records, Meet rooms and pages, with the organisation a page names', () => {
    expect(recordsIn('https://app.worksuite.lk/o/7/task/12', origin)).toEqual([{ kind: 'task', id: 12 }]);
    expect(recordsIn(`https://app.worksuite.lk/o/7/meeting/${uuid}`, origin)).toEqual([{ kind: 'meet', uuid }]);
    expect(recordsIn('https://app.worksuite.lk/o/7/meeting/41', origin)).toEqual([{ kind: 'meeting', id: 41 }]);
    expect(recordsIn('HR · Announcements\nhttps://app.worksuite.lk/o/7/hr/announcements', origin)).toEqual([{ ...hr, org: '7' }]);
    // The signed-in server's own address too, and nothing a link's allow-list refuses.
    expect(recordsIn('https://work.example.lk/o/3/hr/leave', 'https://work.example.lk')).toEqual([{ kind: 'page', app: 'hr', page: 'leave', org: '3' }]);
    expect(recordsIn('https://evil.example/o/7/hr/announcements', origin)).toEqual([]);
    expect(recordsIn('https://app.worksuite.lk/o/7/hr/announcements?action=approve', origin)).toEqual([]);
    expect(recordsIn('https://app.worksuite.lk/o/7/tender/3', origin)).toEqual([]);
  });

  it('shows the older relative paths a share sent as cards too', () => {
    expect(recordsIn('HR · Announcements\n/hr?tab=announcements', origin)).toEqual([hr]);
    expect(recordsIn('https://app.worksuite.lk/oms?tab=orders', origin)).toEqual([{ kind: 'page', app: 'sales', page: 'orders' }]);
    expect(refOf('/files?view=shared')).toEqual({ kind: 'page', app: 'files', page: 'shared' });
    // A record on the page is the record; a page with more on it than the page is not a page.
    expect(refOf('/files?view=shared&file=9')).toEqual({ kind: 'file', id: 9 });
    expect(refOf('/hr?tab=people&employee=12')).toBeNull();
    expect(refOf('/hr')).toBeNull();
    expect(pathOf(hr)).toBe('/hr?tab=announcements');
    expect(pathOf({ kind: 'page', app: 'sales', page: 'orders' })).toBe('/oms?tab=orders');
  });

  it('takes the line above a page’s link as its title, and leaves it out of the caption', () => {
    const text = 'HR · Announcements\nhttps://app.worksuite.lk/o/7/hr/announcements';
    expect(pageTitleLine(text, hr)).toBe('HR · Announcements');
    expect(withoutRecordLines(text, origin)).toBe('');
    expect(withoutRecordLines(`Have a look\n${text}`, origin)).toBe('Have a look');
    expect(pageTitleLine('https://app.worksuite.lk/o/7/hr/announcements', hr)).toBeNull();
    expect(pageTitle(hr)).toBe('HR · Announcements');
  });

  it('shares a full item link that names the organisation, the type and the id — never a bare path', () => {
    const opts = { org: '7', origin };
    expect(shareLink('/hr?tab=announcements', opts)).toBe('https://app.worksuite.lk/o/7/hr/announcements');
    expect(shareLink('/tasks?task=12', opts)).toBe('https://app.worksuite.lk/o/7/task/12');
    expect(shareLink(`/meet/${uuid}`, opts)).toBe(`https://app.worksuite.lk/o/7/meeting/${uuid}`);
    expect(shareLink('/files?file=9', { org: '7', origin: 'https://work.example.lk' })).toBe('https://work.example.lk/o/7/file/9');
    // A server on plain http or a port can't be in an item link: WorkSuite's own address stands in.
    expect(shareLink('/hr?tab=leave', { org: '7', origin: 'http://localhost:8920' })).toBe('https://app.worksuite.lk/o/7/hr/leave');
    // What an item link can't name goes as the server's full address.
    expect(shareLink('/contacts?open=4', opts)).toBe('https://app.worksuite.lk/contacts?open=4');
    expect(shareLink('/hr?tab=people&employee=12', opts)).toBe('https://app.worksuite.lk/hr?tab=people&employee=12');
    expect(shareLink('/hr?tab=announcements', { org: null, origin })).toBe('https://app.worksuite.lk/hr?tab=announcements');
    for (const raw of [shareLink('/hr?tab=announcements', opts), shareLink('/tasks?task=12', opts), shareLink('/contacts?open=4', opts)]) expect(recordsIn(raw, origin)).toHaveLength(1);
  });

  it('finds what an open tab shows: a record or a page of an app, not a whole app, Chat or Home', () => {
    expect(webPathOfRoute('/hr?tab=announcements')).toBe('/hr?tab=announcements');
    expect(webPathOfRoute('/sales?tab=orders')).toBe('/oms?tab=orders');
    expect(webPathOfRoute('/tasks?task=3')).toBe('/tasks?task=3');
    expect(webPathOfRoute('/hr')).toBeNull();
    expect(webPathOfRoute('/chat?room=4')).toBeNull();
    expect(webPathOfRoute('/home?announcements=all')).toBeNull();
  });
});
