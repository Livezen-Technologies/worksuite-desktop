import { useQuery } from '@tanstack/react-query';
import { app } from '../../core/app-state';
import { apiGet, apiPost } from '../../core/api';

/**
 * Who uploaded a checklist file, by name — the checklist carries the user's id
 * only — and telling them (and whoever chases the line) when it is sent back
 * or approved: a direct message in Team Chat with the comment and a link to the
 * tender, which their app shows as the tender's card. The tender module sends
 * no notification of its own for a review.
 */
export function usePeople() {
  const q = useQuery({
    queryKey: ['chat', 'directory'],
    queryFn: ({ signal }) => apiGet<{ users: Array<{ id: number; name: string }> }>('/api/chat/directory', undefined, signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const names = new Map<number, string>((q.data?.users ?? []).map((u) => [Number(u.id), u.name]));
  return (id: number | null | undefined): string | null => (id ? (names.get(id) ?? null) : null);
}

/** The people a review should reach: the file's uploader and the line's chaser, never the reviewer themself. */
export function reviewRecipients(uploader: number | null, owner: number | null, me: number | null): number[] {
  return [...new Set([uploader, owner].filter((x): x is number => !!x && x !== me))];
}

export function reviewMessage(o: { decision: 'approved' | 'rejected'; line: string; file: string | null; comment: string; tenderId: number }): string {
  const origin = (app.get().auth?.server?.origin ?? '').replace(/\/+$/, '');
  const what = o.file ? `“${o.file}” for ${o.line}` : o.line;
  const head = o.decision === 'rejected' ? `Sent back: ${what}. Please upload a corrected version.` : `Approved: ${what}.`;
  return [head, o.comment ? `Comment: ${o.comment}` : null, `${origin}/tenders?open=${o.tenderId}`].filter(Boolean).join('\n');
}

/** Sends the message to each person in a direct conversation; says who could not be reached. */
export async function tellInChat(userIds: number[], text: string): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const id of userIds) {
    try {
      const room = await apiPost<{ room_id: number }>('/api/chat/rooms/direct', { user_id: id });
      await apiPost('/api/chat/messages', { room_id: Number(room.room_id), message: text.slice(0, 4000), client_message_id: `desktop-${crypto.randomUUID()}` });
      sent++;
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}
