import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { appLabel } from '../../core/i18n';
import { app } from '../../core/app-state';
import { ApiError, apiGet } from '../../core/api';
import { call } from '../../core/bridge';
import { allCommands, prettyAccelerator, effectiveShortcuts } from '../../core/commands';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { openWebLink } from '../../core/tab-context';
import { closeOverlay, ui } from '../../core/ui';
import { relative } from '../../core/time';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * Global search (Ctrl/Cmd+K, FR-SRCH-01/02) and the command palette
 * (Ctrl/Cmd+Shift+P, FR-SRCH-03). Search covers the user's apps and the
 * server's permission-aware global search; offline it falls back to the
 * local cache and says so. The palette runs shell and module commands.
 */
interface Row {
  key: string;
  group: string;
  title: string;
  subtitle?: string;
  icon: string;
  hint?: string;
  run: () => void;
}

export function SearchOverlay({ mode }: { mode: 'search' | 'palette' }) {
  const seed = useStore(ui, (s) => s.searchSeed);
  const [q, setQ] = useState(mode === 'palette' ? '>' : seed);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const apps = useStore(app, (s) => s.apps);
  const shortcuts = effectiveShortcuts(useStore(app, (s) => s.prefs?.shortcuts));
  const network = useStore(app, (s) => s.status?.network);
  const palette = q.startsWith('>');
  const term = (palette ? q.slice(1) : q).trim();
  const [debounced, setDebounced] = useState(term);

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(term), 180);
    return () => clearTimeout(h);
  }, [term]);

  const online = network !== 'OFFLINE';
  const server = useQuery({
    queryKey: ['search', debounced],
    queryFn: ({ signal }) => apiGet<{ results: Array<{ group: string; items: Array<{ id: number; title: string; subtitle: string | null; route: string; at: string | null }> }> }>('/api/search/global', { q: debounced }, signal),
    enabled: !palette && online && debounced.length >= 2,
    staleTime: 15_000,
    retry: false,
  });
  const offline = useQuery({
    queryKey: ['search-offline', debounced],
    queryFn: () => call('offline:search', { q: debounced }),
    enabled: !palette && debounced.length >= 2 && (!online || (server.error instanceof ApiError && server.error.offline)),
  });

  const rows = useMemo<Row[]>(() => {
    const lower = term.toLowerCase();
    if (palette) {
      return allCommands()
        .filter((c) => !lower || c.label.toLowerCase().includes(lower) || (c.keywords ?? '').includes(lower))
        .map((c) => ({ key: `cmd:${c.id}`, group: c.group, title: c.label, icon: 'zap', hint: shortcuts[c.id] ? prettyAccelerator(shortcuts[c.id]!) : undefined, run: c.run }));
    }
    const out: Row[] = [];
    for (const a of apps) {
      const label = appLabel(a);
      if (!lower || label.toLowerCase().includes(lower) || (a.keywords ?? '').includes(lower)) {
        out.push({
          key: `app:${a.id}`,
          group: 'Apps',
          title: label,
          subtitle: a.surface === 'browser' ? 'Opens in your browser' : undefined,
          icon: a.icon,
          run: () => (a.surface === 'native' ? navigate(`/${a.id}`) : void call('app:openInBrowser', { path: a.webPath })),
        });
      }
    }
    if (!lower) return out.slice(0, 8);
    for (const g of server.data?.results ?? []) {
      for (const it of g.items) {
        out.push({ key: `srv:${g.group}:${it.id}:${it.route}`, group: g.group, title: it.title, subtitle: [it.subtitle, relative(it.at)].filter(Boolean).join(' · '), icon: 'search', run: () => openWebLink(it.route) });
      }
    }
    for (const it of offline.data ?? []) {
      out.push({ key: `off:${it.route}`, group: 'Offline results', title: it.title, subtitle: `${it.subtitle} · saved ${relative(it.cachedAt)}`, icon: 'cloud-off', run: () => navigate(it.route) });
    }
    return out;
  }, [palette, term, apps, server.data, offline.data, shortcuts]);

  const run = (r: Row | undefined) => {
    if (!r) return;
    closeOverlay();
    r.run();
  };

  const headed = rows.map((r, i) => ({ r, header: i === 0 || rows[i - 1]!.group !== r.group ? r.group : null }));
  return (
    <div className="no-drag fixed inset-0 z-50 flex items-start justify-center bg-[#0B1020]/40 pt-[90px]" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
      <div className="animate-in flex max-h-[70vh] w-[640px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-2xl" role="dialog" aria-label={palette ? 'Command palette' : 'Search'}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Icon name={palette ? 'zap' : 'search'} size={18} className="text-ink-3" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeOverlay();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(rows.length - 1, s + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === 'Enter') run(rows[sel]);
            }}
            placeholder={palette ? 'Type a command…' : 'Search people, records, files, mail…  (type > for commands)'}
            className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
          />
          {server.isFetching ? <Icon name="spinner" size={16} className="animate-spin-slow text-ink-3" /> : null}
        </div>
        <ul id="search-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2 scroll-thin">
          {rows.length === 0 ? (
            <li className="p-6 text-center text-[13px] text-ink-3">{term.length < 2 && !palette ? 'Type at least two characters.' : 'Nothing found.'}</li>
          ) : null}
          {headed.map(({ r, header }, i) => {
            return (
              <li key={r.key}>
                {header ? <div className="px-2.5 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-ink-3">{header}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === sel}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => run(r)}
                  className={cx('flex w-full items-center gap-3 rounded-[8px] px-2.5 py-2 text-left', i === sel ? 'bg-selection' : 'hover:bg-subtle')}
                >
                  <Icon name={r.icon} size={17} className="shrink-0 text-ink-2" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-ink">{r.title}</span>
                    {r.subtitle ? <span className="block truncate text-[12px] text-ink-3">{r.subtitle}</span> : null}
                  </span>
                  {r.hint ? <kbd className="rounded-[5px] border border-line px-1.5 font-mono text-[11px] text-ink-3">{r.hint}</kbd> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {!online && !palette ? <div className="border-t border-line bg-warning-bg px-4 py-2 text-[12px] font-semibold text-warning">Offline — showing results saved on this computer.</div> : null}
      </div>
    </div>
  );
}
