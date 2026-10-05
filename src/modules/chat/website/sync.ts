import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { cursorOf, judgeSeq, mergeBySeq, watchBySeq } from '@shared/chat-seq';
import { ApiError, request } from '../../../core/api';
import { app } from '../../../core/app-state';
import { on } from '../../../core/bridge';
import { useStore } from '../../../core/store';
import { WEBSITE, type WebsiteConversation, type WebsiteMessage } from './api';

/**
 * Keeping an open website thread whole, by seq (WS-WCHAT DLV-06; plan 1.9; the server's docs/CHAT_DELIVERY.md).
 *
 * The thread holds a cursor: the highest seq it knows. It asks the read-only `…/sync?after_seq=` for exactly what came
 * after it
 *  - when a realtime message names a seq past the cursor (the next one, or past a gap);
 *  - when the window comes back into focus, or into view;
 *  - after a reconnect (`realtime:resync`, which the main process sends when the socket or the server comes back).
 * An announced seq at or below the cursor is a repeat and costs nothing (the main process already drops one announced
 * twice). The answer is merged over the cached thread by seq, so a reply drawn on its way gives way to the server's copy
 * by id and client id, and nothing shows twice. The cursor goes back as `cursor`; "nothing changed" answers 304. Sync
 * joins, claims and acknowledges nothing, so it is safe to call as often as needed.
 */

interface SyncAnswer {
  conversation_id: number | null;
  status?: string;
  last_seq: number;
  messages: WebsiteMessage[];
  deleted?: number[];
  has_more?: boolean;
  cursor?: string;
}

/** The most pages one sync reads before leaving the rest to the next one. */
const MAX_PAGES = 10;

export function useWebsiteSync(id: string, data: WebsiteConversation | undefined, active: boolean): { sync: () => Promise<void> } {
  const qc = useQueryClient();
  const cursor = useRef(0);
  const etag = useRef<string | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const supported = useRef(true);

  useEffect(() => {
    cursor.current = 0;
    etag.current = null;
    supported.current = true;
  }, [id]);

  // What the thread's own fetch brought moves the cursor too: every seq up to last_seq is known.
  useEffect(() => {
    if (data) cursor.current = Math.max(cursor.current, cursorOf(data.messages ?? [], data.last_seq));
  }, [data]);

  const once = useCallback(async (): Promise<void> => {
    const queryKey = ['website', 'conversation', id];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      let answer: SyncAnswer;
      try {
        const r = await request<SyncAnswer>('GET', `${WEBSITE}/conversations/${id}/sync`, { query: { after_seq: cursor.current, cursor: etag.current } });
        // A copy kept on this computer says nothing about now.
        if (r.offline || r.local) return;
        answer = r.data;
      } catch (e) {
        if (e instanceof ApiError && e.status === 304) return;
        throw e;
      }
      if (!answer || answer.conversation_id === null) return;
      etag.current = answer.cursor ?? null;
      const known = qc.getQueryData<WebsiteConversation>(queryKey);
      if (!known) {
        // Nothing here to merge into: the thread's own fetch brings it all.
        void qc.invalidateQueries({ queryKey });
        return;
      }
      const incoming = answer.messages ?? [];
      const deleted = answer.deleted ?? [];
      if (incoming.length || deleted.length || (answer.status && answer.status !== known.conversation.status)) {
        qc.setQueryData<WebsiteConversation>(queryKey, (old) =>
          old && {
            ...old,
            messages: mergeBySeq(old.messages ?? [], incoming, deleted),
            last_seq: Math.max(old.last_seq ?? 0, answer.last_seq ?? 0),
            conversation: answer.status ? { ...old.conversation, status: answer.status } : old.conversation,
          },
        );
      }
      const last = incoming.length ? cursorOf(incoming) : 0;
      cursor.current = Math.max(cursor.current, answer.has_more ? last : (answer.last_seq ?? last));
      if (!answer.has_more) return;
    }
  }, [id, qc]);

  /** One sync at a time; a call while one runs asks for one more after it. */
  const sync = useCallback((): Promise<void> => {
    const queryKey = ['website', 'conversation', id];
    if (!supported.current) return qc.invalidateQueries({ queryKey });
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const run = (async () => {
      try {
        do {
          again.current = false;
          await once();
        } while (again.current);
      } catch (e) {
        // An older server without sync (404/409): the thread's own poll keeps it current, as before.
        if (e instanceof ApiError && (e.status === 404 || e.status === 409)) supported.current = false;
        void qc.invalidateQueries({ queryKey });
      } finally {
        running.current = null;
      }
    })();
    running.current = run;
    return run;
  }, [id, once, qc]);

  // Realtime: a message past the cursor is fetched by seq; one at or below it is a repeat. The app-wide listener
  // (core/query) leaves a conversation kept by seq to this thread.
  useEffect(() => {
    const unwatch = watchBySeq(`website:${id}`);
    const off = on<{ type: string; conversation_id?: number; seq?: number }>('realtime:event', (e) => {
      if (e.type !== 'chat.widget.message' || String(e.conversation_id) !== id) return;
      const seq = Number(e.seq);
      if (!Number.isFinite(seq) || seq <= 0) return;
      if (judgeSeq(cursor.current, seq) !== 'seen') void sync();
    });
    return () => {
      off();
      unwatch();
    };
  }, [id, sync]);

  // Focus, back into view, and a reconnect.
  useEffect(() => {
    if (!active) return;
    const now = () => {
      if (document.visibilityState !== 'hidden') void sync();
    };
    window.addEventListener('focus', now);
    document.addEventListener('visibilitychange', now);
    const offResync = on('realtime:resync', () => void sync());
    return () => {
      window.removeEventListener('focus', now);
      document.removeEventListener('visibilitychange', now);
      offResync();
    };
  }, [active, sync]);

  return { sync };
}

/** Live while the realtime socket is connected; otherwise the thread updates every few seconds by itself. */
export function useRealtimeLive(): boolean {
  return useStore(app, (s) => s.status?.realtime === 'connected');
}
