import { useState } from 'react';
import { text } from '../../core/i18n';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, TextField, cx } from '../../components/ui';
import type { FormatRule, MailPrefs, MessageRow } from './types';
import { SettingsGroup } from '../../components/SettingsKit';

/**
 * Conditional formatting (ENH-MAIL-03 DMO-INB-18): a list row coloured or
 * bold when it is from someone, says something, carries a category, is
 * unread, flagged or important. The first rule that matches wins. Kept with
 * the WorkSuite account, so every computer shows the list the same way.
 * The colour is never the only sign: the row keeps its words, icons and
 * unread dot (DMO-ACC-03).
 */

export const FORMAT_COLOURS: Array<{ id: NonNullable<FormatRule['colour']>; label: string; cls: string }> = [
  { id: 'red', label: 'Red', cls: 'text-danger' },
  { id: 'orange', label: 'Orange', cls: 'text-warning' },
  { id: 'green', label: 'Green', cls: 'text-success' },
  { id: 'blue', label: 'Blue', cls: 'text-primary' },
  { id: 'teal', label: 'Teal', cls: 'text-teal' },
];

const WHEN: Array<{ id: FormatRule['when']; label: string; needsValue: boolean }> = [
  { id: 'from', label: 'From contains', needsValue: true },
  { id: 'subject', label: 'Subject contains', needsValue: true },
  { id: 'category', label: 'Has category', needsValue: true },
  { id: 'unread', label: 'Is unread', needsValue: false },
  { id: 'flagged', label: 'Is flagged', needsValue: false },
  { id: 'important', label: 'Is important', needsValue: false },
];

/** The rules as kept, cleaned: at most 20, each with something to match and something to show. */
export function cleanFormatRules(input: unknown): FormatRule[] {
  if (!Array.isArray(input)) return [];
  const out: FormatRule[] = [];
  for (const r of input.slice(0, 20) as Array<Partial<FormatRule>>) {
    const when = WHEN.find((w) => w.id === r?.when);
    if (!when) continue;
    const value = String(r.value ?? '').trim().slice(0, 100);
    if (when.needsValue && !value) continue;
    const colour = FORMAT_COLOURS.some((c) => c.id === r.colour) ? (r.colour as FormatRule['colour']) : null;
    if (!colour && !r.bold) continue;
    out.push({ id: String(r.id ?? `${out.length}`).slice(0, 40), when: when.id, value, colour, bold: !!r.bold, enabled: r.enabled !== false });
  }
  return out;
}

/** How a row shows, by the first rule that takes it. */
export function rowFormat(m: Pick<MessageRow, 'from_name' | 'from_email' | 'subject' | 'is_read' | 'is_important' | 'is_starred' | 'flag' | 'categories'>, rules: FormatRule[] | undefined): { cls: string | null; bold: boolean } | null {
  for (const r of rules ?? []) {
    if (!r.enabled) continue;
    const v = r.value.toLowerCase();
    const hit =
      r.when === 'from'
        ? `${m.from_name} ${m.from_email}`.toLowerCase().includes(v)
        : r.when === 'subject'
          ? (m.subject ?? '').toLowerCase().includes(v)
          : r.when === 'category'
            ? (m.categories ?? []).some((c) => c.name.toLowerCase() === v)
            : r.when === 'unread'
              ? !m.is_read
              : r.when === 'flagged'
                ? !!m.flag && !m.flag.completed_at
                : !!m.is_important;
    if (hit) return { cls: FORMAT_COLOURS.find((c) => c.id === r.colour)?.cls ?? null, bold: r.bold };
  }
  return null;
}

export function FormattingSettings({ prefs, set }: { prefs: MailPrefs; set: (p: Partial<MailPrefs>) => void }) {
  const rules = cleanFormatRules(prefs.formatRules);
  const [when, setWhen] = useState<FormatRule['when']>('from');
  const [value, setValue] = useState('');
  const [colour, setColour] = useState<NonNullable<FormatRule['colour']>>('blue');
  const [bold, setBold] = useState(false);
  const needsValue = WHEN.find((w) => w.id === when)!.needsValue;
  const save = (next: FormatRule[]) => set({ formatRules: cleanFormatRules(next) });
  const add = () => {
    if (needsValue && !value.trim()) return;
    save([...rules, { id: `r${Math.max(0, ...rules.map((x) => Number(x.id.replace(/\D/g, '')) || 0)) + 1}`, when, value: needsValue ? value.trim() : '', colour, bold, enabled: true }]);
    setValue('');
  };
  const words = (r: FormatRule) => {
    const w = WHEN.find((x) => x.id === r.when)!;
    return w.needsValue ? `${text(w.label)} “${r.value}”` : text(w.label);
  };
  return (
    <SettingsGroup title={text('Conditional formatting')} description={text('Colour or bold a message in the list when it matches. The first rule that matches is used.')}>
      <div className="px-[18px] py-3.5 flex flex-col gap-3 text-[13.5px] text-ink">
      {rules.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
          {rules.map((r, i) => (
            <li key={r.id} className="flex items-center gap-2 px-3 py-2">
              <Checkbox aria-label={text('Use this rule')} checked={r.enabled} onChange={(e) => save(rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))} />
              <span className={cx('min-w-0 flex-1 truncate', FORMAT_COLOURS.find((c) => c.id === r.colour)?.cls, r.bold && 'font-bold')}>{words(r)}</span>
              <span className="text-[12px] text-ink-3">{[r.colour ? text(FORMAT_COLOURS.find((c) => c.id === r.colour)!.label) : null, r.bold ? text('Bold') : null].filter(Boolean).join(' · ')}</span>
              <button type="button" aria-label={text('Move up')} disabled={i === 0} onClick={() => save([...rules.slice(0, i - 1), r, rules[i - 1]!, ...rules.slice(i + 1)])} className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle disabled:opacity-40">
                <Icon name="arrow-up" size={14} />
              </button>
              <button type="button" aria-label={text('Remove rule')} onClick={() => save(rules.filter((x) => x.id !== r.id))} className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-danger">
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-[170px]">
          <Select label={text('When')} value={when} options={WHEN.map((w) => ({ value: w.id, label: text(w.label) }))} onValueChange={(v) => setWhen(v as FormatRule['when'])} />
        </div>
        {needsValue ? <TextField label={text('Text')} value={value} onChange={(e) => setValue(e.target.value)} placeholder={when === 'from' ? 'client.lk' : ''} /> : null}
        <div className="w-[120px]">
          <Select label={text('Colour')} value={colour} options={FORMAT_COLOURS.map((c) => ({ value: c.id, label: text(c.label) }))} onValueChange={(v) => setColour(v as NonNullable<FormatRule['colour']>)} />
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-[12.5px]">
          <Checkbox checked={bold} onChange={(e) => setBold(e.target.checked)} />
          {text('Bold')}
        </label>
        <Button icon="plus" disabled={rules.length >= 20 || (needsValue && !value.trim())} onClick={add}>
          {text('Add rule')}
        </Button>
      </div>
      </div>
    </SettingsGroup>
  );
}
