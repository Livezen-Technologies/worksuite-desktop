import type { AccountsState, AccountView, UnsyncedSummary } from '@shared/accounts';
import { waitingSteps, type ConnectRun } from '@shared/discovery';
import type { AuthState, StatusSnapshot } from '@shared/types';

/** Accounts, runs and auth states for the Connection & Startup renderer tests (WP4). */

export const PERSONAL_ID = 'acc_personal000000000001';
export const LIVEZEN_ID = 'acc_livezen0000000000001';
export const ABC_ID = 'acc_abcclient00000000001';

export function account(extra: Partial<AccountView> = {}): AccountView {
  return {
    id: LIVEZEN_ID,
    kind: 'enterprise',
    serverOrigin: 'https://worksuite.livezentech.com',
    apiOrigin: 'https://worksuite.livezentech.com',
    serverId: '7d3c1d0e-1b1a-5c6d-9e8f-0a1b2c3d4e5f',
    serverName: 'Livezen WorkSuite',
    deployment: 'ENTERPRISE',
    organizationId: null,
    organizationName: 'Livezen Technologies',
    user: { id: 'u1', name: 'Hasarinda Manjula', email: 'hasarinda@livezentech.com', avatar: null },
    branding: { logo: null, accent: '#0B5FFF', initials: 'LT' },
    linkHosts: ['worksuite.livezentech.com'],
    managed: false,
    signInState: 'signed-in',
    addedAt: '2026-10-01T10:00:00Z',
    lastUsedAt: '2026-10-13T08:00:00Z',
    discoveredAt: '2026-10-13T08:00:00Z',
    signed: true,
    active: false,
    unread: 0,
    pendingChanges: 0,
    reachability: 'online',
    removable: true,
    removalReason: null,
    blockedReason: null,
    syncPaused: false,
    ...extra,
  };
}

export const personal = (extra: Partial<AccountView> = {}) =>
  account({
    id: PERSONAL_ID,
    kind: 'personal',
    serverOrigin: 'https://worksuitecloud.com',
    apiOrigin: 'https://worksuitecloud.com',
    serverName: 'WorkSuite Cloud',
    deployment: 'CLOUD',
    organizationName: "Hasarinda's Workspace",
    user: { id: 'p1', name: 'Hasarinda Manjula', email: 'hasarinda@email.com', avatar: null },
    branding: { logo: null, accent: '#0E7C86', initials: 'HM' },
    ...extra,
  });

export const abc = (extra: Partial<AccountView> = {}) =>
  account({
    id: ABC_ID,
    serverOrigin: 'https://worksuite.abc.com',
    apiOrigin: 'https://worksuite.abc.com',
    serverName: 'ABC WorkSuite',
    organizationName: 'ABC Client',
    branding: { logo: null, accent: '#7A2E8E', initials: 'AB' },
    signInState: 'signed-out',
    user: null,
    ...extra,
  });

export function accountsState(extra: Partial<AccountsState> = {}): AccountsState {
  return { accounts: [], activeId: null, switching: null, chooserPending: false, chooserAlways: false, allowPersonal: true, allowAddEnterprise: true, guestAvailable: true, ...extra };
}

export function auth(stage: AuthState['stage'], extra: Partial<AuthState> = {}): AuthState {
  return { stage, server: null, user: null, message: null, setupPending: false, ...extra };
}

export function run(extra: Partial<ConnectRun> = {}): ConnectRun {
  return { runId: 'run_12345678', input: 'worksuite.abc.com', target: 'enterprise', host: 'worksuite.abc.com', candidates: [], steps: waitingSteps(), state: 'running', server: null, failure: null, ...extra };
}

export function unsynced(extra: Partial<UnsyncedSummary> = {}): UnsyncedSummary {
  return {
    accountId: LIVEZEN_ID,
    items: [
      { id: 'q1', source: 'queue', module: 'tasks', label: 'Follow up SFCL tender clarifications', at: '2026-10-13T10:42:00' },
      { id: 'q2', source: 'queue', module: 'tasks', label: 'Mark "Website QA" done', at: '2026-10-13T10:44:00' },
      { id: 'q3', source: 'queue', module: 'calendar', label: 'Move "Client review" to Fri 15:00', at: '2026-10-13T11:05:00' },
      { id: 'o1', source: 'office', module: 'office', label: 'Proposal.docx — 1 local version', at: '2026-10-13T11:20:00' },
      { id: 'c1', source: 'queue', module: 'chat', label: '2 queued messages in #design', at: '2026-10-13T11:31:00', count: 2 },
    ],
    offlineFiles: { count: 3, bytes: 1024 },
    cachedBytes: 4096,
    ...extra,
  };
}

export function snapshot(extra: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    network: 'ONLINE',
    realtime: 'connected',
    pendingChanges: 0,
    unread: { mail: 0, chat: 0, notifications: 0, tasks: 0 },
    notificationsPausedUntil: null,
    services: {},
    locked: false,
    safeMode: false,
    realtimeDiagnostics: { attempt: 0, lastDisconnect: null },
    ...extra,
  } as StatusSnapshot;
}
