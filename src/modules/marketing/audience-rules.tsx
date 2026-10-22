import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { countryName, CountrySelect } from './audience-parts';
import { btnSmall, input } from './parts';
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
  /** SEG-07: a group of rules, matched all or any, nested at most three deep. */
  group?: 'all' | 'any';
  rules?: RuleDraft[];
}

/** How deep groups nest: the segment itself is the first level (the server's `Segments::MAX_DEPTH`). */
export const MAX_DEPTH = 3;
export const MAX_RULES = 20;

export function draftOfRule(r: Rule): RuleDraft {
  if (r.group) return { field: '', op: '', value: '', group: r.group, rules: (r.rules ?? []).map(draftOfRule) };
  return { field: r.field, op: r.op, value: Array.isArray(r.value) ? r.value.join(',') : r.value === null || r.value === undefined ? '' : String(r.value) };
}

/** Every draft, groups and all, as the server is sent it. */
export function rulesOf(drafts: RuleDraft[], fields: SegmentField[]): Rule[] {
  return drafts.map((d) => (d.group ? { field: '', op: '', value: null, group: d.group, rules: rulesOf(d.rules ?? [], fields) } : ruleOf(d, fields.find((f) => f.key === d.field))));
}

/** Rules (not groups) in a tree of drafts: what the limit counts. */
export function leaves(drafts: RuleDraft[]): number {
  return drafts.reduce((k, d) => k + (d.group ? leaves(d.rules ?? []) : 1), 0);
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
  if (r.group) return `(${(r.rules ?? []).map((x) => describe(x, options, orgId)).join(r.group === 'any' ? ' or ' : ' and ')})`;
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
export function ValueInput({ field, draft, label, onChange, people, lists, forms = [], journeys = [] }: {
  field: SegmentField;
  draft: RuleDraft;
  label: string;
  onChange: (v: string) => void;
  people: Array<{ value: string; label: string }>;
  lists: Array<{ id: number; name: string }>;
  forms?: Array<{ id: number; name: string }>;
  journeys?: Array<{ id: number; name: string }>;
}) {
  const chosen = draft.value.split(',').map((v) => v.trim()).filter(Boolean);

  if (field.type === 'form' || field.type === 'journey') {
    const items = field.type === 'form' ? forms : journeys;
    return <Select<string> aria-label={label} value={draft.value} placeholder={field.type === 'form' ? 'Choose a form' : 'Choose a journey'} onValueChange={onChange} options={items.map((l) => ({ value: String(l.id), label: l.name }))} className="w-[200px]" />;
  }

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

/**
 * The rules as a tree (MKT-SEG-07): each a field, how it compares and with
 * what, or a group of them matched all or any — three levels at most. A rule
 * the server refused says why under itself, by its place ("2", "2.0").
 */
export function RuleTree({ drafts, onChange, fields, people, lists, forms, journeys, wrong, editable, depth = 1, path = '', total }: {
  drafts: RuleDraft[];
  onChange: (d: RuleDraft[]) => void;
  fields: SegmentField[];
  people: Array<{ value: string; label: string }>;
  lists: Array<{ id: number; name: string }>;
  forms?: Array<{ id: number; name: string }>;
  journeys?: Array<{ id: number; name: string }>;
  wrong: Record<string, string>;
  editable: boolean;
  depth?: number;
  path?: string;
  total?: number;
}) {
  const all = total ?? leaves(drafts);
  const setDraft = (i: number, d: RuleDraft) => onChange(drafts.map((x, j) => (j === i ? d : x)));
  const blank = (): RuleDraft => ({ field: fields[0]?.key ?? '', op: fields[0]?.ops[0]?.key ?? 'is', value: '' });

  return (
    <div className="flex flex-col gap-2">
      <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label={depth === 1 ? 'Rules' : `Group ${path.slice(0, -1)}`}>
        {drafts.map((d, i) => {
          const at = `${path}${i}`;
          if (d.group) {
            return (
              <li key={i} className={cx('rounded-[10px] border border-dashed p-2', wrong[at] ? 'border-danger/50' : 'border-primary/40')}>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
                  Group: match
                  <Select<'all' | 'any'> aria-label={`Group ${at}: match`} value={d.group} disabled={!editable} onValueChange={(v) => setDraft(i, { ...d, group: v })} className="h-[28px] w-auto" options={[{ value: 'all', label: 'all' }, { value: 'any', label: 'any' }]} />
                  of these
                  {editable ? (
                    <button type="button" aria-label={`Remove group ${at}`} onClick={() => onChange(drafts.filter((_, j) => j !== i))} className="ml-auto flex h-[28px] w-[28px] items-center justify-center rounded-[7px] border border-line text-ink-3 hover:bg-subtle hover:text-danger">
                      <Icon name="x" size={13} />
                    </button>
                  ) : null}
                </div>
                {wrong[at] ? <p role="alert" className="m-0 mb-1 text-[12px] text-danger">{wrong[at]}</p> : null}
                <RuleTree drafts={d.rules ?? []} onChange={(rules) => setDraft(i, { ...d, rules })} fields={fields} people={people} lists={lists} forms={forms} journeys={journeys}
                  wrong={wrong} editable={editable} depth={depth + 1} path={`${at}.`} total={all} />
              </li>
            );
          }
          const f = fields.find((x) => x.key === d.field);
          const op = f?.ops.find((o) => o.key === d.op);
          const said = wrong[at];
          return (
            <li key={i} className={cx('rounded-[10px] border p-2', said ? 'border-danger/50' : 'border-line')}>
              <div className="flex flex-wrap items-center gap-2">
                <Select<string> aria-label={`Rule ${at}: about`} value={d.field} disabled={!editable} className="w-[200px]"
                  onValueChange={(v) => { const nf = fields.find((x) => x.key === v); setDraft(i, { field: v, op: nf?.ops[0]?.key ?? '', value: '' }); }}
                  options={fields.map((x) => ({ value: x.key, label: x.label }))} />
                <Select<string> aria-label={`Rule ${at}: how`} value={d.op} disabled={!editable} onValueChange={(v) => setDraft(i, { ...d, op: v })} options={(f?.ops ?? []).map((o) => ({ value: o.key, label: o.label }))} className="w-auto" />
                {f && op && !op.bare ? <ValueInput field={f} draft={d} label={`Rule ${at}: value`} onChange={(value) => setDraft(i, { ...d, value })} people={people} lists={lists} forms={forms} journeys={journeys} /> : null}
                {editable ? (
                  <button type="button" aria-label={`Remove rule ${at}`} onClick={() => onChange(drafts.filter((_, j) => j !== i))} className="ml-auto flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-line text-ink-3 hover:bg-subtle hover:text-danger">
                    <Icon name="x" size={14} />
                  </button>
                ) : null}
              </div>
              {said ? <p role="alert" className="m-0 mt-1 text-[12px] text-danger">{said}</p> : null}
            </li>
          );
        })}
      </ol>
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={cx(btnSmall, 'gap-1')} onClick={() => onChange([...drafts, blank()])} disabled={all >= MAX_RULES || fields.length === 0}>
            <Icon name="plus" size={13} /> Add rule
          </button>
          {depth < MAX_DEPTH ? (
            <button type="button" className={cx(btnSmall, 'gap-1 text-ink-2')} onClick={() => onChange([...drafts, { field: '', op: '', value: '', group: 'any', rules: [blank()] }])}
              disabled={all >= MAX_RULES || fields.length === 0} title={`Rules matched together. Groups nest ${MAX_DEPTH} deep at most.`}>
              <Icon name="plus" size={13} /> Add group
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
