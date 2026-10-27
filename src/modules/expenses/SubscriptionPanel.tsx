import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ApiError } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btn, btnBad, btnPrimary, btnSmall, Field, input, Seg, Sheet, SidePanel } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { longDate, problemsOf, refusal, shortDate } from '../finance/api';
import { ConfirmSheet, LoadFailed, Notice } from '../../components/RecordKit';
import { money, type Org } from './api';
import { StatusPill, words } from './parts';
import type { ScreenProps } from './Rail';
import {
  amountOk,
  attachDoc,
  bumpSubs,
  claimPreset,
  CYCLES,
  cycleLabel,
  deleteSub,
  docForm,
  fetchDocs,
  fetchSub,
  fetchSubClaims,
  fileBlocked,
  filedSentence,
  fileSize,
  inDays,
  KIND_LABEL,
  mayWriteSub,
  moveSub,
  moveTargets,
  openDoc,
  removeDoc,
  setSubStatus,
  SK,
  trimRate,
  updateSub,
  writeOrg,
  type ClaimPreset,
  type DocKind,
  type Sub,
  type SubDoc,
} from './suppliers';

/**
 * One subscription, opened rather than edited.
 *
 * FOUR TABS, THREE FETCHED ONLY WHEN OPENED. The overview is the record (the
 * list's row paints it at once; one read brings it current and counts the
 * documents); invoices, payments and the expenses booked against it each load
 * on first open — a subscription with no documents should not pay three
 * requests to prove it.
 *
 * THE RECORD IS CORRECTABLE WHERE IT IS READ. Each editable row saves one
 * field, which is what the server's partial update is built for; the computed
 * rows (per month, and a renewal worked out from the start date) are not
 * editable and must not look it.
 */
type Tab = 'overview' | DocKind | 'expenses';

const TONE: Record<string, 'green' | 'amber' | 'grey'> = { active: 'green', paused: 'amber', cancelled: 'grey' };

export function SubPill({ status }: { status: string }) {
  return <Pill tone={TONE[status] ?? 'grey'}>{words(status)}</Pill>;
}

