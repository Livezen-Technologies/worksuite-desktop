import { useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { btn, btnPrimary, btnSmall, Sheet } from '../hr/parts';
import { createPayLink, fetchInvoiceReminders, fetchPayLink, offsetLabel, revokePayLink } from './actions';
import { amount, type InvoiceDetail } from './api';

/**
 * The invoice's side panel (D02 "Details"): when it was issued and is due,
 * who raised it and for which project, its journal, the payments against it,
 * the reminders sent and next, and its pay link — Copy link and Show QR, with
 * Regenerate (the old address stops working) and Revoke.
 */
export function InvoiceAside({ inv, canLink, offline }: { inv: InvoiceDetail; canLink: boolean; offline: boolean }) {
  const draft = inv.status === 'draft' || inv.status === 'pending_approval';
  const open = !draft && inv.status !== 'cancelled' && inv.due > 0;
  return (
    <aside aria-label="Details" className="flex w-[300px] shrink-0 flex-col gap-3 self-start rounded-[12px] border border-line bg-surface px-[18px] py-4 text-[12.5px]">
      <Head>Details</Head>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        <Dt>Issued</Dt>
        <span className="text-ink">{inv.issue_date && !draft ? dateLabel(inv.issue_date) : '—'}</span>
        <Dt>Due</Dt>
        <span className="text-ink">{inv.due_date ? dateLabel(inv.due_date) : '—'}</span>
        <Dt>Agent</Dt>
        <span className="truncate text-ink">{inv.owner ?? '—'}</span>
        {inv.project ? (
          <>
            <Dt>Project</Dt>
            <span className="truncate text-ink">{inv.project}</span>
          </>
        ) : null}
        {inv.journal?.journal_no ? (
          <>
            <Dt>Journal</Dt>
            <span className="truncate font-mono text-ink">
              {inv.journal.journal_no}
              {inv.journal.reversed ? <span className="ml-1 font-sans text-ink-3">(reversed)</span> : null}
            </span>
          </>
        ) : null}
        {inv.viewed_at ? (
          <>
            <Dt>Viewed</Dt>
            <span className="text-ink">{dateLabel(inv.viewed_at)}</span>
          </>
        ) : null}
      </div>
      {inv.disputed ? (
        <p className="m-0 rounded-[8px] border border-warning-line bg-warning-bg px-2.5 py-2 text-[12px] text-warning-strong dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
          <b>Disputed.</b> {inv.disputed.reason ?? ''} Reminders are paused while it is open.
        </p>
      ) : null}
      {!draft ? (
        <>
          <Head>Payments</Head>
          {inv.allocations.payments.length ? (
            inv.allocations.payments.map((p) => (
              <div key={p.id} className="flex justify-between gap-2">
                <span className="truncate text-ink">
                  {p.reference} · {dateLabel(p.paid_on)}
                </span>
                <b className="shrink-0 text-success tabular-nums dark:text-success">{amount(p.amount)}</b>
              </div>
            ))
          ) : (
            <span className="text-ink-3">None yet.</span>
          )}
          <Reminders id={inv.id} />
        </>
      ) : null}
      {open || inv.status === 'paid' ? <PayLinkBox inv={inv} canLink={canLink && open} offline={offline} /> : null}
    </aside>
  );
}

function Reminders({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['billing', 'invoice', id, 'reminders'], queryFn: ({ signal }) => fetchInvoiceReminders(id, signal), retry: false, staleTime: 60_000 });
  const rows = q.data ?? [];
  // The steps still to come are first, `scheduled` with their date; the rest were sent (or failed).
  const sent = rows.filter((r) => r.status !== 'scheduled');
  const next = rows.find((r) => r.status === 'scheduled');
  if (q.error || (!rows.length && !q.isLoading)) return null;
  return (
    <>
      <Head>Reminders</Head>
      <div className="text-ink-2">
        {sent.length ? sent.map((r) => `${offsetLabel(r.offset_days)} ${r.status === 'failed' ? 'failed' : 'sent'} ${r.sent_at ? dateLabel(r.sent_at) : ''}`.trim()).join(' · ') : 'None sent yet.'}
        {next ? (
          <>
            <br />
            Next: {offsetLabel(next.offset_days)} {next.due_on ? dateLabel(next.due_on) : ''}
          </>
        ) : null}
      </div>
    </>
  );
}

