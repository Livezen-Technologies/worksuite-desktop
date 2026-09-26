import type { Room } from './types';

/**
 * The room a route names: `?room=42`, or `/chat/42` — the form worksuite://
 * links and the server's link resolver give, which used to open the chat list
 * with nothing selected.
 */
export function roomFromRoute(query: URLSearchParams, path: string[]): string | null {
  const q = query.get('room');
  if (q && /^\d+$/.test(q)) return q;
  const at = path.indexOf('chat');
  const seg = at >= 0 ? path[at + 1] : undefined;
  return seg && /^\d+$/.test(seg) ? seg : null;
}

/** The conversation Chat reopens: the last one open here, if it is still in the list and not archived, else the most recent. */
export function lastOrRecent(rooms: Room[], key: string | null): string | null {
  const open = rooms.filter((r) => !r.archived);
  if (!open.length) return null;
  let last: string | null = null;
  try {
    last = key ? localStorage.getItem(key) : null;
  } catch {
    last = null;
  }
  if (last && open.some((r) => String(r.id) === last)) return last;
  const at = (r: Room) => r.last_message?.created_at ?? r.updated_at ?? '';
  return String([...open].sort((a, b) => at(b).localeCompare(at(a)))[0]!.id);
}
