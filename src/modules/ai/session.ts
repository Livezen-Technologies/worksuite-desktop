import { askLocal } from '../../core/local-ai';
import { createStore, type Store } from '../../core/store';
import { ask, assistantProblem, pickFile, type AskTurn, type Surface } from './assistant';
import { runLocalAgent, runTool, toolsSystem, type AiTool } from './tools';

export interface AskEntry {
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
  turn?: AskTurn;
  /** Answered by the model on this computer. */
  local?: boolean;
  /** Answered online, and why the model on this computer did not (worksuite-desktop#53). */
  fallback?: string;
  /** Online AI was needed and could not be used: offer Local AI's setup beside Try again. */
  needsSetup?: boolean;
  /** Help & Guide (worksuite-desktop#54): answered with this guide from the app, and others that also match. */
  guide?: string;
  others?: string[];
  /** A how-to question no guide covers: say so and offer the assistant anyway, or support. */
  noGuide?: boolean;
  /** The question a guide or noGuide entry answers. */
  question?: string;
  /** A failed answer: what to send again for Try again. */
  retry?: { full: string; opts: SendOptions };
}

export interface AskFile {
  ref: string;
  name: string;
  via: 'upload' | 'drive';
}

export interface AskState {
  entries: AskEntry[];
  conversationId: number | null;
  /** The question being written. */
  text: string;
  busy: boolean;
  /** A local answer as it grows; null when none is streaming. */
  streaming: string | null;
  useTab: boolean;
  /** The tab record `useTab` was last reset for: a new record turns it back on. */
  tabRef: string | null;
  files: AskFile[];
  fileError: string | null;
  /** Answers that arrived while no panel showed the conversation. */
  unread: number;
  /** Panels showing the conversation now (the drawer, the widget). */
  viewers: number;
}

/**
 * How a question is answered (worksuite-desktop#53): one assistant, the model on this computer first.
 * `local` — that model can answer now. `online` — WorkSuite AI may be used: the person allows online fallback, there
 * is a connection, and the assistant is switched on for them; `onlineWhy` says why not when it may not.
 */
export interface SendOptions {
  surface: Surface;
  refs: string[];
  local: boolean;
  online: boolean;
  onlineWhy?: string | null;
  /** Quick Ask: the text selected in the other app, sent with the first question only. */
  selection?: string;
  /** Local AI with module functions (worksuite-desktop#51): what it may call, and why a call is refused. */
  localTools?: { tools: AiTool[]; allow: (t: AiTool) => string | null; off: string[] };
  /** WorkSuite AI: the modules this person switched off (Settings › AI Assistant › Module Access). */
  moduleAccess?: { read: string[]; write: string[] };
  /** Said to the model before the question: the guide being followed, that instructions are wanted, the language. */
  context?: string;
}

const LOCAL_SYSTEM = 'You are WorkSuite\'s assistant, running on this computer. Answer clearly and briefly. You cannot see the person\'s WorkSuite data or change anything right now (WorkSuite\'s module functions need a connection, and the modules turned on in Settings › AI Assistant › Module Access); say so when a question needs it.';

const fresh = (): AskState => ({ entries: [], conversationId: null, text: '', busy: false, streaming: null, useTab: true, tabRef: null, files: [], fileError: null, unread: 0, viewers: 0 });

/** Thrown when the model on this computer did not answer; `acted` when a WorkSuite function already ran. */
class LocalFailed extends Error {
  constructor(message: string, readonly acted: boolean) {
    super(message);
  }
}

/**
 * What online AI is given of an exchange it was not part of: the turns answered on this computer since its last
 * answer, so a switch keeps the conversation (worksuite-desktop#53).
 */
export function carriedOver(before: AskEntry[]): string {
  let i = before.length;
  while (i > 0 && !(before[i - 1]!.role === 'assistant' && !before[i - 1]!.local && !before[i - 1]!.error)) i--;
  const lines = before.slice(i).filter((e) => !e.error && e.text.trim()).slice(-12).map((e) => `${e.role === 'user' ? 'Me' : 'Assistant'}: ${e.text.trim().slice(0, 1500)}`);
  return lines.length ? `Earlier in this conversation:\n${lines.join('\n')}\n\n` : '';
}

/**
 * One conversation with the assistant, kept outside any panel: the drawer and the floating widget show the same
 * one, and closing, minimising or switching between them loses nothing — not the messages, the question being
 * written, the files picked, nor an answer on its way, which lands here whether or not a panel is open.
 */
