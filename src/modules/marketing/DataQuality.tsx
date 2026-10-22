import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx, Spinner } from '../../components/ui';
import { refreshMarketing, send, withOrg } from './api';
import { act, ConfirmSheet, Refused, TABLE, TD, TH, Tabs } from './audience-parts';
import { btn, btnPrimary, btnSmall, Card, Field, input, PageHeader, Pill, Sheet } from './parts';
import { companiesWhere, fieldErrors, refusal, type Contact, type CustomField, type CustomFieldType, type DuplicateGroup, type MergeRecord, type Options } from './types';

export type QualityTab = 'duplicates' | 'merges' | 'fields';
export const QUALITY_TABS: QualityTab[] = ['duplicates', 'merges', 'fields'];

const MATCH_WORD: Record<DuplicateGroup['match'], string> = { email: 'Same email', phone: 'Same phone', name: 'Same name at the organisation' };
const TYPE_WORD: Record<CustomFieldType, string> = { text: 'Text', number: 'Number', date: 'Date', picklist: 'Picklist', boolean: 'Yes / no' };

/** The fields a merge chooses between; `col` is the server's column when it is not the key. */
const MERGE_FIELDS: Array<{ key: string; col?: string; label: string; show: (c: Contact) => string }> = [
  { key: 'first_name', label: 'First name', show: (c) => c.first_name ?? '' },
  { key: 'last_name', label: 'Last name', show: (c) => c.last_name ?? '' },
  { key: 'email', label: 'Email', show: (c) => c.email ?? '' },
  { key: 'phone', label: 'Phone', show: (c) => c.phone ?? '' },
  { key: 'job_title', label: 'Job title', show: (c) => c.job_title ?? '' },
  { key: 'company', col: 'company_id', label: 'Organisation', show: (c) => c.company?.name ?? '' },
  { key: 'city', label: 'City', show: (c) => c.city ?? '' },
  { key: 'country', label: 'Country', show: (c) => c.country_name ?? '' },
  { key: 'owner', col: 'owner_id', label: 'Owner', show: (c) => c.owner?.name ?? '' },
  { key: 'status', label: 'Status', show: (c) => c.status_label },
];

/**
 * Data quality (DK, the web's Data quality; MKT-AUD-08/10/11): contacts that
 * look like one person, merged — choosing whose details survive, undoable for
 * 30 days — and the company's own contact fields.
 */
export default function DataQuality({ org, options, tab, onTab, onContact }: { org: string; options: Options; tab: QualityTab; onTab: (t: QualityTab) => void; onContact: (id: number) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <PageHeader crumbs={['Audience']} title="Data quality" sub="Duplicates, merges and the company's own contact fields" />
      <Tabs<QualityTab> label="Data quality" value={tab} onChange={onTab} tabs={[{ id: 'duplicates', label: 'Duplicates' }, { id: 'merges', label: 'Merge history' }, { id: 'fields', label: 'Custom fields' }]} />
      {tab === 'duplicates' ? <Duplicates org={org} onContact={onContact} /> : null}
      {tab === 'merges' ? <Merges org={org} onContact={onContact} /> : null}
      {tab === 'fields' ? <Fields org={org} options={options} /> : null}
    </div>
  );
}

