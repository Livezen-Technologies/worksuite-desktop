import { useState, type DragEvent, type ReactNode } from 'react';
import { bytes } from '../../core/time';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { PrimaryActionButton, SidebarIconButton } from '../../components/PrimaryAction';
import { GROUPS, type Counts, type TreeNode, type View } from './api';
import { PopMenu, below, type MenuItem } from './Menu';
import { useSync, useSyncAvailable } from './sync';

export type Place = { view: View; folder: number | null };

const row = (on: boolean, depth = 0) => cx('group relative flex h-7 w-full shrink-0 items-center gap-[9px] rounded-[8px] pr-2 text-left text-[13px]', on ? 'bg-selection font-bold text-primary' : 'font-medium text-ink hover:bg-subtle', depth === 0 ? 'pl-2.5' : '');
const bar = (on: boolean) => cx('absolute top-[7px] bottom-[7px] left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent');
const badge = (on: boolean) => cx('flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] px-1.5 text-[11px] font-semibold tabular-nums', on ? 'bg-surface text-primary' : 'bg-subtle text-ink-2');

const TREE_KEY = 'files.tree-open';
function storedOpen(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(TREE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

/**
 * The Drive rail (DriveRail): New and Upload; the places; your folders as a
 * tree you can drop onto; find by type or date; tidying up; settings; and
 * how much space is used.
 */
export function Rail({
  place, counts, tree, used, quota, ancestors, onPlace, newItems, onUpload, onDrop, canPartners,
}: {
  place: Place;
  counts: Counts | undefined;
  tree: TreeNode[];
  used: number;
  quota: number | null;
  ancestors: number[];
  onPlace: (p: Place) => void;
  newItems: MenuItem[];
  onUpload: () => void;
  onDrop: (e: DragEvent, folder: number | null) => void;
  canPartners: boolean;
}) {
  const [shut, setShut] = useState<Record<string, boolean>>({ set: true });
  const [openIds, setOpenIds] = useState<number[]>(storedOpen);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [over, setOver] = useState<number | 'root' | null>(null);
  const isOn = (v: View) => place.view === v && (v !== 'folder' || place.folder === null);
  const expanded = new Set([...openIds, ...ancestors]);

  const toggleOpen = (id: number) => {
    const next = expanded.has(id) ? openIds.filter((x) => x !== id && !ancestors.includes(x)) : [...openIds, id];
    setOpenIds(next);
    try {
      localStorage.setItem(TREE_KEY, JSON.stringify(next.slice(-400)));
    } catch {
      /* a convenience only */
    }
  };

  const dropProps = (target: number | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-ws-drive') && !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      setOver(target ?? 'root');
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      onDrop(e, target);
    },
  });

  const head = (key: string, label: string, count: number) => (
    <button type="button" aria-expanded={!shut[key]} onClick={() => setShut({ ...shut, [key]: !shut[key] })} className="mt-1.5 flex h-6 shrink-0 items-center gap-1.5 pr-1.5 pl-2 text-left text-[11px] font-bold tracking-[0.3px] text-ink-3">
      <span className="flex-1">{label}</span>
      {shut[key] ? <span className="flex h-4 min-w-[18px] items-center justify-center rounded-lg bg-subtle px-[5px] text-[10.5px]">{count}</span> : null}
      <Icon name="chevron-down" size={13} className={cx('shrink-0 transition-transform', shut[key] && '-rotate-90')} />
    </button>
  );

  const item = (v: View, label: string, icon: string, count?: number, tint?: string): ReactNode => {
    const on = isOn(v);
    return (
      <button key={v} type="button" aria-current={on ? 'page' : undefined} title={label} onClick={() => onPlace({ view: v, folder: null })} className={row(on)} {...(v === 'folder' ? dropProps(null) : {})}>
        <span className={bar(on)} />
        <Icon name={icon} size={16} className={cx('w-[18px] shrink-0', on ? 'text-primary' : (tint ?? 'text-ink-2'))} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count ? <span className={badge(on)}>{count.toLocaleString()}</span> : null}
        {v === 'folder' && over === 'root' ? <span className="absolute inset-0 rounded-[8px] ring-2 ring-primary" /> : null}
      </button>
    );
  };

  const branch = (nodes: TreeNode[], depth: number): ReactNode[] =>
    nodes.flatMap((n) => {
      const on = place.view === 'folder' && place.folder === n.id;
      const open = expanded.has(n.id);
      return [
        <button key={n.id} type="button" aria-current={on ? 'page' : undefined} aria-expanded={n.children.length ? open : undefined} title={n.path ?? n.name} onClick={() => onPlace({ view: 'folder', folder: n.id })} className={row(on, depth)} style={{ paddingLeft: 4 + depth * 18 }} {...dropProps(n.id)}>
          <span className={bar(on)} />
          <span
            role="presentation"
            onClick={(e) => {
              e.stopPropagation();
              if (n.children.length) toggleOpen(n.id);
            }}
            className="flex w-3.5 shrink-0 justify-center text-ink-3"
          >
            {n.children.length ? <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} /> : null}
          </span>
          <span className="flex w-[18px] shrink-0 justify-center" style={{ color: n.color ?? '#0E7C86' }}>
            <Icon name={n.is_locked ? 'lock' : 'folder'} size={16} strokeWidth={1.9} />
          </span>
          <span className="min-w-0 flex-1 truncate">{n.name}</span>
          {n.starred ? <Icon name="star" size={11} className="shrink-0 fill-current text-[#E9A23B]" /> : null}
          {over === n.id ? <span className="absolute inset-0 rounded-[8px] ring-2 ring-primary" /> : null}
        </button>,
        ...(open ? branch(n.children, depth + 1) : []),
      ];
    });

  const pct = quota ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  const sync = useSync();
  const syncOn = useSyncAvailable();
  const syncLine = syncOn && sync?.folders.length ? syncSummary(sync) : null;

  return (
    <nav aria-label="Drive" className="flex w-[240px] shrink-0 flex-col border-r border-line bg-surface text-[13px]">
      <div className="flex gap-1.5 px-3 pt-3 pb-2">
        <PrimaryActionButton label="New" hint="New file, folder or document" onMenu={(el) => setMenu(below(el, 'left', 300))} className="flex-1" />
        <SidebarIconButton icon="upload" label="Upload files" onClick={onUpload} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pt-0.5 pb-1.5 scroll-thin">
        {item('home', 'Home', 'home')}
        {item('folder', 'My Drive', 'folder', counts?.files)}
        {item('recent', 'Recent', 'clock', counts?.recent)}
        {item('starred', 'Starred', 'star', counts?.starred)}
        {item('shared', 'Shared with me', 'users')}
        {item('my_shares', 'Shared by me', 'send')}
        {head('fold', 'Folders', tree.length)}
        {!shut.fold ? (tree.length ? branch(tree, 0) : <span className="px-2.5 py-1 text-[12px] text-ink-3">No folders yet.</span>) : null}
        {head('find', 'Filters', GROUPS.length)}
        {!shut.find
          ? GROUPS.map((g) => {
              const on = g.views.includes(place.view);
              return (
                <button key={g.id} type="button" aria-current={on ? 'page' : undefined} title={g.hint ?? g.label} onClick={() => onPlace({ view: g.views[0]!, folder: null })} className={row(on)}>
                  <span className={bar(on)} />
                  <Icon name={g.icon} size={16} className={cx('w-[18px] shrink-0', on ? 'text-primary' : 'text-ink-2')} />
                  <span className="min-w-0 flex-1 truncate">{g.label}</span>
                </button>
              );
            })
          : null}
        {head('tidy', 'Tidy up', 4)}
        {!shut.tidy ? (
          <>
            {item('duplicates', 'Duplicates', 'copy')}
            {item('large', 'Large files', 'weight')}
            {item('storage', 'Storage', 'disk')}
            {item('trash', 'Recycle bin', 'trash', counts?.trash)}
          </>
        ) : null}
        {head('set', 'Settings', (canPartners ? 4 : 3) + (syncOn ? 1 : 0))}
        {!shut.set ? (
          <>
            {item('settings', 'Drive settings', 'settings')}
            {syncOn ? item('devices', 'Sync devices', 'laptop') : null}
            {item('links', 'Secure links', 'link')}
            {item('notifications', 'Drive notifications', 'bell')}
            {canPartners ? item('companies', 'Sharing between companies', 'building') : null}
          </>
        ) : null}
      </div>
      <div className="mx-2.5 mb-2.5 flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-3 py-2.5">
        <div className="flex items-baseline gap-1.5">
          <b className="text-[13px] whitespace-nowrap text-ink">{bytes(used)}</b>
          <span className="min-w-0 flex-1 text-[12px] text-ink-2">{quota ? `of ${bytes(quota)} used` : 'used'}</span>
          <button type="button" onClick={() => onPlace({ view: 'storage', folder: null })} className="text-[11.5px] font-bold text-primary hover:underline">Manage</button>
        </div>
        {quota ? (
          <div role="meter" aria-label="Storage used" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="flex h-1.5 overflow-hidden rounded-[3px] bg-subtle">
            <span className={cx('h-1.5 rounded-[3px]', pct > 90 ? 'bg-danger' : 'bg-primary')} style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        {syncLine ? (
          <button type="button" onClick={() => onPlace({ view: 'devices', folder: null })} className="flex items-start gap-1.5 text-left text-[12px] leading-[1.35] text-ink-2 hover:text-ink">
            <Icon name={syncLine.icon} size={13} className={cx('mt-px shrink-0', syncLine.tone)} />
            <span className="min-w-0 flex-1">{syncLine.text}</span>
          </button>
        ) : null}
      </div>
      {menu ? <PopMenu at={menu} items={newItems} label="New" width={300} onClose={() => setMenu(null)} head={<div className="px-2.5 py-2 text-[11px] font-bold tracking-[0.6px] text-ink-2">NEW</div>} /> : null}
    </nav>
  );
}

/** The line under the storage meter: what sync on this computer is doing. */
function syncSummary(s: NonNullable<ReturnType<typeof useSync>>): { icon: string; tone: string; text: string } {
  const pending = s.folders.reduce((n, f) => n + f.pending.up + f.pending.down, 0);
  const n = s.folders.length;
  const folders = `${n} ${n === 1 ? 'folder' : 'folders'}`;
  if (s.state === 'syncing') return { icon: 'refresh', tone: 'text-primary', text: pending ? `Syncing ${pending.toLocaleString()} ${pending === 1 ? 'item' : 'items'}` : 'Syncing…' };
  if (s.state === 'paused') return { icon: 'pause', tone: 'text-ink-3', text: `Sync paused · ${folders}` };
  if (s.state === 'offline') return { icon: 'cloud-off', tone: 'text-ink-3', text: 'Waiting for the server' };
  if (s.state === 'error' || s.state === 'disconnected' || s.state === 'blocked' || s.folders.some((f) => f.heldDeletions)) return { icon: 'warning', tone: 'text-warning', text: 'Sync needs attention' };
  return { icon: 'check-circle', tone: 'text-success', text: `Up to date · ${folders} on this computer` };
}
