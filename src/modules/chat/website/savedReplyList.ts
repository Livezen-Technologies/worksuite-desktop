import { apiDelete, apiPost, apiPut } from '../../../core/api';
import { text } from '../../../core/i18n';
import { WEBSITE } from './api';
import type { SavedReply } from './profile';

/**
 * Website chats › Saved replies (S-09; WS-WCHAT X-UI-21, UX-SET-10; CAN-01, RDC-03): the team's ready answers, each
 * with a shortcut typed after "/" in a chat, a title and the words; for every widget or for one; and how often it was
 * used this month. A new one is `POST canned`, a change `PUT canned/{id}`, Delete is `DELETE`.
 */

export interface ReplyDraft {
  title: string;
  /** Without its "/". */
  shortcut: string;
  body: string;
  /** Null: every widget. */
  widget_id: number | null;
}

export const TITLE_MAX = 120;
export const SHORTCUT_MAX = 40;
export const BODY_MAX = 5000;

export const createReply = (d: ReplyDraft) => apiPost<{ id: number; response?: SavedReply }>(`${WEBSITE}/canned`, d);
export const saveReply = (id: number, d: ReplyDraft) => apiPut<{ response?: SavedReply } | null>(`${WEBSITE}/canned/${id}`, d);
export const deleteReply = (id: number) => apiDelete(`${WEBSITE}/canned/${id}`);

/** The list in the shortcut's order, as the design lists them. */
export const byShortcut = (list: SavedReply[]) => [...list].sort((a, b) => (a.shortcut ?? '').localeCompare(b.shortcut ?? '') || a.id - b.id);

/** A shortcut as the server keeps it: lower case, no "/", spaces as dashes. */
export const cleanShortcut = (s: string) => s.trim().replace(/^\/+/, '').toLowerCase().replace(/\s+/g, '-');

export function draftOfReply(r: SavedReply | null): ReplyDraft {
  return { title: r?.title ?? '', shortcut: r?.shortcut ?? '', body: r?.body ?? '', widget_id: r?.widget_id ?? null };
}

/** What is wrong before the server is asked; the server's own words. */
export function replyProblems(d: ReplyDraft, all: SavedReply[], id: number | null): Partial<Record<keyof ReplyDraft, string>> {
  const out: Partial<Record<keyof ReplyDraft, string>> = {};
  const sc = cleanShortcut(d.shortcut);
  if (!/^[a-z0-9-]{2,40}$/.test(sc)) out.shortcut = 'A shortcut is lower-case letters, digits and dashes';
  else if (all.some((r) => r.id !== id && r.shortcut === sc)) out.shortcut = 'That shortcut is already used';
  if (!d.title.trim()) out.title = 'A title and body are required';
  if (!d.body.trim()) out.body = 'A title and body are required';
  return out;
}

/** "Used 54 times this month", "Used once this month", "Not used this month"; null from a server that does not count. */
export function monthLine(r: Pick<SavedReply, 'month_uses'> | null): string | null {
  if (!r || r.month_uses === undefined) return null;
  if (r.month_uses === 0) return 'Not used this month';
  return r.month_uses === 1 ? 'Used once this month' : text('Used {n} times this month', { n: r.month_uses });
}

/** What the IN THE COMPOSER preview has typed: the first letters of the shortcut, "/edu". */
export const typedFor = (shortcut: string) => cleanShortcut(shortcut).slice(0, 3);
