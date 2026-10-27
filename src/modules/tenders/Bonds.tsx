import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { dayWords, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Sheet } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { K, money, type DocAccess } from './api';
import { AttachMenu, Uploading, useTenderUploads } from './files';
import { addSecurity, daysTo, deleteSecurity, fetchSecurities, INSTRUMENTS, K2, labelOf, SECURITY_KINDS, SECURITY_STATUSES, securityBody, securityDraft, securityLive, updateSecurity, type Security, type SecurityDraft } from './work';

/**
 * Bid securities and guarantees — one list, because a bid security and the
 * performance guarantee that replaces it after a win are the same instrument
 * at different points of the bid. What this is for is the expiry: money is
 * tied up until a bond comes back, and one that lapses before the award is
 * decided disqualifies the bid. So the list runs soonest to lapse first and
 * anything inside thirty days is called out.
 */
const cents = (v: string | null) => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(v ?? '');
  return m ? BigInt(m[1]!) * 100n + BigInt(((m[2] ?? '') + '00').slice(0, 2)) : 0n;
};

/** What is still tied up, per currency, added in cents rather than floats. */
export function tiedUp(list: Security[], fallback: string): Array<{ currency: string; total: string }> {
  const by = new Map<string, bigint>();
  for (const s of list) if (securityLive(s) && s.amount) by.set(s.currency ?? fallback, (by.get(s.currency ?? fallback) ?? 0n) + cents(s.amount));
  return [...by].map(([currency, c]) => ({ currency, total: `${c / 100n}.${String(c % 100n).padStart(2, '0')}` }));
}

