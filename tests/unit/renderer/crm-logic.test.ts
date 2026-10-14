// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/core/api';
import { boardTotals, bulkSummary, crmRoute, csvName, isMissing, lateLabel, moveItem, normaliseSearch, pageOf, scopeParams, stageProblems, statusLine, subjectOf, toCsv, whatFor } from '../../../src/modules/crm/logic';
import { scopeOf } from '../../../src/modules/crm/scope';
import { quoteActions, totalsOf } from '../../../src/modules/crm/Quotes';
import { viewCount } from '../../../src/modules/crm/Leads';

/*
 * The CRM's rules that are not drawing: where a record opens, the company
 * scope a list asks for, paging and tallies from either server shape, the
 * grouped search, bulk results, follow-up lateness and subjects, the board's
 * totals, the pipeline editor's checks and CSV.
 */

describe('crmRoute — every record opens at its own address', () => {
  it('keeps the deep links the shell, notifications and search use', () => {
    expect(crmRoute({ type: 'lead', id: 4 })).toBe('/crm/leads/4');
    expect(crmRoute({ type: 'deal', id: 7 })).toBe('/crm?tab=pipe&deal=7');
    expect(crmRoute({ type: 'account', id: 9 })).toBe('/crm?tab=acc&account=9');
    expect(crmRoute({ type: 'quote', id: 3 })).toBe('/crm?tab=quotes&quote=3');
  });
  it('opens a contact at its account, or searches the accounts for it', () => {
    expect(crmRoute({ type: 'contact', id: 12, account_id: 9 })).toBe('/crm?tab=acc&account=9');
    expect(crmRoute({ type: 'contact', id: 12, label: 'Nimal Perera' })).toBe('/crm?tab=acc&q=Nimal%20Perera');
  });
});

describe('company scope', () => {
  const orgs = [
    { id: '2', name: 'CreativeFX' },
    { id: '4', name: 'TechHubiz' },
  ];
  it('asks lists for the company showing, as org_id (and org for older servers)', () => {
    expect(scopeParams(2)).toEqual({ org_id: 2, org: 2 });
    expect(scopeParams(null)).toEqual({});
    const s = scopeOf('4', orgs);
    expect(s).toMatchObject({ orgId: 4, name: 'TechHubiz', needsOrg: false, params: { org_id: 4 } });
  });
  it('makes a create form ask which company only with several and All showing', () => {
    expect(scopeOf(null, orgs)).toMatchObject({ orgId: null, needsOrg: true, name: 'All companies', params: {} });
    expect(scopeOf(null, [orgs[0]!])).toMatchObject({ needsOrg: false, name: 'CreativeFX' });
  });
});

describe('pageOf / statusLine', () => {
  it('reads the meta block', () => {
    const m = pageOf({ meta: { total: 300, page: 1, per_page: 50, has_more: true, counts: { new: 60, no_followup: 41, unassigned: 12 } } });
    expect(m).toMatchObject({ total: 300, page: 1, has_more: true });
    expect(statusLine(['lead', 'leads'], m, [['new', 'new'], ['no_followup', 'with no follow-up'], ['unassigned', 'unassigned']])).toBe('300 leads · 60 new · 41 with no follow-up · 12 unassigned');
  });
  it('falls back to the older top-level fields and views', () => {
    const m = pageOf({ total: '7', page: '2', has_more: false, views: { overdue: 4, none: 180 } });
    expect(m).toMatchObject({ total: 7, page: 2, has_more: false, counts: { overdue: 4, none: 180 } });
    expect(viewCount(m, 'none')).toBe(180);
    expect(viewCount(pageOf({ meta: { total: 1, counts: { no_followup: 41 } } }), 'none')).toBe(41);
  });
  it('works out more pages from per_page when has_more is missing', () => {
    expect(pageOf({ total: 120, page: 2, meta: { per_page: 50 } }).has_more).toBe(true);
    expect(pageOf({ total: 120, page: 3, meta: { per_page: 50 } }).has_more).toBe(false);
  });
});

describe('normaliseSearch', () => {
  it('groups the grouped answer in a fixed order and keeps contacts’ accounts', () => {
    const g = normaliseSearch({
      quotes: [{ id: 3, label: 'QUO-0042', sub: 'Sent', type: 'quote' }],
      leads: [{ id: 4, label: 'Pradeep W.', sub: 'Holdings', type: 'lead' }],
      contacts: [{ id: 12, label: 'Nimal Perera', sub: 'Highland', type: 'contact', account_id: 9 }],
      accounts: [],
      deals: [],
    });
    expect(g.map((x) => x.label)).toEqual(['Leads', 'Contacts', 'Quotes']);
    expect(g[1]!.hits[0]).toMatchObject({ type: 'contact', id: 12, title: 'Nimal Perera', account_id: 9 });
  });
  it('groups the older flat answer by type', () => {
    const g = normaliseSearch({ results: [{ type: 'account', id: 9, title: 'Highland', subtitle: 'Customer', meta: 'Colombo' }, { type: 'lead', id: 4, title: 'Pradeep', subtitle: null, meta: null }] });
    expect(g.map((x) => x.type)).toEqual(['lead', 'account']);
    expect(g[1]!.hits[0]!.sub).toBe('Customer · Colombo');
  });
  it('answers nothing for nothing', () => {
    expect(normaliseSearch(undefined)).toEqual([]);
  });
});

describe('bulkSummary', () => {
  it('says how many were done and why the rest were refused', () => {
    expect(bulkSummary({ results: [{ id: 1, ok: true }, { id: 2, ok: true }], done: 2, refused: 0 })).toEqual({ tone: 'success', text: '2 leads done.' });
    expect(bulkSummary({ results: [{ id: 1, ok: true }, { id: 2, ok: false, code: 'converted', message: 'Converted leads are kept.' }], done: 1, refused: 1 })).toEqual({ tone: 'warning', text: '1 lead done · 1 refused — Converted leads are kept.' });
    expect(bulkSummary({ results: [{ id: 2, ok: false }], done: 0, refused: 1 }).tone).toBe('error');
  });
});

