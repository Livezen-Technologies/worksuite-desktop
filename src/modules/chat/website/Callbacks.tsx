import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../../core/api';
import { call, errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { navigate } from '../../../core/tabs';
import { listStamp, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { WEBSITE, type WebsiteCallback } from './api';

/**
 * Callbacks (worksuite-desktop#223): visitors who asked to be contacted, as things to do.
 *
 * Each has a reference the visitor was given (CB-1042), how they want to be reached and when, and a due time; still
 * to do, it is overdue once that has passed. The actions are the issue's: Call now, WhatsApp (WorkSuite's own
 * WhatsApp), Reply by email (a new email in Mail), Mark contacted, Couldn't reach (and when to try again), Done.
 * The list lives in the Callbacks section of Website chats; the card also sits at the top of its conversation.
 */

export interface CallbackCounts { todo: number; overdue: number; mine: number }

/** The section's count and overdue mark. An older server has no counts: nothing is shown. */
export function useCallbackCounts() {
  return useQuery({
    queryKey: ['website', 'callbacks', 'counts'],
    queryFn: ({ signal }) => apiGet<CallbackCounts>(`${WEBSITE}/callbacks/counts`, undefined, signal),
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useCallbackList(status: 'todo' | 'handled', mine: boolean, enabled: boolean) {
  return useQuery({
    queryKey: ['website', 'callbacks', 'list', status, mine],
    queryFn: ({ signal }) => apiGet<{ callbacks: WebsiteCallback[]; counts?: CallbackCounts }>(`${WEBSITE}/callbacks`, { status, ...(mine ? { mine: '1' } : {}) }, signal),
    enabled,
    refetchInterval: 30_000,
    retry: false,
  });
}

const STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: 'To do', tone: 'bg-selection text-primary' },
  unreachable: { label: "Couldn't reach", tone: 'bg-warning-bg text-[#9A4A06] dark:text-warning' },
  contacted: { label: 'Contacted', tone: 'bg-success-bg text-success' },
  done: { label: 'Done', tone: 'bg-subtle text-ink-3' },
};

const RETRY = [
  { minutes: 30, label: 'in 30 minutes' },
  { minutes: 60, label: 'in an hour' },
  { minutes: 180, label: 'in 3 hours' },
  { minutes: 1440, label: 'tomorrow' },
];

/** The digits and the +, as a dialler or WhatsApp takes them; Voice calls' Call back dials the same way (V-01). */
export const dial = (phone: string | null | undefined) => (phone ?? '').replace(/[^\d+]/g, '');

export function isPending(b: Pick<WebsiteCallback, 'status'>): boolean {
  return !b.status || b.status === 'open' || b.status === 'unreachable';
}

/**
 * One callback: who, how and when they want to be contacted, what about, and the actions. `compact` is the list's
 * row; otherwise the card at the top of the conversation.
 */
export function CallbackCard({ b, compact = false, active = false, onOpen }: { b: WebsiteCallback; compact?: boolean; active?: boolean; onOpen?: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const pending = isPending(b);
  const status = STATUS[b.status ?? 'open'] ?? STATUS.open!;
  const act = (action: 'contacted' | 'unreachable' | 'done' | 'reopen', body: Record<string, unknown> = {}, done = text('Saved')) => {
    setBusy(true);
    setRetry(false);
    void apiPost(`${WEBSITE}/callbacks/${b.id}/${action}`, body).then(
      () => {
        toast('success', done);
        void qc.invalidateQueries({ queryKey: ['website'] });
        setBusy(false);
      },
      (e) => {
        toast('error', errorMessage(e));
        setBusy(false);
      },
    );
  };
  const phone = dial(b.phone);
  const subject = `${text('Your request')} ${b.reference ?? ''}`.trim();
  const btn = 'h-6 rounded-[6px] border border-line bg-surface px-2 text-[11.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50';

  return (
    <div
      data-website-row={compact ? b.conversation_id : undefined}
      role="group"
      aria-label={text('Callback {ref} for {name}', { ref: b.reference ?? '', name: b.visitor })}
      className={cx(
        'relative flex flex-col gap-1',
        compact ? cx('border-b border-line py-2.5 pr-3 pl-3.5', active ? 'bg-selection' : b.overdue ? 'bg-danger-bg/40' : 'hover:bg-subtle') : cx('mx-4 mt-2 rounded-[10px] border p-2.5', b.overdue ? 'border-danger/40 bg-danger-bg/40' : 'border-line bg-subtle'),
      )}
    >
      {compact && active ? <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[3px] bg-primary" /> : null}
      <button type="button" onClick={onOpen} disabled={!onOpen} className="flex flex-col gap-[3px] text-left disabled:cursor-default">
        <span className="flex items-center gap-[7px]">
          <Icon name={b.channel === 'email' ? 'mail' : b.channel === 'whatsapp' ? 'message-circle' : 'phone'} size={12} className="shrink-0 text-primary" />
          <b className="min-w-0 flex-1 truncate text-ink">{compact ? b.visitor : text('Callback requested')}</b>
          {b.reference ? <span className="shrink-0 font-mono text-[11px] text-ink-3">{b.reference}</span> : null}
          <span className={cx('shrink-0 rounded-[5px] px-1.5 py-px text-[10.5px] font-bold', status.tone)}>{text(status.label)}</span>
          {b.overdue ? <span className="shrink-0 rounded-[5px] bg-danger-bg px-1.5 py-px text-[10.5px] font-bold text-danger">{text('Overdue')}</span> : null}
        </span>
        <span className="truncate text-[12px] text-ink-2">
          {[compact ? null : b.visitor, b.how ? text('Wants to be contacted {how}', { how: b.how }) : null, b.best_time].filter(Boolean).join(' · ')}
        </span>
        <span className="truncate text-[11px] text-ink-3">
          {[
            b.site ?? 'Website',
            text('asked {when}', { when: listStamp(b.created_at) }),
            b.due_at && pending ? text('due {time}', { time: `${listStamp(b.due_at)} ${timeLabel(b.due_at)}` }) : null,
            b.attempts ? text('{n} attempts', { n: b.attempts }) : null,
            b.assignee ?? null,
            b.missed_call ? text('missed call') : null,
          ].filter(Boolean).join(' · ')}
        </span>
        {!compact && b.message ? <span className="mt-0.5 rounded-[7px] bg-surface px-2 py-1 text-[12px] whitespace-pre-wrap text-ink select-text">{b.message}</span> : null}
        {!compact && (b.phone || b.email) ? (
          <span className="text-[12px] text-ink-2 select-text">{[b.phone, b.email].filter(Boolean).join(' · ')}</span>
        ) : null}
      </button>
      <span className="flex flex-wrap items-center gap-1" role="group" aria-label={text('Contact the visitor')}>
        {phone ? (
          <button type="button" className={cx(btn, 'border-primary bg-primary text-white hover:bg-primary-hover')} onClick={() => void call('app:openExternal', { url: `tel:${phone}` })}>
            {text('Call now')}
          </button>
        ) : null}
        {phone ? <button type="button" className={btn} onClick={() => navigate(`/chat?channel=whatsapp&to=${encodeURIComponent(phone)}`)}>WhatsApp</button> : null}
        {b.email ? (
          <button type="button" className={btn} onClick={() => navigate(`/mail?compose=1&to=${encodeURIComponent(b.email!)}&subject=${encodeURIComponent(subject)}`)}>
            {text('Reply by email')}
          </button>
        ) : null}
      </span>
      <span className="relative flex flex-wrap items-center gap-1" role="group" aria-label={text('What happened')}>
        {pending ? (
          <>
            <button type="button" disabled={busy} className={btn} onClick={() => act('contacted', {}, text('Marked contacted'))}>{text('Mark contacted')}</button>
            <button type="button" disabled={busy} className={btn} aria-expanded={retry} onClick={() => setRetry((r) => !r)}>{text("Couldn't reach")}</button>
          </>
        ) : null}
        {b.status !== 'done' ? <button type="button" disabled={busy} className={btn} onClick={() => act('done', {}, text('Callback closed'))}>{text('Done')}</button> : null}
        {!pending ? <button type="button" disabled={busy} className={btn} onClick={() => act('reopen', {}, text('Callback reopened'))}>{text('Reopen')}</button> : null}
        {retry ? (
          <span role="menu" aria-label={text('Try again')} className="absolute top-7 left-0 z-10 flex w-44 flex-col rounded-[8px] border border-line bg-surface p-1 shadow-lg">
            {RETRY.map((r) => (
              <button key={r.minutes} type="button" role="menuitem" className="rounded-[6px] px-2 py-1.5 text-left text-[12px] text-ink hover:bg-subtle" onClick={() => act('unreachable', { retry_minutes: r.minutes }, text('We will try again'))}>
                {text('Try again {when}', { when: r.label })}
              </button>
            ))}
          </span>
        ) : null}
      </span>
    </div>
  );
}
