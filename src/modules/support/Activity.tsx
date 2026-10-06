import { useState } from 'react';
import { PRIORITY_LABEL, statusLabel, type SupportPriority, type TicketEvent } from '@shared/support';
import { text } from '../../core/i18n';
import { stampDayLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Empty } from '../../components/ui';
import { errorText, ticketEvents } from './api';

const ACTOR: Record<string, string> = { rule: 'A rule', automation: 'A rule', system: 'WorkSuite', customer: 'The requester', requester: 'The requester', ai: 'AI' };

const FIELD: Record<string, string> = {
  subject: 'the subject',
  type: 'the type',
  team_id: 'the team',
  category_id: 'the category',
  department_id: 'the department',
  due_at: 'the due date',
  tags: 'the tags',
  language: 'the language',
  confidential: 'who may see it',
  organization_id: 'the organization',
  requester_name: 'the requester',
  requester_email: 'the requester',
  requester_phone: 'the requester',
};

/** Who did it: a person, or what acted for nobody in particular — a rule, WorkSuite, the requester. */
export function eventWho(e: Pick<TicketEvent, 'user' | 'source'>): string {
  return e.user?.name || text(ACTOR[e.source ?? ''] ?? 'Someone');
}

/** What happened, in words. */
export function eventWords(e: TicketEvent): string {
  switch (e.action) {
    case 'opened':
      return text('raised the ticket');
    case 'status':
      return e.new ? text('set the status to {status}', { status: text(statusLabel(e.new)) }) : text('changed the status');
    case 'priority':
      return e.new ? text('set the priority to {priority}', { priority: text(PRIORITY_LABEL[e.new as SupportPriority] ?? e.new) }) : text('changed the priority');
    case 'assigned':
      if (e.reason === 'Taken') return text('took the ticket');
      return e.new ? text('assigned the ticket') : text('unassigned the ticket');
    case 'edited': {
      const field = FIELD[e.field ?? ''];
      return field ? text('changed {field}', { field: text(field) }) : text('changed the ticket');
    }
    case 'replied':
      return text('replied to the requester');
    case 'note':
      return text('wrote an internal note');
    case 'deleted':
      return text('moved it to the trash');
    case 'restored':
      return text('brought it back from the trash');
    case 'merged':
      return text('merged tickets');
    case 'unmerged':
      return text('took a merged ticket back out');
    case 'split':
      return text('split a message into a new ticket');
    case 'linked':
      return text('linked it');
    case 'unlinked':
      return text('removed a link');
    case 'watchers':
      return text('changed who follows it');
    case 'converted':
      return text('raised it from a website chat');
    case 'acknowledged':
      return text('sent the requester the receipt');
    default:
      return e.action.replace(/_/g, ' ');
  }
}

/**
 * The ticket's journal (§17, D-02's Activity): every change, who made it and when, newest first, a hundred at a time
 * — "Show earlier" asks for the hundred before.
 */
export function Activity({ ticketId, events }: { ticketId: number; events: TicketEvent[] }) {
  const [earlier, setEarlier] = useState<TicketEvent[]>([]);
  const [more, setMore] = useState(events.length >= 100);
  const [busy, setBusy] = useState(false);
  const all = [...events, ...earlier.filter((e) => !events.some((x) => x.id === e.id))];
  const loadEarlier = async () => {
    const last = all.at(-1);
    if (!last) return;
    setBusy(true);
    try {
      const r = await ticketEvents(ticketId, last.id);
      setEarlier((x) => [...x, ...r.events]);
      setMore(r.has_more);
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!all.length) return <Empty icon="history" title={text('Nothing has happened yet')} />;
  return (
    <div className="flex flex-col gap-2">
      <ol aria-label={text('Activity')} className="flex flex-col">
        {all.map((e) => (
          <li key={e.id} className="flex items-start gap-3 border-b border-line py-2 text-[12.5px] last:border-b-0">
            <span className="w-[92px] shrink-0 text-[11.5px] text-ink-3 tabular-nums">{e.created_at ? `${stampDayLabel(e.created_at, 'short')} ${timeLabel(e.created_at)}` : ''}</span>
            <span className="min-w-0 flex-1 text-ink-2">
              <b className="text-ink">{eventWho(e)}</b> {eventWords(e)}
              {e.reason && e.reason !== 'Taken' ? <span className="text-ink-3"> — {e.reason}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      {more ? (
        <Button size="sm" variant="ghost" loading={busy} onClick={() => void loadEarlier()} className="self-center">
          {text('Show earlier')}
        </Button>
      ) : null}
    </div>
  );
}
