import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Select } from '../../../components/Select';
import { Button, Modal, cx } from '../../../components/ui';
import { dataOf } from '../api';
import { useProjectCompany } from '../company';
import { dqk, dread } from '../delivery';
import { fieldClass } from '../parts';

/**
 * What the delivery screens share: the page head, tabs with counts, the project picker, chips, a field with its
 * label, the confirmation and "send back with a note" dialogs, and the offline flag each screen reports.
 */

/** The offline wording (PRJ-DSK-04): what waits for a connection. */
export const NEEDS_CONNECTION = 'Waits for a connection';

export function Chip({ tone, children, className }: { tone: string; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-px text-[11px] font-semibold whitespace-nowrap', tone, className)}>{children}</span>;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-mono tabular-nums', className)}>{children}</span>;
}

/** A screen's head (D01's density): an optional crumb, the title, chips and the actions on the right. */
export function PageHead({ crumb, title, chips, actions, children }: { crumb?: ReactNode; title: ReactNode; chips?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-line px-5 pt-4 pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          {crumb ? <span className="truncate font-mono text-[11.5px] text-ink-3">{crumb}</span> : null}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[20px] font-bold text-ink">{title}</h1>
            {chips}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

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

/** A labelled field. */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1 text-[13px] font-semibold text-ink', className)}>
      {label}
      {children}
      {hint ? <span className="text-[11.5px] font-normal text-ink-3">{hint}</span> : null}
    </label>
  );
}

export const inputClass = cx(fieldClass, 'w-full font-normal');
export const areaClass = 'w-full rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[13px] font-normal text-ink outline-none focus:border-primary';

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

/** "TechHubiz · LKR": whose money a total is (SRS §18). */
export function MoneyBasis({ currency }: { currency: string }) {
  const { current } = useProjectCompany();
  return (
    <span className="text-[12px] text-ink-3">
      {current ? `${current.name} · ` : ''}
      <span className="font-mono">{currency}</span>
    </span>
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
