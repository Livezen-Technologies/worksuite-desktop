// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => true), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<object>()), apiGetMeta: vi.fn(), apiPost: vi.fn(async () => ({})), apiPut: vi.fn(async () => ({})), apiDelete: vi.fn(async () => ({})), request: vi.fn(async () => ({ data: {}, offline: false, cachedAt: null, message: null })) }));

import { ApiError, apiDelete, apiGetMeta, apiPost, apiPut, request } from '../../../src/core/api';
import {
  asOf,
  bulk,
  changeRecord,
  confirmsName,
  createRecord,
  daysLeft,
  deleteRecord,
  explain,
  fetchDns,
  fetchDomain,
  fetchDomains,
  fetchLookup,
  fetchLookups,
  fetchOverview,
  fileNameOf,
  hostOf,
  importPreview,
  mapOf,
  needsStepUp,
  orNull,
  pageOf,
  printable,
  recordProblem,
  refusedCopy,
  setAutoRenew,
  stepUpMethods,
  urgency,
} from '../../../src/modules/hosting/api';
import { toBind, zoneFileName } from '../../../src/modules/hosting/DnsEditor';
import { domainQuery, moveIndex, toggle } from '../../../src/modules/hosting/Domains';
import { certProblem } from '../../../src/modules/hosting/Certificates';
import { monthlyTotals, PowerDialog, supports } from '../../../src/modules/hosting/Servers';
import { plausibleDomain } from '../../../src/modules/hosting/AddDomain';
import { syncAll } from '../../../src/modules/hosting/HostingShell';
import { RAIL, VIEWS } from '../../../src/modules/hosting/Rail';
import { renewalNote } from '../../../src/modules/hosting/Overview';
import { bulkSummary } from '../../../src/modules/hosting/Bulk';
import { changedLinks } from '../../../src/modules/hosting/Links';
import { serverChanges } from '../../../src/modules/hosting/ServerForm';
import { seriesValues } from '../../../src/modules/hosting/ServerPage';
import { changes, fieldLabel } from '../../../src/modules/hosting/Import';
import { searchable } from '../../../src/modules/hosting/Register';
import { answerStepUp, StepUpHost, withStepUp } from '../../../src/modules/hosting/StepUp';
import { badgeCount } from '../../../src/core/dock-badge';
import { APP_CATALOGUE } from '../../../shared/apps';
import { appColour } from '../../../src/core/app-look';
import { allowedModules } from '../../../src/modules/registry';

const notFound = Object.assign(new Error('nf'), { status: 404 });
const meta = <T,>(data: T, extra: Partial<{ offline: boolean; cachedAt: string | null; meta: unknown }> = {}) => ({ data, offline: false, cachedAt: null, ...extra });
const listMeta = (total: number, page = 1, per_page = 50) => ({ total, page, per_page, pages: Math.max(1, Math.ceil(total / per_page)), sort: 'expires_on' });
const copy = (records: unknown[] = []) => ({ records, refreshed_at: '2026-10-26T09:14:00Z', source: 'sync', readable: true, can_refresh: true, can_edit: true });

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

describe('HDM-DSK-01: Hosting in the app registry', () => {
  it('is a native Business app with the globe icon in cyan', () => {
    const def = APP_CATALOGUE.find((a) => a.id === 'hosting')!;
    expect(def).toMatchObject({ group: 'business', icon: 'globe', surface: 'native', app: 'hosting', perm: 'hosting.view' });
    expect(appColour('hosting')).toBe('#0891B2');
  });
  it('has a valid desktop manifest, opened for whoever may open Hosting', () => {
    expect(allowedModules(new Set(['hosting'])).has('hosting')).toBe(true);
    expect(allowedModules(new Set(['mail'])).has('hosting')).toBe(false);
  });
  it('rails the ten screens of HDM-DSK-02 in order, and reaches register, import and reports from them', () => {
    expect(RAIL.map((r) => r.label)).toEqual(['Overview', 'Domains', 'Expiring', 'DNS', 'Certificates', 'Servers', 'Monitors', 'Costs', 'Accounts', 'Sync history']);
    for (const v of ['register', 'import', 'reports']) expect(VIEWS.has(v)).toBe(true);
  });
});

