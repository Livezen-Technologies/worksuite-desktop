import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { apiUrl } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { longDate, refusal, shortDate } from '../finance/api';
import { ConfirmSheet, LoadFailed, Notice, ReasonSheet } from '../../components/RecordKit';
import { btn, btnBad, btnGood, btnPrimary, btnSmall, Caps, Field, Grid, input, Sheet, SidePanel } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { can, canAct, K, money, type Org } from './api';
import {
  approvalLine,
  attachReceipt,
  CK,
  clean,
  decideClaim,
  detachReceipt,
  editClaim,
  fetchClaim,
  KIND_WORD,
  linkedLine,
  RECEIPT_ACCEPT,
  RECEIPT_MAX,
  reopenClaim,
  rounds,
  saveReceipt,
  sizeWords,
  uploadReceipt,
  type ClaimDetail,
  type ReadField,
} from './claim-data';
import { Blocks, StatusPill, Warnings } from './parts';
import type { ExpenseView } from './Rail';

/**
 * One claim, and everything an approver needs to decide it: the figures, the
 * receipt (shown, not merely offered for download — it is the evidence being
 * decided on), what the rules said, the approval trail, and the way back in
 * for whoever filed it.
 *
 * WHAT IS OFFERED FOLLOWS WHAT THE SERVER WILL DO. Editing is offered from
 * `edit_block`, which the save computes the same way, so a button is never
 * drawn that the server would refuse — and when it is refused, the refusal is
 * a sentence shown in its place. Deciding needs `expense.approve`; reopening
 * a decided claim is a finance act the server checks against the claim's own
 * company, so a coarse permission only decides whether the button is worth
 * drawing.
 */
