import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet } from '../../core/api';
import { app } from '../../core/app-state';
import { askLocal, localReady, useLocalModels, type LocalMessage } from '../../core/local-ai';
import { useStore } from '../../core/store';
import { ask } from './assistant';
import { useWriter, write, writerProblem, WRITER_MAX, type WriterInfo } from './writer';

/**
 * AI writing, reply, summary and meeting-minutes tools for Mail, Chat, Web Chat and Meetings (worksuite-desktop#53),
 * on the same terms as the assistant (worksuite-desktop#52): the model on this computer first; online AI only when it
 * cannot answer and the person allows online fallback. Nothing a tool makes is sent or saved by itself — it is shown,
 * and the person chooses to use it.
 *
 * Online, a tool uses the writing assistant's own action when the server offers it (`improve`, `shorten`,
 * `professional`, `grammar`, `reply`, `summarize`, `minutes`), and otherwise asks the AI Assistant.
 */
export type TextTask = 'improve' | 'shorten' | 'professional' | 'grammar' | 'reply' | 'summarize' | 'minutes';

export const WRITING_TASKS: Array<{ task: Extract<TextTask, 'improve' | 'shorten' | 'professional' | 'grammar'>; label: string }> = [
  { task: 'improve', label: 'Improve writing' },
  { task: 'shorten', label: 'Make shorter' },
  { task: 'professional', label: 'Make professional' },
  { task: 'grammar', label: 'Fix spelling and grammar' },
];

/** What each tool asks of a model, given the material it works on. */
const INSTRUCTIONS: Record<TextTask, string> = {
  improve: 'Rewrite the text so it reads clearly and naturally. Keep its meaning, language and tone.',
  shorten: 'Rewrite the text to be noticeably shorter. Keep every important point, its language and its tone.',
  professional: 'Rewrite the text in a polite, professional tone suitable for work. Keep its meaning and language.',
  grammar: 'Correct the spelling, grammar and punctuation of the text. Change nothing else.',
  reply: 'Write the reply the person (marked "me") could send next. Write it as them, in the language and tone of the conversation, short and ready to send, with no greeting line unless the conversation uses one.',
  summarize: 'Summarise the conversation for someone who missed it, in a few short bullet points: what it is about, what was decided, and what is still open or who is doing what next.',
  minutes:
    'Write the minutes of the meeting from the material below. Use exactly these three headings, each on its own line, and nothing before them:\nSUMMARY:\n(a short paragraph)\nDECISIONS:\n(one decision per line starting with "- ", or "- None")\nACTIONS:\n(one action per line starting with "- ", with the person and due date when they are known, or "- None")',
};

const ONLY = 'Return only the result, with no introduction or explanation.';

export function localPrompt(task: TextTask, input: string): LocalMessage[] {
  return [
    { role: 'system', content: `You are WorkSuite's writing assistant. ${INSTRUCTIONS[task]} ${ONLY}` },
    { role: 'user', content: input.slice(0, WRITER_MAX) },
  ];
}