export function SubscriptionPanel({
  id,
  seed,
  org,
  orgId,
  orgs,
  manage,
  canCopy,
  onClose,
  onEdit,
  onCopy,
  onGo,
  onFile,
}: {
  id: number;
  /** The list's row, so the panel paints at once rather than flashing a spinner over data already here. */
  seed: Sub | null;
  org: string;
  orgId: number | null;
  orgs: Org[];
  manage: boolean;
  canCopy: (s: Sub) => boolean;
  onClose: () => void;
  onEdit: (s: Sub) => void;
  onCopy: (s: Sub) => void;
  onGo: ScreenProps['onGo'];
  onFile?: (preset: ClaimPreset, orgId: number) => void;
}) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: SK.one(org, id), queryFn: ({ signal }) => fetchSub(id, signal), retry: false });
  const [tab, setTab] = useState<Tab>('overview');
  const [moving, setMoving] = useState(false);
  const [asking, setAsking] = useState<'cancel' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const s = detail.data?.subscription ?? seed;
  const counts = detail.data?.documents ?? {};
  const write = !!s && mayWriteSub(s, orgs, manage);

  const status = async (next: 'active' | 'paused') => {
    if (!s) return;
    setBusy(true);
    await setSubStatus(qc, s, next, orgId);
    setBusy(false);
  };
  const badge = (label: string, n: number | undefined) => (n ? `${label} · ${n}` : label);

  return (
    <SidePanel
      label={s ? `Subscription ${s.name}` : 'Subscription'}
      width={680}
      onClose={onClose}
      head={
        s ? (
          <>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-subtle text-ink-3">
              <Icon name="repeat" size={18} />
            </span>
            <span className="flex min-w-0 flex-col">
              <b className="truncate text-[15px] text-ink">{s.name}</b>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-3">
                <SubPill status={s.status} />
                <span>{cycleLabel(s.billing_cycle)}</span>
                <b className="text-ink-2 tabular-nums">{money(s.amount, s.currency)}</b>
                {s.org ? <span>{s.org}</span> : <i>Every company</i>}
              </span>
            </span>
          </>
        ) : (
          <b className="text-ink">Subscription</b>
        )
      }
    >
      {!s ? (
        detail.isLoading ? (
          <Spinner />
        ) : detail.error instanceof ApiError && detail.error.status === 404 ? (
          // The server answers the same for "not yours" and "not there" — across companies, confirming it exists would itself be a disclosure.
          <Notice tone="grey">That subscription is not one you can see, or it no longer exists.</Notice>
        ) : (
          <LoadFailed what="That subscription" onRetry={() => void detail.refetch()} />
        )
      ) : (
        <>
          {write ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={btnSmall} onClick={() => onEdit(s)}>
                <Icon name="compose" size={13} className="mr-1" /> Edit
              </button>
              {canCopy(s) ? (
                <button type="button" className={btnSmall} onClick={() => onCopy(s)}>
                  <Icon name="copy" size={13} className="mr-1" /> Copy
                </button>
              ) : null}
              {s.status === 'active' ? (
                <button type="button" className={btnSmall} disabled={busy} onClick={() => void status('paused')}>
                  Pause
                </button>
              ) : (
                <button type="button" className={btnSmall} disabled={busy} onClick={() => void status('active')}>
                  {s.status === 'paused' ? 'Resume' : 'Reactivate'}
                </button>
              )}
              {s.status !== 'cancelled' ? (
                <button type="button" className={btnSmall} onClick={() => setAsking('cancel')}>
                  Cancel subscription…
                </button>
              ) : null}
              <button type="button" className={btnBad} onClick={() => setAsking('delete')}>
                Delete…
              </button>
            </div>
          ) : null}
          <Seg
            label="Show"
            value={tab}
            onChange={setTab}
            options={[
              { id: 'overview', label: 'Overview' },
              { id: 'invoice', label: badge('Invoices', counts.invoice) },
              { id: 'payment_receipt', label: badge('Payments', counts.payment_receipt) },
              { id: 'expenses', label: 'Expenses' },
            ]}
          />
          {tab === 'overview' ? <Overview s={s} canEdit={write} orgId={orgId} onMove={write ? () => setMoving(true) : undefined} /> : null}
          {tab === 'invoice' || tab === 'payment_receipt' ? <Documents key={tab} s={s} kind={tab} canEdit={write} org={org} orgId={orgId} /> : null}
          {tab === 'expenses' ? <Expenses s={s} org={org} orgId={orgId} orgs={orgs} onGo={onGo} onFile={onFile} /> : null}
          {moving ? <MoveSheet s={s} orgs={orgs} onClose={() => setMoving(false)} /> : null}
          {asking ? <SubConfirm what={asking} sub={s} orgId={orgId} onClose={() => setAsking(null)} onDone={() => (setAsking(null), asking === 'delete' ? onClose() : undefined)} /> : null}
        </>
      )}
    </SidePanel>
  );
}

// ── the overview ─────────────────────────────────────────────────────────

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-line/60 py-2 last:border-b-0">
      <span className="w-[118px] shrink-0 pt-0.5 text-[12px] font-semibold text-ink-3">{label}</span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-[13px] text-ink">
        {children}
        {hint ? <span className="text-[11.5px] text-ink-3">{hint}</span> : null}
      </div>
    </div>
  );
}

type Kind = 'text' | 'money' | 'integer' | 'date' | 'choice' | 'boolean';

/**
 * One field, correctable in place. It saves when committed — Enter, leaving
 * the box, or picking a choice — never on a timer, and one field is one
 * request. When the server refuses, its sentence is shown and the old value
 * stays: a row must not keep showing what was not stored. Escape leaves
 * without saving, and without closing the panel behind it.
 */
