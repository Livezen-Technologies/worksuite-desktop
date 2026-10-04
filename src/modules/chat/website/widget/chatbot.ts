import { apiGet, apiPost, apiPut } from '../../../../core/api';
import { text } from '../../../../core/i18n';
import { WEBSITE } from '../api';

/**
 * Widget settings › Chatbot (S-05; WS-WCHAT X-UI-18, UX-SET-07; BOT-01…06): whether the assistant answers first, its
 * name and avatar, the model, what it answers from, when it hands the chat to a person, the replies before it stops —
 * and "Try it", a test chat the server answers with the settings on screen, saving nothing and ringing nobody.
 *
 * The server's own read and save (`widgets/{id}/chatbot`), not the web's whole widget form: that one rewrites every
 * column from what it is sent. Saving sends only what was changed; the checks here mirror the server's
 * (`WidgetChatbot`) so a mistake shows beside its field before Save.
 */

export interface ChatbotSettings {
  /** "Assistant answers first" (BOT-01). */
  ai_enabled: boolean;
  /** The assistant's name, as the visitor's widget signs its messages. */
  bot_name: string | null;
  /** The face beside the assistant's (and the team's) messages on the widget. */
  avatar_url: string | null;
  /** An AI Studio model, `auto` for the organisation's default; null is none chosen, and the bot stays quiet (BOT-04). */
  ai_model: string | null;
  /** A published AI assistant answering instead, with its own knowledge bases (BOT-02); null answers from the knowledge base. */
  ai_assistant_id: number | null;
  /** Hand to a person after this many replies; 0 is when the visitor asks or it is not sure (BOT-05). */
  ai_handover_after: number;
  /** 1–20 (BOT-01). */
  ai_max_replies: number;
}

export interface ChatbotPayload {
  settings: ChatbotSettings;
  /** Whether the server has the bot's columns. */
  installed: boolean;
  /** The knowledge base's live articles for this site and every site; null without a knowledge base on the server. */
  articles: number | null;
  can_manage: boolean;
}

/** A published AI assistant, as the AI module lists them. */
export interface Assistant {
  id: number;
  name: string;
  status: string;
  model: string;
}

/** What "Try it" answered (S-05): the reply, or why there was none. */
export type TryOutcome = 'answered' | 'handover' | 'stopped' | 'quiet' | 'no_model' | 'unpublished' | 'unavailable';

export interface TryTurn {
  from: 'visitor' | 'bot';
  body: string;
}

export const AUTO = 'auto';
export const AUTO_LABEL = 'Organisation default (AI Gateway)';
export const REPLIES = [1, 20] as const;
export const HANDOVER_MAX = 20;
/** The hand-off the design shows: no count, the visitor asks or it is not sure. */
export const HANDOVER_ASKS = "The visitor asks, or it isn't sure";

export const chatbotOf = (id: number, signal?: AbortSignal) => apiGet<ChatbotPayload>(`${WEBSITE}/widgets/${id}/chatbot`, undefined, signal);
export const saveChatbot = (id: number, fields: Partial<ChatbotSettings>) => apiPut<ChatbotPayload>(`${WEBSITE}/widgets/${id}/chatbot`, fields);
export const modelsOf = (id: number, signal?: AbortSignal) => apiGet<{ configured: boolean; models: string[] }>(`${WEBSITE}/widgets/${id}/chatbot/models`, undefined, signal);
export const tryChatbot = (id: number, message: string, history: TryTurn[], settings: Partial<ChatbotSettings>) =>
  apiPost<{ outcome: TryOutcome; reply: string | null }>(`${WEBSITE}/widgets/${id}/chatbot/try`, { message, history, settings });

/** The published assistants the widget may answer through; none when AI is not on this server or not for this person. */
export async function assistantsOf(signal?: AbortSignal): Promise<Assistant[]> {
  try {
    const d = await apiGet<{ assistants: Assistant[] }>('/api/ai/assistants', undefined, signal);
    return (d.assistants ?? []).filter((a) => a.status === 'published');
  } catch {
    return [];
  }
}

/** What changed between the saved settings and the draft: all a save sends. */
export function changedChatbot(saved: ChatbotSettings, draft: ChatbotSettings): Partial<ChatbotSettings> {
  const out: Partial<ChatbotSettings> = {};
  for (const k of Object.keys(draft) as Array<keyof ChatbotSettings>) {
    if (draft[k] !== saved[k]) (out as Record<string, unknown>)[k] = draft[k];
  }
  return out;
}

/** What is wrong, field by field, before the server is asked. */
export function chatbotProblems(s: ChatbotSettings): Partial<Record<keyof ChatbotSettings, string>> {
  const out: Partial<Record<keyof ChatbotSettings, string>> = {};
  if (s.avatar_url && !/^https?:\/\/\S+$/i.test(s.avatar_url.trim())) out.avatar_url = 'The avatar must be a web address starting with https://';
  if (!Number.isInteger(s.ai_max_replies) || s.ai_max_replies < REPLIES[0] || s.ai_max_replies > REPLIES[1]) out.ai_max_replies = 'Replies before it stops must be 1 to 20';
  return out;
}

const replies = (n: number) => (n === 1 ? '1 reply' : text('{n} replies', { n }));

/** "Hand to a person after": the visitor asks or it is not sure, else after 1–10 replies (and whatever is saved). */
export function handoverOptions(current: number): Array<{ value: number; label: string }> {
  const counts = Array.from({ length: 10 }, (_, i) => i + 1);
  if (current > 10 && !counts.includes(current)) counts.push(current);
  return [{ value: 0, label: HANDOVER_ASKS }, ...counts.map((n) => ({ value: n, label: replies(n) }))];
}

/** "Model": the organisation's default, AI Studio's models, and the saved one when the hub no longer lists it. */
export function modelOptions(models: string[], current: string | null): Array<{ value: string; label: string }> {
  const names = models.filter((m) => m && m !== AUTO);
  if (current && current !== AUTO && !names.includes(current)) names.unshift(current);
  return [{ value: AUTO, label: AUTO_LABEL }, ...names.map((m) => ({ value: m, label: m }))];
}

/** "Answers from": the knowledge base (0) and each published assistant; one no longer published says so. */
export function sourceOptions(articles: number | null, assistants: Assistant[], current: number | null): Array<{ value: number; label: string }> {
  const kb = articles === null ? 'Support › Knowledge base' : text(articles === 1 ? 'Support › Knowledge base · {n} article' : 'Support › Knowledge base · {n} articles', { n: articles });
  const out = [{ value: 0, label: kb }, ...assistants.map((a) => ({ value: a.id, label: text('{name} · AI assistant', { name: a.name }) }))];
  if (current && !assistants.some((a) => a.id === current)) out.push({ value: current, label: text('Assistant #{id} · not published', { id: current }) });
  return out;
}

/** The line a test chat shows when the assistant does not answer (S-05's "Handed to a person · ringing the team"). */
export function outcomeLine(o: TryOutcome): string | null {
  switch (o) {
    case 'handover':
      return 'Handed to a person · ringing the team';
    case 'stopped':
      return 'Out of replies · a person picks it up';
    case 'quiet':
      return 'Nothing in what it knows answers this · a person picks it up';
    case 'no_model':
      return 'Choose a model to try it';
    case 'unpublished':
      return 'That assistant is not published · it stays quiet';
    case 'unavailable':
      return 'AI is not connected on this server · it stays quiet';
    default:
      return null;
  }
}
