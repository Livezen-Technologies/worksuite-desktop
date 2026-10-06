import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { countryName, CountrySelect } from './audience-parts';
import { input } from './parts';
import { peopleOf, type Options, type Rule, type SegmentField } from './types';

/**
 * A segment's rules (MKT-SEG-01): as words on the Segments list, and as the
 * controls the builder writes them with — each field's own kind of value
 * (choices, a country, a person, a list, a number of days, text), from the
 * server's field list, so a field the server adds needs no desktop release.
 */

/** A rule as the builder holds it: the value as its control does (several values comma-joined). */
export interface RuleDraft {
  field: string;
  op: string;
  value: string;
}

export function draftOfRule(r: Rule): RuleDraft {
  return { field: r.field, op: r.op, value: Array.isArray(r.value) ? r.value.join(',') : r.value === null || r.value === undefined ? '' : String(r.value) };
}

/** The rule the server is sent: several values for "is", one for the rest, none for a bare operator. */
export function ruleOf(d: RuleDraft, f: SegmentField | undefined): Rule {
  const op = f?.ops.find((o) => o.key === d.op);
  if (!f || op?.bare) return { field: d.field, op: d.op, value: null };
  const many = ['choice', 'country', 'user'].includes(f.type) || (f.type === 'text' && (d.op === 'is' || d.op === 'is_not'));
  return { field: d.field, op: d.op, value: many ? d.value.split(',').map((v) => v.trim()).filter(Boolean) : d.value.trim() };
}

/** A rule in words: "Country is Sri Lanka", "Last email opened within last 90 days". */
export function describe(r: Rule, options: Options, orgId: number): string {
  const f = options.segment_fields.find((x) => x.key === r.field);
  const op = f?.ops.find((o) => o.key === r.op);
  if (!f || !op) return `${r.field} ${r.op}`;
  if (op.bare) return `${f.label} ${op.label}`;
  const values = Array.isArray(r.value) ? r.value : [r.value];
  const shown = values.map((v) => {
    if (f.type === 'choice') return f.choices?.find((c) => c.value === String(v))?.label ?? String(v);
    if (f.type === 'country') return countryName(String(v));
    if (f.type === 'user') return peopleOf(options, orgId).find((p) => p.value === String(v))?.label ?? 'somebody';
    return String(v);
  });
  const words = shown.join(' or ');
  return op.label.includes('…') ? `${f.label} ${op.label.replace('…', words)}` : `${f.label} ${op.label} ${words}`;
}

/** The value a rule compares with, in the control its kind needs. */
export function ValueInput({ field, draft, label, onChange, people, lists }: {
  field: SegmentField;
  draft: RuleDraft;
  label: string;
  onChange: (v: string) => void;
  people: Array<{ value: string; label: string }>;
  lists: Array<{ id: number; name: string }>;
}) {
  const chosen = draft.value.split(',').map((v) => v.trim()).filter(Boolean);

  if (field.type === 'choice') {
    return (
      <span role="group" aria-label={label} className="flex flex-wrap gap-1">
        {(field.choices ?? []).map((c) => {
          const on = chosen.includes(c.value);
          return (
            <button
              key={c.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange((on ? chosen.filter((v) => v !== c.value) : [...chosen, c.value]).join(','))}
              className={cx('h-[26px] rounded-full border px-2.5 text-[12px] font-semibold', on ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink-2 hover:bg-subtle')}
            >
              {c.label}
            </button>
          );
        })}
      </span>
    );
  }

  if (field.type === 'country') {
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {chosen.map((code) => (
          <span key={code} className="inline-flex h-[26px] items-center gap-1 rounded-full bg-selection px-2 text-[12px] font-semibold text-primary">
            {countryName(code)}
            <button type="button" aria-label={`Remove ${countryName(code)}`} onClick={() => onChange(chosen.filter((v) => v !== code).join(','))} className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-surface">
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
        <span className="w-[200px]">
          <CountrySelect label={label} value="" empty={chosen.length ? 'Add a country…' : 'Choose a country…'} onChange={(code) => code && !chosen.includes(code) && onChange([...chosen, code].join(','))} />
        </span>
      </span>
    );
  }

  if (field.type === 'user') {
    return <Select<string> aria-label={label} value={draft.value} placeholder="Choose somebody" onValueChange={onChange} options={people} className="w-[200px]" />;
  }

  if (field.type === 'list') {
    return <Select<string> aria-label={label} value={draft.value} placeholder="Choose a list" onValueChange={onChange} options={lists.map((l) => ({ value: String(l.id), label: l.name }))} className="w-[200px]" />;
  }

  if (field.type === 'days' || field.type === 'number') {
    return (
      <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
        <input
          type="number"
          aria-label={label}
          className={cx(input, '!w-24')}
          value={draft.value}
          onChange={(e) => onChange(e.target.value)}
          min={field.type === 'days' ? 1 : undefined}
          max={field.type === 'days' ? 3650 : undefined}
        />
        {field.type === 'days' ? 'days' : null}
      </span>
    );
  }

  return (
    <input
      aria-label={label}
      className={cx(input, 'min-w-[160px] flex-1')}
      value={draft.value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={draft.op === 'ends_with' ? 'shop.ae' : draft.op === 'is' || draft.op === 'is_not' ? 'One, or several with commas' : ''}
    />
  );
}
