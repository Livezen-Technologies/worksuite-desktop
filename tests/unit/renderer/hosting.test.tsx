// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => true), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<object>()), apiGetMeta: vi.fn(), apiPost: vi.fn(async () => ({})), apiPut: vi.fn(async () => ({})), apiDelete: vi.fn(async () => ({})) }));

import { apiGetMeta, apiPost } from '../../../src/core/api';
import { asOf, confirmsName, daysLeft, fetchDomain, fetchDomains, fetchOverview, orNull, pageOf, recordProblem, urgency } from '../../../src/modules/hosting/api';
import { toBind } from '../../../src/modules/hosting/DnsEditor';
import { moveIndex } from '../../../src/modules/hosting/Domains';
import { certProblem } from '../../../src/modules/hosting/Certificates';
import { monthlyTotals, PowerDialog } from '../../../src/modules/hosting/Servers';
import { plausibleDomain } from '../../../src/modules/hosting/AddDomain';
import { syncAll } from '../../../src/modules/hosting/HostingShell';
import { RAIL } from '../../../src/modules/hosting/Rail';
import { APP_CATALOGUE } from '../../../shared/apps';
import { appColour } from '../../../src/core/app-look';
import { allowedModules } from '../../../src/modules/registry';

const notFound = Object.assign(new Error('nf'), { status: 404 });
const meta = <T,>(data: T, extra: Partial<{ offline: boolean; cachedAt: string | null; meta: unknown }> = {}) => ({ data, offline: false, cachedAt: null, ...extra });

afterEach(() => cleanup());

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
  it('rails the ten screens of HDM-DSK-02 in order', () => {
    expect(RAIL.map((r) => r.label)).toEqual(['Overview', 'Domains', 'Expiring', 'DNS', 'Certificates', 'Servers', 'Monitors', 'Costs', 'Accounts', 'Sync history']);
  });
});

describe('the API client', () => {
  it('reads lists in every shape the server sends', () => {
    expect(pageOf([{ id: 1 }], null, 'domains')).toMatchObject({ items: [{ id: 1 }], total: 1 });
    expect(pageOf({ domains: [{ id: 1 }, { id: 2 }], total: 48, page: 2, per_page: 2 }, null, 'domains')).toMatchObject({ total: 48, page: 2 });
    expect(pageOf({ data: [{ id: 3 }] }, { total: 9, current_page: 3 }, 'domains')).toMatchObject({ items: [{ id: 3 }], total: 9, page: 3 });
  });
  it('turns a route a server does not have into null — "needs a server update"', async () => {
    expect(await orNull(Promise.reject(notFound))).toBeNull();
    await expect(orNull(Promise.reject(Object.assign(new Error('x'), { status: 500 })))).rejects.toThrow('x');
    vi.mocked(apiGetMeta).mockRejectedValueOnce(notFound);
    expect(await fetchOverview(0)).toBeNull();
  });
  it('falls back to the list for one domain on an older server', async () => {
    vi.mocked(apiGetMeta).mockRejectedValueOnce(notFound).mockResolvedValueOnce(meta({ domains: [{ id: 7, name: 'livezentech.com' }] }));
    expect(await fetchDomain(7)).toMatchObject({ name: 'livezentech.com' });
  });
  it('remembers when the offline copy was saved (HDM-DSK-05)', async () => {
    asOf.set({ at: null });
    vi.mocked(apiGetMeta).mockResolvedValueOnce(meta([], { offline: true, cachedAt: '2026-10-26T09:12:00Z' }));
    await fetchDomains({});
    expect(asOf.get().at).toBe('2026-10-26T09:12:00Z');
    vi.mocked(apiGetMeta).mockResolvedValueOnce(meta([], { offline: true, cachedAt: '2026-10-26T10:00:00Z' }));
    await fetchDomains({});
    expect(asOf.get().at).toBe('2026-10-26T09:12:00Z');
  });
  it('sends the list filters the server knows and leaves empty ones out', async () => {
    vi.mocked(apiGetMeta).mockResolvedValueOnce(meta([]));
    await fetchDomains({ q: 'lk', expires_within: 30, org: 0, status: '' });
    expect(apiGetMeta).toHaveBeenLastCalledWith('/api/hosting/domains', { q: 'lk', expires_within: 30 }, undefined);
  });
});

describe('days left and urgency (D-01, D-02)', () => {
  it('prefers the server’s days and colours them', () => {
    expect(daysLeft({ days_left: 4, expires_on: '2030-01-01' })).toBe(4);
    expect(daysLeft({ expires_on: '2026-11-07' }, new Date('2026-10-26T12:00:00Z'))).toBe(12);
    expect([urgency(4), urgency(12), urgency(41), urgency(240), urgency(null)]).toEqual(['red', 'amber', 'grey', 'green', 'grey']);
  });
});