describe('the API client reads the server’s shapes', () => {
  it('reads a list as {<key>, summary, meta} inside data', () => {
    const p = pageOf<{ id: number }, { within_30: number }>({ domains: [{ id: 1 }, { id: 2 }], summary: { total: 48, within_30: 6 }, meta: listMeta(48, 2, 2) }, undefined, 'domains');
    expect(p).toMatchObject({ items: [{ id: 1 }, { id: 2 }], total: 48, page: 2, per_page: 2, pages: 24, sort: 'expires_on' });
    expect(p.summary.within_30).toBe(6);
    // Older shapes still open (a cached answer, a bare array).
    expect(pageOf([{ id: 1 }], null, 'domains')).toMatchObject({ items: [{ id: 1 }], total: 1, pages: 1 });
    expect(pageOf({ items: [{ id: 3 }] }, { total: 9, current_page: 3 }, 'x')).toMatchObject({ items: [{ id: 3 }], total: 9, page: 3 });
  });
  it('turns a route a server does not have into null — "needs a server update"', async () => {
    expect(await orNull(Promise.reject(notFound))).toBeNull();
    await expect(orNull(Promise.reject(Object.assign(new Error('x'), { status: 500 })))).rejects.toThrow('x');
    vi.mocked(apiGetMeta).mockRejectedValueOnce(notFound);
    expect(await fetchOverview(0)).toBeNull();
  });
  it('reads one domain from domains/{id}', async () => {
    vi.mocked(apiGetMeta).mockResolvedValueOnce(meta({ id: 7, name: 'livezentech.com', supports: ['dns', 'renew'], dns: copy() }));
    expect(await fetchDomain(7)).toMatchObject({ name: 'livezentech.com', supports: ['dns', 'renew'] });
    expect(apiGetMeta).toHaveBeenLastCalledWith('/api/hosting/domains/7', undefined, undefined);
  });
  it('remembers when the offline copy was saved (HDM-DSK-05)', async () => {
    asOf.set({ at: null });
    vi.mocked(apiGetMeta).mockResolvedValueOnce(meta({ domains: [], meta: listMeta(0) }, { offline: true, cachedAt: '2026-10-26T09:12:00Z' }));
    await fetchDomains({});
    expect(asOf.get().at).toBe('2026-10-26T09:12:00Z');
    vi.mocked(apiGetMeta).mockResolvedValueOnce(meta({ domains: [] }, { offline: true, cachedAt: '2026-10-26T10:00:00Z' }));
    await fetchDomains({});
    expect(asOf.get().at).toBe('2026-10-26T09:12:00Z');
  });
  it('sends the list filters the server knows and leaves empty ones out', async () => {
    vi.mocked(apiGetMeta).mockResolvedValueOnce(meta({ domains: [] }));
    await fetchDomains(domainQuery('manual', ' lk ', 0, 1));
    expect(apiGetMeta).toHaveBeenLastCalledWith('/api/hosting/domains', { q: 'lk', page: 1, per_page: 100, sort: 'expires_on', source: 'manual' }, undefined);
    expect(domainQuery('expiring', '', 3, 2)).toMatchObject({ expires_within: 30, org: 3, page: 2 });
  });
  it('reads the DNS copy with what may be done to it', async () => {
    vi.mocked(apiGetMeta).mockResolvedValueOnce(meta({ records: [{ id: 1, type: 'A', host: 'www', name: 'www.a.lk', content: '1.2.3.4', editable: true }], refreshed_at: null, source: 'sync', readable: true, can_refresh: false, can_edit: true }));
    expect(await fetchDns(1)).toMatchObject({ can_edit: true, can_refresh: false, records: [{ host: 'www' }] });
  });
  it('asks the explain routes with GET and says whether AI wrote it', async () => {
    vi.mocked(apiGetMeta).mockResolvedValueOnce(meta({ text: 'Points www at the app server.', ai: true }));
    expect(await explain('dns', 12, 4)).toEqual({ text: 'Points www at the app server.', ai: true });
    expect(apiGetMeta).toHaveBeenLastCalledWith('/api/hosting/domains/4/explain', { record: '12' });
    vi.mocked(apiGetMeta).mockResolvedValueOnce(meta({ text: 'The host did not answer.', ai: false }));
    expect(await explain('certificate', 9)).toEqual({ text: 'The host did not answer.', ai: false });
    expect(apiGetMeta).toHaveBeenLastCalledWith('/api/hosting/certificates/9/explain', undefined);
  });
  it('looks a host up live and the links up in the domain’s own company', async () => {
    vi.mocked(apiGetMeta).mockResolvedValueOnce(meta({ host: 'www.a.lk', types: [{ type: 'A', stored: ['1.2.3.4'], resolvers: { google: { ok: true, why: '', values: ['1.2.3.4'] } }, compare: { match: true, missing: [], extra: [] } }] }));
    expect((await fetchLookup(4, 'www', ['A', 'MX']))?.types[0]?.compare.match).toBe(true);
    expect(apiGetMeta).toHaveBeenLastCalledWith('/api/hosting/domains/4/lookup', { host: 'www', type: 'A,MX' });
    vi.mocked(apiGetMeta).mockResolvedValueOnce(meta({ clients: [{ id: 2, name: 'TenderHub' }], projects: [], people: [], servers: [] }));
    expect(await fetchLookups({ domain: 4 })).toMatchObject({ clients: [{ name: 'TenderHub' }] });
    expect(apiGetMeta).toHaveBeenLastCalledWith('/api/hosting/domains/lookups', { domain: 4 }, undefined);
  });
});

