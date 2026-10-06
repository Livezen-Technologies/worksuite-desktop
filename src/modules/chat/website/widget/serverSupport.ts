import { useServerCapabilities, versionAtLeast, type ServerCapabilities } from '../../../../core/capabilities';
import { text } from '../../../../core/i18n';

/**
 * Which website chat screens this server's Communication module has (worksuite-desktop#259). The app can be newer
 * than the server — Beta may run ahead of it — and a screen the server lacks would open onto "Not on this server
 * yet". Somebody who cannot change widgets never sees such a screen; whoever can is told at the top of the page what
 * needs updating, with the server's version when it says it.
 *
 * The server's own list (`GET /api/capabilities`, core/capabilities) says so up front. A screen's endpoint has the
 * last word: one that answers is there whatever the list says, and a 404 means it is not. Without the list, only
 * the 404s tell, as before.
 */

export type CommFeature = 'widget.behaviour' | 'chat.insights' | 'widget.whatsapp';

/** In the order the notice names them. */
const FEATURES: Array<{ id: CommFeature; name: string; plural?: boolean }> = [
  { id: 'widget.behaviour', name: 'Behaviour' },
  { id: 'chat.insights', name: 'Insights' },
  { id: 'widget.whatsapp', name: 'WhatsApp numbers', plural: true },
];

/**
 * The Communication module version each feature first came in, where it is known (Insights: 1.41, #247). Put each
 * in as the server releases it (docs/RELEASING.md): the notice names a version only when it knows every one.
 */
export const MIN_COMMUNICATION: Partial<Record<CommFeature, string>> = { 'chat.insights': '1.41' };

/** What a screen's own endpoint has said: it answered, it is not there (404), or not yet. */
export type EndpointState = 'ok' | 'missing' | 'unknown';

/** Whether the server lacks a feature: its endpoint said so, or, until the endpoint has answered, its list does. */
export function lacks(feature: CommFeature, caps: ServerCapabilities | null, endpoint: EndpointState = 'unknown'): boolean {
  if (endpoint === 'missing') return true;
  if (endpoint === 'ok') return false;
  return caps !== null && !caps.features.has(feature);
}

/**
 * Whether Website chats › Insights is offered: always to whoever can change widgets (the page says when the server is
 * too old), else unless the server's list leaves it out.
 */
export function useInsightsShown(admin: boolean): boolean {
  const caps = useServerCapabilities();
  return admin || !lacks('chat.insights', caps);
}

/** "Behaviour and Insights need Communication module 2.4 or later (server has 2.3.1)." */
export function versionNotice(missing: CommFeature[], have: string | null | undefined): string {
  const list = FEATURES.filter((f) => missing.includes(f.id));
  if (!list.length) return '';
  const names = list.map((f) => text(f.name));
  const joined = names.length === 1 ? names[0]! : text('{a} and {b}', { a: names.slice(0, -1).join(', '), b: names[names.length - 1]! });
  const mins = list.map((f) => MIN_COMMUNICATION[f.id]);
  // A version only when every feature's is known, and only one the server has not reached.
  const need = mins.every((m): m is string => Boolean(m)) ? mins.reduce((a, b) => (versionAtLeast(a, b) ? a : b)) : null;
  const named = need && !versionAtLeast(have, need) ? need : null;
  const one = list.length === 1 && !list[0]!.plural;
  const head = named
    ? text(one ? '{names} needs Communication module {need} or later' : '{names} need Communication module {need} or later', { names: joined, need: named })
    : text(one ? '{names} needs a newer Communication module' : '{names} need a newer Communication module', { names: joined });
  return have ? text('{head} (server has {have}).', { head, have }) : `${head}.`;
}
