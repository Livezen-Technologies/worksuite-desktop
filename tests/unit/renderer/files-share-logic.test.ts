import { describe, expect, it } from 'vitest';
import {
  CANT_SHARE,
  NO_SIGN_IN,
  generalAction,
  generalOf,
  generalOptions,
  grantRequests,
  levelsFor,
  nextActive,
  offered,
  resultsOf,
  sharedSummary,
  signsIn,
  type Principal,
} from '../../../src/modules/files/sharing';

const person = (id: number, name: string, detail: string | null, extra: Partial<Principal> = {}): Principal => ({ type: 'user', id, name, detail, ...extra });

describe('Share › who can be shared with (worksuite-desktop#329)', () => {
  it('knows a payroll placeholder address has no sign-in', () => {
    expect(signsIn('chamudi@payroll.invalid')).toBe(false);
    expect(signsIn(' X@PAYROLL.INVALID ')).toBe(false);
    expect(signsIn('x@example.invalid.')).toBe(false);
    expect(signsIn('chamudi@livezentech.com')).toBe(true);
    expect(signsIn('invalid@livezentech.com')).toBe(true);
    expect(signsIn(null)).toBe(true);
  });

  it('flattens one list: shareable people, then people who cannot be shared with, then teams, departments, roles, companies', () => {
    const list = resultsOf({
      people: [person(2, 'Chamudi Gayeshika', 'chamudi@payroll.invalid'), person(1, 'Chamudi Gayeshika', 'chamudi@livezentech.com · Sales')],
      teams: [{ type: 'group', id: 7, name: 'Tender team', detail: 'Team · 4 people' }],
      departments: [{ type: 'department', id: 8, name: 'HR & Admin', detail: null }],
      roles: [],
      companies: [{ type: 'organization', id: 1, name: 'Livezen', detail: null }],
      shareable: true,
    });
    expect(list.map((r) => r.key)).toEqual(['user:1', 'user:2', 'group:7', 'department:8', 'organization:1']);
    expect(list.map((r) => r.kind)).toEqual(['Person', 'Person', 'Team', 'Department', 'Company']);
  });

  it('greys out a payroll record, from the server’s flag or (an older server) its address', () => {
    const [fromFlag] = resultsOf({ results: [person(3, 'A', 'Payroll record · no WorkSuite sign-in', { can_share: false, why: 'Can’t share', kind: 'Person' })], shareable: true });
    expect(fromFlag).toMatchObject({ can_share: false, why: CANT_SHARE, detail: NO_SIGN_IN });

    const [fromAddress] = resultsOf({ people: [person(4, 'B', 'b@payroll.invalid')], shareable: true });
    expect(fromAddress).toMatchObject({ can_share: false, why: CANT_SHARE, detail: NO_SIGN_IN });

    const [team] = resultsOf({ teams: [{ type: 'group', id: 5, name: 'invalid.team', detail: 'x.invalid' }], shareable: true });
    expect(team!.can_share).toBe(true);
  });

  it('uses the server’s flat list as it comes, and leaves out what is already chosen', () => {
    const results = [person(1, 'A', 'a@x.com'), { type: 'group' as const, id: 2, name: 'T', detail: null }, person(3, 'C', 'c@x.com')];
    expect(resultsOf({ results, shareable: true }, [{ type: 'user', id: 3 }]).map((r) => r.key)).toEqual(['user:1', 'group:2']);
    expect(resultsOf(undefined)).toEqual([]);
  });

  it('moves the highlight with the arrow keys, wrapping', () => {
    expect(nextActive(3, -1, 1)).toBe(0);
    expect(nextActive(3, -1, -1)).toBe(2);
    expect(nextActive(3, 2, 1)).toBe(0);
    expect(nextActive(3, 0, -1)).toBe(2);
    expect(nextActive(0, -1, 1)).toBe(-1);
  });
});

describe('Share › permission levels', () => {
  it('lists four short levels, each explained, in order', () => {
    expect(levelsFor('folder').map((l) => [l.id, l.label])).toEqual([
      ['view', 'Can view'],
      ['comment', 'Can comment'],
      ['edit', 'Can edit'],
      ['full', 'Full access'],
    ]);
    expect(levelsFor('folder')[2]!.help).toBe('Change files and add new ones');
    expect(levelsFor('file')[2]!.help).toBe('Change it and upload new versions');
    expect(levelsFor('file').every((l) => l.help.length > 0)).toBe(true);
  });

  it('offers only what the server knows: no comment level from an older server', () => {
    expect(offered('file', ['view', 'comment', 'edit', 'full']).map((l) => l.id)).toEqual(['view', 'comment', 'edit', 'full']);
    expect(offered('file').map((l) => l.id)).toEqual(['view', 'edit', 'full']);
  });
});

