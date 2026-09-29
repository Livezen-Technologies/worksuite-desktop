import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useCanOpen } from '../../core/access';
import { openWebLink } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Cell, Field, Grid, input, PageHead, Panel, row, Sheet, THead } from '../hr/parts';
import { amount, companiesWhere, createCustomer, fetchCustomer, fetchCustomers, K, OFFLINE_WRITE, refusalOf, useMayAddCustomer, vehicleLine, type Job, type Options, type Refusal } from './api';
import { OfflineBanner, StatusPill, when } from './parts';

/**
 * Customers (SRS §11.1, FR-CUS-01/02): the garage's view of CRM accounts —
 * there is no garage customer of its own. A search, the garage's figures per
 * customer (vehicles, open jobs), and one customer with their vehicles, open
 * jobs, service history and — for those who may see money — what they owe.
 * Identity is edited in CRM; a new customer is added through CRM's own rules.
 */
export default function Customers({ org, options, online, open, onOpen, onBack, onJob, onVehicle }: { org: string; options: Options; online: boolean; open: number | null; onOpen: (id: number) => void; onBack: () => void; onJob: (id: number) => void; onVehicle: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const mayAdd = useMayAddCustomer() && (companiesWhere(options, 'create', org).length > 0 || companiesWhere(options, 'manage_vehicles', org).length > 0);
  const list = useQuery({ queryKey: K.customers(org, q.trim()), queryFn: ({ signal }) => fetchCustomers(org, q.trim(), signal), placeholderData: (p) => p, enabled: !open });

  if (open) return <CustomerDetail id={open} options={options} onBack={onBack} onJob={onJob} onVehicle={onVehicle} />;
  const rows = list.data?.data.items ?? [];

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Customers" sub="From CRM, with what the garage knows of each">
        <label className="flex h-[34px] w-[260px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-primary">
          <Icon name="search" size={14} className="text-ink-3" />
          <input data-garage-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, email, contact" aria-label="Search customers" className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
        </label>
        {mayAdd ? (
          <button type="button" className={btnPrimary} disabled={!online} onClick={() => setAdding(true)}>
            <Icon name="user-plus" size={15} /> New customer
          </button>
        ) : null}
      </PageHead>
      {list.data?.offline ? <OfflineBanner cachedAt={list.data.cachedAt} /> : null}
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data ? (
        <section className="overflow-hidden rounded-[12px] border border-line bg-surface" aria-label="Customers">
          <THead cols={[['Customer', null], ['Phone', 150], ['Email', 220], ['Vehicles', 80], ['Open jobs', 90]]} />
          {rows.map((c) => (
            <button key={c.id} type="button" onClick={() => onOpen(c.id)} className={cx(row, 'w-full text-left hover:bg-subtle')}>
              <Cell w={null}>
                <b>{c.name}</b>
                {c.contact_person ? <span className="text-ink-3"> · {c.contact_person}</span> : null}
              </Cell>
              <Cell w={150} className="text-ink-2">
                {c.phone ?? '—'}
              </Cell>
              <Cell w={220} className="text-ink-2">
                {c.email ?? '—'}
              </Cell>
              <Cell w={80} className="tabular-nums">
                {c.vehicles}
              </Cell>
              <Cell w={90} className="tabular-nums">
                {c.open_jobs}
              </Cell>
            </button>
          ))}
          {!rows.length ? <div className="px-3.5 py-8 text-center text-[12.5px] text-ink-3">{q.trim() ? 'No customer matches.' : 'No customers yet.'}</div> : null}
        </section>
      ) : null}
      {adding ? (
        <NewCustomer
          org={org}
          options={options}
          online={online}
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            onOpen(id);
          }}
        />
      ) : null}
    </div>
  );
}

function CustomerDetail({ id, options, onBack, onJob, onVehicle }: { id: number; options: Options; onBack: () => void; onJob: (id: number) => void; onVehicle: (id: number) => void }) {
  const q = useQuery({ queryKey: K.customer(id), queryFn: ({ signal }) => fetchCustomer(id, signal), refetchOnMount: 'always' });
  const crm = useCanOpen('crm');
  if (q.isLoading) return <Spinner />;
  const back = (
    <button type="button" onClick={onBack} className="flex items-center gap-1 self-start text-[12.5px] font-semibold text-ink-2 hover:text-ink">
      <Icon name="chevron-left" size={15} /> Customers
    </button>
  );
  if (q.error || !q.data)
    return (
      <div className="flex flex-col gap-3 px-6 py-5">
        {back}
        <ErrorNote error={q.error ?? new Error('This customer could not be read.')} onRetry={() => void q.refetch()} />
      </div>
    );
  const { customer: c, vehicles, open_jobs, history, balance } = q.data;
  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      {back}
      <PageHead title={c.name} sub={[c.account_type, c.contact_person].filter(Boolean).join(' · ') || 'CRM account'}>
        {crm && c.crm_link ? (
          <button type="button" className={btn} onClick={() => openWebLink(c.crm_link)}>
            <Icon name="users" size={15} /> Edit in CRM
          </button>
        ) : null}
      </PageHead>
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Details" sub="Kept in CRM">
          <div className="px-3.5 py-2">
            <Grid
              rows={[
                ['Phone', c.phone],
                ['Email', c.email],
                ['WhatsApp', c.whatsapp ?? 'Not kept by CRM'],
                ['Preferred contact', c.preferred_contact ?? 'Not kept by CRM'],
                ['Address', c.address],
                ['Tax number', c.tax_number],
              ]}
            />
          </div>
        </Panel>
        <Panel title="Vehicles" sub={`${vehicles.length}`}>
          {vehicles.map((v) => (
            <button key={v.id} type="button" onClick={() => onVehicle(v.id)} className="flex w-full items-center gap-2.5 border-b border-line/70 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
              <Icon name="car" size={15} className="text-ink-3" />
              <b className="text-ink">{v.vehicle_number}</b>
              <span className="min-w-0 flex-1 truncate text-ink-2">{[v.make, v.model, v.year].filter(Boolean).join(' ')}</span>
            </button>
          ))}
          {!vehicles.length ? <div className="px-3.5 py-4 text-[12.5px] text-ink-3">No vehicles recorded.</div> : null}
        </Panel>
        {balance ? (
          <Panel title="What they owe" sub="From Billing">
            <div className="grid grid-cols-2 gap-3 px-3.5 py-3 text-[12.5px]">
              <div className="flex flex-col">
                <span className="text-ink-3">Outstanding</span>
                <b className="text-[16px] text-ink tabular-nums">{amount(balance.outstanding.toFixed(2), balance.currency)}</b>
              </div>
              <div className="flex flex-col">
                <span className="text-ink-3">Overdue</span>
                <b className={cx('text-[16px] tabular-nums', balance.overdue > 0 ? 'text-danger' : 'text-ink')}>{amount(balance.overdue.toFixed(2), balance.currency)}</b>
              </div>
            </div>
          </Panel>
        ) : null}
        <JobList title="Open jobs" jobs={open_jobs} options={options} onJob={onJob} empty="No job open." />
        <JobList title="Service history" jobs={history} options={options} onJob={onJob} empty="No completed job yet." />
      </div>
    </div>
  );
}