describe('days left and urgency (D-01, D-02)', () => {
  it('prefers the server’s days and colours them', () => {
    expect(daysLeft({ days_left: 4, expires_on: '2030-01-01' })).toBe(4);
    expect(daysLeft({ expires_on: '2026-11-07' }, new Date('2026-10-26T12:00:00Z'))).toBe(12);
    expect([urgency(4), urgency(12), urgency(41), urgency(240), urgency(null)]).toEqual(['red', 'amber', 'grey', 'green', 'grey']);
  });
  it('notes a renewal’s auto-renew and price', () => {
    expect(renewalNote({ kind: 'domain', id: 1, name: 'a.lk', auto_renew: false, cost: { amount: '10.37', currency: 'USD' } })).toMatch(/auto-renew off · USD 10.37/);
  });
});

describe('the DNS record form (HDM-DNS-03)', () => {
  it('checks each type', () => {
    expect(recordProblem({ type: 'A', host: 'www', content: '203.0.113.10', ttl: 600 })).toBeNull();
    expect(recordProblem({ type: 'A', host: 'www', content: '203.0.113.300', ttl: 600 })).toMatch(/IPv4/);
    expect(recordProblem({ type: 'AAAA', host: '@', content: '2001:db8:10::1', ttl: 600 })).toBeNull();
    expect(recordProblem({ type: 'MX', host: '@', content: 'mx1.example.com', ttl: 3600, priority: null })).toMatch(/priority/);
    expect(recordProblem({ type: 'CNAME', host: '@', content: 'x.example.com', ttl: 600 })).toMatch(/apex/);
    expect(recordProblem({ type: 'A', host: 'www', content: '1.2.3.4', ttl: 5 })).toMatch(/TTL/);
    expect(recordProblem({ type: 'CAA', host: '@', content: '0 issue "letsencrypt.org"', ttl: 3600 })).toBeNull();
  });
  it('keeps a CNAME alone on its host, by the server’s relative host or the full name', () => {
    const others = [{ id: 1, type: 'A', host: 'portal', name: 'portal.a.lk', content: '1.2.3.4' }];
    expect(recordProblem({ type: 'CNAME', host: 'portal', content: 'portal.worksuitecloud.com', ttl: 3600 }, others)).toMatch(/only record/);
    expect(recordProblem({ type: 'TXT', host: 'www', content: 'x' }, [{ id: 2, type: 'CNAME', name: 'www.a.lk', content: 'a.b' }], 'a.lk')).toMatch(/has a CNAME/);
    expect(hostOf({ name: 'a.lk' }, 'a.lk')).toBe('@');
    expect(hostOf({ name: 'mail.a.lk.' }, 'a.lk')).toBe('mail');
  });
  it('sends host, and the record as it was seen on a change or a delete', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce(copy());
    await createRecord(4, { type: 'A', host: 'www', content: '1.2.3.4', ttl: 600 });
    expect(apiPost).toHaveBeenLastCalledWith('/api/hosting/domains/4/dns', { type: 'A', host: 'www', content: '1.2.3.4', ttl: 600 });
    const was = { id: 9, type: 'A', host: 'www', name: 'www.a.lk', content: '1.2.3.4' };
    vi.mocked(apiPut).mockResolvedValueOnce(copy());
    await changeRecord(4, was, { type: 'A', host: 'www', content: '5.6.7.8', ttl: 600 });
    expect(apiPut).toHaveBeenLastCalledWith('/api/hosting/domains/4/dns/9', { type: 'A', host: 'www', content: '5.6.7.8', ttl: 600, was: { type: 'A', name: 'www.a.lk', content: '1.2.3.4' } });
    vi.mocked(apiDelete).mockResolvedValueOnce(copy());
    expect((await deleteRecord(4, was)).can_edit).toBe(true);
    expect(apiDelete).toHaveBeenLastCalledWith('/api/hosting/domains/4/dns/9', { was: { type: 'A', name: 'www.a.lk', content: '1.2.3.4' } });
  });
  it('shows the fresh copy a refused change sends', () => {
    const e = new ApiError(409, 'Changed at Porkbun meanwhile.', null, { dns: copy([{ id: 1, type: 'A', name: 'a.lk', content: '9.9.9.9' }]) });
    expect(refusedCopy(e)?.records[0]).toMatchObject({ content: '9.9.9.9' });
    expect(refusedCopy(new Error('x'))).toBeNull();
  });
  it('exports the copy as a BIND zone, saved as a text file', () => {
    const z = toBind('livezentech.com', [
      { id: 1, type: 'A', host: '@', name: 'livezentech.com', content: '203.0.113.10', ttl: 600 },
      { id: 2, type: 'MX', host: '@', name: 'livezentech.com', content: 'mx1.livezentech.com', ttl: 3600, priority: 10 },
      { id: 3, type: 'TXT', name: 'www.livezentech.com', content: 'v=spf1 mx ~all', ttl: 3600 },
    ]);
    expect(z).toContain('$ORIGIN livezentech.com.');
    expect(z).toContain('@\t3600\tIN\tMX\t10 mx1.livezentech.com');
    expect(z).toContain('www\t3600\tIN\tTXT\t"v=spf1 mx ~all"');
    expect(zoneFileName('livezentech.com')).toMatch(/^[A-Za-z0-9 ._-]{1,80}\.txt$/);
  });
});

