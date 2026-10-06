// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn(async () => []) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tab = { route: '/social-media' };
const openLink = vi.fn();
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { route: tab.route, query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: vi.fn(), navigate: vi.fn(), openInNewTab: vi.fn(), openInWindow: vi.fn(), active: true, openLink, setTitle: vi.fn(), tabId: 't1' };
  },
  useTabTitle: () => undefined,
}));

import { apiDelete, apiGet, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import Accounts from '../../../src/modules/social-media/admin/Accounts';
import PublishLog, { attemptsCsv, csvField } from '../../../src/modules/social-media/admin/PublishLog';
import Settings from '../../../src/modules/social-media/admin/Settings';
import { secretPlaceholder } from '../../../src/modules/social-media/admin/settings/ProviderApps';
import { log, socialAnswer } from './social-fixtures';

/** A01 Accounts, A02 Module settings and A03 Publishing log, against the design's sample server and today's. */

function mount(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const dataRows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1);

beforeEach(() => {
  app.set({ bootstrap: { permissions: ['*'] } as never });
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiGet).mockImplementation(socialAnswer(true) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiPut).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiDelete).mockReset().mockResolvedValue({} as never);
  tab.route = '/social-media';
});
afterEach(() => cleanup());

describe('A01 Accounts', () => {
  it('filters accounts by tab: Needs attention shows the expiring and the revoked one', async () => {
    mount(<Accounts />);
    expect(await screen.findByText('TechHubiz Sri Lanka')).toBeTruthy();
    expect(dataRows(screen.getByRole('table'))).toHaveLength(11);
    const attention = screen.getByRole('tab', { name: /Needs attention/ });
    expect(attention.textContent).toContain('(2)');
    // Six in the design; the fixture adds the Threads profile.
    expect(screen.getByRole('tab', { name: /TechHubiz/ }).textContent).toContain('(7)');
    fireEvent.click(attention);
    const rows = dataRows(screen.getByRole('table'));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('@techhubiz');
    expect(rows[0]!.textContent).toContain('Needs reconnect');
    expect(rows[1]!.textContent).toContain('@creativefx.studio');
    // ACC-012: the X quota (412 of 500) is past 80 %.
    expect(within(rows[0]!).getByRole('meter').getAttribute('aria-valuenow')).toBe('412');
    fireEvent.click(screen.getByRole('tab', { name: /CreativeFX/ }));
    expect(dataRows(screen.getByRole('table'))).toHaveLength(4);
  });

  it('cannot disconnect until a choice is made about future posts, then sends it', async () => {
    mount(<Accounts />);
    fireEvent.click(await screen.findByRole('button', { name: 'More for TechHubiz Sri Lanka' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Disconnect/ }));
    const dialog = await screen.findByRole('dialog');
    const go = within(dialog).getByRole('button', { name: 'Disconnect' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    expect(dialog.textContent).toMatch(/read-only/);
    expect(dialog.textContent).toMatch(/revokes its access token/);
    fireEvent.click(within(dialog).getByRole('radio', { name: /Hold its future posts/ }));
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/social-media/accounts/1', { future_posts: 'hold' }));
  });

  it('reconnects in the browser and waits for the person to finish', async () => {
    vi.mocked(apiPost).mockResolvedValue({ redirect_url: 'https://x.com/i/oauth2/authorize?state=1' } as never);
    const { call } = await import('../../../src/core/bridge');
    mount(<Accounts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social-media/accounts/4/reconnect', { client: 'desktop' }));
    expect(call).toHaveBeenCalledWith('app:openExternal', { url: 'https://x.com/i/oauth2/authorize?state=1' });
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/held posts resume afterwards/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'I’ve finished' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('A02 Module settings', () => {
  it('never draws a provider app secret, only when one was set', async () => {
    mount(<Settings section="providers" />);
    expect(await screen.findByText('Meta (Facebook, Instagram, Threads)')).toBeTruthy();
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    for (const i of inputs) expect(i.value).not.toMatch(/secret|•/i);
    const secrets = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
    expect(secrets).toHaveLength(4);
    for (const s of secrets) {
      expect(s.value).toBe('');
      expect(s.placeholder).toMatch(/set/);
    }
    expect(secrets[0]!.placeholder).toBe('•••••••••••• (set 12 Sep)');
    expect(secretPlaceholder({ has_secret: false, secret_set_at: null })).toBe('Not set');
  });

  it('sends a provider secret only when one was typed', async () => {
    mount(<Settings section="providers" />);
    const meta = await screen.findByRole('region', { name: 'Meta (Facebook, Instagram, Threads)' });
    fireEvent.change(meta.querySelector('input[type="password"]')!, { target: { value: 'new-secret' } });
    fireEvent.click(within(meta).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/social-media/settings/provider-apps/meta', expect.objectContaining({ secret: 'new-secret', mode: 'own' })));
    const x = screen.getByRole('region', { name: 'X' });
    fireEvent.change(within(x).getByRole('combobox', { name: 'Plan tier' }), { target: { value: 'Pro' } });
    fireEvent.click(within(x).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/social-media/settings/provider-apps/x', expect.objectContaining({ tier: 'Pro' })));
    const body = vi.mocked(apiPut).mock.calls.find((c) => c[0].endsWith('/x'))![1] as Record<string, unknown>;
    expect('secret' in body).toBe(false);
  });

  it('saves a section’s edits with Save changes', async () => {
    mount(<Settings section="publishing" />);
    const save = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
    const gap = await screen.findByRole('textbox', { name: 'Minimum gap between posts on one account' });
    expect((gap as HTMLInputElement).value).toBe('90');
    expect(save.disabled).toBe(true);
    // General's keys are not drawn under Publishing.
    expect(screen.queryByText('Default brand')).toBeNull();
    fireEvent.change(gap, { target: { value: '120' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/social-media/settings/publishing', { values: { min_gap_minutes: 120 } }));
  });

  it('pauses all publishing only with a reason', async () => {
    mount(<Settings section="advanced" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause all publishing' }));
    const dialog = await screen.findByRole('dialog');
    const go = within(dialog).getByRole('button', { name: 'Pause everything' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Brand crisis' } });
    fireEvent.click(go);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social-media/pause-all', { paused: true, reason: 'Brand crisis' }));
  });

  it('opens roles in Admin Center from Permissions', async () => {
    mount(<Settings section="permissions" />);
    expect(await screen.findByText('social.settings.manage')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit roles in Admin Center' }));
    expect(openLink).toHaveBeenCalledWith('/admin/roles');
  });
});

describe('A03 Publishing log', () => {
  it('asks the server for failed attempts on the Failed tab, and honours ?outcome=failed', async () => {
    mount(<PublishLog />);
    expect(await screen.findByText('Tip: Mail rules that save an hour a week')).toBeTruthy();
    expect(screen.getByText('97.2%')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Failed/ }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/social-media/log', { outcome: 'failed' }, expect.anything()));
    cleanup();
    vi.mocked(apiGet).mockClear();
    tab.route = '/social-media/log?outcome=failed';
    mount(<PublishLog />);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/social-media/log', { outcome: 'failed' }, expect.anything()));
    expect(screen.getByRole('tab', { name: /Failed/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('marks a manual reminder as posted', async () => {
    mount(<PublishLog />);
    expect(await screen.findByText('Reminder sent to Imesha F.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reconnect & retry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as posted' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark as posted' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social-media/targets/21/mark-posted', { permalink: null }));
  });

  it('builds CSV that escapes commas, quotes and line breaks', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a, b')).toBe('"a, b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvField('@techhubiz.lk')).toBe('@techhubiz.lk');
    const csv = attemptsCsv([{ ...log.attempts[0]!, post_excerpt: 'Tip: "Mail", rules' }]);
    const [head, row] = csv.split('\r\n');
    expect(head).toBe('Time (UTC),Account,Network,Post,Result,Error class,Provider code,Attempts,Permalink');
    expect(row).toBe('2026-10-03T05:30:02.000Z,@techhubiz,X,"Tip: ""Mail"", rules",Failed,auth_revoked,,3/3,');
  });
});

describe('on today’s server', () => {
  for (const [name, ui] of [
    ['Accounts', <Accounts key="a" />],
    ['Module settings · General', <Settings key="g" section={null} />],
    ['Module settings · Provider apps', <Settings key="p" section="providers" />],
    ['Module settings · Advanced', <Settings key="v" section="advanced" />],
    ['Publishing log', <PublishLog key="l" />],
  ] as const) {
    it(`${name} says the module is not offered, chrome intact`, async () => {
      vi.mocked(apiGet).mockImplementation(socialAnswer(false) as never);
      mount(ui);
      expect((await screen.findAllByText(/isn’t offered by this WorkSuite server/)).length).toBeGreaterThan(0);
      expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    });
  }
});
