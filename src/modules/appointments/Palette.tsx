import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { cx } from '../../components/ui';
import { K, searchClients, today, type Dashboard } from './api';
import { input, useDesk } from './parts';
import type { View } from './Rail';

/**
 * D24 · Command palette (⌘J in Appointments): screens, the desk's actions, today's appointments and clients by name or
 * phone. ↑ ↓ choose, Enter opens, Esc closes. The list of desk shortcuts is shown beside it.
 */
interface Item { group: string; label: string; hint?: string; key?: string; run: () => void }

const SHORTCUTS: Array<[string, string]> = [
  ['New appointment', 'N'],
  ['Walk-in', 'F2'],
  ['Today', 'T'],
  ['Calendar: day / week', 'D / W'],
  ['Previous / next day', '← →'],
  ['Check in (panel)', 'C'],
  ['Move (panel)', 'M'],
  ['Palette', '⌘J'],
];

export default function Palette({ onClose, onGo }: { onClose: () => void; onGo: (v: View, extra?: string) => void }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const needle = q.trim().toLowerCase();
  const clients = useQuery({ queryKey: K.clients(needle), queryFn: ({ signal }) => searchClients(needle, signal), enabled: needle.length >= 2 && desk.online });
  const day = qc.getQueryData<Dashboard>(K.dashboard(today()));

  const items = useMemo(() => {
    const go = (v: View, label: string, key?: string): Item => ({ group: 'Go to', label, key, run: () => onGo(v) });
    const all: Item[] = [
      { group: 'Actions', label: 'New appointment', key: 'N', run: () => (onClose(), desk.book()) },
      { group: 'Actions', label: 'Walk-in', key: 'F2', run: () => onGo('walkin') },
      { group: 'Actions', label: 'Print day sheets', run: () => onGo('daysheet') },
      go('today', 'Today', 'T'), go('calendar', 'Calendar'), go('list', 'Appointments list'), go('clients', 'Clients'), go('waitlist', 'Waitlist'),
      go('outbox', 'Outbox'), go('reports', 'Reports'), go('commission', 'Commission'), go('setup', 'Set up'), go('settings', 'This desk'), go('alerts', 'Notifications'),
      ...(day?.schedule ?? []).map((a) => ({ group: 'Today', label: `${a.local.start} ${a.customer.name}`, hint: `${a.service.name} · ${a.provider.name} · ${a.status_label}`, run: () => (onClose(), desk.open(a.id)) })),
      ...(clients.data?.items ?? []).map((c) => ({ group: 'Clients', label: c.name, hint: c.phone ?? c.email ?? undefined, run: () => (onClose(), desk.client(c.id)) })),
    ];
    return needle ? all.filter((x) => `${x.label} ${x.hint ?? ''}`.toLowerCase().includes(needle) || x.group === 'Clients') : all.filter((x) => x.group !== 'Today').concat(all.filter((x) => x.group === 'Today').slice(0, 6));
  }, [needle, day, clients.data, desk, onClose, onGo]);

  return (
    <div className="no-drag fixed inset-0 z-50 flex items-start justify-center bg-[#0B1020]/40 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="flex w-[820px] max-w-[92vw] overflow-hidden rounded-[14px] border border-line bg-surface shadow-2xl">
        <div className="min-w-0 flex-1">
          <input
            autoFocus
            className={cx(input, 'h-12 rounded-none border-0 border-b px-4 text-[15px]')}
            placeholder="Go to, do, or find a client…"
            aria-label="Command"
            value={q}
            onChange={(e) => (setQ(e.target.value), setI(0))}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') setI((x) => Math.min(items.length - 1, x + 1));
              else if (e.key === 'ArrowUp') setI((x) => Math.max(0, x - 1));
              else if (e.key === 'Enter') items[i]?.run();
              else return;
              e.preventDefault();
            }}
          />
          <ul role="listbox" aria-label="Results" className="m-0 max-h-[52vh] list-none overflow-y-auto p-1.5 scroll-thin">
            {items.map((x, n) => (
              <li key={`${x.group}-${x.label}-${n}`}>
                {n === 0 || items[n - 1]!.group !== x.group ? <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-bold tracking-[.06em] text-ink-3 uppercase">{x.group}</div> : null}
                <button type="button" role="option" aria-selected={n === i} onMouseEnter={() => setI(n)} onClick={x.run} className={cx('flex w-full items-baseline gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[13px]', n === i ? 'bg-[#EEF1FD] dark:bg-selection' : '')}>
                  <span className="font-semibold text-ink">{x.label}</span>
                  {x.hint ? <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{x.hint}</span> : <span className="flex-1" />}
                  {x.key ? <span className="font-mono text-[11px] text-ink-3">{x.key}</span> : null}
                </button>
              </li>
            ))}
            {!items.length ? <li className="px-3 py-4 text-[12.5px] text-ink-3">Nothing matches.</li> : null}
          </ul>
          <div className="border-t border-line px-4 py-2 text-[11px] text-ink-3">↑ ↓ choose · Enter open · Esc close</div>
        </div>
        <aside className="w-[220px] shrink-0 border-l border-line bg-ground p-3.5">
          <div className="mb-2 text-[11px] font-bold tracking-[.06em] text-ink-3 uppercase">Desk shortcuts</div>
          {SHORTCUTS.map(([l, k]) => (
            <div key={l} className="flex justify-between py-1 text-[12px]"><span className="text-ink-2">{l}</span><span className="font-mono text-ink-3">{k}</span></div>
          ))}
        </aside>
      </div>
    </div>
  );
}
