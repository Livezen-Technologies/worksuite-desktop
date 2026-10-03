import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet, apiGetMeta } from '../../core/api';
import { call } from '../../core/bridge';
import { text } from '../../core/i18n';
import type { Draft, OfflineMutation } from '@shared/types';
import type { AllCounts, AllRole, ComposeSeed } from './types';
import { useLocalFirst } from './localFirst';

/**
 * All Accounts (ENH-MAIL-03 v1.1 DMO-ALL): eight virtual folders over every
 * included account. Each is a query — on the server's mirror, or this
 * computer's copy of it offline — over the folder that plays the role in each
 * account; nothing is copied or moved to build them (DMO-ALL-04). The place
 * keeps the old Unified inbox's address (`box=unified`), so links, smart
 * views and saved list preferences that pointed at it now open All Accounts ›
 * Inbox with nothing to migrate (DMO-ALL-02).
 */

export const ALL_FOLDERS: Array<{ role: AllRole; label: string; icon: string }> = [
  { role: 'inbox', label: 'Inbox', icon: 'inbox' },
  { role: 'drafts', label: 'Drafts', icon: 'file-text' },
  { role: 'outbox', label: 'Outbox', icon: 'upload' },
  { role: 'archive', label: 'Archive', icon: 'archive' },
  { role: 'sent', label: 'Sent', icon: 'send' },
  { role: 'snoozed', label: 'Snoozed', icon: 'clock' },
  { role: 'trash', label: 'Deleted Items', icon: 'trash' },
  { role: 'junk', label: 'Junk Email', icon: 'shield-alert' },
];

export function isAllRole(v: string | null | undefined): v is AllRole {
  return ALL_FOLDERS.some((f) => f.role === v);
}

/** The folder's name as the pane and the list title say it. */
export function allFolderLabel(role: AllRole): string {
  return text(ALL_FOLDERS.find((f) => f.role === role)?.label ?? 'Inbox');
}

/** The slug each account's own folder list uses for a role (Junk Email is "spam"). */
export function roleSlug(role: AllRole): string {
  return role === 'junk' ? 'spam' : role;
}

/** The role a list folder slug plays, for actions from a combined row (WF-DO14). */
export function slugRole(slug: string): AllRole | null {
  if (slug === 'spam') return 'junk';
  return isAllRole(slug) ? slug : null;
}

/**
 * What the pane shows beside a folder (DMO-ALL-03): unread for Inbox and
 * Archive, totals for the rest, nothing for Sent, and Outbox hidden at 0.
 * Above 999 it says "999+", with the exact number in the tooltip.
 */
export function allCount(role: AllRole, counts: AllCounts | null | undefined, local: { outbox?: number; drafts?: number; inbox?: number } = {}): { n: number | null; shown: string | null; title: string | null; hidden: boolean } {
  if (role === 'sent') return { n: null, shown: null, title: null, hidden: false };
  const server = counts?.roles[role]?.count ?? (role === 'inbox' && !counts ? (local.inbox ?? null) : null);
  const extra = role === 'outbox' ? (local.outbox ?? 0) : role === 'drafts' ? (local.drafts ?? 0) : 0;
  const n = server === null && !extra ? null : (server ?? 0) + extra;
  if (role === 'outbox' && !n) return { n: 0, shown: null, title: null, hidden: true };
  if (n === null || n <= 0) return { n, shown: null, title: null, hidden: false };
  const kind = counts?.roles[role]?.kind ?? (role === 'inbox' || role === 'archive' ? 'unread' : 'total');
  const exact = kind === 'unread' ? text('{n} unread', { n: n.toLocaleString() }) : text('{n} items', { n: n.toLocaleString() });
  const floor = counts?.partial ? ` · ${text('not counted: {list}', { list: counts.unknown.join(', ') })}` : '';
  return { n, shown: n > 999 ? '999+' : String(n), title: exact + floor, hidden: false };
}

/** Set once an older server answers 404 for the All Accounts views; the combined list is then asked by folder name. */
let viewsMissing = false;

/** A page of an All Accounts folder (GET views/all/{role}), or the older combined list when the server has no such call. */
export async function allAccountsPage<T>(role: AllRole, params: Record<string, string | number | boolean | null | undefined>, signal: AbortSignal | undefined, fallback: () => Promise<T>): Promise<T> {
  if (!viewsMissing) {
    try {
      return await apiGetMeta<unknown>(`/api/mail/views/all/${role}`, params, signal) as T;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
      viewsMissing = true;
    }
  }
  return fallback();
}

/** GET views/all/counts — null from an older server, which has no such call. */
export function useAllCounts(enabled: boolean) {
  useLocalFirst(['mail', 'all', 'counts'], enabled ? { path: '/api/mail/views/all/counts' } : null);
  return useQuery({
    queryKey: ['mail', 'all', 'counts'],
    queryFn: async () => {
      try {
        return await apiGet<AllCounts>('/api/mail/views/all/counts');
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
}

/** A mail draft kept only on this computer (DMO-ALL-07): not yet uploaded, marked "On this computer". */
export interface LocalDraft {
  context: string;
  subject: string;
  to: string;
  updatedAt: string;
  seed: ComposeSeed;
}

/** The compose seed that reopens a local draft under the same context. */
export function seedFromContext(context: string): ComposeSeed {
  const m = /^compose:(reply_all|reply|forward):(.*)$/.exec(context);
  if (!m) return { mode: 'new' };
  return { mode: m[1] as ComposeSeed['mode'], inReplyTo: m[2] };
}

export function localDrafts(drafts: Draft[]): LocalDraft[] {
  return drafts
    .filter((d) => d.module === 'mail' && d.context.startsWith('compose:') && d.content && typeof d.content === 'object')
    .map((d) => {
      const c = d.content as { subject?: string; to?: string; html?: string };
      return { context: d.context, subject: c.subject ?? '', to: c.to ?? '', updatedAt: d.updatedAt, seed: seedFromContext(d.context), empty: !c.subject && !c.to && !(c.html ?? '').replace(/<[^>]*>/g, '').trim() };
    })
    .filter((d) => !d.empty)
    .map(({ empty: _empty, ...d }) => d)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function useLocalDrafts(enabled: boolean) {
  return useQuery({
    queryKey: ['mail', 'all', 'local-drafts'],
    queryFn: async () => {
      try {
        return localDrafts(await call('offline:listDrafts', { module: 'mail' }));
      } catch {
        return [] as LocalDraft[];
      }
    },
    enabled,
    staleTime: 5_000,
  });
}

/** Sends in this computer's queue, waiting or failed (DMO-ALL-08). */
export function queuedSends(pending: OfflineMutation[]): OfflineMutation[] {
  return pending.filter((m) => m.module === 'mail' && m.entity === 'message.send' && m.state !== 'DONE');
}
