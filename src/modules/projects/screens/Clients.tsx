import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { call, errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, Modal, cx, initials } from '../../../components/ui';
import { CompanySelect, orgParam, useOrgParam } from '../company';
import { openWeb } from '../parts';
import { errorText, pk, preads, projectPath, pwrites, shortMoney, usePermission, type Client } from '../portfolio';
import { Chip, ErrorLine, Failed, Field, Loading, Mono, Nothing, PageHead, Panel, ProjectStatusChip, TD, TH, areaClass, inputClass, needsConnection, useAsk } from './kit';

/**
 * W16 · Clients (PRJ-CLI): who the projects are for, each with its live and total project counts and whether it is
 * linked to a CRM account; the one picked opens on the right (`/projects/clients/{id}`) with its projects and what is
 * live and ready to invoice. Add, edit, archive and restore need WorkSuite (disabled offline).
 *
 * Contact details show only to people who work on one of the client's projects (`contact_visible`); everyone else is
 * told they are hidden — never an empty row that reads as "no phone number on file".
 */

const HIDDEN = 'Hidden: you work on none of this client’s projects';

function contactLine(c: Client): string {
  if (!c.contact_visible) return HIDDEN;
  return [c.contact_person, c.email].filter(Boolean).join(' · ') || '—';
}

