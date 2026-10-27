import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal } from '../../components/ui';
import { Select } from '../../components/Select';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { addServer, COST_PERIODS, fetchLookups, K, PROVIDER_OWNED, SERVER_KINDS, SERVER_STATUSES, tagsOf, updateServer, type Org, type Server, type ServerInput } from './api';
import { LookupSelect } from './Links';
import { Btn, Field, Note, input } from './parts';

/**
 * Add a server to the register, or edit one (HDM-SRV-01, `POST servers` / `PUT servers/{id}`). A synced server's
 * name, status, addresses, location, image, type and price belong to its provider: they are shown, not edited,
 * because the next sync would put them back. Its customer, project, responsible person, tags, notes and paid-up-to
 * date are the company's. The customer, project and person come from the server's OWN company (AC-01).
 */
type Form = Record<'name' | 'kind' | 'status' | 'provider' | 'ipv4' | 'ipv6' | 'location' | 'os' | 'plan' | 'cpu' | 'ram' | 'storage' | 'expires_on' | 'cost_amount' | 'cost_currency' | 'cost_period' | 'notes' | 'tags' | 'group', string> & { client_id: number | null; project_id: number | null; owner_user_id: number | null };

const formOf = (s?: Server): Form => ({
  name: s?.name ?? '',
  kind: s?.kind ?? 'vps',
  status: s?.status ?? 'active',
  provider: s?.provider_label ?? s?.provider ?? '',
  ipv4: s?.ipv4 ?? '',
  ipv6: s?.ipv6 ?? '',
  location: s?.location ?? '',
  os: s?.os ?? '',
  plan: s?.plan ?? '',
  cpu: s?.cpu ?? '',
  ram: s?.ram ?? '',
  storage: s?.storage ?? '',
  expires_on: s?.expires_on ?? '',
  cost_amount: s?.cost_amount ?? '',
  cost_currency: s?.cost_currency ?? '',
  cost_period: s?.cost_period ?? 'monthly',
  notes: s?.notes ?? '',
  tags: (s?.tags ?? []).join(', '),
  group: s?.group ?? '',
  client_id: s?.client_id ?? null,
  project_id: s?.project_id ?? null,
  owner_user_id: s?.owner_user_id ?? null,
});

/** What to send: everything for a new server; for an edit, only what changed and is the company's to change. */
export function serverChanges(f: Form, was: Server | undefined): ServerInput {
  const base = formOf(was);
  const synced = was?.source === 'sync';
  const text = (v: string) => v.trim() || null;
  const out: ServerInput = {};
  const put = <K extends keyof ServerInput>(k: K, v: ServerInput[K]) => {
    if (synced && (PROVIDER_OWNED as readonly string[]).includes(k)) return;
    out[k] = v;
  };
  for (const k of ['name', 'kind', 'status', 'provider', 'ipv4', 'ipv6', 'location', 'os', 'plan', 'cpu', 'ram', 'storage', 'expires_on', 'notes', 'group'] as const) {
    if (!was || f[k].trim() !== base[k].trim()) put(k, k === 'name' || k === 'kind' || k === 'status' ? f[k].trim() : text(f[k]));
  }
  // The cost is one: amount, currency and period go together.
  if (!was || f.cost_amount.trim() !== base.cost_amount.trim() || f.cost_currency.trim().toUpperCase() !== base.cost_currency.trim().toUpperCase() || f.cost_period !== base.cost_period) {
    if (f.cost_amount.trim()) {
      put('cost_amount', f.cost_amount.trim());
      put('cost_currency', f.cost_currency.trim().toUpperCase());
      put('cost_period', f.cost_period);
    } else if (was) put('cost_amount', null);
  }
  const tags = tagsOf(f.tags);
  if (!was || tags.join('\n') !== (was.tags ?? []).join('\n')) out.tags = tags;
  for (const k of ['client_id', 'project_id', 'owner_user_id'] as const) if (!was || f[k] !== base[k]) out[k] = f[k];
  return out;
}

