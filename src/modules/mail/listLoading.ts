import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { ApiResult } from '../../core/api';
import { call } from '../../core/bridge';
import { text } from '../../core/i18n';
import type { AllRole, MessagePage, MessageRow, SyncAccount } from './types';

/**
 * How a message list fills (worksuite-desktop#208).
 *
 * Opening any folder or view shows at least the latest LIST_PAGE messages,
 * newest first, whatever the date grouping: what this computer keeps first,
 * then the server's answer (ORDER BY date DESC LIMIT 100 OFFSET n, no date
 * range). Scrolling near the end asks for the next 100. When the rows shown
 * are fewer than 100 because something on this computer narrowed them — the
 * Focused tab, a filter the server could not apply, the instant search — more
 * pages are asked for until there are 100 to show or the folder ends, within
 * a bound so a filter that matches nothing does not walk a 50,000-message
 * mailbox.
 */

/** Messages asked for at once, and the fewest a list tries to show. */
export const LIST_PAGE = 100;

/** Pages fetched on their own to fill a narrowed list (1,000 messages), and an unnarrowed one. */
export const FILL_PAGES_NARROWED = 10;
export const FILL_PAGES_PLAIN = 2;

/** A list page's place: its number for servers that count pages, and the cursor where the server gave one. */
export interface ListPageParam {
  page: number;
  cursor: string | null;
}

export const FIRST_PAGE: ListPageParam = { page: 1, cursor: null };

export function nextListParam(last: ApiResult<MessagePage>, pages: Array<ApiResult<MessagePage>>): ListPageParam | undefined {
  if (!last?.data?.has_more) return undefined;
  return { page: pages.length + 1, cursor: last.data.next_cursor ?? null };
}

/** Whether to ask for another page on its own, to fill the list to LIST_PAGE rows. */
export function needsFill(s: { shown: number; hasMore: boolean; fetching: boolean; pages: number; narrowed: boolean }): boolean {
  if (!s.hasMore || s.fetching || s.shown >= LIST_PAGE) return false;
  return s.pages < (s.narrowed ? FILL_PAGES_NARROWED : FILL_PAGES_PLAIN);
}

/** The folders a list row can name that are views over INBOX, not folders: a message is read from INBOX. */
const VIRTUAL_READ = new Set(['starred', 'important', 'unified']);

/** The folder to read a listed message from (worksuite-desktop#209): its own, never a virtual view's name. */
export function readFolder(row: Pick<MessageRow, 'folder_slug'>, listFolder: string): string {
  const f = row.folder_slug ?? listFolder;
  return VIRTUAL_READ.has(f) ? 'inbox' : f;
}

/**
 * Headers still coming in for the accounts this list shows: "Syncing headers… 340 of 2,000".
 * Null when nothing shown is still building its first copy — and never "2,707 of 2,707": a count that has
 * reached its end is not syncing (worksuite-desktop#287).
 */
export function syncingLine(accounts: SyncAccount[] | undefined, mailboxes: Array<string | number> | null, total: number | null): string | null {
  const ids = mailboxes?.map(String) ?? null;
  // A server that keeps the first sync (#286) says when it is over (`first_sync: null`), whatever the folder counts.
  const building = (a: SyncAccount) => (a.first_sync !== undefined ? a.first_sync !== null : a.complete === false);
  const shown = (accounts ?? []).filter((a) => (ids === null || ids.includes(String(a.mailbox))) && a.running && building(a));
  if (!shown.length) return null;
  let have: number;
  let want: number;
  if (shown.every((a) => a.first_sync)) {
    // The headers held and the messages in the folders' windows, as the server counts them.
    have = shown.reduce((n, a) => n + a.first_sync!.have, 0);
    want = shown.reduce((n, a) => n + a.first_sync!.want, 0);
  } else {
    have = shown.reduce((n, a) => n + (a.messages ?? 0), 0);
    // The first sync takes the newest 2,000 of a folder (or its last 90 days): what "of" means here.
    want = Math.max(have, total !== null && total > 0 ? Math.min(total, 2000 * shown.length) : 2000 * shown.length);
  }
  if (have >= want) return null;
  return text('Syncing headers… {n} of {total}', { n: have.toLocaleString(), total: want.toLocaleString() });
}

export type EmptyReason = { kind: 'syncing' | 'filtered' | 'focused' | 'caught-up' | 'search'; title: string; hint: string | null };

/** Why an empty list is empty, in words (worksuite-desktop#208). */
export function emptyReason(s: { syncing: string | null; filtered: boolean; search: string; focusedTab: boolean; otherCount: number }): EmptyReason {
  if (s.search) return { kind: 'search', title: text('No messages match'), hint: text('Press Enter to search every mailbox, older mail too.') };
  if (s.filtered) return { kind: 'filtered', title: text('No mail matches these filters'), hint: null };
  if (s.syncing) return { kind: 'syncing', title: s.syncing, hint: text('Messages appear here as their headers arrive.') };
  if (s.focusedTab && s.otherCount > 0) return { kind: 'focused', title: text('Nothing in Focused'), hint: text('{n} in Other', { n: s.otherCount }) };
  return { kind: 'caught-up', title: text('All caught up'), hint: null };
}

/** Fewer than this in Focused, while Other has more: the hint offers to turn Focused off or teach it. */
export const FOCUSED_HINT_BELOW = 10;

export function showFocusedHint(focused: number, other: number, loaded: boolean): boolean {
  return loaded && focused < FOCUSED_HINT_BELOW && other > focused;
}

/**
 * The list from this computer at once (worksuite-desktop#208): every saved page of this folder — of one
 * mailbox, or of every account for All Accounts — newest first, the latest LIST_PAGE of them. The query
 * still asks the server (the seed is marked stale), whose answer replaces it; fewer than LIST_PAGE here
 * simply means the server's page fills the rest when it comes.
 */
export async function seedListFromLocal(qc: QueryClient, key: QueryKey, where: { mailbox: string | null; folder: string; role: AllRole | null }): Promise<boolean> {
  if (qc.getQueryData(key) !== undefined) return false;
  let got: { messages: Array<Record<string, unknown>>; total: number } | null;
  try {
    got = await call('offline:mailList', { mailbox: where.mailbox, folder: where.folder, role: where.role === 'outbox' || where.role === 'snoozed' ? null : where.role, limit: LIST_PAGE, offset: 0 });
  } catch {
    return false;
  }
  if (!got || !Array.isArray(got.messages) || !got.messages.length || qc.getQueryData(key) !== undefined) return false;
  const page: ApiResult<MessagePage> = { data: { messages: got.messages as unknown as MessageRow[], total: got.total, has_more: false, local: true, ...(where.mailbox === null ? { unified: true } : {}) }, offline: false, cachedAt: null, local: true };
  qc.setQueryData(key, { pages: [page], pageParams: [FIRST_PAGE] }, { updatedAt: 0 });
  return true;
}
