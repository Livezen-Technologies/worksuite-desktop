import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Spinner } from '../../components/ui';
import { Select } from '../../components/Select';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { fetchLookups, K, tagsOf, updateDomain, type Domain, type DomainEdit, type Lookups, type Org } from './api';
import { Btn, Field, NeedsUpdate, Note, input } from './parts';

/**
 * A domain's links (HDM-SEC-02, AC-01): its customer, project, server and responsible person, its tags, group and
 * notes. The pickers come from `GET domains/lookups?domain=` — the domain's OWN company, never the installation's —
 * and the server checks each one against that company again. A synced domain's registrar-owned facts are not here:
 * they change at the registrar.
 */
export function LookupSelect({ label, value, options, onChange, none }: { label: string; value: number | null; options: Org[]; onChange: (v: number | null) => void; none: string }) {
  return (
    <Field label={label}>
      <Select aria-label={label} value={value ?? 0} onChange={(e) => onChange(Number(e.target.value) || null)} className={input}>
        <option value={0}>{none}</option>
        {/* A link to a row the list no longer offers is kept, so saving does not drop it. */}
        {value && !options.some((o) => o.id === value) ? <option value={value}>{text('#{id}', { id: value })}</option> : null}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** The fields the form changed, and only those: a field left alone is not sent (the server keeps it as it is). */
export function changedLinks(d: Domain, f: { client_id: number | null; project_id: number | null; server_id: number | null; owner_user_id: number | null; tags: string; group: string; notes: string }): DomainEdit {
  const out: DomainEdit = {};
  if ((d.client_id ?? null) !== f.client_id) out.client_id = f.client_id;
  if ((d.project_id ?? null) !== f.project_id) out.project_id = f.project_id;
  if ((d.server_id ?? null) !== f.server_id) out.server_id = f.server_id;
  if ((d.owner_user_id ?? null) !== f.owner_user_id) out.owner_user_id = f.owner_user_id;
  const tags = tagsOf(f.tags);
  if (tags.join('\n') !== (d.tags ?? []).join('\n')) out.tags = tags;
  if ((d.group ?? '') !== f.group.trim()) out.group = f.group.trim() || null;
  if ((d.notes ?? '') !== f.notes.trim()) out.notes = f.notes.trim() || null;
  return out;
}

export function EditLinks({ d, onClose }: { d: Domain; onClose: () => void }) {
  const qc = useQueryClient();
  const lookups = useQuery({ queryKey: K.lookups(`domain:${d.id}`), queryFn: ({ signal }) => fetchLookups({ domain: d.id }, signal), staleTime: 120_000 });
  const [f, setF] = useState({ client_id: d.client_id ?? null, project_id: d.project_id ?? null, server_id: d.server_id ?? null, owner_user_id: d.owner_user_id ?? null, tags: (d.tags ?? []).join(', '), group: d.group ?? '', notes: d.notes ?? '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const edit = changedLinks(d, f);
  const save = async () => {
    if (!Object.keys(edit).length) return onClose();
    setBusy(true);
    setErr(null);
    try {
      const r = await updateDomain(d.id, edit);
      toast('success', r?.notice || text('Saved {name}.', { name: d.name }));
      void qc.invalidateQueries({ queryKey: K.domain(d.id) });
      void qc.invalidateQueries({ queryKey: ['hosting', 'domains'] });
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const l: Lookups | null | undefined = lookups.data;
  return (
    <Modal
      title={text('Links for {name}', { name: d.name })}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary disabled={busy || !l} onClick={() => void save()}>
            Save
          </Btn>
        </>
      }
    >
      {lookups.isPending ? (
        <Spinner />
      ) : lookups.isError ? (
        <Note tone="error">{errorMessage(lookups.error)}</Note>
      ) : !l ? (
        <NeedsUpdate what={text('Editing links')} />
      ) : (
        <div
          className="flex flex-col gap-3"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
              e.preventDefault();
              void save();
            }
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <LookupSelect label={text('Customer')} value={f.client_id} options={l.clients} none={text('No customer')} onChange={(v) => setF({ ...f, client_id: v })} />
            <LookupSelect label={text('Project')} value={f.project_id} options={l.projects} none={text('No project')} onChange={(v) => setF({ ...f, project_id: v })} />
            <LookupSelect label={text('Hosted on')} value={f.server_id} options={l.servers} none={text('No server')} onChange={(v) => setF({ ...f, server_id: v })} />
            <LookupSelect label={text('Responsible')} value={f.owner_user_id} options={l.people} none={text('Nobody in particular')} onChange={(v) => setF({ ...f, owner_user_id: v })} />
          </div>
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
            <Field label={text('Tags')}>
              <input aria-label={text('Tags')} placeholder={text('client, internal')} value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} className={input} />
            </Field>
            <Field label={text('Group')}>
              <input aria-label={text('Group')} value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} className={input} />
            </Field>
          </div>
          <Field label={text('Notes')}>
            <textarea aria-label={text('Notes')} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={`${input} h-auto py-1.5`} />
          </Field>
          <p className="m-0 text-[11.5px] text-ink-3">Only this company’s customers, projects, servers and people are offered.</p>
          {err ? <Note tone="error">{err}</Note> : null}
        </div>
      )}
    </Modal>
  );
}
