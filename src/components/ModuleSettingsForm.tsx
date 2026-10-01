import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiGet, apiPut } from '../core/api';
import { errorMessage } from '../core/bridge';
import { toast } from '../core/toasts';
import { btn, btnPrimary, Field, input, Panel } from '../modules/hr/parts';
import { Select } from './Select';
import { ErrorNote, Spinner } from './ui';
import { Checkbox } from './Checkbox';

/**
 * A module's general (or advanced) settings, drawn from the server's own
 * field list (`/api/module-settings/{slug}`, the web's ModuleSettings) so a
 * new setting appears without a desktop release. Fields are grouped by the
 * section the server names; only what changed is sent.
 */
export interface FieldDef {
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

export interface ModuleSettings {
  spec: { general: FieldDef[]; advanced?: FieldDef[] };
  general: Record<string, { value: unknown; stored: boolean; inherited: boolean }>;
  advanced: Record<string, { value: unknown; stored: boolean; inherited: boolean }>;
  can_edit: boolean;
}

/** A value as the form holds it: booleans as '1'/'0', lists comma-joined, the rest as text. */
function asText(f: FieldDef, v: unknown): string {
  if (f.type === 'bool') return v === true || v === 1 || v === '1' || v === 'true' ? '1' : '0';
  if (f.type === 'multiselect') return Array.isArray(v) ? v.map(String).join(',') : v == null ? '' : String(v);
  return v == null ? '' : String(v);
}

/** A control drawn for one field instead of the plain one its type gives (a warehouse id as a list of warehouses). */
export type CustomControl = (p: { value: string; onChange: (v: string) => void; disabled: boolean; label: string }) => ReactNode;

export function ModuleSettingsForm({ slug, section, queryKey, note, readOnly, custom, org }: {
  slug: string;
  section: 'general' | 'advanced';
  queryKey: readonly unknown[];
  /** Said beside Save while nothing has changed. */
  note: string;
  /** Said instead of Save to somebody who may only read. */
  readOnly: string;
  custom?: Partial<Record<string, CustomControl>>;
  /** For a module whose settings differ per company: the company read and written (else the installation's). */
  org?: string;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey, queryFn: ({ signal }) => apiGet<ModuleSettings>(`/api/module-settings/${slug}`, org ? { org } : undefined, signal) });
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
      await apiPut(`/api/module-settings/${slug}/${section}${org ? `?org=${encodeURIComponent(org)}` : ''}`, Object.fromEntries(changed.map((f) => [f.key, draft[f.key]])));
      toast('success', changed.length === 1 ? 'Setting saved.' : `${changed.length} settings saved.`);
      setDraft({});
      void qc.invalidateQueries({ queryKey });
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
            <SettingField key={f.key} f={f} value={cur(f.key)} error={errors[f.key]} disabled={!editable} onChange={(v) => set(f.key, v)} changed={f.key in draft && draft[f.key] !== initial[f.key]} custom={custom?.[f.key]} />
          ))}
        </Panel>
      ))}
      {editable ? (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-ground py-2.5">
          <span className="mr-auto text-[12px] text-ink-3">{changed.length ? `${changed.length} unsaved ${changed.length === 1 ? 'change' : 'changes'}` : note}</span>
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
        <span className="text-[12px] text-ink-3">{readOnly}</span>
      )}
    </div>
  );
}

function SettingField({ f, value, error, disabled, changed, onChange, custom }: { f: FieldDef; value: string; error?: string; disabled: boolean; changed: boolean; onChange: (v: string) => void; custom?: CustomControl }) {
  const label = (
    <span className="flex items-center gap-1.5">
      {f.label}
      {changed ? <span className="h-1.5 w-1.5 rounded-full bg-primary" title="Changed" /> : null}
    </span>
  );
  const hint = error ? <span className="text-danger">{error}</span> : (f.help ?? undefined);
  if (custom) {
    return (
      <Field label={label} hint={hint}>
        {custom({ value, onChange, disabled, label: f.label })}
      </Field>
    );
  }
  if (f.type === 'bool') {
    return (
      <div className="flex flex-col gap-1 text-[12.5px]">
        <label className="flex items-center gap-2 font-semibold text-ink">
          <Checkbox aria-label={f.label} checked={value === '1'} disabled={disabled} onChange={(e) => onChange(e.target.checked ? '1' : '0')} />
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
              <Checkbox checked={chosen.includes(o.value)} disabled={disabled} onChange={(e) => onChange((e.target.checked ? [...chosen, o.value] : chosen.filter((c) => c !== o.value)).join(','))} />
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

