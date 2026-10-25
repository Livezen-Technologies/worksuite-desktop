import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useTab } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Button, IconButton } from '../../components/ui';
import { fetchClient, fetchDetail, K, money, retryNotice, type Appointment } from './api';
import { CancelDialog, CheckInDialog, DepositDialog, MoveDialog } from './Actions';
import { FeesBlock, FreedActions, IntakeBlock } from './Extras';
import { errText, Kbd, Pill, StatusPill, useDesk, useMove, useNow } from './parts';
import type { DeskSettings } from './print';

/**
 * D08 · The appointment panel beside any screen (or popped out into its own window): who, what, when; the moves the
 * server offers this person (C check in, M move, cancel, no-show, start, complete, checkout, deposit); the money; what
 * the service will use; the messages sent (a failed one can be sent again); and the history.
 */
type Dialog = 'checkin' | 'move' | 'cancel' | 'noshow' | 'deposit' | null;

export default function Panel({ id, settings, onClose }: { id: number; settings: DeskSettings; onClose: () => void }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const move = useMove();
  const { openInWindow, active } = useTab();
  const q = useQuery({ queryKey: K.detail(id), queryFn: ({ signal }) => fetchDetail(id, signal) });
  const a = q.data?.appointment;
  const client = useQuery({ queryKey: K.client(a?.customer.id ?? 0), queryFn: ({ signal }) => fetchClient(a!.customer.id, signal), enabled: !!a, staleTime: 60_000 });
  const pinned = (client.data?.notes ?? []).filter((n) => n.pinned);
  const [dialog, setDialog] = useState<Dialog>(null);
  const now = useNow();
  const can = (s: string) => !!a?.next.some((n) => n.status === s && n.allowed);

  useEffect(() => {
    if (!active || !a) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"]') || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if ((e.key === 'c' || e.key === 'C') && can('checked_in')) setDialog('checkin');
      else if ((e.key === 'm' || e.key === 'M') && a.can.reschedule && desk.online) setDialog('move');
      else if (e.key === 'Escape') onClose();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const retry = async (nid: number) => {
    try {
      const r = await retryNotice(nid);
      toast('success', r.message || 'Sent again.');
      void qc.invalidateQueries({ queryKey: K.detail(id) });
    } catch (e) {
      toast('error', errText(e));
    }
  };

  return (
    <aside aria-label="Appointment" className="flex w-[380px] shrink-0 flex-col overflow-hidden border-l border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="font-mono text-[12px] text-ink-2">{a?.number ?? `#${id}`}</span>
        {a ? <StatusPill a={a} /> : null}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" icon="external" onClick={() => openInWindow(`/appointments?tab=today&apt=${id}`, a ? `${a.number} · ${a.customer.name}` : 'Appointment')}>Pop out</Button>
        <IconButton icon="x" label="Close" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scroll-thin">
        {!a ? (
          <p className="text-[13px] text-ink-3">{q.isError ? errText(q.error) : 'Reading…'}</p>
        ) : (
          <>
            <button type="button" className="text-left text-[18px] font-extrabold text-ink hover:underline" onClick={() => desk.client(a.customer.id)}>{a.customer.name}</button>
            <p className="m-0 mt-0.5 text-[12.5px] text-ink-2">{`${a.service.name} · ${a.provider.name} · ${a.location.name} · ${a.local.date} ${a.local.start}–${a.local.end}`}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {can('checked_in') ? <Button size="sm" variant="primary" onClick={() => setDialog('checkin')}>Check in<Kbd>C</Kbd></Button> : null}
              {can('confirmed') ? <Button size="sm" variant="primary" onClick={() => void move(a, 'confirmed')}>Confirm</Button> : null}
              {can('in_service') ? <Button size="sm" variant="primary" onClick={() => void move(a, 'in_service')}>Start</Button> : null}
              {a.can.checkout ? <Button size="sm" variant="primary" disabled={!desk.online} onClick={() => desk.checkout(a.id)}>Check out</Button> : can('completed') ? <Button size="sm" variant="secondary" onClick={() => void move(a, 'completed')}>Complete</Button> : null}
              {a.can.reschedule ? <Button size="sm" variant="secondary" disabled={!desk.online} onClick={() => setDialog('move')}>Move<Kbd>M</Kbd></Button> : null}
              {a.customer.phone ? <a className="inline-flex h-7 items-center rounded-[8px] border border-line px-2.5 text-[12px] text-ink hover:bg-subtle" href={`tel:${a.customer.phone.replace(/[^\d+]/g, '')}`}>{`Call ${a.customer.phone}`}</a> : null}
              {a.can.deposit && a.deposit && a.deposit.outstanding > 0 ? <Button size="sm" variant="secondary" disabled={!desk.online} onClick={() => setDialog('deposit')}>Deposit…</Button> : null}
              {can('cancelled') ? <Button size="sm" variant="ghost" onClick={() => setDialog('cancel')}>Cancel…</Button> : null}
              {can('no_show') ? <Button size="sm" variant="ghost" disabled={Date.parse(a.starts_at) > now} title={Date.parse(a.starts_at) > now ? `After ${a.local.start}` : undefined} onClick={() => setDialog('noshow')}>No-show</Button> : null}
              {a.status === 'no_show' && can('confirmed') ? <Button size="sm" variant="secondary" onClick={() => void move(a, 'confirmed')}>Undo no-show</Button> : null}
            </div>

            {pinned.map((n) => <p key={n.id} className="mt-3 mb-0 rounded-[8px] bg-[#EEF1FD] px-3 py-2 text-[12.5px] text-[#23349E] dark:bg-selection dark:text-primary">{`Pinned · ${n.body}`}</p>)}
            {a.notes ? <p className="mt-2 mb-0 text-[12.5px] text-ink-2">{`Client note: ${a.notes}`}</p> : null}
            {a.internal_notes ? <p className="mt-1 mb-0 text-[12.5px] text-ink-2">{`Internal: ${a.internal_notes}`}</p> : null}
            {a.cancel_reason ? <p className="mt-1 mb-0 text-[12.5px] text-ink-2">{`Reason: ${a.cancel_reason}`}</p> : null}
            <FreedActions a={a} />

            <Block title="Money">
              <Row k="Invoice" v={a.invoice ? `${a.invoice.number ?? 'Draft'} · ${money(a.invoice.total, a.invoice.currency)} · ${a.invoice.outstanding > 0 ? `${money(a.invoice.outstanding)} owed` : 'paid'}` : a.checked_out ? 'Checked out' : 'Not checked out yet'} />
              {a.deposit ? <Row k="Deposit" v={`${money(a.deposit.due, a.deposit.currency)} asked · ${money(a.deposit.held)} held${a.deposit.outstanding > 0 ? ` · ${money(a.deposit.outstanding)} due` : ''}`} /> : null}
              {q.data?.commission?.map((c) => <Row key={c.id} k="Commission" v={`${money(c.amount, c.currency)} · ${c.status}`} />)}
              <FeesBlock fees={q.data?.fees ?? []} />
            </Block>
            <IntakeBlock a={a} />
            {q.data?.stock?.consumptions?.length ? (
              <Block title="Will use">
                {q.data.stock.consumptions.map((c, i) => <Row key={i} k={c.name} v={`${c.actual || c.planned}${c.unit ? ` ${c.unit}` : ''}`} />)}
              </Block>
            ) : null}
            <Block title="Messages">
              {(q.data?.notices ?? []).map((n) => (
                <div key={n.id} className="flex items-center gap-2 py-1 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate text-ink">{`${n.label ?? n.kind ?? 'Message'}${n.channel ? ` · ${n.channel}` : ''}`}</span>
                  <Pill tone={n.status === 'failed' ? 'late' : n.status === 'sent' ? 'ok' : 'muted'}>{n.status}</Pill>
                  {n.status === 'failed' && desk.online ? <Button size="sm" variant="ghost" onClick={() => void retry(n.id)}>Retry</Button> : null}
                </div>
              ))}
              {!q.data?.notices?.length ? <p className="m-0 text-[12px] text-ink-3">Nothing sent.</p> : null}
            </Block>
            <Block title="History">
              {(q.data?.history ?? []).map((h) => (
                <div key={h.id} className="py-1 text-[12px]">
                  <div className="text-ink">{h.description}</div>
                  <div className="text-ink-3">{[h.by ?? h.source, h.at ? new Date(h.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null].filter(Boolean).join(' · ')}</div>
                </div>
              ))}
            </Block>
          </>
        )}
      </div>
      {a && dialog === 'checkin' ? <CheckInDialog a={a} settings={settings} visits={client.data?.tally.completed ?? null} noShows={client.data?.tally.no_show ?? null} pinned={pinned.map((n) => n.body)} onClose={() => setDialog(null)} /> : null}
      {a && dialog === 'move' ? <MoveDialog a={a} onClose={() => setDialog(null)} /> : null}
      {a && (dialog === 'cancel' || dialog === 'noshow') ? <CancelDialog a={a as Appointment} kind={dialog} noShows={client.data?.tally.no_show ?? null} onClose={() => setDialog(null)} /> : null}
      {a && dialog === 'deposit' ? <DepositDialog a={a} settings={settings} onClose={() => setDialog(null)} /> : null}
    </aside>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="m-0 mb-1 text-[11px] font-bold tracking-[.06em] text-ink-3 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 py-0.5 text-[12.5px]">
      <span className="w-[90px] shrink-0 text-ink-3">{k}</span>
      <span className="min-w-0 flex-1 text-ink">{v}</span>
    </div>
  );
}
