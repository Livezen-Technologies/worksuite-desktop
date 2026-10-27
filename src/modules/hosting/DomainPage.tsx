import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { authCode, daysLeft, domainTask, fetchActivity, fetchDomain, K, money, nameservers, offers, rdapApply, renewDomain, setAutoRenew, setLock, type DomainDetail } from './api';
import DnsEditor from './DnsEditor';
import type { Nav } from './HostingShell';
import { EditLinks } from './Links';
import { Btn, Card, Chip, Days, NeedsUpdate, Note, Row, Status, Table, td, tdr, useReadOnly, when } from './parts';
import { withStepUp } from './StepUp';
import { clickOnKey } from '../../components/press';

/**
 * One domain in its own tab or window (D-03, HDM-DSK-03) from `GET domains/{id}`: Overview, DNS, Certificates,
 * Monitors, Costs and Activity. Renew, auto-renew, lock and the transfer code (HDM-DOM-08) are offered only where the
 * registrar's API has them (the row's `supports`), each asks first, and renew and the transfer code ask the person to
 * confirm it is them (HDM-SEC-05). A synced domain's registrar-owned facts are not edited here; its links are.
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
  const count = (t: string) => (t === 'dns' ? d.dns?.records.length : t === 'certificates' ? d.certificates?.length : t === 'monitors' ? d.monitors?.length : undefined);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 flex items-center gap-2 text-[21px] font-extrabold tracking-[-.3px] text-ink">
            {d.name} <Days days={daysLeft(d)} long />
          </h1>
          <div className="mt-0.5 text-[12px] text-ink-2">{[d.source === 'manual' ? text('Added by hand') : (d.provider_label ?? d.registrar), d.account_name, d.dns?.refreshed_at ? text('zone read {time}', { time: when(d.dns.refreshed_at) }) : d.synced_at ? text('read {time}', { time: when(d.synced_at) }) : null].filter(Boolean).join(' · ')}</div>
        </div>
        <Btn onClick={() => nav.openDomain(d.id, 'window', d.name, at)}>Pop out</Btn>
      </div>
      <div role="tablist" aria-label={d.name} className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === at} onClick={() => onTab(t.id)} className={cx('-mb-px border-b-2 px-3 py-2 text-[12.5px] font-semibold', t.id === at ? 'border-primary text-ink' : 'border-transparent text-ink-3 hover:text-ink')}>
            {t.label}
            {count(t.id) ? <span className="ml-1 text-ink-3 tabular-nums">{count(t.id)}</span> : null}
          </button>
        ))}
      </div>
      {at === 'overview' ? <Facts d={d} nav={nav} /> : at === 'dns' ? <DnsEditor domain={d} active={active} /> : at === 'certificates' ? <DomainCerts d={d} nav={nav} /> : at === 'monitors' ? <DomainMonitors d={d} nav={nav} /> : at === 'costs' ? <DomainCosts d={d} /> : <DomainActivity id={d.id} />}
    </div>
  );
}

type Act = 'renew' | 'auto_renew' | 'lock' | 'auth_code';
const ACTS: Act[] = ['renew', 'auto_renew', 'lock', 'auth_code'];

function Facts({ d, nav }: { d: DomainDetail; nav: Nav }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const [ask, setAsk] = useState<Act | null>(null);
  const [years, setYears] = useState(1);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [links, setLinks] = useState(false);
  const off = ro ? 'Needs a connection' : undefined;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.domain(d.id) });
    void qc.invalidateQueries({ queryKey: ['hosting', 'domains'] });
    void qc.invalidateQueries({ queryKey: ['hosting', 'overview'] });
  };
  const why = (a: Act) => (a === 'renew' ? text('Renewing {name}', { name: d.name }) : a === 'auth_code' ? text('The transfer code for {name}', { name: d.name }) : a === 'lock' ? text('Changing the lock on {name}', { name: d.name }) : text('Changing auto-renew on {name}', { name: d.name }));
  const run = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      if (ask === 'auth_code') {
        const r = await withStepUp(why(ask), (p) => authCode(d.id, p));
        setCode(r?.code ?? null);
        if (!r?.code) toast('info', text('The registrar sent no code.'));
      } else if (ask === 'renew') {
        const r = await withStepUp(why(ask), (p) => renewDomain(d.id, years, p));
        toast('success', r?.expires_on ? text('Renewed. It now expires on {date}.', { date: when(r.expires_on) }) : text('Renewed.'));
        setAsk(null);
        refresh();
      } else {
        await withStepUp(why(ask), (p) => (ask === 'auto_renew' ? setAutoRenew(d.id, !d.auto_renew, p) : setLock(d.id, !d.locked, p)));
        toast('success', ask === 'lock' ? (d.locked ? text('Unlocked.') : text('Locked.')) : d.auto_renew ? text('Auto-renew off.') : text('Auto-renew on.'));
        setAsk(null);
        refresh();
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const rdap = async () => {
    try {
      const r = await rdapApply(d.id);
      if (r === null) return toast('info', text('RDAP lookup needs a server update.'));
      toast('success', r.message ?? text('Looked up {name} in RDAP.', { name: d.name }));
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const task = async () => {
    try {
      const m = await domainTask(d.id);
      toast(m === null ? 'info' : 'success', m === null ? text('Renewal tasks need a server update.') : m || text('Renewal task created.'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const synced = d.source === 'sync';
  const ns = nameservers(d.nameservers);
  const offered = ACTS.filter((a) => offers(d, a));
  const label = (a: Act) => (a === 'renew' ? 'Renew…' : a === 'auto_renew' ? (d.auto_renew ? 'Turn auto-renew off…' : 'Turn auto-renew on…') : a === 'lock' ? (d.locked ? 'Unlock…' : 'Lock…') : 'Get transfer code…');
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card title="Facts" action={<Btn disabled={ro} title={off} onClick={() => setLinks(true)}>Edit links…</Btn>}>
        <div className="px-3.5 pb-3">
          <Row label="Registrar">{d.registrar ?? d.provider_label ?? (d.source === 'manual' ? text('Added by hand') : '—')}</Row>
          <Row label="Registered">{when(d.registered_on)}</Row>
          <Row label="Expires">{d.expires_on ? `${when(d.expires_on)}${d.left ? ` · ${d.left}` : ''}` : '—'}</Row>
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
          <Row label="Customer">{d.client ?? '—'}</Row>
          <Row label="Project">{d.project ?? '—'}</Row>
          <Row label="Responsible">{d.owner ?? '—'}</Row>
          {d.tags?.length ? (
            <Row label="Tags">
              <span className="flex flex-wrap gap-1">
                {d.tags.map((t) => (
                  <Chip key={t} tone="grey">
                    {t}
                  </Chip>
                ))}
              </span>
            </Row>
          ) : null}
          {d.group ? <Row label="Group">{d.group}</Row> : null}
          {d.notes ? <Row label="Notes">{d.notes}</Row> : null}
          {synced ? <p className="m-0 mt-2 text-[11.5px] text-ink-3">Expiry, auto-renew, status, nameservers and registrar come from the registrar and change there.</p> : null}
        </div>
      </Card>
      <Card title="At the registrar">
        <div className="flex flex-col gap-2 px-3.5 pb-3">
          {offered.map((a) => (
            <Btn key={a} disabled={ro} title={off} onClick={() => (setCode(null), setAsk(a))}>
              {label(a)}
            </Btn>
          ))}
          {synced && !offered.length ? <p className="m-0 text-[12px] text-ink-3">{text('{provider} does not offer renewing, locking or the transfer code through its API.', { provider: d.provider_label ?? text('The registrar') })}</p> : null}
          {!synced ? <p className="m-0 text-[12px] text-ink-3">Added by hand: there is no registrar account to act through. RDAP fills the registrar and dates from the registry.</p> : null}
          {!synced ? (
            <Btn disabled={ro} title={off} onClick={() => void rdap()}>
              Fill from RDAP
            </Btn>
          ) : null}
          {d.tasks_available ? (
            <Btn disabled={ro} title={off} onClick={() => void task()}>
              Create renewal task
            </Btn>
          ) : null}
          {d.actions?.length ? (
            <div className="mt-1 border-t border-line/60 pt-2">
              <div className="mb-1 text-[11.5px] font-semibold text-ink-3">Recent actions</div>
              {d.actions.slice(0, 5).map((x) => (
                <div key={x.id} className="flex gap-2 text-[11.5px]">
                  <Status value={x.status} />
                  <span className="min-w-0 flex-1 truncate text-ink-2" title={x.result ?? undefined}>{x.result ?? x.action}</span>
                  <span className="text-ink-3 tabular-nums">{when(x.at)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Card>
      {links ? <EditLinks d={d} onClose={() => setLinks(false)} /> : null}
      {ask ? (
        <Modal
          title={ask === 'renew' ? text('Renew {name}?', { name: d.name }) : ask === 'auto_renew' ? text('Turn auto-renew {state} for {name}?', { state: d.auto_renew ? text('off') : text('on'), name: d.name }) : ask === 'lock' ? text('{verb} {name}?', { verb: d.locked ? text('Unlock') : text('Lock'), name: d.name }) : text('Transfer code for {name}', { name: d.name })}
          onClose={() => setAsk(null)}
          footer={
            code ? (
              <Btn primary onClick={() => setAsk(null)}>Done</Btn>
            ) : (
              <>
                <Btn onClick={() => setAsk(null)}>Cancel</Btn>
                <Btn primary disabled={busy} onClick={() => void run()}>
                  {ask === 'renew' ? (d.renew_price ? text('Renew for {price}', { price: money(Number(d.renew_price) * years, d.renew_currency) }) : text('Renew')) : ask === 'auth_code' ? text('Show code') : text('Confirm')}
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
              <p className="m-0">{d.renew_price ? text('{registrar} lists {price} a year; the charge is made there.', { registrar: d.provider_label ?? text('The registrar'), price: money(d.renew_price, d.renew_currency) }) : text('The registrar charges the account it is held in.')}</p>
              <p className="m-0">This spends money at the registrar and cannot be undone here. You may be asked to confirm it is you. The new expiry is read back from the registrar.</p>
            </div>
          ) : ask === 'auth_code' ? (
            code ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <code className="rounded-[6px] bg-subtle px-2 py-1 font-mono text-[13px] text-ink select-all">{code}</code>
                  <Btn onClick={() => void navigator.clipboard.writeText(code).then(() => toast('success', text('Copied.')))}>Copy</Btn>
                </div>
                <p className="m-0 text-[12px] text-ink-3">Shown once. WorkSuite does not keep it.</p>
              </div>
            ) : (
              <p className="m-0 text-[13px] text-ink-2">Anyone with this code can move the domain to another registrar. You will be asked to confirm it is you, and WorkSuite records that you asked for it.</p>
            )
          ) : (
            <p className="m-0 text-[13px] text-ink-2">{ask === 'lock' && d.locked ? text('Unlocked, the domain can be transferred away.') : text('The change is made at the registrar.')}</p>
          )}
        </Modal>
      ) : null}
    </div>
  );
}

function DomainCerts({ d, nav }: { d: DomainDetail; nav: Nav }) {
  const items = d.certificates ?? [];
  if (!items.length) return <p className="m-0 text-[12.5px] text-ink-3">No certificates are watched for this domain.</p>;
  return (
    <div className="rounded-[10px] border border-line bg-surface">
      <Table head={['Host', 'Status', 'Expires', 'Issuer']} label="Certificates">
        {items.map((c) => (
          <tr tabIndex={0} onKeyDown={clickOnKey} key={c.id} className="cursor-pointer hover:bg-subtle" onClick={(e) => nav.to('certificates', `&certificate=${c.id}`, e.metaKey || e.ctrlKey)}>
            <td className={cx(td, 'font-semibold')}>{c.label ?? (c.port && c.port !== 443 ? `${c.host}:${c.port}` : c.host)}</td>
            <td className={td}>
              <Status value={c.status} label={c.status_words} />
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

function DomainMonitors({ d, nav }: { d: DomainDetail; nav: Nav }) {
  const items = d.monitors ?? [];
  if (!items.length) return <p className="m-0 text-[12.5px] text-ink-3">No monitors check this domain.</p>;
  return (
    <div className="rounded-[10px] border border-line bg-surface">
      <Table head={['Monitor', 'Kind', 'State', 'Response', 'Uptime 30 d']} label="Monitors">
        {items.map((m) => (
          <tr tabIndex={0} onKeyDown={clickOnKey} key={m.id} className="cursor-pointer hover:bg-subtle" onClick={() => nav.to('monitors')}>
            <td className={cx(td, 'font-semibold')}>{m.name || m.target}</td>
            <td className={td}>{m.kind.toUpperCase()}</td>
            <td className={td}>
              <Status value={m.state} />
            </td>
            <td className={td}>{typeof m.last_ms === 'number' ? `${m.last_ms} ms` : '—'}</td>
            <td className={td}>{typeof m.uptime_30d === 'number' ? `${m.uptime_30d}%` : '—'}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function DomainCosts({ d }: { d: DomainDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <Card title="Renewal">
        <div className="px-3.5 pb-3">
          <Row label="Price">{d.renew_price ? `${money(d.renew_price, d.renew_currency)}${d.renew_years && d.renew_years > 1 ? ` / ${text('{n} years', { n: d.renew_years })}` : ` / ${text('year')}`}` : '—'}</Row>
          <Row label="Per month">{typeof d.renew_monthly === 'number' ? money(d.renew_monthly, d.renew_currency) : '—'}</Row>
          <Row label="Renews">{when(d.expires_on)}</Row>
          <Row label="Auto-renew">{d.auto_renew === null || d.auto_renew === undefined ? '—' : d.auto_renew ? text('On') : text('Off')}</Row>
          {!d.renew_price ? <p className="m-0 mt-2 text-[11.5px] text-ink-3">No renewal price is recorded for this domain.</p> : null}
        </div>
      </Card>
      <Card title="Paid">
        {d.costs?.length ? (
          <Table head={['Period', 'Source', 'Note', ['Amount', 'r']]} label="Paid">
            {d.costs.map((c) => (
              <tr key={c.id}>
                <td className={td}>{[when(c.period_start), c.period_end ? when(c.period_end) : null].filter(Boolean).join(' → ')}</td>
                <td className={td}>{c.source ?? '—'}</td>
                <td className={cx(td, 'whitespace-normal text-ink-2')}>{c.note ?? ''}</td>
                <td className={tdr}>{money(c.amount, c.currency)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="m-0 px-3.5 pb-3 text-[12.5px] text-ink-3">Nothing recorded as paid yet.</p>
        )}
      </Card>
    </div>
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
      {q.data.map((a, i) => (
        <li key={`${a.at}-${i}`} className="flex gap-3 text-[12.5px]">
          <span className="w-[110px] shrink-0 text-ink-3 tabular-nums">{when(a.at)}</span>
          <span className="min-w-0 flex-1 text-ink">{a.text}</span>
          {a.by ? <span className="text-ink-3">{a.by}</span> : <span className="text-ink-3">{text('Sync')}</span>}
        </li>
      ))}
    </ol>
  );
}
