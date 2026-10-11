import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { touchesInvitations } from '@shared/meeting-invitations';
import { on } from './bridge';
import { watchedBySeq } from '@shared/chat-seq';

/**
 * Server state. REST is authoritative (FR-RT-03): realtime events and a
 * reconnect only tell queries to refetch; nothing is patched from the socket.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, e) => {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404 || e.status === 422)) return false;
        return count < 2;
      },
    },
  },
});

/** Website chat (the visitor widget): refresh its inbox and the conversation named. */
const WEBSITE_EVENTS = new Set(['chat.widget.message', 'chat.widget.activity', 'chat.incoming', 'chat.taken', 'chat.assigned', 'chat.at_risk',
  // Several staff in one chat (ENH-WCHAT-03): who is in it, a note, an invitation or a transfer answered.
  'chat.widget.participants', 'chat.widget.note', 'chat.widget.handoff', 'chat.widget.handoff.resolved',
  // A visitor's voice call ringing, answered, held or over, and a call back asked for (ENH-WCHAT-05).
  'chat.widget.call', 'chat.widget.callback', 'chat.widget.message.deleted']);

/** Events that change nothing a list or thread shows; refetching every message on each keystroke was waste. */
const QUIET_CHAT_EVENTS = /^chat\.(typing\.|presence$|call\.)/;

/** A realtime event about an announcement: the server's own nudge, or the notification that one was published. */
export function touchesAnnouncements(e: { type: string; event?: string }): boolean {
  return e.type === 'hr.announcement.changed' || (e.type === 'notification' && e.event === 'hr.announcement_published');
}

/** A realtime event about an expense claim: the module's own nudge, or a notification that one was decided or paid. */
export function touchesExpenses(e: { type: string; event?: string }): boolean {
  return e.type === 'expense.claim.changed' || (e.type === 'notification' && typeof e.event === 'string' && e.event.startsWith('expense.'));
}

/** A realtime event about Social Media Manager: its own nudge, or a notification it raised. */
export function touchesSocialMedia(e: { type: string; event?: string }): boolean {
  return e.type.startsWith('social.') || (e.type === 'notification' && typeof e.event === 'string' && e.event.startsWith('social.'));
}

export function wireQueryInvalidation(): void {
  on('realtime:resync', () => void queryClient.invalidateQueries());
  on('organization:changed', () => void queryClient.invalidateQueries());
  on<{ type: string; room_id?: number; conversation_id?: number; event?: string; seq?: number }>('realtime:event', (e) => {
    if (WEBSITE_EVENTS.has(e.type)) {
      void queryClient.invalidateQueries({ queryKey: ['website', 'inbox'] });
      // A message in a thread open on screen is fetched by its seq there (plan 1.9), not by reading the whole thread again.
      const bySeq = e.type === 'chat.widget.message' && Number(e.seq) > 0 && watchedBySeq(`website:${String(e.conversation_id)}`);
      if (e.conversation_id !== undefined && !bySeq) void queryClient.invalidateQueries({ queryKey: ['website', 'conversation', String(e.conversation_id)] });
      if (e.type === 'chat.widget.callback' || e.type === 'chat.widget.call') void queryClient.invalidateQueries({ queryKey: ['website', 'callbacks'] });
    } else if (e.type === 'chat.presence') {
      void queryClient.invalidateQueries({ queryKey: ['chat', 'presence'] });
    } else if (e.type.startsWith('chat.') && !QUIET_CHAT_EVENTS.test(e.type)) {
      void queryClient.invalidateQueries({ queryKey: ['chat', 'rooms'] });
      if (e.room_id !== undefined) void queryClient.invalidateQueries({ queryKey: ['chat', 'messages', String(e.room_id)] });
    }
    // A call rang, was answered or stopped: Chat › Calls and the call's card in its conversation say so now (worksuite-desktop#113).
    if (e.type === 'chat.call.ringing' || e.type === 'chat.call.stopped') {
      void queryClient.invalidateQueries({ queryKey: ['chat', 'calls'] });
      if (e.room_id !== undefined) void queryClient.invalidateQueries({ queryKey: ['chat', 'messages', String(e.room_id)] });
    }
    // Messenger and Instagram (worksuite-desktop#36): a message in or out, a read, an account's connection changed —
    // the toolbar badges, the lists and an open thread ask again.
    if (e.type === 'meta.message' || e.type === 'meta.account') void queryClient.invalidateQueries({ queryKey: ['meta'] });
    if (e.type === 'notification') void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    // Something shared with this person, or their access changed: Shared with me and Drive's lists show it now (worksuite-desktop#16).
    if (e.type === 'notification' && typeof e.event === 'string' && /^files\.(shared|access_changed|access_revoked)$/.test(e.event)) {
      for (const k of ['shared', 'list', 'home', 'access']) void queryClient.invalidateQueries({ queryKey: ['files', k] });
    }
    // Invited, moved, cancelled or answered — here, on another screen or from the email: every view that shows the
    // invitation, or counts them, asks again (worksuite-desktop#97).
    if (touchesInvitations(e)) for (const queryKey of [['meetings'], ['calendar'], ['home']]) void queryClient.invalidateQueries({ queryKey });
    if (e.type === 'activity.new') void queryClient.invalidateQueries({ queryKey: ['home'] });
    if (e.type === 'hr.attendance.changed') void queryClient.invalidateQueries({ queryKey: ['hr'] });
    // An expense claim was filed, decided, paid, linked or refunded (worksuite-desktop#159): the Expenses screens and a
    // tender's Expenses tab, its cards and its history ask again. Only ids travel; each screen re-reads what it may see.
    if (touchesExpenses(e)) for (const queryKey of [['expenses'], ['tenders']]) void queryClient.invalidateQueries({ queryKey });
    // An announcement was published, edited, withdrawn, expired or deleted (worksuite-desktop#98): Home's block, an open
    // reader (which then says it is no longer available) and HR's console ask again.
    if (touchesAnnouncements(e)) for (const queryKey of [['announcements'], ['hr', 'announcements']]) void queryClient.invalidateQueries({ queryKey });
    // Mail's sync pushed a change (new mail, a flag, a move — `mail.changed` / `mail.counts`): the lists and counts ask
    // again; a sync's progress only touches the sync card.
    if (e.type === 'mail') void queryClient.invalidateQueries({ queryKey: e.event === 'mail.sync.progress' ? ['mail', 'sync'] : ['mail'] });
    // Hotel PMS's live nudges (`pms.room`, `pms.hk_task`, `pms.request`): the rack and the desk's lists ask again (PMS-ARC-030).
    if (e.type.startsWith('pms.')) void queryClient.invalidateQueries({ queryKey: ['pms', 'live'] });
    // Social Media Manager (WS-SMM-SRS-001): a post published, failed or held, an approval decided, an inbox message in,
    // an account's connection changed (`social.post`, `social.inbox`, `social.account`… or a notification of one) —
    // its screens ask again. Only ids travel; each screen re-reads what the person may see.
    if (touchesSocialMedia(e)) void queryClient.invalidateQueries({ queryKey: ['social-media'] });
  });
  on('notifications:changed', () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }));
  // New mail in the folder in front (ENH-MAIL-05 MNA-APP-02): the list asks now, and the row comes in marked "New".
  on('mail-alert:list', () => void queryClient.invalidateQueries({ queryKey: ['mail'] }));
  on('offline:changed', () => void queryClient.invalidateQueries({ queryKey: ['offline'] }));
}
