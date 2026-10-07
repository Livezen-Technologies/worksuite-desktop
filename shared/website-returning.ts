import type { WebchatReturnVisit } from './types';

/**
 * Returning visitors (worksuite-desktop#291): a visitor who writes again in a closed chat reopens it — or, after the
 * reopen window, starts a new one on the same profile — and is rung for like a new chat, the agent of the last one
 * first. The ring (`chat.incoming`, `assignments/pending`) says so in `returning`; an older server sends there whether
 * the browser has been here before (`true`/`false`), or nothing, and is read as no returning visit.
 */

/** `returning` on a ring, as the server sends it. */
export interface ReturningPayload {
  reopened?: boolean;
  previous_at?: string | null;
  previous_agent_id?: number | null;
  previous_agent_name?: string | null;
  previous_conversation_id?: number | null;
}

const words = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const someId = (v: unknown): number | null => ((typeof v === 'number' || typeof v === 'string') && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

/** The returning visit a ring describes, or null: none, or an older server's `returning: true`. */
export function returnVisitOf(v: unknown): WebchatReturnVisit | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  return {
    reopened: r.reopened === true,
    previousAt: words(r.previous_at, 40),
    previousAgentId: someId(r.previous_agent_id),
    previousAgentName: words(r.previous_agent_name, 120),
    previousConversationId: someId(r.previous_conversation_id),
  };
}

/** Back to the server's shape, for an event this computer makes up (a chat found ringing by reading the list). */
export function returningPayload(r: WebchatReturnVisit): ReturningPayload {
  return { reopened: r.reopened, previous_at: r.previousAt, previous_agent_id: r.previousAgentId, previous_agent_name: r.previousAgentName, previous_conversation_id: r.previousConversationId };
}

/**
 * "Returning visitor · last chat with you on 16 Aug" — with a colleague by first name ("with Nuwan"), or only "· last
 * chat on 16 Aug" when nobody had it. `day` writes a stamp's day the way its side of the app does; `say` localises.
 */
export function returningWords(r: WebchatReturnVisit, me: number | null, day: (stamp: string) => string, say: (source: string, vars?: Record<string, string | number>) => string): string {
  const date = r.previousAt ? day(r.previousAt) : '';
  if (!date) return say('Returning visitor');
  const mine = r.withYou === true || (me !== null && r.previousAgentId !== null && r.previousAgentId === me);
  if (mine) return say('Returning visitor · last chat with you on {date}', { date });
  const name = r.previousAgentName ? r.previousAgentName.trim().split(/\s+/)[0] || r.previousAgentName : null;
  return name ? say('Returning visitor · last chat with {name} on {date}', { name, date }) : say('Returning visitor · last chat on {date}', { date });
}