function Duplicates({ org, onContact }: { org: string; onContact: (id: number) => void }) {
  const q = useQuery({
    queryKey: ['marketing', 'duplicates', org],
    queryFn: ({ signal }) => apiGet<{ groups: DuplicateGroup[] }>('/api/marketing/contacts/duplicates', withOrg(org), signal),
    retry: false,
  });
  const [merging, setMerging] = useState<DuplicateGroup | null>(null);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <Refused error={q.error} onRetry={() => void q.refetch()} />;
  const groups = q.data?.groups ?? [];
  if (groups.length === 0) {
    return (
      <div className="rounded-[12px] border border-line bg-surface px-4 py-10 text-center">
        <p className="m-0 text-[14px] font-semibold text-ink">No duplicates found.</p>
        <p className="m-0 mt-1 text-[12.5px] text-ink-3">Contacts that share an email, a phone number or a name at one organisation show here.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g, i) => (
        <Card key={`${g.match}-${g.key}-${i}`} title={`${MATCH_WORD[g.match]}: ${g.key}`} action={<button type="button" className={btnSmall} onClick={() => setMerging(g)}>Merge…</button>}>
          <ul className="m-0 flex list-none flex-col p-0">
            {g.contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 border-b border-line/70 py-1.5 text-[13px] last:border-b-0">
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onContact(c.id)}>{c.name}</button>
                <span className="text-ink-3">{[c.email, c.phone, c.company?.name].filter(Boolean).join(' · ')}</span>
                <span className="ml-auto text-[11.5px] text-ink-3">Added {dateLabel(c.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {merging ? <MergeSheet group={merging} onClose={() => setMerging(null)} onDone={() => (setMerging(null), void q.refetch())} /> : null}
    </div>
  );
}

/** Choose the survivor and, field by field, whose value it keeps. */
export function MergeSheet({ group, onClose, onDone }: { group: DuplicateGroup; onClose: () => void; onDone: () => void }) {
  const people = group.contacts;
  const [survivor, setSurvivor] = useState(people[0]?.id ?? 0);
  const [pick, setPick] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const merge = async () => {
    setBusy(true);
    const ok = await act(
      () => send('POST', '/api/marketing/contacts/merge', {
        survivor_id: survivor,
        ids: people.map((p) => p.id).filter((id) => id !== survivor),
        pick: Object.fromEntries(Object.entries(pick).map(([k, id]) => [MERGE_FIELDS.find((f) => f.key === k)?.col ?? k, id])),
      }),
      'Merged.',
    );
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <Sheet
      title="Merge contacts"
      width={720}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void merge()}>{busy ? 'Merging…' : `Merge ${people.length}`}</button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">One contact survives. Consents, suppressions, timeline, lists, tags, calls and campaign history move to it. You can undo this for 30 days.</p>
      <div className="overflow-x-auto scroll-thin">
        <table className={cx(TABLE, 'min-w-[520px]')}>
          <thead>
            <tr>
              <th scope="col" className={TH}>Field</th>
              {people.map((p) => (
                <th key={p.id} scope="col" className={TH}>
                  <label className="flex items-center gap-1.5 normal-case">
                    <input type="radio" name="survivor" checked={survivor === p.id} onChange={() => (setSurvivor(p.id), setPick({}))} />
                    Keep #{p.id}
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MERGE_FIELDS.map((f) => {
              const values = people.map((p) => f.show(p));
              if (values.every((v) => v === values[0])) return null;
              const chosen = pick[f.key] ?? survivor;
              return (
                <tr key={f.key}>
                  <th scope="row" className={cx(TD, 'font-semibold')}>{f.label}</th>
                  {people.map((p, i) => (
                    <td key={p.id} className={TD}>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" name={`pick-${f.key}`} checked={chosen === p.id} onChange={() => setPick({ ...pick, [f.key]: p.id })} />
                        <span className={values[i] ? 'text-ink' : 'text-ink-3'}>{values[i] || '—'}</span>
                      </label>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-[11.5px] text-ink-3">Only fields that differ are shown. Consent keeps the strictest word: a withdrawal is never lost.</p>
    </Sheet>
  );
}

function Merges({ org, onContact }: { org: string; onContact: (id: number) => void }) {
  const q = useQuery({
    queryKey: ['marketing', 'merges', org],
    queryFn: ({ signal }) => apiGet<{ items: MergeRecord[] }>('/api/marketing/contacts/merges', withOrg(org), signal),
    retry: false,
  });
  const [undoing, setUndoing] = useState<MergeRecord | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Spinner />;
  const items = q.data?.items ?? [];
  if (items.length === 0) return <p className="m-0 rounded-[12px] border border-line bg-surface px-4 py-8 text-center text-[13px] text-ink-3">No merges yet. Merges show here, and can be undone for 30 days.</p>;
  return (
    <section aria-label="Merge history" className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 border-b border-line/70 px-3 py-2.5 text-[13px] last:border-b-0">
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onContact(m.survivor_id)}>{m.survivor}</button>
            <span className="text-ink-2">kept · merged {m.merged.map((x) => x.name).join(', ')}</span>
            <span className="text-[11.5px] text-ink-3">{dateLabel(m.merged_at)}{m.by ? ` · ${m.by}` : ''}</span>
            <span className="ml-auto">
              {m.undone_at ? <Pill tone="slate">Undone {dateLabel(m.undone_at)}</Pill> : m.can_undo ? (
                <button type="button" className={btnSmall} onClick={() => setUndoing(m)}><Icon name="refresh" size={13} /> Undo</button>
              ) : <Pill tone="slate">Final</Pill>}
            </span>
          </li>
        ))}
      </ul>
      {undoing ? (
        <ConfirmSheet title="Undo this merge?" action="Undo merge" busy={busy} onClose={() => setUndoing(null)}
          onYes={() => void (async () => {
            setBusy(true);
            if (await act(() => send('POST', `/api/marketing/contacts/merges/${undoing.id}/undo`), 'Undone.')) setUndoing(null);
            setBusy(false);
            void q.refetch();
          })()}>
          {undoing.survivor} and {undoing.merged.map((x) => x.name).join(', ')} become separate again, each with what was theirs.
        </ConfirmSheet>
      ) : null}
    </section>
  );
}

function Fields({ org, options }: { org: string; options: Options }) {
  const managers = companiesWhere(options, 'settings');
  const q = useQuery({
    queryKey: ['marketing', 'custom-fields'],
    queryFn: ({ signal }) => apiGet<{ items: CustomField[] }>('/api/marketing/custom-fields', undefined, signal),
    retry: false,
  });
  const [editing, setEditing] = useState<CustomField | 'new' | null>(null);
  const [removing, setRemoving] = useState<CustomField | null>(null);
  const scoped = org.split(',').filter(Boolean).map(Number);
  const items = (q.data?.items ?? []).filter((f) => scoped.length === 0 || scoped.includes(f.org_id));
  const mayManage = (orgId: number) => managers.some((c) => c.id === orgId);
  return (
    <Card title="Custom contact fields" action={managers.length ? <button type="button" className={btnSmall} onClick={() => setEditing('new')}><Icon name="plus" size={13} /> New field</button> : undefined}>
      <p className="m-0 mb-2 text-[12.5px] text-ink-3">
        Each field is offered on the contact form, can be mapped in an import column, and written in an email as <code>{'{{custom.key}}'}</code>.
      </p>
      {q.isLoading ? <Spinner /> : items.length === 0 ? <p className="m-0 text-[12.5px] text-ink-3">No custom fields yet.</p> : (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 border-b border-line/70 py-2 text-[13px] last:border-b-0">
              <b className="text-ink">{f.label}</b>
              <code className="text-[11.5px] text-ink-3">custom.{f.key}</code>
              <Pill tone="blue" dot={false}>{TYPE_WORD[f.type]}</Pill>
              {f.type === 'picklist' ? <span className="text-[11.5px] text-ink-3">{f.options.join(' · ')}</span> : null}
              {mayManage(f.org_id) ? (
                <span className="ml-auto flex gap-1">
                  <button type="button" className={btnSmall} onClick={() => setEditing(f)}>Edit</button>
                  <button type="button" className={cx(btnSmall, 'text-danger')} aria-label={`Remove ${f.label}`} onClick={() => setRemoving(f)}><Icon name="trash" size={13} /></button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? <FieldSheet field={editing === 'new' ? null : editing} orgs={managers.map((c) => ({ value: String(c.id), label: c.name }))} onClose={() => setEditing(null)} onDone={() => (setEditing(null), void q.refetch())} /> : null}
      {removing ? (
        <ConfirmSheet title={`Remove "${removing.label}"?`} action="Remove" danger onClose={() => setRemoving(null)}
          onYes={() => void act(() => send('DELETE', `/api/marketing/custom-fields/${removing.id}`), 'Removed.').then(() => (setRemoving(null), void q.refetch()))}>
          Contacts keep the values they had; the field is no longer offered or checked.
        </ConfirmSheet>
      ) : null}
    </Card>
  );
}

function FieldSheet({ field, orgs, onClose, onDone }: { field: CustomField | null; orgs: Array<{ value: string; label: string }>; onClose: () => void; onDone: () => void }) {
  const [orgId, setOrgId] = useState(field ? String(field.org_id) : (orgs[0]?.value ?? ''));
  const [label, setLabel] = useState(field?.label ?? '');
  const [type, setType] = useState<CustomFieldType>(field?.type ?? 'text');
  const [choices, setChoices] = useState((field?.options ?? []).join('\n'));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErrors({});
    const body = { label, type, options: choices.split('\n').map((s) => s.trim()).filter(Boolean), org_id: Number(orgId) };
    try {
      const r = field ? await send('PUT', `/api/marketing/custom-fields/${field.id}`, body) : await send('POST', '/api/marketing/custom-fields', body);
      toast('success', r.message ?? 'Saved.');
      await refreshMarketing();
      onDone();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={field ? 'Edit field' : 'New field'}
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy || label.trim() === ''} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {!field && orgs.length > 1 ? (
          <Field label="Company"><Select<string> aria-label="Company" value={orgId} onValueChange={setOrgId} options={orgs} className={input} /></Field>
        ) : null}
        <Field label="Name" hint={errors.label ? <span className="text-danger">{errors.label}</span> : undefined}>
          <input autoFocus className={input} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Type">
          <Select<string> aria-label="Type" value={type} disabled={!!field} onValueChange={(v) => setType(v as CustomFieldType)} options={(Object.keys(TYPE_WORD) as CustomFieldType[]).map((t) => ({ value: t, label: TYPE_WORD[t] }))} className={input} />
        </Field>
        {type === 'picklist' ? (
          <Field label="Choices" hint={errors.options ? <span className="text-danger">{errors.options}</span> : 'One per line.'}>
            <textarea className={cx(input, '!h-auto py-2')} rows={4} value={choices} onChange={(e) => setChoices(e.target.value)} />
          </Field>
        ) : null}
      </div>
    </Sheet>
  );
}