export interface AskSession {
  store: Store<AskState>;
  /** Asks the question in the box — or `question`, when given (Ask the assistant anyway). */
  send(opts: SendOptions, question?: string): Promise<void>;
  /** A how-to question answered with a guide from the app, no model asked (worksuite-desktop#54). */
  showGuide(question: string | null, guide: string, text: string, others?: string[]): void;
  /** A how-to question no guide covers. */
  noGuide(question: string): void;
  /** Asks the question whose answer failed again, in place of the failure. */
  retry(): Promise<void>;
  /** Stops a local answer (the model on this computer); a server answer cannot be called back. */
  cancel(): void;
  attach(): Promise<void>;
  /** A new conversation — only between answers. */
  reset(): void;
  /** A panel shows the conversation: what arrived meanwhile is read. Returns the function that says it closed. */
  view(): () => void;
  /** Called with each answer that arrives while no panel shows the conversation. */
  onUnseen(fn: (entry: AskEntry) => void): () => void;
}

export function createAskSession(): AskSession {
  const store = createStore<AskState>(fresh());
  let running: { cancel(): void } | null = null;
  const unseen = new Set<(entry: AskEntry) => void>();

  const answered = (entry: AskEntry) => {
    const hidden = store.get().viewers === 0;
    store.set((s) => ({ entries: [...s.entries, entry], unread: hidden ? s.unread + 1 : s.unread }));
    if (hidden) for (const fn of unseen) fn(entry);
  };

  /** The model on this computer: an answer entry, or LocalFailed. */
  const runLocal = async (full: string, opts: SendOptions, before: AskEntry[]): Promise<AskEntry> => {
    // The whole conversation, whichever answered each turn.
    const history = before.filter((x) => !x.error).map((x) => ({ role: x.role, content: x.text }));
    store.set({ streaming: '' });
    const lt = opts.localTools;
    let acted = false;
    try {
      if (lt?.tools.length) {
        // With WorkSuite's module functions: the model decides, WorkSuite runs them as the person.
        const system = toolsSystem(lt.tools, lt.off, new Date().toDateString());
        const a = await runLocalAgent({
          messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: full }],
          tools: lt.tools,
          allow: lt.allow,
          ask: (m, onText) => askLocal(m, onText),
          onText: (t) => store.set({ streaming: t }),
          onCancelSet: (c) => (running = { cancel: c }),
          run: (name, args) => ((acted = true), runTool(name, args)),
        });
        const turn: AskTurn = { conversation_id: null, ok: true, reply: a.text, error: null, sources: a.sources, tool_runs: a.tools, pending_actions: a.actions };
        if (!a.text && !a.cancelled && !a.tools.length) throw new Error('The model on this computer gave no answer.');
        return { role: 'assistant', text: a.text || (a.cancelled ? 'Stopped.' : ''), local: true, turn };
      }
      const r = askLocal([{ role: 'system', content: LOCAL_SYSTEM }, ...history, { role: 'user', content: full }], (t) => store.set({ streaming: t }));
      running = r;
      const a = await r.done;
      if (!a.text.trim() && !a.cancelled) throw new Error('The model on this computer gave no answer.');
      return { role: 'assistant', text: a.text.trim() || 'Stopped.', local: true };
    } catch (err) {
      throw new LocalFailed(assistantProblem(err), acted);
    } finally {
      running = null;
      store.set({ streaming: null });
    }
  };

  /**
   * One answer to `full`, with the conversation before it (`before`) as it stood (worksuite-desktop#53): the model on
   * this computer when it can, online AI when it cannot and the person allows it. Never both for one question once a
   * WorkSuite function has run, so nothing is done twice; a module that is off or a missing permission is an answer,
   * not a failure, and is never a reason to go online.
   */
  const run = async (full: string, opts: SendOptions, before: AskEntry[]) => {
    const retry = { full, opts };
    store.set({ busy: true });
    try {
      // Files and the tab beside it are read by WorkSuite AI; the model on this computer cannot see them.
      const needsServer = opts.refs.length > 0;
      let why: string;
      if (opts.local && !needsServer) {
        try {
          answered(await runLocal(full, opts, before));
          return;
        } catch (err) {
          const f = err as LocalFailed;
          if (f.acted || !opts.online) {
            answered({ role: 'assistant', text: f.acted ? `${f.message} Part of it may already have run in WorkSuite, so it was not repeated online. Check before trying again.` : `${f.message}${opts.onlineWhy ? ` ${opts.onlineWhy}` : ''}`, error: true, local: true, retry });
            return;
          }
          why = 'The model on this computer could not answer, so online AI did.';
        }
      } else if (needsServer) {
        why = 'Files and this tab are read by WorkSuite AI, online.';
      } else {
        why = 'No model on this computer can answer yet, so online AI did.';
      }
      if (!opts.online) {
        const reason = needsServer ? 'Files and this tab can only be read by WorkSuite AI, online.' : 'No model on this computer can answer yet.';
        answered({ role: 'assistant', text: `${reason} ${opts.onlineWhy ?? 'Online AI is not available.'}`, error: true, needsSetup: !opts.local, retry });
        return;
      }
      // What was said on this computer goes along, the first time online AI answers after it.
      const context = carriedOver(before);
      const t = await ask(context + full, { surface: opts.surface, refs: opts.refs, conversationId: store.get().conversationId, moduleAccess: opts.moduleAccess });
      store.set({ conversationId: t.conversation_id });
      answered(t.ok ? { role: 'assistant', text: t.reply ?? '', turn: t, fallback: opts.local || needsServer ? why : undefined } : { role: 'assistant', text: t.error ?? 'The assistant could not answer just now.', error: true, retry });
    } catch (err) {
      answered({ role: 'assistant', text: assistantProblem(err), error: true, retry });
    } finally {
      store.set({ busy: false });
    }
  };

  const send = async (opts: SendOptions, question?: string) => {
    const s = store.get();
    const q = (question ?? s.text).trim();
    if (!q || s.busy) return;
    const { selection } = opts;
    // A selection from another app goes with the question, fenced, as material to work on.
    const asked = selection && selection.trim() && s.entries.length === 0 ? `${q}\n\nThe text I selected:\n"""\n${selection.trim().slice(0, 6000)}\n"""` : q;
    const full = opts.context ? `${opts.context}\n\nQuestion: ${asked}` : asked;
    store.set({ text: question === undefined ? '' : s.text, entries: [...s.entries, { role: 'user', text: q }] });
    await run(full, opts, s.entries);
  };

  // The guide's own text is the entry's text: what a follow-up question is answered from, here or online.
  const showGuide = (question: string | null, guide: string, text: string, others: string[] = []) => {
    store.set((s) => ({
      text: question ? '' : s.text,
      entries: [...s.entries, ...(question ? [{ role: 'user' as const, text: question }] : []), { role: 'assistant' as const, text, guide, others, question: question ?? undefined }],
    }));
  };
  const noGuide = (question: string) => {
    store.set((s) => ({ text: '', entries: [...s.entries, { role: 'user', text: question }, { role: 'assistant', text: '', noGuide: true, question }] }));
  };

  const retry = async () => {
    const s = store.get();
    const failed = s.entries.at(-1);
    if (s.busy || !failed?.error || !failed.retry) return;
    const entries = s.entries.slice(0, -1);
    store.set({ entries });
    // The question stays where it was; the conversation before it is everything up to it.
    await run(failed.retry.full, failed.retry.opts, entries.slice(0, -1));
  };

  return {
    store,
    send,
    showGuide,
    noGuide,
    retry,
    cancel: () => running?.cancel(),
    async attach() {
      store.set({ fileError: null });
      try {
        const f = await pickFile();
        if (f) store.set((s) => ({ files: [...s.files.filter((x) => x.ref !== f.ref), f] }));
      } catch (e) {
        store.set({ fileError: assistantProblem(e) });
      }
    },
    reset() {
      if (store.get().busy) return;
      store.set((s) => ({ ...fresh(), viewers: s.viewers, tabRef: s.tabRef }));
    },
    view() {
      store.set((s) => ({ viewers: s.viewers + 1, unread: 0 }));
      let open = true;
      return () => {
        if (!open) return;
        open = false;
        store.set((s) => ({ viewers: Math.max(0, s.viewers - 1) }));
      };
    },
    onUnseen(fn) {
      unseen.add(fn);
      return () => unseen.delete(fn);
    },
  };
}

/** The assistant beside the tabs: one conversation, whether it shows in the drawer or the floating widget. */
export const assistantSession = createAskSession();
