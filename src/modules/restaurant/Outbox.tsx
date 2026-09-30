import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { RestaurantOutboxItem } from '@shared/restaurant';
import { Button, Card, Chip, Modal, Spinner, TextField } from '../../components/ui';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { bridge, get, K, refusal, write, type Conflict, type Floor } from './api';
import { useT } from './i18n';
import { Failed, Heading, Note, ReasonField, useTill } from './parts';

/**
 * What this till kept while WorkSuite was out of reach, and what came of it
 * (RM-ARC-020..023): orders, lines and sends waiting to go, in order; those
 * the server took as a conflict — the sale kept, off a table somebody else
 * seated, or an item sold while unavailable — marked until a manager settles
 * them; and those it refused, to send again or let go.
 *
 * For somebody who settles conflicts (`restaurant.order.cancel`), the
 * branch's open conflicts from every terminal: put an order kept off its
 * table on a table, or dismiss it with a note (`sync/conflicts`).
 */
export default function Outbox() {
  const t = useT();
  const till = useTill();
  const qc = useQueryClient();
  const items = useQuery({ queryKey: K.outbox, queryFn: bridge.outbox, refetchInterval: 10_000 });
  const conflicts = useQuery({
    queryKey: K.conflicts(till.branch),
    queryFn: ({ signal }) => get<{ conflicts: Conflict[] }>('/sync/conflicts', { branch_id: till.branch, status: 'open' }, signal).then((d) => d.conflicts),
    enabled: !till.offline && till.can('order_cancel'),
    refetchInterval: 20_000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [settling, setSettling] = useState<Conflict | null>(null);

  async function resolve(i: RestaurantOutboxItem, action: 'retry' | 'drop') {
    setBusy(`${action}-${i.id}`);
    try {
      qc.setQueryData(K.outbox, await call('restaurant:outboxResolve', { id: i.id, action }));
      void qc.invalidateQueries({ queryKey: K.status });
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function syncNow() {
    setBusy('sync');
    try {
      await bridge.syncNow();
      void qc.invalidateQueries({ queryKey: K.outbox });
    } finally {
      setBusy(null);
    }
  }

  if (items.isError) return <div className="p-6"><Failed text={t('outbox.unreadable')} onRetry={() => void items.refetch()} /></div>;
  if (!items.data) return <Spinner />;
  const s = till.status;

  return (
    <div className="flex max-w-[900px] flex-col gap-4 p-6">
      <Heading
        title={t('nav.outbox')}
        hint={s?.last_sync ? t('outbox.lastSync', { at: new Date(s.last_sync.at).toLocaleTimeString(), applied: s.last_sync.applied }) : t('outbox.hint')}
        action={
          <Button icon="upload" loading={busy === 'sync'} onClick={() => void syncNow()}>
            {t('outbox.sendNow')}
          </Button>
        }
      />
      {s && !s.can_queue && s.why_not ? <Note tone="muted">{s.why_not}</Note> : null}
      {s && s.others > 0 ? <Note tone="muted">{t('outbox.others', { n: s.others })}</Note> : null}
      <Card title={t('outbox.mine')}>
        {items.data.length === 0 ? <p className="text-[13px] text-ink-3">{t('outbox.empty')}</p> : null}
        <ul className="flex flex-col divide-y divide-line">
          {items.data.map((i) => (
            <li key={i.id} className="flex flex-col gap-1.5 py-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-ink">{i.label}</span>
                <Chip tone={i.state === 'waiting' ? 'indigo' : i.state === 'conflict' ? 'warning' : 'danger'}>{t(`outbox.state.${i.state}`)}</Chip>
              </div>
              <div className="text-[12px] text-ink-3">
                {t(`outbox.op.${i.op}`)} · {new Date(i.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {i.order ? ` · #${i.order.number}` : ''}
                {i.attempts > 0 ? ` · ${t('outbox.attempts', { n: i.attempts })}` : ''}
              </div>
              {i.message ? <div className="text-[12.5px] text-ink-2">{i.message}</div> : null}
              {i.state !== 'waiting' ? (
                <div className="flex gap-2">
                  {i.state === 'refused' ? (
                    <Button size="sm" loading={busy === `retry-${i.id}`} onClick={() => void resolve(i, 'retry')}>
                      {t('outbox.retry')}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" loading={busy === `drop-${i.id}`} onClick={() => void resolve(i, 'drop')}>
                    {i.state === 'conflict' ? t('outbox.seen') : t('outbox.drop')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {till.can('order_cancel') && !till.offline ? (
        <Card title={t('outbox.conflicts')}>
          {conflicts.isError ? <Failed text={refusal(conflicts.error).message} onRetry={() => void conflicts.refetch()} /> : null}
          {conflicts.data?.length === 0 ? <p className="text-[13px] text-ink-3">{t('outbox.noConflicts')}</p> : null}
          <ul className="flex flex-col divide-y divide-line">
            {(conflicts.data ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-ink">{c.kind_label}</div>
                  <div className="text-[12.5px] text-ink-2">{c.message}</div>
                </div>
                <Button size="sm" onClick={() => setSettling(c)}>
                  {t('outbox.settle')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {settling ? <Settle conflict={settling} onClose={() => setSettling(null)} onDone={() => void qc.invalidateQueries({ queryKey: K.conflicts(till.branch) })} /> : null}
    </div>
  );
}

function Settle({ conflict, onClose, onDone }: { conflict: Conflict; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const till = useTill();
  const floor = useQuery({ queryKey: K.floor(till.branch), queryFn: ({ signal }) => get<Floor>('/floor', { branch_id: till.branch }, signal).then((d) => ({ data: d })) });
  const [table, setTable] = useState<number | null>(null);
  const [guests, setGuests] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachable = conflict.entity === 'order' && conflict.entity_id !== null;

  async function run(action: 'attach' | 'dismiss') {
    setBusy(true);
    setError(null);
    try {
      const r = await write(`/sync/conflicts/${conflict.id}/resolve`, { action, table_id: table ?? undefined, guests: guests ? Number(guests) : undefined, note: note.trim() || undefined });
      toast('success', r.message ?? t('outbox.settled'));
      onDone();
      onClose();
    } catch (e) {
      setError(refusal(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={conflict.kind_label}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={busy} disabled={!note.trim()} onClick={() => void run('dismiss')}>
            {t('outbox.dismiss')}
          </Button>
          {attachable ? (
            <Button variant="primary" loading={busy} disabled={!table} onClick={() => void run('attach')}>
              {t('outbox.attach')}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-2">{conflict.message}</p>
        {attachable ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[12.5px] font-semibold text-ink-2">{t('outbox.table')}</span>
              <select value={table ?? ''} onChange={(e) => setTable(e.target.value ? Number(e.target.value) : null)} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]">
                <option value="">—</option>
                {(floor.data?.data.tables ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code} · {x.status_label}
                  </option>
                ))}
              </select>
            </label>
            <TextField label={t('floor.howMany')} type="number" min={1} value={guests} onChange={(e) => setGuests(e.target.value)} />
          </>
        ) : null}
        <ReasonField label={t('outbox.note')} value={note} onChange={setNote} />
        {error ? <Note tone="danger">{error}</Note> : null}
      </div>
    </Modal>
  );
}
