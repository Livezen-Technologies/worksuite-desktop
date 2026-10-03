import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet, apiPost, apiPut } from '../../core/api';
import { text } from '../../core/i18n';
import { messageAction, moveMessage, stateAction } from './api';
import type { Target } from './MessageMenus';
import { flagChoices, snoozeChoices, stateItem } from './states';
import type { ComposeSeed, MessageDetail } from './types';

/**
 * Quick Steps (ENH-MAIL-03 DMO-QS-01…06, WF-DO03): a named list of actions
 * run on every selected message, in order, each message in its own account.
 * Compose actions open a prefilled message instead of sending silently.
 */

export interface QuickStepAction {
  type: string;
  folder?: string;
  ask?: boolean;
  category_id?: number;
  when?: string;
  level?: 'high' | 'normal' | 'low';
  to?: string;
  template_id?: number;
}

export interface QuickStep {
  id: number;
  name: string;
  icon: string;
  shortcut: number | null;
  tooltip: string | null;
  actions: QuickStepAction[];
  ask_fields: string[];
  org: boolean;
  position: number;
}

/** Every action the editor offers, in the order it lists them. */
export const QS_ACTIONS: Array<{ type: string; label: string; needs?: 'folder' | 'category' | 'when' | 'snoozeWhen' | 'level' | 'to' }> = [
  { type: 'move', label: 'Move to folder', needs: 'folder' },
  { type: 'archive', label: 'Archive' },
  { type: 'delete', label: 'Delete' },
  { type: 'delete_forever', label: 'Permanently delete' },
  { type: 'read', label: 'Mark as read' },
  { type: 'unread', label: 'Mark as unread' },
  { type: 'category', label: 'Categorize', needs: 'category' },
  { type: 'clear_categories', label: 'Clear categories' },
  { type: 'flag', label: 'Flag', needs: 'when' },
  { type: 'clear_flag', label: 'Clear flag' },
  { type: 'complete', label: 'Mark complete' },
  { type: 'pin', label: 'Pin' },
  { type: 'snooze', label: 'Snooze', needs: 'snoozeWhen' },
  { type: 'reply', label: 'Reply' },
  { type: 'reply_all', label: 'Reply all' },
  { type: 'forward', label: 'Forward', needs: 'to' },
  { type: 'new_message', label: 'New message to', needs: 'to' },
  { type: 'create_task', label: 'Create a task' },
  { type: 'save_attachments', label: 'Save attachments to Files' },
];

