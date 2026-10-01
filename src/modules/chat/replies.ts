import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet } from '../../core/api';
import { askLocal, localReady, type LocalMessage } from '../../core/local-ai';
import type { LocalModelView } from '@shared/local-ai';
import { write, writerProblem, WRITER_MAX, type WriterInfo } from '../ai/writer';
import type { SavedReply } from './website/profile';

/**
 * The composer's "/" menu (worksuite-desktop#32): Load saved replies and Suggest reply.
 *
 * Saved replies: a website conversation uses the website chat's saved replies, as it always has; Team Chat and
 * WhatsApp use `GET /api/chat/saved-replies` → `{ replies: SavedReply[] }`. A server without that endpoint (404) or
 * a person without access (403) gets the empty state, not an error.
 *
 * Suggest reply: the model on this computer when one is ready (Local AI — the conversation stays here), otherwise
 * the workspace's writing assistant when it offers the `reply` action (`POST /api/ai/write {action: 'reply'}`).
 * Nothing is ever sent: a suggestion goes into the box, where it can be changed, and is sent only by Send.
 */

/** One message of the conversation, as the suggestion sees it. */
export interface Turn {
  mine: boolean;
  name: string;
  text: string;
}

export type RepliesState =
  | { state: 'loading' }
  | { state: 'error'; message: string; retry: () => void }
  | { state: 'ready'; replies: SavedReply[]; note?: string };

/** Team Chat's and WhatsApp's saved replies, fetched once the menu asks for them. */
export function useChatSavedReplies(enabled: boolean): RepliesState {
  const q = useQuery({
    queryKey: ['chat', 'saved-replies'],
    queryFn: async ({ signal }) => {
      try {
        const r = await apiGet<{ replies?: SavedReply[] }>('/api/chat/saved-replies', undefined, signal);
        return { replies: r.replies ?? [], missing: false };
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.forbidden)) return { replies: [] as SavedReply[], missing: true };
        throw e;
      }
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (q.data) return { state: 'ready', replies: q.data.replies, note: q.data.missing ? 'Saved replies are not set up on your WorkSuite server yet.' : undefined };
  if (q.error) return { state: 'error', message: q.error instanceof Error ? q.error.message : 'The saved replies could not be loaded.', retry: () => void q.refetch() };
  return { state: 'loading' };
}

/** The menu's two actions, and the words that find them after a "/". */
export const SLASH_ACTIONS = [
  { key: 'saved', label: 'Load saved replies', hint: 'Browse and search your saved replies', icon: 'bookmark', words: ['load', 'saved', 'replies'] },
  { key: 'suggest', label: 'Suggest reply', hint: 'Ideas from this conversation', icon: 'sparkles', words: ['suggest', 'reply', 'ai'] },
] as const;
export type SlashAction = (typeof SLASH_ACTIONS)[number]['key'];

export function matchActions(word: string): Array<(typeof SLASH_ACTIONS)[number]> {
  const w = word.toLowerCase();
  return SLASH_ACTIONS.filter((a) => !w || a.words.some((x) => x.startsWith(w)));
}

/** The last messages with text, oldest first, short enough for one request. */
export function transcript(turns: Turn[], limit = 20): string {
  const lines = turns
    .filter((t) => t.text.trim())
    .slice(-limit)
    .map((t) => `${t.mine ? `${t.name} (me)` : t.name}: ${t.text.replace(/\s+/g, ' ').trim().slice(0, 500)}`);
  // Keep the newest when it is too long.
  while (lines.join('\n').length > WRITER_MAX - 200 && lines.length > 1) lines.shift();
  return lines.join('\n');
}

export function suggestionPrompt(turns: Turn[]): LocalMessage[] {
  return [
    {
      role: 'system',
      content:
        'You help someone answer a chat. Suggest 3 different short replies they could send next, written as them, in the language and tone of the conversation. ' +
        'Write each on its own line starting with "1.", "2." and "3.". Write nothing else.',
    },
    { role: 'user', content: `The conversation so far:\n${transcript(turns)}\n\nThree replies I could send next:` },
  ];
}

/** Up to three replies from a model's answer: numbered or bulleted lines, else the whole answer. */
export function parseSuggestions(answer: string, max = 3): string[] {
  const clean = (s: string) => s.replace(/^\s*(?:\d+\s*[.):]|[-*•])\s*/, '').replace(/^\s*(?:reply\s*\d*\s*:)\s*/i, '').replace(/^["“'](.*)["”']$/s, '$1').trim();
  const lines = answer.split(/\r?\n/).filter((l) => l.trim());
  const listed = lines.filter((l) => /^\s*(?:\d+\s*[.):]|[-*•])\s+/.test(l));
  const picked = (listed.length ? listed : lines.length > 1 && lines.length <= max ? lines : [answer]).map(clean).filter(Boolean);
  return [...new Set(picked)].slice(0, max);
}

/** Which AI would answer: the model on this computer, else the workspace's writing assistant, else none. */
export function suggestEngine(models: LocalModelView[] | undefined, writer: WriterInfo | undefined): 'local' | 'server' | null {
  if (localReady(models)) return 'local';
  if (writer?.available && writer.actions.some((a) => a.key === 'reply')) return 'server';
  return null;
}

export const NO_AI = 'No AI is set up for suggestions. Set up Local AI in Settings › AI Assistant, or ask your administrator to connect AI for this workspace.';

export interface SuggestJob {
  done: Promise<string[]>;
  cancel(): void;
}

/** Asks for suggestions; the model on this computer first, and the workspace's assistant if that fails. */
export function suggestReplies(turns: Turn[], engine: 'local' | 'server' | null, serverToo: boolean): SuggestJob {
  if (!turns.some((t) => t.text.trim())) return { done: Promise.reject(new Error('There is nothing in this conversation to reply to yet.')), cancel: () => undefined };
  const server = async () => {
    try {
      return parseSuggestions(await write('reply', transcript(turns)));
    } catch (e) {
      throw new Error(writerProblem(e));
    }
  };
  if (engine === 'local') {
    const job = askLocal(suggestionPrompt(turns), () => undefined, { maxTokens: 300, temperature: 0.7 });
    const done = job.done.then(
      (r) => {
        const list = parseSuggestions(r.text);
        if (!list.length) throw new Error('The model did not suggest anything. Try again.');
        return list;
      },
      (e: unknown) => (serverToo ? server() : Promise.reject(e instanceof Error ? e : new Error(String(e)))),
    );
    return { done, cancel: () => job.cancel() };
  }
  if (engine === 'server') return { done: server(), cancel: () => undefined };
  return { done: Promise.reject(new Error(NO_AI)), cancel: () => undefined };
}
