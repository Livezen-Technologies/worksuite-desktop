import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../../components/Icon';
import { Menu, type MenuItem } from '../../../components/Menu';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { dataOf, type Health } from '../api';
import { useProjectCompany } from '../company';
import { dqk, dread } from '../delivery';
import { fieldClass } from '../parts';
import { HEALTH_CHIP, PROJECT_STATUS, errorStatus, errorText } from '../portfolio';

/**
 * The Projects screens' small pieces, in the desktop's own language (D01–D04: tokens for both themes, 13px type,
 * 12px card radius, a word beside every colour — NFR-08): chips, figures, cards, the page head and its tabs, fields,
 * pickers, the confirm / prompt / note dialogs, and the offline wording. One kit for the portfolio and delivery screens.
 */

export const inputClass = cx(fieldClass, 'w-full font-normal disabled:bg-subtle disabled:text-ink-3');
export const areaClass = 'w-full rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-primary disabled:bg-subtle';
export const TH = 'px-2 py-2 text-left text-[12px] font-semibold text-ink-3 first:ps-3.5 last:pe-3.5';
export const TD = 'px-2 py-2 align-middle text-[12.5px] first:ps-3.5 last:pe-3.5';

export function Chip({ children, tone = 'bg-subtle text-ink-2', className }: { children: ReactNode; tone?: string; className?: string }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-px text-[11px] font-semibold whitespace-nowrap', tone, className)}>{children}</span>;
}

export function ProjectStatusChip({ status }: { status: string }) {
  const s = PROJECT_STATUS[status as keyof typeof PROJECT_STATUS];
  return <Chip tone={s?.tone}>{s?.label ?? status}</Chip>;
}

export function HealthChip({ health }: { health: Health | null | undefined }) {
  if (!health) return <span className="text-ink-3">—</span>;
  const h = HEALTH_CHIP[health];
  return <Chip tone={h.tone}>{h.label}</Chip>;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-mono tabular-nums', className)}>{children}</span>;
}

export function Progress({ value, label, fill = 'bg-primary' }: { value: number; label: string; fill?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span className="flex items-center gap-1.5">
      <span role="progressbar" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
        <span className={cx('block h-full rounded-full', fill)} style={{ width: `${v}%` }} />
      </span>
      <Mono className="w-9 text-end text-[11.5px] text-ink-2">{v}%</Mono>
    </span>
  );
}

