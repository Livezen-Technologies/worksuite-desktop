import { Switch } from '../../../../components/ui';
import type { Brand, SettingValue } from '../../api';
import { INPUT, NativeSelect } from '../../parts';
import { zonesWith } from './zones';

/**
 * A02 · the settings the desktop knows by name (SMM-ADM-001…005), in plain words, and a control for each. A key the
 * server sends that is not listed here is still shown, as a plain field, so nothing it holds is hidden.
 */

export type FieldKind = 'bool' | 'number' | 'text' | 'zone' | 'brand' | 'select' | 'list';

export interface FieldDef {
  key: string;
  label: string;
  hint?: string;
  kind: FieldKind;
  unit?: string;
  options?: Array<{ id: string; label: string }>;
}

export const SECTION_FIELDS: Record<string, FieldDef[]> = {
  general: [
    { key: 'default_brand_id', label: 'Default brand', hint: 'New posts start in this brand.', kind: 'brand' },
    { key: 'default_timezone', label: 'Default time zone', hint: 'For brands without their own zone.', kind: 'zone' },
    { key: 'alt_text_required', label: 'Alt text required on every picture', kind: 'bool' },
    { key: 'ai_enabled', label: 'AI for Social', hint: 'Caption drafts, rewrites and reply suggestions.', kind: 'bool' },
  ],
  access: [
    { key: 'open_app_roles', label: 'Who can open the app', hint: 'Roles, one per line. Each also needs social.view.', kind: 'list' },
    { key: 'default_role', label: 'Default role for new users', kind: 'text' },
  ],
  organization: [
    { key: 'account_limit', label: 'Accounts allowed by your edition', kind: 'number' },
    { key: 'brand_limit', label: 'Brands allowed by your edition', kind: 'number' },
    { key: 'edition', label: 'Edition', kind: 'text' },
  ],
  publishing: [
    { key: 'retry_backoff', label: 'Retries & backoff', hint: 'Minutes between attempts for temporary errors, e.g. 1,5,15.', kind: 'text' },
    { key: 'min_gap_minutes', label: 'Minimum gap between posts on one account', kind: 'number', unit: 'min' },
    { key: 'link_tracking', label: 'Link tracking on by default', hint: 'Adds UTM tags and shortens links.', kind: 'bool' },
    { key: 'short_domain', label: 'Short link domain', kind: 'text' },
    { key: 'reminder_lead_minutes', label: 'Manual reminder lead time', hint: 'For posts a network’s API cannot publish.', kind: 'number', unit: 'min' },
    {
      key: 'approval_tolerance',
      label: 'Approval tolerance',
      hint: 'Which edits after approval send a post back for approval.',
      kind: 'select',
      options: [
        { id: 'any_change', label: 'Any change' },
        { id: 'any_date_change', label: 'Text changes and any date change' },
        { id: 'text_only', label: 'Text changes only' },
      ],
    },
  ],
  approvals: [
    { key: 'review_link_days', label: 'External review link expiry', kind: 'number', unit: 'days' },
    { key: 'publish_when_approved', label: '“Publish when approved” on by default', kind: 'bool' },
  ],
  inbox: [
    { key: 'sync_interval_minutes', label: 'Sync interval', hint: 'For networks without webhooks.', kind: 'number', unit: 'min' },
    { key: 'business_hours', label: 'Business hours', hint: 'e.g. Mon–Fri 09:00–18:00. Reply targets count only these hours.', kind: 'text' },
    { key: 'reply_target_messages_minutes', label: 'Reply target for messages', kind: 'number', unit: 'min' },
    { key: 'reply_target_comments_minutes', label: 'Reply target for comments', kind: 'number', unit: 'min' },
    { key: 'inbox_retention_days', label: 'Inbox retention', kind: 'number', unit: 'days' },
  ],
  advanced: [
    { key: 'retention_days', label: 'Data retention', hint: 'Posts, inbox and metrics older than this are removed.', kind: 'number', unit: 'days' },
    { key: 'metrics_retention_days', label: 'Metrics retention', kind: 'number', unit: 'days' },
  ],
};

