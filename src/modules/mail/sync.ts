import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError, apiGet, apiPost } from '../../core/api';
import { text } from '../../core/i18n';
import { createStore, useStore } from '../../core/store';
import { dateLabel, parseTs, timeLabel } from '../../core/time';
import type { Mailbox, SyncAccount, SyncStatus } from './types';

/**
 * Sync all, per-account sync and the one sync status (ENH-MAIL-03 v1.1
 * DMO-SYN, WF-DO13).
 *
 * The server keeps each account's last successful sync, last attempt and
 * result; this computer adds what only it knows — that it is offline, and
 * which accounts it is syncing right now. `syncSummary` turns both into the
 * one status the folder pane's footer, the status bar and Settings › Mail ›
 * Accounts all show, so they can never disagree (DMO-SYN-05/07).
 */

export type SyncState = 'up_to_date' | 'syncing' | 'attention' | 'offline' | 'paused' | 'unknown';

export interface SyncSummary {
  state: SyncState;
  /** Accounts syncing now / accounts that sync at all. */
  syncing: number;
  total: number;
  /** The most recent successful sync across accounts. */
  lastOk: string | null;
  failed: SyncAccount[];
  stale: SyncAccount[];
  /** "Synced 2 min ago", "Syncing 2 of 4 accounts…", "Needs attention · Gmail failed", "Offline". */
  headline: string;
  /** The second line: "Other 3 accounts synced 1 min ago", "Last successful sync 08:40". */
  detail: string;
  /** A warning about one stale account for the status bar: "Personal · Gmail not synced for 3 h". */
  warning: string | null;
  /** Push connections up now / accounts that sync by push (worksuite-desktop#172): the real connection state. */
  live: number;
  pushTotal: number;
  /** "2 of 2 mailboxes live" — or null when no account syncs by push. */
  liveLine: string | null;
  tone: 'success' | 'warning' | 'danger' | 'muted';
}

/** How long ago, relative under a day ("6 min ago"), otherwise date and time (DMO-SYN-14). */
export function syncAgo(stamp: string | null | undefined, now = Date.now()): string {
  if (!stamp) return text('never');
  const t = parseTs(stamp).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return text('just now');
  if (s < 3600) return text('{n} min ago', { n: Math.max(1, Math.round(s / 60)) });
  if (s < 86_400) return text('{n} h ago', { n: Math.floor(s / 3600) });
  return `${dateLabel(stamp)} ${timeLabel(stamp)}`;
}

/** The absolute local time for a tooltip. */
export function syncAt(stamp: string | null | undefined): string {
  if (!stamp) return text('never');
  return `${dateLabel(stamp)} ${timeLabel(stamp)}`;
}

