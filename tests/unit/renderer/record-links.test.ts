import { describe, expect, it } from 'vitest';
import { pathOf, recordsIn, refOf, type RecordRef } from '../../../src/modules/chat/cards/recordLinks';

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
