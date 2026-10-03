import { useQuery } from '@tanstack/react-query';
import { apiGetMeta } from '../../core/api';
import { app } from '../../core/app-state';
import { text } from '../../core/i18n';
import { addDays, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { NewTask } from '../tasks/NewTask';
import { addressOf } from './Recipients';
import type { TaskList } from '../tasks/api';
import { escapeHtml } from './sanitize';
import type { MessageRef } from './types';

/**
 * Create task from a message (ENH-MAIL-03 DMO-TSK-05): the Tasks module's own
 * New task form — assignee, list (project), due date, reminders — filled from
 * the message, with a link in the description that opens the message again.
 */

/** The WorkSuite link to a message (the same one "Copy link" gives). */
export function messageLink(ref: MessageRef, origin = app.get().auth?.server?.origin ?? ''): string {
  if (!origin) return '';
  const q = new URLSearchParams({ msg: ref.uid, folder: ref.folder });
  if (ref.mailbox) q.set('mailbox', ref.mailbox);
  return `${origin}/mail?${q}`;
}

/** The task description: who it came from, when, and the way back to the message. */
export function taskDescription(m: { subject: string; from_name: string | null; from_email: string; created_at?: string | null }, link: string): string {
  const who = m.from_name ? `${escapeHtml(m.from_name)} &lt;${escapeHtml(m.from_email)}&gt;` : escapeHtml(m.from_email);
  const parts = [`<p>${escapeHtml(text('From an email from {sender}', { sender: '\u0000' })).replace('\u0000', who)}</p>`];
  if (link) parts.push(`<p><a href="${escapeHtml(link)}">${escapeHtml(text('Open the email: {subject}', { subject: m.subject || text('(no subject)') }))}</a></p>`);
  return parts.join('');
}

/**
 * Reply with meeting (DMO-CAL-06): a new Calendar event with the thread's
 * subject and its people — the sender, To and Cc, less this mailbox. The
 * Calendar invites the ones who are colleagues and names the rest.
 */
export function meetingRoute(m: { subject: string; from_email: string; to: string[]; cc: string[] }, mine: string | null, link = ''): string {
  const me = (mine ?? '').toLowerCase();
  const people = [m.from_email, ...m.to, ...m.cc].map((a) => addressOf(a).toLowerCase()).filter((a, i, all) => a.includes('@') && a !== me && all.indexOf(a) === i);
  const q = new URLSearchParams({ new: '1', title: (m.subject || text('(no subject)')).replace(/^(?:(?:re|fwd?|aw|wg)\s*:\s*)+/i, '').slice(0, 200) });
  if (people.length) q.set('people', people.slice(0, 50).join(','));
  if (link) q.set('description', text('About the email: {link}', { link }));
  return `/calendar?${q}`;
}

export function TaskFromMessage({ message, msgRef, onClose }: { message: { subject: string; from_name: string | null; from_email: string }; msgRef: MessageRef; onClose: () => void }) {
  const lists = useQuery({ queryKey: ['tasks', 'lists'], queryFn: ({ signal }) => apiGetMeta<{ lists: TaskList[] }>('/api/task-lists', undefined, signal), staleTime: 5 * 60_000 });
  return (
    <NewTask
      lists={lists.data?.data.lists ?? []}
      defaults={{ title: (message.subject || text('(no subject)')).slice(0, 255), due: addDays(todayInZone(), 1), description: taskDescription(message, messageLink(msgRef)) }}
      onClose={onClose}
      onCreated={(id) => {
        toast('success', id === null ? text('Offline — the task is created when you reconnect.') : text('Task created.'));
        onClose();
      }}
    />
  );
}