export default function Bonds({ id, currency, canManage, can }: { id: number; currency: string; canManage: boolean; can: DocAccess }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K2.securities(id), queryFn: ({ signal }) => fetchSecurities(id, signal) });
  const [editing, setEditing] = useState<Security | 'new' | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K2.securities(id) });
    void qc.invalidateQueries({ queryKey: K.all });
  };
  const uploads = useTenderUploads(id, refresh);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const today = todayInZone();
  // Soonest to lapse first; no expiry last.
  const list = [...q.data].sort((a, b) => ((a.valid_until ?? '9999') < (b.valid_until ?? '9999') ? -1 : (a.valid_until ?? '9999') > (b.valid_until ?? '9999') ? 1 : b.id - a.id));
  const held = tiedUp(list, currency);
  const remove = async (s: Security) => {
    try {
      await deleteSecurity(s.id);
      toast('success', 'Removed.');
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11.5px] text-ink-3">Tied up until it comes back</span>
          <b className="text-[15px] text-ink tabular-nums">{held.length ? held.map((h) => money(h.total, h.currency)).join(' · ') : '—'}</b>
        </span>
        {canManage ? (
          <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
            <Icon name="plus" size={15} /> Record a bond
          </button>
        ) : null}
      </div>
      <Uploading live={uploads.live} />
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface" aria-label="Bonds and guarantees">
        {list.length ? (
          list.map((s) => {
            const days = daysTo(s.valid_until, today);
            const live = securityLive(s);
            const warn = live && days !== null && days <= 30;
            return (
              <div key={s.id} data-security={s.id} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2.5 text-[12.5px] last:border-b-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <b className="text-[13px] text-ink">{labelOf(SECURITY_KINDS, s.kind)}</b>
                    <Pill tone={s.status === 'returned' ? 'green' : s.status === 'forfeited' || s.status === 'expired' ? 'red' : s.status === 'draft' ? 'grey' : 'blue'}>{labelOf(SECURITY_STATUSES, s.status)}</Pill>
                    {s.file_id ? <Pill tone="green">Copy on file</Pill> : null}
                  </span>
                  <span className="truncate text-[11.5px] text-ink-3">
                    {[labelOf(INSTRUMENTS, s.instrument), s.issued_by, s.reference ? `ref ${s.reference}` : null, s.returned_on ? `returned ${dayWords(s.returned_on, { year: true })}` : null].filter((x) => x && x !== '—').join(' · ')}
                  </span>
                  {s.note ? <span className="text-[12px] text-ink-2">{s.note}</span> : null}
                </span>
                <b className="w-[150px] shrink-0 text-right text-ink tabular-nums">{money(s.amount, s.currency)}</b>
                <span className={cx('flex w-[130px] shrink-0 flex-col items-end text-[12px]', warn ? (days! < 0 ? 'text-danger' : days! <= 7 ? 'font-bold text-danger' : 'font-semibold text-warning-ink dark:text-warning') : 'text-ink-2')}>
                  {s.valid_until ? <span>Until {dayWords(s.valid_until, { year: true })}</span> : <span className="text-ink-3">No expiry recorded</span>}
                  {live && days !== null ? <span>{days < 0 ? `lapsed ${-days} ${days === -1 ? 'day' : 'days'} ago` : days === 0 ? 'lapses today' : `${days} ${days === 1 ? 'day' : 'days'} left`}</span> : null}
                </span>
                {canManage ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    {can.upload ? (
                      <AttachMenu small label={s.file_id ? 'New copy' : 'Copy'} onComputer={() => void uploads.pick({ into: 'security', id: s.id }, 'The bond’s copy')} onDrive={async (files) => void (await fileFromDrive(s.id, files[0], refresh))} />
                    ) : null}
                    <button type="button" aria-label="Edit the bond" title="Edit" className={btnSmall + ' !h-7 !w-7 justify-center !px-0'} onClick={() => setEditing(s)}>
                      <Icon name="compose" size={13} />
                    </button>
                    <button type="button" aria-label="Remove the bond" title="Remove" className={btnSmall + ' !h-7 !w-7 justify-center !px-0 !text-danger'} onClick={() => void remove(s)}>
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })
        ) : (
          <Empty text="No bonds or guarantees recorded." />
        )}
      </div>
      {editing ? <BondSheet tenderId={id} bond={editing === 'new' ? null : editing} currency={currency} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
    </div>
  );
}

async function fileFromDrive(sid: number, f: { id: number | string } | undefined, refresh: () => void) {
  if (!f) return;
  try {
    await updateSecurity(sid, { file_id: String(f.id) });
    toast('success', 'The copy is on file.');
  } catch (e) {
    toast('error', errorMessage(e));
  } finally {
    refresh();
  }
}

function BondSheet({ tenderId, bond, currency, onClose, onSaved }: { tenderId: number; bond: Security | null; currency: string; onClose: () => void; onSaved: () => void }) {
  const before = bond ? securityDraft(bond, currency) : null;
  const [d, setD] = useState<SecurityDraft>(() => securityDraft(bond, currency));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const out = securityBody(d, before);
  const nothing = !!before && !!out.body && !Object.keys(out.body).length;
  const save = async () => {
    if (!out.body) return setError(out.error);
    setBusy(true);
    setError(null);
    try {
      if (bond) await updateSecurity(bond.id, out.body);
      else await addSecurity(tenderId, out.body);
      toast('success', bond ? 'Saved.' : 'Bond recorded.');
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof SecurityDraft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const pick = (k: keyof SecurityDraft, list: Array<[string, string]>, label: string) => (
    <Field label={label}>
      <Select<string> aria-label={label} value={d[k]} onValueChange={(v) => setD({ ...d, [k]: v })} options={list.map(([value, l]) => ({ value, label: l }))} className={input} />
    </Field>
  );
  return (
    <Sheet
      title={bond ? 'Edit the bond' : 'Record a bond'}
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || nothing} onClick={() => void save()}>
            {busy ? 'Saving…' : bond ? 'Save' : 'Record'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        {pick('kind', SECURITY_KINDS, 'What kind')}
        {pick('instrument', INSTRUMENTS, 'Instrument')}
        <Field label="Amount">
          <input aria-label="Amount" inputMode="decimal" value={d.amount} onChange={set('amount')} placeholder="e.g. 250000" className={input} />
        </Field>
        <Field label="Currency">
          <input aria-label="Currency" value={d.currency} onChange={(e) => setD({ ...d, currency: e.target.value.toUpperCase().slice(0, 3) })} className={input} />
        </Field>
        <Field label="Issued by">
          <input aria-label="Issued by" value={d.issued_by} onChange={set('issued_by')} maxLength={200} placeholder="The bank or insurer" className={input} />
        </Field>
        <Field label="Reference">
          <input aria-label="Reference" value={d.reference} onChange={set('reference')} maxLength={200} className={input} />
        </Field>
        <Field label="Issued on">
          <input type="date" aria-label="Issued on" value={d.issued_on} onChange={set('issued_on')} className={input} />
        </Field>
        <Field label="Valid until" hint="What the reminders run from.">
          <input type="date" aria-label="Valid until" value={d.valid_until} onChange={set('valid_until')} className={input} />
        </Field>
        {pick('status', SECURITY_STATUSES, 'Where it is')}
        <Field label="Returned on">
          <input type="date" aria-label="Returned on" value={d.returned_on} onChange={set('returned_on')} className={input} />
        </Field>
      </div>
      <Field label="Note">
        <input aria-label="Note" value={d.note} onChange={set('note')} maxLength={500} className={input} />
      </Field>
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}