function InlineRow({
  label,
  hint,
  value,
  display,
  kind,
  canEdit,
  clearable,
  onSave,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  display?: ReactNode;
  kind: Kind;
  canEdit: boolean;
  /** An empty value clears the field (the server's nullable columns). Otherwise empty means "no change". */
  clearable?: boolean;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  // Set once a commit or a cancel has been decided, so the blur that follows the box going away is not a second save.
  const settled = useRef(false);

  const shown = display ?? (value || <span className="text-ink-3">—</span>);
  if (!canEdit) return <Row label={label} hint={hint}>{shown}</Row>;

  const begin = () => {
    settled.current = false;
    setDraft(value);
    setEditing(true);
  };
  const cancel = () => {
    settled.current = true;
    setDraft(value);
    setEditing(false);
  };
  const commit = async (next: string) => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    const v = kind === 'text' ? next : next.trim();
    if (v === value || (v === '' && !clearable && kind !== 'text')) return;
    setBusy(true);
    try {
      await onSave(v);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch {
      setDraft(value);
    } finally {
      setBusy(false);
    }
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commit(draft);
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancel();
    }
  };

  let body: ReactNode;
  if (editing && (kind === 'choice' || kind === 'boolean')) {
    body = (
      <span className="flex items-center gap-2" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), cancel())}>
        <Select aria-label={label} autoFocus value={draft} onValueChange={(v) => (setDraft(v), void commit(v))} className="h-[30px] w-[220px]" options={kind === 'boolean' ? [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }] : CYCLES} />
        <button type="button" className="text-[12px] font-semibold text-ink-3 hover:text-ink" onClick={cancel}>
          Cancel
        </button>
      </span>
    );
  } else if (editing && kind === 'date') {
    body = (
      <span className="flex flex-wrap items-center gap-2">
        <input aria-label={label} type="date" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} className={cx(input, 'h-[30px] w-[170px]')} />
        <button type="button" className={btnSmall} disabled={!draft && !clearable} onClick={() => void commit(draft)}>
          Save
        </button>
        {clearable && value ? (
          <button type="button" className={btnSmall} onClick={() => void commit('')}>
            Clear
          </button>
        ) : null}
        <button type="button" className="text-[12px] font-semibold text-ink-3 hover:text-ink" onClick={cancel}>
          Cancel
        </button>
      </span>
    );
  } else if (editing) {
    body = (
      <input
        aria-label={label}
        autoFocus
        value={draft}
        inputMode={kind === 'money' ? 'decimal' : kind === 'integer' ? 'numeric' : undefined}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(kind === 'money' ? e.target.value.replace(/[^0-9.,]/g, '') : kind === 'integer' ? e.target.value.replace(/[^0-9]/g, '') : e.target.value)}
        onBlur={() => void commit(draft)}
        onKeyDown={keys}
        className={cx(input, 'h-[30px]', kind === 'text' ? 'w-full' : 'w-[170px] text-right tabular-nums')}
      />
    );
  } else {
    body = (
      <span className="flex max-w-full items-center gap-1.5">
        <button type="button" title={`Edit ${label.toLowerCase()}`} onClick={begin} className="group -mx-1 inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-left hover:bg-subtle">
          <span className="min-w-0 truncate">{shown}</span>
          <Icon name="compose" size={12} className="shrink-0 text-ink-3 opacity-0 group-hover:opacity-100" />
        </button>
        {busy ? <span className="text-[11.5px] text-ink-3">saving…</span> : saved ? <Icon name="check" size={13} className="text-success" label="Saved" /> : null}
      </span>
    );
  }
  return (
    <Row label={label} hint={hint}>
      {body}
    </Row>
  );
}

