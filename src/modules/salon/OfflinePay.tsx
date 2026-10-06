import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SalonOutboxItem } from '@shared/types';
import { Avatar, Empty } from '../../components/ui';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { amount, clockAt, todayAt, type Visit } from './api';
import { offlineReceipt, openDrawer, printPage, suggestions } from './money';
import { SK, useOutbox, visitsOf } from './offline';
import { Label, Note, Page, Panel, Segmented, servicesOf, stylistsOf, TierTag, TouchButton, useDesk, useNow, usePrintSettings } from './parts';

/**
 * Taking payment while WorkSuite is out of reach (POS-11, OFF-03): a POS
 * offline sale, on a desk paired as a till.
 *
 * Only what the desk can take without WorkSuite checking anything — cash, or
 * a card with its approval code — for a visit in the desk's copy that is in
 * the chair or done. The amount is the copy's price less any advance; the
 * invoice, with any member discount and tax, is WorkSuite's, issued when the
 * sale arrives. Points, store credit and retail wait for WorkSuite.
 *
 * The client is given a till receipt numbered in this desk's own series, and
 * the sale waits in the outbox, encrypted, until it can be sent. Cash goes
 * into the drawer now; WorkSuite puts the sale into the register session it
 * was made in.
 */
export default function OfflinePay() {
  const desk = useDesk();
  const id = Number(desk.params.get('visit') ?? 0);
  const outbox = useOutbox();
  const now = useNow(60_000);
  const today = todayAt(desk.location.timezone, new Date(now));
  const kept = new Map((outbox.data ?? []).filter((i) => i.kind === 'visit.checkout').map((i) => [i.payload.visit_id, i] as const));
  const sub = 'WorkSuite is out of reach. Cash or card, as a POS offline sale — the invoice is issued when it answers.';

  const why = !desk.desk.register
    ? 'Offline, a desk takes payment only when it is paired as a POS till. Take this payment when WorkSuite answers.'
    : !desk.copy
      ? 'This computer has no copy of the day, so it cannot say what a visit costs. Take the payment when WorkSuite answers.'
      : !desk.may('salon.checkout')
        ? 'Taking payment needs SalonMate’s checkout permission.'
        : desk.sync && !desk.sync.can_write
          ? (desk.sync.why_not ?? 'This computer does not keep payments to send later.')
          : null;
  if (why) {
    return (
      <Page title="Take payment" sub={sub}>
        <Note tone="warning">{why}</Note>
      </Page>
    );
  }

  const visits = visitsOf(desk.copy!).filter((v) => v.date === today);
  const visit = id > 0 ? visits.find((v) => v.id === id) : undefined;
  if (id > 0) {
    const item = kept.get(id);
    if (item) return <Kept item={item} visit={visit} />;
    if (visit && offlinePayable(visit)) return <OfflineTake key={visit.id} visit={visit} />;
    return (
      <Page title="Take payment" sub={sub}>
        <Note tone="muted">This visit is not one the desk can take payment for offline: it is not in the chair or done today, or it is paid.</Note>
        <div>
          <TouchButton onClick={() => desk.go('pay')}>Everyone waiting to pay</TouchButton>
        </div>
      </Page>
    );
  }

  const ready = visits.filter((v) => offlinePayable(v) || kept.has(v.id));
  return (
    <Page title="Take payment" sub={sub}>
      {ready.length === 0 ? (
        <Panel>
          <Empty icon="banknote" title="Nobody is waiting to pay." hint="In this desk’s copy of the day, nobody is in the chair or done and unpaid." />
        </Panel>
      ) : (
        <Panel>
          <ul>
            {ready.map((v) => (
              <li key={v.id} className="flex items-center gap-3.5 border-t border-line py-3 first:border-t-0">
                <Avatar name={v.client.name} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[16px] font-bold text-ink">{v.client.name}</span>
                    <TierTag tier={v.client.tier} />
                  </div>
                  <div className="truncate text-[13px] text-ink-2">
                    {v.number} · {servicesOf(v)} · {stylistsOf(v)} · {v.status_label}
                  </div>
                </div>
                <span className="text-[16px] font-extrabold text-ink tabular-nums">{amount(offlineDue(v), v.money.currency)}</span>
                {kept.has(v.id) ? (
                  <TouchButton onClick={() => desk.go('pay', { visit: v.id })}>Paid offline</TouchButton>
                ) : (
                  <TouchButton variant="primary" icon="banknote" onClick={() => desk.go('pay', { visit: v.id })}>
                    Take payment
                  </TouchButton>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </Page>
  );
}

/** Whether the desk may take a visit's payment offline: in the chair or done and not checked out, or checked out and still owing. */
export function offlinePayable(v: Visit): boolean {
  return ((v.status === 'in_service' || v.status === 'completed') && !v.checked_out) || (v.invoice?.owed ?? 0) > 0;
}

/** What is still to pay, as the desk's copy has it: what the invoice owes, or the visit's price less its advance. */
export function offlineDue(v: Visit): number {
  return Math.round((v.invoice ? v.invoice.owed : Math.max(0, v.money.total - v.money.advance)) * 100) / 100;
}

/** What the desk asks for, for WorkSuite to compare with what it prices: the invoice's total, or the visit's. */
export function offlineAsked(v: Visit): number {
  return v.invoice ? v.invoice.total : v.money.total;
}

/** The money taken: cash net of change (never more than is due), or the card's amount. */
export function offlineTaken(method: 'cash' | 'card', due: number, received: number): { taken: number; change: number } {
  if (method === 'card') return { taken: due, change: 0 };
  const taken = Math.round(Math.min(received, due) * 100) / 100;
  return { taken, change: Math.round(Math.max(0, received - due) * 100) / 100 };
}

function OfflineTake({ visit }: { visit: Visit }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const print = usePrintSettings();
  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [cash, setCash] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const currency = visit.money.currency;
  const due = offlineDue(visit);
  const received = Number(cash.replace(/,/g, '')) || 0;
  const { taken, change } = offlineTaken(method, due, received);
  const ok = taken > 0 && (method === 'cash' || reference.trim() !== '');

  async function take() {
    setBusy(true);
    try {
      const tenders = [{ method, amount: taken, reference: method === 'card' ? reference.trim() : null }];
      const item = await call('salon:outboxAdd', {
        kind: 'visit.checkout',
        payload: { visit_id: visit.id, tenders, expected_total: offlineAsked(visit) },
        label: `Payment: ${visit.client.name}`,
        detail: `${amount(taken, currency)} ${method === 'cash' ? 'cash' : 'by card'} · ${visit.number}`,
      });
      void qc.invalidateQueries({ queryKey: SK.all });
      if (method === 'cash' && print.data?.drawer === 'printer') void openDrawer().catch(() => undefined);
      const printed = await printTill(item, visit, change, desk.company, desk.location.name, desk.desk.register?.code ?? null, print.data?.paper, desk.location.timezone);
      toast(printed.ok ? 'success' : 'warning', printed.ok ? `Paid offline — till receipt ${String(item.payload.receipt ?? '')}.` : `Paid offline. ${printed.message}`);
      desk.go('pay', { visit: visit.id });
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The payment could not be kept.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={`Take payment · ${visit.client.name}`} sub="WorkSuite is out of reach: a POS offline sale, invoiced when it answers.">
      <div className="flex flex-col gap-3.5 xl:flex-row xl:items-start">
        <Panel className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="text-[13px] text-ink-2">
            {visit.number} · {stylistsOf(visit)} · {visit.status_label}
          </div>
          <ul className="flex flex-col gap-1.5">
            {visit.items.map((i) => (
              <li key={i.appointment_id} className="flex justify-between gap-3 text-[15px] text-ink">
                <span className="min-w-0 truncate">{i.service}</span>
                <span className="tabular-nums">{amount(i.price)}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-line pt-2 text-[15px]">
            {visit.invoice ? (
              <div className="flex justify-between text-ink-2">
                <span>Invoice {visit.invoice.number ?? ''} · paid {amount(visit.invoice.paid)}</span>
                <span className="tabular-nums">{amount(visit.invoice.total)}</span>
              </div>
            ) : visit.money.advance > 0 ? (
              <div className="flex justify-between text-ink-2">
                <span>Advance already paid</span>
                <span className="tabular-nums">− {amount(visit.money.advance)}</span>
              </div>
            ) : null}
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-[13px] font-bold tracking-[.05em] text-ink-2 uppercase">To pay</span>
              <span className="text-[32px] font-extrabold text-ink tabular-nums">{amount(due, currency)}</span>
            </div>
          </div>
          <Note tone="muted">From this desk’s copy of the day. WorkSuite prices the invoice when the sale arrives — a member discount or tax may change it. Anything over is kept as the client’s store credit; anything short stays owing.</Note>
        </Panel>

        <Panel className="flex w-full flex-col gap-3 xl:w-[440px] xl:shrink-0">
          <Segmented
            label="Paid by"
            value={method}
            onChange={setMethod}
            options={[
              { value: 'cash', label: 'Cash' },
              { value: 'card', label: 'Card' },
            ]}
          />
          {method === 'cash' ? (
            <>
              <label className="flex flex-col gap-1">
                <Label>Cash received</Label>
                <input
                  aria-label="Cash received"
                  inputMode="decimal"
                  value={cash}
                  placeholder={amount(due)}
                  onChange={(e) => setCash(e.target.value.replace(/[^\d.,]/g, ''))}
                  className="h-16 rounded-[14px] border-2 border-line bg-surface px-4 text-right font-mono text-[30px] font-semibold text-ink tabular-nums outline-none focus:border-primary"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {[due, ...suggestions(due)].map((n) => (
                  <TouchButton key={n} className="min-h-11 px-3.5 text-[14px]" onClick={() => setCash(String(n))}>
                    {n === due ? 'Exact' : amount(n).replace(/\.00$/, '')}
                  </TouchButton>
                ))}
              </div>
              <div className="flex items-baseline justify-between rounded-[12px] bg-success-bg px-4 py-2.5">
                <span className="text-[13px] font-bold tracking-[.05em] text-success uppercase">Change</span>
                <output aria-label="Change" className="text-[26px] font-extrabold text-success tabular-nums">
                  {amount(change, currency)}
                </output>
              </div>
              {received > 0 && taken < due ? <Note tone="warning">{amount(due - taken, currency)} stays owing — take it when WorkSuite answers.</Note> : null}
            </>
          ) : (
            <label className="flex flex-col gap-1">
              <Label>Card approval code</Label>
              <input
                aria-label="Card approval code"
                value={reference}
                maxLength={120}
                placeholder="The approval code, or the last four digits"
                onChange={(e) => setReference(e.target.value)}
                className="h-12 rounded-[12px] border border-line bg-surface px-3.5 text-[16px] text-ink outline-none focus:border-primary"
              />
            </label>
          )}
          <TouchButton variant="primary" icon="banknote" className="min-h-14 text-[17px]" loading={busy} disabled={!ok} onClick={() => void take()}>
            Take {amount(taken, currency)} offline
          </TouchButton>
          <p className="text-[12.5px] text-ink-2">A till receipt prints now. The sale waits on this computer, encrypted, and goes to WorkSuite first thing when it answers.</p>
        </Panel>
      </div>
    </Page>
  );
}

/** Print the till receipt for a kept offline sale: again, from what the outbox kept. */
async function printTill(item: SalonOutboxItem, visit: Visit | undefined, change: number, company: string, location: string, register: string | null, paper: Parameters<typeof printPage>[1], tz: string) {
  const tenders = ((item.payload.tenders as Array<{ method: 'cash' | 'card'; amount: number; reference: string | null }> | undefined) ?? []).map((t) => ({ ...t, reference: t.reference ?? null }));
  const html = offlineReceipt(
    {
      receipt: String(item.payload.receipt ?? ''),
      at: `${item.created_at.slice(0, 10)} ${clockAt(item.created_at, tz)}`,
      register,
      visit: visit?.number ?? `#${String(item.payload.visit_id)}`,
      client: visit?.client.name ?? '',
      lines: (visit?.items ?? []).map((i) => ({ label: i.service, amount: i.price })),
      currency: visit?.money.currency ?? '',
      total: visit ? offlineAsked(visit) : tenders.reduce((n, t) => n + t.amount, 0),
      advance: visit && !visit.invoice ? visit.money.advance : 0,
      tenders,
      change,
    },
    { company, location, paper: paper ?? '80mm' },
  );
  return printPage(html, paper).catch((e: unknown) => ({ ok: false, printer: null, silent: false, message: e instanceof Error ? e.message : 'The till receipt was not printed.' }));
}

function Kept({ item, visit }: { item: SalonOutboxItem; visit: Visit | undefined }) {
  const desk = useDesk();
  const print = usePrintSettings();
  const [busy, setBusy] = useState(false);
  const tenders = (item.payload.tenders as Array<{ method: string; amount: number }> | undefined) ?? [];
  const paid = tenders.reduce((n, t) => n + t.amount, 0);

  async function again() {
    setBusy(true);
    const o = await printTill(item, visit, 0, desk.company, desk.location.name, desk.desk.register?.code ?? null, print.data?.paper, desk.location.timezone);
    toast(o.ok ? 'success' : 'warning', o.message);
    setBusy(false);
  }

  return (
    <Page title={`Paid offline · ${String(item.payload.receipt ?? '')}`} sub={`${visit?.client.name ?? ''} · ${amount(paid, visit?.money.currency ?? '')} · goes to WorkSuite when it answers`}>
      <Panel className="flex flex-col gap-3">
        <Note tone={item.state === 'refused' ? 'warning' : 'indigo'}>
          {item.state === 'refused'
            ? `WorkSuite refused it: ${item.message ?? 'see Sync'}. It stays on this computer until someone settles it.`
            : 'Kept on this computer, encrypted. When WorkSuite answers it issues the invoice, numbered in Billing’s series, and puts the sale into the register session it was taken in.'}
        </Note>
        <div className="flex flex-wrap gap-2.5">
          <TouchButton icon="printer" loading={busy} onClick={() => void again()}>
            Print the till receipt again
          </TouchButton>
          <TouchButton icon="refresh" onClick={() => desk.go('outbox')}>
            See it in Sync
          </TouchButton>
          <TouchButton variant="primary" icon="check" className="min-w-[240px] flex-1" onClick={() => desk.go('today')}>
            Done — next client
          </TouchButton>
        </div>
      </Panel>
    </Page>
  );
}
