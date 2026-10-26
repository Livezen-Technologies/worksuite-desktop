import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { Select } from '../../components/Select';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { deleteRecord, fetchDns, fetchServers, K, RECORD_TYPES, recordProblem, refreshDns, saveRecord, type DnsRecord, type Domain, type RecordInput } from './api';
import { Explain } from './Explain';
import { Btn, Field, Kbd, Note, Table, input, td, useReadOnly, when } from './parts';

/**
 * The DNS editor (D-03, HDM-DNS-01…05): the synced copy of the zone with type, host, value and TTL; Add record (⌘N),
 * Re-read (⌘R) and Export zone (BIND, from the copy); the record form with type-aware checks, the CNAME rule and a
 * server picker for A/AAAA; Copy as new; Delete after a confirmation. A provider that does not allow edits says why,
 * and offline every change is off. The server re-reads the zone before saving: a newer value there wins and is shown.
 */

/** The copy as a BIND zone file (HDM-DNS-07's export, made from what the server sent). */
export function toBind(domain: string, records: DnsRecord[]): string {
  const origin = domain.replace(/\.$/, '');
  const lines = [`$ORIGIN ${origin}.`, '$TTL 3600'];
  for (const r of records) {
    const host = !r.name || r.name === '@' ? '@' : r.name.replace(new RegExp(`\\.?${origin.replace(/\./g, '\\.')}\\.?$`, 'i'), '') || '@';
    const value = r.type === 'TXT' && !/^".*"$/.test(r.content) ? `"${r.content.replace(/"/g, '\\"')}"` : r.content;
    const pri = (r.type === 'MX' || r.type === 'SRV') && r.priority !== null && r.priority !== undefined && !value.startsWith(`${r.priority} `) ? `${r.priority} ` : '';
    lines.push([host, r.ttl ?? 3600, 'IN', r.type, `${pri}${value}`].join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

const blank = (type = 'A'): RecordInput => ({ type, name: '', content: '', ttl: 600, priority: type === 'MX' ? 10 : null });

export default function DnsEditor({ domain, active }: { domain: Domain; active: boolean }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const dns = useQuery({ queryKey: K.dns(domain.id), queryFn: ({ signal }) => fetchDns(domain.id, signal) });
  const [at, setAt] = useState(0);
  const [form, setForm] = useState<{ rec: RecordInput; id: number | string | null } | null>(null);
  const [gone, setGone] = useState<DnsRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const records = dns.data?.records ?? [];
  const editable = dns.data?.editable ?? domain.dns_editable ?? true;
  const why = dns.data?.reason ?? domain.dns_readonly_reason ?? null;
  const canEdit = !ro && editable !== false;
  const sel = records[Math.min(at, Math.max(0, records.length - 1))];

  const reread = async () => {
    if (ro) return;
    setBusy(true);
    try {
      await refreshDns(domain.id);
      await qc.invalidateQueries({ queryKey: K.dns(domain.id) });
      toast('success', text('Read the zone again from {provider}.', { provider: domain.dns_provider ?? domain.registrar ?? text('the provider') }));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const exportZone = () => void call('files:saveText', { name: `${domain.name}.zone`, text: toBind(domain.name, records) }).catch((e) => toast('error', errorMessage(e)));

  const keys = useRef({ canEdit, reread, form, sel });
  useEffect(() => {
    keys.current = { canEdit, reread, form, sel };
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (keys.current.form) return;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'n' && keys.current.canEdit) {
        e.preventDefault();
        setForm({ rec: blank(), id: null });
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        void keys.current.reread();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const remove = async () => {
    if (!gone) return;
    setBusy(true);
    try {
      await deleteRecord(domain.id, gone.id);
      toast('success', text('Deleted the {type} record {host}.', { type: gone.type, host: gone.name || '@' }));
      setGone(null);
      void qc.invalidateQueries({ queryKey: K.dns(domain.id) });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-ink-3">{dns.data?.readAt ? text('Zone read {time}', { time: when(dns.data.readAt) }) : null}</span>
        <span className="flex-1" />
        <Btn primary disabled={!canEdit} title={ro ? 'Needs a connection' : (why ?? undefined)} onClick={() => setForm({ rec: blank(), id: null })}>
          Add record <Kbd>⌘N</Kbd>
        </Btn>
        <Btn disabled={ro || busy} title={ro ? 'Needs a connection' : undefined} onClick={() => void reread()}>
          Re-read <Kbd>⌘R</Kbd>
        </Btn>
        <Btn disabled={!records.length} onClick={exportZone}>Export zone</Btn>
      </div>
      {editable === false ? <Note tone="warn">{why ?? text('This provider does not let WorkSuite change records. They are shown as last read.')}</Note> : null}
      {dns.isPending ? <Spinner /> : dns.isError ? <ErrorNote error={dns.error} onRetry={() => void dns.refetch()} /> : null}
      {records.length ? (
        <div className="rounded-[10px] border border-line bg-surface">
          <Table head={['Type', 'Host', 'Value', ['TTL', 'r'], '']} label="DNS records">
            {records.map((r, i) => (
              <tr key={String(r.id)} aria-selected={i === at} onClick={() => setAt(i)} onDoubleClick={() => canEdit && setForm({ rec: { type: r.type, name: r.name, content: r.content, ttl: r.ttl ?? null, priority: r.priority ?? null }, id: r.id })} className={cx('cursor-default', i === at ? 'bg-[#EEF1FD] shadow-[inset_3px_0_0_#23349E] dark:bg-selection' : 'hover:bg-subtle')}>
                <td className={cx(td, 'font-mono text-[11.5px] font-bold')}>{r.type}</td>
                <td className={cx(td, 'font-mono text-[11.5px]')}>{r.name || '@'}</td>
                <td className={cx(td, 'max-w-[420px] truncate font-mono text-[11.5px]')} title={r.content}>
                  {r.priority !== null && r.priority !== undefined && r.type === 'MX' && !r.content.startsWith(`${r.priority} `) ? `${r.priority} ${r.content}` : r.content}
                </td>
                <td className={cx(td, 'text-right tabular-nums')}>{r.ttl ?? '—'}</td>
                <td className={cx(td, 'text-right')}>
                  {i === at ? (
                    <span className="inline-flex gap-1">
                      <Btn disabled={!canEdit} onClick={() => setForm({ rec: { type: r.type, name: r.name, content: r.content, ttl: r.ttl ?? null, priority: r.priority ?? null }, id: r.id })}>Edit</Btn>
                      <Btn disabled={!canEdit} onClick={() => setForm({ rec: { type: r.type, name: r.name, content: r.content, ttl: r.ttl ?? null, priority: r.priority ?? null }, id: null })}>Copy as new</Btn>
                      <Btn danger disabled={!canEdit} onClick={() => setGone(r)}>Delete</Btn>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      ) : dns.isSuccess ? (
        <p className="m-0 text-[12.5px] text-ink-3">No records in the copy yet. Re-read to fetch them from the provider.</p>
      ) : null}
      {sel ? <Explain kind="dns" id={sel.id} domain={domain.id} label={text('Explain the {type} record {host}', { type: sel.type, host: sel.name || '@' })} /> : null}
      {form ? (
        <RecordForm
          domain={domain}
          initial={form.rec}
          id={form.id}
          others={records.filter((r) => r.id !== form.id)}
          onCancel={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            void qc.invalidateQueries({ queryKey: K.dns(domain.id) });
          }}
        />
      ) : null}
      {gone ? (
        <Modal
          title={text('Delete the {type} record {host}?', { type: gone.type, host: gone.name || '@' })}
          onClose={() => setGone(null)}
          footer={
            <>
              <Btn onClick={() => setGone(null)}>Cancel</Btn>
              <Btn danger disabled={busy} onClick={() => void remove()}>Delete</Btn>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">{text('It is removed at {provider} and stops answering once resolvers drop their copy.', { provider: domain.dns_provider ?? domain.registrar ?? text('the provider') })}</p>
        </Modal>
      ) : null}
    </div>
  );
}

function RecordForm({ domain, initial, id, others, onCancel, onSaved }: { domain: Domain; initial: RecordInput; id: number | string | null; others: DnsRecord[]; onCancel: () => void; onSaved: () => void }) {
  const [rec, setRec] = useState<RecordInput>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ip = rec.type === 'A' || rec.type === 'AAAA';
  const servers = useQuery({ queryKey: ['hosting', 'servers', { per_page: 200 }], queryFn: ({ signal }) => fetchServers({ per_page: 200 }, signal), enabled: ip, staleTime: 300_000 });
  const problem = recordProblem(rec, others);
  const save = async () => {
    if (problem) return setErr(problem);
    setBusy(true);
    setErr(null);
    try {
      await saveRecord(domain.id, { ...rec, name: rec.name.trim() || '@', content: rec.content.trim() }, id);
      toast('success', id === null ? text('Added the {type} record.', { type: rec.type }) : text('Saved the {type} record.', { type: rec.type }));
      onSaved();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    }
  };
  const picks = (servers.data?.items ?? []).flatMap((s) => {
    const v = rec.type === 'A' ? s.ipv4 : s.ipv6;
    return v ? [{ id: s.id, label: `${s.name} · ${v}`, value: v.split('/')[0]! }] : [];
  });
  return (
    <Modal
      title={id === null ? text('Add a record to {domain}', { domain: domain.name }) : text('Edit {type} record · {host}', { type: rec.type, host: rec.name || '@' })}
      onClose={onCancel}
      width={520}
      footer={
        <>
          <Btn onClick={onCancel}>
            Cancel <Kbd>Esc</Kbd>
          </Btn>
          <Btn primary disabled={busy || !!problem} onClick={() => void save()}>
            Save <Kbd>⌘S</Kbd>
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3" onKeyDown={onKey}>
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
          <Field label="Type">
            <Select aria-label="Type" value={rec.type} disabled={id !== null} onChange={(e) => setRec({ ...rec, type: e.target.value, priority: e.target.value === 'MX' ? (rec.priority ?? 10) : rec.priority })} className={input}>
              {RECORD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Host">
            <input aria-label="Host" autoFocus placeholder="@ or www" value={rec.name} onChange={(e) => setRec({ ...rec, name: e.target.value })} className={cx(input, 'font-mono')} />
          </Field>
        </div>
        <Field label={rec.type === 'A' ? 'IPv4 address' : rec.type === 'AAAA' ? 'IPv6 address' : 'Value'}>
          <input aria-label="Value" value={rec.content} onChange={(e) => setRec({ ...rec, content: e.target.value })} className={cx(input, 'font-mono')} />
        </Field>
        {ip && picks.length ? (
          <Field label="Pick from your servers">
            <Select aria-label="Pick from your servers" value="" onChange={(e) => e.target.value && setRec({ ...rec, content: e.target.value })} className={input}>
              <option value="">{text('Choose a server…')}</option>
              {picks.map((p) => (
                <option key={p.id} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="TTL">
            <input aria-label="TTL" type="number" min={60} value={rec.ttl ?? ''} onChange={(e) => setRec({ ...rec, ttl: e.target.value === '' ? null : Number(e.target.value) })} className={input} />
          </Field>
          {rec.type === 'MX' ? (
            <Field label="Priority">
              <input aria-label="Priority" type="number" min={0} value={rec.priority ?? ''} onChange={(e) => setRec({ ...rec, priority: e.target.value === '' ? null : Number(e.target.value) })} className={input} />
            </Field>
          ) : null}
        </div>
        {err || (problem && rec.content) ? <Note tone="error">{err ?? problem}</Note> : null}
        <p className="m-0 text-[11.5px] text-ink-3">{text('Saved at {provider} after a fresh read of the zone; a newer value there wins and is shown.', { provider: domain.dns_provider ?? domain.registrar ?? text('the provider') })}</p>
      </div>
    </Modal>
  );
}
