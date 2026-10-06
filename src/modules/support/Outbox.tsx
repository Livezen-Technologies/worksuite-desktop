import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Meta, TicketFull } from '@shared/support';
import type { OfflineMutation } from '@shared/types';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Modal, cx } from '../../components/ui';
import { K, errorText, meta } from './api';
import { OUTBOX_KIND_LABEL, changesOf, mergeTags, messageOf, outboxItems, theirsOf, type OutboxItem } from './queued';
import { Reference } from './parts';
import { changeField, currentOf, describe, sendChange, type Change } from './Properties';

const PENDING = ['offline', 'pending'] as const;

/** The desk's queued changes, kept current while there are any (or while offline). */
export function useSupportOutbox(): { items: OutboxItem[]; offline: boolean } {
  const offline = useStore(app, (s) => s.status?.network === 'OFFLINE');
  const q = useQuery({ queryKey: PENDING, queryFn: () => call('offline:pending'), refetchInterval: (query) => (offline || outboxItems(query.state.data as OfflineMutation[] | undefined).length ? 4_000 : 30_000) });
  return { items: outboxItems(q.data as OfflineMutation[] | undefined), offline };
}

/** "3 queued · 1 conflict": the outbox in a few words. */
export function outboxWords(items: OutboxItem[]): string {
  const queued = items.filter((i) => i.m.state === 'PENDING' || i.m.state === 'SYNCING').length;
  const conflicts = items.filter((i) => i.m.state === 'CONFLICT').length;
  const failed = items.filter((i) => i.m.state === 'FAILED').length;
  return [
    queued ? text('{n} queued', { n: queued }) : null,
    conflicts ? (conflicts === 1 ? text('1 conflict') : text('{n} conflicts', { n: conflicts })) : null,
    failed ? text('{n} not sent', { n: failed }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Offline mode on the desk (WS-SUPPORT-SRS-001 D-09, FR-DSK-07): the strip above the inbox and a ticket's tab.
 *
 *  - Offline: the lists and the tickets already opened are the copy kept on this computer (the read cache); replies,
 *    notes, status and property changes are queued, encrypted, and sent in order when WorkSuite is back — "Retry now"
 *    asks at once.
 *  - The outbox: what is queued, with its conflicts and anything the server refused, opened from here.
 */
export function OutboxBar() {
  const { items, offline } = useSupportOutbox();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  if (!offline && !items.length) return null;
  const conflict = items.some((i) => i.m.state === 'CONFLICT' || i.m.state === 'FAILED');
  const retry = () =>
    void call('offline:replay')
      .then(() => qc.invalidateQueries({ queryKey: PENDING }))
      .catch((e: unknown) => toast('error', errorText(e)));
  return (
    <div role="status" className={cx('flex shrink-0 items-center gap-2 border-b border-line px-4 py-1.5 text-[12.5px]', offline ? 'bg-warning-bg text-warning-ink' : 'bg-subtle text-ink-2')}>
      <Icon name={offline ? 'cloud-off' : 'upload'} size={14} />
      <span className="min-w-0 truncate">
        {offline ? text('Offline — showing the tickets kept on this computer. Replies, notes and changes are queued and sent in order when WorkSuite is back.') : text('Sending what was queued while you were offline.')}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {offline ? (
          <Button size="sm" variant="ghost" onClick={retry}>
            {text('Retry now')}
          </Button>
        ) : null}
        {items.length ? (
          <Button size="sm" variant={conflict ? 'primary' : 'secondary'} icon="inbox" onClick={() => setOpen(true)}>
            {text('Outbox')} · {outboxWords(items)}
          </Button>
        ) : null}
      </span>
      {open ? <OutboxPanel items={items} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

/**
 * The outbox (D-09): every queued reply, note and change in the order it goes, kept if WorkSuite quits.
 *
 *  - Waiting: edit a message's words, or discard it, before it goes (FR-CRT-10).
 *  - Conflict (FR-TKT-10, FR-MOB-03): the ticket changed on the server while I was offline, so the change was refused
 *    (409) rather than written over theirs. Mine against the server's, field by field: keep the server's, or set mine
 *    on top. Tags are merged without asking. Later changes to the same ticket wait until it is settled.
 *  - Not sent: what the server refused, and why; retry or discard.
 */
export function OutboxPanel({ items, onClose }: { items: OutboxItem[]; onClose: () => void }) {
  const desk = useQuery({ queryKey: K.meta, queryFn: ({ signal }) => meta(signal), staleTime: 5 * 60_000 });
  return (
    <Modal title={text('Outbox')} labelledBy="support-outbox-title" onClose={onClose} width={620} footer={<Button onClick={onClose}>{text('Close')}</Button>}>
      <p className="mb-2 text-[12px] text-ink-3">{text('Sent in order when WorkSuite is back · kept if you quit.')}</p>
      {items.length ? (
        <ol aria-label={text('Queued changes')} className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1 scroll-thin">
          {items.map((i) => (
            <OutboxRow key={i.m.id} item={i} meta={desk.data} />
          ))}
        </ol>
      ) : (
        <p className="py-6 text-center text-[13px] text-ink-3">{text('Nothing is waiting to be sent.')}</p>
      )}
    </Modal>
  );
}

const STATE_WORDS: Record<string, string> = { PENDING: 'Waiting for connection', SYNCING: 'Sending', CONFLICT: 'Conflict', FAILED: 'Not sent' };

function OutboxRow({ item, meta: desk }: { item: OutboxItem; meta: Meta | undefined }) {
  const qc = useQueryClient();
  const { m, kind } = item;
  const detail = useQuery({ queryKey: ['support', 'outbox', m.id, m.state], queryFn: () => call('offline:detail', { id: m.id }) });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const message = messageOf(detail.data?.body);
  const changes = changesOf(kind, detail.data?.body);
  const theirs = m.state === 'CONFLICT' ? theirsOf(detail.data?.response) : null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: PENDING });
    void qc.invalidateQueries({ queryKey: K.ticket(item.ticketId) });
    void qc.invalidateQueries({ queryKey: K.lists });
  };
  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await work();
      if (done) toast('success', done);
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const discard = () => run(() => call('offline:discard', { id: m.id }).then(() => call('offline:replay')));
  const save = () =>
    run(async () => {
      if (!message || editing === null) return;
      await call('offline:edit', { id: m.id, body: { ...message, body: editing.trim() } });
      setEditing(null);
    });
  /** Mine, set again on the ticket as the server now has it: the change re-sent with its version, then this one dropped. */
  const keepMine = (list: Change[], t: TicketFull) =>
    run(async () => {
      let version = t.version;
      for (const c of list) {
        const fresh = await sendChange({ id: t.id, version }, c, version);
        if (fresh) version = fresh.version;
      }
      await call('offline:discard', { id: m.id });
      await call('offline:replay');
    }, text('Your change is on {ref}.', { ref: item.reference }));

  // Tags added on both sides are merged without asking (D-09).
  const merging = useRef(false);
  const onlyTags = !!theirs && changes.length > 0 && changes.every((c) => c.kind === 'field' && c.field === 'tags');
  useEffect(() => {
    if (!onlyTags || !theirs || merging.current) return;
    merging.current = true;
    const mine = (changes[0] as { to: unknown }).to;
    const merged = mergeTags(theirs.tags ?? [], Array.isArray(mine) ? (mine as string[]) : []);
    void keepMine([{ kind: 'field', field: 'tags', to: merged.tags }], theirs).then(() => {
      if (merged.added.length) toast('info', text('Tags merged automatically: {tags}', { tags: merged.added.map((t) => `+${t}`).join(', ') }));
    });
    // Once per conflict.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyTags, theirs?.version]);

  const conflict = m.state === 'CONFLICT';
  return (
    <li data-state={m.state} className={cx('rounded-[10px] border px-3 py-2.5 text-[12.5px]', conflict ? 'border-danger/50 bg-danger-bg/40' : 'border-line bg-surface')}>
      <div className="flex min-w-0 items-center gap-2">
        <b className="text-ink">{text(OUTBOX_KIND_LABEL[kind])}</b>
        <Reference>{item.reference}</Reference>
        <span className="text-ink-3">{text('queued {time}', { time: timeLabel(m.createdAt) })}</span>
        <span className={cx('ml-auto shrink-0 font-semibold', conflict || m.state === 'FAILED' ? 'text-danger' : 'text-ink-3')}>{text(STATE_WORDS[m.state] ?? m.state)}</span>
      </div>
      {message ? (
        editing !== null ? (
          <textarea aria-label={text('Edit the queued message')} value={editing} onChange={(e) => setEditing(e.target.value)} rows={3} className="mt-1.5 w-full rounded-[8px] border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-primary" />
        ) : (
          <p className="mt-1 line-clamp-3 break-words whitespace-pre-wrap text-ink-2">{message.body}</p>
        )
      ) : null}
      {message?.status ? <p className="mt-0.5 text-ink-3">{text('Then: {status}', { status: describe({ kind: 'status', to: message.status }, desk, message.status) })}</p> : null}
      {!conflict && changes.length ? (
        <ul className="mt-1 text-ink-2">
          {changes.map((c) => (
            <li key={changeField(c)}>
              {changeField(c)} → <b className="text-ink">{describe(c, desk, c.to)}</b>
            </li>
          ))}
        </ul>
      ) : null}
      {conflict && theirs && !onlyTags ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <p className="text-ink-2">{text('Changed on the server while you were offline: your change was refused (version {from} → {to}). Choose which value to keep.', { from: Number((detail.data?.body as { version?: number } | null)?.version ?? 0) || '?', to: theirs.version })}</p>
          <table className="w-full text-left">
            <thead className="text-[11px] text-ink-3 uppercase">
              <tr>
                <th className="py-0.5 font-bold">{text('Field')}</th>
                <th className="py-0.5 font-bold">{text('Mine · {time} (offline)', { time: timeLabel(m.createdAt) })}</th>
                <th className="py-0.5 font-bold">{text('Server · now')}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={changeField(c)}>
                  <td className="py-0.5 text-ink-3">{changeField(c)}</td>
                  <td className="py-0.5 font-semibold text-ink">{describe(c, desk, c.to)}</td>
                  <td className="py-0.5 font-semibold text-ink">{describe(c, desk, currentOf(c, theirs), theirs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {m.state === 'FAILED' && m.error ? <p className="mt-1 text-danger">{m.error}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {conflict && theirs && !onlyTags ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => void discard()}>
              {text('Keep server')}
            </Button>
            <Button size="sm" variant="primary" loading={busy} onClick={() => void keepMine(changes, theirs)}>
              {text('Keep mine')}
            </Button>
          </>
        ) : null}
        {m.state === 'FAILED' ? (
          <Button size="sm" disabled={busy} onClick={() => void run(() => call('offline:retry', { id: m.id }))}>
            {text('Retry')}
          </Button>
        ) : null}
        {message && m.state === 'PENDING' ? (
          editing !== null ? (
            <Button size="sm" variant="primary" disabled={busy || !editing.trim()} onClick={() => void save()}>
              {text('Save')}
            </Button>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => setEditing(message.body)}>
              {text('Edit')}
            </Button>
          )
        ) : null}
        {!(conflict && theirs && !onlyTags) && m.state !== 'SYNCING' ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void discard()}>
            {text('Discard')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