describe('follow-ups', () => {
  it('writes lateness as the design does', () => {
    expect(lateLabel(null)).toBeNull();
    expect(lateLabel(12)).toBe('12 min late');
    expect(lateLabel(130)).toBe('2 h 10 m late');
    expect(lateLabel(120)).toBe('2 h late');
    expect(lateLabel(3 * 1440)).toBe('3 days late');
  });
  it('knows what it is about and what it is for, on either server', () => {
    const old = { lead_id: 4, lead: 'Pradeep', subject: 'Send the price list' };
    expect(subjectOf(old)).toEqual({ type: 'lead', id: 4, label: 'Pradeep' });
    expect(whatFor(old)).toBe('Send the price list');
    const now = { lead_id: null, lead: null, subject: { type: 'deal', id: '7', label: 'Cold Room Upgrade' }, title: 'Confirm the spec' };
    expect(subjectOf(now)).toEqual({ type: 'deal', id: 7, label: 'Cold Room Upgrade' });
    expect(whatFor(now)).toBe('Confirm the spec');
    expect(subjectOf({ lead_id: null, lead: null, subject: null })).toBeNull();
    const server = { lead_id: null, lead: null, subject: 'Confirm the spec', record: { type: 'account', id: 3, label: 'Ceylon Spice' } };
    expect(subjectOf(server)).toEqual({ type: 'account', id: 3, label: 'Ceylon Spice' });
    expect(whatFor(server)).toBe('Confirm the spec');
  });
});

describe('boardTotals', () => {
  const columns = [
    { kind: 'open', count: 2, total: 1000, weighted: 100 },
    { kind: 'open', count: 1, total: 500, weighted: 250 },
    { kind: 'won', count: 3, total: 9000, weighted: 9000 },
  ];
  it('takes the server’s meta when sent', () => {
    expect(boardTotals({ meta: { deals: 56, open_value: 84_100_000, weighted: 36_200_000 }, columns })).toEqual({ deals: 56, open: 84_100_000, weighted: 36_200_000 });
  });
  it('adds up the open columns otherwise, never the won one', () => {
    expect(boardTotals({ columns })).toEqual({ deals: 6, open: 1500, weighted: 350 });
  });
});

describe('pipeline editor checks', () => {
  it('wants a won and a lost stage, names and probabilities in range', () => {
    expect(stageProblems([{ name: 'New', kind: 'open', probability: 10 }, { name: 'Won', kind: 'won', probability: 100 }, { name: 'Lost', kind: 'lost', probability: 0 }])).toEqual([]);
    expect(stageProblems([{ name: '', kind: 'open', probability: 120 }])).toEqual(['A pipeline needs a Won stage.', 'A pipeline needs a Lost stage.', 'Every stage needs a name.', 'Probability is between 0 and 100.']);
  });
  it('moves a stage one place, and not past either end', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('CSV', () => {
  it('quotes what needs quoting and defuses formulas', () => {
    expect(toCsv([['Name', 'Note'], ['Perera, Nimal', 'said "yes"'], ['=1+1', 5], [null, undefined]])).toBe('Name,Note\n"Perera, Nimal","said ""yes"""\n\'=1+1,5\n,');
    expect(csvName('leads', '2026-10-14')).toBe('leads-2026-10-14.csv');
  });
});

describe('isMissing — an endpoint this server does not have yet', () => {
  it('is 404, 405, 501 or not_supported, and nothing else', () => {
    expect(isMissing(new ApiError(404, 'Not found', null))).toBe(true);
    expect(isMissing(new ApiError(501, 'No', 'not_supported'))).toBe(true);
    expect(isMissing(new ApiError(405, 'Method not allowed', null))).toBe(true);
    expect(isMissing(new ApiError(409, 'In use', 'stage_in_use'))).toBe(false);
    expect(isMissing(new ApiError(422, 'Choose', 'org_required'))).toBe(false);
    expect(isMissing(new Error('x'))).toBe(false);
  });
});

describe('quotes', () => {
  it('offers what each status allows', () => {
    expect(quoteActions({ status: 'draft', invoice_id: null, can: null, expired: false }, true)).toMatchObject({ send: true, accept: false, invoice: false, revise: false, remove: true });
    expect(quoteActions({ status: 'sent', invoice_id: null, can: null, expired: false }, true)).toMatchObject({ send: false, accept: true, decline: true, revise: true });
    expect(quoteActions({ status: 'accepted', invoice_id: null, can: null, expired: false }, true).invoice).toBe(true);
    expect(quoteActions({ status: 'accepted', invoice_id: 5, can: null, expired: false }, true).invoice).toBe(false);
    expect(quoteActions({ status: 'accepted', invoice_id: null, can: { invoice: false }, expired: false }, true).invoice).toBe(false);
    expect(quoteActions({ status: 'accepted', invoice_id: null, can: null, expired: false }, true, true).invoice).toBe(false);
    expect(quoteActions({ status: 'sent', invoice_id: null, can: null, expired: false }, false)).toMatchObject({ accept: false, revise: false });
  });
  it('previews the server’s sums while typing', () => {
    const t = totalsOf([{ product_id: null, description: 'A', quantity: 10, unit_price: 100, discount_pct: 10, tax_rate: 10 }], 100);
    expect(t).toMatchObject({ subtotal: 900, discount: 100 });
    expect(t.total).toBeCloseTo(880, 2);
  });
});