export function ClientsView({ id, offline, onGo, onOffline }: { id: number | null; offline: boolean; onGo: (route: string) => void; onOffline: (o: boolean) => void }) {
  useOrgParam();
  const may = usePermission();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Client | 'new' | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const params = { q, archived };
  const list = useQuery({ queryKey: pk.clients(params), queryFn: ({ signal }) => preads.clients(params, { signal }), placeholderData: (prev) => prev });
  const fromCache = !!list.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);
  const rows = list.data?.data.clients ?? [];
  const mayManage = list.data?.data.can?.manage ?? may('project.manage');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title="Clients"
        actions={
          mayManage ? (
            <Button size="sm" variant="primary" icon="plus" disabled={offline} title={offline ? needsConnection('Adding a client') : undefined} onClick={() => setEditing('new')}>
              Add client
            </Button>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-2 pb-2.5">
          <label className="flex h-7 w-[240px] items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2 text-ink-3 focus-within:border-primary">
            <Icon name="search" size={13} />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients" aria-label="Search clients" className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none" />
          </label>
          <CompanySelect />
          <Button size="sm" aria-pressed={archived} onClick={() => setArchived((a) => !a)} className={archived ? 'border-primary/50 bg-selection text-primary' : undefined}>
            Show archived
          </Button>
        </div>
      </PageHead>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] items-start gap-3.5 overflow-y-auto px-5 py-3.5 scroll-thin">
        <Panel className="overflow-hidden">
          {list.isLoading ? (
            <Loading label="Loading clients" />
          ) : list.error && !list.data ? (
            <Failed error={list.error} onRetry={() => void list.refetch()} />
          ) : rows.length === 0 ? (
            <Nothing text={q ? 'No clients match this search.' : archived ? 'No archived clients.' : 'No clients yet.'} />
          ) : (
            <table className="w-full border-collapse">
              <caption className="sr-only">{archived ? 'Archived clients' : 'Clients'}</caption>
              <thead className="bg-ground">
                <tr>
                  <th scope="col" className={TH}>Client</th>
                  <th scope="col" className={TH}>Contact</th>
                  <th scope="col" className={cx(TH, 'text-end')}>Live</th>
                  <th scope="col" className={cx(TH, 'text-end')}>All</th>
                  <th scope="col" className={TH}>CRM</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const on = c.id === id;
                  return (
                    <tr key={c.id} aria-selected={on} onClick={() => onGo(`/projects/clients/${c.id}`)} className={cx('cursor-pointer border-t border-line/70', on ? 'bg-selection' : 'hover:bg-subtle')}>
                      <td className={TD}>
                        <button type="button" onClick={(e) => (e.stopPropagation(), onGo(`/projects/clients/${c.id}`))} className="text-start font-semibold text-ink hover:text-primary hover:underline">
                          {c.name}
                        </button>
                      </td>
                      <td className={cx(TD, c.contact_visible ? 'text-ink-2' : 'text-ink-3 italic')}>{contactLine(c)}</td>
                      <td className={cx(TD, 'text-end')}>
                        <Mono>{c.live}</Mono>
                      </td>
                      <td className={cx(TD, 'text-end')}>
                        <Mono className="text-ink-3">{c.projects}</Mono>
                      </td>
                      <td className={TD}>{c.crm.linked ? <Chip tone="bg-success-bg text-success">Linked</Chip> : <Chip>Not linked</Chip>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
        {id ? <ClientPanel key={id} id={id} offline={offline} onGo={onGo} onEdit={setEditing} /> : <Panel className="p-5 text-[12.5px] text-ink-3">Pick a client to see its projects and contact details.</Panel>}
      </div>
      {editing ? <ClientForm existing={editing === 'new' ? null : editing} offline={offline} onClose={() => setEditing(null)} onSaved={(saved) => (setEditing(null), onGo(`/projects/clients/${saved}`))} /> : null}
    </div>
  );
}

function ClientPanel({ id, offline, onGo, onEdit }: { id: number; offline: boolean; onGo: (route: string) => void; onEdit: (c: Client) => void }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useAsk();
  const q = useQuery({ queryKey: pk.client(id), queryFn: ({ signal }) => preads.client(id, { signal }) });
  if (q.isLoading) return <Loading label="Loading the client" />;
  if (!q.data) return <Failed error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data.data;
  const c = d.client;
  const mayManage = d.can?.manage ?? false;
  const isArchived = c.status === 'archived';

  const toggleArchive = async () => {
    if (!isArchived && !(await confirm({ title: `Archive ${c.name}?`, message: 'It leaves the client list and the New project picker. Its projects keep it, and you can restore it from "Show archived".', confirmLabel: 'Archive' }))) return;
    try {
      await pwrites.archiveClient(c.id, !isArchived);
      toast('success', isArchived ? `${c.name} restored` : `${c.name} archived`);
      await qc.invalidateQueries({ queryKey: ['projects', 'clients'] });
      await qc.invalidateQueries({ queryKey: pk.client(c.id) });
    } catch (e) {
      toast('error', errorText(e));
    }
  };

  const info: Array<[string, string | null]> = [
    ['Contact', c.contact_person],
    ['Email', c.email],
    ['Phone', c.phone],
    ['Address', c.address],
    ['Website', c.website],
  ];

  return (
    <Panel label={c.name} className="gap-3 p-3.5">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-[10px] bg-teal font-bold text-white">
          {initials(c.name)}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-bold text-ink">{c.name}</h2>
          <span className="text-[11.5px] text-ink-3">
            {c.crm.linked ? `Linked to CRM account${c.crm.label ? ` · ${c.crm.label}` : ''}` : 'Not linked to a CRM account'}
            {c.org_name ? ` · ${c.org_name}` : ' · Shared by all companies'}
            {isArchived ? ' · Archived' : ''}
          </span>
        </div>
        {mayManage ? (
          <div className="ms-auto flex shrink-0 gap-1.5">
            <Button size="sm" disabled={offline} title={offline ? needsConnection('Editing a client') : undefined} onClick={() => onEdit(c)}>
              Edit
            </Button>
            <Button size="sm" variant={isArchived ? 'secondary' : 'danger'} disabled={offline} title={offline ? needsConnection(isArchived ? 'Restoring a client' : 'Archiving a client') : undefined} onClick={() => void toggleArchive()}>
              {isArchived ? 'Restore' : 'Archive'}
            </Button>
          </div>
        ) : null}
      </div>
      {c.contact_visible ? (
        <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12.5px]">
          {info
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-3">{k}</dt>
                <dd className="min-w-0 break-words text-ink">
                  {k === 'Email' ? (
                    <button type="button" className="text-primary hover:underline" onClick={() => void call('app:openExternal', { url: `mailto:${v}` }).catch((e: unknown) => toast('error', errorMessage(e)))}>
                      {v}
                    </button>
                  ) : (
                    v
                  )}
                </dd>
              </div>
            ))}
          {info.every(([, v]) => !v) ? <dd className="col-span-2 text-ink-3">No contact details on file.</dd> : null}
        </dl>
      ) : (
        <p className="rounded-[8px] bg-ground px-3 py-2 text-[12px] text-ink-2">Contact details are hidden: you work on none of this client’s projects.</p>
      )}
      <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
        <h3 className="text-[13px] font-bold text-ink">Projects</h3>
        {d.projects.length === 0 ? (
          <p className="text-[12px] text-ink-3">No projects you can see.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {d.projects.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onGo(projectPath(p.id))} className="flex w-full items-center gap-2 rounded-[6px] px-1 py-0.5 text-start text-[12.5px] text-ink hover:bg-subtle">
                  <Mono className="text-[11px] text-ink-3">{p.code}</Mono>
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <ProjectStatusChip status={p.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-line pt-2.5 text-[11.5px]">
        <div className="rounded-[10px] bg-ground p-2.5">
          <span className="text-ink-3">Budget, live</span>
          <div className="font-mono text-[15px] font-bold text-ink">{shortMoney(d.budget_live, d.currency)}</div>
        </div>
        <div className="rounded-[10px] bg-ground p-2.5">
          <span className="text-ink-3">Ready to invoice</span>
          <div className="font-mono text-[15px] font-bold text-ink">{shortMoney(d.ready_to_invoice, d.currency)}</div>
        </div>
      </div>
      {c.notes && c.contact_visible ? <p className="border-t border-line pt-2.5 text-[12px] whitespace-pre-line text-ink-2">{c.notes}</p> : null}
      <button type="button" onClick={() => openWeb(`/projects/clients/${c.id}`)} className="self-start text-[12px] text-ink-3 hover:text-primary hover:underline">
        Open on the web
      </button>
      {dialog}
    </Panel>
  );
}

const FIELDS: Array<{ key: keyof Client; label: string; type?: string; wide?: boolean }> = [
  { key: 'name', label: 'Client name' },
  { key: 'contact_person', label: 'Contact person' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'website', label: 'Website', type: 'url' },
  { key: 'address', label: 'Address', wide: true },
];

function ClientForm({ existing, offline, onClose, onSaved }: { existing: Client | null; offline: boolean; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = { notes: existing?.notes ?? '' };
    for (const x of FIELDS) o[x.key] = String(existing?.[x.key] ?? '');
    return o;
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.name?.trim()) return setError('Give the client a name.');
    setBusy(true);
    setError('');
    try {
      // An edit sends only what changed: someone who cannot see the contact details gets empty boxes for them, and
      // saving those must not wipe them.
      const body = Object.fromEntries(
        Object.entries(f)
          .filter(([k, v]) => !existing || v !== String(existing[k as keyof Client] ?? ''))
          .map(([k, v]) => [k, v.trim() || null]),
      );
      let id = existing?.id ?? 0;
      if (existing) await pwrites.updateClient(existing.id, body);
      // A new client is the company's the screen is showing (G-01).
      else id = (await pwrites.createClient({ ...body, org_id: Number(orgParam()) || null })).id;
      await qc.invalidateQueries({ queryKey: ['projects', 'clients'] });
      if (id) await qc.invalidateQueries({ queryKey: pk.client(id) });
      toast('success', existing ? 'Client saved' : 'Client added');
      onSaved(id);
    } catch (e) {
      setError(errorText(e, 'The client could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? `Edit ${existing.name}` : 'Add client'}
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={offline} title={offline ? needsConnection('Saving a client') : undefined} onClick={() => void save()}>
            {existing ? 'Save' : 'Add client'}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), void save())} noValidate className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((x) => (
          <Field key={x.key} label={x.label} required={x.key === 'name'} className={x.wide ? 'sm:col-span-2' : undefined}>
            <input type={x.type ?? 'text'} autoFocus={x.key === 'name'} value={f[x.key] ?? ''} onChange={(e) => setF((p) => ({ ...p, [x.key]: e.target.value }))} className={inputClass} />
          </Field>
        ))}
        <Field label="Notes" className="sm:col-span-2">
          <textarea value={f.notes ?? ''} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} rows={3} className={areaClass} />
        </Field>
        {error ? (
          <div className="sm:col-span-2">
            <ErrorLine>{error}</ErrorLine>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