describe('keyboard list and selection (D-02)', () => {
  it('moves within bounds and ticks rows', () => {
    expect(moveIndex('ArrowDown', 0, 3)).toBe(1);
    expect(moveIndex('ArrowDown', 2, 3)).toBe(2);
    expect(moveIndex('ArrowUp', 0, 3)).toBe(0);
    expect(moveIndex('End', 0, 3)).toBe(2);
    expect(moveIndex('a', 0, 3)).toBeNull();
    expect(moveIndex('ArrowDown', 0, 0)).toBeNull();
    expect([...toggle(toggle(new Set([1]), 2), 1)]).toEqual([2]);
  });
});

describe('step-up (HDM-SEC-05)', () => {
  const stepUp = () => new ApiError(428, 'Confirm it’s you to continue.', null, { step_up: true, methods: ['password', 'totp'] });
  it('knows a 428 step_up and the methods offered', () => {
    expect(needsStepUp(stepUp())).toBe(true);
    expect(needsStepUp(new ApiError(422, 'x', null))).toBe(false);
    expect(stepUpMethods(stepUp())).toEqual(['password', 'totp']);
  });
  it('asks once and sends the same request again with the proof', async () => {
    render(<StepUpHost />);
    vi.mocked(apiPost).mockRejectedValueOnce(stepUp()).mockResolvedValueOnce({});
    const done = withStepUp('Changing auto-renew on a.lk', (p) => setAutoRenew(4, true, p));
    await screen.findByText(/needs you to confirm it is you/);
    act(() => answerStepUp({ current_password: 'pw' }));
    await done;
    expect(apiPost).toHaveBeenNthCalledWith(1, '/api/hosting/domains/4/auto-renew', { on: true });
    expect(apiPost).toHaveBeenNthCalledWith(2, '/api/hosting/domains/4/auto-renew', { on: true, current_password: 'pw' });
  });
  it('gives up with the server’s refusal when the person cancels', async () => {
    render(<StepUpHost />);
    vi.mocked(apiPost).mockRejectedValueOnce(stepUp());
    const done = withStepUp('Renewing a.lk', (p) => setAutoRenew(4, false, p));
    await screen.findByText(/needs you to confirm it is you/);
    act(() => answerStepUp(null));
    await expect(done).rejects.toThrow(/Confirm it’s you/);
    expect(apiPost).toHaveBeenCalledTimes(1);
  });
});

