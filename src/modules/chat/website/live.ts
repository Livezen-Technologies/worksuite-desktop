import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiPost } from '../../../core/api';
import { call, on } from '../../../core/bridge';
import { useNow } from '../../../components/CallKit';
import { marksWith, openConversationData, updateOpenConversation, WEBSITE, type WebsiteConversation } from './api';

/**
 * Live status in a website chat on the desktop (WS-WCHAT ENH-WCHAT-04, LIVE-02…08, LIVE-12): the same marks and
 * typing as the web and the visitor's widget.
 *
 * - Receipts: the visitor's messages up to the newest are delivered to this device, and read while the thread is in
 *   front (LIVE-07). Reported once each time a mark moves; the server counts them only for the chat's owner and
 *   participants, never somebody monitoring it. Where messages carry a seq they go by seq through the main process,
 *   batched with what realtime delivered (plan 2.9, DLV-08); from an older server, by id as before.
 * - Typing: the visitor's and colleagues' typing frames are shown at once and go at once on a stop, never outliving
 *   seven seconds (LIVE-04); between frames the thread's own answer says who was typing when it was read.
 * - A delivered or read frame for this chat moves the ticks now: the visitor's is applied to the marks held (DLV-08:
 *   only the other side's acknowledgement moves them); anything else asks for the thread again.
 */

/** How long a typing frame counts without another (LiveActivity::WINDOW). */
export const TYPING_MS = 7_000;

interface Frame {
  type: string;
  conversation_id?: number;
  by?: 'visitor' | 'agent';
  message_id?: number;
  seq?: number | null;
  at?: string;
  who?: 'visitor' | 'agent';
  state?: 'start' | 'stop';
  user_id?: number;
  name?: string;
  internal?: boolean;
}

export interface LiveStatus {
  visitorTyping: boolean;
  /** Colleagues typing here now; a note being written says so. */
  staffTyping: string[];
}

export function useLiveStatus(id: number, data: WebsiteConversation | undefined, dataAt: number, me: number | null, visible: boolean): LiveStatus {
  const qc = useQueryClient();
  const now = useNow(1_000);
  const [visitor, setVisitor] = useState<{ until: number; at: number } | null>(null);
  const [typists, setTypists] = useState<Record<number, { name: string; until: number; internal: boolean }>>({});

  // ---- receipts (LIVE-07)
  const newest = (data?.messages ?? []).reduce<{ id: number; seq: number | null } | null>((n, m) => (m.from === 'visitor' && (!n || m.id > n.id) ? { id: m.id, seq: m.seq ?? null } : n), null);
  const lastVisitor = newest?.id ?? 0;
  const lastSeq = newest?.seq ?? null;
  const sent = useRef({ delivered: 0, read: 0 });
  useEffect(() => {
    if (!lastVisitor || !data?.marks) return;
    const body: { delivered?: number; read?: number } = {};
    if (lastVisitor > sent.current.delivered) body.delivered = lastVisitor;
    if (visible && lastVisitor > sent.current.read) body.read = lastVisitor;
    if (body.delivered === undefined && body.read === undefined) return;
    sent.current = { delivered: Math.max(sent.current.delivered, body.delivered ?? 0), read: Math.max(sent.current.read, body.read ?? 0) };
    if (lastSeq) {
      // By seq, in the main process's batch (plan 2.9); the ids go too, for a server that reads only those.
      const mark = { conversationId: id, deliveredSeq: lastSeq, ...(body.read ? { readSeq: lastSeq, read: body.read } : {}), delivered: lastVisitor };
      void call('realtime:receipt', mark).catch(() => apiPost(`${WEBSITE}/conversations/${id}/receipts`, body).catch(() => undefined));
      return;
    }
    void apiPost(`${WEBSITE}/conversations/${id}/receipts`, body).catch(() => undefined);
  }, [id, lastVisitor, lastSeq, visible, data?.marks]);

  // ---- frames (LIVE-02, LIVE-03)
  useEffect(
    () =>
      on<Frame>('realtime:event', (e) => {
        if (e.conversation_id !== id) return;
        if (e.type === 'chat.widget.typing') {
          const until = e.state === 'stop' ? 0 : Date.now() + TYPING_MS;
          if (e.who === 'visitor') setVisitor({ until, at: Date.now() });
          else if (e.user_id && e.user_id !== me) setTypists((t) => ({ ...t, [e.user_id!]: { name: e.name ?? 'A colleague', until, internal: !!e.internal } }));
        } else if (e.type === 'chat.widget.read' || e.type === 'chat.widget.delivered') {
          const key = String(id);
          if (marksWith(openConversationData(qc, key)?.marks, e)) updateOpenConversation(qc, key, (d) => ({ ...d, marks: marksWith(d.marks, e) ?? d.marks }));
          else void qc.invalidateQueries({ queryKey: ['website', 'conversation', key] });
        }
      }),
    [id, me, qc],
  );

  // A frame newer than the thread's answer decides; otherwise the answer does.
  const visitorTyping = visitor && visitor.at >= dataAt ? visitor.until > now : !!data?.conversation.visitor_typing;
  const live = Object.values(typists);
  const liveNames = new Set(live.map((t) => t.name));
  const staffTyping = [
    ...live.filter((t) => t.until > now).map((t) => (t.internal ? `${t.name} (a note)` : t.name)),
    ...(data?.agents_typing ?? []).filter((n) => !liveNames.has(n)),
  ];
  return { visitorTyping, staffTyping };
}

/** Whether the page is in front: reading is only reading while somebody can see it (LIVE-07). */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}
