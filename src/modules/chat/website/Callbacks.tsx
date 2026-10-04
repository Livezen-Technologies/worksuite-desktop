import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { apiGet, apiPost } from '../../../core/api';
import { call, errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { navigate } from '../../../core/tabs';
import { dayKey, listStamp, parseTs, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Menu } from '../../../components/Menu';
import { Avatar, Button, Empty, ErrorNote, Spinner, cx } from '../../../components/ui';
import { assignSections } from '../menus';
import { useAgents, WEBSITE, type CallbackDoneOutcome, type WebsiteCallback } from './api';
import { clock } from './Ringing';
import { FilterPill, siteAndPath, useMe, whenLabel } from './rowParts';

/**
 * Callbacks (worksuite-desktop#223): visitors who asked to be contacted, as things to do.
 *
 * Each has a reference the visitor was given (CB-1042), how they want to be reached and when, and a due time; still
 * to do, it is overdue once that has passed. The actions are the issue's: Call now, WhatsApp (WorkSuite's own
 * WhatsApp), Reply by email (a new email in Mail), Mark contacted, Couldn't reach (and when to try again), Done.
 * The list lives in the Callbacks section of Website chats; the card also sits at the top of its conversation.
 */

/** `done` (V-02's Done pill) comes from a server with Voice calls › Call-backs; an older one leaves it out. */
export interface CallbackCounts { todo: number; overdue: number; mine: number; done?: number }

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

// ---- Voice calls › Call-backs (V-02) ---------------------------------------------------------------------------------

/**
 * Voice calls › Call-backs (V-02, X-UI-09; UX-CALL-03/04; WF-X2): the same requests as the Callbacks section, worked
 * from the Voice calls hub. Open / Mine / Done; each request a card — who (and their company), when they called and
 * how long they waited, the page, and their best time, red while it is now; the picked one opens to its phone, what
 * they asked about and who has it, with Call back, Copy number, Open chat and Mark done…; the others keep Call back
 * and Assign ▾, and say who has them and how many attempts so far. Mark done… asks how it went and takes a staff note.
 */
export type CallbackPill = 'open' | 'mine' | 'done';

export function CallbackBoard({ picked, onPick, onOpenChat }: {
  picked: number | null;
  onPick: (id: number | null) => void;
  onOpenChat: (conversationId: number) => void;
}) {
  const [pill, setPill] = useState<CallbackPill>('open');
  const [closing, setClosing] = useState<WebsiteCallback | null>(null);
  const counts = useCallbackCounts();
  const list = useCallbackList(pill === 'done' ? 'handled' : 'todo', pill === 'mine', true);
  const rows = list.data?.callbacks ?? [];
  const c = list.data?.counts ?? counts.data;
  // Nothing picked: the first request opens, as the design shows it.
  const open = rows.find((b) => b.id === picked) ?? rows[0] ?? null;
  const show = (p: CallbackPill) => {
    setPill(p);
    setClosing(null);
    onPick(null);
  };
  const pills: Array<[CallbackPill, string, number | undefined]> = [['open', 'Open', c?.todo], ['mine', 'Mine', c?.mine], ['done', 'Done', c?.done]];

  return (
    <>
      <div className="flex gap-1.5 text-[12px] font-semibold" role="group" aria-label={text('Show call-backs')}>
        {pills.map(([id, label, n]) => (
          <FilterPill key={id} on={pill === id} onClick={() => show(id)}>{n === undefined ? text(label) : `${text(label)} · ${n}`}</FilterPill>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 gap-3.5">
        <div role="list" aria-label={text('Call-backs')} className="flex min-w-0 flex-1 flex-col gap-2.5">
          {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : !rows.length ? (
            <Empty icon="phone" title={pill === 'done' ? 'No call-backs done yet' : pill === 'mine' ? 'No call-backs assigned to you' : 'Nobody is waiting for a call back'}
              hint={pill === 'open' ? 'When a visitor calls and nobody can answer, they can ask us to call them back. The requests wait here.' : undefined} />
          ) : rows.map((b) => (
            <CallbackRequest key={b.id} b={b} open={open?.id === b.id} onPick={() => onPick(b.id)} onOpenChat={() => onOpenChat(b.conversation_id)} onMarkDone={() => setClosing(b)} />
          ))}
        </div>
        {closing ? <MarkDonePanel key={closing.id} b={closing} onClose={() => setClosing(null)} /> : null}
      </div>
    </>
  );
}

/** "Missed call today 09:16 · waited 1:00 · techubiz.com/shop/coreldraw", "Called Sat 22:41 (outside hours) · …". */
export function requestLine(b: WebsiteCallback, now = new Date()): string {
  const at = dayKey(parseTs(b.created_at)) === dayKey(now) ? `${text('today')} ${timeLabel(b.created_at)}` : whenLabel(b.created_at, now);
  const when = b.missed_call ? text('Missed call {when}', { when: at }) : b.source === 'call' ? text('Called {when}', { when: at }) : text('Asked {when}', { when: at });
  return [
    `${when}${b.outside_hours ? ` ${text('(outside hours)')}` : ''}`,
    b.waited_seconds ? text('waited {time}', { time: clock(b.waited_seconds) }) : null,
    b.page_url ? siteAndPath(b.page_url) : b.site,
  ].filter(Boolean).join(' · ');
}

/** The best time, red while it is now — overdue, or due within the hour — and grey while it is still to come (V-02). */
export function bestTimeNow(b: Pick<WebsiteCallback, 'due_at' | 'overdue'>, now = Date.now()): boolean {
  if (b.overdue) return true;
  const due = b.due_at ? parseTs(b.due_at).getTime() : NaN;
  return !Number.isNaN(due) && due - now <= 60 * 60_000;
}

const OUTCOME_SAID: Record<string, string> = {
  sorted: 'Reached — sorted', follow_up: 'Reached — needs a follow-up', answered: 'Answered', no_answer: 'No answer', wrong_number: 'Wrong number', closed: 'Closed',
};

/** "Unassigned · 1 attempt (no answer)", "You · 2 attempts", and once done how it went and who said so. */
function stateLine(b: WebsiteCallback, me: number | null): string {
  if (!isPending(b)) return [b.outcome ? text(OUTCOME_SAID[b.outcome] ?? b.outcome) : text(STATUS[b.status ?? 'done']?.label ?? 'Done'), b.handled_by].filter(Boolean).join(' · ');
  const who = b.assigned_to && b.assigned_to === me ? text('You') : b.assignee ?? text('Unassigned');
  const n = b.attempts ?? 0;
  const tries = n === 0 ? text('Not tried yet') : n === 1 ? text('1 attempt') : text('{n} attempts', { n });
  return `${who} · ${tries}${n && b.status === 'unreachable' ? ` ${text('(no answer)')}` : ''}`;
}

/**
 * Call back (UX-CALL-04): on the WorkSuite phone when it is connected — the VoIP module places the call from the
 * person's extension — otherwise the number is copied to call from another phone. Either way the attempt is logged on
 * the request, so the card's attempts and the transcript say it was tried.
 */
export async function callBack(b: Pick<WebsiteCallback, 'id' | 'phone'>, qc: QueryClient): Promise<'phone' | 'copied' | null> {
  const number = dial(b.phone);
  if (!number) {
    toast('error', text('No number to call back on'));
    return null;
  }
  let via: 'phone' | 'copied' = 'phone';
  try {
    await apiPost('/api/voip/call', { number });
    toast('success', text('Calling {phone} on your WorkSuite phone', { phone: b.phone ?? number }));
  } catch {
    via = 'copied';
    try {
      await navigator.clipboard.writeText(b.phone ?? number);
      toast('success', text('No WorkSuite phone connected — number copied'));
    } catch {
      toast('error', text('No WorkSuite phone connected — call {phone}', { phone: b.phone ?? number }));
    }
  }
  try {
    await apiPost(`${WEBSITE}/callbacks/${b.id}/call`, { via });
  } catch (e) {
    toast('error', errorMessage(e));
  }
  void qc.invalidateQueries({ queryKey: ['website', 'callbacks'] });
  return via;
}

const PILL_BTN = 'flex h-[34px] items-center gap-1.5 rounded-[17px] px-3 text-[12.5px] font-semibold disabled:opacity-50';
const PLAIN_BTN = cx(PILL_BTN, 'border border-line bg-surface text-ink hover:bg-subtle');

function CallbackRequest({ b, open, onPick, onOpenChat, onMarkDone }: { b: WebsiteCallback; open: boolean; onPick: () => void; onOpenChat: () => void; onMarkDone: () => void }) {
  const qc = useQueryClient();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const pending = isPending(b);
  const who = b.company ? `${b.visitor} · ${b.company}` : b.visitor;
  const now = bestTimeNow(b);
  const dialled = () => {
    setBusy(true);
    void callBack(b, qc).finally(() => setBusy(false));
  };
  const reopen = () => {
    setBusy(true);
    void apiPost(`${WEBSITE}/callbacks/${b.id}/reopen`, {}).then(
      () => (toast('success', text('Call-back reopened')), void qc.invalidateQueries({ queryKey: ['website'] })),
      (e) => toast('error', errorMessage(e)),
    ).finally(() => setBusy(false));
  };
  const assignedTo = b.assigned_to && b.assigned_to === me ? text('You') : b.assignee ?? text('Unassigned');
  return (
    <div
      role="listitem"
      aria-label={who}
      aria-current={open || undefined}
      data-callback={b.id}
      className={cx('flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface px-4 py-3.5', open && 'shadow-[inset_3px_0_0_var(--color-primary)]')}
    >
      <button type="button" onClick={onPick} aria-expanded={open} className="flex items-center gap-2.5 text-left">
        <Avatar name={b.visitor} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-bold text-ink">{who}</span>
          <span className="block truncate text-[12px] text-ink-3">{requestLine(b)}</span>
        </span>
        {b.best_time && pending ? (
          <span className={cx('shrink-0 rounded-[8px] px-2.5 py-[3px] text-[11px] font-bold', now ? 'bg-danger-bg text-danger' : 'bg-subtle text-ink-2')}>
            {text('Best time: {when}', { when: b.best_time })}
          </span>
        ) : null}
      </button>
      {open ? (
        <dl className="grid grid-cols-3 gap-2.5 rounded-[10px] bg-subtle px-3 py-2.5 text-[12.5px]">
          <div><dt className="text-ink-3">{text('Phone')}</dt><dd className="font-mono font-medium text-ink select-text">{b.phone ?? '—'}</dd></div>
          <div><dt className="text-ink-3">{text('Asked about')}</dt><dd className="truncate font-bold text-ink select-text" title={b.message ?? undefined}>{b.message ?? '—'}</dd></div>
          <div><dt className="text-ink-3">{text('Assigned to')}</dt><dd className="font-bold text-ink">{pending ? <AssignButton b={b} label={assignedTo} plain /> : assignedTo}</dd></div>
        </dl>
      ) : null}
      <div className="flex items-center gap-2">
        {pending || b.status === 'contacted' ? (
          <button type="button" disabled={busy || !b.phone} title={b.phone ? undefined : text('No number to call back on')} onClick={dialled} className={cx(PILL_BTN, 'border-0 bg-success px-3.5 text-[13px] font-bold text-white hover:opacity-90')}>
            <Icon name="phone" size={14} />
            {text('Call back')}
          </button>
        ) : null}
        {open ? (
          <>
            <button type="button" disabled={!b.phone} className={PLAIN_BTN} onClick={() => void navigator.clipboard.writeText(b.phone ?? '').then(() => toast('success', text('Copied.')))}>{text('Copy number')}</button>
            <button type="button" className={PLAIN_BTN} onClick={onOpenChat}>{text('Open chat')}</button>
          </>
        ) : pending ? <AssignButton b={b} label={text('Assign ▾')} /> : null}
        <span className="flex-1" />
        {open && b.status !== 'done' ? (
          <button type="button" className={cx(PILL_BTN, 'border border-primary bg-selection font-bold text-primary hover:bg-selection/70')} onClick={onMarkDone}>{text('Mark done…')}</button>
        ) : (
          <span className="truncate text-[12px] text-ink-3">{stateLine(b, me)}</span>
        )}
        {!pending ? <button type="button" disabled={busy} className={PLAIN_BTN} onClick={reopen}>{text('Reopen')}</button> : null}
      </div>
    </div>
  );
}

/** Assign ▾ (UX-CALL-03): to me, to a colleague who answers website chats, or to nobody — the bulk bar's menu. */
function AssignButton({ b, label, plain = false }: { b: WebsiteCallback; label: string; plain?: boolean }) {
  const qc = useQueryClient();
  const me = useMe();
  const anchor = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const agents = useAgents(menu);
  const assign = (userId: number | null) => {
    void apiPost(`${WEBSITE}/callbacks/${b.id}/assign`, { user_id: userId }).then(
      () => (toast('success', userId === null ? text('Unassigned') : text('Assigned')), void qc.invalidateQueries({ queryKey: ['website', 'callbacks'] })),
      (e) => toast('error', errorMessage(e)),
    );
  };
  return (
    <>
      <button ref={anchor} type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(true)}
        className={plain ? 'font-bold text-ink hover:text-primary hover:underline' : PLAIN_BTN}>
        {label}
      </button>
      {menu ? (
        <Menu label={text('Assign to')} anchor={anchor} prefer="bottom" align="start" onClose={() => setMenu(false)}
          sections={assignSections(me, agents.data?.agents ?? [], assign, { unassign: !!b.assigned_to, current: b.assigned_to ?? null })} />
      ) : null}
    </>
  );
}

const DONE_OUTCOMES: Array<{ id: CallbackDoneOutcome; label: string; done: string }> = [
  { id: 'sorted', label: 'Reached — sorted', done: 'Call-back done' },
  { id: 'follow_up', label: 'Reached — needs a follow-up', done: 'Marked for a follow-up' },
  { id: 'keep_open', label: 'No answer — keep it open', done: 'Kept open — try again in an hour' },
  { id: 'wrong_number', label: 'Wrong number', done: 'Call-back closed' },
];

/** Mark done… (UX-CALL-03): how did it go, and a note only the team sees. */
function MarkDonePanel({ b, onClose }: { b: WebsiteCallback; onClose: () => void }) {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<CallbackDoneOutcome>('sorted');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = () => {
    setBusy(true);
    const body = { outcome: outcome === 'keep_open' ? 'no_answer' : outcome, ...(outcome === 'keep_open' ? { keep_open: true } : {}), ...(note.trim() ? { note: note.trim() } : {}) };
    void apiPost(`${WEBSITE}/callbacks/${b.id}/done`, body).then(
      () => {
        toast('success', text(DONE_OUTCOMES.find((o) => o.id === outcome)!.done));
        void qc.invalidateQueries({ queryKey: ['website'] });
        onClose();
      },
      (e) => {
        toast('error', errorMessage(e));
        setBusy(false);
      },
    );
  };
  return (
    <aside aria-label={text('Mark call-back done')} className="flex w-[360px] shrink-0 flex-col self-start rounded-[14px] border border-line bg-surface shadow-[0_16px_40px_rgba(17,27,59,0.12)]">
      <div className="border-b border-line px-4 py-3.5">
        <h2 className="text-[15px] font-bold text-ink">{text('Mark call-back done')}</h2>
        <div className="text-[12px] text-ink-3">{[b.visitor, b.phone].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="flex flex-col gap-2 px-4 py-3.5 text-[13px]">
        <div id={`cb-how-${b.id}`} className="text-[12.5px] font-semibold text-ink">{text('How did it go?')}</div>
        <div role="radiogroup" aria-labelledby={`cb-how-${b.id}`} className="flex flex-col gap-2">
          {DONE_OUTCOMES.map((o) => (
            <label key={o.id} className={cx('flex cursor-pointer items-center gap-2.5 rounded-[10px] px-3 py-[9px] text-ink', outcome === o.id ? 'border-2 border-primary bg-selection/50' : 'border border-line hover:bg-subtle')}>
              <input type="radio" name={`cb-outcome-${b.id}`} checked={outcome === o.id} onChange={() => setOutcome(o.id)} className="accent-[var(--color-primary)]" />
              {text(o.label)}
            </label>
          ))}
        </div>
        <label htmlFor={`cb-note-${b.id}`} className="mt-1 text-[12.5px] font-semibold text-ink">{text('Note (staff only)')}</label>
        <textarea id={`cb-note-${b.id}`} value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()}
          className="w-full resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary" />
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
        <Button onClick={onClose}>{text('Cancel')}</Button>
        <Button variant="primary" disabled={busy} onClick={save}>{text('Mark done')}</Button>
      </div>
    </aside>
  );
}
