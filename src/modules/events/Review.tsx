import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Card, Empty, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import type { DeskQueueItem } from '@shared/event-desk';
import { at, eGet, ePost, errorText, K, type Paged, type ReconItem } from './api';
import { DK, deskQueueResolve, deskSync, useDeskQueue, useDeskStatus } from './desk';
import { Header, Refusal, useEvent } from './parts';
import { SyncButton } from '../../components/SyncButton';

/**
 * What offline check-in left to look at (EV-OFF-012/013): the server's
 * reconciliation queue — possible duplicate entries (both records kept),
 * tickets let in offline that were cancelled meanwhile, codes it did not
 * know, walk-ins it could not confirm — resolved with a note or dismissed
 * with a reason; and this desk's own queue: what still waits for WorkSuite,
 * and what the server made of what went.
 */
const FLAG: Record<string, string> = {
  POSSIBLE_DUPLICATE: 'Possible duplicate entry',
  CANCELLED_OFFLINE: 'Let in while cancelled on the server',
  UNKNOWN_TOKEN: 'A code WorkSuite does not know',
  PROVISIONAL_WALK_IN: 'Walk-in not confirmed',
};

const STATE: Record<DeskQueueItem['state'], string> = { waiting: 'Waiting for WorkSuite', recorded: 'Recorded', replayed: 'Recorded before', conflict: 'Recorded, to review', rejected: 'Not taken' };

