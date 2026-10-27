import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { Spinner } from '../../components/ui';
import { btn, btnPrimary, Field, input, Seg, Sheet } from '../../components/PageKit';
import { createBody, createTender, draftOf, editChanges, fetchTender, importCsv, K, PRIORITIES, updateTender, useOwners, type Company, type Draft, type ImportResult } from './api';

/**
 * A new tender — one typed in, or a pasted list checked before anything is
 * kept — or an edit of one, which sends only what changed. A tender belongs
 * to one company: the picker's, or the one chosen here when the picker is on
 * every company.
 */
export default function TenderSheet({ id, org, companies, onClose, onSaved }: { id: number | null; org: string; companies: Company[]; onClose: () => void; onSaved: (id: number) => void }) {
  const existing = useQuery({ queryKey: K.tender(id ?? 0), queryFn: ({ signal }) => fetchTender(id!, signal), enabled: id !== null });
  if (id !== null && !existing.data)
    return (
      <Sheet title="Edit tender" onClose={onClose} footer={null}>
        {existing.error ? <p className="m-0 text-[13px] text-danger">{errorMessage(existing.error)}</p> : <Spinner />}
      </Sheet>
    );
  return id !== null ? (
    <EditForm key={id} id={id} before={draftOf(existing.data!.tender)} org={String(existing.data!.tender.org_id ?? '')} onClose={onClose} onSaved={onSaved} />
  ) : (
    <NewForm org={org} companies={companies} onClose={onClose} onSaved={onSaved} />
  );
}