export function ServerForm({ server, companies, org, onClose, onSaved }: { server?: Server; companies: Org[]; org: number; onClose: () => void; onSaved?: (s: Server) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(() => formOf(server));
  const [company, setCompany] = useState(server?.org_id ?? (org || companies[0]?.id || 0));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lookups = useQuery({ queryKey: K.lookups(`org:${company}`), queryFn: ({ signal }) => fetchLookups({ org_id: company }, signal), enabled: company > 0, staleTime: 120_000 });
  const synced = server?.source === 'sync';
  const owned = (k: string) => synced && (PROVIDER_OWNED as readonly string[]).includes(k);
  const set = (k: keyof Form, v: string | number | null) => setF({ ...f, [k]: v });
  const changes = serverChanges(f, server);
  const ok = !!f.name.trim() && company > 0 && (!f.cost_amount.trim() || /^[A-Z]{3}$/i.test(f.cost_currency.trim()));
  const save = async () => {
    if (!ok) return;
    if (server && !Object.keys(changes).length) return onClose();
    setBusy(true);
    setErr(null);
    try {
      const s = server ? await updateServer(server.id, changes) : await addServer({ ...changes, org_id: company });
      toast('success', server ? text('Saved {name}.', { name: f.name.trim() }) : text('Added {name} to the register.', { name: f.name.trim() }));
      void qc.invalidateQueries({ queryKey: ['hosting', 'servers'] });
      if (server) void qc.invalidateQueries({ queryKey: K.server(server.id) });
      onSaved?.(s);
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const field = (k: keyof Form & string, label: string, extra: { placeholder?: string; mono?: boolean; type?: string } = {}) => (
    <Field label={label}>
      <input aria-label={label} type={extra.type ?? 'text'} disabled={owned(k)} placeholder={extra.placeholder} value={String(f[k] ?? '')} onChange={(e) => set(k, e.target.value)} className={`${input} ${extra.mono ? 'font-mono' : ''} disabled:bg-subtle disabled:text-ink-3`} />
    </Field>
  );
  const l = lookups.data;
  return (
    <Modal
      title={server ? text('Edit {name}', { name: server.name }) : text('Add a server')}
      onClose={onClose}
      width={640}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary disabled={!ok || busy} onClick={() => void save()}>
            {server ? 'Save' : 'Add server'}
          </Btn>
        </>
      }
    >
      <div
        className="flex flex-col gap-3"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            void save();
          }
        }}
      >
        {synced ? <Note tone="info">{text('Synced from {provider}: its name, status, addresses, plan and price change there. The rest is yours.', { provider: server?.provider_label ?? text('the provider') })}</Note> : null}
        {!server && companies.length > 1 ? (
          <Field label="Company">
            <Select aria-label="Company" value={company} onChange={(e) => (setCompany(Number(e.target.value)), setF({ ...f, client_id: null, project_id: null, owner_user_id: null }))} className={input}>
              {companies.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div className="grid grid-cols-3 gap-3">
          {field('name', text('Name'), { placeholder: 'hz-fsn1-app-01' })}
          <Field label={text('Kind')}>
            <Select aria-label={text('Kind')} disabled={owned('kind')} value={f.kind} onChange={(e) => set('kind', e.target.value)} className={input}>
              {SERVER_KINDS.map(([v, l2]) => (
                <option key={v} value={v}>
                  {text(l2)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={text('Status')}>
            <Select aria-label={text('Status')} disabled={owned('status')} value={f.status} onChange={(e) => set('status', e.target.value)} className={input}>
              {SERVER_STATUSES.map(([v, l2]) => (
                <option key={v} value={v}>
                  {text(l2)}
                </option>
              ))}
            </Select>
          </Field>
          {field('provider', text('Provider'), { placeholder: 'Hetzner' })}
          {field('location', text('Location'))}
          {field('plan', text('Plan'))}
          {field('ipv4', text('IPv4'), { mono: true, placeholder: '203.0.113.10' })}
          {field('ipv6', text('IPv6'), { mono: true })}
          {field('os', text('Operating system'))}
          {field('cpu', text('CPU'))}
          {field('ram', text('Memory'))}
          {field('storage', text('Storage'))}
        </div>
        <div className="grid grid-cols-4 gap-3">
          {field('cost_amount', text('Cost'), { placeholder: '24.50' })}
          {field('cost_currency', text('Currency'), { placeholder: 'EUR' })}
          <Field label={text('Billed')}>
            <Select aria-label={text('Billed')} disabled={owned('cost_period')} value={f.cost_period} onChange={(e) => set('cost_period', e.target.value)} className={input}>
              {COST_PERIODS.map(([v, l2]) => (
                <option key={v} value={v}>
                  {text(l2)}
                </option>
              ))}
            </Select>
          </Field>
          {field('expires_on', text('Paid until'), { type: 'date' })}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <LookupSelect label={text('Customer')} value={f.client_id} options={l?.clients ?? []} none={text('No customer')} onChange={(v) => set('client_id', v)} />
          <LookupSelect label={text('Project')} value={f.project_id} options={l?.projects ?? []} none={text('No project')} onChange={(v) => set('project_id', v)} />
          <LookupSelect label={text('Responsible')} value={f.owner_user_id} options={l?.people ?? []} none={text('Nobody in particular')} onChange={(v) => set('owner_user_id', v)} />
        </div>
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
          {field('tags', text('Tags'), { placeholder: text('client, internal') })}
          {field('group', text('Group'))}
        </div>
        <Field label={text('Notes')}>
          <textarea aria-label={text('Notes')} rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} className={`${input} h-auto py-1.5`} />
        </Field>
        {err ? <Note tone="error">{err}</Note> : null}
      </div>
    </Modal>
  );
}
