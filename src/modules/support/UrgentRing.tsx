import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { SLA_TARGET_LABEL, spanShort, ticketIdOf, type Agent, type TicketFull } from '@shared/support';
import { ApiError } from '../../core/api';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { Avatar, Button, Kbd, Spinner, cx } from '../../components/ui';
import { playOnce, ringVolume } from '../calls/tones';
import { K, agents, assign, errorText, getTicket, refusalCode, take } from './api';
import { ChannelIcon, PriorityChip, Reference, presenceLabel, requesterLine } from './parts';

/**
 * The live SLA countdown a ringing card shows (FR-SLA-01/07): the first-response timer while there is no response —
 * from the ticket's timers when the server sends them, else its current target — with the time left, or how long ago
 * it was missed. Null without a policy.
 */
export function ringCountdown(t: Pick<TicketFull, 'sla' | 'sla_timers'>, now: number): { label: string; due: string | null; left: string; overdue: boolean } | null {
  const timer = (t.sla_timers ?? []).find((x) => x.target === 'first_response' && x.state !== 'met') ?? null;
  const target = timer?.target ?? t.sla?.target ?? null;
  const dueAt = timer?.due_at ?? t.sla?.due_at ?? null;
  if (!target || !dueAt || t.sla?.state === 'none') return null;
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return null;
  const ms = due - now;
  const s = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const clock = s < 3600 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : spanShort(Math.abs(ms));
  return { label: text(SLA_TARGET_LABEL[target]), due: dueAt, left: clock, overdue: ms < 0 };
}

/**
 * An urgent ticket ringing (WS-SUPPORT-SRS-001 D-07, FR-DSK-03, FR-NTF-03): a centred card that takes the focus, for
 * a new urgent ticket nobody has in my queues (electron/services/support-urgent.ts decides when).
 *
 *  - Context (FR-AI-03 without the AI): the queue, reference, requester and their organization, the subject and the
 *    first lines of what they wrote; the live first-response countdown from the matched SLA (FR-SLA-01/07).
 *  - Take it ↵ (FR-ASN-03): the ticket is mine and its tab opens in the main window; everybody else's card closes when
 *    their app next looks.
 *  - Assign… (A, FR-ASN-02/05): the people who can take it, with their presence and load against capacity.
 *  - Dismiss (Esc, FR-SLA-06): it stops ringing for me; the ticket stays unassigned and keeps escalating.
 *
 * Take and assign are journalled by the server with the previous owner (FR-ASN-08), and sent with the version shown.
 */