/** "about 4 min left", "about 1 h 10 min left"; null before there is a rate to go by (#286). */
export function etaWords(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return null;
  if (seconds < 60) return text('less than a minute left');
  const min = Math.round(seconds / 60);
  if (min < 60) return text('about {n} min left', { n: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? text('about {h} h {m} min left', { h, m }) : text('about {h} h left', { h });
}

/**
 * "First sync · headers 12 of 21 folders · started 1:20 AM · about 4 min left" while an account's first full sync
 * runs (#286); null when none is going, or the server is too old to say.
 */
export function firstSyncLine(a: Pick<SyncAccount, 'first_sync'>, opts: { started?: boolean } = {}): string | null {
  const f = a.first_sync;
  if (!f) return null;
  const parts = [text('First sync'), text('headers {done} of {n} folders', { done: f.folders_done, n: f.folders })];
  if (opts.started !== false && f.started_at) parts.push(text('started {time}', { time: timeLabel(f.started_at) }));
  const eta = etaWords(f.eta_seconds);
  if (eta) parts.push(eta);
  return parts.join(' · ');
}

/** "3 h", "45 min" — for the stale warning. */
function sinceWords(stamp: string | null, now: number): string {
  if (!stamp) return text('a while');
  const s = Math.max(0, (now - parseTs(stamp).getTime()) / 1000);
  if (s < 3600) return text('{n} min', { n: Math.max(1, Math.round(s / 60)) });
  if (s < 86_400) return text('{n} h', { n: Math.floor(s / 3600) });
  return text('{n} d', { n: Math.floor(s / 86_400) });
}

/** An account's short name for a warning: its own name and provider, or its address. */
export function accountName(a: Pick<SyncAccount, 'name' | 'email'>, box?: Pick<Mailbox, 'display_name' | 'provider_label' | 'email'> | null): string {
  if (box?.display_name && box.provider_label && box.display_name !== box.email) return `${box.display_name} · ${box.provider_label}`;
  return a.name && a.name !== a.email ? a.name : a.email;
}

/**
 * The one status (DMO-SYN-05): Up to date, Syncing n of m, Needs attention,
 * Offline, Paused. `running` is what this computer is syncing right now;
 * `staleMinutes` the warning threshold (DMO-SYN-06).
 */
export function syncSummary(status: SyncStatus | null | undefined, opts: { offline: boolean; running?: ReadonlySet<number>; boxes?: Mailbox[]; staleMinutes?: number; now?: number }): SyncSummary {
  const now = opts.now ?? Date.now();
  const running = opts.running ?? new Set<number>();
  const accounts = (status?.accounts ?? []).map((a) => (running.has(a.mailbox) ? { ...a, running: true, last_result: 'running' as const } : a));
  const box = (id: number) => opts.boxes?.find((b) => b.id === id) ?? null;
  const active = accounts.filter((a) => !a.paused);
  const staleMinutes = Math.max(15, Math.min(1440, opts.staleMinutes ?? status?.overall?.stale_minutes ?? 60));
  const lastOk = accounts.reduce<string | null>((m, a) => (a.last_ok_at && (!m || parseTs(a.last_ok_at).getTime() > parseTs(m).getTime()) ? a.last_ok_at : m), null);
  const syncing = active.filter((a) => a.running).length;
  const failed = active.filter((a) => !a.running && a.last_result === 'failed');
  const stale = active.filter((a) => !a.running && a.last_result !== 'failed' && (a.last_ok_at ? now - parseTs(a.last_ok_at).getTime() > staleMinutes * 60_000 : a.last_result !== 'never'));
  const oldest = [...failed, ...stale].sort((a, b) => (a.last_ok_at ? parseTs(a.last_ok_at).getTime() : 0) - (b.last_ok_at ? parseTs(b.last_ok_at).getTime() : 0))[0];
  const warning = oldest && (!oldest.last_ok_at || now - parseTs(oldest.last_ok_at).getTime() > staleMinutes * 60_000) ? text('{name} not synced for {since}', { name: accountName(oldest, box(oldest.mailbox)), since: sinceWords(oldest.last_ok_at, now) }) : null;
  // Live means the server holds an idling connection that is serving, for an account that syncs by push.
  const pushIds = new Set(active.filter((a) => a.mode === 'push').map((a) => a.mailbox));
  const live = (status?.mailboxes ?? []).filter((m) => pushIds.has(m.mailbox) && m.status === 'live' && m.serving && m.pushed).length;
  const pushTotal = pushIds.size;
  const liveLine = pushTotal ? text('{n} of {total} mailboxes live', { n: live, total: pushTotal }) : null;
  const base = { syncing, total: active.length, lastOk, failed, stale, warning, live, pushTotal, liveLine };

  if (opts.offline) {
    return { ...base, state: 'offline', headline: text('Offline'), detail: lastOk ? text('Last successful sync {ago}', { ago: syncAgo(lastOk, now) }) : text('Showing mail saved on this computer'), tone: 'warning' };
  }
  if (!status?.accounts) {
    return { ...base, state: 'unknown', headline: text('Mail is checked on a schedule'), detail: '', tone: 'muted' };
  }
  if (accounts.length > 0 && active.length === 0) {
    return { ...base, state: 'paused', headline: text('Sync paused'), detail: lastOk ? text('Last successful sync {ago}', { ago: syncAgo(lastOk, now) }) : '', tone: 'muted' };
  }
  if (syncing > 0) {
    // One account on its first sync: how far it has got and how long is left, rather than "Syncing 1 of 1" for an hour (#286).
    const syncingNow = active.filter((a) => a.running);
    const first = syncingNow.length === 1 ? firstSyncLine(syncingNow[0]!, { started: false }) : null;
    return { ...base, state: 'syncing', headline: first ?? text('Syncing {n} of {total} accounts…', { n: syncing, total: active.length }), detail: lastOk ? text('Last full sync {ago}', { ago: syncAgo(lastOk, now) }) : '', tone: 'muted' };
  }
  if (failed.length || stale.length) {
    const first = failed[0] ?? stale[0]!;
    const what = failed.length ? text('{name} failed', { name: accountName(first, box(first.mailbox)) }) : text('{name} not synced for {since}', { name: accountName(first, box(first.mailbox)), since: sinceWords(first.last_ok_at, now) });
    const others = active.length - failed.length - stale.length;
    return {
      ...base,
      state: 'attention',
      headline: `${text('Needs attention')} · ${what}`,
      detail: others > 0 && lastOk ? text('Other {n} accounts synced {ago}', { n: others, ago: syncAgo(lastOk, now) }) : lastOk ? text('Last successful sync {ago}', { ago: syncAgo(lastOk, now) }) : '',
      // A failure is red; an account that is only out of date is amber — never green (worksuite-desktop#172).
      tone: failed.length ? 'danger' : 'warning',
    };
  }
  return { ...base, state: 'up_to_date', headline: lastOk ? text('Synced {ago}', { ago: syncAgo(lastOk, now) }) : text('Up to date'), detail: liveLine && live === pushTotal ? liveLine : text('{n} of {total} accounts', { n: active.length, total: active.length }), tone: 'success' };
}

/** One account's state in words, for its row and the Sync all tooltip (DMO-SYN-03/04). */
export function accountState(a: SyncAccount, now = Date.now()): { label: string; tone: 'success' | 'danger' | 'muted' | 'warning' } {
  if (a.paused) return { label: text('Paused'), tone: 'warning' };
  if (a.running) return { label: firstSyncLine(a, { started: false }) ?? (a.folders > 0 ? text('Syncing {done} of {n} folders…', { done: a.folders_done, n: a.folders }) : text('Syncing…')), tone: 'muted' };
  if (a.last_result === 'failed') return { label: text('Failed {time} — {why}', { time: a.last_attempt_at ? timeLabel(a.last_attempt_at) : '', why: a.error ?? text('the sync did not finish') }), tone: 'danger' };
  if (a.last_result === 'never' && !a.last_ok_at) return { label: text('Not synced yet'), tone: 'muted' };
  return { label: syncAgo(a.last_ok_at, now), tone: 'success' };
}

/** "Push", "Every 5 min", "Manual". */
export function modeWords(a: Pick<SyncAccount, 'mode' | 'interval_min'>): string {
  if (a.mode === 'push') return text('Push');
  if (a.mode === 'manual' || a.interval_min === 0) return text('Manual');
  if (a.interval_min >= 60) return text('Hourly');
  return text('Every {n} min', { n: a.interval_min });
}

// ---- the runner: single-flight, three at a time (DMO-SYN-02, DMO-SYN-12) ---------------------

interface Runner {
  /** Accounts being synced from this computer now. */
  running: ReadonlySet<number>;
  /** A Sync all in progress. */
  all: boolean;
  /** The last error per account from a sync started here (the server's words). */
  errors: Readonly<Record<number, string>>;
}

export const syncRunner = createStore<Runner>({ running: new Set(), all: false, errors: {} });

/** How many accounts sync at once from this computer. */
export const SYNC_PARALLEL = 3;

/** Sync one account now; with `folder`, that folder first (Check for new mail, #236 — the folder on screen). */
type SyncOne = (id: number, by: 'manual' | 'all', folder?: string) => Promise<void>;

const postSync: SyncOne = async (id, by, folder) => {
  if (folder) await apiPost('/api/mail/folder-ops/sync', { mailbox: id, folder });
  else await apiPost(`/api/mail/mailboxes/${id}/sync`, { by });
};
let syncOne: SyncOne = postSync;

/** Tests replace the call that syncs one account; null puts the real one back. */
export function setSyncOne(fn: SyncOne | null): void {
  syncOne = fn ?? postSync;
}

/**
 * Sync these accounts, at most three at a time. An account already syncing
 * is not started again; with `all`, a second Sync all while one runs does
 * nothing. With `folders`, each account's folder on screen is synced first,
 * on the server's slot kept for what a person asks for (#228, #236). Returns
 * when every account has been attempted.
 */
export async function runSync(ids: number[], opts: { all?: boolean; offline?: boolean; onDone?: () => void; folders?: Readonly<Record<number, string>> } = {}): Promise<{ started: number[]; failed: number[] }> {
  const s = syncRunner.get();
  if (opts.offline) return { started: [], failed: [] };
  if (opts.all && s.all) return { started: [], failed: [] };
  const todo = ids.filter((id) => !s.running.has(id));
  if (todo.length === 0) return { started: [], failed: [] };
  syncRunner.set((x) => ({ all: x.all || !!opts.all, running: new Set([...x.running, ...todo]) }));
  const failed: number[] = [];
  const queue = [...todo];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        await syncOne(id, opts.all ? 'all' : 'manual', opts.folders?.[id]);
        syncRunner.set((x) => {
          const errors = { ...x.errors };
          delete errors[id];
          return { errors };
        });
      } catch (e) {
        failed.push(id);
        const why = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
        syncRunner.set((x) => ({ errors: { ...x.errors, [id]: why } }));
      } finally {
        syncRunner.set((x) => {
          const running = new Set(x.running);
          running.delete(id);
          return { running };
        });
        opts.onDone?.();
      }
    }
  };
  // Each account on its own (#338): one that throws — even past its own catch — never stops the others being tried.
  await Promise.allSettled(Array.from({ length: Math.min(SYNC_PARALLEL, todo.length) }, worker));
  if (opts.all) syncRunner.set({ all: false });
  return { started: todo, failed };
}