/** A figure tile; a button when it leads somewhere. */
export function Kpi({ label, value, sub, tone = 'text-ink', onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="text-[11.5px] font-semibold text-ink-3">{label}</span>
      <b className={cx('text-[20px] leading-tight', tone)}>{value}</b>
      {sub ? <span className="text-[11.5px] text-ink-3">{sub}</span> : null}
    </>
  );
  const cls = 'flex flex-col gap-0.5 rounded-[12px] border border-line bg-surface px-3.5 py-2.5 text-start';
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(cls, 'hover:border-primary/50')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A card with a heading row. */
export function Panel({ title, sub, action, children, className, label }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label} className={cx('flex min-w-0 flex-col rounded-[12px] border border-line bg-surface', className)}>
      {title !== undefined ? (
        <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-line px-3.5 py-2">
          <h2 className="text-[13.5px] font-bold text-ink">{title}</h2>
          {sub ? <span className="text-[11.5px] text-ink-3">{sub}</span> : null}
          {action ? <span className="ms-auto">{action}</span> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** A screen's head: crumb, title, chips and actions, and its tabs under it. */
export function PageHead({ title, crumb, sub, chips, actions, children }: { title: ReactNode; crumb?: ReactNode; sub?: ReactNode; chips?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="shrink-0 border-b border-line bg-surface px-5 pt-3.5">
      {crumb ? <div className="mb-0.5 font-mono text-[11.5px] text-ink-3">{crumb}</div> : null}
      <div className="flex flex-wrap items-center gap-2 pb-2.5">
        <h1 className="min-w-0 truncate text-[20px] font-bold text-ink">{title}</h1>
        {chips}
        {sub ? <span className="text-[12.5px] text-ink-3">{sub}</span> : null}
        {actions ? <div className="ms-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

/** A labelled control. */
export function Field({ label, hint, children, className, required }: { label: string; hint?: ReactNode; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cx('flex flex-col gap-1 text-[13px] font-semibold text-ink', className)}>
      <span>
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="text-[11.5px] font-normal text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function Loading({ label }: { label?: string }) {
  return <Spinner label={label} />;
}

export function Failed({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="p-3">
      <ErrorNote error={error ?? new Error('This could not be loaded.')} onRetry={onRetry} />
    </div>
  );
}

export function Nothing({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-[13px] text-ink-3">
      <span>{text}</span>
      {action}
    </div>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
      {children}
    </p>
  );
}

/** A button that opens a menu of actions (Move to ▾, More). */
export function MenuButton({ label, ariaLabel, icon, items, disabled, title }: { label?: string; ariaLabel: string; icon?: string; items: Array<{ label: string; onSelect: () => void; danger?: boolean }>; disabled?: boolean; title?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const menu: MenuItem[] = items.map((i, n) => ({ id: String(n), label: i.label, danger: i.danger, onSelect: i.onSelect }));
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={title}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-7 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink-2 hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        {icon ? <Icon name={icon} size={14} /> : null}
        {label}
      </button>
      {open ? <Menu sections={[{ id: 'm', items: menu }]} label={ariaLabel} anchor={ref} prefer="bottom" align="end" width={220} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

// ── asking: confirm and prompt, as promises ────────────────────────────────

interface Ask {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** A prompt: the text box's start value. */
  input?: { label: string; value: string; required?: boolean };
}

/**
 * `confirm()` and `prompt()` for a screen, answered in the app's own dialog. Render `dialog` once in the screen.
 */
export function useAsk(): { confirm: (a: Omit<Ask, 'input'>) => Promise<boolean>; prompt: (a: Ask & { input: NonNullable<Ask['input']> }) => Promise<string | null>; dialog: ReactNode } {
  const [open, setOpen] = useState<(Ask & { resolve: (v: string | boolean | null) => void }) | null>(null);
  const [value, setValue] = useState('');
  const ask = (a: Ask) =>
    new Promise<string | boolean | null>((resolve) => {
      setValue(a.input?.value ?? '');
      setOpen({ ...a, resolve });
    });
  const done = (v: string | boolean | null) => {
    open?.resolve(v);
    setOpen(null);
  };
  const empty = !!open?.input?.required && !value.trim();
  const dialog = open ? (
    <Modal
      title={open.title}
      onClose={() => done(open.input ? null : false)}
      width={440}
      footer={
        <>
          <Button onClick={() => done(open.input ? null : false)}>Cancel</Button>
          <Button variant={open.danger ? 'danger' : 'primary'} disabled={empty} onClick={() => done(open.input ? value : true)}>
            {open.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] text-ink-2">
        {open.message ? <div>{open.message}</div> : null}
        {open.input ? (
          <Field label={open.input.label} required={open.input.required}>
            <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !empty && done(value)} className={inputClass} />
          </Field>
        ) : null}
      </div>
    </Modal>
  ) : null;
  return {
    confirm: async (a) => (await ask(a)) === true,
    prompt: async (a) => {
      const v = await ask(a);
      return typeof v === 'string' ? v : null;
    },
    dialog,
  };
}

/**
 * Runs a write; when the server answers 409 with a reason, asks with that reason and, on yes, runs it again with
 * force. False when the person said no (the web's `withConfirm`).
 */
export async function withConfirm(run: (force: boolean) => Promise<unknown>, confirm: (a: Omit<Ask, 'input'>) => Promise<boolean>, title: string, confirmLabel = 'Go ahead'): Promise<boolean> {
  try {
    await run(false);
    return true;
  } catch (e) {
    if (errorStatus(e) !== 409) throw e;
    if (!(await confirm({ title, message: errorText(e), confirmLabel, danger: true }))) return false;
    await run(true);
    return true;
  }
}

/** What a write button says while offline (the module's own wording). */
export const needsConnection = (what: string): string => `${what} needs a connection`;

// ── delivery: the offline wording, tabs, pickers, the remembered project, Confirm and NoteDialog ──

/** The offline wording (PRJ-DSK-04): what waits for a connection. */
export const NEEDS_CONNECTION = 'Waits for a connection';

/** Tabs with their counts; arrow keys move between them (a real tablist). */
export function Tabs<T extends string>({ label, value, onChange, tabs }: { label: string; value: T; onChange: (v: T) => void; tabs: Array<{ key: T; label: string; count?: number | null }> }) {
  const move = (dir: 1 | -1) => {
    const i = tabs.findIndex((t) => t.key === value);
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    if (next) onChange(next.key);
  };
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1" onKeyDown={(e) => (e.key === 'ArrowRight' ? move(1) : e.key === 'ArrowLeft' ? move(-1) : undefined)}>
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <button key={t.key} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onChange(t.key)} className={cx('flex h-[30px] items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-semibold', on ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}>
            {t.label}
            {t.count !== undefined && t.count !== null ? <span className={cx('text-[11.5px]', on ? 'text-primary' : 'text-ink-3')}>{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** The live projects in reach (the chosen company's), as picker options "PRJ-0018 · e-Auction portal". */
export function useLiveProjects(enabled = true): Array<{ value: number; label: string }> {
  useProjectCompany();
  const q = useQuery({ queryKey: dqk.liveProjects(), queryFn: ({ signal }) => dread.liveProjects({ signal }), enabled, staleTime: 60_000 });
  return (dataOf(q.data)?.projects ?? []).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }));
}

/** A project's current members, for owner pickers. */
export function useMembers(projectId: number | null): Array<{ value: number; label: string }> {
  const q = useQuery({ queryKey: ['projects', 'detail', projectId ?? 0, 'members'], queryFn: ({ signal }) => dread.members(projectId as number, { signal }), enabled: !!projectId, staleTime: 60_000 });
  return (dataOf(q.data)?.members ?? []).map((m) => ({ value: m.user_id, label: m.name }));
}

/** "Project: all" / "Project: Choose…" — the project picker on a module-level screen. */
export function ProjectPick({ value, onChange, anyLabel = 'All projects', label = 'Project', options }: { value: number | null; onChange: (id: number | null) => void; anyLabel?: string; label?: string; options?: Array<{ value: number; label: string }> }) {
  const live = useLiveProjects(!options);
  const list = options ?? live;
  return (
    <div className="w-[260px] max-w-full">
      <Select<number | ''> aria-label={label} value={value ?? ''} onValueChange={(v) => onChange(v === '' ? null : Number(v))} options={[{ value: '', label: anyLabel }, ...list]} className={inputClass} />
    </div>
  );
}

/** A module-level project choice remembered on this computer (a view preference: nothing is lost without it). */
export function useRememberedProject(fixed: number | null, key: string): [number | null, (id: number | null) => void] {
  const storageKey = `ws.projects.last.${key}`;
  const [picked, setPicked] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(storageKey));
      return Number.isSafeInteger(v) && v > 0 ? v : null;
    } catch {
      return null;
    }
  });
  const set = (id: number | null) => {
    setPicked(id);
    try {
      if (id) localStorage.setItem(storageKey, String(id));
      else localStorage.removeItem(storageKey);
    } catch {
      /* a view preference */
    }
  };
  return [fixed ?? picked, set];
}

/** Reports to the page whether the answer came from the offline copy. */
export function useReportOffline(fromCache: boolean, onOffline: (o: boolean) => void): void {
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);
}

/** Are you sure? — for a delete, a cancel, anything that cannot be taken back. */
export function Confirm({ title, message, confirmLabel, cancelLabel = 'Cancel', danger, busy, onConfirm, onClose }: { title: string; message: ReactNode; confirmLabel: string; cancelLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ink-2">{message}</p>
    </Modal>
  );
}

/** A note that must be written (send back, achieve anyway): the action stays off until there is one. */
export function NoteDialog({ title, message, label, placeholder, confirmLabel, busy, danger, onConfirm, onClose }: { title: string; message: ReactNode; label: string; placeholder?: string; confirmLabel: string; busy?: boolean; danger?: boolean; onConfirm: (note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState('');
  const ok = !!note.trim();
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={!ok} onClick={() => ok && onConfirm(note.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <p className="text-ink-2">{message}</p>
        <Field label={label}>
          <textarea autoFocus rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} className={areaClass} />
        </Field>
      </div>
    </Modal>
  );
}

/** A chart's figures as a table only screen readers see (NFR-08). */
export function ChartTable({ caption, head, rows }: { caption: string; head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) =>
              j === 0 ? (
                <th key={j} scope="row">
                  {c}
                </th>
              ) : (
                <td key={j}>{c}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