describe('bulk, links, servers, import and register', () => {
  it('sends a bulk change and sums up what was refused', async () => {
    vi.mocked(request).mockResolvedValueOnce({ data: { done: 2, refused: [{ id: 3, why: 'c.lk: That customer is not one of this company’s.' }] }, offline: false, cachedAt: null, message: '2 changed, 1 not.' });
    const r = await bulk('domains', [1, 2, 3], { action: 'link', client_id: 5 });
    expect(request).toHaveBeenLastCalledWith('POST', '/api/hosting/bulk', { body: { kind: 'domains', ids: [1, 2, 3], action: 'link', client_id: 5 } });
    expect(bulkSummary(r)).toMatch(/2 changed, 1 not: c.lk/);
  });
  it('sends only the links that changed', () => {
    const d = { id: 1, name: 'a.lk', client_id: 2, project_id: null, server_id: 3, tags: ['x'], notes: 'n' };
    expect(changedLinks(d, { client_id: 2, project_id: 7, server_id: null, owner_user_id: null, tags: 'x, y', group: '', notes: 'n' })).toEqual({ project_id: 7, server_id: null, tags: ['x', 'y'] });
  });
  it('leaves a synced server’s provider-owned fields out of an edit', () => {
    const s = { id: 1, name: 'hz-1', source: 'sync' as const, kind: 'vps', status: 'active', ipv4: '1.2.3.4', notes: null, tags: [] };
    const f = { name: 'renamed', kind: 'vps', status: 'active', provider: '', ipv4: '9.9.9.9', ipv6: '', location: '', os: '', plan: '', cpu: '', ram: '', storage: '', expires_on: '2027-01-01', cost_amount: '', cost_currency: '', cost_period: 'monthly', notes: 'mine', tags: '', group: '', client_id: 4, project_id: null, owner_user_id: null };
    expect(serverChanges(f, s)).toEqual({ expires_on: '2027-01-01', notes: 'mine', client_id: 4 });
    expect(serverChanges({ ...f, cost_amount: '24.50', cost_currency: 'eur' }, undefined)).toMatchObject({ name: 'renamed', ipv4: '9.9.9.9', cost_amount: '24.50', cost_currency: 'EUR', cost_period: 'monthly' });
  });
  it('reads the import preview, its map in either PHP shape', async () => {
    expect(mapOf(['name', 'registrar'])).toEqual({ '0': 'name', '1': 'registrar' });
    expect(mapOf({ '0': 'name', '2': 'expires_on' })).toEqual({ '0': 'name', '2': 'expires_on' });
    vi.mocked(request).mockResolvedValueOnce({ data: { headers: ['Domain', 'Expiry'], map: ['name', 'expires_on'], fields: ['name', 'expires_on'], counts: { add: 14, update: 3, skip: 2, error: 1 }, rows: [{ line: 7, action: 'error', name: 'myedu', fields: {}, why: 'Not a domain name' }] }, offline: false, cachedAt: null });
    const p = await importPreview({ name: 'd.csv', text: 'Domain,Expiry\nmyedu,\n' }, 'domain', 3);
    expect(p.counts).toEqual({ add: 14, update: 3, skip: 2, error: 1 });
    expect(changes(p)).toBe(17);
    const [method, path, opts] = vi.mocked(request).mock.calls.at(-1)!;
    expect([method, path]).toEqual(['POST', '/api/hosting/import/preview']);
    const form = (opts as { body: FormData }).body;
    expect(form.get('kind')).toBe('domain');
    expect(form.get('org_id')).toBe('3');
    expect(form.get('file')).toBeInstanceOf(Blob);
    expect(fieldLabel('expires_on')).toBe('Expires on');
  });
  it('searches only whole domain names', () => {
    expect(searchable('example.lk')).toBe(true);
    expect(searchable('https://example.com/x')).toBe(true);
    expect(searchable('example')).toBe(false);
  });
  it('names an export as the server does and prints its page without its own script', () => {
    expect(fileNameOf('attachment; filename="hosting-domains-2026-10-26.xlsx"', 'domains', 'xlsx', '2026-10-26')).toBe('hosting-domains-2026-10-26.xlsx');
    expect(fileNameOf(null, 'renewals', 'csv', '2026-10-26')).toBe('hosting-renewals-2026-10-26.csv');
    expect(printable('<body onload="window.print()"><script>x()</script><p>a</p></body>')).toBe('<body><p>a</p></body>');
  });
});

