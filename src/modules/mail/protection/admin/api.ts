import { useQuery } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut, apiUrl, request } from '../../../../core/api';
import { call } from '../../../../core/bridge';
import type {
  AdminQuarantineDetail,
  AdminQuarantinePage,
  AttachmentsAnswer,
  EnginesAnswer,
  ListEntry,
  Policy,
  PolicyPreview,
  PolicySettings,
  PolicyVersion,
  ProtectionOverview,
  ReportsAnswer,
  SearchRemovePreview,
  SearchRemoveQuery,
  SearchRemoveRun,
  SelfTest,
} from '../types';

/**
 * Admin Center › Mail & Communication › Protection: the organisation's side of the protection API (ENH-MAIL-04 §7.2),
 * `/api/admin/mail/protection/…` and `/api/admin/mail/quarantine/…`. Online only: nothing here is queued, and the
 * server checks every permission again (mail.security.view / .manage, mail.quarantine.release / .view_content /
 * .purge). MALWARE release is refused by the server (422) and never offered here.
 */

export const ADMIN = '/api/admin/mail/protection';
export const ADMIN_QUARANTINE = '/api/admin/mail/quarantine';

export const adminKeys = {
  all: ['mail-admin', 'protection'] as const,
  overview: (period: string) => ['mail-admin', 'protection', 'overview', period] as const,
  policies: ['mail-admin', 'protection', 'policies'] as const,
  versions: (id: number) => ['mail-admin', 'protection', 'versions', id] as const,
  quarantine: (filters: Record<string, string>) => ['mail-admin', 'protection', 'quarantine', filters] as const,
  quarantineItem: (id: number) => ['mail-admin', 'protection', 'quarantine-item', id] as const,
  lists: (scope: string) => ['mail-admin', 'protection', 'lists', scope] as const,
  attachments: ['mail-admin', 'protection', 'attachments'] as const,
  engines: ['mail-admin', 'protection', 'engines'] as const,
  reports: (from: string, to: string, policy: string) => ['mail-admin', 'protection', 'reports', from, to, policy] as const,
};

export const useOverview = (period: '24h' | '7d' | '30d') => useQuery({ queryKey: adminKeys.overview(period), queryFn: ({ signal }) => apiGet<ProtectionOverview>(`${ADMIN}/overview`, { period }, signal), staleTime: 30_000, retry: false });

export const usePolicies = () => useQuery({ queryKey: adminKeys.policies, queryFn: async ({ signal }) => listOf<Policy>(await apiGet<Policy[] | { policies: Policy[] }>(`${ADMIN}/policies`, undefined, signal), 'policies'), staleTime: 30_000, retry: false });

export const usePolicyVersions = (id: number | null) =>
  useQuery({ queryKey: adminKeys.versions(id ?? 0), queryFn: async () => listOf<PolicyVersion>(await apiGet<PolicyVersion[] | { versions: PolicyVersion[] }>(`${ADMIN}/policies/${id}/versions`), 'versions'), enabled: id !== null, retry: false });