export default function Review() {
  const { event, may, online } = useEvent();
  const qc = useQueryClient();
  const status = useDeskStatus(event.id);
  const queue = useDeskQueue(event.id);
  const [which, setWhich] = useState<'OPEN' | 'ALL'>('OPEN');
  const items = useQuery({
    queryKey: [...K.live(event.id), 'recon', which],
    queryFn: ({ signal }) => eGet<Paged<ReconItem>>(`/events/${event.id}/checkin/reconciliation`, { status: which, per_page: 100 }, signal),
    enabled: online,
  });
  const [acting, setActing] = useState<{ item: ReconItem; on: 'resolve' | 'dismiss' } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = async () => {
    if (!acting) return;
    setBusy(true);
    setError(null);
    try {
      const r = await ePost(`/reconciliation/${acting.item.id}/${acting.on}`, acting.on === 'resolve' ? { note: text.trim() || undefined, version: acting.item.version } : { reason: text.trim(), version: acting.item.version });
      toast('success', r.message);
      setActing(null);
      setText('');
      void qc.invalidateQueries({ queryKey: K.live(event.id) });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const mine = queue.data ?? [];
  const resolveMine = async (q: DeskQueueItem, action: 'retry' | 'drop') => {
    try {
      await deskQueueResolve(event.id, q.client_uuid, action);
      void qc.invalidateQueries({ queryKey: DK.all });
    } catch (e) {
      toast('error', errorText(e));
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-6">
      <Header
        title="To review"
        sub="Offline check-ins WorkSuite flagged, and this desk’s own queue"
        actions={
          <SyncButton
            size="sm"
            disabled={!online}
            onSync={() =>
              deskSync(event.id).then(
                () => qc.invalidateQueries({ queryKey: DK.all }),
                (e) => {
                  toast('error', errorText(e));
                  throw e;
                },
              )
            }
          />
        }
      />
      <div className="flex flex-col gap-4 px-6">
        <Card
          title="Flagged by WorkSuite"
          action={
            <div className="flex gap-1">
              {(['OPEN', 'ALL'] as const).map((w) => (
                <button key={w} type="button" aria-pressed={which === w} onClick={() => setWhich(w)} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-semibold', which === w ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}>
                  {w === 'OPEN' ? 'Open' : 'All'}
                </button>
              ))}
            </div>
          }
        >
          {!online ? <p className="m-0 text-[13px] text-ink-3">The review queue is WorkSuite’s: it comes back with the line.</p> : null}
          {items.isLoading ? <Spinner /> : null}
          {items.error ? <Refusal text={errorText(items.error)} /> : null}
          {items.data && items.data.items.length === 0 ? <Empty icon="check-circle" title="Nothing to review" hint="Both records of a double entry are always kept; nothing is deleted." /> : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items.data?.items.map((it) => (
              <li key={it.id} className="flex flex-col gap-1.5 rounded-[10px] border border-line px-3 py-2.5 text-[13px]">
                <div className="flex items-start gap-2">
                  <Icon name={it.status === 'OPEN' ? 'warning' : 'check-circle'} size={16} className={cx('mt-0.5', it.status === 'OPEN' ? 'text-warning' : 'text-success')} />
                  <div className="min-w-0 flex-1">
                    <b>{it.kind_label}</b>
                    {it.registration ? (
                      <span className="text-ink-2">
                        {' '}
                        · {it.registration.number} ({it.registration.status_label})
                      </span>
                    ) : null}
                    <div className="text-ink-2">{it.detail}</div>
                    {it.server_status ? <div className="text-[12px] text-ink-3">On the server: {it.server_status}</div> : null}
                    {it.records.length > 0 ? (
                      <ul className="mt-1 mb-0 list-none p-0 text-[12px] text-ink-2">
                        {it.records.map((r) => (
                          <li key={r.id}>
                            {at(r.at)} · {r.label} · {r.gate?.name ?? 'no gate'} · {r.source === 'OFFLINE' ? 'offline' : 'online'}
                            {r.by ? ` · ${r.by}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {it.status !== 'OPEN' ? (
                      <div className="mt-1 text-[12px] text-ink-3">
                        {it.status_label}
                        {it.resolved_by ? ` by ${it.resolved_by}` : ''}
                        {it.resolved_at ? `, ${at(it.resolved_at)}` : ''}
                        {it.resolution_note ? ` — ${it.resolution_note}` : ''}
                      </div>
                    ) : null}
                  </div>
                  {it.status === 'OPEN' && may('events.registration.edit') ? (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" onClick={() => setActing({ item: it, on: 'resolve' })}>
                        Resolve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setActing({ item: it, on: 'dismiss' })}>
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="This desk’s offline scans">
          {status.data?.others ? <p className="mt-0 text-[12.5px] text-ink-2">{status.data.others} scan(s) made here by someone else wait for them to sign in here.</p> : null}
          {mine.length === 0 ? <p className="m-0 text-[13px] text-ink-3">Nothing was scanned here offline.</p> : null}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {mine.map((q) => (
              <li key={q.client_uuid} className="flex items-center gap-2 rounded-[8px] border border-line px-3 py-1.5 text-[12.5px]">
                <Icon name={q.state === 'waiting' ? 'clock' : q.state === 'rejected' ? 'x-circle' : q.state === 'conflict' ? 'warning' : 'check'} size={14} className={cx(q.state === 'conflict' ? 'text-warning' : q.state === 'rejected' ? 'text-danger' : 'text-ink-3')} />
                <span className="min-w-0 flex-1 truncate">
                  <b>{q.label}</b> · {q.action === 'WALK_IN' ? 'walk-in' : q.action === 'CHECK_OUT' ? 'check-out' : q.local_result === 'VALID' ? 'check-in' : `refused (${q.local_result.toLowerCase().replace(/_/g, ' ')})`} · {at(q.occurred_at)}
                  {q.flag ? <span className="text-warning"> · {FLAG[q.flag] ?? q.flag}</span> : null}
                  {q.registration_number && q.action === 'WALK_IN' ? ` · now ${q.registration_number}` : ''}
                  {q.message ? <span className="text-ink-3"> — {q.message}</span> : null}
                </span>
                <span className="shrink-0 text-ink-3">{STATE[q.state]}</span>
                {q.state === 'rejected' ? (
                  <>
                    <Button size="sm" onClick={() => void resolveMine(q, 'retry')}>
                      Send again
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void resolveMine(q, 'drop')}>
                      Drop
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {acting ? (
        <Modal
          title={acting.on === 'resolve' ? 'Resolve' : 'Dismiss'}
          onClose={() => setActing(null)}
          width={460}
          footer={
            <>
              <Button onClick={() => setActing(null)}>Cancel</Button>
              <Button variant="primary" loading={busy} disabled={acting.on === 'dismiss' && !text.trim()} onClick={() => void move()}>
                {acting.on === 'resolve' ? 'Resolve' : 'Dismiss'}
              </Button>
            </>
          }
        >
          <p className="mt-0 text-[13px] text-ink-2">{acting.item.detail}</p>
          <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-2">
            {acting.on === 'resolve' ? 'What was done (optional)' : 'Why it needs nothing'}
            <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} className="rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[13px] font-normal text-ink outline-none focus:border-primary" />
          </label>
          <p className="mb-0 text-[11.5px] text-ink-3">The records stay as they are; a resolution is a note.</p>
          {error ? (
            <div className="mt-2">
              <Refusal text={error} />
            </div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
