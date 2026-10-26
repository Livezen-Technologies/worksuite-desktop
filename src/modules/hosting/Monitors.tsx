import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { Select } from '../../components/Select';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { ackIncident, addMonitor, checkMonitor, fetchIncidents, fetchMonitor, fetchMonitors, K, type Monitor, type MonitorInput, type Org } from './api';
import type { Nav } from './HostingShell';
import { Btn, Field, NeedsUpdate, Note, PageHead, input, useReadOnly, when } from './parts';

/**
 * Monitors (D-06, HDM-MON-01…04) from `GET monitors` (Monitors::shape): every check with its kind, interval, state,
 * last response time and uptime over 24 hours and 30 days; a row opens to its last checks (`GET monitors/{id}`) with
 * Check now. Open incidents (`GET incidents?open=1`) with Acknowledge; Add monitor. A monitor going down raises a
 * native notification from the main process even with this tab closed (electron/services/hosting-alerts.ts).
 */
export const every = (s: number | null | undefined) => (!s ? '—' : s >= 86_400 ? text('day') : s >= 3600 ? text('{n} h', { n: Math.round(s / 3600) }) : text('{n} min', { n: Math.round(s / 60) }));
const pct = (v: number | null | undefined) => (typeof v === 'number' ? `${Math.round(v * 100) / 100}%` : '—');

export default function Monitors({ org, add, companies }: { org: number; nav: Nav; active: boolean; add: boolean; companies: Org[] }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(add);
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({ queryKey: K.monitors({ org }), queryFn: ({ signal }) => fetchMonitors({ org: org || undefined, per_page: 200 }, signal), refetchInterval: 60_000 });
  const inc = useQuery({ queryKey: K.incidents, queryFn: ({ signal }) => fetchIncidents(signal), refetchInterval: 60_000 });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data === null) return <NeedsUpdate what={text('Monitors')} />;
  const items = q.data.items;
  const down = q.data.summary.down ?? items.filter((m) => m.state === 'down').length;
  const ack = async (id: number) => {
    try {
      const r = await ackIncident(id);
      toast(r === null ? 'info' : 'success', r === null ? text('Acknowledging needs a server update.') : text('Acknowledged.'));
      void qc.invalidateQueries({ queryKey: K.incidents });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const openIncidents = (inc.data ?? []).filter((i) => i.open !== false && !i.closed_at);
  return (
    <div className="flex flex-col gap-3">
      <PageHead title="Monitors" sub={text('{n} checks · {down} down', { n: q.data.total, down })}>
        <Btn primary disabled={ro} title={ro ? 'Needs a connection' : undefined} onClick={() => setAdding(true)}>
          Add monitor
        </Btn>
      </PageHead>
      {openIncidents.map((i) => (
        <Note key={i.id} tone="error">
          <span className="min-w-0 flex-1">
            <b>{i.monitor || i.target || text('Monitor {id}', { id: i.monitor_id })}</b> {text('down since {time}', { time: when(i.opened_at) })}
            {i.first_error ? ` · ${i.first_error}` : ''}
            {i.acknowledged_by ? ` · ${text('acknowledged by {who}', { who: i.acknowledged_by_name ?? text('somebody') })}` : ''}
          </span>
          {!i.acknowledged_by ? (
            <Btn disabled={ro} onClick={() => void ack(i.id)}>
              Acknowledge
            </Btn>
          ) : null}
        </Note>
      ))}
      <div className="flex flex-col gap-2">
        {items.map((m) => (
          <MonitorRow key={m.id} m={m} open={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} />
        ))}
        {!items.length ? <p className="m-0 text-[12.5px] text-ink-3">No monitors yet.</p> : null}
      </div>
      {adding && !ro ? (
        <AddMonitor
          companies={companies}
          initial={{ org_id: org || companies[0]?.id || 0 }}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            void qc.invalidateQueries({ queryKey: ['hosting', 'monitors'] });
          }}
        />
      ) : null}
    </div>
  );
}

