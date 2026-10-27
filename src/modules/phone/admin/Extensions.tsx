import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { call as desktop, hasDesktop } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, Chip, cx, Empty, Spinner } from '../../../components/ui';
import { isNotOffered, NOT_OFFERED, phoneApi, PK, useExtensions, useServers, useStatus, type Extension, type ExtensionInput, type RecordPolicy } from '../api';
import { csvObjects, toCsv } from '../lib/csv';
import { stamp } from '../lib/format';
import { ConfirmButton, Field, INPUT, Mono, PageBody, PageHeader, Panel, Pills, Refused, TD, TR, Table } from '../parts';
import { useDepartments, usePeople } from './lookups';
import { SecretOnce } from './SecretOnce';
import { Checkbox } from '../../../components/Checkbox';
import { clickOnKey } from '../../../components/press';

/**
 * A02 · Extensions (VOIP-EXT-01…10). Every extension with its person, department, switch, device type, registration
 * and recording policy; filters for online, unassigned, missing on the PBX and hot desk; an editor beside the list;
 * new extensions (the next free number from the switch's mapping, VOIP-EXT-07), secrets shown once (A03), HR
 * provisioning (WF-03), sync with the PBX, and CSV import and export (VOIP-EXT-10).
 */
type Filter = 'all' | 'online' | 'unassigned' | 'missing' | 'hotdesk';

const RECORD: Record<RecordPolicy, string> = { never: 'Never', inbound: 'Inbound', outbound: 'Outbound', always: 'Always' };