/** The pay link (G-02/G-03): copy it, show it as a QR, make a new one, or revoke it. */
export function PayLinkBox({ inv, canLink, offline }: { inv: Pick<InvoiceDetail, 'id' | 'status'>; canLink: boolean; offline: boolean }) {
  const qc = useQueryClient();
  const key = ['billing', 'invoice', inv.id, 'pay-link'];
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => fetchPayLink(inv.id, signal), retry: false, staleTime: 60_000 });
  const [qr, setQr] = useState(false);
  const [asking, setAsking] = useState<'regenerate' | 'revoke' | null>(null);
  const [busy, setBusy] = useState(false);
  const link = q.data ?? null;
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', done);
      setAsking(null);
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = (url: string) =>
    void navigator.clipboard.writeText(url).then(
      () => toast('success', 'Pay link copied.'),
      () => toast('error', 'Could not copy the link.'),
    );
  const why = offline ? 'You are offline. The pay link waits for the connection.' : undefined;

  return (
    <section aria-label="Pay link" className="flex flex-col gap-2">
      <Head>Pay link</Head>
      {q.isLoading ? <span className="text-ink-3">Reading…</span> : null}
      {q.error ? <span className="text-ink-3">{errorMessage(q.error)}</span> : null}
      {link ? (
        <>
          <div className="flex gap-1.5">
            <button type="button" className={btnSmall + ' flex-1 justify-center'} onClick={() => copy(link.url)}>
              Copy link
            </button>
            <button type="button" className={btnSmall + ' flex-1 justify-center'} aria-pressed={qr} onClick={() => setQr((v) => !v)}>
              {qr ? 'Hide QR' : 'Show QR'}
            </button>
          </div>
          {qr ? <LinkQr text={link.url} /> : null}
          <span className="truncate text-[11.5px] text-ink-3" title={link.url}>
            {link.url}
          </span>
          {link.expires_at ? <span className="text-[11.5px] text-ink-3">Works until {dateLabel(link.expires_at)}</span> : null}
          {canLink ? (
            <div className="flex gap-3 text-[12px]">
              <button type="button" className="font-semibold text-primary hover:underline disabled:opacity-50" disabled={offline} title={why} onClick={() => setAsking('regenerate')}>
                Regenerate
              </button>
              <button type="button" className="font-semibold text-danger hover:underline disabled:opacity-50" disabled={offline} title={why} onClick={() => setAsking('revoke')}>
                Revoke
              </button>
            </div>
          ) : null}
        </>
      ) : !q.isLoading && !q.error ? (
        canLink ? (
          <button type="button" className={btnSmall + ' justify-center'} disabled={busy || offline} title={why} onClick={() => void run(() => createPayLink(inv.id), 'Pay link made.')}>
            Make a pay link
          </button>
        ) : (
          <span className="text-ink-3">No pay link.</span>
        )
      ) : null}
      {asking ? (
        <Sheet
          title={asking === 'regenerate' ? 'Make a new pay link?' : 'Revoke the pay link?'}
          width={420}
          onClose={() => setAsking(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setAsking(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={btnPrimary + (asking === 'revoke' ? ' !bg-danger hover:!opacity-90' : '')}
                disabled={busy}
                onClick={() => void (asking === 'regenerate' ? run(() => createPayLink(inv.id), 'A new pay link was made; the old one no longer works.') : run(() => revokePayLink(inv.id), 'Pay link revoked.'))}
              >
                {asking === 'regenerate' ? 'Make a new link' : 'Revoke'}
              </button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">
            {asking === 'regenerate'
              ? 'The address sent to the customer stops working, and a new one takes its place. Send the new one if they still need to pay.'
              : 'The address stops working at once. The customer can still pay by bank transfer, and you can make a new link later.'}
          </p>
        </Sheet>
      ) : null}
    </section>
  );
}

function LinkQr({ text }: { text: string }) {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const n = code.getModuleCount();
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (code.isDark(r, c)) cells.push([c, r]);
  return (
    <svg width={168} height={168} viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label="QR code of the pay link" className="self-center rounded-[10px] bg-white shadow-[0_0_0_1px_var(--color-line)]">
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill="#151A2D" />
      ))}
    </svg>
  );
}

function Head({ children }: { children: ReactNode }) {
  return <b className="mt-1.5 text-[11px] tracking-[.5px] text-ink-3 uppercase first:mt-0">{children}</b>;
}

function Dt({ children }: { children: ReactNode }) {
  return <span className="text-ink-3">{children}</span>;
}
