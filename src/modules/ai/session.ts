import { askLocal, type LocalAsk } from '../../core/local-ai';
import { createStore, type Store } from '../../core/store';
import { ask, assistantProblem, pickFile, type AskTurn, type Surface } from './assistant';

export interface AskEntry {
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
  turn?: AskTurn;
  /** Answered by the model on this computer. */
  local?: boolean;
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
  /** WorkSuite AI or this computer, when the person chose; null follows the connection. */
  localPick: boolean | null;
  /** Answers that arrived while no panel showed the conversation. */
  unread: number;
  /** Panels showing the conversation now (the drawer, the widget). */
  viewers: number;
}

export interface SendOptions {
  surface: Surface;
  refs: string[];
  local: boolean;
  /** Quick Ask: the text selected in the other app, sent with the first question only. */
  selection?: string;
}

const LOCAL_SYSTEM = 'You are WorkSuite\'s assistant, running on this computer. Answer clearly and briefly. You cannot see the person\'s WorkSuite data or change anything; say so when a question needs it.';

const fresh = (): AskState => ({ entries: [], conversationId: null, text: '', busy: false, streaming: null, useTab: true, tabRef: null, files: [], fileError: null, localPick: null, unread: 0, viewers: 0 });

/**
 * One conversation with the assistant, kept outside any panel: the drawer and the floating widget show the same
 * one, and closing, minimising or switching between them loses nothing — not the messages, the question being
 * written, the files picked, nor an answer on its way, which lands here whether or not a panel is open.
 */
export interface AskSession {
  store: Store<AskState>;
  send(opts: SendOptions): Promise<void>;
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
  let running: LocalAsk | null = null;
  const unseen = new Set<(entry: AskEntry) => void>();

  const answered = (entry: AskEntry) => {
    const hidden = store.get().viewers === 0;
    store.set((s) => ({ entries: [...s.entries, entry], unread: hidden ? s.unread + 1 : s.unread }));
    if (hidden) for (const fn of unseen) fn(entry);
  };

  /** One answer to `full`, with the conversation before it (`before`) as it stood. */
  const run = async (full: string, opts: SendOptions, before: AskEntry[]) => {
    const retry = { full, opts };
    store.set({ busy: true });
    if (opts.local) {
      // This computer's model: the conversation so far in this mode, nothing from WorkSuite.
      const history = before.filter((x) => x.local && !x.error).map((x) => ({ role: x.role, content: x.text }));
      store.set({ streaming: '' });
      const r = askLocal([{ role: 'system', content: LOCAL_SYSTEM }, ...history, { role: 'user', content: full }], (t) => store.set({ streaming: t }));
      running = r;
      try {
        const a = await r.done;
        answered({ role: 'assistant', text: a.text.trim() || (a.cancelled ? 'Stopped.' : ''), local: true });
      } catch (err) {
        answered({ role: 'assistant', text: assistantProblem(err), error: true, local: true, retry });
      } finally {
        running = null;
        store.set({ streaming: null, busy: false });
      }
      return;
    }
    try {
      const t = await ask(full, { surface: opts.surface, refs: opts.refs, conversationId: store.get().conversationId });
      store.set({ conversationId: t.conversation_id });
      answered(t.ok ? { role: 'assistant', text: t.reply ?? '', turn: t } : { role: 'assistant', text: t.error ?? 'The assistant could not answer just now.', error: true, retry });
    } catch (err) {
      answered({ role: 'assistant', text: assistantProblem(err), error: true, retry });
    } finally {
      store.set({ busy: false });
    }
  };

  const send = async (opts: SendOptions) => {
    const s = store.get();
    const q = s.text.trim();
    if (!q || s.busy) return;
    const { selection } = opts;
    // A selection from another app goes with the question, fenced, as material to work on.
    const full = selection && selection.trim() && s.entries.length === 0 ? `${q}\n\nThe text I selected:\n"""\n${selection.trim().slice(0, 6000)}\n"""` : q;
    store.set({ text: '', entries: [...s.entries, { role: 'user', text: q, local: opts.local }] });
    await run(full, opts, s.entries);
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
      store.set((s) => ({ ...fresh(), viewers: s.viewers, localPick: s.localPick, tabRef: s.tabRef }));
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