const KNOWN = new Set(Object.values(SECTION_FIELDS).flatMap((f) => f.map((x) => x.key)));

/** The section's own fields that the server sent, then any key the desktop does not know. */
export function fieldsFor(section: string, values: Record<string, SettingValue>, skip: (key: string) => boolean = () => false): FieldDef[] {
  const own = (SECTION_FIELDS[section] ?? []).filter((f) => f.key in values);
  const unknown = Object.keys(values)
    .filter((k) => !KNOWN.has(k) && !skip(k))
    .map((k): FieldDef => {
      const v = values[k];
      return { key: k, label: k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), kind: typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'number' : Array.isArray(v) ? 'list' : 'text' };
    });
  return [...own, ...unknown];
}

export function FieldControl({ def, value, onChange, brands, disabled }: { def: FieldDef; value: SettingValue; onChange: (v: SettingValue) => void; brands: Brand[]; disabled?: boolean }) {
  switch (def.kind) {
    case 'bool':
      return <Switch label={def.label} checked={value === true} disabled={disabled} onChange={onChange} />;
    case 'number':
      return (
        <span className="flex items-center gap-2">
          <input
            aria-label={def.label}
            className={`${INPUT} w-28 tabular-nums`}
            inputMode="numeric"
            disabled={disabled}
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(e) => {
              const t = e.target.value.replace(/[^\d]/g, '');
              onChange(t === '' ? null : Number(t));
            }}
          />
          {def.unit ? <span className="text-[12.5px] text-ink-3">{def.unit}</span> : null}
        </span>
      );
    case 'zone':
      return (
        <NativeSelect label={def.label} className="max-w-72" disabled={disabled} value={String(value ?? '')} onChange={onChange}>
          {zonesWith(String(value ?? '') || null).map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </NativeSelect>
      );
    case 'brand':
      return (
        <NativeSelect label={def.label} className="max-w-72" disabled={disabled} value={value === null ? '' : String(value)} onChange={(v) => onChange(v ? Number(v) : null)}>
          <option value="">None</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
          {value !== null && !brands.some((b) => b.id === value) ? <option value={String(value)}>Brand {String(value)}</option> : null}
        </NativeSelect>
      );
    case 'select': {
      const opts = def.options ?? [];
      const v = String(value ?? '');
      return (
        <NativeSelect label={def.label} className="max-w-80" disabled={disabled} value={v} onChange={onChange}>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
          {v && !opts.some((o) => o.id === v) ? <option value={v}>{v}</option> : null}
        </NativeSelect>
      );
    }
    case 'list':
      return (
        <textarea
          aria-label={def.label}
          rows={3}
          disabled={disabled}
          className="w-full max-w-80 rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-primary"
          value={Array.isArray(value) ? value.join('\n') : String(value ?? '')}
          onChange={(e) => onChange(e.target.value.split('\n'))}
        />
      );
    default:
      return <input aria-label={def.label} className={`${INPUT} max-w-80`} disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Rows of label + control, the way every settings section is laid out. */
export function FieldRows({ defs, values, onChange, brands, disabled }: { defs: FieldDef[]; values: Record<string, SettingValue>; onChange: (key: string, v: SettingValue) => void; brands: Brand[]; disabled?: boolean }) {
  if (!defs.length) return <p className="py-3 text-[13px] text-ink-3">This server sends no settings for this section.</p>;
  return (
    <div className="flex flex-col divide-y divide-line">
      {defs.map((d) => (
        <div key={d.key} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)] sm:items-center">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink">{d.label}</div>
            {d.hint ? <div className="text-[11.5px] text-ink-3">{d.hint}</div> : null}
          </div>
          <div className="min-w-0">
            <FieldControl def={d} value={values[d.key] ?? null} onChange={(v) => onChange(d.key, v)} brands={brands} disabled={disabled} />
          </div>
        </div>
      ))}
    </div>
  );
}
