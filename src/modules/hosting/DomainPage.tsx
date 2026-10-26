import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { authCode, daysLeft, fetchActivity, fetchCertificates, fetchDomain, fetchMonitors, K, nameservers, rdapCheck, renewDomain, setAutoRenew, setLock, type Domain } from './api';
import DnsEditor from './DnsEditor';
import type { Nav } from './HostingShell';
import { Btn, Card, Days, NeedsUpdate, Note, Row, Status, Table, td, useReadOnly, when } from './parts';

/**
 * One domain in its own tab or window (D-03, HDM-DSK-03): Overview, DNS, Certificates, Monitors, Costs and Activity.
 * Renew, auto-renew, lock and the transfer code (HDM-DOM-08) each ask first, saying what it costs where the registrar
 * said; a server without them says it needs an update. A synced domain's registrar-owned facts are not edited here.
 */
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'dns', label: 'DNS' },
  { id: 'certificates', label: 'Certificates' },
  { id: 'monitors', label: 'Monitors' },
  { id: 'costs', label: 'Costs' },
  { id: 'activity', label: 'Activity' },
] as const;

export default function DomainPage({ id, active, tab, onTab, nav }: { id: number; active: boolean; tab: string; onTab: (t: string) => void; nav: Nav }) {
  const one = useQuery({ queryKey: K.domain(id), queryFn: ({ signal }) => fetchDomain(id, signal) });
  const d = one.data;
  useTabTitle(d?.name ?? null);
  if (one.isPending) return <Spinner />;
  if (one.isError) return <ErrorNote error={one.error} onRetry={() => void one.refetch()} />;
  if (!d) return <Note tone="warn">This domain is not in your register any more.</Note>;
  const at = TABS.some((t) => t.id === tab) ? tab : 'overview';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 flex items-center gap-2 text-[21px] font-extrabold tracking-[-.3px] text-ink">
            {d.name} <Days days={daysLeft(d)} long />
          </h1>
          <div className="mt-0.5 text-[12px] text-ink-2">{[d.registrar ?? d.provider ?? text('Manual'), d.synced_at ? text('read {time}', { time: when(d.synced_at) }) : null].filter(Boolean).join(' · ')}</div>
        </div>
        <Btn onClick={() => nav.openDomain(d.id, 'window', d.name, at)}>Pop out</Btn>
      </div>
      <div role="tablist" aria-label={d.name} className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === at} onClick={() => onTab(t.id)} className={cx('-mb-px border-b-2 px-3 py-2 text-[12.5px] font-semibold', t.id === at ? 'border-primary text-ink' : 'border-transparent text-ink-3 hover:text-ink')}>
            {t.label}
            {t.id === 'dns' && d.dns_count ? <span className="ml-1 text-ink-3 tabular-nums">{d.dns_count}</span> : null}
          </button>
        ))}
      </div>
      {at === 'overview' ? <Facts d={d} nav={nav} /> : at === 'dns' ? <DnsEditor domain={d} active={active} /> : at === 'certificates' ? <DomainCerts d={d} nav={nav} /> : at === 'monitors' ? <DomainMonitors d={d} /> : at === 'costs' ? <DomainCosts d={d} /> : <DomainActivity id={d.id} />}
    </div>
  );
}

type Act = 'renew' | 'auto-renew' | 'lock' | 'auth-code';

