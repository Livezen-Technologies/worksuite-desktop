import { useQuery } from '@tanstack/react-query';
import type { AiRules } from '@shared/types';
import { ApiError, apiGet, apiPost, apiPut } from '../../core/api';
import { call } from '../../core/bridge';

/**
 * The AI assistant (WS-AI-SRS-001 §8.2, DSK-1…5): the server's own, asked
 * from the dock and from Quick Ask. It reads only what the person can open,
 * as them; a change it proposes is a card they confirm — here, in the main
 * window, through the main process (`ai:confirm`), never through a page.
 */

export type Surface = 'assistant.panel' | 'desktop.quick';

export interface AskSource { n?: number; kind: 'record' | 'found'; title: string; url?: string | null; ref?: string }
export interface AskTool { name: string; label: string; ok: boolean; error: string | null }

export interface PendingAction {
  id: number;
  slug: string;
  name: string;
  risk: 'R1' | 'R2';
  status: 'awaiting_confirmation' | 'executing' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'superseded' | 'submitted_for_approval' | 'rejected' | 'undone';
  version: number;
  preview: { title: string; lines: string[]; warnings: string[] };
  external_recipients: string[];
  tainted: boolean;
  expires_at: string;
  nonce?: string | null;
  arguments: Record<string, unknown>;
  links?: { label: string; url: string }[];
  undo_until?: string | null;
  error?: string | null;
}

export interface AskTurn {
  conversation_id: number | null;
  ok: boolean;
  reply: string | null;
  error: string | null;
  sources: AskSource[];
  tool_runs: AskTool[];
  pending_actions?: PendingAction[];
  context?: { used: { ref: string; title: string }[]; denied: string[] };
}

/** One question to the assistant. `refs` are records it may read, as the person asking. */
export function ask(text: string, opts: { surface: Surface; refs?: string[]; conversationId?: number | null }): Promise<AskTurn> {
  return apiPost<AskTurn>('/api/ai/assist/chat', {
    text,
    surface: opts.surface,
    refs: opts.refs ?? [],
    conversation_id: opts.conversationId ?? undefined,
    use_context: (opts.refs ?? []).length > 0,
  });
}

/** Whether the assistant answers here, for this person — and the rules of this computer. */
export function useAssistant(surface: Surface) {
  const availability = useQuery({
    queryKey: ['ai', 'availability', surface],
    queryFn: ({ signal }) => apiGet<{ enabled: boolean; reason: string | null }>('/api/ai/assist/availability', { surface }, signal),
    staleTime: 5 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && (e.forbidden || e.status === 404)) && n < 1,
  });
  const rules = useQuery({
    queryKey: ['ai', 'rules'],
    queryFn: () => call('ai:rules', { refresh: true }),
    staleTime: 5 * 60_000,
  });
  return { availability, rules: rules.data as AiRules | undefined };
}

export function usePending(which: 'open' | 'recent') {
  return useQuery({
    queryKey: ['ai', 'pending', which],
    queryFn: ({ signal }) => apiGet<{ actions: PendingAction[] }>('/api/ai/pending', { which }, signal).then((d) => d.actions),
    staleTime: 15_000,
  });
}

/** Confirming goes through the main process, which refuses anything but the main window. */
export function confirmAction(a: PendingAction): Promise<PendingAction> {
  return call('ai:confirm', { id: a.id, nonce: String(a.nonce ?? '') }) as Promise<PendingAction>;
}

export const cancelAction = (id: number) => apiPost<PendingAction>(`/api/ai/pending/${id}/cancel`);
export const undoAction = (id: number) => apiPost<PendingAction>(`/api/ai/pending/${id}/undo`);
export const editAction = (id: number, args: Record<string, unknown>) => apiPut<PendingAction>(`/api/ai/pending/${id}`, { arguments: args });

/** A file picked on this computer, as a reference the assistant reads (DSK-6). Null when nothing was picked. */
export function pickFile(): Promise<{ ref: string; name: string; via: 'upload' | 'drive' } | null> {
  return call('ai:upload');
}

/**
 * The record a tab shows, as the reference the assistant reads — the same
 * addresses the web uses (`/tasks?task=12` → `task:12`). A tab that shows no
 * one record has none, and the assistant is given nothing from it.
 */
const TAB_REFS: Array<[RegExp, string, string]> = [
  [/^\/tasks$/, 'task', 'task'],
  [/^\/notes$/, 'note', 'note'],
  [/^\/files$/, 'file', 'file'],
  [/^\/chat$/, 'room', 'chat_room'],
  [/^\/crm$/, 'lead', 'crm_lead'],
  [/^\/crm$/, 'deal', 'crm_deal'],
  [/^\/crm$/, 'account', 'crm_account'],
  [/^\/contacts$/, 'contact', 'contact'],
];

export function refForRoute(route: string | null | undefined): string | null {
  if (!route) return null;
  const [path, query = ''] = route.split('?');
  const q = new URLSearchParams(query);
  for (const [re, param, type] of TAB_REFS) {
    const id = q.get(param);
    if (re.test(path ?? '') && id && /^[1-9]\d{0,17}$/.test(id)) return `${type}:${id}`;
  }
  return null;
}

export function assistantProblem(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.offline) return 'You are offline. The assistant needs a connection.';
    if (e.forbidden) return e.message || 'The assistant is not switched on for you.';
    return e.message || 'The assistant could not answer just now.';
  }
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') return (e as { message: string }).message;
  return 'The assistant could not answer just now.';
}
