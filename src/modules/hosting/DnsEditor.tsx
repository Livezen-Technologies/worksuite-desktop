import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Checkbox } from '../../components/Checkbox';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { Select } from '../../components/Select';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { changeRecord, createRecord, deleteRecord, fetchDns, fetchLookup, fetchServers, hostOf, K, RECORD_TYPES, recordProblem, refreshDns, refusedCopy, type DnsCopy, type DnsRecord, type Domain, type LiveAnswer, type RecordInput } from './api';
import { Explain } from './Explain';
import { Btn, Chip, Field, Kbd, NeedsUpdate, Note, Table, input, td, useReadOnly, when } from './parts';
import { clickOnKey } from '../../components/press';

/**
 * The DNS editor (D-03, HDM-DNS-01…06) over `GET domains/{id}/dns` — the copy, when it was read, whether it can be
 * read again (`can_refresh`) and changed (`can_edit`), and each record's own `editable`. Add record (⌘N), Re-read
 * (⌘R) and Export zone (a BIND file made from the copy); the record form with type-aware checks, the CNAME rule and a
 * server picker for A/AAAA; Copy as new; Delete after a confirmation. Every change sends the record as it was seen
 * (`was`), and the server reads the zone again first: when the provider has something newer, the change is refused
 * and the fresh copy it sends is shown. **Look up live** asks public resolvers what they answer now, beside the copy.
 */

