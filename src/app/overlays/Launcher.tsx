import { useState } from 'react';
import { LAUNCHER_GROUPS, type AppDefinition } from '@shared/apps';
import { app, updatePrefs } from '../../core/app-state';
import { call } from '../../core/bridge';
import { appLabel } from '../../core/i18n';
import { useStore } from '../../core/store';
import { navigate, openTab } from '../../core/tabs';
import { closeOverlay } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { IconButton, cx } from '../../components/ui';

/**
 * App launcher (§4.3, FR-NAV-02): the user's apps grouped Communication /
 * Work / Business / People / Operations / Admin, with pin, open in new tab
 * and open in a new window. Apps without a desktop module yet open in the
 * browser and say so. Apps the user cannot open are not listed at all.
 */
export function Launcher() {
  const apps = useStore(app, (s) => s.apps);
  const pinned = useStore(app, (s) => s.prefs?.pinnedApps ?? []);
  const [filter, setFilter] = useState('');
  const list = apps.filter((a) => a.id !== 'home' && (!filter || appLabel(a).toLowerCase().includes(filter.toLowerCase())));

  const open = (a: AppDefinition, how: 'tab' | 'new-tab' | 'window') => {
    closeOverlay();
    if (a.surface === 'browser') {
      void call('app:openInBrowser', { path: a.webPath });
      return;
    }
    if (how === 'tab') navigate(`/${a.id}`);
    else if (how === 'new-tab') openTab(`/${a.id}`);
    else void call('windows:open', { kind: 'record', route: `/${a.id}`, title: a.label });
  };
  const togglePin = (a: AppDefinition) => {
    const next = pinned.includes(a.id) ? pinned.filter((p) => p !== a.id) : [...pinned, a.id];
    void updatePrefs({ pinnedApps: next });
  };

  return (
    <div className="no-drag fixed inset-0 z-50 flex items-start justify-center bg-[#0B1020]/40 pt-[70px]" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()} onKeyDown={(e) => e.key === 'Escape' && closeOverlay()}>
      <div className="animate-in flex max-h-[80vh] w-[860px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-2xl" role="dialog" aria-label="Apps">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <h2 className="text-[17px] font-bold text-ink">Apps</h2>
          <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an app" className="h-9 flex-1 rounded-[8px] border border-line bg-ground px-3 text-[13px] outline-none focus:border-primary" aria-label="Find an app" />
          <IconButton icon="x" label="Close" onClick={closeOverlay} />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-x-6 gap-y-4 overflow-y-auto p-5 scroll-thin">
          {LAUNCHER_GROUPS.map((g) => {
            const items = list.filter((a) => a.group === g.id);
            if (items.length === 0) return null;
            return (
              <section key={g.id}>
                <h3 className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-ink-3">{g.label}</h3>
                <ul className="flex flex-col gap-0.5">
                  {items.map((a) => (
                    <li key={a.id} className="group flex items-center gap-1 rounded-[9px] hover:bg-subtle">
                      <button type="button" onClick={() => open(a, 'tab')} className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left">
                        <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]', a.surface === 'native' ? 'bg-selection text-primary' : 'bg-subtle text-ink-2')}>
                          <Icon name={a.icon} size={17} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-semibold text-ink">{appLabel(a)}</span>
                          <span className="block truncate text-[11.5px] text-ink-3">{a.surface === 'native' ? 'Desktop app' : 'Opens in your browser'}</span>
                        </span>
                      </button>
                      <div className="flex shrink-0 gap-0.5 pr-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                        {a.surface === 'native' ? (
                          <>
                            <IconButton icon="plus" label={`Open ${a.label} in a new tab`} onClick={() => open(a, 'new-tab')} size={15} />
                            <IconButton icon="external" label={`Open ${a.label} in a new window`} onClick={() => open(a, 'window')} size={15} />
                          </>
                        ) : (
                          <IconButton icon={pinned.includes(a.id) ? 'pin-off' : 'pin'} label={pinned.includes(a.id) ? `Unpin ${a.label}` : `Pin ${a.label} to the sidebar`} onClick={() => togglePin(a)} size={15} />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
