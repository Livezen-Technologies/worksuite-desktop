import { apiDelete, apiGet, apiPost, apiPut } from '../../../core/api';
import { text } from '../../../core/i18n';
import { WEBSITE } from './api';

/**
 * Website chats › Automated messages (S-07; WS-WCHAT X-UI-19, UX-SET-08; TRG-01…03): the rules that send a message on
 * their own — every widget's, each with its on/off switch and "Sent 212 · 31 replied" — and the editor: WHEN (the
 * condition and the seconds on the page), the widget, how often ("Once per visit", never to a visitor already chatting)
 * and MESSAGE (who it posts as, and the words).
 *
 * The server's rules (`triggers`): a new one is `POST`, a change `PUT` with only what changed (the server keeps the
 * rest), and Delete is `DELETE`. The browser decides when a rule matches; the server decides whether it may send
 * (TRG-02).
 */

export type TriggerEvent = 'page_match' | 'time_on_page' | 'time_on_site' | 'returning' | 'exit_intent';
export type PostsAs = 'widget' | 'assistant';

export interface Rule {
  id: number;
  widget_id: number;
  /** The widget's website name, or its name. */
  site: string;
  /** The widget's own name ("Techubiz support"); from S-07. */
  widget_name?: string;
  name: string;
  is_active: boolean;
  event: TriggerEvent;
  /** Seconds on the page (on the site for `time_on_site`) before it sends; 3–3600. Not used by `exit_intent`. */
  seconds: number;
  /** `page_match`: what the address contains. */
  match_text: string | null;
  message: string;
  /** "Once per visit"; off is once per visitor, ever. */
  repeatable: boolean;
  /** Never to a visitor already chatting. */
  skip_if_chatting: boolean;
  only_in_hours: boolean;
  /** Who it appears from; from S-07 (before it, every rule posted as the assistant). */
  posts_as?: PostsAs;
  /** Sent. */
  fires: number;
  /** Visitors it reached who wrote to the team afterwards; from S-07. */
  replied?: number;
}

/** What the editor changes. */
export type RuleDraft = Pick<Rule, 'widget_id' | 'name' | 'is_active' | 'event' | 'seconds' | 'match_text' | 'message' | 'repeatable' | 'skip_if_chatting' | 'only_in_hours'> & { posts_as: PostsAs };

export interface RulesPayload {
  triggers: Rule[];
  can: { view: boolean; reply: boolean; manage: boolean };
}

export const SECONDS = [3, 3600] as const;

export const rulesOf = (signal?: AbortSignal) => apiGet<RulesPayload>(`${WEBSITE}/triggers`, undefined, signal);
export const createRule = (d: RuleDraft) => apiPost<{ id: number; trigger?: Rule }>(`${WEBSITE}/triggers`, d);
export const saveRule = (id: number, fields: Partial<RuleDraft>) => apiPut<{ trigger?: Rule } | null>(`${WEBSITE}/triggers/${id}`, fields);
export const deleteRule = (id: number) => apiDelete(`${WEBSITE}/triggers/${id}`);

/** The conditions, as the editor's first list words them: "Address contains ▾ /pricing and they have been on the page…". */
export const EVENTS: Array<{ value: TriggerEvent; label: string }> = [
  { value: 'page_match', label: 'Address contains' },
  { value: 'time_on_page', label: 'Any page' },
  { value: 'time_on_site', label: 'Anywhere on the site' },
  { value: 'returning', label: 'Returning visitor' },
  { value: 'exit_intent', label: 'About to leave' },
];

/** "Send it". */
export const FREQUENCIES: Array<{ value: 'visit' | 'visitor'; label: string }> = [
  { value: 'visit', label: 'Once per visit' },
  { value: 'visitor', label: 'Once per visitor' },
];

/** The words after the condition, before the seconds; none for a visitor about to leave. */
export function delayWords(e: TriggerEvent): string | null {
  if (e === 'exit_intent') return null;
  return e === 'time_on_site' ? 'and they have been on the site for' : 'and they have been on the page for';
}

/** "The widget (Techubiz support)", "The assistant (Aria)". */
export function postsAsOptions(widgetName: string, botName: string | null | undefined): Array<{ value: PostsAs; label: string }> {
  return [
    { value: 'widget', label: text('The widget ({name})', { name: widgetName }) },
    { value: 'assistant', label: botName ? text('The assistant ({name})', { name: botName }) : 'The assistant' },
  ];
}

/** The list's second line: "Address contains /pricing · after 30 s · once per visit". */
export function ruleSummary(r: Pick<Rule, 'event' | 'match_text' | 'seconds' | 'repeatable'>): string {
  const what = r.event === 'page_match' ? text('Address contains {text}', { text: r.match_text ?? '' }) : (EVENTS.find((e) => e.value === r.event)?.label ?? r.event);
  const parts = [what];
  if (r.event !== 'exit_intent') parts.push(text('after {n} s', { n: r.seconds }));
  if (r.repeatable) parts.push('once per visit');
  return parts.join(' · ');
}

/** The list's third line: "Sent 212 · 31 replied", or "Paused". */
export function ruleCounts(r: Pick<Rule, 'is_active' | 'fires' | 'replied'>): string {
  if (!r.is_active) return 'Paused';
  return r.replied === undefined ? text('Sent {n}', { n: r.fires }) : text('Sent {n} · {m} replied', { n: r.fires, m: r.replied });
}

export function draftOf(r: Rule): RuleDraft {
  return {
    widget_id: r.widget_id, name: r.name, is_active: r.is_active, event: r.event, seconds: r.seconds, match_text: r.match_text ?? '',
    message: r.message, repeatable: r.repeatable, skip_if_chatting: r.skip_if_chatting, only_in_hours: r.only_in_hours, posts_as: r.posts_as ?? 'assistant',
  };
}

/** A new rule as the design's editor starts one: on, after 30 seconds, once per visit, never while chatting, as the widget. */
export function newRule(widgetId: number): RuleDraft {
  return {
    widget_id: widgetId, name: '', is_active: true, event: 'page_match', seconds: 30, match_text: '', message: '', repeatable: true,
    skip_if_chatting: true, only_in_hours: false, posts_as: 'widget',
  };
}

/** What changed: all an edit sends. */
export function changedRule(saved: RuleDraft, draft: RuleDraft): Partial<RuleDraft> {
  const out: Partial<RuleDraft> = {};
  for (const k of Object.keys(draft) as Array<keyof RuleDraft>) {
    if ((draft[k] ?? '') !== (saved[k] ?? '')) (out as Record<string, unknown>)[k] = draft[k];
  }
  return out;
}

/** What is wrong, field by field, before the server is asked; the server's own words. */
export function ruleProblems(d: RuleDraft): Partial<Record<keyof RuleDraft, string>> {
  const out: Partial<Record<keyof RuleDraft, string>> = {};
  if (!d.name.trim()) out.name = 'Name this rule';
  if (!d.message.trim()) out.message = 'Write the message it sends';
  if (d.event === 'page_match' && !(d.match_text ?? '').trim()) out.match_text = 'Give the text the address must contain';
  if (d.event !== 'exit_intent' && (!Number.isInteger(d.seconds) || d.seconds < SECONDS[0] || d.seconds > SECONDS[1])) out.seconds = text('{min} to {max} seconds', { min: SECONDS[0], max: SECONDS[1] });
  if (!d.widget_id) out.widget_id = 'Choose a widget';
  return out;
}
