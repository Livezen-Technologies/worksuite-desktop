import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, IconButton, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { PageHead } from '../hr/parts';
import { errorText, gGet, gPost, K, money, nice, when, type CustomerRow, type CustomerView, type Vehicle360, type VehicleJob } from './api';
import { Ask, input, Section, StatusPill, useGarage } from './parts';
import { NewCustomer } from './WalkIn';
import { clickOnKey } from '../../components/press';

/**
 * Customers (FR-CUS-01..04): CRM's clients who have a vehicle or a job in
 * this company. Who they are is CRM's; Garage adds how they like to be
 * reached, their vehicles, what they owe (for people who may see money),
 * their credit terms with the garage, and their service history across all
 * their vehicles (FR-HIS-02).
 */
export default function Customers({ open: asked }: { open: number | null }) {
  const g = useGarage();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [text]);
  const list = useQuery({
    queryKey: K.customers(g.org, { q, page }),
    queryFn: ({ signal }) => gGet<{ total: number; page: number; per_page: number; customers: CustomerRow[] }>('/customers', { q, page, org: g.org }, signal),
    placeholderData: keepPreviousData,
  });
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / Math.max(1, d.per_page))) : 1;
  const open = picked ?? asked;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-5 scroll-thin">
        <PageHead title="Customers" sub={d ? `${d.total} with vehicles or jobs here` : undefined}>
          <label className="relative block">
            <span className="sr-only">Search customers</span>
            <Icon name="search" size={15} className="pointer-events-none absolute top-2.5 left-2.5 text-ink-3" />
            <input className={cx(input, 'w-64 pl-8')} placeholder="Name, phone or email" value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          {g.may('garage.job.create') ? (
            <Button variant="primary" icon="user-plus" disabled={!g.online} onClick={() => setAdding(true)}>
              Add customer
            </Button>
          ) : null}
        </PageHead>
        {list.isLoading ? (
          <Spinner />
        ) : list.error || !d ? (
          <ErrorNote error={list.error ?? new Error('The customers could not be loaded.')} onRetry={() => void list.refetch()} />
        ) : d.customers.length === 0 ? (
          <p className="text-[13px] text-ink-3">No customers here. Customers appear once they have a vehicle or a job.</p>
        ) : (
          <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-subtle text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2 text-right">Vehicles</th>
                  <th className="px-3 py-2 text-right">Open jobs</th>
                </tr>
              </thead>
              <tbody>
                {d.customers.map((c) => (
                  <tr tabIndex={0} onKeyDown={clickOnKey} key={c.id} className={cx('cursor-pointer border-t border-line hover:bg-subtle', open === c.id && 'bg-selection')} onClick={() => setPicked(c.id)}>
                    <td className="px-3 py-2">
                      <button type="button" className="font-semibold text-ink" onClick={() => setPicked(c.id)}>
                        {c.name}
                      </button>
                    </td>
                    <td className="px-3 py-2">{c.phone ?? '—'}</td>
                    <td className="px-3 py-2">{c.email ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.vehicles}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.open_jobs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 ? (
          <div className="flex items-center justify-end gap-2 text-[12.5px] text-ink-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span className="tabular-nums">
              {page} of {pages}
            </span>
            <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        ) : null}
      </div>
      {open ? <CustomerPanel key={open} id={open} onClose={() => (picked ? setPicked(null) : g.go('customers'))} /> : null}
      {adding ? (
        <NewCustomer
          seed={text}
          onClose={() => setAdding(false)}
          onPicked={(c) => {
            setAdding(false);
            setPicked(c.id);
            void list.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

const CHANNELS = [
  { value: '', label: 'Not said' },
  { value: 'phone', label: 'Phone' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
];

type Dialog = 'prefs' | 'credit' | null;

/** One customer, the garage's view (FR-CUS-02): counts, what they owe, how to reach them, their vehicles and history. */
function CustomerPanel({ id, onClose }: { id: number; onClose: () => void }) {
  const g = useGarage();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.customer(g.org, id), queryFn: ({ signal }) => gGet<CustomerView>(`/customers/${id}`, { org: g.org }, signal) });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const c = q.data;
  const vehicles = (c?.vehicles ?? []).slice(0, 10);
  const histories = useQueries({ queries: vehicles.map((v) => ({ queryKey: K.vehicle(v.id), queryFn: ({ signal }: { signal: AbortSignal }) => gGet<Vehicle360>(`/vehicles/${v.id}`, undefined, signal) })) });
  const history: Array<VehicleJob & { plate: string }> = histories
    .flatMap((h, i) => [...(h.data?.open_jobs ?? []), ...(h.data?.history ?? [])].map((j) => ({ ...j, plate: vehicles[i]?.vehicle_number ?? '' })))
    .sort((a, b) => String(b.completed_at ?? b.checkin_at ?? '').localeCompare(String(a.completed_at ?? a.checkin_at ?? '')));
  const loadingHistory = histories.some((h) => h.isLoading);

  const send = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await gPost(path, { ...body, org: g.org });
      toast('success', r.message);
      setDialog(null);
      void qc.invalidateQueries({ queryKey: K.customer(g.org, id) });
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside aria-label={c?.name ?? 'Customer'} className="flex w-[420px] shrink-0 flex-col overflow-hidden border-l border-line bg-surface">
      <div className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[15px] font-bold text-ink">{c?.name ?? 'Customer'}</h2>
          {c ? <p className="m-0 truncate text-[12px] text-ink-3">{[c.phone, c.email].filter(Boolean).join(' · ')}</p> : null}
        </div>
        <IconButton icon="x" label="Close" onClick={onClose} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 scroll-thin">
        {q.isLoading ? (
          <Spinner />
        ) : q.error || !c ? (
          <ErrorNote error={q.error ?? new Error('This customer could not be loaded.')} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-[10px] bg-subtle p-2">
                <div className="text-[17px] font-bold tabular-nums">{c.open_jobs}</div>
                <div className="text-[11px] text-ink-3">Open jobs</div>
              </div>
              <div className="rounded-[10px] bg-subtle p-2">
                <div className="text-[17px] font-bold tabular-nums">{c.completed_jobs}</div>
                <div className="text-[11px] text-ink-3">Completed</div>
              </div>
              <div className="rounded-[10px] bg-subtle p-2">
                <div className="text-[15px] font-bold tabular-nums">{c.outstanding === null ? '—' : money(c.outstanding, g.options.currency)}</div>
                <div className="text-[11px] text-ink-3">Owed</div>
              </div>
            </div>
            <Section
              title="Reaching them"
              action={
                g.may('garage.vehicle.manage') ? (
                  <button type="button" className="text-[12px] font-semibold text-primary disabled:opacity-50" disabled={!g.online} onClick={() => setDialog('prefs')}>
                    Change
                  </button>
                ) : null
              }
            >
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-ink-3">Prefers</dt>
                <dd className="m-0">{c.prefs.preferred_channel ? nice(c.prefs.preferred_channel) : '—'}</dd>
                <dt className="text-ink-3">WhatsApp</dt>
                <dd className="m-0">{c.prefs.whatsapp ?? '—'}</dd>
                {c.contact_person ? (
                  <>
                    <dt className="text-ink-3">Contact</dt>
                    <dd className="m-0">{c.contact_person}</dd>
                  </>
                ) : null}
                {c.address ? (
                  <>
                    <dt className="text-ink-3">Address</dt>
                    <dd className="m-0">{c.address}</dd>
                  </>
                ) : null}
                {c.tax_number ? (
                  <>
                    <dt className="text-ink-3">Tax number</dt>
                    <dd className="m-0">{c.tax_number}</dd>
                  </>
                ) : null}
              </dl>
              {c.prefs.notes ? <p className="m-0 mt-2 text-[12.5px] whitespace-pre-wrap text-ink-2">{c.prefs.notes}</p> : null}
              {g.may('garage.settings.manage') ? (
                <Button size="sm" variant="ghost" className="mt-2" disabled={!g.online} onClick={() => setDialog('credit')}>
                  Credit terms
                </Button>
              ) : null}
            </Section>
            <Section title={`Vehicles (${c.vehicles.length})`}>
              {c.vehicles.length === 0 ? (
                <p className="m-0 text-[13px] text-ink-3">None here.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                  {c.vehicles.map((v) => (
                    <li key={v.id}>
                      <button type="button" className="flex w-full items-center justify-between gap-2 py-2 text-left hover:text-primary" onClick={() => g.openVehicle(v.id)}>
                        <span>
                          <b className="tracking-wide">{v.vehicle_number}</b> <span className="text-[12px] text-ink-3">{[v.make, v.model, v.year].filter(Boolean).join(' ')}</span>
                        </span>
                        {v.odometer !== null ? (
                          <span className="text-[11.5px] text-ink-3 tabular-nums">
                            {v.odometer.toLocaleString()} {g.options.units}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Service history, every vehicle">
              {loadingHistory ? (
                <Spinner />
              ) : history.length === 0 ? (
                <p className="m-0 text-[13px] text-ink-3">No jobs yet.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                  {history.map((j) => (
                    <li key={j.id}>
                      <button type="button" className="flex w-full items-center justify-between gap-2 py-1.5 text-left" onClick={() => g.openJob(j.id)}>
                        <span className="min-w-0">
                          <span className="font-mono text-[12px] font-semibold">{j.number}</span> <b className="text-[12px] tracking-wide">{j.plate}</b>
                          <span className="block truncate text-[11.5px] text-ink-3">
                            {when(j.completed_at ?? j.checkin_at, false)} · {j.repairs?.length ? j.repairs.join('; ') : (j.requested ?? nice(j.job_type))}
                          </span>
                        </span>
                        <StatusPill status={j.status} label={g.options.statuses?.[j.status] ?? nice(j.status)} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {c.vehicles.length > vehicles.length ? <p className="m-0 mt-2 text-[12px] text-ink-3">The first {vehicles.length} vehicles; open a vehicle for the rest.</p> : null}
            </Section>
          </>
        )}
      </div>
      {dialog === 'prefs' && c ? (
        <Ask
          title={`How ${c.name} likes to be reached`}
          fields={[
            { name: 'preferred_channel', label: 'Prefers', type: 'select', options: CHANNELS, initial: c.prefs.preferred_channel ?? '' },
            { name: 'whatsapp', label: 'WhatsApp', initial: c.prefs.whatsapp ?? '' },
            { name: 'notes', label: 'Notes', type: 'textarea', initial: c.prefs.notes ?? '' },
          ]}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(v) => void send(`/customers/${id}/prefs`, v)}
        />
      ) : null}
      {dialog === 'credit' && c ? (
        <Ask
          title={`Credit terms for ${c.name}`}
          text="Up to this much may be owed when a vehicle leaves (FR-DLV-05). Empty for none."
          fields={[
            { name: 'limit', label: 'Credit limit', type: 'number' },
            { name: 'note', label: 'Note', placeholder: 'Fleet account, 30 days' },
          ]}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(v) => {
            const limit = (v.limit ?? '').trim();
            void send(`/customers/${id}/credit`, { limit: limit === '' ? null : Number(limit), note: v.note });
          }}
        />
      ) : null}
    </aside>
  );
}