function MonitorRow({ m, open, onToggle }: { m: Monitor; open: boolean; onToggle: () => void }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const down = m.state === 'down';
  const [busy, setBusy] = useState(false);
  const detail = useQuery({ queryKey: K.monitor(m.id), queryFn: ({ signal }) => fetchMonitor(m.id, signal), enabled: open, staleTime: 30_000 });
  const checks = [...(detail.data?.checks ?? [])].slice(0, 48).reverse();
  const check = async () => {
    setBusy(true);
    try {
      const r = await checkMonitor(m.id);
      toast(r.monitor?.state === 'down' ? 'error' : 'success', r.message ?? text('Checked.'));
      void qc.invalidateQueries({ queryKey: ['hosting', 'monitors'] });
      void qc.invalidateQueries({ queryKey: K.monitor(m.id) });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cx('flex flex-col rounded-[10px] border bg-surface', down ? 'border-[#F5C2BD]' : 'border-line')}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex items-center gap-3 px-3.5 py-2.5 text-left">
        <span className={cx('size-[9px] shrink-0 rounded-full', down ? 'bg-[#B42318]' : m.state === 'up' ? 'bg-[#1F7A4D]' : 'bg-[#8A90A2]')} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink">{m.name || m.target}</div>
          <div className="truncate text-[11.5px] text-ink-3">{[text('{kind} · every {every}', { kind: m.kind.toUpperCase(), every: every(m.interval_s) }), m.name ? m.target : null, m.enabled === false ? text('paused') : null].filter(Boolean).join(' · ')}</div>
        </div>
        <span className="w-[120px] truncate text-right text-[12px] text-ink-2 tabular-nums" title={m.last_error ?? undefined}>
          {down ? (m.last_error ?? text('down')) : typeof m.last_ms === 'number' ? `${m.last_ms} ms` : (m.state ?? '—')}
        </span>
        <span className="w-[64px] text-right text-[12px] text-ink-2 tabular-nums" title={text('Uptime, 24 hours')}>{pct(m.uptime_24h)}</span>
        <span className="w-[64px] text-right text-[12px] font-semibold text-ink tabular-nums" title={text('Uptime, 30 days')}>{pct(m.uptime_30d)}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-line/60 px-3.5 py-2.5">
          {detail.isPending ? <Spinner /> : detail.isError ? <ErrorNote error={detail.error} /> : (
            <>
              <div aria-label={text('Last checks')} role="img" className="flex gap-[2px]">
                {checks.map((c, i) => (
                  <span key={i} title={`${when(c.at)} · ${c.ok ? (c.ms !== null ? `${c.ms} ms` : 'OK') : (c.error ?? text('failed'))}`} className={cx('h-[22px] flex-1 rounded-[2px]', c.ok ? 'bg-[#34A36B]' : 'bg-[#B42318]')} />
                ))}
                {!checks.length ? <span className="text-[12px] text-ink-3">{text('Not checked yet.')}</span> : null}
              </div>
              <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
                <span className="flex-1">{m.last_checked_at ? text('Last checked {time}', { time: when(m.last_checked_at) }) : ''}</span>
                <Btn disabled={ro || busy} title={ro ? 'Needs a connection' : undefined} onClick={() => void check()}>
                  {busy ? 'Checking…' : 'Check now'}
                </Btn>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

const INTERVALS: Array<[MonitorInput['interval_s'], string]> = [[60, '1 minute'], [300, '5 minutes'], [900, '15 minutes']];

export function AddMonitor({ companies, initial, onClose, onDone }: { companies: Org[]; initial: Partial<MonitorInput>; onClose: () => void; onDone: () => void }) {
  const [m, setM] = useState<MonitorInput>({ org_id: companies[0]?.id ?? 0, kind: 'http', target: '', interval_s: 300, keyword: null, expect_status: 200, ...initial });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = m.org_id > 0 && m.target.trim().length > 2 && (m.kind !== 'http' || /^https?:\/\//i.test(m.target.trim()));
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await addMonitor({ ...m, target: m.target.trim(), keyword: m.kind === 'http' ? m.keyword || null : null, expect_status: m.kind === 'http' ? m.expect_status : null });
      if (r === null) toast('info', text('Monitors need a server update.'));
      else toast('success', text('Monitoring {target}.', { target: m.target.trim() }));
      onDone();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Add monitor"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary disabled={!ok || busy} onClick={() => void save()}>Add</Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <Select aria-label="Kind" value={m.kind} onChange={(e) => setM({ ...m, kind: e.target.value as MonitorInput['kind'] })} className={input}>
              <option value="http">HTTP(S)</option>
              <option value="ping">Ping</option>
              <option value="tcp">TCP port</option>
              <option value="dns">DNS</option>
            </Select>
          </Field>
          <Field label="Every">
            <Select aria-label="Every" value={m.interval_s} onChange={(e) => setM({ ...m, interval_s: Number(e.target.value) as MonitorInput['interval_s'] })} className={input}>
              {INTERVALS.map(([v, l]) => (
                <option key={v} value={v}>
                  {text(l)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={m.kind === 'http' ? 'URL' : m.kind === 'tcp' ? 'Host:port' : 'Host'}>
          <input aria-label="Target" autoFocus placeholder={m.kind === 'http' ? 'https://shop.example.com' : m.kind === 'tcp' ? 'db.example.com:3306' : 'example.com'} value={m.target} onChange={(e) => setM({ ...m, target: e.target.value })} className={input} />
        </Field>
        {m.kind === 'http' ? (
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
            <Field label="Keyword (optional)">
              <input aria-label="Keyword" value={m.keyword ?? ''} onChange={(e) => setM({ ...m, keyword: e.target.value || null })} className={input} />
            </Field>
            <Field label="Expected status">
              <input aria-label="Expected status" type="number" value={m.expect_status ?? ''} onChange={(e) => setM({ ...m, expect_status: e.target.value ? Number(e.target.value) : null })} className={input} />
            </Field>
          </div>
        ) : null}
        {companies.length > 1 && !initial.domain_id ? (
          <Field label="Company">
            <Select aria-label="Company" value={m.org_id} onChange={(e) => setM({ ...m, org_id: Number(e.target.value) })} className={input}>
              {companies.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <p className="m-0 text-[11.5px] text-ink-3">An incident opens after two failed checks in a row and closes when it recovers.</p>
        {err ? <Note tone="error">{err}</Note> : null}
      </div>
    </Modal>
  );
}