/** A list answer, whether it came bare or under its name. */
export function listOf<T>(v: T[] | Record<string, unknown> | null | undefined, key: string): T[] {
  if (Array.isArray(v)) return v;
  const inner = v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : null;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

export const savePolicy = (id: number, settings: PolicySettings, name?: string) => apiPut<Policy>(`${ADMIN}/policies/${id}`, { settings, ...(name ? { name } : {}) });
export const createPolicy = (name: string, base: Policy['base']) => apiPost<Policy>(`${ADMIN}/policies`, { name, base });
export const previewPolicy = (id: number, settings: PolicySettings) => apiPost<PolicyPreview>(`${ADMIN}/policies/${id}/preview`, settings);
export const applyPolicy = (id: number) => apiPost<{ version: number; self_test: SelfTest; rolled_back: boolean }>(`${ADMIN}/policies/${id}/apply`);
export const rollbackPolicy = (id: number, version: number) => apiPost(`${ADMIN}/policies/${id}/rollback`, { version });

export const useAdminQuarantine = (filters: Record<string, string>) =>
  useQuery({ queryKey: adminKeys.quarantine(filters), queryFn: ({ signal }) => apiGet<AdminQuarantinePage>(ADMIN_QUARANTINE, filters, signal), staleTime: 15_000, retry: false });

export const useAdminQuarantineItem = (id: number | null) =>
  useQuery({ queryKey: adminKeys.quarantineItem(id ?? 0), queryFn: () => apiGet<AdminQuarantineDetail>(`${ADMIN_QUARANTINE}/${id}`), enabled: id !== null, retry: false });

export const viewQuarantinedContent = (id: number, reason: string) => apiPost<{ html: string | null; text: string | null }>(`${ADMIN_QUARANTINE}/${id}/content`, { reason });
export const adminRelease = (id: number) => apiPost(`${ADMIN_QUARANTINE}/${id}/release`);
export const adminDelete = (id: number) => apiPost(`${ADMIN_QUARANTINE}/${id}/delete`);
export const decideRequest = (id: number, decision: 'approve' | 'deny', note: string) => apiPost(`${ADMIN_QUARANTINE}/${id}/decide`, { decision, ...(note.trim() ? { note: note.trim() } : {}) });

export const useAdminLists = (scope: 'org' | 'domain' | 'group') =>
  useQuery({ queryKey: adminKeys.lists(scope), queryFn: async ({ signal }) => listOf<ListEntry>(await apiGet<ListEntry[] | { entries: ListEntry[] }>(`${ADMIN}/lists`, { scope }, signal), 'entries'), staleTime: 30_000, retry: false });
export const addListEntry = (entry: { scope: string; scope_id?: number | null; kind: 'allow' | 'block'; value_type: 'address' | 'domain' | 'ip'; value: string; reason?: string; expires_at?: string | null }) => apiPost<ListEntry>(`${ADMIN}/lists`, entry);
export const removeListEntry = (id: number) => apiDelete(`${ADMIN}/lists/${id}`);
export async function importListCsv(scope: string, file: File): Promise<{ added: number; skipped: number }> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('scope', scope);
  return (await request<{ added: number; skipped: number }>('POST', `${ADMIN}/lists/import`, { body: form })).data;
}

export const useAttachmentRules = () => useQuery({ queryKey: adminKeys.attachments, queryFn: () => apiGet<AttachmentsAnswer>(`${ADMIN}/attachments`), staleTime: 30_000, retry: false });
export const saveAttachmentRules = (rules: Omit<AttachmentsAnswer, 'types_catalogue'>) => apiPut(`${ADMIN}/attachments`, rules);

export const useEngines = () => useQuery({ queryKey: adminKeys.engines, queryFn: ({ signal }) => apiGet<EnginesAnswer>(`${ADMIN}/engines`, undefined, signal), staleTime: 15_000, refetchInterval: 60_000, retry: false });
export const runSelfTest = (kind: 'eicar' | 'gtube' | 'all' = 'all') => apiPost<SelfTest>(`${ADMIN}/engines/test`, { kind });
export const updateSignatures = () => apiPost(`${ADMIN}/engines/update`);
export const restartEngine = (service: string, reason: string) => apiPost(`${ADMIN}/engines/restart`, { service, reason });

export const useReports = (from: string, to: string, policy: string) =>
  useQuery({ queryKey: adminKeys.reports(from, to, policy), queryFn: ({ signal }) => apiGet<ReportsAnswer>(`${ADMIN}/reports`, { from, to, policy: policy || undefined, format: 'json' }, signal), staleTime: 60_000, retry: false });

export const searchRemove = (q: SearchRemoveQuery, preview: true) => apiPost<SearchRemovePreview>(`${ADMIN}/search-remove`, { ...q, preview });
export const searchRemoveRun = (q: SearchRemoveQuery) => apiPost<SearchRemoveRun>(`${ADMIN}/search-remove`, { ...q, preview: false });

/**
 * A CSV the server builds (the lists, the reports), saved with the desktop's own save dialog (`files:saveText`, as the
 * Phone's exports). Null when the person cancelled.
 */
export async function saveServerCsv(path: string, query: Record<string, string>, name: string): Promise<string | null> {
  const res = await fetch(apiUrl(path, query), { headers: { Accept: 'text/csv' } });
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return call('files:saveText', { name: name.replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 76) + '.csv', text: (await res.text()).slice(0, 8_000_000) });
}

/** Rows already on screen as a CSV, saved the same way (the admin quarantine's Export). */
export function saveRowsCsv(rows: Array<Array<string | number | null>>, name: string): Promise<string | null> {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return call('files:saveText', { name: name.replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 76) + '.csv', text: rows.map((r) => r.map(cell).join(',')).join('\n').slice(0, 8_000_000) });
}