/** The shared sync status, polled quickly while anything is syncing (DMO-ALL-14: lists update live). */
export function useSharedSync(enabled: boolean) {
  const running = useStore(syncRunner, (s) => s.running);
  const all = useStore(syncRunner, (s) => s.all);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['mail', 'sync'],
    queryFn: () => apiGet<SyncStatus>('/api/mail/sync/status'),
    enabled,
    staleTime: 15_000,
    // Quickly while a sync runs; a first sync, which can take a while, every five seconds (#286).
    refetchInterval: (query) => {
      const rows = query.state.data?.accounts ?? [];
      if (running.size > 0 || rows.some((a) => a.running && !a.first_sync)) return 2_000;
      return rows.some((a) => a.running) ? 5_000 : 30_000;
    },
  });
  // While syncing, the lists and counts follow along; when it stops, once more.
  const busy = running.size > 0;
  useEffect(() => {
    if (!enabled) return;
    void qc.invalidateQueries({ queryKey: ['mail', 'views'] });
    void qc.invalidateQueries({ queryKey: ['mail', 'all'] });
    if (!busy) void qc.invalidateQueries({ queryKey: ['mail', 'messages'] });
  }, [busy, q.dataUpdatedAt, enabled, qc]);
  return { status: q.data ?? null, running, all, refetch: q.refetch };
}

/** Accounts included in All Accounts, which Sync all syncs. */
export function includedIds(status: SyncStatus | null | undefined, boxes: Mailbox[]): number[] {
  const rows = status?.accounts;
  if (rows?.length) return rows.filter((a) => a.included && !a.paused).map((a) => a.mailbox);
  return boxes.filter((b) => b.in_unified !== false && !b.sync_paused && !b.archived).map((b) => b.id);
}