describe('the DNS record form (HDM-DNS-03)', () => {
  it('checks each type', () => {
    expect(recordProblem({ type: 'A', name: 'www', content: '203.0.113.10', ttl: 600 })).toBeNull();
    expect(recordProblem({ type: 'A', name: 'www', content: '203.0.113.300', ttl: 600 })).toMatch(/IPv4/);
    expect(recordProblem({ type: 'AAAA', name: '@', content: '2001:db8:10::1', ttl: 600 })).toBeNull();
    expect(recordProblem({ type: 'MX', name: '@', content: 'mx1.example.com', ttl: 3600, priority: null })).toMatch(/priority/);
    expect(recordProblem({ type: 'CNAME', name: '@', content: 'x.example.com', ttl: 600 })).toMatch(/apex/);
    expect(recordProblem({ type: 'A', name: 'www', content: '1.2.3.4', ttl: 5 })).toMatch(/TTL/);
    expect(recordProblem({ type: 'CAA', name: '@', content: '0 issue "letsencrypt.org"', ttl: 3600 })).toBeNull();
  });
  it('keeps a CNAME alone on its host', () => {
    const others = [{ id: 1, type: 'A', name: 'portal', content: '1.2.3.4' }];
    expect(recordProblem({ type: 'CNAME', name: 'portal', content: 'portal.worksuitecloud.com', ttl: 3600 }, others)).toMatch(/only record/);
    expect(recordProblem({ type: 'TXT', name: 'www', content: 'x' }, [{ id: 2, type: 'CNAME', name: 'www', content: 'a.b' }])).toMatch(/has a CNAME/);
  });
  it('exports the copy as a BIND zone', () => {
    const z = toBind('livezentech.com', [
      { id: 1, type: 'A', name: '@', content: '203.0.113.10', ttl: 600 },
      { id: 2, type: 'MX', name: '@', content: 'mx1.livezentech.com', ttl: 3600, priority: 10 },
      { id: 3, type: 'TXT', name: 'www.livezentech.com', content: 'v=spf1 mx ~all', ttl: 3600 },
    ]);
    expect(z).toContain('$ORIGIN livezentech.com.');
    expect(z).toContain('@\t3600\tIN\tMX\t10 mx1.livezentech.com');
    expect(z).toContain('www\t3600\tIN\tTXT\t"v=spf1 mx ~all"');
  });
});

describe('keyboard list (D-02)', () => {
  it('moves within bounds', () => {
    expect(moveIndex('ArrowDown', 0, 3)).toBe(1);
    expect(moveIndex('ArrowDown', 2, 3)).toBe(2);
    expect(moveIndex('ArrowUp', 0, 3)).toBe(0);
    expect(moveIndex('End', 0, 3)).toBe(2);
    expect(moveIndex('a', 0, 3)).toBeNull();
    expect(moveIndex('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('certificates, servers, domains', () => {
  it('says what is wrong with a certificate', () => {
    expect(certProblem({ id: 1, host: 'mail.creativefx.lk', status: 'mismatch', sans: ['*.hostingprovider.net'] })).toMatch(/hostingprovider/);
    expect(certProblem({ id: 1, host: 'x', status: 'valid' })).toBeNull();
  });
  it('sums the server’s monthly figures per currency', () => {
    expect(monthlyTotals([{ monthly: '100.10', cost_currency: 'EUR' }, { monthly: '114.50', cost_currency: 'EUR' }, { monthly: '71.08', cost_currency: 'USD' }, { monthly: null, cost_currency: 'LKR' }])).toBe('EUR 214.60 + USD 71.08');
  });
  it('accepts a plausible domain name, IDN included', () => {
    expect(plausibleDomain('creativefx.lk')).toBe(true);
    expect(plausibleDomain('සිංහල.lk')).toBe(true);
    expect(plausibleDomain('not a domain')).toBe(false);
  });
  it('needs the exact server name to power off', () => {
    expect(confirmsName(' hz-fsn1-app-02 ', 'hz-fsn1-app-02')).toBe(true);
    expect(confirmsName('hz-fsn1-app-0', 'hz-fsn1-app-02')).toBe(false);
  });
  it('syncs every account and counts failures', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('IP not allowed'));
    expect(await syncAll([1, 2])).toEqual({ ok: 1, failed: 1 });
  });
});

describe('typed power-off confirmation (D-04, SRV-04)', () => {
  const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
  it('keeps Power off disabled until the name is typed, then sends it', async () => {
    const onClose = vi.fn();
    render(wrap(<PowerDialog s={{ id: 5, name: 'hz-fsn1-app-02', provider: 'Hetzner', domains: [{ id: 1, name: 'tenderhub.lk' }] }} action="power_off" onClose={onClose} />));
    expect(screen.getByText(/tenderhub.lk stop answering/)).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Power off' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type the server name to confirm'), { target: { value: 'hz-fsn1-app-02' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/hosting/servers/5/actions', { action: 'power_off', confirm: 'hz-fsn1-app-02' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