describe('certificates, servers, domains', () => {
  it('says what is wrong with a certificate, the server’s words first', () => {
    expect(certProblem({ id: 1, host: 'mail.creativefx.lk', status: 'mismatch', sans: ['*.hostingprovider.net'] })).toMatch(/hostingprovider/);
    expect(certProblem({ id: 1, host: 'x', status: 'unreachable', problem: 'Connection refused on 993.' })).toBe('Connection refused on 993.');
    expect(certProblem({ id: 1, host: 'x', status: 'valid' })).toBeNull();
  });
  it('shows the server’s monthly totals per currency', () => {
    expect(monthlyTotals([{ currency: 'EUR', monthly: 214.6 }, { currency: 'USD', monthly: 71.08 }])).toMatch(/^EUR 214.60 \+ USD 71.08$/);
  });
  it('offers power actions only where the provider has server_actions', () => {
    expect(supports({ supports: ['servers', 'server_actions'] }, 'reboot')).toBe(true);
    expect(supports({ supports: [] }, 'reboot')).toBe(false);
  });
  it('thins a metrics series to bars', () => {
    const series = { cpu: Array.from({ length: 200 }, (_, i) => [i, i % 10] as [number, number]) };
    expect(seriesValues(series, 'cpu', 20)).toHaveLength(20);
    expect(seriesValues(series, 'network_in')).toEqual([]);
  });
  it('accepts a plausible domain name, IDN included', () => {
    expect(plausibleDomain('creativefx.lk')).toBe(true);
    expect(plausibleDomain('සිංහල.lk')).toBe(true);
    expect(plausibleDomain('not a domain')).toBe(false);
  });
  it('needs the exact server name to power off', () => {
    expect(confirmsName(' hz-fsn1-app-02 ', 'hz-fsn1-app-02')).toBe(true);
    expect(confirmsName('hz-fsn1-app-0', 'hz-fsn1-app-02')).toBe(false);
    expect(confirmsName('', '')).toBe(false);
  });
  it('syncs every account and counts what the server says failed', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ ok: true, added: 1 }).mockResolvedValueOnce({ ok: false, why: 'IP not allowed' }).mockRejectedValueOnce(new Error('down'));
    expect(await syncAll([1, 2, 3])).toEqual({ ok: 1, failed: 2 });
  });
});

