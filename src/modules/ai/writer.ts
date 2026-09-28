import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet, apiPost } from '../../core/api';

/**
 * WorkSuite's writing assistant (`/api/ai/write`, permission `ai.write`,
 * granted to every role): the AI Assistant on the desktop — the dock and
 * Quick Ask — asks it for a translation, a rewrite, something shorter, and
 * shows the answer to the person, who decides what happens with it. It never
 * sends anything anywhere on its own.
 */
export interface WriterInfo {
  /** An AI connection is configured for this workspace. */
  available: boolean;
  actions: Array<{ key: string; label: string; needs_text: boolean }>;
  tones: string[];
  languages: string[];
}

/** The server's own limit on the text one request considers (Writer::MAX_TEXT). */
export const WRITER_MAX = 8000;

/** What the desktop offers, in this order, when the server has it (Quick Ask, page 2 of the designs). */
export const OFFERED: Array<{ key: string; label: string }> = [
  { key: 'translate', label: 'Translate' },
  { key: 'improve', label: 'Rewrite' },
  { key: 'shorten', label: 'Shorten' },
  { key: 'professional', label: 'Make professional' },
  { key: 'grammar', label: 'Fix grammar' },
];

export function useWriter() {
  return useQuery({
    queryKey: ['ai', 'writer'],
    queryFn: ({ signal }) => apiGet<WriterInfo>('/api/ai/write/actions', undefined, signal),
    staleTime: 10 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && (e.forbidden || e.status === 404)) && n < 1,
  });
}

/** The actions this server offers, as the desktop names them. */
export function offeredActions(info: WriterInfo | undefined): Array<{ key: string; label: string }> {
  const has = new Set((info?.actions ?? []).map((a) => a.key));
  return OFFERED.filter((a) => has.has(a.key));
}

export async function write(action: string, text: string, opts: { language?: string; tone?: string } = {}): Promise<string> {
  const r = await apiPost<{ text: string }>('/api/ai/write', { action, text: text.slice(0, WRITER_MAX), ...(opts.language ? { language: opts.language } : {}), ...(opts.tone ? { tone: opts.tone } : {}) });
  return r.text;
}

/** Why the assistant cannot help, in a sentence, from what the server said. */
export function writerProblem(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.forbidden) return "Your account doesn't have the writing assistant.";
    if (e.status === 503) return 'No AI connection is configured for this workspace yet.';
    if (e.offline) return 'The assistant needs a connection to WorkSuite.';
    return e.message;
  }
  return e instanceof Error ? e.message : 'The assistant could not answer.';
}

/** The heading over a result: the language it was translated into, or what was done. */
export function resultLabel(action: string, language: string): string {
  if (action === 'translate') return language.toUpperCase();
  return (OFFERED.find((a) => a.key === action)?.label ?? 'Result').toUpperCase();
}

/** An Electron accelerator as people read it: ⌥Space on a Mac, Ctrl+Alt+Space elsewhere. */
export function shortcutLabel(accelerator: string, mac: boolean): string {
  const parts = accelerator.split('+');
  if (mac) {
    const sym: Record<string, string> = { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧' };
    return parts.map((p) => sym[p] ?? p).join('');
  }
  return parts.map((p) => (p === 'CommandOrControl' || p === 'Control' ? 'Ctrl' : p)).join('+');
}
