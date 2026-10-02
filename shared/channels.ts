/**
 * Apps that are a channel of another app's screen (worksuite-desktop#35): WhatsApp is a channel of Chat. Such an
 * app keeps its own access — its slug and permission still decide who has it — but it is opened in its host, at the
 * channel's route, and its old routes and the web's links to it open there too, on the same conversation.
 */

/** The desktop route of WhatsApp in Chat, on a conversation (`wa`) or starting one with a number (`to`). */
export function whatsappRoute(opts: { chat?: string | null; to?: string | null } = {}): string {
  const chat = opts.chat ?? '';
  if (/^\d{1,20}$/.test(chat)) return `/chat?channel=whatsapp&wa=${chat}`;
  const to = (opts.to ?? '').replace(/\D+/g, '');
  if (to.length >= 7 && to.length <= 15) return `/chat?channel=whatsapp&to=${to}`;
  return '/chat?channel=whatsapp';
}

/** The channel apps, each with its host app and how a path of its own (`/whatsapp?chat=5`, `/whatsapp/5`) maps into the host. */
export const CHANNEL_APPS: Readonly<Record<string, { host: string; route: (query: URLSearchParams, rest: string[]) => string }>> = {
  whatsapp: { host: 'chat', route: (q, rest) => whatsappRoute({ chat: q.get('chat') ?? q.get('wa') ?? rest[0], to: q.get('to') }) },
};

function split(route: string): { segments: string[]; query: URLSearchParams } {
  const [path = '', qs = ''] = route.split('#')[0]!.split('?');
  return { segments: path.split('/').filter(Boolean), query: new URLSearchParams(qs) };
}

/** Which channel app a route of its host is on (`/chat?channel=whatsapp…` → `whatsapp`); null for anything else. */
export function channelAppOfRoute(route: string): string | null {
  const { segments, query } = split(route);
  const id = query.get('channel');
  if (!id || !Object.hasOwn(CHANNEL_APPS, id)) return null;
  return CHANNEL_APPS[id]!.host === segments[0] ? id : null;
}

/**
 * A route of a channel app's own (`/whatsapp`, `/whatsapp?chat=5`, `/whatsapp/5` — a saved tab, a pinned entry, a
 * deep link, a notification) as the route in its host that replaced it; any other route as it is.
 */
export function redirectRoute(route: string): string {
  const { segments, query } = split(route);
  const id = segments[0];
  if (!id || !Object.hasOwn(CHANNEL_APPS, id)) return route;
  return CHANNEL_APPS[id]!.route(query, segments.slice(1));
}
