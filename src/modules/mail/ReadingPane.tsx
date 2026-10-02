import { useRef, useState, type ReactNode } from 'react';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { Menu } from '../../components/Menu';
import { Avatar, cx } from '../../components/ui';
import type { MessageRef } from './types';

/** A message open in the reading pane's tab strip. */
export interface OpenTab {
  key: string;
  ref: MessageRef;
  subject: string;
  from: string;
}

/** How many tabs the strip shows before the rest go under "+N". */
export const VISIBLE_TABS = 4;
/** How many messages stay open; opening one more closes the oldest that is not showing. */
export const MAX_TABS = 12;

/** The tabs after opening one: already open, it is kept where it is; otherwise it joins at the end. */
export function withTab(tabs: OpenTab[], tab: OpenTab, activeKey: string | null): OpenTab[] {
  const at = tabs.findIndex((t) => t.key === tab.key);
  if (at >= 0) return tabs.map((t, i) => (i === at ? { ...t, subject: tab.subject || t.subject, from: tab.from || t.from } : t));
  const next = [...tabs, tab];
  while (next.length > MAX_TABS) {
    const drop = next.findIndex((t) => t.key !== activeKey && t.key !== tab.key);
    next.splice(drop < 0 ? 0 : drop, 1);
  }
  return next;
}

/** Which tab shows after closing one: its right-hand neighbour, else the left. */
export function afterClose(tabs: OpenTab[], key: string, activeKey: string | null): { tabs: OpenTab[]; active: string | null } {
  const at = tabs.findIndex((t) => t.key === key);
  const rest = tabs.filter((t) => t.key !== key);
  if (activeKey !== key) return { tabs: rest, active: activeKey };
  const next = rest[at] ?? rest[at - 1] ?? null;
  return { tabs: rest, active: next?.key ?? null };
}

export function ReadingPane({ tabs, activeKey, onActivate, onClose, children, empty }: { tabs: OpenTab[]; activeKey: string | null; onActivate: (t: OpenTab) => void; onClose: (key: string) => void; children: ReactNode; empty: ReactNode }) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const activeAt = tabs.findIndex((t) => t.key === activeKey);
  // The active tab always shows, even when it is far down the list.
  const shown = activeAt >= VISIBLE_TABS ? [...tabs.slice(0, VISIBLE_TABS - 1), tabs[activeAt]!] : tabs.slice(0, VISIBLE_TABS);
  const hidden = tabs.filter((t) => !shown.includes(t));
  return (
    <section aria-label="Reading pane" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      {tabs.length ? (
        <div role="tablist" aria-label="Open messages" className="flex h-10 shrink-0 items-end gap-1 border-b border-line bg-subtle px-2 pt-1.5">
          {shown.map((t) => {
            const on = t.key === activeKey;
            return (
              <div
                key={t.key}
                role="tab"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                title={`${t.subject}\n${t.from}`}
                onClick={() => onActivate(t)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onActivate(t);
                  } else if (e.key === 'Delete') onClose(t.key);
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) onClose(t.key);
                }}
                className={cx('group flex h-full min-w-0 max-w-[200px] flex-1 cursor-default items-center gap-1.5 rounded-t-[8px] border border-b-0 px-2.5 text-[12.5px]', on ? 'border-line bg-surface font-bold text-ink' : 'border-transparent text-ink-2 hover:bg-surface/60')}
              >
                <Avatar name={t.from} size={18} />
                <span className="min-w-0 flex-1 truncate">{t.subject || text('(no subject)')}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(t.key);
                  }}
                  aria-label={text('Close {subject}', { subject: t.subject || text('(no subject)') })}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-ink-3 opacity-70 hover:bg-subtle hover:text-ink group-hover:opacity-100"
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            );
          })}
          {hidden.length ? (
            <button ref={more} type="button" onClick={() => setOverflowOpen(true)} aria-haspopup="menu" aria-label={text('{n} more open messages', { n: hidden.length })} className="mb-1 inline-flex h-7 shrink-0 items-center gap-0.5 rounded-[6px] px-2 text-[12.5px] font-semibold text-ink-2 hover:bg-surface">
              +{hidden.length}
              <Icon name="chevron-down" size={12} />
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{tabs.length && activeKey ? children : empty}</div>
      {overflowOpen ? (
        <Menu
          label={text('Open messages')}
          anchor={more}
          prefer="bottom"
          align="end"
          onClose={() => setOverflowOpen(false)}
          sections={[{ id: 'tabs', items: hidden.map((t) => ({ id: t.key, label: t.subject || text('(no subject)'), description: t.from, onSelect: () => onActivate(t) })) }]}
        />
      ) : null}
    </section>
  );
}
