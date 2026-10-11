/**
 * Who sees a message sent from the meeting's chat (the Meet Side Panel
 * canvas).
 *
 * Both audiences are transports this product already has, which is the whole
 * reason the picker can exist without a line of server work: **Everyone** is
 * the meeting's own chat, which a guest in a browser reads, and **Staff only**
 * is the meeting's workspace conversation, which a guest cannot reach at all.
 *
 * The canvas also draws a third — a private message to one person. It is
 * deliberately absent: the meeting chat table has no recipient and no audience
 * column, and a workspace direct message is a different conversation rather
 * than part of this meeting. An option that said "only Dimuthu sees it" and
 * then showed it to the room would be worse than not offering it.
 */

export type ChatAudience = 'all' | 'staff';

export interface AudienceChoice {
  id: ChatAudience;
  label: string;
  /** What it means, in the words somebody needs before pressing send. */
  help: string;
}

export const AUDIENCES: AudienceChoice[] = [
  { id: 'all', label: 'Everyone', help: 'Staff and guests in this meeting' },
  { id: 'staff', label: 'Staff only', help: 'Hidden from guests · saved to the workspace chat' },
];

/**
 * The chosen audience, or the one that is always available.
 *
 * A meeting with no workspace conversation has no Staff only to choose, and a
 * picker left pointing at it would send to a place that does not exist.
 */
export function audienceOf(id: ChatAudience, choices: AudienceChoice[] = AUDIENCES): AudienceChoice {
  return choices.find((a) => a.id === id) ?? choices[0] ?? AUDIENCES[0]!;
}
