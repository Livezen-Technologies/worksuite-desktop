import { apiDelete, apiGet, apiPost, apiPut } from '../../../core/api';
import { WEBSITE } from './api';

/**
 * Website chats › Conversation starters (S-08; WS-WCHAT X-UI-20, UX-SET-09; STR-01…04): the buttons under a widget's
 * welcome message. A starter with an instant answer replies at once, signed by the assistant; without one, the
 * question waits for an agent. Each counts how often it was pressed.
 *
 * The server's starters (`starters`): every widget's, in order; a new one is `POST`, a change `PUT` with only what
 * changed (the switch sends `is_active` alone), the order `PUT starters/order` with the widget's starters in their new
 * order, and Delete is `DELETE`. The widget shows the first eight that are on.
 */

export interface Starter {
  id: number;
  widget_id: number;
  site: string;
  /** The button's words. */
  label: string;
  /** What is posted in the transcript when it is pressed, when longer than the button; kept as it is here. */
  question: string | null;
  /** The instant answer; null: an agent replies. */
  answer: string | null;
  sort_order: number;
  is_active: boolean;
  /** Pressed. */
  clicks: number;
}

export interface StartersPayload {
  starters: Starter[];
  can: { view: boolean; reply: boolean; manage: boolean };
}

/** What the editor changes: the design's Title, Order and Instant answer. */
export interface StarterDraft {
  label: string;
  answer: string;
  /** Its place in the widget's list, from 1. */
  order: number;
}

/** The most starters the widget shows (the server's own limit). */
export const MAX_ACTIVE = 8;
export const LABEL_MAX = 80;
export const ANSWER_MAX = 4000;

export const startersOf = (signal?: AbortSignal) => apiGet<StartersPayload>(`${WEBSITE}/starters`, undefined, signal);
export const createStarter = (widgetId: number, d: { label: string; answer: string; is_active: boolean; sort_order: number }) => apiPost<{ id: number }>(`${WEBSITE}/starters`, { widget_id: widgetId, ...d });
export const saveStarter = (id: number, fields: Partial<{ label: string; answer: string; is_active: boolean }>) => apiPut(`${WEBSITE}/starters/${id}`, fields);
export const reorderStarters = (widgetId: number, ids: number[]) => apiPut(`${WEBSITE}/starters/order`, { widget_id: widgetId, ids });
export const deleteStarter = (id: number) => apiDelete(`${WEBSITE}/starters/${id}`);

/** One widget's starters, in the order the widget shows them. */
export function startersFor(all: Starter[], widgetId: number): Starter[] {
  return all.filter((s) => s.widget_id === widgetId).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}

/** The list's INSTANT ANSWER column: the answer, or "An agent will reply". */
export const answerLine = (s: Pick<Starter, 'answer'>) => s.answer?.trim() || 'An agent will reply';

/** The ids with one moved from `from` to `to` (0-based), as a drag or the Order field leaves them. */
export function moved(ids: number[], from: number, to: number): number[] {
  const out = [...ids];
  const [it] = out.splice(from, 1);
  if (it === undefined) return ids;
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it);
  return out;
}

/** What is wrong before the server is asked; the server's own words. */
export function starterProblems(d: StarterDraft, count: number): Partial<Record<keyof StarterDraft, string>> {
  const out: Partial<Record<keyof StarterDraft, string>> = {};
  if (!d.label.trim()) out.label = 'Give the button some words';
  else if (d.label.trim().length > LABEL_MAX) out.label = 'Keep the button under 80 characters — it has to fit on a phone';
  if (d.answer.trim().length > ANSWER_MAX) out.answer = 'Keep the answer under 4000 characters';
  if (!Number.isInteger(d.order) || d.order < 1 || d.order > count) out.order = `1 to ${count}`;
  return out;
}

/** The labels the preview shows: the starters that are on, in order, with the one being edited as it now reads. */
export function previewLabels(list: Starter[], editing: { id: number | null; label: string; order: number } | null): string[] {
  let rows = list.map((s) => ({ id: s.id, label: s.label, on: s.is_active }));
  if (editing) {
    const at = rows.findIndex((r) => r.id === editing.id);
    const item = at >= 0 ? { ...rows[at]!, label: editing.label.trim() || rows[at]!.label } : { id: -1, label: editing.label.trim(), on: true };
    if (at >= 0) rows.splice(at, 1);
    rows.splice(Math.max(0, Math.min(rows.length, editing.order - 1)), 0, item);
    rows = rows.filter((r) => r.label);
  }
  return rows.filter((r) => r.on).map((r) => r.label).slice(0, MAX_ACTIVE);
}