/** The copy as a BIND zone file (HDM-DNS-07's export, made from what the server sent). */
export function toBind(domain: string, records: DnsRecord[]): string {
  const origin = domain.replace(/\.$/, '');
  const lines = [`$ORIGIN ${origin}.`, '$TTL 3600'];
  for (const r of records) {
    const host = hostOf(r, origin);
    const value = r.type === 'TXT' && !/^".*"$/.test(r.content) ? `"${r.content.replace(/"/g, '\\"')}"` : r.content;
    const pri = (r.type === 'MX' || r.type === 'SRV') && r.priority !== null && r.priority !== undefined && !value.startsWith(`${r.priority} `) ? `${r.priority} ` : '';
    lines.push([host, r.ttl ?? 3600, 'IN', r.type, `${pri}${value}`].join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

/** The zone file's name for the save dialog, which takes a .txt name of safe characters. */
export const zoneFileName = (domain: string) => `${domain.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60)}.zone.txt`;

const blank = (type = 'A'): RecordInput => ({ type, host: '', content: '', ttl: 600, priority: type === 'MX' ? 10 : null });
const inputOf = (r: DnsRecord, domain: string): RecordInput => ({ type: r.type, host: hostOf(r, domain), content: r.content, ttl: r.ttl ?? null, priority: r.priority ?? null, proxied: r.proxied ?? null });

export default function DnsEditor({ domain, active }: { domain: Domain; active: boolean }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const dns = useQuery({ queryKey: K.dns(domain.id), queryFn: ({ signal }) => fetchDns(domain.id, signal) });
  const [at, setAt] = useState(0);
  const [form, setForm] = useState<{ rec: RecordInput; was: DnsRecord | null } | null>(null);
  const [gone, setGone] = useState<DnsRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const copy = dns.data;
  const records = copy?.records ?? [];
  const canEdit = !ro && !!copy?.can_edit;
  const canRefresh = !ro && !!copy?.can_refresh;
  const sel = records[Math.min(at, Math.max(0, records.length - 1))];
  const provider = domain.dns_provider ?? domain.provider_label ?? domain.registrar ?? text('the provider');
  const show = (c: DnsCopy) => qc.setQueryData(K.dns(domain.id), c);

  const reread = async () => {
    if (!canRefresh) return;
    setBusy(true);
    try {
      show(await refreshDns(domain.id));
      toast('success', text('Read the zone again from {provider}.', { provider }));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const exportZone = () => void call('files:saveText', { name: zoneFileName(domain.name), text: toBind(domain.name, records) }).then((where) => where && toast('success', text('Saved to {where}.', { where }))).catch((e) => toast('error', errorMessage(e)));

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
        setForm({ rec: blank(), was: null });
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
      show(await deleteRecord(domain.id, gone));
      toast('success', text('Deleted the {type} record {host}.', { type: gone.type, host: hostOf(gone, domain.name) }));
      setGone(null);
    } catch (e) {
      const fresh = refusedCopy(e);
      if (fresh) show(fresh);
      toast('error', errorMessage(e));
      setGone(null);
    } finally {
      setBusy(false);
    }
  };

  const why = ro ? text('Needs a connection') : copy && !copy.readable ? text('WorkSuite cannot read this zone through {provider}.', { provider }) : copy && !copy.can_edit ? text('You may not change DNS records here, or {provider} does not let WorkSuite change them.', { provider }) : undefined;
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-ink-3">{copy?.refreshed_at ? text('Zone read {time}', { time: when(copy.refreshed_at) }) : copy?.source === 'manual' ? text('Added by hand: no records are read for it.') : null}</span>
        <span className="flex-1" />
        <Btn primary disabled={!canEdit} title={why} onClick={() => setForm({ rec: blank(), was: null })}>
          Add record <Kbd>⌘N</Kbd>
        </Btn>
        <Btn disabled={!canRefresh || busy} title={ro ? 'Needs a connection' : !copy?.can_refresh ? text('Reading the zone again needs Hosting sync, and a provider WorkSuite can read.') : undefined} onClick={() => void reread()}>
          Re-read <Kbd>⌘R</Kbd>
        </Btn>
        <Btn disabled={!records.length} onClick={exportZone}>Export zone</Btn>
        <Btn disabled={ro} title={ro ? 'Needs a connection' : undefined} aria-pressed={live} onClick={() => setLive(!live)}>
          Look up live
        </Btn>
      </div>
      {copy && !copy.readable && copy.source !== 'manual' ? <Note tone="warn">{text('{provider} does not let WorkSuite read this zone. The records are shown as last read.', { provider })}</Note> : null}
      {dns.isPending ? <Spinner /> : dns.isError ? <ErrorNote error={dns.error} onRetry={() => void dns.refetch()} /> : null}
      {live && !ro ? <LivePanel domain={domain} host={sel ? hostOf(sel, domain.name) : '@'} onClose={() => setLive(false)} /> : null}
      {records.length ? (
        <div className="rounded-[10px] border border-line bg-surface">
          <Table head={['Type', 'Host', 'Value', ['TTL', 'r'], '']} label="DNS records">
            {records.map((r, i) => {
              const may = canEdit && r.editable !== false;
              return (
                <tr tabIndex={0} onKeyDown={clickOnKey} key={String(r.id)} aria-selected={i === at} onClick={() => setAt(i)} onDoubleClick={() => may && setForm({ rec: inputOf(r, domain.name), was: r })} className={cx('cursor-default', i === at ? 'bg-[#EEF1FD] shadow-[inset_3px_0_0_#23349E] dark:bg-selection' : 'hover:bg-subtle')}>
                  <td className={cx(td, 'font-mono text-[11.5px] font-bold')}>{r.type}</td>
                  <td className={cx(td, 'font-mono text-[11.5px]')}>{hostOf(r, domain.name)}</td>
                  <td className={cx(td, 'max-w-[420px] truncate font-mono text-[11.5px]')} title={r.content}>
                    {r.priority !== null && r.priority !== undefined && r.type === 'MX' && !r.content.startsWith(`${r.priority} `) ? `${r.priority} ${r.content}` : r.content}
                    {r.proxied ? <Chip tone="amber" className="ml-1.5">{text('proxied')}</Chip> : null}
                  </td>
                  <td className={cx(td, 'text-right tabular-nums')}>{r.ttl ?? '—'}</td>
                  <td className={cx(td, 'text-right')}>
                    {i === at ? (
                      <span className="inline-flex gap-1">
                        <Btn disabled={!may} title={r.editable === false ? text('WorkSuite does not change this record. Change it at {provider}.', { provider }) : why} onClick={() => setForm({ rec: inputOf(r, domain.name), was: r })}>Edit</Btn>
                        <Btn disabled={!canEdit} title={why} onClick={() => setForm({ rec: inputOf(r, domain.name), was: null })}>Copy as new</Btn>
                        <Btn danger disabled={!may} title={why} onClick={() => setGone(r)}>Delete</Btn>
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </Table>
        </div>
      ) : dns.isSuccess ? (
        <p className="m-0 text-[12.5px] text-ink-3">{copy?.can_refresh ? 'No records in the copy yet. Re-read to fetch them from the provider.' : 'No records in the copy.'}</p>
      ) : null}
      {sel ? <Explain kind="dns" id={sel.id} domain={domain.id} label={text('Explain the {type} record {host}', { type: sel.type, host: hostOf(sel, domain.name) })} /> : null}
      {form ? (
        <RecordForm
          domain={domain}
          provider={provider}
          initial={form.rec}
          was={form.was}
          others={records.filter((r) => r.id !== form.was?.id)}
          onCancel={() => setForm(null)}
          onCopy={show}
          onSaved={(c) => {
            setForm(null);
            show(c);
          }}
        />
      ) : null}
      {gone ? (
        <Modal
          title={text('Delete the {type} record {host}?', { type: gone.type, host: hostOf(gone, domain.name) })}
          onClose={() => setGone(null)}
          footer={
            <>
              <Btn onClick={() => setGone(null)}>Cancel</Btn>
              <Btn danger disabled={busy} onClick={() => void remove()}>Delete</Btn>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">{text('It is removed at {provider} and stops answering once resolvers drop their copy.', { provider })}</p>
        </Modal>
      ) : null}
    </div>
  );
}

function RecordForm({ domain, provider, initial, was, others, onCancel, onSaved, onCopy }: { domain: Domain; provider: string; initial: RecordInput; was: DnsRecord | null; others: DnsRecord[]; onCancel: () => void; onSaved: (c: DnsCopy) => void; onCopy: (c: DnsCopy) => void }) {
  const [rec, setRec] = useState<RecordInput>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ip = rec.type === 'A' || rec.type === 'AAAA';
  const servers = useQuery({ queryKey: K.servers({ per_page: 200, org: domain.org_id }), queryFn: ({ signal }) => fetchServers({ per_page: 200, org: domain.org_id }, signal), enabled: ip, staleTime: 300_000 });
  const problem = recordProblem(rec, others, domain.name);
  const save = async () => {
    if (problem) return setErr(problem);
    setBusy(true);
    setErr(null);
    try {
      const body: RecordInput = { type: rec.type, host: rec.host.trim() || '@', content: rec.content.trim(), ttl: rec.ttl ?? null, priority: rec.type === 'MX' || rec.type === 'SRV' ? (rec.priority ?? null) : null, ...(rec.proxied !== null && rec.proxied !== undefined ? { proxied: rec.proxied } : {}) };
      const c = was ? await changeRecord(domain.id, was, body) : await createRecord(domain.id, body);
      toast('success', was ? text('Saved the {type} record.', { type: rec.type }) : text('Added the {type} record.', { type: rec.type }));
      onSaved(c);
    } catch (e) {
      // A newer value at the provider wins: the server sends the fresh copy, shown behind the form.
      const fresh = refusedCopy(e);
      if (fresh) onCopy(fresh);
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
  const proxiable = ['A', 'AAAA', 'CNAME'].includes(rec.type) && (rec.proxied !== null && rec.proxied !== undefined);
  return (
    <Modal
      title={was ? text('Edit {type} record · {host}', { type: rec.type, host: rec.host || '@' }) : text('Add a record to {domain}', { domain: domain.name })}
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
            <Select aria-label="Type" value={rec.type} disabled={!!was} onChange={(e) => setRec({ ...rec, type: e.target.value, priority: e.target.value === 'MX' ? (rec.priority ?? 10) : rec.priority })} className={input}>
              {RECORD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Host">
            <input aria-label="Host" autoFocus placeholder="@ or www" value={rec.host} onChange={(e) => setRec({ ...rec, host: e.target.value })} className={cx(input, 'font-mono')} />
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
        {proxiable ? (
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <Checkbox checked={!!rec.proxied} onChange={(e) => setRec({ ...rec, proxied: e.target.checked })} /> {text('Proxied through {provider}', { provider })}
          </label>
        ) : null}
        {err || (problem && rec.content) ? <Note tone="error">{err ?? problem}</Note> : null}
        <p className="m-0 text-[11.5px] text-ink-3">{text('Saved at {provider} after a fresh read of the zone; a newer value there wins and is shown.', { provider })}</p>
      </div>
    </Modal>
  );
}

/** What public resolvers answer now for one host, beside the copy (HDM-DNS-06, `GET domains/{id}/lookup`). */
function LivePanel({ domain, host: initial, onClose }: { domain: Domain; host: string; onClose: () => void }) {
  const [host, setHost] = useState(initial);
  const [asked, setAsked] = useState(initial);
  const q = useQuery({ queryKey: ['hosting', 'lookup', domain.id, asked], queryFn: () => fetchLookup(domain.id, asked, ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'CAA']), staleTime: 0, gcTime: 0, retry: false });
  const types: LiveAnswer[] = (q.data?.types ?? []).filter((t) => t.stored.length || Object.values(t.resolvers).some((r) => r.values.length || !r.ok));
  const resolvers = [...new Set((q.data?.types ?? []).flatMap((t) => Object.keys(t.resolvers)))];
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-bold text-ink">Live lookup</span>
        <input
          aria-label="Host to look up"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setAsked(host.trim() || '@');
          }}
          className={cx(input, 'w-[220px] font-mono')}
        />
        <span className="text-[11.5px] text-ink-3">{`.${domain.name}`}</span>
        <Btn onClick={() => (host.trim() === asked ? void q.refetch() : setAsked(host.trim() || '@'))}>Look up</Btn>
        <span className="flex-1" />
        <Btn onClick={onClose}>Close</Btn>
      </div>
      {q.isFetching ? <Spinner /> : q.isError ? <ErrorNote error={q.error} /> : q.data === null ? <NeedsUpdate what={text('Live lookup')} /> : (
        <>
          <span className="text-[11.5px] text-ink-3">{text('What {resolvers} answer for {host} now, beside the copy WorkSuite keeps.', { resolvers: resolvers.join(text(' and ')) || text('public resolvers'), host: q.data?.host ?? asked })}</span>
          {types.length ? (
            <Table head={['Type', 'In the copy', ...resolvers.map((r) => r.replace(/^./, (c) => c.toUpperCase())), 'Match']} label="Live lookup">
              {types.map((t) => (
                <tr key={t.type}>
                  <td className={cx(td, 'font-mono text-[11.5px] font-bold')}>{t.type}</td>
                  <td className={cx(td, 'font-mono text-[11.5px] whitespace-normal')}>{t.stored.join(', ') || '—'}</td>
                  {resolvers.map((r) => {
                    const a = t.resolvers[r];
                    return (
                      <td key={r} className={cx(td, 'font-mono text-[11.5px] whitespace-normal')}>
                        {!a ? '—' : a.ok ? a.values.join(', ') || '—' : <span className="text-[#B42318]">{a.why}</span>}
                      </td>
                    );
                  })}
                  <td className={td}>
                    {t.compare.match ? (
                      <Chip tone="green">{text('Same')}</Chip>
                    ) : (
                      <span title={[t.compare.missing.length ? text('Not answered: {v}', { v: t.compare.missing.join(', ') }) : '', t.compare.extra.length ? text('Not in the copy: {v}', { v: t.compare.extra.join(', ') }) : ''].filter(Boolean).join(' · ')}>
                        <Chip tone="amber">{text('Differs')}</Chip>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="m-0 text-[12.5px] text-ink-3">{text('Nothing answers for {host}.', { host: q.data?.host ?? asked })}</p>
          )}
        </>
      )}
    </div>
  );
}