/** A model's answer, without the wrapping some models add. */
export function cleanAnswer(text: string): string {
  return text
    .trim()
    .replace(/^(?:here(?:'s| is) (?:the |a |your )?[^\n:]{0,60}:\s*\n+)/i, '')
    .replace(/^"([\s\S]*)"$/, '$1')
    .trim();
}

export interface Minutes {
  summary: string;
  decisions: string[];
  actions: string[];
}

/** The three parts of drafted minutes; anything without headings is taken as the summary. */
export function parseMinutes(text: string): Minutes {
  const part = (name: string) => {
    const m = new RegExp(`(?:^|\\n)\\s*\\**${name}\\**\\s*:\\**\\s*\\n?([\\s\\S]*?)(?=\\n\\s*\\**(?:SUMMARY|DECISIONS|ACTIONS)\\**\\s*:|$)`, 'i').exec(text);
    return m ? m[1]!.trim() : null;
  };
  const list = (s: string | null) =>
    (s ?? '')
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter((l) => l && !/^none\.?$/i.test(l));
  const summary = part('SUMMARY');
  return { summary: summary ?? cleanAnswer(text), decisions: list(part('DECISIONS')), actions: list(part('ACTIONS')) };
}

export type Engine = 'local' | 'online';

export interface TextAi {
  /** Who answers first, or null when no AI can answer — `why` then says why. */
  engine: Engine | null;
  why: string | null;
  /** Online AI may take over when the model on this computer cannot answer. */
  fallback: boolean;
  /** Everything the choice depends on is known: a tool waits for this before it runs. */
  settled: boolean;
  run(task: TextTask, input: string, onText?: (t: string) => void): TextJob;
}

export interface TextJob {
  done: Promise<{ text: string; engine: Engine }>;
  cancel(): void;
}

/** Which engines a tool may use now: the person's fallback choice, the connection, and the assistant being on for them. */
export function useTextAi(): TextAi {
  const models = useLocalModels();
  const writer = useWriter();
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const allowOnline = useStore(app, (s) => s.prefs?.ai.onlineFallback ?? true);
  const availability = useQuery({
    queryKey: ['ai', 'availability', 'assistant.panel'],
    queryFn: ({ signal }) => apiGet<{ enabled: boolean; reason: string | null }>('/api/ai/assist/availability', { surface: 'assistant.panel' }, signal),
    staleTime: 5 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && (e.forbidden || e.status === 404)) && n < 1,
  });
  const local = !!localReady(models.data);
  // Online only once the server has said so: until then a failure here sends nothing.
  const enabled = availability.data?.enabled ?? false;
  const online = allowOnline && !offline && (enabled || !!writer.data?.available);
  const why = local || online ? null : !allowOnline ? 'No model on this computer can do this yet, and online fallback is off in Settings › AI Assistant.' : offline ? 'No model on this computer can do this yet, and you are offline.' : (availability.data?.reason ?? 'No AI is set up for you yet. Set up Local AI in Settings › Local AI.');
  return {
    engine: local ? 'local' : online ? 'online' : null,
    why,
    fallback: online,
    settled: !models.isLoading && !writer.isLoading && !availability.isLoading,
    run: (task, input, onText) => runText(task, input, { local, online, writer: writer.data, onText }),
  };
}

/** One tool run: the model on this computer, then — when it fails and that is allowed — online AI. */
export function runText(task: TextTask, input: string, o: { local: boolean; online: boolean; writer?: WriterInfo; onText?: (t: string) => void; onlineFn?: typeof onlineText }): TextJob {
  let cancelLocal: (() => void) | null = null;
  let stopped = false;
  const goOnline = o.onlineFn ?? onlineText;
  const done = (async (): Promise<{ text: string; engine: Engine }> => {
    if (!input.trim()) throw new Error('There is nothing to work on yet.');
    if (o.local) {
      try {
        const job = askLocal(localPrompt(task, input), (t) => o.onText?.(t), { maxTokens: task === 'minutes' || task === 'summarize' ? 700 : 500, temperature: 0.4 });
        cancelLocal = job.cancel;
        const r = await job.done;
        if (r.cancelled || stopped) return { text: cleanAnswer(r.text), engine: 'local' };
        const text = cleanAnswer(r.text);
        if (text) return { text, engine: 'local' };
        throw new Error('The model on this computer gave no answer.');
      } catch (e) {
        if (stopped) throw e;
        if (!o.online) throw new Error(`${e instanceof Error ? e.message : 'The model on this computer could not answer.'} Online fallback is not available, so nothing was sent.`);
      }
    }
    if (!o.online) throw new Error('No AI is set up for you yet. Set up Local AI in Settings › Local AI.');
    return { text: cleanAnswer(await goOnline(task, input, o.writer)), engine: 'online' };
  })();
  return {
    done,
    cancel: () => {
      stopped = true;
      cancelLocal?.();
    },
  };
}

/** Online: the writing assistant's own action when the server has it, the AI Assistant otherwise. */
export async function onlineText(task: TextTask, input: string, writer?: WriterInfo): Promise<string> {
  const action = task === 'summarize' ? (writer?.actions.find((a) => a.key === 'summarize' || a.key === 'summary')?.key ?? null) : writer?.actions.some((a) => a.key === task) ? task : null;
  try {
    if (writer?.available && action) return await write(action, input);
    const t = await ask(`${INSTRUCTIONS[task]} ${ONLY}\n\n"""\n${input.slice(0, WRITER_MAX)}\n"""`, { surface: 'assistant.panel' });
    if (!t.ok || !t.reply) throw new Error(t.error ?? 'Online AI could not answer just now.');
    return t.reply;
  } catch (e) {
    throw new Error(writerProblem(e));
  }
}
