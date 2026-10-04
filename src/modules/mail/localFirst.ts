import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { peekCached, request as apiRequest, withMailbox, type ApiResult, type Query } from '../../core/api';
import { call } from '../../core/bridge';
import type { OfflineMutation } from '@shared/types';
import type { MessageDetail, MessageRef } from './types';
import { identityQuery } from './messageLookup';

/**
 * Cached first, then fresh (worksuite-desktop#162).
 *
 * Mail's answers are saved on this computer, encrypted, as they arrive
 * (electron/services/offline-cache.ts). They used to be read only when the
 * server could not be reached; now the folder list, the counts, the first
 * page of a list and an opened message are shown from them at once — on
 * app start, before the server has answered — and the server's answer
 * replaces them when it comes. A seeded answer is marked stale (updated at
 * 0), so the query always asks the server too; it is never preferred over a
 * live answer and never written over one.
 */

/** Put a saved answer in a query that has none yet. Resolves true when it did. */
export async function seedFromLocal<T>(qc: QueryClient, key: QueryKey, request: { path: string; query?: Query }, shape: (r: ApiResult<T>) => unknown): Promise<boolean> {
  if (qc.getQueryData(key) !== undefined) return false;
  const [hit] = await peekCached<T>([request]);
  // The server may have answered while this computer was being read: its answer stands.
  if (!hit || qc.getQueryData(key) !== undefined) return false;
  qc.setQueryData(key, shape(hit), { updatedAt: 0 });
  return true;
}

/** Seed a query from this computer whenever its key changes and it has nothing to show. */
export function useLocalFirst<T>(key: QueryKey, request: { path: string; query?: Query } | null, shape: (r: ApiResult<T>) => unknown = (r) => r.data): void {
  const qc = useQueryClient();
  const id = JSON.stringify(key);
  const req = request ? JSON.stringify(request) : null;
  useEffect(() => {
    if (!req) return;
    void seedFromLocal(qc, JSON.parse(id) as QueryKey, JSON.parse(req) as { path: string; query?: Query }, shape);
    // shape is a pure mapping chosen by the caller; the key and the request decide when to read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, id, req]);
}

/** A message's query key, shared by the reading pane and the prefetch. */
export function messageKey(ref: MessageRef): QueryKey {
  return ['mail', 'message', ref.mailbox, ref.folder, ref.uid];
}

/** A message's request: `peek` leaves it unread at the server (fetching ahead, or marking read later). */
export function messageRequest(ref: MessageRef, peek: boolean): { path: string; query: Query } {
  return { path: `/api/mail/messages/${ref.uid}`, query: withMailbox({ folder: ref.folder, ...identityQuery(ref), ...(peek ? { peek: 1 } : {}) }, ref.mailbox) };
}

/** A message from this computer: as it was opened, or as it was fetched ahead. */
export async function seedMessage(qc: QueryClient, ref: MessageRef, peek: boolean): Promise<boolean> {
  if (await seedFromLocal<MessageDetail>(qc, messageKey(ref), messageRequest(ref, peek), (r) => r)) return true;
  return peek ? false : seedFromLocal<MessageDetail>(qc, messageKey(ref), messageRequest(ref, true), (r) => ({ ...r, peeked: true }));
}

/** How many messages after the open one are fetched ahead. */
export const PREFETCH_AHEAD = 3;

/**
 * Fetch the next few messages in the list ahead of time, without marking them
 * read, so moving down the list opens each at once. Ones already here (in
 * memory, or recently opened) are left alone.
 */
export function prefetchMessages(qc: QueryClient, refs: MessageRef[], now = Date.now()): void {
  for (const ref of refs.slice(0, PREFETCH_AHEAD)) {
    // Never a row without a server ID (#228): it could only be asked for as "UID 0".
    if (!(Number(ref.uid) > 0)) continue;
    const key = messageKey(ref);
    if (qc.getQueryData(key) !== undefined) continue;
    const name = `${ref.mailbox ?? ''}:${ref.folder}:${ref.uid}`;
    if ((prefetchFailed.get(name)?.until ?? 0) > now) continue;
    const req = messageRequest(ref, true);
    void qc
      .prefetchQuery({
        queryKey: key,
        // Fetching ahead says so: the server never gives it the connection kept for what a person opens (#228).
        queryFn: async ({ signal }) => ({ ...(await apiRequest<MessageDetail>('GET', req.path, { query: req.query, signal, headers: { 'X-Mail-Priority': 'background' } })), peeked: true }),
        staleTime: 60_000,
        retry: false,
      })
      .then(() => {
        if (qc.getQueryState(key)?.status === 'error') noteFailed(name, now);
        else prefetchFailed.delete(name);
      });
  }
}

/** A failed fetch ahead waits before it is tried again: 30 seconds, 2 minutes, then 10 (#228). */
export const PREFETCH_BACKOFF = [30_000, 120_000, 600_000];

const prefetchFailed = new Map<string, { n: number; until: number }>();

function noteFailed(name: string, now: number): void {
  const n = (prefetchFailed.get(name)?.n ?? 0) + 1;
  prefetchFailed.set(name, { n, until: now + PREFETCH_BACKOFF[Math.min(n, PREFETCH_BACKOFF.length) - 1]! });
}

/** Tests: forget the backoff. */
export function forgetPrefetchFailures(): void {
  prefetchFailed.clear();
}

/**
 * Rollback (worksuite-desktop#162): a change shown at once and queued is put
 * back when the server refuses it. The queue marks it failed; Mail then asks
 * the server again for everything it shows, so what is on screen is the
 * server's state, not the refused change. The refusal itself stays in
 * Waiting to send, to retry or discard.
 */
export function useServerStateOnRefusal(pending: OfflineMutation[] | undefined): void {
  const qc = useQueryClient();
  const refused = (pending ?? [])
    .filter((m) => m.state === 'FAILED' || m.state === 'CONFLICT')
    .map((m) => m.id)
    .sort()
    .join(',');
  const seen = useRef('');
  useEffect(() => {
    if (refused && refused !== seen.current) void qc.invalidateQueries({ queryKey: ['mail'] });
    seen.current = refused;
  }, [refused, qc]);
}

/** Take one mailbox's saved mail off this computer (it was removed from the account). */
export async function forgetMailbox(id: number | string): Promise<void> {
  try {
    await call('offline:clearMailbox', { mailbox: String(id) });
  } catch {
    // No desktop shell: nothing is kept here.
  }
}

/**
 * A mailbox that is no longer the person's — removed here, on the web or on
 * another computer, or no longer shared with them — takes its saved mail off
 * this computer once the account's list says so (worksuite-desktop#162).
 */
export function useForgetRemovedMailboxes(ids: number[] | null): void {
  const key = ids ? [...ids].sort((a, b) => a - b).join(',') : null;
  useEffect(() => {
    if (key === null) return;
    const kept = new Set(key ? key.split(',') : []);
    void call('offline:mailStats')
      .then((stats) => {
        for (const box of Object.keys(stats.byMailbox)) if (!kept.has(box)) void forgetMailbox(box);
      })
      .catch(() => undefined);
  }, [key]);
}
