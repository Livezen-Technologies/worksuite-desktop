// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap, DeviceInfo, Preferences, UpdateDiagnostics, UpdateStatus } from '../../../shared/types';

/**
 * The Updates & License screens: Update available, the mandatory banner and Modules locked, Settings › Updates with
 * its download, pipeline and Update Failed panel, Diagnostics, What's New after updating, the critical modal, and
 * Settings › License.
 */

const handlers = vi.hoisted(() => new Map<string, (input?: unknown) => unknown>());
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async (channel: string, input?: unknown) => (handlers.has(channel) ? handlers.get(channel)!(input) : undefined)),
  on: () => () => undefined,
  hasDesktop: () => true,
  errorMessage: (e: unknown) => String((e as Error)?.message ?? e),
  isMac: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/tabs', () => ({ navigate: nav.navigate }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: vi.fn(), go: vi.fn(), query: new URLSearchParams(), path: ['settings', 'updates'] }), useTabTitle: () => undefined }));

const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { UpdateDialogs, UpdateAvailableDialog, WhatsNewCard, CriticalUpdateModal } = await import('../../../src/app/screens/UpdateDialogs');
const { MandatoryBanner, ModulesLocked } = await import('../../../src/app/screens/MandatoryUpdate');
const { UpdatesPage, UpdateDiagnosticsPage, checkLine } = await import('../../../src/modules/settings/UpdatesPage');
const { LicensePage, entitlements, shortId, storageLabel } = await import('../../../src/modules/settings/LicensePage');

const mocked = call as unknown as ReturnType<typeof vi.fn>;

function status(over: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    state: 'IDLE',
    channel: 'stable',
    currentVersion: '2.6.1',
    availableVersion: null,
    minimumVersion: null,
    required: false,
    critical: false,
    progress: 0,
    error: null,
    lastCheckedAt: null,
    deadline: null,
    signatureVerified: true,
    notesUrl: null,
    installSupported: true,
    installBlockedReason: null,
    allowedChannels: ['stable', 'beta', 'dev'],
    channelLockReason: null,
    snoozedUntil: null,
    quietReason: null,
    ...over,
  };
}

const offer = (over: Partial<UpdateStatus> = {}) =>
  status({
    state: 'AVAILABLE',
    availableVersion: '2.7.0',
    notes: { version: '2.7.0', summary: null, highlights: ['Faster Mail loading and folder caching', 'Improved Desktop File Sync'], url: 'https://notes.example/2.7.0' },
    release: { buildNumber: 27001, publishedAt: '2026-09-24T08:00:00Z', releaseType: 'RECOMMENDED', channel: 'stable', packageType: 'exe', packageSize: 320 * 1024 * 1024, keyId: 'ws-uc-resp-1', publisher: 'The certificate holder', securityFixes: 1, knownIssues: [] },
    ...over,
  });

