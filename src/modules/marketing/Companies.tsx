import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx, Spinner } from '../../components/ui';
import { refreshMarketing, send, withOrg } from './api';
import { act, ConfirmSheet, CountrySelect, firstCompany, may, Pager, Refused, SearchField, TABLE, TD, TH, useDebounced } from './audience-parts';
import { btn, btnPrimary, btnSmall, Field, input, n, PageHeader, Sheet } from './parts';
import { companiesWhere, fieldErrors, peopleOf, refusal, type MarketingCompany, type Options } from './types';

const PER = 50;

/**
 * The organisations contacts work at (MKT-AUD-03).
 *
 * Made as contacts are added — found by name, however it is capitalised or
 * spaced — and editable here. Each one's count leads to its contacts.
 * Deleting one keeps its contacts, at no organisation.
 */
export default function Companies({ org, options, onContacts }: { org: string; options: Options; onContacts: (companyId: number) => void }) {
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim(), 300);
  const key = `${org}|${q}`;
  const [paging, setPaging] = useState({ key, page: 1 });
  const page = paging.key === key ? paging.page : 1;
  const [editing, setEditing] = useState<MarketingCompany | 'new' | null>(null);
  const [removing, setRemoving] = useState<MarketingCompany | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useQuery({
    queryKey: ['marketing', 'companies', org, q, page],
    queryFn: ({ signal }) => apiGet<{ items: MarketingCompany[]; total?: number }>('/api/marketing/companies', withOrg(org, { q, page, per_page: PER }), signal),
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? rows.length;

  const remove = async (c: MarketingCompany) => {
    setBusy(true);
    if (await act(() => send('DELETE', `/api/marketing/companies/${c.id}`), 'Deleted.')) setRemoving(null);
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        crumbs={['Audience']}
        title="Organisations"
        sub="The organisations your contacts work at — made as contacts are added, matched by name"
        actions={
          may(options, 'create') ? (
            <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
              <Icon name="plus" size={15} /> New organisation
            </button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={typed} onChange={setTyped} label="Search organisations" placeholder="Name, domain or city" className="w-full max-w-[320px]" />
      </div>
      <section aria-label="Organisations" className="min-w-0 overflow-hidden rounded-[12px] border border-line bg-surface">
        {list.isLoading ? <Spinner /> : null}
        {list.error && !list.data ? (
          <div className="p-3">
            <Refused error={list.error} onRetry={() => void list.refetch()} />
          </div>
        ) : null}
        {list.data && rows.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="m-0 text-[14px] font-semibold text-ink">{q ? 'No organisation by that name.' : 'No organisations yet.'}</p>
            <p className="m-0 mt-1 text-[12.5px] text-ink-3">They are made as contacts are added with an organisation&apos;s name, or here.</p>
          </div>
        ) : null}
        {rows.length ? (
          <div className="overflow-x-auto scroll-thin">
            <table className={cx(TABLE, 'min-w-[720px]')}>
              <thead>
                <tr>
                  {['Organisation', 'Industry', 'Where', 'Owner'].map((h) => (
                    <th key={h} scope="col" className={TH}>
                      {h}
                    </th>
                  ))}
                  <th scope="col" className={cx(TH, 'text-right')}>
                    Contacts
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className={cx(list.isPlaceholderData && 'opacity-60')}>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className={TD}>
                      <span className="block font-semibold text-ink">{c.name}</span>
                      <span className="block truncate text-[11.5px] text-ink-3">{c.domain ?? c.website ?? '—'}</span>
                    </td>
                    <td className={cx(TD, 'text-ink-2')}>{c.industry ?? '—'}</td>
                    <td className={cx(TD, 'text-ink-2')}>{[c.city, c.country_name].filter(Boolean).join(', ') || '—'}</td>
                    <td className={cx(TD, 'text-ink-2')}>{c.owner?.name ?? '—'}</td>
                    <td className={cx(TD, 'text-right')}>
                      <button type="button" className="font-bold text-primary tabular-nums hover:underline" aria-label={`${c.name}: see the ${c.contacts} contacts`} onClick={() => onContacts(c.id)}>
                        {n(c.contacts)}
                      </button>
                    </td>
                    <td className={cx(TD, 'text-right whitespace-nowrap')}>
                      {may(options, 'edit', c.org_id) ? (
                        <button type="button" className={btnSmall} onClick={() => setEditing(c)}>
                          Edit
                        </button>
                      ) : null}
                      {may(options, 'delete', c.org_id) ? (
                        <button type="button" className={cx(btnSmall, 'ml-1.5 text-danger')} onClick={() => setRemoving(c)}>
                          Delete
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {list.data && total > PER ? <Pager page={page} per={PER} total={total} onPage={(p) => setPaging({ key, page: p })} /> : null}
      </section>

      {editing ? <CompanySheet company={editing === 'new' ? null : editing} options={options} org={org} onClose={() => setEditing(null)} /> : null}
      {removing ? (
        <ConfirmSheet title={`Delete ${removing.name}?`} action="Delete" danger busy={busy} onClose={() => setRemoving(null)} onYes={() => void remove(removing)}>
          Its {n(removing.contacts)} {removing.contacts === 1 ? 'contact stays' : 'contacts stay'}, at no organisation.
        </ConfirmSheet>
      ) : null}
    </div>
  );
}

/** A new organisation, or a change to one. */
function CompanySheet({ company, options, org, onClose }: { company: MarketingCompany | null; options: Options; org: string; onClose: () => void }) {
  const makers = companiesWhere(options, 'create');
  const [orgId, setOrgId] = useState(company ? String(company.org_id) : firstCompany(options, 'create', org));
  const [d, setD] = useState({
    name: company?.name ?? '', website: company?.website ?? '', industry: company?.industry ?? '', country: company?.country ?? '',
    city: company?.city ?? '', phone: company?.phone ?? '', owner_id: company?.owner ? String(company.owner.id) : '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof d, v: string) => setD({ ...d, [k]: v });
  const hint = (k: string) => (errors[k] ? <span className="text-danger">{errors[k]}</span> : undefined);

  const save = async () => {
    setBusy(true);
    setErrors({});
    const body = { ...d, owner_id: d.owner_id === '' ? null : Number(d.owner_id) };
    try {
      const r = company ? await send('PUT', `/api/marketing/companies/${company.id}`, body) : await send('POST', '/api/marketing/companies', { ...body, org_id: Number(orgId) });
      toast('success', r.message ?? 'Saved.');
      await refreshMarketing();
      onClose();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={company ? company.name : 'New organisation'}
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || d.name.trim() === '' || orgId === ''} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!company && makers.length > 1 ? (
          <Field label="Company" className="sm:col-span-2">
            <Select<string> aria-label="Company" value={orgId} placeholder="Which company?" onValueChange={(v) => (setOrgId(v), set('owner_id', ''))} options={makers.map((c) => ({ value: String(c.id), label: c.name }))} className={input} />
          </Field>
        ) : null}
        <Field label="Name" hint={hint('name')} className="sm:col-span-2">
          <input autoFocus className={input} value={d.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Website" hint={hint('website')}>
          <input className={input} value={d.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" />
        </Field>
        <Field label="Industry" hint={hint('industry')}>
          <input className={input} value={d.industry} onChange={(e) => set('industry', e.target.value)} />
        </Field>
        <Field label="Country" hint={hint('country')}>
          <CountrySelect label="Country" value={d.country} onChange={(v) => set('country', v)} />
        </Field>
        <Field label="City" hint={hint('city')}>
          <input className={input} value={d.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Phone" hint={hint('phone')}>
          <input className={input} type="tel" value={d.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Owner" hint={hint('owner_id')}>
          <Select<string> aria-label="Owner" value={d.owner_id} onValueChange={(v) => set('owner_id', v)} options={[{ value: '', label: 'Nobody' }, ...peopleOf(options, Number(orgId) || null)]} className={input} />
        </Field>
      </div>
    </Sheet>
  );
}