export function UrgentRing({ ticketKey }: { ticketKey: string }) {
  const qc = useQueryClient();
  const id = ticketIdOf(ticketKey);
  const q = useQuery({ queryKey: K.ticket(id ?? 0), queryFn: ({ signal }) => getTicket(id!, { peek: true }, signal), enabled: id !== null });
  const people = useQuery({ queryKey: K.agents(`ticket:${id}`), queryFn: () => agents({ ticket_id: id! }), enabled: id !== null, staleTime: 30_000 });
  const sounds = useStore(app, (s) => s.prefs?.notificationSounds !== false);
  const now = useNow(1_000).getTime();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const rang = useRef(false);
  const show = q.data;

  // One chime as it appears (D-07: "rings").
  useEffect(() => {
    if (!show || rang.current) return;
    rang.current = true;
    if (sounds) {
      try {
        playOnce('webchat-strong', ringVolume());
      } catch {
        // No audio here: the card is enough.
      }
    }
  }, [show, sounds]);

  const close = () => void call('windows:close').catch(() => undefined);
  const done = () => {
    void qc.invalidateQueries({ queryKey: K.lists });
    void qc.invalidateQueries({ queryKey: ['support', 'views'] });
  };

  const takeIt = async () => {
    if (!show || busy) return;
    setBusy(true);
    try {
      await take(show.ticket.id, show.ticket.version || undefined);
      done();
      // The ticket's tab in the main window (/support/ring/{id} is the ticket's route there); this card closes.
      await call('windows:toMain', {}).catch(close);
    } catch (e) {
      toast('error', refusalCode(e) === 'ALREADY_ASSIGNED' ? text('Somebody else has just taken {ref}.', { ref: show.ticket.reference }) : errorText(e));
      if (refusalCode(e) === 'ALREADY_ASSIGNED') close();
    } finally {
      setBusy(false);
    }
  };

  const give = async (a: Agent) => {
    if (!show || busy) return;
    setBusy(true);
    try {
      await assign(show.ticket.id, { user_id: a.id, version: show.ticket.version || undefined });
      toast('success', text('{ref} assigned to {name}.', { ref: show.ticket.reference, name: a.name }));
      done();
      close();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (picking) setPicking(false);
        else close();
      } else if (e.key === 'Enter' && !picking && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        void takeIt();
      } else if ((e.key === 'a' || e.key === 'A') && !picking) {
        e.preventDefault();
        setPicking(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (q.isLoading) return <Spinner />;
  if (!show) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-ink-2">
        {q.error instanceof ApiError && q.error.status === 404 ? text('This ticket is no longer there.') : errorText(q.error)}
        <Button onClick={close}>{text('Close')}</Button>
      </div>
    );
  }
  const t = show.ticket;
  const queue = t.team?.name ?? t.category?.name ?? t.organization?.name ?? text('your');
  const first = show.messages.find((m) => m.from === 'requester' && !m.internal) ?? show.messages[0] ?? null;
  const countdown = ringCountdown(t, now);
  const online = (people.data ?? []).filter((p) => p.presence === 'available');
  const age = t.created_at ? spanShort(now - Date.parse(t.created_at)) : null;
  const canTake = show.can.reply === true && !t.assignee;
  const canAssign = show.can.assign === true;

  return (
    <article aria-label={text('Urgent ticket {ref}', { ref: t.reference })} className="drag flex h-full flex-col gap-3 border-t-4 border-red bg-surface p-4">
      <header className="flex flex-col gap-1">
        <p className="flex items-center gap-2 text-[12px] font-bold text-red uppercase">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red" aria-hidden />
          {text('New urgent ticket in {queue} queue', { queue })}
        </p>
        <p className="text-[11.5px] text-ink-3">
          {[age ? text('Unassigned {time}', { time: age }) : text('Unassigned'), online.length ? text('{n} online who can take it', { n: online.length }) : null].filter(Boolean).join(' · ')}
        </p>
      </header>
      <div className="flex min-w-0 items-center gap-2 text-[12.5px] text-ink-2">
        <Reference className="font-semibold text-ink">{t.reference}</Reference>
        <ChannelIcon source={t.source} />
        <PriorityChip priority={t.priority} />
        <span className="min-w-0 truncate">{requesterLine(t.requester)}</span>
      </div>
      <h2 className="text-[16px] leading-snug font-extrabold text-ink">{t.subject}</h2>
      {first ? <p className="line-clamp-3 text-[12.5px] text-ink-2">“{first.body}”</p> : null}
      {countdown ? (
        <div role="timer" aria-label={text('{target} due', { target: countdown.label })} className={cx('flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12.5px]', countdown.overdue ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning-ink')}>
          <b>{countdown.overdue ? text('{target} overdue', { target: countdown.label }) : text('{target} due', { target: countdown.label })}</b>
          <span className="font-mono text-[15px] font-bold tabular-nums">{countdown.left}</span>
          {countdown.due ? <span className="ml-auto">{text('due {time}', { time: timeLabel(countdown.due) })}</span> : null}
        </div>
      ) : null}
      {picking ? (
        <ul aria-label={text('Assign to')} className="no-drag flex max-h-[160px] flex-col gap-1 overflow-y-auto scroll-thin">
          {(people.data ?? []).map((p) => (
            <li key={p.id}>
              <button type="button" disabled={busy} onClick={() => void give(p)} className="flex w-full items-center gap-2 rounded-[8px] border border-line px-2 py-1.5 text-left text-[12.5px] hover:bg-subtle">
                <Avatar name={p.name} size={22} />
                <b className="min-w-0 flex-1 truncate text-ink">{p.name}</b>
                <span className="text-ink-3">{presenceLabel(p.presence)}</span>
                <span className="text-ink-3">{p.capacity ? `${p.open} / ${p.capacity}` : p.open}</span>
              </button>
            </li>
          ))}
          {people.data && !people.data.length ? <li className="text-[12px] text-ink-3">{text('Nobody else can take it.')}</li> : null}
        </ul>
      ) : null}
      <footer className="no-drag mt-auto flex items-center gap-2">
        {canTake ? (
          <Button variant="primary" icon="user-plus" loading={busy} onClick={() => void takeIt()} aria-keyshortcuts="Enter">
            {text('Take it')} <Kbd tone="accent" aria-hidden>↵</Kbd>
          </Button>
        ) : null}
        {canAssign ? (
          <Button onClick={() => setPicking(!picking)} aria-expanded={picking} aria-keyshortcuts="A">
            {text('Assign…')} <Kbd tone="key" aria-hidden>A</Kbd>
          </Button>
        ) : null}
        <Button variant="ghost" className="ml-auto" onClick={close} aria-keyshortcuts="Escape">
          {text('Dismiss')} <Kbd tone="key" aria-hidden>Esc</Kbd>
        </Button>
      </footer>
      <p className="text-[11px] text-ink-3">{text('Rings for urgent tickets only. Dismiss stops it for you; the ticket stays unassigned.')}</p>
    </article>
  );
}