function wrap(node: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  handlers.clear();
  mocked.mockClear();
  nav.navigate.mockReset();
  app.set({
    update: null,
    prefs: { autoUpdate: false, updateNotifications: true, updateInstallOnQuit: true, updateShowWhatsNew: true, updateChannel: 'stable' } as unknown as Preferences,
    locks: [],
    info: { platform: 'windows', arch: 'x64' } as never,
    bootstrap: null,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('WorkSuite Update Available', () => {
  it('shows the badges, version and build, what is new, the package and who signed it', () => {
    wrap(<UpdateAvailableDialog u={offer()} onClose={() => undefined} onInstalled={() => undefined} />);
    const d = screen.getByRole('dialog', { name: 'WorkSuite Update Available' });
    expect(d.textContent).toContain('RECOMMENDED');
    expect(d.textContent).toContain('STABLE');
    expect(d.textContent).toContain('Version 2.7.0 · build 27001 · you have 2.6.1');
    expect(within(d).getByText('Improved Desktop File Sync')).toBeTruthy();
    expect(d.textContent).toContain('Windows x64 · EXE · 320 MB');
    expect(d.textContent).toContain('Signed by The certificate holder');
    fireEvent.click(within(d).getByRole('button', { name: 'View release notes' }));
    expect(mocked).toHaveBeenCalledWith('app:openExternal', { url: 'https://notes.example/2.7.0' });
  });

  it('opens by itself when downloads wait for the person; Download & Install downloads and keeps install-on-restart', async () => {
    app.set({ update: offer() });
    handlers.set('updates:download', () => offer({ state: 'STAGED', progress: 100 }));
    wrap(<UpdateDialogs />);
    const d = await screen.findByRole('dialog', { name: 'WorkSuite Update Available' });
    expect((within(d).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(d).getByRole('button', { name: 'Download & Install' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:download'));
    expect(mocked).not.toHaveBeenCalledWith('updates:installNow', expect.anything());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'WorkSuite Update Available' })).toBeNull());
  });

  it('unticked, restarts once the download is ready', async () => {
    app.set({ update: offer() });
    handlers.set('updates:download', () => offer({ state: 'STAGED', progress: 100 }));
    handlers.set('updates:installNow', () => ({ started: true, busy: null, message: null }));
    wrap(<UpdateDialogs />);
    const d = await screen.findByRole('dialog', { name: 'WorkSuite Update Available' });
    fireEvent.click(within(d).getByRole('checkbox'));
    fireEvent.click(within(d).getByRole('button', { name: 'Download & Install' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:installNow', { force: false }));
  });

  it('Later offers 1 hour, 4 hours and Tomorrow; it does not open by itself when downloads are automatic', async () => {
    app.set({ update: offer() });
    wrap(<UpdateDialogs />);
    fireEvent.click(await screen.findByRole('button', { name: /^Later/ }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['1 hour', '4 hours', 'Tomorrow']);
    cleanup();
    app.set({ update: offer(), prefs: { autoUpdate: true } as Preferences });
    wrap(<UpdateDialogs />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('a mandatory update', () => {
  const mandatory = (deadline: string, over = {}) => ({ reason: 'minimum' as const, requiredVersion: '2.5.0', since: '2026-09-26T18:00:00Z', deadline, serverRejected: false, maxDeferrals: 3, ...over });

  it('a banner with the time left, Remind Me Later (past-deadline choices greyed) and the deferrals left, and a countdown card', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 27, 15, 45, 23));
    app.set({ update: offer({ state: 'STAGED', required: true, minimumVersion: '2.5.0', postponed: 1, mandatory: mandatory(new Date(2026, 8, 27, 18, 0, 0).toISOString()) }) });
    wrap(<MandatoryBanner />);
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('Update required within 2 h 14 m.');
    expect(banner.textContent).toContain('WorkSuite 2.7.0 must be installed by');
    expect(banner.textContent).toContain('After that, modules are locked until you update.');
    expect(screen.getByRole('timer').textContent).toBe('02:14:37');
    expect(screen.getByRole('region', { name: 'Mandatory update countdown' }).textContent).toContain('Package downloaded and verified · 320 MB');
    fireEvent.click(within(banner).getByRole('button', { name: /Remind Me Later/ }));
    const items = await screen.findAllByRole('menuitem');
    const by = (name: string) => items.find((i) => i.textContent?.startsWith(name))!;
    expect(by('1 hour').getAttribute('aria-disabled')).not.toBe('true');
    expect(by('4 hours').getAttribute('aria-disabled')).toBe('true');
    expect(by('4 hours').textContent).toContain('past deadline');
    expect(by('Tomorrow').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('2 of 3 deferrals left')).toBeTruthy();
  });

  it('after the deadline, modules are locked: CURRENT / REQUIRED / LATEST, what is saved, and what is still available', async () => {
    handlers.set('updates:busy', () => ({ uploads: 0, downloads: 0, pendingMutations: 14, drafts: 3, activeCall: false }));
    handlers.set('updates:installNow', () => ({ started: true, busy: null, message: null }));
    app.set({ update: offer({ state: 'STAGED', currentVersion: '2.4.8', required: true, minimumVersion: '2.5.0', mandatory: mandatory('2026-09-27T18:00:00Z') }) });
    wrap(<ModulesLocked />);
    expect(screen.getByRole('heading', { name: 'WorkSuite Update Required' })).toBeTruthy();
    expect(screen.getByText(/The mandatory deadline passed on/)).toBeTruthy();
    expect(screen.getByText('2.4.8')).toBeTruthy();
    expect(screen.getByText('≥ 2.5.0')).toBeTruthy();
    expect(await screen.findByText('✓ Your 3 drafts and 14 offline changes are saved and will sync after the update.')).toBeTruthy();
    const still = screen.getByRole('complementary', { name: 'Still available' });
    expect(within(still).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Update Center', 'Diagnostics', 'License', 'Sign Out']);
    fireEvent.click(screen.getByRole('button', { name: 'Update & Restart' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:installNow', { force: true }));
  });

  it('the server refusing this version says UPDATE_REQUIRED, and Update Center opens Settings › Updates in place', async () => {
    handlers.set('updates:busy', () => ({ uploads: 0, downloads: 0, pendingMutations: 0, drafts: 0, activeCall: false }));
    app.set({ update: status({ required: true, mandatory: mandatory('2026-12-01T00:00:00Z', { reason: 'server', serverRejected: true }) }) });
    wrap(<ModulesLocked />);
    expect(screen.getByText('UPDATE_REQUIRED')).toBeTruthy();
    expect(screen.getByText(/The server no longer accepts this version\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update Center' }));
    expect(await screen.findByRole('heading', { name: 'Updates' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'WorkSuite Update Required' })).toBeTruthy();
  });
});

describe('Settings › Updates', () => {
  it('shows the status, four tiles, the download with Pause and Cancel, and the pipeline', async () => {
    app.set({
      update: offer({
        state: 'DOWNLOADING',
        progress: 58,
        minimumVersion: '2.5.0',
        download: { received: 184 * 1024 * 1024, total: 320 * 1024 * 1024, bytesPerSecond: 6.4 * 1024 * 1024, secondsLeft: 21, paused: false, retrying: false, resumable: true },
        pipeline: [
          { id: 'manifest', state: 'done', detail: 'Ed25519 signature valid · key ws-uc-resp-1' },
          { id: 'download', state: 'active', detail: 'Resumable · 58%' },
          { id: 'sha256', state: 'pending', detail: 'Pending' },
          { id: 'codesign', state: 'pending', detail: 'Pending' },
          { id: 'stage', state: 'pending', detail: 'Pending' },
        ],
      }),
      bootstrap: { policy: { auto_update: 'enforced' } } as Bootstrap,
    });
    handlers.set('updates:pauseDownload', () => offer({ state: 'DOWNLOADING', download: { received: 1, total: 2, bytesPerSecond: 0, secondsLeft: null, paused: true, retrying: false, resumable: true } }));
    wrap(<UpdatesPage />);
    expect(screen.getByText('DOWNLOADING 58%')).toBeTruthy();
    expect(screen.getByText(/^Recommended · .*2026$/)).toBeTruthy();
    expect(screen.getByText('Set by organization policy')).toBeTruthy();
    expect(screen.getByText('You are supported')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Download progress' }).getAttribute('aria-valuenow')).toBe('58');
    expect(screen.getByText('184 MB / 320 MB')).toBeTruthy();
    expect(screen.getByText('6.4 MB/s · about 21 s left · resumes after network loss')).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'Manifest: done' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'Download: active' })).toBeTruthy();
    expect(screen.getByText('Security: 1 fix · Known issues: none')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:pauseDownload'));
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('saves the preferences, the download switch locked by policy', async () => {
    app.set({ update: status(), locks: [{ key: 'autoUpdate', reason: 'Your organization keeps WorkSuite up to date automatically.' }] });
    handlers.set('settings:set', (p) => ({ preferences: { ...app.get().prefs, ...(p as object) }, locks: app.get().locks }));
    wrap(<UpdatesPage />);
    const auto = screen.getByRole('checkbox', { name: 'Download updates automatically' }) as HTMLInputElement;
    expect(auto.checked).toBe(true);
    expect(auto.disabled).toBe(true);
    expect(screen.getByText('(policy)')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Install automatically when idle 02:00–04:00' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('settings:set', { updateInstallWhenIdle: true }));
    fireEvent.click(screen.getByRole('checkbox', { name: "Show What's New after updating" }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('settings:set', { updateShowWhatsNew: false }));
  });

  it('says when it last checked and when it checks next', () => {
    const now = new Date(2026, 8, 27, 9, 12);
    expect(checkLine(status({ lastCheckedAt: new Date(2026, 8, 27, 9, 12).toISOString(), nextCheckAt: new Date(2026, 8, 27, 15, 0).toISOString() }), now)).toBe('Last checked today 09:12 · next check in 5 h 48 m');
    expect(checkLine(status(), now)).toBe('Not checked yet');
  });

  it('Update Failed: the code, rollback state and reference, Retry and Copy details', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    app.set({
      update: status({
        failure: { code: 'UPDATE_INSTALL_FAILED', message: 'WorkSuite 2.7.0 did not start, so the previous version was put back.', version: '2.7.0', rollback: 'ok', ref: 'UA-7F3C-21', at: '2026-09-27T09:40:00Z' },
      }),
    });
    handlers.set('updates:check', () => status());
    wrap(<UpdatesPage />);
    const panel = screen.getByRole('alert', { name: 'Update Failed' });
    expect(panel.textContent).toContain('Error UPDATE_INSTALL_FAILED · rollback OK · ref UA-7F3C-21');
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy details' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('ref UA-7F3C-21')));
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:check'));
  });
});

describe('Settings › Updates › Diagnostics', () => {
  const result: UpdateDiagnostics = {
    ranAt: '2026-09-27T09:41:00Z',
    checks: [
      { id: 'service', label: 'Update service reachable', status: 'pass', detail: 'download.worksuitecloud.com · 84 ms' },
      { id: 'disk', label: 'Disk space', status: 'low', detail: '1.5 GB free — 640 MB needed', fix: 'Free at least 114 MB of disk space, then select Retry.' },
      { id: 'database', label: 'Local database', status: 'pass', detail: 'Integrity check passed · schema 43' },
    ],
  };

  it('runs the checks, shows Pass / Low / Fail, the suggested fix, and exports the report', async () => {
    app.set({ update: status() });
    handlers.set('updates:diagnostics', () => result);
    handlers.set('updates:exportDiagnostics', () => '/tmp/report.txt');
    wrap(<UpdateDiagnosticsPage />);
    expect(await screen.findByText('download.worksuitecloud.com · 84 ms')).toBeTruthy();
    expect(screen.getByRole('row', { name: /Disk space/ }).textContent).toContain('Low');
    expect(screen.getByText('Free at least 114 MB of disk space, then select Retry.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:exportDiagnostics', { report: expect.stringContaining('LOW   Disk space') }));
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    await waitFor(() => expect(mocked.mock.calls.filter(([c]) => c === 'updates:diagnostics').length).toBe(2));
  });

  it('a package repository check that fails has Fix, which rewrites it and runs the checks again (worksuite-desktop#351)', async () => {
    app.set({ update: status() });
    handlers.set('updates:diagnostics', () => ({
      ranAt: '2026-10-13T09:41:00Z',
      checks: [
        { id: 'repo-file', label: 'Package repository', status: 'fail', detail: '/etc/apt/sources.list.d/worksuite.sources follows stable, the channel is Beta', action: 'fix-repo' },
        { id: 'repo-key', label: 'Repository signing key', status: 'pass', detail: '/usr/share/keyrings/worksuite.gpg', action: 'fix-repo' },
        { id: 'repo-version', label: 'Repository version', status: 'skip', detail: 'Not set up yet' },
      ],
    }));
    handlers.set('updates:fixRepo', () => ({ ok: true, message: 'The WorkSuite package source follows beta.' }));
    wrap(<UpdateDiagnosticsPage />);
    await screen.findByText(/follows stable, the channel is Beta/);
    expect(screen.queryByRole('button', { name: 'Fix: Repository signing key' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fix: Repository version' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fix: Package repository' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:fixRepo'));
    await waitFor(() => expect(mocked.mock.calls.filter(([c]) => c === 'updates:diagnostics').length).toBe(2));
  });
});

describe('after updating, and a critical release', () => {
  it("shows What's New in X once, with the local steps, until Got It", () => {
    const onClose = vi.fn();
    const u = status({ currentVersion: '2.7.0', justUpdated: { version: '2.7.0', notesUrl: 'https://notes.example/2.7.0' }, justUpdatedNotes: { highlights: ['Faster Mail'], summary: null, schema: { from: 41, to: 43 } } });
    wrap(<WhatsNewCard u={u} onClose={onClose} />);
    const d = screen.getByRole('dialog', { name: "What's New in WorkSuite 2.7.0" });
    expect(d.textContent).toContain('Update completed successfully');
    expect(d.textContent).toContain('Local database updated (schema 41 → 43)');
    fireEvent.click(within(d).getByRole('button', { name: 'Got It' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('a critical update lists what was saved and counts down the grace period', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T15:45:00Z'));
    const onInstall = vi.fn();
    const u = status({ state: 'STAGED', availableVersion: '2.7.1', quietReason: 'a meeting', immediate: { version: '2.7.1', graceMinutes: 5, graceEndsAt: '2026-09-27T15:49:59Z', saved: { flushed: true, drafts: 1, pendingMutations: 14 } } });
    wrap(<CriticalUpdateModal u={u} onInstall={onInstall} installing={false} />);
    const d = screen.getByRole('dialog', { name: 'Critical Security Update' });
    expect(d.textContent).toContain('must be updated immediately to 2.7.1');
    expect(d.textContent).toContain('14 offline changes kept in the offline queue');
    expect(d.textContent).toContain('A meeting will end in 04:59');
    expect(d.textContent).toContain('Grace: 5 minutes');
    fireEvent.click(within(d).getByRole('button', { name: 'Update & Restart' }));
    expect(onInstall).toHaveBeenCalled();
  });
});

describe('Settings › License', () => {
  const boot = {
    organizations: [{ id: '1', name: 'Acme Ltd' }],
    defaultOrganizationId: '1',
    apps: ['mail', 'chat'],
    entitlements: { mail: true, chat: true },
    cachedAt: new Date(Date.now() - 27 * 86_400_000).toISOString(),
    offline: true,
    policy: { signed: false, wipe_on_revoke: 'tokens' },
  } as unknown as Bootstrap;
  const device = { id: 'dev_01J8ABCDEFG4QX', name: 'MBP-OFFICE', secureStorage: { available: true, backend: 'keychain', persistent: true } } as DeviceInfo;

  it('shows what the app knows, and marks what needs a server license', async () => {
    app.set({ bootstrap: boot, organizationId: null });
    handlers.set('security:deviceInfo', () => device);
    handlers.set('session:refresh', () => boot);
    wrap(<LicensePage />);
    expect(screen.getByText('UNKNOWN · CACHED')).toBeTruthy();
    expect(screen.getByText(/Unknown — last verified unknown/)).toBeTruthy();
    expect(screen.getByText('Acme Ltd')).toBeTruthy();
    expect(await screen.findByText('dev_01J…4QX')).toBeTruthy();
    expect(screen.getByText('macOS Keychain')).toBeTruthy();
    expect(screen.getAllByText('Needs server')).toHaveLength(5);
    expect(screen.getByText(/Your data is safe\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh License' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('session:refresh'));
    await act(async () => undefined);
  });

  it('shows current server details and updates an open panel after a refreshed bootstrap', async () => {
    handlers.set('security:deviceInfo', () => device);
    app.set({ bootstrap: { ...boot, license: { status: 'ACTIVE', edition: 'Enterprise', keyMasked: 'WS-****-1234', expiresAt: '2027-10-19T00:00:00Z', lastValidatedAt: '2026-10-19T00:00:00Z', graceDays: 7, graceEndsAt: null, maxActivations: 2 } } });
    wrap(<LicensePage />);
    expect(screen.getByText('Enterprise')).toBeTruthy();
    expect(screen.getByText('WS-****-1234')).toBeTruthy();
    expect(screen.getByText('2 server installations')).toBeTruthy();
    expect(screen.getByText('7 days (server license)')).toBeTruthy();
    expect(screen.queryByText('Needs server')).toBeNull();
    handlers.set('session:refresh', () => {
      const next = { ...app.get().bootstrap!, license: { ...app.get().bootstrap!.license!, status: 'RESTRICTED', edition: 'Business' } };
      app.set({ bootstrap: next });
      return next;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh License' }));
    expect(await screen.findByText('RESTRICTED · CACHED')).toBeTruthy();
    expect(screen.getByText('Business')).toBeTruthy();
    expect(screen.queryByText('Enterprise')).toBeNull();
  });

  it('lists entitlements from the sign-in, and says where the token is kept', () => {
    const list = entitlements({ entitlements: { mail: true }, apps: ['mail'] });
    expect(list.find((e) => e.id === 'mail')).toMatchObject({ enabled: true });
    expect(list.filter((e) => e.enabled)).toHaveLength(1);
    expect(shortId('dev_01J8ABCDEFG4QX')).toBe('dev_01J…4QX');
    expect(shortId(null)).toBe('not registered');
    expect(storageLabel({ secureStorage: { available: false, backend: 'basic_text', persistent: false } })).toBe('Memory only — not saved on this computer');
    expect(storageLabel({ secureStorage: { available: true, backend: 'dpapi', persistent: true } })).toBe('Windows DPAPI');
  });
});
