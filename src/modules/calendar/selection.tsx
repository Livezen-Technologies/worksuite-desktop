import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { currentZone, wallTimeLabel } from '../../core/time';
import { dayDiff, naive } from './api';
import type { Draft } from './EventDrawer';

export type Selection = { from: string; to: string; start: number; end: number; allDay: boolean };

export function selectionDraft(s: Selection): Draft {
  return s.allDay
    ? { start: s.from, end: s.to, allDay: true }
    : { start: naive(s.from, s.start), end: naive(s.from, s.end), allDay: false };
}

/** Inclusive all-day dates; timed ranges use the displayed wall clock, never the OS timezone. */
export function selectionLabel(s: Selection): string {
  if (s.allDay) return `${s.from} – ${s.to} · ${dayDiff(s.from, s.to) + 1} day${s.from === s.to ? '' : 's'} · All day`;
  const n = s.end - s.start;
  const duration = n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}` : `${n} min`;
  return `${wallTimeLabel(naive(s.from, s.start))} – ${wallTimeLabel(naive(s.from, s.end))} · ${duration} · ${currentZone()}`;
}

type Session = { date: string; minute: number; x: number; y: number; pointer: number; column: HTMLElement; range: Selection; zone: string };

/** Empty-space selection is separate from moving/resizing existing events. Document listeners keep a drag alive outside its cell. */
export function useCalendarSelection({ root, scroll, allDay = false, disabled, onSelect }: {
  root: RefObject<HTMLDivElement | null>;
  scroll?: RefObject<HTMLDivElement | null>;
  allDay?: boolean;
  disabled?: boolean;
  onSelect?: (draft: Draft) => void;
}) {
  const session = useRef<Session | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  if (disabled && selection) setSelection(null);
  const active = selection !== null;

  useEffect(() => {
    if (!active || disabled || !onSelect) return;
    let frame = 0;
    const update = (x: number, y: number) => {
      const s = session.current;
      if (!s) return;
      if (!root.current?.contains(s.column) || s.zone !== currentZone()) {
        session.current = null;
        setSelection(null);
        return;
      }
      s.x = x;
      s.y = y;
      if (allDay) {
        const cells = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-select-date]') ?? []);
        const cell = cells.find((c) => {
          const r = c.getBoundingClientRect();
          return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
        });
        if (cell?.dataset.selectDate) {
          const date = cell.dataset.selectDate;
          s.range = { from: date < s.date ? date : s.date, to: date > s.date ? date : s.date, start: 0, end: 1440, allDay: true };
        }
      } else {
        const r = s.column.getBoundingClientRect();
        const minute = Math.max(0, Math.min(1440, Math.round((y - r.top) / r.height * 1440 / 15) * 15));
        const start = Math.min(s.minute, minute);
        s.range = { from: s.date, to: s.date, start, end: Math.max(start + 15, s.minute, minute), allDay: false };
      }
      setSelection({ ...s.range });
    };
    const cancel = () => { session.current = null; setSelection(null); };
    const move = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== session.current?.pointer) return;
      ev.preventDefault();
      update(ev.clientX, ev.clientY);
    };
    const end = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== session.current?.pointer) return;
      update(ev.clientX, ev.clientY);
      const range = session.current?.range;
      cancel();
      if (range) onSelect(selectionDraft(range));
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      cancel();
    };
    const tick = () => {
      const s = session.current;
      const el = scroll?.current;
      if (s && el) {
        const r = el.getBoundingClientRect();
        const speed = (at: number, lo: number, hi: number) => at < lo + 32 ? -12 : at > hi - 32 ? 12 : 0;
        const before = el.scrollTop;
        const left = el.scrollLeft;
        el.scrollTop += speed(s.y, r.top, r.bottom);
        el.scrollLeft += speed(s.x, r.left, r.right);
        if (before !== el.scrollTop || left !== el.scrollLeft) update(s.x, s.y);
      }
      if (session.current) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
      session.current = null;
    };
  }, [active, allDay, disabled, onSelect, root, scroll]);

  const begin = (ev: PointerEvent<HTMLDivElement>, date: string) => {
    if (disabled || !onSelect || ev.button !== 0 || ev.target !== ev.currentTarget) return;
    ev.preventDefault();
    const r = ev.currentTarget.getBoundingClientRect();
    const minute = allDay ? 0 : Math.max(0, Math.min(1425, Math.floor((ev.clientY - r.top) / r.height * 1440 / 15) * 15));
    const range = { from: date, to: date, start: minute, end: minute + 15, allDay };
    session.current = { date, minute, x: ev.clientX, y: ev.clientY, pointer: ev.pointerId, column: ev.currentTarget, range, zone: currentZone() };
    setSelection(range);
  };
  return { selection: disabled ? null : selection, begin };
}

export function SelectionHint({ selection }: { selection: Selection }) {
  return <span role="status" className="pointer-events-none sticky top-0 z-20 block rounded bg-primary px-1 py-0.5 text-[10px] font-semibold text-white">{selectionLabel(selection)}</span>;
}