function NewForm({ org, companies, onClose, onSaved }: { org: string; companies: Company[]; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'one' | 'csv'>('one');
  const [d, setD] = useState<Draft>(() => draftOf(null));
  const [company, setCompany] = useState(org || (companies.length === 1 ? String(companies[0]!.id) : ''));
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsCompany = !org && companies.length > 1;
  const orgId = company ? Number(company) : null;

  const create = async () => {
    const { body, error: e } = createBody(d, orgId);
    if (!body) return setError(e);
    if (needsCompany && !orgId) return setError('Choose the company this tender is for.');
    setBusy(true);
    setError(null);
    try {
      const r = await createTender(body);
      toast('success', 'Tender created.');
      void qc.invalidateQueries({ queryKey: K.all });
      onSaved(Number(r.id));
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };
  const load = async (confirm: boolean) => {
    if (needsCompany && !orgId) return setError('Choose the company these tenders are for.');
    setBusy(true);
    setError(null);
    try {
      const r = await importCsv(csv, confirm, orgId);
      setPreview(r);
      if (confirm) {
        toast('success', `${r.imported.length} ${r.imported.length === 1 ? 'tender' : 'tenders'} imported.`);
        void qc.invalidateQueries({ queryKey: K.all });
      }
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  return (
    <Sheet
      title="New tender"
      width={560}
      onClose={onClose}
      footer={
        mode === 'one' ? (
          <>
            <button type="button" className={btn} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} disabled={busy || !d.title.trim()} onClick={() => void create()}>
              {busy ? 'Creating…' : 'Create'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={btn} onClick={onClose}>
              {preview && !preview.dry_run ? 'Done' : 'Cancel'}
            </button>
            <button type="button" className={btn} disabled={busy || !csv.trim()} onClick={() => void load(false)}>
              Check first
            </button>
            <button type="button" className={btnPrimary} disabled={busy || !preview?.dry_run || preview.imported.length === 0} onClick={() => void load(true)}>
              {busy ? 'Working…' : preview?.dry_run && preview.imported.length ? `Import ${preview.imported.length}` : 'Import'}
            </button>
          </>
        )
      }
    >
      <Seg
        label="How"
        value={mode}
        onChange={(m) => (setMode(m), setError(null))}
        options={[
          { id: 'one', label: 'One tender' },
          { id: 'csv', label: 'Paste a list' },
        ]}
      />
      {needsCompany ? (
        <Field label="Company" hint="You are looking at every company; a tender belongs to one of them.">
          <Select<string>
            aria-label="Company"
            value={company}
            onValueChange={(v) => (setCompany(v), setPreview(null))}
            options={[{ value: '', label: 'Choose a company' }, ...companies.map((c) => ({ value: String(c.id), label: c.name, hint: c.currency ?? undefined }))]}
            className={input}
          />
        </Field>
      ) : null}
      {mode === 'one' ? (
        <>
          <Field label="Title">
            <input aria-label="Title" autoFocus value={d.title} onChange={set('title')} maxLength={250} className={input} />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Buyer">
              <input aria-label="Buyer" value={d.organization} onChange={set('organization')} className={input} />
            </Field>
            <Field label="Tender number">
              <input aria-label="Tender number" value={d.reference} onChange={set('reference')} className={input} />
            </Field>
            <Closing d={d} setD={setD} />
            <Field label="Published budget ceiling">
              <input aria-label="Published budget ceiling" inputMode="decimal" value={d.budget_max} onChange={set('budget_max')} placeholder="e.g. 4500000" className={input} />
            </Field>
            <Field label="Industry">
              <input aria-label="Industry" value={d.industry} onChange={set('industry')} className={input} />
            </Field>
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-[12.5px] text-ink-2">
            Paste rows with a header line. Columns named <code>title</code>, <code>organization</code>, <code>closing_at</code>, <code>reference</code> and <code>budget_max</code> are read on their own. Nothing is kept until you import after
            checking.
          </p>
          <textarea
            aria-label="CSV"
            value={csv}
            onChange={(e) => (setCsv(e.target.value), setPreview(null))}
            rows={8}
            placeholder={'title,organization,closing_at\nSupply of laptops,Ministry of Education,2026-10-01'}
            className="w-full resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 font-mono text-[12px] text-ink outline-none focus:border-primary"
          />
          {preview ? (
            <div className="flex flex-col gap-1 rounded-[9px] bg-subtle px-3 py-2 text-[12.5px]" aria-label="Import check">
              <b className="text-ink">
                {preview.seen} {preview.seen === 1 ? 'row' : 'rows'} read
              </b>
              <span className="text-ink-2">
                {preview.imported.length} {preview.dry_run ? 'would be imported' : 'imported'} · {preview.duplicates.length} already here · {preview.rejected.length} could not be read
              </span>
              {[...preview.duplicates, ...preview.rejected].slice(0, 4).map((x, i) => (
                <span key={i} className="text-[12px] text-warning-ink dark:text-warning">
                  Row {x.row}: {x.why}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}

function Closing({ d, setD }: { d: Draft; setD: (d: Draft) => void }) {
  return (
    <Field label="Closing" hint={d.date && !d.time ? 'A day alone closes at the end of it.' : undefined}>
      <span className="flex gap-1.5">
        <input type="date" aria-label="Closing date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value, ...(e.target.value ? {} : { time: '' }) })} className={input} />
        <input type="time" aria-label="Closing time" disabled={!d.date} value={d.time} onChange={(e) => setD({ ...d, time: e.target.value })} className={input + ' !w-[110px]'} />
      </span>
    </Field>
  );
}

function EditForm({ id, before, org, onClose, onSaved }: { id: number; before: Draft; org: string; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(before);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owners = useOwners(org);
  const changes = editChanges(before, d);
  const count = Object.keys(changes).length;
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  const save = async () => {
    if (!d.title.trim()) return setError('A tender needs a title.');
    if (!count) return onClose();
    setBusy(true);
    setError(null);
    try {
      await updateTender(id, changes);
      toast('success', 'Saved.');
      void qc.invalidateQueries({ queryKey: K.all });
      onSaved(id);
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Edit tender"
      width={620}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !count} onClick={() => void save()}>
            {busy ? 'Saving…' : count ? `Save ${count} ${count === 1 ? 'change' : 'changes'}` : 'Nothing changed'}
          </button>
        </>
      }
    >
      <Field label="Title">
        <input aria-label="Title" value={d.title} onChange={set('title')} maxLength={250} className={input} />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Buyer">
          <input aria-label="Buyer" value={d.organization} onChange={set('organization')} className={input} />
        </Field>
        <Field label="Tender number">
          <input aria-label="Tender number" value={d.reference} onChange={set('reference')} className={input} />
        </Field>
        <Closing d={d} setD={setD} />
        <Field label="Owner" hint="Gets the closing reminders.">
          <Select<string>
            aria-label="Owner"
            searchable
            value={d.owner}
            onValueChange={(v) => setD({ ...d, owner: v })}
            options={[{ value: '', label: 'Nobody yet' }, ...(owners.data ?? []).filter((o) => o.holds || String(o.id) === d.owner).map((o) => ({ value: String(o.id), label: o.name }))]}
            className={input}
          />
        </Field>
        <Field label="Budget, low">
          <input aria-label="Budget, low" inputMode="decimal" value={d.budget_min} onChange={set('budget_min')} className={input} />
        </Field>
        <Field label="Budget, high (published ceiling)">
          <input aria-label="Budget, high" inputMode="decimal" value={d.budget_max} onChange={set('budget_max')} className={input} />
        </Field>
        <Field label="Our bid">
          <input aria-label="Our bid" inputMode="decimal" value={d.bid_value} onChange={set('bid_value')} className={input} />
        </Field>
        <Field label="Currency" hint="Three letters, such as LKR or USD.">
          <input aria-label="Currency" value={d.currency} onChange={(e) => setD({ ...d, currency: e.target.value.toUpperCase().slice(0, 3) })} className={input} />
        </Field>
        <Field label="Priority">
          <Select<string> aria-label="Priority" value={d.priority} onValueChange={(v) => setD({ ...d, priority: v })} options={PRIORITIES.map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) }))} className={input} />
        </Field>
        <Field label="Sector">
          <Select<string>
            aria-label="Sector"
            value={d.sector}
            onValueChange={(v) => setD({ ...d, sector: v })}
            options={[
              { value: 'government', label: 'Government' },
              { value: 'private', label: 'Private' },
              { value: 'ngo', label: 'NGO' },
              { value: 'other', label: 'Other' },
            ]}
            className={input}
          />
        </Field>
        <Field label="Category">
          <input aria-label="Category" value={d.category} onChange={set('category')} className={input} />
        </Field>
        <Field label="Industry">
          <input aria-label="Industry" value={d.industry} onChange={set('industry')} className={input} />
        </Field>
        <Field label="Country">
          <input aria-label="Country" value={d.country} onChange={set('country')} className={input} />
        </Field>
        <Field label="The buyer's page">
          <input aria-label="The buyer's page" value={d.external_url} onChange={set('external_url')} placeholder="https://" className={input} />
        </Field>
      </div>
      <Field label="Description">
        <textarea aria-label="Description" value={d.description} onChange={set('description')} rows={4} className="w-full resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary" />
      </Field>
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}
