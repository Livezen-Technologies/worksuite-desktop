import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { app } from '../../core/app-state';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import type { LeaveType } from './api';
import { dayLong } from './dates';
import { btn, btnPrimary, Empty, Field, input, PageHead, Panel, Seg, Sheet } from './parts';
import { can } from './Rail';
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

interface FieldDef {
  key: string;
  label: string;
  type: 'string' | 'int' | 'bool' | 'select' | 'multiselect' | 'time' | 'text';
  default: string | null;
  help: string | null;
  section: string;
  options: Array<{ value: string; label: string }> | null;
  min: number | null;
  max: number | null;
  placeholder: string | null;
}

interface ModuleSettings {
  spec: { general: FieldDef[]; advanced?: FieldDef[] };
  general: Record<string, { value: unknown; stored: boolean; inherited: boolean }>;
  advanced: Record<string, { value: unknown; stored: boolean; inherited: boolean }>;
  can_edit: boolean;
}

export default function Settings() {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const manage = can(perms, 'hr.manage');
  const devices = can(perms, 'hr.device.manage');
  const [tab, setTab] = useState<Tab>(manage ? 'general' : 'types');
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
      {tab === 'general' || tab === 'advanced' ? <SettingsForm section={tab} /> : null}
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

/** A value as the form holds it: booleans as '1'/'0', lists comma-joined, the rest as text. */
function asText(f: FieldDef, v: unknown): string {
  if (f.type === 'bool') return v === true || v === 1 || v === '1' || v === 'true' ? '1' : '0';
  if (f.type === 'multiselect') return Array.isArray(v) ? v.map(String).join(',') : v == null ? '' : String(v);
  return v == null ? '' : String(v);
}

function SettingsForm({ section }: { section: 'general' | 'advanced' }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hr', 'module-settings'], queryFn: ({ signal }) => apiGet<ModuleSettings>('/api/module-settings/hr', undefined, signal) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fields = useMemo(() => (section === 'general' ? q.data?.spec.general : q.data?.spec.advanced) ?? [], [q.data, section]);
  const values = useMemo(() => (section === 'general' ? q.data?.general : q.data?.advanced) ?? {}, [q.data, section]);
  const initial = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, asText(f, values[f.key]?.value)])), [fields, values]);
  const groups = useMemo(() => {
    const m = new Map<string, FieldDef[]>();
    for (const f of fields) m.set(f.section, [...(m.get(f.section) ?? []), f]);
    return [...m.entries()];
  }, [fields]);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const editable = !!q.data?.can_edit;
  const cur = (k: string) => (k in draft ? draft[k]! : (initial[k] ?? ''));
  const changed = fields.filter((f) => f.key in draft && draft[f.key] !== initial[f.key]);
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      await apiPut(`/api/module-settings/hr/${section}`, Object.fromEntries(changed.map((f) => [f.key, draft[f.key]])));
      toast('success', changed.length === 1 ? 'Setting saved.' : `${changed.length} settings saved.`);
      setDraft({});
      void qc.invalidateQueries({ queryKey: ['hr', 'module-settings'] });
    } catch (e) {
      const errs = e instanceof ApiError ? ((e.data as { errors?: unknown } | null)?.errors ?? e.data) : null;
      if (errs && typeof errs === 'object') setErrors(errs as Record<string, string>);
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {groups.map(([title, list]) => (
        <Panel key={title} title={title} bodyClassName="grid grid-cols-2 gap-x-5 gap-y-3 px-4 py-3">
          {list.map((f) => (
            <SettingField key={f.key} f={f} value={cur(f.key)} error={errors[f.key]} disabled={!editable} onChange={(v) => set(f.key, v)} changed={f.key in draft && draft[f.key] !== initial[f.key]} />
          ))}
        </Panel>
      ))}
      {editable ? (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-ground py-2.5">
          <span className="mr-auto text-[12px] text-ink-3">{changed.length ? `${changed.length} unsaved ${changed.length === 1 ? 'change' : 'changes'}` : 'Changes apply to every company.'}</span>
          {changed.length ? (
            <button type="button" className={btn} onClick={() => setDraft({})}>
              Discard
            </button>
          ) : null}
          <button type="button" disabled={busy || !changed.length} className={btnPrimary} onClick={() => void save()}>
            Save
          </button>
        </div>
      ) : (
        <span className="text-[12px] text-ink-3">You can read these settings; changing them needs hr.manage.</span>
      )}
    </div>
  );
}

function SettingField({ f, value, error, disabled, changed, onChange }: { f: FieldDef; value: string; error?: string; disabled: boolean; changed: boolean; onChange: (v: string) => void }) {
  const label = (
    <span className="flex items-center gap-1.5">
      {f.label}
      {changed ? <span className="h-1.5 w-1.5 rounded-full bg-primary" title="Changed" /> : null}
    </span>
  );
  const hint = error ? <span className="text-danger">{error}</span> : (f.help ?? undefined);
  if (f.type === 'bool') {
    return (
      <div className="flex flex-col gap-1 text-[12.5px]">
        <label className="flex items-center gap-2 font-semibold text-ink">
          <input type="checkbox" aria-label={f.label} checked={value === '1'} disabled={disabled} onChange={(e) => onChange(e.target.checked ? '1' : '0')} className="accent-primary" />
          {label}
        </label>
        {hint ? <span className="text-[11.5px] text-ink-3">{hint}</span> : null}
      </div>
    );
  }
  if (f.type === 'multiselect') {
    const chosen = value === '' ? [] : value.split(',');
    return (
      <Field label={label} hint={hint}>
        <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-[8px] border border-line px-2.5 py-2 font-medium">
          {(f.options ?? []).map((o) => (
            <label key={o.value} className="flex items-center gap-1.5">
              <input type="checkbox" checked={chosen.includes(o.value)} disabled={disabled} onChange={(e) => onChange((e.target.checked ? [...chosen, o.value] : chosen.filter((c) => c !== o.value)).join(','))} className="accent-primary" />
              {o.label}
            </label>
          ))}
        </div>
      </Field>
    );
  }
  if (f.type === 'select') {
    return (
      <Field label={label} hint={hint}>
        <Select aria-label={f.label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={input}>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (f.type === 'text') {
    return (
      <Field label={label} hint={hint} className="col-span-2">
        <textarea aria-label={f.label} value={value} disabled={disabled} placeholder={f.placeholder ?? undefined} onChange={(e) => onChange(e.target.value)} className={input + ' !h-[64px] resize-none py-2'} />
      </Field>
    );
  }
  return (
    <Field label={label} hint={hint}>
      <input
        aria-label={f.label}
        type={f.type === 'int' ? 'number' : f.type === 'time' ? 'time' : 'text'}
        min={f.min ?? undefined}
        max={f.max ?? undefined}
        value={value}
        disabled={disabled}
        placeholder={f.placeholder ?? f.default ?? undefined}
        onChange={(e) => onChange(e.target.value)}
        className={input}
      />
    </Field>
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