export default function ClaimPanel({
  id,
  org,
  orgs,
  onClose,
  onGo,
  extra,
}: {
  id: number;
  org: string;
  orgs: Org[];
  onClose: () => void;
  onGo: (view: ExpenseView, extra?: string) => void;
  /** What the screen that opened the claim adds above it — the tender's own actions, say. */
  extra?: ReactNode;
}) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: CK.claim(org, id), queryFn: ({ signal }) => fetchClaim(id, signal), retry: false });
  const [asking, setAsking] = useState<'approve' | 'decline' | 'reopen' | 'edit' | null>(null);
  const [busy, setBusy] = useState(false);
  const c = q.data;
  const company = c?.org_id ? orgs.find((o) => o.id === c.org_id) : undefined;
  // A claim in a company this person only reads cannot be changed by them; one we cannot place, the server decides.
  const writable = company ? canAct(company) : true;
  const mayDecide = can(perms, 'expense.approve');
  const mayReopen = can(perms, 'expense.manage') || can(perms, 'expense.approve');
  const refresh = () => void qc.invalidateQueries({ queryKey: K.all });

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setAsking(null);
      refresh();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const decide = (approve: boolean, note: string) =>
    void act(async () => {
      const r = await decideClaim(id, approve, note, c?.revision ?? null);
      if (r.unposted.length) toast('warning', r.message ?? `Approved, but it is not in the accounts yet: ${r.unposted[0]}`);
      else toast('success', r.message ?? 'Done');
    });

  return (
    <SidePanel
      label={c ? `Claim ${c.claim_no ?? ''}` : 'Claim'}
      width={660}
      onClose={onClose}
      head={
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2">
            <b className="font-mono text-[12.5px] text-ink-2">{c?.claim_no ?? 'Claim'}</b>
            {c ? <StatusPill status={c.status} /> : null}
            {c && c.kind !== 'expense' ? <Pill tone="grey">{KIND_WORD[c.kind]}</Pill> : null}
          </span>
          <b className="truncate text-[15px] text-ink">{c ? clean(c.description) || 'No description' : 'Loading'}</b>
        </span>
      }
    >
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <LoadFailed what="That claim" onRetry={() => void q.refetch()} /> : null}
      {c ? (
        <>
          {extra}
          <Grid rows={facts(c)} />

          <ReceiptBox claim={c} writable={writable} onChanged={refresh} />

          {c.policy.length ? (
            <section className="flex flex-col gap-1.5">
              <Caps>What the rules said</Caps>
              <Warnings items={c.policy.filter((p) => p.severity !== 'block')} />
              <Blocks items={c.policy.filter((p) => p.severity === 'block')} />
            </section>
          ) : null}

          {c.duplicates.length ? (
            <Block title="Looks like another claim">
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12.5px] text-ink-2">
                {c.duplicates.map((d) => (
                  <li key={d.id}>
                    {d.reason}{' '}
                    <span className="text-ink-3">
                      ({[d.claim_no, shortDate(d.spent_on), money(d.amount, d.currency), d.other_status].filter(Boolean).join(', ')})
                    </span>
                  </li>
                ))}
              </ul>
              <Notice tone="grey" className="mt-2.5">
                Flagged because the figures match, not because anybody thinks anything. Two identical fares on one day is usually a return journey. Nothing has been rejected.
              </Notice>
            </Block>
          ) : null}

          {c.card_txn ? (
            <Block title="Matched to a card transaction">
              <p className="m-0 text-[13px] text-ink">
                {[c.card_txn.merchant, shortDate(c.card_txn.txn_date), money(c.card_txn.amount, c.card_txn.currency)].filter(Boolean).join(' · ')}
                {c.card_txn.card ? (
                  <span className="text-ink-3">
                    {' '}
                    on {c.card_txn.card}
                    {c.card_txn.last4 ? ` ····${c.card_txn.last4}` : ''}
                  </span>
                ) : null}
              </p>
              <p className="m-0 mt-1 text-[12px] text-ink-3">Matched {c.card_txn.auto ? 'automatically, on an exact amount within three days' : 'by hand'}.</p>
            </Block>
          ) : null}

          <Block title="Approval">
            <Trail claim={c} />
            {c.status === 'submitted' && mayDecide ? (
              <div className="mt-3.5 flex gap-2 border-t border-line pt-3.5">
                <button type="button" className={btnGood} disabled={busy} onClick={() => setAsking('approve')}>
                  Approve
                </button>
                <button type="button" className={btnBad} disabled={busy} onClick={() => setAsking('decline')}>
                  Decline
                </button>
              </div>
            ) : null}
            {c.edit_block === null ? (
              <div className="mt-3 flex flex-col items-start gap-1.5 border-t border-line pt-3">
                <button type="button" className={btn} onClick={() => setAsking('edit')}>
                  <Icon name="compose" size={14} /> Edit &amp; resubmit
                </button>
                <span className="text-[12px] text-ink-3">It goes back to the top of the approval chain, and the version it replaces is kept.</span>
              </div>
            ) : mayReopen && writable && (c.status === 'approved' || c.status === 'rejected') ? (
              <div className="mt-3 flex flex-col items-start gap-1.5 border-t border-line pt-3">
                <button type="button" className={cx(btn, 'text-warning-ink dark:text-warning')} onClick={() => setAsking('reopen')}>
                  <Icon name="unlock" size={14} /> Reopen for correction
                </button>
                <span className="text-[12px] text-ink-3">Hands it back to {c.claimant ?? 'the claimant'} to change and resubmit. The decision is recorded as set aside.</span>
              </div>
            ) : c.edit_block ? (
              <p className="m-0 mt-3 border-t border-line pt-3 text-[12px] text-ink-3">{c.edit_block}</p>
            ) : null}
          </Block>

          {c.was_read ? (
            <Block title="What was read off the receipt">
              <ReadFields fields={c.receipt_read} />
            </Block>
          ) : null}

          {c.versions.length ? (
            <Block title="Previous versions">
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
                {c.versions.map((v) => (
                  <li key={v.id} className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 rounded-[5px] bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-ink-2">v{v.version}</span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-ink">
                        {v.event === 'reopen' ? 'Reopened' : 'Edited'} by {v.author ?? 'somebody'}
                      </span>
                      {/* The reason for the resubmission, where there is one. */}
                      {v.reason ? <span className="text-[12px] text-ink-2">{v.reason}</span> : null}
                      {v.created_at ? <span className="text-[11.5px] text-ink-3">{stamp(v.created_at)}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Block>
          ) : null}

          {c.subscription_id ? (
            <Block title="Related">
              <button type="button" className={btnSmall} onClick={() => onGo('subs', `&sub=${c.subscription_id}`)}>
                Open the subscription it was filed against <Icon name="chevron-right" size={13} />
              </button>
            </Block>
          ) : null}

          {c.activity.length ? (
            <Block title="History">
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12.5px] text-ink-2">
                {c.activity.map((a, i) => (
                  <li key={i}>
                    {a.created_at ? <span className="text-ink-3">{stamp(a.created_at)} — </span> : null}
                    {a.summary}
                  </li>
                ))}
              </ul>
            </Block>
          ) : null}
        </>
      ) : null}

      {asking === 'approve' && c ? <ApproveSheet busy={busy} onOk={(note) => decide(true, note)} onClose={() => setAsking(null)} /> : null}
      {asking === 'decline' && c ? (
        <ReasonSheet
          title="Decline this claim"
          body="Say why. The claimant sees this. A declined claim needs a reason — the claimant only sees what you write here."
          label="Reason"
          action="Decline"
          danger
          busy={busy}
          onOk={(note) => decide(false, note)}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking === 'reopen' && c ? (
        <ReasonSheet
          title="Reopen this claim?"
          body="It goes back to the person who filed it, to correct and resubmit. The decision already made is kept on the record and marked as set aside."
          label="Why is this being reopened?"
          action="Reopen it"
          busy={busy}
          onOk={(reason) =>
            void act(async () => {
              toast('success', (await reopenClaim(id, reason)) ?? 'Reopened');
            })
          }
          onClose={() => setAsking(null)}
        />
      ) : null}
      {asking === 'edit' && c ? (
        <EditClaim
          claim={c}
          onClose={() => setAsking(null)}
          onDone={() => {
            setAsking(null);
            refresh();
          }}
        />
      ) : null}
    </SidePanel>
  );
}

/** "2026-09-25 14:05:00" as "25 Sep 2026, 14:05" — from its digits, never through `new Date()`. */
function stamp(v: string): string {
  const time = /\d{2}:\d{2}/.exec(v.slice(10))?.[0];
  return `${shortDate(v)}${time ? `, ${time}` : ''}`;
}

/** The figures, only those that have a value — an empty row is not information. */
function facts(c: ClaimDetail): Array<[string, ReactNode]> {
  const rows: Array<[string, ReactNode]> = [
    ['Amount', money(c.base_amount ?? c.amount, c.base_amount ? c.base_currency : c.currency)],
    ...(c.currency && c.currency !== c.base_currency ? [['Paid in', `${money(c.amount, c.currency)}${c.exchange_rate ? ` at ${c.exchange_rate}` : ''}`] as [string, ReactNode]] : []),
    ['Spent on', longDate(c.spent_on)],
    ['Claimant', c.claimant],
    ['Category', c.category],
    ['Organization', c.organization],
    ['Cost centre', c.cost_centre ? `${c.cost_centre_code ?? ''} ${c.cost_centre}`.trim() : null],
    ['Department', c.department],
    ['Branch', c.branch],
    ['Project', c.project],
    [
      'Linked to',
      c.linked ? (
        c.linked.type === 'tender' ? (
          <button type="button" className="text-left text-primary hover:underline" onClick={() => navigate(`/tenders?open=${c.linked!.id}&wt=expenses`)}>
            {linkedLine(c.linked)}
          </button>
        ) : (
          linkedLine(c.linked)
        )
      ) : null,
    ],
    ['Refund', c.refundable ? (c.refunded_at ? `Refunded ${shortDate(c.refunded_at)}${c.refunded_by ? ` · recorded by ${c.refunded_by}` : ''}` : 'Refundable — not refunded yet') : null],
    ['Vendor', c.vendor],
    ['Tax on it', c.tax_amount ? money(c.tax_amount, c.base_currency) : null],
    ['Distance', c.kind === 'mileage' && c.quantity ? `${c.quantity} units` : null],
  ];
  return rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[12px] border border-line px-3.5 py-3">
      <Caps>{title}</Caps>
      {children}
    </section>
  );
}