export default function Extensions() {
  const qc = useQueryClient();
  const q = useExtensions();
  const servers = useServers();
  const [filter, setFilter] = useState<Filter>('all');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<number | 'new' | null>(null);
  const [secret, setSecret] = useState<{ ext: Extension; secret: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const all = useMemo(() => q.data ?? [], [q.data]);
  const counts = useMemo(
    () => ({
      all: all.length,
      online: all.filter((e) => e.presence !== 'offline').length,
      unassigned: all.filter((e) => e.user_id === null).length,
      missing: all.filter((e) => e.missing_on_pbx).length,
      hotdesk: all.filter((e) => e.holder_kind === 'hotdesk' || e.holder_kind === 'shared').length,
    }),
    [all],
  );
  const t = term.trim().toLowerCase();
  const list = all.filter(
    (e) =>
      (filter === 'all' || (filter === 'online' && e.presence !== 'offline') || (filter === 'unassigned' && e.user_id === null) || (filter === 'missing' && e.missing_on_pbx) || (filter === 'hotdesk' && (e.holder_kind === 'hotdesk' || e.holder_kind === 'shared'))) &&
      (!t || e.extension.includes(t) || e.name.toLowerCase().includes(t) || (e.user_name ?? '').toLowerCase().includes(t) || (e.department ?? '').toLowerCase().includes(t)),
  );
  const current = typeof selected === 'number' ? (all.find((e) => e.id === selected) ?? null) : null;
  const refresh = () => void qc.invalidateQueries({ queryKey: PK.extensions });
  const defaultServer = servers.data?.servers.find((s) => s.is_default) ?? servers.data?.servers[0] ?? null;

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const msg = await fn();
      if (msg) toast('success', msg);
      refresh();
    } catch (e) {
      toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? NOT_OFFERED : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = () =>
    run('export', async () => {
      const csv = toCsv(
        ['extension', 'name', 'user', 'email', 'department', 'server', 'caller_id', 'device_type', 'record_calls', 'voicemail', 'enabled', 'branch'],
        all.map((e) => [e.extension, e.name, e.user_name, e.email, e.department, e.server, e.caller_id, e.device_type, e.record_calls, e.voicemail ? 1 : 0, e.enabled ? 1 : 0, e.branch]),
      );
      if (hasDesktop()) {
        const where = await desktop('files:saveText', { name: 'extensions.csv', text: csv });
        if (where) return `${all.length} extensions exported.`;
      }
    });

  const importCsv = (text: string) =>
    run('import', async () => {
      const rows: ExtensionInput[] = csvObjects(text)
        .filter((r) => /^\d{2,8}$/.test(r.extension ?? ''))
        .map((r) => ({
          extension: r.extension,
          name: r.name || undefined,
          email: r.email || null,
          caller_id: r.caller_id || null,
          device_type: (['webrtc', 'sip', 'both'].includes(r.device_type ?? '') ? r.device_type : 'webrtc') as ExtensionInput['device_type'],
          record_calls: (['never', 'inbound', 'outbound', 'always'].includes(r.record_calls ?? '') ? r.record_calls : 'never') as RecordPolicy,
          voicemail_enabled: r.voicemail === '1' || /^y|true/i.test(r.voicemail ?? ''),
          branch: r.branch || null,
        }));
      if (!rows.length) throw new Error('No rows with an extension number (2–8 digits) were found. The first row must name the columns: extension, name, email…');
      try {
        const r = await phoneApi.importExtensions(rows);
        return `${r.created} created, ${r.skipped} skipped.`;
      } catch (e) {
        if (!isNotOffered(e)) throw e;
        // One by one through the endpoint every server has. Their secrets are not shown: regenerate when needed.
        let made = 0;
        const failed: string[] = [];
        for (const row of rows) {
          try {
            await phoneApi.createExtension(row);
            made += 1;
          } catch (err) {
            failed.push(`${row.extension}: ${(err as Error).message}`);
          }
        }
        if (failed.length) toast('error', `${failed.length} not imported — ${failed.slice(0, 3).join('; ')}`);
        return `${made} extensions created. Their SIP passwords were not shown: regenerate one when a desk phone needs it.`;
      }
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Extensions"
        actions={
          <>
            <Button icon="user-plus" loading={busy === 'hr'} onClick={() => void run('hr', async () => (await phoneApi.hrProvision()).message)}>
              Provision from HR
            </Button>
            <Button icon="refresh" loading={busy === 'sync'} disabled={!defaultServer} onClick={() => void run('sync', async () => {
              const r = await phoneApi.sync(defaultServer!.id, 'extensions');
              return r.message ?? `Sync ${r.state}.`;
            })}>
              Sync with PBX
            </Button>
            <Button icon="upload" loading={busy === 'import'} onClick={() => file.current?.click()}>
              Import CSV
            </Button>
            <Button icon="download" loading={busy === 'export'} disabled={!all.length} onClick={() => void exportCsv()}>
              Export CSV
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setSelected('new')}>
              New extension
            </Button>
            <input
              ref={file}
              type="file"
              hidden
              accept=".csv,text/csv"
              aria-label="CSV file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void f.text().then(importCsv);
              }}
            />
          </>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_340px]">
          <Panel bodyClassName="flex flex-col gap-3 pt-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Number, person or department" aria-label="Search extensions" className={cx(INPUT, 'h-8 w-[240px]')} />
              <Pills
                label="Filter extensions"
                value={filter}
                onChange={setFilter}
                options={[
                  { id: 'all', label: `All ${counts.all}` },
                  { id: 'online', label: `Online ${counts.online}` },
                  { id: 'unassigned', label: `Unassigned ${counts.unassigned}` },
                  { id: 'missing', label: `Not on PBX ${counts.missing}` },
                  { id: 'hotdesk', label: `Hot desk ${counts.hotdesk}` },
                ]}
              />
            </div>
            {q.isLoading ? (
              <Spinner />
            ) : q.error ? (
              <Refused error={q.error} onRetry={() => void q.refetch()} />
            ) : list.length === 0 ? (
              <Empty icon="users" title="No extensions match" />
            ) : (
              <Table head={['Ext', 'Person', 'Department', 'PBX', 'Device', 'Registration', 'Recording']}>
                {list.map((e) => (
                  <tr tabIndex={0} onKeyDown={clickOnKey} key={e.id} className={cx(TR, 'cursor-pointer', selected === e.id && 'bg-selection')} onClick={() => setSelected(e.id)}>
                    <td className={TD}>
                      <Mono className="font-bold">{e.extension}</Mono>
                    </td>
                    <td className={TD}>
                      <div className={cx('font-semibold', e.user_id === null && 'text-ink-3')}>{e.user_name ?? (e.user_id === null ? '— Unassigned —' : e.name)}</div>
                      <div className="text-[11px] text-ink-3">{e.user_id === null ? e.name : (e.email ?? e.name)}</div>
                    </td>
                    <td className={TD}>{e.department ?? '—'}</td>
                    <td className={TD}>{e.server ?? '—'}</td>
                    <td className={TD}>
                      <Chip tone="muted">{e.device_type === 'both' ? 'Both' : e.device_type === 'sip' ? 'SIP' : 'WebRTC'}</Chip>
                    </td>
                    <td className={TD}>
                      <span className="flex items-center gap-1.5">
                        <span className={cx('h-2 w-2 shrink-0 rounded-full', e.missing_on_pbx ? 'bg-danger' : e.presence === 'offline' ? 'bg-ink-3/40' : e.presence === 'online' ? 'bg-success' : 'bg-warning')} />
                        <span className="text-[12px]">{e.missing_on_pbx ? 'Missing on PBX' : e.registration?.user_agent ? `${e.registration.user_agent}${e.registration.rtt_ms !== null ? ` · ${e.registration.rtt_ms} ms` : ''}` : e.presence === 'offline' ? 'Not registered' : e.presence.replace('_', ' ')}</span>
                      </span>
                    </td>
                    <td className={TD}>{RECORD[e.record_calls]}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
          {selected !== null ? (
            <Editor
              key={String(selected)}
              ext={current}
              onClose={() => setSelected(null)}
              onCreated={(ext, s) => {
                setSecret({ ext, secret: s });
                setSelected(ext.id);
                refresh();
              }}
              onSecret={(ext, s) => setSecret({ ext, secret: s })}
              onSaved={refresh}
            />
          ) : (
            <Panel title="Choose an extension" sub="Its person, caller ID, server, recording and devices.">
              <span className="text-[12px] text-ink-3">Or create one with New extension.</span>
            </Panel>
          )}
        </div>
      </PageBody>
      {secret ? <SecretWithAddress ext={secret.ext} secret={secret.secret} onClose={() => setSecret(null)} /> : null}
    </div>
  );
}

function SecretWithAddress({ ext, secret, onClose }: { ext: Extension; secret: string; onClose: () => void }) {
  const status = useStatus();
  const servers = useServers();
  const server = servers.data?.servers.find((s) => s.id === ext.server_id) ?? servers.data?.servers.find((s) => s.is_default) ?? null;
  const domain = server?.sip_domain ?? status.data?.websocket.domain ?? null;
  const ws = server?.ws_url ?? (status.data?.websocket.domain ? `wss://${status.data.websocket.domain}${status.data.websocket.path}` : null);
  return <SecretOnce ext={ext} secret={secret} domain={domain} wsUri={ws} onClose={onClose} />;
}

function Editor({ ext, onClose, onCreated, onSecret, onSaved }: { ext: Extension | null; onClose: () => void; onCreated: (e: Extension, secret: string) => void; onSecret: (e: Extension, secret: string) => void; onSaved: () => void }) {
  const people = usePeople();
  const departments = useDepartments();
  const servers = useServers();
  const [f, setF] = useState<ExtensionInput & { extension: string; name: string }>(() => ({
    extension: ext?.extension ?? '',
    name: ext?.name ?? '',
    user_id: ext?.user_id ?? null,
    department_id: ext?.department_id ?? null,
    caller_id: ext?.caller_id ?? '',
    email: ext?.email ?? '',
    device_type: ext?.device_type ?? 'webrtc',
    record_calls: ext?.record_calls ?? 'never',
    voicemail_enabled: ext?.voicemail ?? true,
    branch: ext?.branch ?? '',
    enabled: ext?.enabled ?? true,
    server_id: ext?.server_id ?? null,
    max_contacts: ext?.max_contacts ?? 3,
  }));
  const [saving, setSaving] = useState(false);
  const [allocating, setAllocating] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const valid = /^\d{2,8}$/.test(f.extension);
  const save = async () => {
    setSaving(true);
    try {
      if (!ext) {
        const r = await phoneApi.createExtension({ ...f, name: f.name || undefined });
        onCreated(r.extension, r.sip_secret);
      } else {
        const { extension: _e, voicemail_enabled, ...rest } = f;
        await phoneApi.updateExtension(ext.id, { ...rest, voicemail_enabled });
        if (f.user_id !== ext.user_id) await phoneApi.assign(ext.id, f.user_id ?? null, 'owner').catch(() => undefined);
        toast('success', 'Saved. Apply the configuration (or push to FreePBX) to make it live.');
        onSaved();
      }
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const allocate = async () => {
    setAllocating(true);
    try {
      const r = await phoneApi.allocate({ server_id: f.server_id ?? null, department_id: f.department_id ?? null, branch: f.branch || null });
      set({ extension: r.extension });
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setAllocating(false);
    }
  };
  const regenerate = async () => {
    if (!ext) return;
    try {
      const r = await phoneApi.regenerateSecret(ext.id);
      onSecret(ext, r.sip_secret);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const remove = async () => {
    if (!ext) return;
    try {
      await phoneApi.deleteExtension(ext.id);
      toast('success', `Extension ${ext.extension} removed. Its call history and voicemail are kept.`);
      onSaved();
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  return (
    <Panel
      title={ext ? `Ext ${ext.extension}` : 'New extension'}
      action={ext ? <Chip tone={ext.enabled ? 'success' : 'muted'}>{ext.enabled ? 'Enabled' : 'Disabled'}</Chip> : <button type="button" aria-label="Close" onClick={onClose}><Icon name="x" size={16} /></button>}
      bodyClassName="flex flex-col gap-2.5"
    >
      {!ext ? (
        <Field label="Number" hint="2–8 digits. Allocate takes the next free one from the server’s range for the department.">
          <span className="flex gap-2">
            <input value={f.extension} onChange={(e) => set({ extension: e.target.value.replace(/\D/g, '').slice(0, 8) })} inputMode="numeric" aria-label="Extension number" className={cx(INPUT, 'font-mono')} />
            <Button loading={allocating} onClick={() => void allocate()}>
              Allocate
            </Button>
          </span>
        </Field>
      ) : null}
      <Field label="Person (from HR)">
        <select aria-label="Person" value={f.user_id ?? ''} onChange={(e) => {
          const id = e.target.value ? Number(e.target.value) : null;
          const p = people.data?.find((x) => x.id === id);
          set({ user_id: id, ...(p && !f.name ? { name: p.name } : {}), ...(p && !f.email ? { email: p.email ?? '' } : {}) });
        }} className={INPUT}>
          <option value="">Unassigned (shared or hot desk)</option>
          {(people.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.email ? ` · ${p.email}` : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Display name">
        <input value={f.name} onChange={(e) => set({ name: e.target.value })} aria-label="Display name" className={INPUT} />
      </Field>
      <Field label="Outbound caller ID">
        <input value={f.caller_id ?? ''} onChange={(e) => set({ caller_id: e.target.value })} aria-label="Outbound caller ID" placeholder="+94 11 244 7000" className={cx(INPUT, 'font-mono')} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Department">
          <select aria-label="Department" value={f.department_id ?? ''} onChange={(e) => set({ department_id: e.target.value ? Number(e.target.value) : null })} className={INPUT}>
            <option value="">None</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="PBX server">
          <select aria-label="PBX server" value={f.server_id ?? ''} onChange={(e) => set({ server_id: e.target.value ? Number(e.target.value) : null })} className={INPUT}>
            <option value="">By mapping</option>
            {(servers.data?.servers ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Record calls">
          <select aria-label="Record calls" value={f.record_calls} onChange={(e) => set({ record_calls: e.target.value as RecordPolicy })} className={INPUT}>
            {Object.entries(RECORD).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Simultaneous devices">
          <input value={String(f.max_contacts ?? 3)} onChange={(e) => set({ max_contacts: Math.max(1, Math.min(10, Number(e.target.value.replace(/\D/g, '')) || 1)) })} inputMode="numeric" aria-label="Simultaneous devices" className={INPUT} />
        </Field>
        <Field label="Branch">
          <input value={f.branch ?? ''} onChange={(e) => set({ branch: e.target.value })} aria-label="Branch" className={INPUT} />
        </Field>
        <Field label="Email">
          <input value={f.email ?? ''} onChange={(e) => set({ email: e.target.value })} aria-label="Email" className={INPUT} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-3 text-[12.5px]">
        <label className="flex items-center gap-1.5">
          <Checkbox checked={!!f.voicemail_enabled} onChange={(e) => set({ voicemail_enabled: e.target.checked })} /> Voicemail
        </label>
        <label className="flex items-center gap-1.5">
          <Checkbox checked={f.device_type !== 'sip'} onChange={(e) => set({ device_type: e.target.checked ? (f.device_type === 'sip' ? 'both' : f.device_type) : 'sip' })} /> WebRTC
        </label>
        <label className="flex items-center gap-1.5">
          <Checkbox checked={f.device_type !== 'webrtc'} onChange={(e) => set({ device_type: e.target.checked ? 'both' : 'webrtc' })} /> Desk phone
        </label>
        {ext ? (
          <label className="flex items-center gap-1.5">
            <Checkbox checked={!!f.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled
          </label>
        ) : null}
      </div>
      {ext ? (
        <p className="rounded-[8px] bg-subtle px-3 py-2 text-[11.5px] text-ink-3">
          SIP password {ext.has_secret ? 'set' : 'not set'} · never shown again after creation. Regenerating signs out every device on this extension.
          {ext.created_at ? ` Created ${stamp(ext.created_at)}.` : ''}
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        {ext ? (
          <span className="flex gap-2">
            <ConfirmButton label="Regenerate secret" confirm="Sign out its devices" onConfirm={() => void regenerate()} size="md" />
            <ConfirmButton label="Remove" confirm="Remove extension" variant="secondary" icon="trash" onConfirm={() => void remove()} />
          </span>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        )}
        <Button variant="primary" loading={saving} disabled={!valid} onClick={() => void save()}>
          {ext ? 'Save' : 'Create extension'}
        </Button>
      </div>
    </Panel>
  );
}