function Overview({ s, canEdit, orgId, onMove }: { s: Sub; canEdit: boolean; orgId: number | null; onMove?: () => void }) {
  const qc = useQueryClient();
  const foreign = s.currency !== s.base_currency;

  /** One field, one request. Rejects so the row can put the old value back; the server's sentence verbatim, since it knows rules this screen does not. */
  const save = async (patch: Record<string, unknown>) => {
    try {
      await updateSub(s.id, patch, writeOrg(s, orgId));
      void bumpSubs(qc);
    } catch (e) {
      toast('error', refusal(e));
      throw e;
    }
  };

  const days = s.overdue ? (
    <span className="ml-1.5 inline-flex h-[18px] items-center rounded-[9px] bg-danger-bg px-2 text-[11px] font-bold text-danger-ink dark:bg-danger-bg dark:text-danger">overdue</span>
  ) : s.days_until !== null ? (
    <span className="ml-1.5 text-ink-3">{inDays(s.days_until)}</span>
  ) : null;

  return (
    <div className="flex flex-col">
      <InlineRow
        label="Amount"
        kind="money"
        canEdit={canEdit}
        value={s.amount}
        display={money(s.amount, s.currency)}
        hint={
          [s.quantity > 1 ? `Per unit. One cycle costs ${money(s.charge, s.currency)} for ${s.quantity}.` : null, foreign ? `1 ${s.currency} = ${trimRate(s.exchange_rate)} ${s.base_currency}, booked as ${money(s.base_amount, s.base_currency)}.` : null].filter(Boolean).join(' ') || undefined
        }
        // The booked rate travels with a new amount: sent alone, the server would re-convert a foreign amount at 1.
        onSave={(v) => save(foreign ? { amount: v, exchange_rate: s.exchange_rate } : { amount: v })}
      />
      <Row label="Per month" hint="Computed from the amount and the cycle — not stored.">
        <span className="text-ink-2 tabular-nums">{money(s.monthly_equiv, s.currency)}</span>
      </Row>
      <InlineRow label="Billing cycle" kind="choice" canEdit={canEdit} value={s.billing_cycle} display={cycleLabel(s.billing_cycle)} onSave={(v) => save({ billing_cycle: v })} />
      <InlineRow label="Quantity" kind="integer" canEdit={canEdit} value={String(s.quantity)} onSave={(v) => save({ quantity: Number(v) })} />
      <InlineRow label="Starts" kind="date" canEdit={canEdit} value={s.start_date} display={longDate(s.start_date) || '—'} onSave={(v) => save({ start_date: v })} />
      <InlineRow label="Ends" kind="date" clearable canEdit={canEdit} value={s.end_date ?? ''} display={s.end_date ? longDate(s.end_date) : <span className="text-ink-3">Open-ended</span>} onSave={(v) => save({ end_date: v })} />
      {/*
        The next renewal says whether it was STATED or worked out. A stated
        date is the answer and may be in the past — overdue, which the
        calculation could never express because it rolled straight over it.
        A subscription following a domain takes the registrar's date, and one
        set here would be put back by the next sync, so it is not offered.
      */}
      {s.status === 'active' && s.domain_linked ? (
        <Row label="Next renewal" hint="From the registrar, through the domain this subscription follows.">
          <span>
            {s.next_renewal ? longDate(s.next_renewal) : <span className="text-ink-3">—</span>}
            {days}
          </span>
          <span className="text-[12px] text-ink-3">follows {s.domain?.name ?? 'its domain'}’s expiry</span>
        </Row>
      ) : s.status === 'active' ? (
        <InlineRow
          label="Next renewal"
          kind="date"
          canEdit={canEdit}
          value={s.renews_on ?? s.next_renewal ?? ''}
          hint={s.renewal_is_set ? 'Set from a payment receipt or by hand.' : 'Worked out by stepping the start date forward. Set a date to state it instead.'}
          display={
            <>
              {s.next_renewal ? longDate(s.next_renewal) : <span className="text-ink-3">—</span>}
              {days}
            </>
          }
          onSave={(v) => save({ renews_on: v })}
        />
      ) : (
        // A paused subscription renews on no date at all, and says so rather than showing a blank that reads as "not known yet".
        <Row label="Next renewal">
          <span className="text-ink-3">Not renewing while {s.status}</span>
        </Row>
      )}
      <InlineRow
        label="Auto renew"
        kind="boolean"
        canEdit={canEdit && !s.domain_linked}
        hint={s.domain_linked ? 'From the registrar, through the domain this subscription follows.' : undefined}
        value={s.auto_renew ? '1' : '0'}
        display={s.auto_renew ? 'Yes' : 'No'}
        onSave={(v) => save({ auto_renew: v === '1' })}
      />
      {/* Read-only here on purpose: a picker needs the full lists, which is what the Edit form loads. */}
      <Row label="Vendor" hint={canEdit ? 'Changed on the Edit form.' : undefined}>
        {s.vendor ?? <span className="text-ink-3">—</span>}
      </Row>
      <Row label="Category" hint={canEdit ? 'Changed on the Edit form.' : undefined}>
        {s.category ?? <span className="text-ink-3">—</span>}
      </Row>
      {/* The company is the field somebody routinely needs to correct — every imported subscription arrives belonging to none — so it carries its own action. */}
      <Row label="Company" hint={s.org_id === null ? 'Belongs to no company: it shows under every one and counts in every company’s totals.' : undefined}>
        <span className="flex items-center gap-2">
          {s.org ?? <i className="text-ink-3">Every company</i>}
          {onMove ? (
            <button type="button" className="rounded-[6px] px-1.5 py-0.5 text-[12px] font-semibold text-primary hover:bg-selection" onClick={onMove}>
              Change
            </button>
          ) : null}
        </span>
      </Row>
      {s.domain_linked ? (
        <Row label="Domain" hint="The domain in Hosting this subscription pays for. Its registrar owns the renewal date and auto-renew.">
          {s.domain ? (
            <span>
              {s.domain.name}
              <span className="ml-1.5 text-ink-3">
                {s.domain.expires_on ? s.domain.left : 'no expiry date'}
                {s.domain.registrar ? ` · ${s.domain.registrar}` : ''}
              </span>
            </span>
          ) : (
            <span className="text-ink-3">A domain in Hosting you cannot open</span>
          )}
        </Row>
      ) : null}
      <InlineRow label="Note" kind="text" canEdit={canEdit} value={s.description ?? ''} display={s.description ?? <span className="text-ink-3">—</span>} onSave={(v) => save({ description: v })} />
    </div>
  );
}

