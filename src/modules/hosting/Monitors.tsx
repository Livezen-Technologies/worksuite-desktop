import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { Select } from '../../components/Select';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { ackIncident, addMonitor, fetchIncidents, fetchMonitors, K, type Monitor, type MonitorInput } from './api';
import type { Nav } from './HostingShell';
import { Btn, Field, NeedsUpdate, Note, PageHead, input, useReadOnly, when } from './parts';

/**
 * Monitors (D-06, HDM-MON-01…04): every check with its kind, interval, the last 48 results, response time and uptime;
 * open incidents with Acknowledge; Add monitor. A monitor going down raises a native notification from the main
 * process even with this tab closed (electron/services/hosting-alerts.ts).
 */
export const every = (s: number | null | undefined) => (!s ? '—' : s >= 86_400 ? text('day') : s >= 3600 ? text('{n} h', { n: Math.round(s / 3600) }) : text('{n} min', { n: Math.round(s / 60) }));

export default function Monitors({ org, add }: { org: number; nav: Nav; active: boolean; add: boolean }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(add);
  const q = useQuery({ queryKey: K.monitors({ org }), queryFn: ({ signal }) => fetchMonitors({ org: org || undefined, per_page: 200 }, signal), refetchInterval: 60_000 });
  const inc = useQuery({ queryKey: K.incidents, queryFn: ({ signal }) => fetchIncidents(signal), refetchInterval: 60_000 });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data === null) return <NeedsUpdate what={text('Monitors')} />;
  const items = q.data.items;
  const down = items.filter((m) => m.last_state === 'down').length;
  const ack = async (id: number) => {
    try {
      const r = await ackIncident(id);
      toast(r === null ? 'info' : 'success', r === null ? text('Acknowledging needs a server update.') : text('Acknowledged.'));
      void qc.invalidateQueries({ queryKey: K.incidents });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const open = (inc.data ?? []).filter((i) => !i.closed_at);
  return (
    <div className="flex flex-col gap-3">
      <PageHead title="Monitors" sub={text('{n} checks · {down} down', { n: q.data.total, down })}>
        <Btn primary disabled={ro} title={ro ? 'Needs a connection' : undefined} onClick={() => setAdding(true)}>
          Add monitor
        </Btn>
      </PageHead>
      {open.map((i) => (
        <Note key={i.id} tone="error">
          <span className="min-w-0 flex-1">
            <b>{i.monitor ?? text('Monitor {id}', { id: i.monitor_id })}</b> {text('down since {time}', { time: when(i.opened_at) })}
            {i.first_error ? ` · ${i.first_error}` : ''}
            {i.acknowledged_by ? ` · ${text('acknowledged by {who}', { who: i.acknowledged_by })}` : ''}
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
          <MonitorRow key={m.id} m={m} />
        ))}
        {!items.length ? <p className="m-0 text-[12.5px] text-ink-3">No monitors yet.</p> : null}
      </div>
      {adding && !ro ? (
        <AddMonitor
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

function MonitorRow({ m }: { m: Monitor }) {
  const down = m.last_state === 'down';
  const bars = (m.recent ?? []).slice(-48);
  return (
    <div className={cx('flex items-center gap-3 rounded-[10px] border bg-surface px-3.5 py-2.5', down ? 'border-[#F5C2BD]' : 'border-line')}>
      <span className={cx('size-[9px] shrink-0 rounded-full', down ? 'bg-[#B42318]' : m.last_state === 'up' ? 'bg-[#1F7A4D]' : 'bg-[#8A90A2]')} />
      <div className="w-[240px] min-w-0 shrink-0">
        <div className="truncate text-[13px] font-semibold text-ink">{m.name ?? m.target}</div>
        <div className="text-[11.5px] text-ink-3">{text('{kind} · every {every}', { kind: m.kind.toUpperCase(), every: every(m.interval_s) })}</div>
      </div>
      <div aria-hidden className="flex min-w-0 flex-1 gap-[2px]">
        {bars.map((ok, i) => (
          <span key={i} className={cx('h-[22px] flex-1 rounded-[2px]', ok ? 'bg-[#34A36B]' : 'bg-[#B42318]')} />
        ))}
      </div>
      <span className="w-[64px] text-right text-[12px] text-ink-2 tabular-nums">{down ? text('down') : typeof m.ms === 'number' ? `${m.ms} ms` : (m.last_state ?? '—')}</span>
      <span className="w-[64px] text-right text-[12px] font-semibold text-ink tabular-nums">{m.uptime_30d !== null && m.uptime_30d !== undefined ? `${m.uptime_30d}%` : '—'}</span>
    </div>
  );
}

function AddMonitor({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [m, setM] = useState<MonitorInput>({ kind: 'http', target: '', interval_s: 300, keyword: null, expect_status: 200 });
  const [busy, setBusy] = useState(false);
  const ok = m.target.trim().length > 2 && (m.kind !== 'http' || /^https?:\/\//i.test(m.target.trim()));
  const save = async () => {
    setBusy(true);
    try {
      const r = await addMonitor({ ...m, target: m.target.trim() });
      if (r === null) toast('info', text('Monitors need a server update.'));
      else toast('success', text('Monitoring {target}.', { target: m.target.trim() }));
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
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
            <Select aria-label="Every" value={m.interval_s} onChange={(e) => setM({ ...m, interval_s: Number(e.target.value) })} className={input}>
              <option value={60}>1 minute</option>
              <option value={300}>5 minutes</option>
              <option value={900}>15 minutes</option>
              <option value={86400}>Daily</option>
            </Select>
          </Field>
        </div>
        <Field label={m.kind === 'http' ? 'URL' : m.kind === 'tcp' ? 'Host:port' : 'Host'}>
          <input aria-label="Target" autoFocus placeholder={m.kind === 'http' ? 'https://shop.example.com' : m.kind === 'tcp' ? 'db.example.com:3306' : 'example.com'} value={m.target} onChange={(e) => setM({ ...m, target: e.target.value })} className={input} />
        </Field>
        {m.kind === 'http' ? (
          <Field label="Keyword (optional)">
            <input aria-label="Keyword" value={m.keyword ?? ''} onChange={(e) => setM({ ...m, keyword: e.target.value || null })} className={input} />
          </Field>
        ) : null}
        <p className="m-0 text-[11.5px] text-ink-3">An incident opens after two failed checks in a row and closes when it recovers.</p>
      </div>
    </Modal>
  );
}
