import { useId, type ReactNode } from 'react';
import { Button, Card, Switch, cx } from '../../../../components/ui';

/**
 * The widget settings' building blocks (worksuite-desktop#199), shared by its tabs: Appearance and Hours
 * (WidgetSettings), Live status & calls (V-05, LiveStatusCalls) and Behaviour (S-03, Behaviour) — a titled section, a
 * card under a small-capitals heading, a text area, a row of choices, a switch with its line, and the sticky Save bar
 * Live status & calls ends with (the design's tabs save from the editor's header since S-02).
 */

/** A card with the design's small capitals heading over its rows: "WHAT THE VISITOR SEES", "NEW CHATS". */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={<span className="text-[11px] font-bold tracking-[1px] text-ink-3 uppercase">{title}</span>} bodyClassName="pb-1">
      {children}
    </Card>
  );
}

/** A field label above its control, as the design's cards set them out (Appearance, Chatbot). */
export function Labelled({ label, children, className, htmlFor }: { label: string; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {htmlFor ? <label htmlFor={htmlFor} className="text-[12.5px] font-semibold text-ink">{label}</label> : <span className="text-[12.5px] font-semibold text-ink">{label}</span>}
      {children}
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-line py-5 first:pt-0 last:border-b-0">
      <div>
        <h3 className="text-[14px] font-bold text-ink">{title}</h3>
        {hint ? <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Area({ label, value, onChange, max, rows = 2, hint, placeholder }: { label: string; value: string; onChange: (v: string) => void; max: number; rows?: number; hint?: string; placeholder?: string }) {
  const fid = useId();
  return (
    <span className="flex flex-col gap-1">
      <label htmlFor={fid} className="text-[12.5px] font-semibold text-ink-2">{label}</label>
      <textarea id={fid} rows={rows} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="resize-none rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary" />
      {hint ? <span className="text-[12px] text-ink-3">{hint}</span> : null}
    </span>
  );
}

export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1">
      <span className="text-[12.5px] font-semibold text-ink-2">{label}</span>
      <span className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cx('h-8 rounded-[8px] border px-3 text-[12.5px] font-semibold', value === o.value ? 'border-primary bg-selection text-primary' : 'border-line text-ink hover:bg-subtle')}>
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const hid = useId();
  return (
    <span className="flex items-start justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-[13px] font-semibold text-ink">{label}</span>
        {hint ? <span id={hid} className="text-[12px] text-ink-3">{hint}</span> : null}
      </span>
      <Switch label={label} checked={checked} onChange={onChange} describedBy={hint ? hid : undefined} />
    </span>
  );
}

/**
 * The sticky bar under a widget settings tab: Save, the undo (the design's "Undo changes", V-05's "Cancel"), and why
 * Save is held back. Save submits the tab's form.
 */
export function SaveBar({ can, busy, dirty, blocked, undoLabel = 'Undo changes', onUndo, note }: { can: boolean; busy: boolean; dirty: boolean; blocked?: boolean; undoLabel?: string; onUndo: () => void; note?: ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-6 mt-2 flex items-center gap-3 border-t border-line bg-surface px-6 py-3">
      <Button type="submit" variant="primary" loading={busy} disabled={!can || busy || Boolean(blocked)}>Save</Button>
      <Button type="button" disabled={busy || !dirty} onClick={onUndo}>{undoLabel}</Button>
      {note}
    </div>
  );
}