// ── invoices and payments ────────────────────────────────────────────────

function Documents({ s, kind, canEdit, org, orgId }: { s: Sub; kind: DocKind; canEdit: boolean; org: string; orgId: number | null }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: SK.docs(org, s.id, kind), queryFn: ({ signal }) => fetchDocs(s.id, kind, signal), retry: false });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SubDoc | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const noun = KIND_LABEL[kind];

  const open = async (d: SubDoc) => {
    setBusy(d.id);
    try {
      await openDoc(s.id, d);
    } catch (e) {
      toast('error', `That file could not be opened — ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(removing.id);
    try {
      await removeDoc(s.id, removing.id);
      toast('success', `Removed "${removing.title}". The file itself stays in the Drive.`);
      void bumpSubs(qc);
      setRemoving(null);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error) return <LoadFailed what={`The ${noun}s`} onRetry={() => void q.refetch()} />;
  const docs = q.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <p className="m-0 min-w-0 flex-1 text-[12.5px] text-ink-3">
          {kind === 'invoice'
            ? 'Invoices you were sent for this subscription. Filed here, not posted to any ledger.'
            : `Proof of payment — receipts, slips and confirmations.${s.status === 'active' && !s.domain_linked ? ' Filing one moves the next renewal on by a cycle, from its anniversary.' : ''}`}
        </p>
        {canEdit ? (
          <button type="button" className={btnPrimary} onClick={() => setAdding(true)}>
            <Icon name="upload" size={14} /> Add {noun}
          </button>
        ) : null}
      </div>
      {docs.length ? (
        <div className="overflow-hidden rounded-[12px] border border-line">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2.5 last:border-b-0">
              <Icon name="file-text" size={18} className="shrink-0 text-ink-3" />
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-[13px] text-ink">{d.title}</b>
                <span className="truncate text-[11.5px] text-ink-3">{[d.document_date ? shortDate(d.document_date) : null, d.reference, d.uploaded_by, fileSize(d.file_size) || null].filter(Boolean).join(' · ') || '—'}</span>
              </span>
              {d.amount ? <span className="shrink-0 text-[13px] tabular-nums text-ink-2">{money(d.amount, d.currency ?? '')}</span> : null}
              {/* No link when the bytes have gone — the Drive is a separate lifecycle, and a download that 404s is worse than none. */}
              {d.has_file ? (
                <button type="button" className={btnSmall} disabled={busy === d.id} onClick={() => void open(d)}>
                  <Icon name="download" size={13} className="mr-1" /> Open
                </button>
              ) : (
                <i className="shrink-0 text-[11.5px] text-ink-3">file removed</i>
              )}
              {canEdit ? (
                <button type="button" aria-label={`Remove ${d.title}`} title="Remove" className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle hover:text-danger" onClick={() => setRemoving(d)}>
                  <Icon name="trash" size={14} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[12px] border border-dashed border-line px-4 py-8 text-center text-[13px] text-ink-3">No {noun}s filed yet.</div>
      )}
      {adding ? <UploadSheet s={s} kind={kind} orgId={orgId} onClose={() => setAdding(false)} /> : null}
      {removing ? (
        <ConfirmSheet
          title={`Remove ${noun}`}
          body={`Remove "${removing.title}" from this subscription? The file itself stays in the Drive.`}
          action="Remove"
          danger
          busy={busy === removing.id}
          onYes={() => void remove()}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}

const ACCEPT = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'docx', 'xlsx'];
const MAX_BYTES = 10 * 1024 * 1024;

function UploadSheet({ s, kind, orgId, onClose }: { s: Sub; kind: DocKind; orgId: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const ext = file ? (file.name.split('.').pop() ?? '').toLowerCase() : '';
  // The server's own limits, checked before the bytes travel.
  const problem = !file
    ? null
    : !ACCEPT.includes(ext)
      ? 'That has to be a PDF, an image, or an Office document.'
      : file.size > MAX_BYTES
        ? 'That file is over the 10 MB limit.'
        : amount.trim() && !amountOk(amount)
          ? 'The amount is not a number — digits, and at most two decimal places.'
          : null;

  const choose = (f: File | null) => {
    setFile(f);
    // The filename is the obvious title, offered rather than imposed — it stays editable.
    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setSaid([]);
    try {
      const res = await attachDoc(s.id, docForm({ file, kind, title, amount, currency: s.currency, date, reference }), writeOrg(s, orgId));
      toast('success', filedSentence(res, kind, s, longDate));
      void bumpSubs(qc);
      onClose();
    } catch (e) {
      setSaid(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={`Add ${KIND_LABEL[kind]}`}
      onClose={onClose}
      width={500}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !file || !title.trim() || problem !== null} onClick={() => void submit()}>
            {busy ? 'Filing…' : 'Add'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
        File
        <input ref={picker} type="file" className="hidden" aria-label="Choose a file" accept={ACCEPT.map((x) => `.${x}`).join(',')} onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        <span className="flex items-center gap-2">
          <button type="button" className={btnSmall} onClick={() => picker.current?.click()}>
            <Icon name="paperclip" size={13} className="mr-1" /> {file ? 'Choose another…' : 'Choose a file…'}
          </button>
          {file ? (
            <span className="min-w-0 truncate font-medium text-ink-2">
              {file.name} <span className="text-ink-3">· {fileSize(file.size)}</span>
            </span>
          ) : null}
        </span>
        <span className="text-[11.5px] font-medium text-ink-3">PDF, image or Office document, up to 10 MB.</span>
      </div>
      <Field label="Title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={<span>Amount ({s.currency}) <span className="font-medium text-ink-3">— optional</span></span>}>
          <input value={amount} inputMode="decimal" placeholder="0.00" onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))} className={cx(input, 'text-right tabular-nums')} />
        </Field>
        <Field label={<span>Date <span className="font-medium text-ink-3">— optional</span></span>}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </Field>
      </div>
      <Field label={<span>Reference <span className="font-medium text-ink-3">— optional</span></span>}>
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Invoice or transaction number" className={input} />
      </Field>
      <Notice tone="grey">An amount recorded here is transcribed off the document. It is not posted to any ledger and is not counted in the subscription cost totals.</Notice>
      {problem ? <Notice tone="amber">{problem}</Notice> : null}
      {said.length ? (
        <Notice tone="red">
          {said.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </Notice>
      ) : null}
    </Sheet>
  );
}

// ── the expenses booked against it ───────────────────────────────────────

/**
 * The expenses charged to this subscription, through the module's own claim
 * reader — so what appears depends on the reader: a member sees their own
 * claims, an approver their queue, a reporter everything. Two people opening
 * one subscription correctly see different totals, which is why the footer
 * says "you can see" rather than presenting a partial figure as the whole.
 */
function Expenses({ s, org, orgId, orgs, onGo, onFile }: { s: Sub; org: string; orgId: number | null; orgs: Org[]; onGo: ScreenProps['onGo']; onFile?: (preset: ClaimPreset, orgId: number) => void }) {
  const q = useQuery({ queryKey: SK.claims(org, s.id), queryFn: ({ signal }) => fetchSubClaims(s.id, orgId, signal), retry: false });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <LoadFailed what="The expenses booked against it" onRetry={() => void q.refetch()} />;
  const r = q.data!;

  // Filing happens in one company, and only one this subscription can be linked to from there.
  const blocked = onFile ? fileBlocked({ subOrgId: s.org_id, subOrg: s.org, orgId, several: orgId === null && orgs.length > 1, acting: orgs.find((o) => o.id === orgId) ?? null }) : null;
  const add = !onFile ? null : blocked ? (
    <span className="text-[12.5px] text-warning-ink dark:text-warning">{blocked}</span>
  ) : orgId !== null ? (
    <button type="button" className={btnPrimary} onClick={() => onFile(claimPreset(s), orgId)}>
      <Icon name="plus" size={14} /> Add expense
    </button>
  ) : null;

  if (!r.items.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-[12px] border border-dashed border-line px-4 py-8 text-center">
        <span className="text-[13px] text-ink-2">No expenses are charged to this subscription{r.scoped ? ' that you can see' : ''}.</span>
        {/* Nothing in the product creates an expense from a subscription automatically, so without this the tab looks broken rather than empty. */}
        <span className="max-w-[380px] text-[12px] text-ink-3">File one against this subscription and it appears here. Nothing is charged automatically at renewal.</span>
        {add}
      </div>
    );
  }

  const n = r.total;
  return (
    <div className="flex flex-col gap-3">
      {add ? <div className="flex justify-end">{add}</div> : null}
      <div className="overflow-hidden rounded-[12px] border border-line">
        {r.items.map((c) => (
          <button key={c.id} type="button" onClick={() => onGo('organization', `&claim=${c.id}`)} className="flex w-full items-center gap-3 border-b border-line/60 px-3.5 py-2.5 text-left last:border-b-0 hover:bg-subtle">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] text-ink">{c.description || '—'}</span>
              <span className="truncate text-[11.5px] text-ink-3">{[c.claim_no, c.spent_on ? shortDate(c.spent_on) : null, c.claimant].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="shrink-0 text-[13px] tabular-nums text-ink-2">{money(c.amount, c.currency)}</span>
            <StatusPill status={c.status} />
            <Icon name="chevron-right" size={14} className="shrink-0 text-ink-3" />
          </button>
        ))}
      </div>
      <p className="m-0 text-[12px] text-ink-3">
        {n} expense{n === 1 ? '' : 's'}
        {r.scoped ? ' you can see' : ''}
        {r.sum_currency ? ` · total ${money(r.sum, r.sum_currency)}` : n ? ' · in more than one currency, so no total is given' : ''}
        {r.unconverted ? ` · ${r.unconverted} not yet converted, so not in the total` : ''}
        {r.shown < n ? ` · showing the latest ${r.shown}` : ''}.
      </p>
    </div>
  );
}

// ── moving it, cancelling it, deleting it ────────────────────────────────

/**
 * Move a subscription to another company — its own act, matching its own
 * endpoint, because changing who can see a record is a different kind of act
 * from correcting its price. Only companies this person may act in are
 * offered: the server checks both ends and refuses anything else. Confirmed
 * before it happens, in words saying who will see it afterwards.
 */
function MoveSheet({ s, orgs, onClose }: { s: Sub; orgs: Org[]; onClose: () => void }) {
  const qc = useQueryClient();
  const targets = moveTargets(orgs);
  const [to, setTo] = useState(s.org_id ? String(s.org_id) : '');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const unchanged = (s.org_id ? String(s.org_id) : '') === to;
  const target = to === '' ? null : Number(to);
  const toName = target === null ? 'every company' : (orgs.find((o) => o.id === target)?.name ?? 'that company');
  const fromName = s.org ?? 'every company';

  const go = async () => {
    setBusy(true);
    try {
      const r = await moveSub(s.id, target);
      toast('success', target === null ? `${s.name} moved out of any company.` : `${s.name} moved to ${r?.org ?? toName}.`);
      void bumpSubs(qc);
      onClose();
    } catch (e) {
      toast('error', refusal(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet
        title="Move subscription"
        onClose={onClose}
        width={460}
        footer={
          <>
            <button type="button" className={btn} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} disabled={unchanged} onClick={() => setConfirming(true)}>
              {unchanged ? 'No change' : 'Move…'}
            </button>
          </>
        }
      >
        <p className="m-0 text-[13px] text-ink-2">
          <b className="text-ink">{s.name}</b> is currently in {s.org ? <b className="text-ink">{s.org}</b> : <i>every company</i>}.
        </p>
        <Field label="Company">
          <Select aria-label="Company" value={to} onValueChange={setTo} className="w-full" options={[{ value: '', label: 'Every company (unassigned)' }, ...targets.map((o) => ({ value: String(o.id), label: o.name }))]} />
        </Field>
        {to === '' ? <Notice tone="amber">Unassigned subscriptions are visible under every company, and their cost is counted in every company’s totals.</Notice> : null}
        {!targets.length ? <p className="m-0 text-[12px] text-ink-3">You do not belong to any company, so there is nowhere to move this to.</p> : null}
      </Sheet>
      {confirming ? (
        <ConfirmSheet
          title={`Move ${s.name}?`}
          body={
            <>
              It moves from <b>{fromName}</b> to <b>{toName}</b>.{' '}
              {target === null ? 'It will show under every company, and its cost will count in every company’s totals.' : `It will show under ${toName}, and its cost will count in ${toName}’s totals${s.org_id === null ? ' and no longer in every other company’s' : ` rather than ${fromName}’s`}.`}
            </>
          }
          action="Move"
          busy={busy}
          onYes={() => void go()}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Cancel or delete, confirmed. Cancelling stops it renewing and keeps the
 * record and its documents; deleting removes the record entirely, has no
 * undo, and is refused while documents are filed against it — the server
 * says how many.
 */
export function SubConfirm({ what, sub, orgId, onClose, onDone }: { what: 'cancel' | 'delete'; sub: Sub; orgId: number | null; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  if (what === 'cancel') {
    const yes = async () => {
      setBusy(true);
      const ok = await setSubStatus(qc, sub, 'cancelled', orgId);
      setBusy(false);
      if (ok) onDone();
    };
    return (
      <Sheet
        title={`Cancel ${sub.name}?`}
        onClose={onClose}
        width={460}
        footer={
          <>
            <button type="button" className={btn} onClick={onClose}>
              Keep it
            </button>
            <button type="button" className={cx(btnPrimary, '!bg-danger')} disabled={busy} onClick={() => void yes()}>
              {busy ? 'Working…' : 'Cancel subscription'}
            </button>
          </>
        }
      >
        <p className="m-0 text-[13px] leading-[1.55] text-ink-2">A cancelled subscription stops renewing and leaves the monthly and annual totals. The record and the documents filed against it stay, and it can be reactivated.</p>
      </Sheet>
    );
  }

  const yes = async () => {
    setBusy(true);
    setSaid(null);
    try {
      await deleteSub(sub.id, writeOrg(sub, orgId));
      toast('success', `${sub.name} deleted.`);
      void bumpSubs(qc);
      onDone();
    } catch (e) {
      // "2 documents are filed against this subscription. Remove them first, or pause it instead of deleting it."
      setSaid(refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmSheet
      title={`Delete ${sub.name}?`}
      body={
        <div className="flex flex-col gap-2.5">
          <span>This removes the record entirely — it is not the same as pausing it, and there is no undo.</span>
          {said ? <Notice tone="red">{said}</Notice> : null}
        </div>
      }
      action="Delete"
      danger
      busy={busy}
      onYes={() => void yes()}
      onClose={onClose}
    />
  );
}