function Facts({ d, nav }: { d: Domain; nav: Nav }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const [ask, setAsk] = useState<Act | null>(null);
  const [years, setYears] = useState(1);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [missing, setMissing] = useState<Set<Act>>(new Set());
  const off = ro ? 'Needs a connection' : undefined;
  const run = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      const r = ask === 'renew' ? await renewDomain(d.id, years) : ask === 'auto-renew' ? await setAutoRenew(d.id, !d.auto_renew) : ask === 'lock' ? await setLock(d.id, !d.locked) : await authCode(d.id);
      if (r === null) {
        setMissing(new Set([...missing, ask]));
        toast('info', text('This needs a server update.'));
      } else if (ask === 'auth-code') {
        const c = (r as { code?: string; auth_code?: string }).code ?? (r as { auth_code?: string }).auth_code ?? null;
        setCode(c);
      } else {
        toast('success', ask === 'renew' ? text('Renewal sent to {registrar}.', { registrar: d.registrar ?? text('the registrar') }) : text('Done.'));
        void qc.invalidateQueries({ queryKey: K.domain(d.id) });
      }
      if (ask !== 'auth-code') setAsk(null);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const rdap = async () => {
    try {
      const r = await rdapCheck(d.id);
      if (r === null) return toast('info', text('RDAP lookup needs a server update.'));
      toast('success', text('Looked up {name} in RDAP.', { name: d.name }));
      void qc.invalidateQueries({ queryKey: K.domain(d.id) });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const synced = d.source !== 'manual' && !!d.account_id;
  const ns = nameservers(d.nameservers);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card title="Facts">
        <div className="px-3.5 pb-3">
          <Row label="Registrar">{d.registrar ?? d.provider ?? text('Manual')}</Row>
          <Row label="Registered">{when(d.registered_on)}</Row>
          <Row label="Expires">{when(d.expires_on)}</Row>
          <Row label="Auto-renew">{d.auto_renew === null || d.auto_renew === undefined ? '—' : d.auto_renew ? text('On') : text('Off')}</Row>
          <Row label="Lock">{d.locked === null || d.locked === undefined ? '—' : d.locked ? text('Locked') : text('Unlocked')}</Row>
          <Row label="Status">
            <Status value={d.status} />
          </Row>
          <Row label="Nameservers">{ns.length ? ns.join(', ') : '—'}</Row>
          <Row label="Server">
            {d.server_id ? (
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => nav.openServer(d.server_id!, 'tab', d.server ?? undefined)}>
                {d.server ?? `#${d.server_id}`}
              </button>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Client">{d.client ?? '—'}</Row>
          <Row label="Project">{d.project ?? '—'}</Row>
          <Row label="Company">{d.company ?? '—'}</Row>
          {d.notes ? <Row label="Notes">{d.notes}</Row> : null}
          {synced ? <p className="m-0 mt-2 text-[11.5px] text-ink-3">Expiry, auto-renew, status, nameservers and registrar come from the registrar and change there.</p> : null}
        </div>
      </Card>
      <Card title="At the registrar">
        <div className="flex flex-col gap-2 px-3.5 pb-3">
          {(['renew', 'auto-renew', 'lock', 'auth-code'] as Act[]).map((a) =>
            missing.has(a) ? null : (
              <Btn key={a} disabled={ro || !synced} title={off ?? (!synced ? text('Only for domains synced from a registrar account.') : undefined)} onClick={() => (setCode(null), setAsk(a))}>
                {a === 'renew' ? 'Renew…' : a === 'auto-renew' ? (d.auto_renew ? 'Turn auto-renew off…' : 'Turn auto-renew on…') : a === 'lock' ? (d.locked ? 'Unlock…' : 'Lock…') : 'Get transfer code…'}
              </Btn>
            ),
          )}
          {missing.size ? <p className="m-0 text-[11.5px] text-ink-3">Some registrar actions need a server update.</p> : null}
          {!synced ? (
            <Btn disabled={ro} title={off} onClick={() => void rdap()}>
              Look up in RDAP
            </Btn>
          ) : null}
        </div>
      </Card>
      {ask ? (
        <Modal
          title={ask === 'renew' ? text('Renew {name}?', { name: d.name }) : ask === 'auto-renew' ? text('Turn auto-renew {state} for {name}?', { state: d.auto_renew ? text('off') : text('on'), name: d.name }) : ask === 'lock' ? text('{verb} {name}?', { verb: d.locked ? text('Unlock') : text('Lock'), name: d.name }) : text('Transfer code for {name}', { name: d.name })}
          onClose={() => setAsk(null)}
          footer={
            code ? (
              <Btn primary onClick={() => setAsk(null)}>Done</Btn>
            ) : (
              <>
                <Btn onClick={() => setAsk(null)}>Cancel</Btn>
                <Btn primary disabled={busy} onClick={() => void run()}>
                  {ask === 'renew' ? 'Renew' : ask === 'auth-code' ? 'Show code' : 'Confirm'}
                </Btn>
              </>
            )
          }
        >
          {ask === 'renew' ? (
            <div className="flex flex-col gap-2 text-[13px] text-ink-2">
              <label className="flex items-center gap-2">
                Years
                <input aria-label="Years" type="number" min={1} max={10} value={years} onChange={(e) => setYears(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} className="h-8 w-20 rounded-[7px] border border-line bg-surface px-2" />
              </label>
              <p className="m-0">{d.renew_price ? text('{registrar} charges {price} a year; the charge is made there.', { registrar: d.registrar ?? text('The registrar'), price: `${d.renew_currency ?? ''} ${d.renew_price}`.trim() }) : text('The registrar charges the account it is held in.')}</p>
            </div>
          ) : ask === 'auth-code' ? (
            code ? (
              <div className="flex items-center gap-2">
                <code className="rounded-[6px] bg-subtle px-2 py-1 font-mono text-[13px] text-ink select-all">{code}</code>
                <Btn onClick={() => void navigator.clipboard.writeText(code).then(() => toast('success', text('Copied.')))}>Copy</Btn>
              </div>
            ) : (
              <p className="m-0 text-[13px] text-ink-2">Anyone with this code can move the domain to another registrar. WorkSuite records that you asked for it.</p>
            )
          ) : (
            <p className="m-0 text-[13px] text-ink-2">{ask === 'lock' && d.locked ? text('Unlocked, the domain can be transferred away.') : text('The change is made at the registrar.')}</p>
          )}
        </Modal>
      ) : null}
    </div>
  );
}

function DomainCerts({ d, nav }: { d: Domain; nav: Nav }) {
  const q = useQuery({ queryKey: K.certificates({ q: d.name }), queryFn: ({ signal }) => fetchCertificates({ q: d.name, per_page: 100 }, signal) });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorNote error={q.error} />;
  const items = q.data.items.filter((c) => c.domain_id === d.id || c.host === d.name || c.host.endsWith(`.${d.name}`));
  if (!items.length) return <p className="m-0 text-[12.5px] text-ink-3">No certificates are watched for this domain.</p>;
  return (
    <div className="rounded-[10px] border border-line bg-surface">
      <Table head={['Host', 'Status', 'Expires', 'Issuer']} label="Certificates">
        {items.map((c) => (
          <tr key={c.id} className="cursor-pointer hover:bg-subtle" onClick={() => nav.to('certificates', `&certificate=${c.id}`)}>
            <td className={cx(td, 'font-semibold')}>{c.port && c.port !== 443 ? `${c.host}:${c.port}` : c.host}</td>
            <td className={td}>
              <Status value={c.status} />
            </td>
            <td className={td}>
              <Days days={daysLeft(c)} />
            </td>
            <td className={td}>{c.issuer ?? '—'}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function DomainMonitors({ d }: { d: Domain }) {
  const q = useQuery({ queryKey: K.monitors({ q: d.name }), queryFn: ({ signal }) => fetchMonitors({ q: d.name, per_page: 100 }, signal) });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorNote error={q.error} />;
  if (q.data === null) return <NeedsUpdate what={text('Monitors')} />;
  if (!q.data.items.length) return <p className="m-0 text-[12.5px] text-ink-3">No monitors check this domain.</p>;
  return (
    <div className="rounded-[10px] border border-line bg-surface">
      <Table head={['Monitor', 'Kind', 'State', 'Response', 'Uptime 30 d']} label="Monitors">
        {q.data.items.map((m) => (
          <tr key={m.id}>
            <td className={cx(td, 'font-semibold')}>{m.name ?? m.target}</td>
            <td className={td}>{m.kind.toUpperCase()}</td>
            <td className={td}>
              <Status value={m.last_state} />
            </td>
            <td className={td}>{typeof m.ms === 'number' ? `${m.ms} ms` : '—'}</td>
            <td className={td}>{m.uptime_30d !== null && m.uptime_30d !== undefined ? `${m.uptime_30d}%` : '—'}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function DomainCosts({ d }: { d: Domain }) {
  return (
    <Card title="Renewal">
      <div className="px-3.5 pb-3">
        <Row label="Price">{d.renew_price ? `${d.renew_currency ?? ''} ${d.renew_price}`.trim() : '—'}</Row>
        <Row label="Renews">{when(d.expires_on)}</Row>
        <Row label="Auto-renew">{d.auto_renew ? text('On') : text('Off')}</Row>
        {!d.renew_price ? <p className="m-0 mt-2 text-[11.5px] text-ink-3">The registrar has not sent a renewal price for this domain.</p> : null}
      </div>
    </Card>
  );
}

function DomainActivity({ id }: { id: number }) {
  const q = useQuery({ queryKey: K.activity(id), queryFn: ({ signal }) => fetchActivity(id, signal) });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorNote error={q.error} />;
  if (q.data === null) return <NeedsUpdate what={text('The domain timeline')} />;
  if (!q.data.length) return <p className="m-0 text-[12.5px] text-ink-3">Nothing has happened to this domain yet.</p>;
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">
      {q.data.map((a) => (
        <li key={a.id} className="flex gap-3 text-[12.5px]">
          <span className="w-[110px] shrink-0 text-ink-3 tabular-nums">{when(a.at)}</span>
          <span className="min-w-0 flex-1 text-ink">{a.what}</span>
          {a.who ? <span className="text-ink-3">{a.who}</span> : null}
        </li>
      ))}
    </ol>
  );
}
