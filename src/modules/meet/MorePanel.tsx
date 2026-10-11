import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { PANEL_HELP } from '@shared/meet-panel';

export interface MoreItem {
  id: string;
  label: string;
  badge?: number;
  content: ReactNode;
}

/** The icon each tool is drawn with. A tool with no entry gets a neutral one. */
const ICON: Record<string, string> = {
  Polls: 'chart',
  Board: 'board',
  Notes: 'file',
  Files: 'folder',
  Info: 'info',
  Settings: 'settings',
  Session: 'life-buoy',
};

/**
 * What the meeting panel's **More** tab holds (the Meet Side Panel canvas).
 *
 * A grid of cards rather than more tabs: each one has room for a line saying
 * what the thing is for, which a tab strip has not. "Board" tells somebody who
 * has never opened it nothing; "Draw and sketch together" tells them whether
 * they want it.
 *
 * Opening one shows that tool **inside More**, with its name and a way back.
 * The alternative — switching the panel to a tab that is not in the strip —
 * would leave the strip highlighting nothing, and the way back would be a
 * mystery.
 */
export function MorePanel({ items }: { items: MoreItem[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const tool = items.find((t) => t.id === open) ?? null;

  if (tool) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
          <button type="button" onClick={() => setOpen(null)} className="flex h-7 items-center gap-1 rounded-[7px] px-1.5 text-[12.5px] font-semibold text-primary hover:bg-subtle">
            <Icon name="chevron-left" size={14} /> More
          </button>
          <span className="text-[12.5px] font-bold text-ink">{tool.label}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{tool.content}</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 content-start gap-2.5 p-3">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setOpen(t.id)}
          className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3 text-start hover:border-primary/40 hover:bg-subtle"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-selection text-primary">
            <Icon name={ICON[t.id] ?? 'grid'} size={16} />
          </span>
          <span className="flex items-center gap-1.5 text-[13.5px] font-bold text-ink">
            {t.label}
            {t.badge ? <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold text-white">{t.badge}</span> : null}
          </span>
          <span className="text-[12px] leading-snug text-ink-2">{PANEL_HELP[t.id] ?? ''}</span>
        </button>
      ))}
    </div>
  );
}