export function useQuickSteps(enabled = true) {
  return useQuery({
    queryKey: ['mail', 'quick-steps'],
    queryFn: async () => {
      try {
        return (await apiGet<{ quick_steps: QuickStep[] }>('/api/mail/quick-steps')).quick_steps;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 503)) return null;
        throw e;
      }
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** The values a step still needs: a folder, an address — asked once, then kept (DMO-QS-04). */
export function needsAsking(step: QuickStep): Array<'folder' | 'to'> {
  const out = new Set<'folder' | 'to'>();
  for (const a of step.actions) {
    if (!a.ask) continue;
    if (a.type === 'move' || a.type === 'copy') out.add('folder');
    if (a.type === 'forward' || a.type === 'new_message') out.add('to');
  }
  return [...out];
}

/** The step with the asked values filled in and "ask" cleared, as it is saved back. */
export function answered(step: QuickStep, values: { folder?: string; to?: string }): QuickStep {
  return {
    ...step,
    actions: step.actions.map((a) => {
      if (!a.ask) return a;
      if ((a.type === 'move' || a.type === 'copy') && values.folder) return { ...a, ask: false, folder: values.folder };
      if ((a.type === 'forward' || a.type === 'new_message') && values.to) return { ...a, ask: false, to: values.to };
      return a;
    }),
  };
}

export async function saveAnswers(step: QuickStep, values: { folder?: string; to?: string }): Promise<void> {
  if (step.org) return;
  const next = answered(step, values);
  await apiPut(`/api/mail/quick-steps/${step.id}`, { name: next.name, icon: next.icon, shortcut: next.shortcut, tooltip: next.tooltip, actions: next.actions });
}

/** Does the step take messages out of the list (so they hide at once)? */
export function removesMessages(step: QuickStep): boolean {
  return step.actions.some((a) => ['move', 'archive', 'delete', 'delete_forever'].includes(a.type));
}

export interface RunReport {
  done: number;
  failed: number;
  /** Per message: why it stopped (later actions for that message stop, WF-DO03). */
  errors: string[];
  /** Compose windows to open (reply with template, forward…): prefilled, never sent silently. */
  compose: ComposeSeed[];
}

/** What the runner calls, so tests can watch it. */
export interface Runner {
  action: typeof messageAction;
  move: typeof moveMessage;
  state: typeof stateAction;
  post: typeof apiPost;
  get: typeof apiGet;
}

const real: Runner = { action: messageAction, move: moveMessage, state: stateAction, post: apiPost, get: apiGet };

/**
 * Run a Quick Step on messages (WF-DO03 step 2): for each message, each action
 * in order; a failure stops the rest for that message only.
 */
export async function runQuickStep(step: QuickStep, targets: Target[], run: Runner = real): Promise<RunReport> {
  const report: RunReport = { done: 0, failed: 0, errors: [], compose: [] };
  const flagDates = Object.fromEntries(flagChoices().map((c) => [c.id, c.dates]));
  const snoozeAt = Object.fromEntries(snoozeChoices().map((c) => [c.id, c.at]));
  for (const t of targets) {
    const ref = { uid: String(t.row.id), folder: t.folder, mailbox: t.mailbox };
    const item = stateItem(t.row, t.mailbox, t.folder);
    try {
      for (const a of step.actions) {
        switch (a.type) {
          case 'move':
            if (!a.folder) throw new Error(text('No folder chosen.'));
            await run.move(ref, a.folder, a.folder.replace(/^label:/, ''), t.row.subject);
            break;
          case 'archive':
          case 'read':
          case 'unread':
            await run.action(ref, a.type, t.row.subject);
            break;
          case 'delete':
            await run.action(ref, 'trash', t.row.subject);
            break;
          case 'delete_forever':
            await run.post('/api/mail/messages/delete', { folder: t.folder, uids: [Number(t.row.id)], ...(t.mailbox ? { mailbox: t.mailbox } : {}) });
            break;
          case 'category':
            if (a.category_id) await run.state('categorise', [item], { category_ids: [a.category_id] }, t.row.subject);
            break;
          case 'clear_categories':
            if (t.row.categories?.length) await run.state('uncategorise', [item], { category_ids: t.row.categories.map((c) => c.id) }, t.row.subject);
            break;
          case 'flag':
            await run.state('flag', [item], { dates: flagDates[a.when ?? 'today'] ?? flagDates.today }, t.row.subject);
            if (!t.row.is_starred) await run.action(ref, 'star', t.row.subject);
            break;
          case 'clear_flag':
            await run.state('unflag', [item], {}, t.row.subject);
            if (t.row.is_starred) await run.action(ref, 'unstar', t.row.subject);
            break;
          case 'complete':
          case 'pin':
            await run.state(a.type, [item], {}, t.row.subject);
            break;
          case 'snooze':
            await run.state('snooze', [item], { until: snoozeAt[a.when ?? 'tomorrow'] ?? snoozeAt.tomorrow }, t.row.subject);
            break;
          case 'importance':
            await run.action(ref, a.level === 'high' ? 'important' : 'unimportant', t.row.subject);
            break;
          case 'reply':
          case 'reply_all':
            report.compose.push({ mode: a.type, to: t.row.from_email, subject: /^re:/i.test(t.row.subject) ? t.row.subject : `Re: ${t.row.subject}`, mailbox: t.mailbox, ...(a.template_id ? { templateId: a.template_id } : {}) });
            break;
          case 'forward':
            report.compose.push({ mode: 'forward', to: a.to ?? '', subject: /^fwd?:/i.test(t.row.subject) ? t.row.subject : `Fwd: ${t.row.subject}`, mailbox: t.mailbox, ...(a.template_id ? { templateId: a.template_id } : {}) });
            break;
          case 'new_message':
            report.compose.push({ mode: 'new', to: a.to ?? '', mailbox: t.mailbox });
            break;
          case 'create_task':
            await run.post('/api/tasks', { title: t.row.subject || text('(no subject)'), description: text('From an email from {sender}', { sender: t.row.from_name || t.row.from_email }) });
            break;
          case 'save_attachments': {
            const detail = await run.get<MessageDetail>(`/api/mail/messages/${t.row.id}`, { folder: t.folder, ...(t.mailbox ? { mailbox: t.mailbox } : {}) });
            for (const att of detail.attachments ?? []) await run.post(`/api/mail/messages/${t.row.id}/attachments/${encodeURIComponent(att.ref)}/save`, { folder: t.folder, ...(t.mailbox ? { mailbox: t.mailbox } : {}) });
            break;
          }
          default:
            throw new Error(text('“{action}” is not available on this computer yet.', { action: a.type }));
        }
      }
      report.done++;
    } catch (e) {
      report.failed++;
      report.errors.push(`${t.row.subject || text('(no subject)')}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return report;
}