describe('Share › state to requests', () => {
  const chosen = [{ type: 'user' as const, id: 5, name: 'Chamudi Gayeshika' }, { type: 'group' as const, id: 7, name: 'Tender team' }];

  it('sends one grant per chip, with the level, the channels and the message', () => {
    expect(grantRequests(chosen, 'edit', { chat: true, email: false, message: '  For Monday ' })).toEqual([
      { principal_type: 'user', principal_id: 5, level: 'edit', can_download: true, notify: true, notify_chat: true, notify_email: false, message: 'For Monday' },
      { principal_type: 'group', principal_id: 7, level: 'edit', can_download: true, notify: true, notify_chat: true, notify_email: false, message: 'For Monday' },
    ]);
  });

  it('shares quietly with both channels off, and leaves out an empty message', () => {
    expect(grantRequests(chosen.slice(0, 1), 'view', { chat: false, email: false, message: 'ignored' })).toEqual([{ principal_type: 'user', principal_id: 5, level: 'view', can_download: true, notify: false }]);
    expect(grantRequests(chosen.slice(0, 1), 'comment', { chat: false, email: true, message: '   ' })[0]).not.toHaveProperty('message');
  });

  it('says what was done', () => {
    expect(sharedSummary(chosen, 'edit', { chat: true, email: true })).toBe('Shared with Chamudi, Tender team (can edit) · notified by chat and email');
    expect(sharedSummary(chosen.slice(0, 1), 'comment', { chat: true, email: false })).toBe('Shared with Chamudi (can comment) · notified in chat');
    expect(sharedSummary(chosen.slice(0, 1), 'view', { chat: false, email: true })).toBe('Shared with Chamudi (can view) · notified by email');
    expect(sharedSummary(chosen.slice(0, 1), 'full', { chat: false, email: false })).toBe('Shared with Chamudi (full access) · shared quietly');
  });
});

describe('Share › general access', () => {
  const item = { company: { id: 1 } };

  it('names the company and explains each choice', () => {
    expect(generalOptions('Livezen Technologies').map((o) => o.label)).toEqual(['Restricted', 'Anyone at Livezen Technologies with the link', 'Anyone with the link']);
    expect(generalOptions(null)[1]!.label).toBe('Anyone at the company with the link');
  });

  it('reads the server’s answer, or works it out from public links and the company rule', () => {
    expect(generalOf({ item, general: { access: 'org', level: 'comment', grant_id: 3 } })).toEqual({ access: 'org', level: 'comment', grantId: 3 });
    expect(generalOf({ item, public_links: { shares: 0 }, grants: [] })).toEqual({ access: 'restricted', level: null, grantId: null });
    expect(generalOf({ item, public_links: { shares: 0 }, grants: [{ id: 9, principal: { type: 'organization', id: 1 }, level: 'view', effect: 'allow' }] })).toEqual({ access: 'org', level: 'view', grantId: 9 });
    expect(generalOf({ item, public_links: { shares: 0 }, grants: [{ id: 9, principal: { type: 'organization', id: 2 }, level: 'view', effect: 'allow' }] }).access).toBe('restricted');
    expect(generalOf({ item, public_links: { shares: 1 }, grants: [] }).access).toBe('anyone');
  });

  it('turns a choice into a request, a public link, or nothing', () => {
    expect(generalAction('restricted', 'restricted')).toEqual({ kind: 'none' });
    expect(generalAction('restricted', 'anyone')).toEqual({ kind: 'link' });
    expect(generalAction('restricted', 'org', 'comment')).toEqual({ kind: 'put', body: { access: 'org', level: 'comment' } });
    expect(generalAction('restricted', 'org', 'full')).toEqual({ kind: 'put', body: { access: 'org', level: 'edit' } });
    expect(generalAction('anyone', 'restricted')).toEqual({ kind: 'put', body: { access: 'restricted' } });
  });
});
