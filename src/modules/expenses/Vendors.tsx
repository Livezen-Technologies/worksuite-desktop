import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, PageHead, Sheet } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { problemsOf, refusal, shortDate } from '../finance/api';
import { ConfirmSheet, LoadFailed, Notice } from '../finance/parts';
import { can, canAct, money } from './api';
import { Note } from './parts';
import type { ScreenProps } from './Rail';
import { bumpVendors, createVendor, deleteVendor, fetchVendors, setVendorStatus, SK, type Vendor } from './suppliers';

/**
 * The vendors a group buys from, each with what this company has spent there.
 *
 * The list is group-wide — `vendors` has no company, because a group buys from
 * the same suppliers — but the figures beside each one are summed from this
 * company's claims, so the screen is one company's and is keyed to it. A
 * vendor this company has never bought from reads 0.00 rather than a sister
 * company's figure.
 *
 * A vendor with claims against it is archived, not deleted: the server refuses
 * the delete and says how many claims would lose their meaning. Archiving
 * hides it from the pickers and keeps the history readable.
 */
export default function Vendors({ orgId, orgs }: ScreenProps) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const company = orgs.find((o) => o.id === orgId) ?? null;
  const mayWrite = can(perms, 'expense.manage') && !!company && canAct(company);
  const q = useQuery({ queryKey: SK.vendors(orgId ?? 0), queryFn: ({ signal }) => fetchVendors(orgId!, signal), enabled: orgId !== null, retry: false });
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Vendor | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  if (orgId === null) return null;
  if (q.isLoading) return <Spinner />;
  if (q.error) {
    // A refusal is a sentence about this person; a failed request is not a statement about the vendors.
    return q.error instanceof ApiError && q.error.forbidden ? <Note>{refusal(q.error)}</Note> : <LoadFailed what="The vendors" onRetry={() => void q.refetch()} />;
  }

  const rows = q.data ?? [];

  const archive = async (v: Vendor) => {
    const next = v.status === 'archived' ? 'active' : 'archived';
    setBusy(v.id);
    try {
      await setVendorStatus(orgId, v.id, next);
      toast('success', next === 'archived' ? `${v.name} archived — it is no longer offered on new claims.` : `${v.name} restored.`);
      void bumpVendors(qc);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Vendors" sub={`Totals are computed from the claims made against each vendor in ${company?.name ?? 'this company'}, not entered.`}>
        {mayWrite ? (
          <button type="button" className={btnPrimary} onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> New vendor
          </button>
        ) : null}
      </PageHead>
      {rows.length ? (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {rows.map((v) => (
              <VendorCard key={v.id} v={v} mayWrite={mayWrite} busy={busy === v.id} onArchive={() => void archive(v)} onDelete={() => setDeleting(v)} />
            ))}
          </div>
          {/* The server adds each claim's amount as recorded, so a vendor paid in two currencies shows one mixed figure — said, rather than labelled with a currency it is not in. */}
          <p className="m-0 text-[12px] text-ink-3">Each figure adds the claims’ amounts as they were recorded, in whatever currency each was filed in.</p>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-[12px] border border-dashed border-line bg-surface px-4 py-9 text-center text-[13px] text-ink-3">
          No vendors yet.
          {mayWrite ? (
            <button type="button" className={btn} onClick={() => setAdding(true)}>
              Add the first one
            </button>
          ) : null}
        </div>
      )}
      {adding ? <NewVendor orgId={orgId} onClose={() => setAdding(false)} /> : null}
      {deleting ? <DeleteVendor orgId={orgId} v={deleting} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}

function VendorCard({ v, mayWrite, busy, onArchive, onDelete }: { v: Vendor; mayWrite: boolean; busy: boolean; onArchive: () => void; onDelete: () => void }) {
  const archived = v.status === 'archived';
  const contact = [v.contact_person, v.email, v.phone].filter(Boolean).join(' · ');
  return (
    <section className={cx('flex flex-col rounded-[12px] border border-line bg-surface px-4 py-3.5', archived && 'opacity-60')} aria-label={v.name}>
      <div className="flex items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <b className="truncate text-[14px] text-ink">{v.name}</b>
            {archived ? <Pill tone="grey">Archived</Pill> : null}
          </span>
          <span className="truncate text-[12px] text-ink-3">{contact || 'No contact details'}</span>
          {v.tax_number ? <span className="text-[12px] text-ink-3">Tax: {v.tax_number}</span> : null}
        </span>
        {mayWrite ? (
          <span className="flex shrink-0 gap-1.5">
            <button type="button" className={btnSmall} disabled={busy} onClick={onArchive}>
              {archived ? 'Restore' : 'Archive'}
            </button>
            <button type="button" className={cx(btnSmall, 'text-danger')} disabled={busy} onClick={onDelete}>
              Delete
            </button>
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line/70 pt-3 text-center">
        <Figure value={money(v.total_purchases)} label="purchases" />
        <Figure value={money(v.total_paid)} label="paid" tone="green" />
        <Figure value={String(v.claim_count)} label={v.claim_count === 1 ? 'claim' : 'claims'} />
      </div>
      {v.last_transaction ? <span className="mt-1.5 text-center text-[11.5px] text-ink-3">Last transaction {shortDate(v.last_transaction)}</span> : null}
    </section>
  );
}

function Figure({ value, label, tone }: { value: string; label: string; tone?: 'green' }) {
  return (
    <span className="flex min-w-0 flex-col">
      <b className={cx('truncate text-[14px] tabular-nums', tone === 'green' ? 'text-[#166534] dark:text-success' : 'text-ink')}>{value}</b>
      <span className="text-[11px] text-ink-3">{label}</span>
    </span>
  );
}

const FIELDS: Array<{ key: string; label: string; hint?: string; type?: string }> = [
  { key: 'name', label: 'Vendor name' },
  { key: 'contact_person', label: 'Contact person' },
  { key: 'email', label: 'Email', type: 'email', hint: 'A valid address, or leave it blank.' },
  { key: 'phone', label: 'Phone' },
  { key: 'tax_number', label: 'Tax number' },
  { key: 'bank_details', label: 'Bank details' },
];

function NewVendor({ orgId, onClose }: { orgId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const name = (form.name ?? '').trim();

  const save = async () => {
    setBusy(true);
    setSaid([]);
    try {
      const body: Record<string, string> = {};
      for (const f of FIELDS) if ((form[f.key] ?? '').trim()) body[f.key] = form[f.key]!.trim();
      await createVendor(orgId, body);
      toast('success', `${name} added.`);
      void bumpVendors(qc);
      onClose();
    } catch (e) {
      // The form stays open with the server's sentence under it: a duplicate name or a bad email is fixed here, not retyped.
      setSaid(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="New vendor"
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !name} onClick={() => void save()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      {FIELDS.map((f, i) => (
        <Field key={f.key} label={f.key === 'name' ? f.label : <span>{f.label} <span className="font-medium text-ink-3">— optional</span></span>} hint={f.hint}>
          <input autoFocus={i === 0} type={f.type ?? 'text'} value={form[f.key] ?? ''} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} className={input} />
        </Field>
      ))}
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

function DeleteVendor({ orgId, v, onClose }: { orgId: number; v: Vendor; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const yes = async () => {
    setBusy(true);
    setSaid(null);
    try {
      await deleteVendor(orgId, v.id);
      toast('success', `${v.name} deleted.`);
      void bumpVendors(qc);
      onClose();
    } catch (e) {
      // "3 claim(s) reference this vendor. Archive it instead…" — the server's sentence, where the person is looking.
      setSaid(refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmSheet
      title={`Delete ${v.name}?`}
      body={
        <div className="flex flex-col gap-2.5">
          <span>Only possible if no claims reference it{v.claim_count ? ` — this company alone has ${v.claim_count}, so archive it instead to keep the history readable` : ''}. There is no undo.</span>
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