describe('the Dock badge (HDM-DSK-04)', () => {
  it('adds Hosting’s count to what needs you', () => {
    expect(badgeCount({ mail: 0, chat: 1, notifications: 2, tasks: 0, hosting: 3 })).toBe(6);
    expect(badgeCount({ mail: 0, chat: 0, notifications: 0, tasks: 0 })).toBe(0);
  });
});

describe('typed power-off confirmation (D-04, SRV-04)', () => {
  const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
  it('keeps Power off disabled until the name is typed, then sends it', async () => {
    const onClose = vi.fn();
    vi.mocked(request).mockResolvedValueOnce({ data: { status: 'stopping', detail: [] }, offline: false, cachedAt: null, message: 'Powering off.' });
    render(wrap(<PowerDialog s={{ id: 5, name: 'hz-fsn1-app-02', provider_label: 'Hetzner', domains_list: [{ id: 1, name: 'tenderhub.lk' }] }} action="power_off" onClose={onClose} />));
    expect(screen.getByText(/tenderhub.lk stop answering/)).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Power off' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type the server name to confirm'), { target: { value: 'hz-fsn1-app-02' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/hosting/servers/5/actions', { body: { action: 'power_off', confirm: 'hz-fsn1-app-02' } }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('the Domains list: right-click and bulk (D-02, HDM-UI-04)', () => {
  const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
  const nav = { openDomain: vi.fn(), openServer: vi.fn(), to: vi.fn() };
  const rows = [
    { id: 1, org_id: 3, name: 'creativefx.lk', source: 'manual', days_left: 4, client: 'Internal' },
    { id: 2, org_id: 3, name: 'livezentech.com', source: 'sync', provider_label: 'Porkbun', days_left: 12 },
  ];
  beforeEach(() => {
    // jsdom draws nothing, so it has no scrolling into view.
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(apiGetMeta).mockImplementation(async (path: string) => {
      if (path === '/api/hosting/domains') return meta({ domains: rows, summary: { total: 2, expired: 0, within_7: 1, within_30: 2, renew_off_soon: 1 }, meta: listMeta(2) });
      if (path.startsWith('/api/hosting/domains/')) return meta({ ...rows[0], dns: copy() });
      return meta({});
    });
  });
  it('offers the D-02 actions on a right-click and ticks rows for a bulk change', async () => {
    const { default: Domains } = await import('../../../src/modules/hosting/Domains');
    render(wrap(<Domains org={0} nav={nav} active={false} expiring={false} filter="" companies={[{ id: 3, name: 'CreativeFX' }]} />));
    const row = await screen.findByText('livezentech.com');
    fireEvent.contextMenu(row);
    for (const label of ['Re-read DNS', 'Watch certificate', 'Add monitor…', 'Edit links…', 'Create renewal task']) expect(await screen.findByText(label)).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(screen.getByLabelText('Select creativefx.lk'));
    expect(await screen.findByText('1 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Link customer or project…' })).toBeTruthy();
  });
});
