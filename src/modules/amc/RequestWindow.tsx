import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { useTabTitle } from '../../core/tab-context';
import { Button, cx, ErrorNote, OfflineNote, Spinner } from '../../components/ui';
import { can, K, label, read, requestAction, type Options, type RequestDetail, type Row } from './api';

/**
 * D-03 the request window (WS-AMC-SRS-001 §15, T-02): one service request — who, what, its service levels, its
 * visits, the customer messages sent about it and its history, in tabs — and what the desk does next: acknowledge or
 * log the first call (`contact`, the request's response, Q-04), give it to a technician (the dispatch timeline),
 * reopen it. In the main window, or alone in a window of its own (`&solo=1`). Read offline from the saved copy; every
 * button is off offline.
 */
type Tab = 'details' | 'visits' | 'messages' | 'history';
const TABS: Array<[Tab, string]> = [['details', 'Details'], ['visits', 'Visits'], ['messages', 'Messages'], ['history', 'History']];

export default function RequestWindow({ id, options, offline, solo, onBack, onPopOut, onGive }: {
  id: number; options?: Options; offline: boolean; solo?: boolean; onBack?: () => void; onPopOut?: (id: number) => void; onGive: (id: number) => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('details');
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: K.record('request', id), queryFn: ({ signal }) => read<RequestDetail>(`/requests/${id}`, undefined, signal) });
  const r = q.data?.data.request;
  useTabTitle(r ? `${label(r.number)} · ${label(r.subject)}` : `Request ${id}`);
  const act = useMutation({
    mutationFn: ({ action, body }: { action: Parameters<typeof requestAction>[1]; body?: Record<string, unknown> }) => requestAction(id, action, body),
    onSuccess: () => { toast('success', 'Saved.'); setReason(''); void qc.invalidateQueries({ queryKey: ['amc'] }); },
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (q.isPending) return <Spinner />;
  if (q.isError || !r) return <div className="m-4"><ErrorNote error={q.error ?? new Error('Request not found')} onRetry={() => void q.refetch()} /></div>;
  const d = q.data.data;
  const org = typeof r.org_id === 'number' ? r.org_id : null;
  const mayAssign = d.can?.assign ?? can(options, 'assign', org);
  const off = offline || act.isPending;
  const open = r.open !== false;

  const rows = (list: Row[] | undefined, main: string, sub: string) => list?.length ? (
    <ul className="divide-y divide-line">{list.map((x, i) => <li key={x.id ?? i} className="py-1.5 text-[12.5px]"><div className="font-semibold">{label(x[main])}</div><div className="text-ink-3">{label(x[sub])}</div></li>)}</ul>
  ) : <p className="py-3 text-[12.5px] text-ink-3">Nothing yet.</p>;

  return (
    <div className={cx('flex h-full min-h-0 flex-col gap-3 p-4', solo ? 'bg-ground' : '')}>
      <div className="flex flex-wrap items-center gap-2">
        {onBack ? <Button size="sm" variant="ghost" icon="arrow-left" onClick={onBack}>Requests</Button> : null}
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-bold">{label(r.number)} · {label(r.subject)}</h1>
        {q.data.offline ? <OfflineNote cachedAt={q.data.cachedAt} /> : null}
        {onPopOut && !solo ? <Button size="sm" icon="app-window" onClick={() => onPopOut(id)}>Pop out</Button> : null}
      </div>
      <div className="flex flex-wrap gap-2 text-[12px]">
        <span className="rounded-full bg-subtle px-2 py-0.5">{label(r.status_label ?? r.status)}</span>
        <span className="rounded-full bg-subtle px-2 py-0.5">{label(r.priority_label ?? r.priority)}</span>
        <span className="rounded-full bg-subtle px-2 py-0.5">{label(r.coverage_label ?? r.coverage)}</span>
      </div>
      {mayAssign ? (
        <div className="flex flex-wrap gap-2" aria-label="Actions">
          {open && !r.responded_at ? <Button size="sm" disabled={off} onClick={() => act.mutate({ action: 'contact', body: { via: 'desk' } })}>Acknowledge</Button> : null}
          {open && !r.responded_at ? <Button size="sm" disabled={off} onClick={() => act.mutate({ action: 'contact', body: { via: 'call' } })}>Called the customer</Button> : null}
          {open ? <Button size="sm" variant="primary" disabled={offline} onClick={() => onGive(id)}>Give to…</Button> : null}
          {d.can?.reopen ? (
            <span className="flex gap-1.5">
              <input aria-label="Why reopen" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why reopen" className="rounded-[6px] border border-line bg-surface px-2 text-[12.5px]" />
              <Button size="sm" disabled={off || !reason.trim()} onClick={() => act.mutate({ action: 'reopen', body: { reason: reason.trim() } })}>Reopen</Button>
            </span>
          ) : null}
        </div>
      ) : null}
      <div role="tablist" className="flex gap-1 border-b border-line">
        {TABS.map(([t, l]) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('px-3 py-1.5 text-[13px]', tab === t ? 'border-b-2 border-primary font-bold' : 'text-ink-2')}>{l}</button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {tab === 'details' ? (
          <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
            {([['Customer', r.client], ['Site', r.site], ['Unit', r.equipment], ['Contract', r.contract], ['Kind', r.kind_label], ['Technician', r.technician], ['Contact', [r.contact_name, r.contact_phone].filter(Boolean).join(' · ')],
              ['Logged', r.created_at], ['Response due', r.response_due_at], ['First contact', r.responded_at], ['Resolution due', r.resolution_due_at], ['Description', r.description]] as Array<[string, unknown]>).map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-ink-3">{k}</dt><dd className="whitespace-pre-wrap">{label(v)}</dd></div>
            ))}
          </dl>
        ) : tab === 'visits' ? rows(d.visits as Row[] | undefined, 'kind_label', 'date')
          : tab === 'messages' ? rows(d.messages, 'event_label', 'status')
            : rows(d.history, 'action', 'created_at')}
      </div>
    </div>
  );
}