/**
 * Every round of the approval chain, oldest first. A claim edited after review
 * keeps its earlier round — "Priya approved step 1 on Tuesday" survives the
 * edit that followed — so a round that has ended says so, rather than reading
 * like a decision on the claim as it now stands.
 */
function Trail({ claim }: { claim: ClaimDetail }) {
  if (!claim.approvals.length) return <p className="m-0 py-1 text-[12.5px] text-ink-3">No approval chain was built for this claim.</p>;
  const all = rounds(claim.approvals);
  return (
    <div className="flex flex-col gap-3">
      {all.map((r) => (
        <div key={r.revision} className={cx('flex flex-col gap-2', !r.live && 'opacity-75')}>
          {all.length > 1 ? <span className="text-[11.5px] font-semibold text-ink-3">{r.live ? `Version ${r.revision} — the one being decided` : `Version ${r.revision} — before it was changed`}</span> : null}
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {r.steps.map((a) => (
              <li key={a.id} className="flex items-start gap-2.5">
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.status === 'approved' ? 'bg-success' : a.status === 'rejected' ? 'bg-danger' : a.status === 'skipped' ? 'bg-line' : 'bg-amber')} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[13px] text-ink">
                    <b>{a.label ?? `Step ${a.step}`}</b> — {approvalLine(a)}
                  </span>
                  {a.note ? <span className="text-[12px] text-ink-2">{a.note}</span> : null}
                  {a.decided_at ? <span className="text-[11.5px] text-ink-3">{stamp(a.decided_at)}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

/**
 * The receipt, and the drop zone that puts one there.
 *
 * TWO CALLS, ON PURPOSE: the bytes go to `/receipts`, which enforces the size
 * ceiling and the extension list, and only then is the id it returns bound to
 * the claim — one upload path, so two cannot drift apart.
 *
 * An image is drawn in place through the app's authenticated proxy; anything
 * else opens or saves through Transfers. `drag` counts rather than flags,
 * because `dragleave` fires on every child the pointer crosses and a flag
 * would flicker the highlight off.
 */
function ReceiptBox({ claim, writable, onChanged }: { claim: ClaimDetail; writable: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(0);
  const [broken, setBroken] = useState(false);
  const [removing, setRemoving] = useState(false);
  const pick = useRef<HTMLInputElement | null>(null);
  const r = claim.receipt;
  const name = r?.name ?? `${claim.claim_no ?? 'claim'} receipt`;

  const send = async (file: File) => {
    setDrag(0);
    if (file.size > RECEIPT_MAX) {
      toast('error', 'That file is larger than 10 MB.');
      return;
    }
    setBusy(true);
    try {
      const up = await uploadReceipt(file);
      await attachReceipt(claim.id, up.id);
      toast('success', 'Receipt attached.');
      setBroken(false);
      onChanged();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await detachReceipt(claim.id);
      toast('success', 'Receipt removed.');
      setRemoving(false);
      onChanged();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const fetchIt = (open: boolean) =>
    void saveReceipt(claim.id, name, open).then(
      () => toast('success', open ? 'Opening the receipt — see Transfers.' : 'Saving a copy — see Transfers.'),
      (e) => toast('error', errorMessage(e)),
    );

  if (claim.has_receipt) {
    return (
      <section className="flex flex-col gap-2">
        <Caps>Receipt</Caps>
        {r?.is_image ? (
          <button type="button" onClick={() => fetchIt(true)} title="Open the full size" className="block overflow-hidden rounded-[12px] border border-line bg-ground hover:border-primary/40">
            {broken ? (
              <span className="block py-10 text-center text-[12px] text-ink-3">Could not load the receipt</span>
            ) : (
              <img src={apiUrl(`/api/expense/claims2/${claim.id}/receipt`, { v: claim.receipt_id ?? undefined })} alt={r.name} onError={() => setBroken(true)} className="max-h-72 w-full object-contain" />
            )}
          </button>
        ) : null}
        {!r ? <p className="m-0 text-[12.5px] text-ink-2">The claim has a receipt, but its record could not be read. Opening it will say why.</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnSmall} onClick={() => fetchIt(true)}>
            <Icon name="external" size={13} className="mr-1" /> Open the receipt
          </button>
          <button type="button" className={btnSmall} onClick={() => fetchIt(false)}>
            <Icon name="download" size={13} className="mr-1" /> Save a copy
          </button>
          {r ? (
            <span className="min-w-0 truncate text-[12px] text-ink-3" title={r.name}>
              {r.name}
              {r.size ? ` · ${sizeWords(r.size)}` : ''}
            </span>
          ) : null}
          {writable ? (
            <button type="button" disabled={busy} onClick={() => setRemoving(true)} className="ml-auto rounded-[7px] px-2 py-1 text-[12px] font-semibold text-ink-3 hover:bg-subtle hover:text-danger disabled:opacity-50">
              Remove
            </button>
          ) : null}
        </div>
        {removing ? <ConfirmSheet title="Remove this receipt?" body="It comes off the claim. The file itself is kept." action="Remove" danger busy={busy} onYes={() => void remove()} onClose={() => setRemoving(false)} /> : null}
      </section>
    );
  }

  if (!writable) return <p className="m-0 text-[12.5px] text-ink-3">No receipt is attached.</p>;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Attach a receipt"
      onDragEnter={(e) => {
        e.preventDefault();
        setDrag((n) => n + 1);
      }}
      onDragLeave={() => setDrag((n) => Math.max(0, n - 1))}
      // Without this the drop is refused and the file is opened instead.
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) void send(f);
        else setDrag(0);
      }}
      onClick={() => pick.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick.current?.click();
        }
      }}
      className={cx('flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[12px] border-2 border-dashed px-4 py-6 text-center', drag > 0 ? 'border-primary bg-selection' : 'border-line hover:bg-subtle', busy && 'pointer-events-none opacity-60')}
    >
      <Icon name="upload" size={18} className={drag > 0 ? 'text-primary' : 'text-ink-3'} />
      <span className="text-[13px] font-semibold text-ink">{busy ? 'Attaching…' : drag > 0 ? 'Drop it here' : 'Drag a receipt here, or click to choose'}</span>
      <span className="text-[12px] text-ink-3">PDF, image or Office document · up to 10 MB</span>
      <input
        ref={pick}
        type="file"
        className="hidden"
        accept={RECEIPT_ACCEPT}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void send(f);
          // Cleared, or choosing the same file again fires no change.
          e.target.value = '';
        }}
      />
    </div>
  );
}

/**
 * What OCR read off a receipt, each value with how it was found. They are
 * suggestions, not figures — the confidence is a plain statement of where the
 * value came from, so a person knows how hard to look.
 */
export function ReadFields({ fields }: { fields: Record<string, ReadField> | null }) {
  if (!fields || !Object.keys(fields).length) return <p className="m-0 text-[12.5px] text-ink-3">Nothing was read.</p>;
  return (
    <div className="flex flex-col gap-2.5">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {Object.entries(fields).map(([k, v]) => (
          <li key={k} className="flex flex-wrap items-baseline gap-2 text-[13px]">
            <span className="w-24 shrink-0 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{k.replace(/_/g, ' ')}</span>
            <span className={cx('font-semibold', v.value ? 'text-ink' : 'text-ink-3')}>{v.value ?? 'not found'}</span>
            <Pill tone={v.confidence === 'high' ? 'green' : v.confidence === 'medium' ? 'blue' : v.confidence === 'low' ? 'amber' : 'grey'}>{v.confidence}</Pill>
            {v.why ? <span className="w-full text-[12px] text-ink-3">{v.why}</span> : null}
          </li>
        ))}
      </ul>
      <Notice tone="grey">These were read off the image by OCR. They are suggestions, not figures — check every one against the paper before saving. Optical recognition misreads digits on photographed receipts often enough to matter.</Notice>
    </div>
  );
}

/** Approving takes an optional note; declining (a ReasonSheet) insists on one. */
function ApproveSheet({ busy, onOk, onClose }: { busy: boolean; onOk: (note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState('');
  return (
    <Sheet
      title="Approve this claim"
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => onOk(note.trim())}>
            {busy ? 'Working…' : 'Approve'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">Add a note, if you want one on the record.</p>
      <Field label="Note">
        <textarea autoFocus rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className="resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] font-medium text-ink outline-none focus:border-primary" />
      </Field>
    </Sheet>
  );
}

/**
 * Edit a submitted claim and send it back for approval.
 *
 * NARROW ON PURPOSE. Filing decides every field; correcting is almost always a
 * wrong figure, a wrong date or a description an approver could not follow.
 * The server lays these over the claim rather than replacing it, so a field
 * left out here is carried across, not cleared. The reason is required: it is
 * the only thing that tells an approver, asked to look a second time, what
 * changed.
 */
function EditClaim({ claim, onClose, onDone }: { claim: ClaimDetail; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(claim.amount ?? '');
  const [spentOn, setSpentOn] = useState(claim.spent_on);
  const [description, setDescription] = useState(claim.description);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  // Nothing changed is not a resubmission: it would send an approver back to a claim they have read.
  const changed = (claim.amount ?? '') !== amount || claim.spent_on !== spentOn || claim.description !== description;

  const save = async () => {
    setBusy(true);
    setSaid(null);
    try {
      toast('success', (await editClaim(claim.id, { amount, spent_on: spentOn, description, reason: reason.trim() })) ?? 'Resubmitted');
      onDone();
    } catch (e) {
      // The server's sentence, verbatim: it names the policy, budget or rule that stopped it.
      setSaid(refusal(e));
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Edit & resubmit"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !changed || reason.trim() === ''} onClick={() => void save()}>
            {busy ? 'Resubmitting…' : 'Resubmit for approval'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">{claim.claim_no ?? 'This claim'} goes back to the start of the approval chain. The version it replaces is kept, together with who approved what on it.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Amount (${claim.currency})`}>
          <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} disabled={claim.kind !== 'expense'} title={claim.kind !== 'expense' ? 'Worked out from the rate schedule, not typed' : undefined} />
        </Field>
        <Field label="Spent on">
          <input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} className={input} />
        </Field>
      </div>
      <Field label="Description">
        <input value={description} onChange={(e) => setDescription(e.target.value)} className={input} />
      </Field>
      <Field label="Why are you resubmitting?">
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="The approver sees this, and it is kept on the record." className="resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] font-medium text-ink outline-none focus:border-primary" />
      </Field>
      <p className="m-0 text-[12px] text-ink-3">Anything you do not change here stays as it is — the category, the receipt and the links are carried across.</p>
      {said ? <Notice tone="red">{said}</Notice> : null}
    </Sheet>
  );
}

// ── one field, corrected where it is read ────────────────────────────────

export type InlineKind = 'text' | 'money' | 'integer' | 'date' | 'choice' | 'boolean';

/**
 * One field you can correct where you are reading it (the web's
 * expense/InlineField, for the subscription drawer and anything like it).
 *
 * ONE FIELD PER SAVE: the writers behind it store only the keys they are
 * given, so `{amount: "5000"}` changes the amount and nothing else.
 *
 * IT SAVES ON COMMIT, NOT ON EVERY KEYSTROKE — a debounce on a money field
 * writes 5, 50, 500 and 5000, three of them wrong. A commit is a blur, Enter,
 * or a pick from a control with no in-between state; Escape abandons.
 *
 * IT REVERTS WHEN THE SERVER REFUSES. What was typed shows at once, and when
 * the save is refused the stored value comes back — `onSave` rejects with the
 * server's sentence, which the caller has already shown.
 */
export function InlineField({ label, value, display, kind, choices, canEdit, hint, onSave }: { label: string; value: string; display?: ReactNode; kind: InlineKind; choices?: Array<{ value: string; label: string }>; canEdit: boolean; hint?: string; onSave: (next: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A tick for a moment, then gone: a permanent one reads as decoration.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(t);
  }, [saved]);

  const commit = async (next: string) => {
    setEditing(false);
    if (next === value) return;
    setPending(next);
    try {
      await onSave(next);
      setSaved(true);
    } catch {
      /* The caller showed the server's sentence; this only stops showing a value that was not stored. */
    } finally {
      setPending(null);
    }
  };
  const shown = pending ?? value;

  if (!canEdit) return <InlineRow label={label}>{display ?? (value || '—')}</InlineRow>;

  if (editing && (kind === 'choice' || kind === 'boolean')) {
    return (
      <InlineRow label={label}>
        <Select
          aria-label={label}
          value={draft}
          onValueChange={(v) => void commit(v)}
          className="h-[30px] w-full"
          options={
            kind === 'boolean'
              ? [
                  { value: '1', label: 'Yes' },
                  { value: '0', label: 'No' },
                ]
              : (choices ?? [])
          }
        />
      </InlineRow>
    );
  }

  if (editing) {
    return (
      <InlineRow label={label}>
        <input
          autoFocus
          aria-label={label}
          type={kind === 'date' ? 'date' : 'text'}
          value={draft}
          inputMode={kind === 'money' ? 'decimal' : kind === 'integer' ? 'numeric' : undefined}
          onFocus={(e) => kind !== 'date' && e.currentTarget.select()}
          onChange={(e) => setDraft(kind === 'money' ? e.target.value.replace(/[^0-9.,]/g, '') : kind === 'integer' ? e.target.value.replace(/[^0-9]/g, '') : e.target.value)}
          onBlur={() => void commit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit(draft);
            }
            // Escape puts back what was there — otherwise there is no way out of a half-typed edit.
            if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(value);
              setEditing(false);
            }
          }}
          className={cx(input, 'h-[30px] text-right')}
        />
      </InlineRow>
    );
  }

  return (
    <InlineRow label={label} hint={hint}>
      <button
        type="button"
        title={`Edit ${label.toLowerCase()}`}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="-mr-1 max-w-full truncate rounded-[5px] px-1 py-0.5 text-right hover:bg-subtle"
      >
        {pending !== null ? shown || '—' : (display ?? (value || <span className="text-ink-3">—</span>))}
      </button>
      {pending !== null ? <span className="ml-1.5 text-[11px] text-ink-3">saving…</span> : null}
      {saved && pending === null ? <Icon name="check" size={13} label="Saved" className="ml-1 inline text-success" /> : null}
    </InlineRow>
  );
}

/** A label on the left, its value right-aligned and given the row's remaining width. */
export function InlineRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 pb-2">
      <dt className="shrink-0 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase" title={hint}>
        {label}
      </dt>
      <dd className="m-0 flex min-w-0 flex-1 items-baseline justify-end text-right text-[13px] text-ink">{children}</dd>
    </div>
  );
}