function JobList({ title, jobs, options, onJob, empty }: { title: string; jobs: Job[]; options: Options; onJob: (id: number) => void; empty: string }) {
  return (
    <Panel title={title} sub={`${jobs.length}`} bodyClassName="max-h-[320px]">
      {jobs.map((j) => (
        <button key={j.id} type="button" onClick={() => onJob(j.id)} className="flex w-full items-center gap-2.5 border-b border-line/70 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
          <b className="w-[120px] shrink-0 text-ink tabular-nums">{j.number}</b>
          <span className="min-w-0 flex-1 truncate text-ink-2">{vehicleLine(j.vehicle)}</span>
          <StatusPill status={j.status} label={options.statuses[j.status] ?? j.status_label} />
          <span className="w-[110px] shrink-0 text-right text-ink-3">{when(j.completed_at ?? j.target_completion_at)}</span>
        </button>
      ))}
      {!jobs.length ? <div className="px-3.5 py-4 text-[12.5px] text-ink-3">{empty}</div> : null}
    </Panel>
  );
}

/** A new customer, added to CRM through its own rules (FR-CUS-01). A name CRM already has is refused and named. */
export function NewCustomer({ org, options, online, onClose, onAdded }: { org: string; options: Options; online: boolean; onClose: () => void; onAdded: (id: number) => void }) {
  const qc = useQueryClient();
  const companies = [...new Map([...companiesWhere(options, 'create', org), ...companiesWhere(options, 'manage_vehicles', org)].map((c) => [c.id, c])).values()];
  const [company, setCompany] = useState(companies.length === 1 ? String(companies[0]!.id) : '');
  const [f, setF] = useState({ name: '', phone: '', email: '', contact_person: '', billing_street: '', billing_city: '', billing_country: '' });
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Refusal | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!online) return toast('error', OFFLINE_WRITE);
    setBusy(true);
    setRefused(null);
    try {
      const body = Object.fromEntries(Object.entries({ ...f, org_id: Number(company) }).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]));
      const r = await createCustomer(body);
      toast('success', r.message || `${r.data.customer.name} added to CRM.`);
      void qc.invalidateQueries({ queryKey: K.all });
      onAdded(r.data.customer.id);
    } catch (e) {
      setRefused(refusalOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="New customer"
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !online || !f.name.trim() || !company} onClick={() => void save()}>
            Add to CRM
          </button>
        </>
      }
    >
      {companies.length > 1 ? (
        <Field label="Company">
          <Select aria-label="Company" value={company} onValueChange={setCompany} options={[{ value: '', label: 'Which company?' }, ...companies.map((c) => ({ value: String(c.id), label: c.name }))]} />
        </Field>
      ) : null}
      <Field label="Name">
        <input autoFocus aria-label="Name" value={f.name} onChange={set('name')} className={cx(input, refused?.field === 'name' && 'border-danger')} maxLength={190} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Phone">
          <input aria-label="Phone" value={f.phone} onChange={set('phone')} className={input} maxLength={40} />
        </Field>
        <Field label="Email">
          <input aria-label="Email" type="email" value={f.email} onChange={set('email')} className={cx(input, refused?.field === 'email' && 'border-danger')} maxLength={190} />
        </Field>
        <Field label="Contact person">
          <input aria-label="Contact person" value={f.contact_person} onChange={set('contact_person')} className={input} maxLength={190} />
        </Field>
        <Field label="Street">
          <input aria-label="Street" value={f.billing_street} onChange={set('billing_street')} className={input} maxLength={255} />
        </Field>
        <Field label="City">
          <input aria-label="City" value={f.billing_city} onChange={set('billing_city')} className={input} maxLength={120} />
        </Field>
        <Field label="Country">
          <input aria-label="Country" value={f.billing_country} onChange={set('billing_country')} className={input} maxLength={120} />
        </Field>
      </div>
      {refused ? (
        <div role="alert" className="rounded-[9px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
          <b>{refused.message}</b>
          {refused.existing ? (
            <span>
              {' '}
              Already in CRM: {refused.existing.name}
              {refused.existing.phone ? ` · ${refused.existing.phone}` : ''}.{' '}
              <button type="button" className="font-semibold underline" onClick={() => onAdded(refused.existing!.id)}>
                Open it
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
