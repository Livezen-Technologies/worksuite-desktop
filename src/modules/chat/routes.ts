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
