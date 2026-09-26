import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import type { LeaveType } from './api';
import { dayLong } from './dates';
import { btn, btnPrimary, Empty, Field, input, PageHead, Panel, Seg, Sheet } from './parts';
import { can } from './Rail';
import { ModuleSettingsForm } from '../../components/ModuleSettingsForm';
import { Select } from '../../components/Select';

/**
 * HR settings (HrAdminSheet "Settings"; the web's ModuleSettings for HR):
 * the general rules — numbering, the working day, lateness, breaks,
 * clocking in, leave, documents — drawn from the server's own field list so
 * a new setting appears here without a desktop release; the leave types;
 * the public holidays; and the device settings for `hr.device.manage`.
 * Resignation rules and offboarding checklists are long forms that stay in
 * the browser for now.
 */
type Tab = 'general' | 'types' | 'holidays' | 'advanced';

export default function Settings({ section }: { section?: string | null }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const manage = can(perms, 'hr.manage');
  const devices = can(perms, 'hr.device.manage');
  const [tab, setTab] = useState<Tab>(section === 'holidays' || section === 'types' ? section : manage ? 'general' : 'types');
  const tabs: Array<{ id: Tab; label: string }> = [
    ...(manage ? [{ id: 'general' as const, label: 'General' }] : []),
    { id: 'types', label: 'Leave types' },
    { id: 'holidays', label: 'Public holidays' },
    ...(devices ? [{ id: 'advanced' as const, label: 'Devices' }] : []),
  ];
  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="Settings" sub="People — installation-wide rules">
        <Seg label="Settings" value={tab} onChange={setTab} options={tabs} />
      </PageHead>
      {tab === 'general' || tab === 'advanced' ? (
        <ModuleSettingsForm slug="hr" section={tab} queryKey={['hr', 'module-settings']} note="Changes apply to every company." readOnly="You can read these settings; changing them needs hr.manage." />
      ) : null}
      {tab === 'types' ? <LeaveTypes editable={manage} /> : null}
      {tab === 'holidays' ? <Holidays editable={manage} /> : null}
      {can(perms, 'hr.resignation.settings.manage') ? (
        <div className="text-[12.5px] text-ink-3">
          Resignation rules, terms, approval steps and offboarding checklists are set in the browser.{' '}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void call('app:openInBrowser', { path: '/hr?tab=settings' })}>
            Open them
          </button>
        </div>
      ) : null}
    </div>
  );
}

type FullType = LeaveType & { carry_forward?: number | string };
const FLAGS: Array<[keyof FullType, string]> = [
  ['paid', 'paid'],
  ['requires_approval', 'approval'],
  ['allows_half_day', 'half day'],
  ['allows_short_leave', 'short leave'],
];

