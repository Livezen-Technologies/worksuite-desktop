import { useState } from 'react';
import { TASK_STATUS_LABEL, type ProjectsOutboxItem, type ProjectTaskStatus } from '@shared/projects';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import { setOutbox } from './desk';
import { statusLabel } from './api';

/**
 * Projects offline (PRJ-DSK-04, NFR-09, D04): the banner that says what is kept and what waits, the outbox in the
 * order it will be sent, and the choice a move needs when the task changed on the server meanwhile.
 */

export function OfflineBanner({ waiting }: { waiting: number }) {
  const [busy, setBusy] = useState(false);
  const tryNow = async () => {
    setBusy(true);
    try {
      const r = await call('projects:replay');
      setOutbox(r.items);
      toast(r.online ? 'success' : 'info', r.online ? (r.items.length ? 'Back online — what could go has gone.' : 'Back online — everything was sent.') : 'Still offline. What you do is kept.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="status" className="flex shrink-0 items-center gap-3 border-b border-warning/30 bg-warning-bg px-5 py-2 text-[12.5px] text-warning-ink">
      <Icon name="cloud-off" size={15} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <b>You’re working offline.</b> Moves, notes, comments and time are kept and sent when the connection returns. Approvals, budget changes and change-request decisions wait for a connection.
        {waiting ? <span className="ml-1 font-semibold">{waiting === 1 ? '1 change waiting.' : `${waiting} changes waiting.`}</span> : null}
      </span>
      <Button size="sm" loading={busy} onClick={() => void tryNow()} className="shrink-0">
        Try now
      </Button>
    </div>
  );
}

const STATE: Record<ProjectsOutboxItem['state'], { label: string; tone: string }> = {
  waiting: { label: 'Waiting', tone: 'bg-warning-bg text-warning-ink' },
  sending: { label: 'Sending', tone: 'bg-selection text-primary' },
  conflict: { label: 'Will ask', tone: 'bg-danger-bg text-danger' },
  refused: { label: 'Not taken', tone: 'bg-danger-bg text-danger' },
};

const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export function OutboxPanel({ items, offline }: { items: ProjectsOutboxItem[]; offline: boolean }) {
  const resolve = async (id: string, choice: 'mine' | 'theirs') => {
    try {
      setOutbox(await call('projects:resolve', { id, choice }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const discard = async (id: string) => {
    try {
      setOutbox(await call('projects:discard', { id }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const asking = items.filter((i) => i.state === 'conflict' && i.theirs);
  return (
    <aside aria-label="Outbox" className="flex w-[300px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-line bg-surface px-3.5 py-3.5 text-[12.5px] scroll-thin">
      <h2 className="flex items-baseline gap-1.5 text-[14px] font-bold text-ink">
        Outbox <span className="text-[11.5px] font-normal text-ink-3">sent in this order</span>
      </h2>
      {items.length ? (
        <ol className="flex flex-col gap-1.5">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 rounded-[8px] border border-line px-2 py-1.5">
              <span className="font-mono text-[11px] text-ink-3">{hm(i.createdAt)}</span>
              <span className="min-w-0 flex-1 text-ink" title={i.message ?? undefined}>
                {i.label}
                {i.state === 'refused' && i.message ? <span className="block text-[11.5px] text-danger">{i.message}</span> : null}
              </span>
              <span className={cx('rounded-full px-2 py-px text-[11px] font-semibold whitespace-nowrap', STATE[i.state].tone)}>{STATE[i.state].label}</span>
              {i.state === 'refused' ? (
                <span className="flex flex-col gap-0.5">
                  <button type="button" className="text-[11px] font-semibold text-primary hover:underline" onClick={() => void resolve(i.id, 'mine')}>
                    Retry
                  </button>
                  <button type="button" className="text-[11px] text-ink-3 hover:underline" onClick={() => void discard(i.id)}>
                    Dismiss
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-ink-3">Nothing waiting. What you do offline is kept here until it is sent.</p>
      )}
      {asking.map((i) => {
        const theirs = i.theirs!;
        const mine = i.status as ProjectTaskStatus | null;
        return (
          <div key={`c${i.id}`} className="rounded-[10px] border border-danger/40 bg-danger-bg px-3 py-2.5 text-ink">
            <b className="text-danger">{offline ? 'Needs your choice when you reconnect' : 'Needs your choice'}</b>
            <p className="mt-1 leading-snug text-ink-2">
              You moved <b className="text-ink">{[theirs.number, theirs.title].filter(Boolean).join(' ')}</b> to {mine ? TASK_STATUS_LABEL[mine] : 'another column'}. While you were offline {theirs.updatedBy ?? 'someone'} moved it to <b className="text-ink">{statusLabel(theirs.status)}</b>.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button size="sm" variant="primary" onClick={() => void resolve(i.id, 'theirs')}>
                Keep {statusLabel(theirs.status)}
              </Button>
              <Button size="sm" disabled={offline} title={offline ? 'Applying your move needs a connection' : undefined} onClick={() => void resolve(i.id, 'mine')}>
                {mine === 'completed' ? 'Complete' : mine && ['todo', 'in_progress', 'in_review', 'testing', 'backlog'].includes(mine) && theirs.status === 'completed' ? `Reopen to ${TASK_STATUS_LABEL[mine]}` : `Move to ${mine ? TASK_STATUS_LABEL[mine] : 'mine'}`}
              </Button>
            </div>
          </div>
        );
      })}
      <p className="mt-auto pt-2 text-[11.5px] text-ink-3">Kept for offline: your pinned projects, your tasks and the last 30 days of your time. Cleared when you sign out.</p>
    </aside>
  );
}