function LeaveTypes({ editable }: { editable: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<FullType | 'new' | null>(null);
  const q = useQuery({ queryKey: ['hr', 'leave-types', 'all'], queryFn: ({ signal }) => apiGet<{ types: FullType[] }>('/api/hr/leave/types', { all: 1 }, signal) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hr'] });
  const setStatus = async (t: FullType, status: 'active' | 'archived') => {
    try {
      await apiPut(`/api/hr/leave/types/${t.id}`, { status });
      toast('success', status === 'archived' ? `${t.name} archived.` : `${t.name} restored.`);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const types = q.data!.types;
  return (
    <Panel
      title="Leave types"
      sub="Archived types stay attached to their history but leave the request picker."
      action={
        editable ? (
          <button type="button" className={btnPrimary + ' !h-[30px]'} onClick={() => setEditing('new')}>
            Add leave type
          </button>
        ) : null
      }
    >
      {types.map((t) => {
        const archived = t.status === 'archived';
        const days = Number(t.days_per_year);
        const carry = Number(t.carry_forward ?? 0);
        return (
          <div key={t.id} className={cx('flex items-center gap-2.5 border-b border-line/70 px-3.5 py-2.5 last:border-b-0', archived && 'opacity-55')}>
            <span className="flex w-[240px] shrink-0 flex-col">
              <b className="text-ink">{t.name}</b>
              <span className="text-[11.5px] text-ink-3">{[t.code, archived ? 'archived' : days > 0 ? `${days} days/yr` : '0 = no entitlement limit', carry > 0 ? `carry ${carry}` : null].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap gap-1">
              {FLAGS.map(([k, l]) => {
                const on = !!Number(t[k] ?? 0) || t[k] === true;
                return (
                  <span key={l} className={cx('rounded-[9px] px-[7px] py-px text-[11px] font-bold whitespace-nowrap', on ? 'bg-selection text-primary' : 'bg-ground text-ink-3/60 line-through')}>
                    {l}
                  </span>
                );
              })}
            </span>
            {editable ? (
              <span className="flex shrink-0 gap-3 text-[12.5px] font-semibold text-primary">
                <button type="button" className="hover:underline" onClick={() => setEditing(t)}>
                  Edit
                </button>
                <button type="button" className="hover:underline" onClick={() => void setStatus(t, archived ? 'active' : 'archived')}>
                  {archived ? 'Restore' : 'Archive'}
                </button>
              </span>
            ) : null}
          </div>
        );
      })}
      {!types.length ? <Empty text="No leave types yet." /> : null}
      {editing ? <LeaveTypeSheet t={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => (setEditing(null), refresh())} /> : null}
    </Panel>
  );
}

function LeaveTypeSheet({ t, onClose, onDone }: { t: FullType | null; onClose: () => void; onDone: () => void }) {
  const flag = (k: keyof FullType, dflt = true) => (t ? !!Number(t[k] ?? 0) || t[k] === true : dflt);
  const [name, setName] = useState(t?.name ?? '');
  const [code, setCode] = useState(t?.code ?? '');
  const [days, setDays] = useState(String(t ? Number(t.days_per_year) : 0));
  const [carry, setCarry] = useState(String(t ? Number(t.carry_forward ?? 0) : 0));
  const [paid, setPaid] = useState(flag('paid'));
  const [approval, setApproval] = useState(flag('requires_approval'));
  const [half, setHalf] = useState(flag('allows_half_day'));
  const [short, setShort] = useState(flag('allows_short_leave', false));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const body = { name: name.trim(), code: code.trim() || null, days_per_year: Number(days) || 0, carry_forward: Number(carry) || 0, paid, requires_approval: approval, allows_half_day: half, allows_short_leave: short };
    try {
      if (t) await apiPut(`/api/hr/leave/types/${t.id}`, body);
      else await apiPost('/api/hr/leave/types', body);
      toast('success', t ? 'Leave type saved.' : 'Leave type added.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  const box = (label: string, v: boolean, set: (b: boolean) => void) => (
    <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
      <input type="checkbox" aria-label={label} checked={v} onChange={(e) => set(e.target.checked)} className="accent-primary" />
      {label}
    </label>
  );
  return (
    <Sheet
      title={t ? `Edit · ${t.name}` : 'Add leave type'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !name.trim()} className={btnPrimary} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Name">
          <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </Field>
        <Field label="Code">
          <input aria-label="Code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="AN" className={input} />
        </Field>
        <Field label="Days a year" hint="0 means no entitlement limit.">
          <input aria-label="Days a year" type="number" min={0} step={0.5} value={days} onChange={(e) => setDays(e.target.value)} className={input} />
        </Field>
        <Field label="Carried into next year (max)">
          <input aria-label="Carried into next year" type="number" min={0} step={0.5} value={carry} onChange={(e) => setCarry(e.target.value)} className={input} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {box('Paid', paid, setPaid)}
        {box('Needs approval', approval, setApproval)}
        {box('Half days allowed', half, setHalf)}
        {box('Short leave allowed', short, setShort)}
      </div>
    </Sheet>
  );
}

function Holidays({ editable }: { editable: boolean }) {
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [day, setDay] = useState('');
  const [name, setName] = useState('');
  const q = useQuery({ queryKey: ['hr', 'holidays', year], queryFn: ({ signal }) => apiGet<{ holidays: Array<{ id: number; on_date: string; name: string; weekend: boolean }> }>('/api/hr/holidays', { year }, signal) });
  const add = async () => {
    try {
      await apiPost('/api/hr/holidays', { on_date: day, name: name.trim() });
      toast('success', `${name.trim()} added.`);
      setDay('');
      setName('');
      void qc.invalidateQueries({ queryKey: ['hr'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const remove = async (id: number) => {
    try {
      await apiDelete(`/api/hr/holidays/${id}`);
      toast('success', 'Removed.');
      void qc.invalidateQueries({ queryKey: ['hr'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <Panel
      title={`Public holidays · ${year}`}
      sub="Days nobody is expected in, in every company."
      action={
        <Select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={input + ' !h-[30px] !w-auto'}>
          {[-1, 0, 1].map((n) => (
            <option key={n} value={new Date().getFullYear() + n}>
              {new Date().getFullYear() + n}
            </option>
          ))}
        </Select>
      }
    >
      {editable ? (
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
          <input type="date" aria-label="Holiday date" value={day} onChange={(e) => setDay(e.target.value)} className={input + ' !w-[160px]'} />
          <input aria-label="Holiday name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Poya day" className={input} />
          <button type="button" disabled={!day || !name.trim()} className={btn} onClick={() => void add()}>
            Add
          </button>
        </div>
      ) : null}
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {(q.data?.holidays ?? []).map((h) => (
        <div key={h.id} className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-2 last:border-b-0">
          <span className="w-[130px] shrink-0 text-ink-2">{dayLong(h.on_date)}</span>
          <b className="min-w-0 flex-1 truncate text-ink">{h.name}</b>
          {h.weekend ? <span className="text-[11.5px] text-ink-3">on a weekend</span> : null}
          {editable ? (
            <button type="button" className="text-[12px] font-semibold text-danger hover:underline" onClick={() => void remove(h.id)}>
              Remove
            </button>
          ) : null}
        </div>
      ))}
      {q.data && !q.data.holidays.length ? <Empty text="No public holidays for this year." /> : null}
    </Panel>
  );
}
