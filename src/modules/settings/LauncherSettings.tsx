import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { hasPermission, LAUNCHER_GROUPS, navApps, type AppDefinition } from '@shared/apps';
import {
  addGroup,
  groupOfApp,
  launcherShortcutProblem,
  movePinned,
  moveToGroup,
  pinApp,
  PIN_MAX,
  removeGroup,
  renameGroup,
  setHidden,
  sortApps,
  unpinApp,
  type LauncherGroupBy,
  type LauncherMode,
  type LauncherOpenIn,
  type LauncherPrefs,
  type LauncherSize,
  type LauncherSort,
  type LauncherToggles,
} from '@shared/launcher';
import { app } from '../../core/app-state';
import { appColour } from '../../core/app-look';
import { call, errorMessage } from '../../core/bridge';
import { accelerator, effectiveShortcuts, prettyAccelerator } from '../../core/commands';
import { appLabel } from '../../core/i18n';
import { orgDefaults, resetLauncherPrefs, updateLauncherPrefs, useLauncherPrefs } from '../../core/launcher-prefs';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { openOverlay } from '../../core/ui';
import { AppTile } from '../../components/AppTile';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, Switch, cx } from '../../components/ui';

/**
 * Settings › App launcher (worksuite-desktop#201): how the launcher looks, which apps it pins and shows, how it groups
 * and sorts them, where it opens them and its shortcut — the person's own, synced to all their devices
 * (core/launcher-prefs). An administrator also sets the organization's default pinned apps and order here.
 */

/** What Settings calls each command whose shortcut the launcher's might take. */
export const COMMAND_NAMES: Record<string, string> = {
  search: 'Search',
  palette: 'Command palette',
  new: 'New (in this app)',
  'new-tab': 'New tab',
  'close-tab': 'Close tab',
  'restore-tab': 'Reopen closed tab',
  'move-tab-to-window': 'Move tab to new window',
  'dock-tab-beside': 'Dock tab beside',
  'next-tab': 'Next tab',
  'prev-tab': 'Previous tab',
  settings: 'Settings',
  ai: 'AI Assistant',
  'ai-alt': 'AI Assistant',
  'switch-org': 'Switch organization',
  lock: 'Lock WorkSuite',
  help: 'Help & Diagnostics',
};

const TOGGLES: Array<[keyof LauncherToggles, string, string]> = [
  ['recent', 'Show recent apps', 'A row of the apps you opened last.'],
  ['badges', 'Show unread badges', 'Counts from Mail, Chat and Tasks on app icons.'],
  ['browserMark', 'Mark apps that open in the browser', 'A small arrow on apps that are not in the desktop app yet.'],
  ['names', 'Show app names', 'Turn off for an icon-only grid.'],
];

const DRAG_TYPE = 'application/x-worksuite-app';

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-[16px] border border-line bg-surface p-[18px]" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[16px] font-bold text-ink">{title}</h3>
        {aside ? <span className="text-[12px] text-ink-3">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-[11px] border border-line bg-well p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('h-[34px] rounded-[8px] px-3.5 text-[13px] font-semibold', value === o.value ? 'bg-primary text-white' : 'text-ink-2 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Line({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="text-[14px] font-semibold text-ink">{label}</div>
        {hint ? <div className="text-[13px] text-ink-3">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function LauncherSettings() {
  const apps = useStore(app, (s) => s.apps);
  const prefs = useLauncherPrefs();
  const all = useMemo(() => navApps(apps).filter((a) => a.id !== 'home'), [apps]);
  const ordered = useMemo(() => sortApps(all, { ...prefs, sort: 'mine' }, appLabel), [all, prefs]);
  const byId = (id: string) => all.find((a) => a.id === id);
  const set = (fn: (p: LauncherPrefs) => LauncherPrefs | null, refused?: string) => {
    if (!updateLauncherPrefs(fn) && refused) toast('info', refused);
  };
  const pinned = prefs.pinned.map(byId).filter((a): a is AppDefinition => !!a);
  const shownCount = all.filter((a) => !prefs.hidden.includes(a.id)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[22px] font-bold text-ink">App launcher</h2>
          <p className="text-[13.5px] text-ink-3">Choose which apps you see, their order and how the launcher looks. Synced to all your devices.</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              resetLauncherPrefs();
              toast('success', 'The launcher is back to its defaults.');
            }}
          >
            Reset to default
          </Button>
          <Button variant="primary" onClick={() => openOverlay('launcher')}>
            Preview launcher
          </Button>
        </div>
      </div>

      <Card title="Layout">
        <Line label="Size" hint="Compact fits more apps on small screens.">
          <Segmented<LauncherSize> label="Size" value={prefs.size} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }, { value: 'large', label: 'Large' }]} onChange={(v) => set((p) => ({ ...p, size: v }))} />
        </Line>
        <Line label="Open as" hint="Popover sits centred over the app and sizes itself to the window. Full screen fills the window under the top bar, with larger tiles.">
          <Segmented<LauncherMode> label="Open as" value={prefs.mode} options={[{ value: 'popover', label: 'Popover' }, { value: 'fullscreen', label: 'Full screen' }]} onChange={(v) => set((p) => ({ ...p, mode: v }))} />
        </Line>
        {TOGGLES.map(([k, label, hint]) => (
          <Line key={k} label={label} hint={hint}>
            <Switch label={label} checked={prefs.toggles[k]} onChange={(v) => set((p) => ({ ...p, toggles: { ...p.toggles, [k]: v } }))} />
          </Line>
        ))}
      </Card>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        <PinnedApps prefs={prefs} pinned={pinned} all={ordered} set={set} />
        <ShowHide prefs={prefs} all={ordered} shown={shownCount} set={set} />
      </div>

      <section aria-label="Order and behaviour" className="grid gap-4 rounded-[16px] border border-line bg-surface p-[18px] [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        <Field label="Group apps by">
          <Select<LauncherGroupBy>
            label="Group apps by"
            value={prefs.groupBy}
            options={[{ value: 'default', label: 'Default categories' }, { value: 'mine', label: 'My groups' }, { value: 'none', label: 'No groups' }]}
            onValueChange={(v) => set((p) => ({ ...p, groupBy: v as LauncherGroupBy }))}
          />
        </Field>
        <Field label="Sort">
          <Select<LauncherSort> label="Sort" value={prefs.sort} options={[{ value: 'mine', label: 'My order' }, { value: 'az', label: 'A to Z' }, { value: 'used', label: 'Most used' }]} onValueChange={(v) => set((p) => ({ ...p, sort: v as LauncherSort }))} />
        </Field>
        <Field label="Open apps in">
          <Select<LauncherOpenIn>
            label="Open apps in"
            value={prefs.openIn}
            options={[{ value: 'new-tab', label: 'A new tab' }, { value: 'current-tab', label: 'The current tab' }, { value: 'window', label: 'A new window' }]}
            onValueChange={(v) => set((p) => ({ ...p, openIn: v as LauncherOpenIn }))}
          />
        </Field>
        <Field label="Keyboard shortcut">
          <ShortcutRecorder value={prefs.shortcut} onChange={(acc) => set((p) => ({ ...p, shortcut: acc }))} />
        </Field>
      </section>

      {prefs.groupBy === 'mine' || prefs.groups.length ? <MyGroups prefs={prefs} all={ordered} set={set} /> : null}
      <OrganizationDefaults prefs={prefs} all={all} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[14px] font-semibold text-ink">{label}</span>
      {children}
    </div>
  );
}

type Setter = (fn: (p: LauncherPrefs) => LauncherPrefs | null, refused?: string) => void;

function PinnedApps({ prefs, pinned, all, set }: { prefs: LauncherPrefs; pinned: AppDefinition[]; all: AppDefinition[]; set: Setter }) {
  const [drag, setDrag] = useState<number | null>(null);
  const full = prefs.pinned.length >= PIN_MAX;
  const candidates = all.filter((a) => !prefs.pinned.includes(a.id));
  const move = (from: number, to: number) => set((p) => movePinned(p, from, to));
  return (
    <Card title="Pinned apps" aside={`${pinned.length} of ${PIN_MAX} · drag to reorder`}>
      <ol className="flex flex-col gap-1.5" aria-label="Pinned apps">
        {pinned.map((a, i) => (
          <li
            key={a.id}
            draggable
            onDragStart={(e) => {
              setDrag(i);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', a.id);
            }}
            onDragOver={(e) => drag !== null && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (drag !== null) move(drag, i);
              setDrag(null);
            }}
            onDragEnd={() => setDrag(null)}
            className={cx('flex items-center gap-2.5 rounded-[10px] border border-line bg-well px-2.5 py-2', drag === i && 'opacity-50')}
          >
            <button
              type="button"
              aria-label={`Move ${appLabel(a)}`}
              title="Drag, or use the arrow keys, to reorder"
              onKeyDown={(e) => {
                const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
                if (to < 0 || to >= pinned.length) return;
                e.preventDefault();
                move(i, to);
              }}
              className="flex h-7 w-7 cursor-grab items-center justify-center rounded-[7px] text-ink-3 hover:bg-subtle"
            >
              <Icon name="grip" size={15} />
            </button>
            <AppTile icon={a.icon} colour={appColour(a.id)} size={30} radius={8} iconSize={16} />
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{appLabel(a)}</span>
            <button type="button" aria-label={`Unpin ${appLabel(a)}`} onClick={() => set((p) => unpinApp(p, a.id))} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 hover:bg-subtle hover:text-ink">
              <Icon name="x" size={14} />
            </button>
          </li>
        ))}
      </ol>
      {pinned.length === 0 ? <p className="text-[13px] text-ink-3">Nothing pinned. Pinned apps sit above the grid, in the order you choose.</p> : null}
      {full ? (
        <p className="text-[12.5px] text-ink-3">You can pin up to {PIN_MAX} apps. Unpin one to pin another.</p>
      ) : (
        <Select<string> label="Pin an app" placeholder="+ Pin an app" value="" options={candidates.map((a) => ({ value: a.id, label: appLabel(a) }))} onValueChange={(v) => set((p) => pinApp(p, String(v)), `You can pin up to ${PIN_MAX} apps.`)} />
      )}
    </Card>
  );
}

function categoryName(a: AppDefinition, prefs: LauncherPrefs): string {
  if (prefs.groupBy === 'mine') {
    const g = groupOfApp(prefs, a.id);
    return prefs.groups.find((x) => x.id === g)?.name ?? '';
  }
  return LAUNCHER_GROUPS.find((g) => g.id === a.group)?.label ?? '';
}

function ShowHide({ prefs, all, shown, set }: { prefs: LauncherPrefs; all: AppDefinition[]; shown: number; set: Setter }) {
  return (
    <Card title="Show or hide apps" aside={`${shown} of ${all.length} shown`}>
      <p className="text-[13px] text-ink-3">Hidden apps still open from search. Apps you don't have access to never show.</p>
      <ul className="flex max-h-[420px] flex-col overflow-y-auto scroll-thin" aria-label="Apps">
        {all.map((a) => {
          const on = !prefs.hidden.includes(a.id);
          return (
            <li
              key={a.id}
              draggable
              onDragStart={(e: DragEvent) => {
                e.dataTransfer.setData(DRAG_TYPE, a.id);
                e.dataTransfer.setData('text/plain', appLabel(a));
              }}
              className="flex items-center gap-2.5 py-1.5"
            >
              <span className={cx(!on && 'opacity-45')}>
                <AppTile icon={a.icon} colour={appColour(a.id)} size={30} radius={8} iconSize={16} />
              </span>
              <span className={cx('min-w-0 flex-1 truncate text-[14px] font-medium text-ink', !on && 'opacity-45')}>{appLabel(a)}</span>
              <span className="shrink-0 text-[12px] text-ink-3">{categoryName(a, prefs)}</span>
              <Switch label={`Show ${appLabel(a)}`} checked={on} onChange={(v) => set((p) => setHidden(p, a.id, !v))} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function MyGroups({ prefs, all, set }: { prefs: LauncherPrefs; all: AppDefinition[]; set: Setter }) {
  const [name, setName] = useState('');
  const [over, setOver] = useState<string | null>(null);
  const add = () => {
    if (!name.trim()) return;
    set((p) => addGroup(p, name)?.prefs ?? null, 'That group could not be made.');
    setName('');
  };
  return (
    <Card title="My groups" aside={prefs.groupBy === 'mine' ? 'Drag apps into a group' : 'Shown when Group apps by is My groups'}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="New group name" aria-label="New group name" className="h-10 min-w-0 flex-1 rounded-[10px] border border-line bg-well px-3 text-[13px] text-ink outline-none focus:border-primary" />
        <Button type="submit" icon="plus" disabled={!name.trim()}>
          Add group
        </Button>
      </form>
      {prefs.groups.map((g) => {
        const members = g.apps.map((id) => all.find((a) => a.id === id)).filter((a): a is AppDefinition => !!a);
        return (
          <div
            key={g.id}
            role="group"
            aria-label={g.name}
            onDragOver={(e) => {
              if (![...e.dataTransfer.types].includes(DRAG_TYPE)) return;
              e.preventDefault();
              setOver(g.id);
            }}
            onDragLeave={() => setOver((o) => (o === g.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData(DRAG_TYPE);
              if (id) set((p) => moveToGroup(p, id, g.id));
            }}
            className={cx('flex flex-col gap-2 rounded-[12px] border bg-well p-3', over === g.id ? 'border-primary' : 'border-line')}
          >
            <div className="flex items-center gap-2">
              <input defaultValue={g.name} maxLength={40} aria-label={`Name of ${g.name}`} onBlur={(e) => set((p) => renameGroup(p, g.id, e.target.value))} className="h-8 min-w-0 flex-1 rounded-[8px] border border-transparent bg-transparent px-1.5 text-[14px] font-semibold text-ink outline-none hover:border-line focus:border-primary" />
              <button type="button" aria-label={`Remove ${g.name}`} onClick={() => set((p) => removeGroup(p, g.id))} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 hover:bg-subtle hover:text-danger">
                <Icon name="trash" size={14} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {members.map((a) => (
                <span key={a.id} className="flex h-8 items-center gap-1.5 rounded-[9px] border border-line bg-surface pr-1 pl-1 text-[12px] font-semibold text-ink">
                  <AppTile icon={a.icon} colour={appColour(a.id)} size={22} radius={6} iconSize={13} />
                  {appLabel(a)}
                  <button type="button" aria-label={`Take ${appLabel(a)} out of ${g.name}`} onClick={() => set((p) => moveToGroup(p, a.id, null))} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle">
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
              {members.length === 0 ? <span className="text-[12.5px] text-ink-3">Drag apps here, or add one.</span> : null}
            </div>
            <Select<string> label={`Add an app to ${g.name}`} placeholder="Add an app…" value="" options={all.filter((a) => !g.apps.includes(a.id)).map((a) => ({ value: a.id, label: appLabel(a) }))} onValueChange={(v) => set((p) => moveToGroup(p, String(v), g.id))} />
          </div>
        );
      })}
    </Card>
  );
}

/** The launcher's own shortcut: recorded from the keys pressed, refused when another command has it (Search's ⌘K first). */
export function ShortcutRecorder({ value, onChange }: { value: string; onChange: (acc: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const overrides = useStore(app, (s) => s.prefs?.shortcuts);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Launcher shortcut"
          onClick={() => {
            setRecording(true);
            setProblem(null);
          }}
          onBlur={() => setRecording(false)}
          onKeyDown={(e) => {
            if (!recording) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Escape') return setRecording(false);
            const acc = accelerator(e.nativeEvent);
            if (!acc) return;
            const others = effectiveShortcuts(overrides);
            delete others.launcher;
            const p = launcherShortcutProblem(acc, others);
            setRecording(false);
            if (p?.kind === 'modifier') return setProblem('Use a combination with ⌘ or Ctrl, or Alt — a single key is for typing.');
            if (p?.kind === 'taken') return setProblem(`${prettyAccelerator(acc)} is already ${COMMAND_NAMES[p.command] ?? p.command}'s. Choose another.`);
            setProblem(null);
            onChange(acc);
          }}
          className={cx('h-10 min-w-0 flex-1 rounded-[10px] border px-3 text-left font-mono text-[13px]', recording ? 'border-primary bg-selection text-primary' : 'border-line bg-well text-ink')}
        >
          {recording ? 'Press keys…' : prettyAccelerator(value)}
        </button>
      </div>
      {problem ? (
        <span role="alert" className="text-[12px] text-danger">
          {problem}
        </span>
      ) : (
        <span className="text-[12px] text-ink-3">Opens and closes the launcher. ⌘K stays Search.</span>
      )}
    </div>
  );
}

/** The organization's default pinned apps and order, for an administrator of its desktop policy. */
function OrganizationDefaults({ prefs, all }: { prefs: LauncherPrefs; all: AppDefinition[] }) {
  const bootstrap = useStore(app, (s) => s.bootstrap);
  const server = useStore(app, (s) => s.auth?.server);
  const current = useStore(app, (s) => s.organizationId);
  const policy = bootstrap?.policy;
  const [busy, setBusy] = useState(false);
  const orgId = current ?? bootstrap?.defaultOrganizationId ?? bootstrap?.user.organizationId ?? null;
  const allowed = !!bootstrap && hasPermission({ apps: bootstrap.apps, permissions: bootstrap.permissions }, 'desktop.policies.manage');
  if (!allowed || server?.api !== 'desktop-v1' || !orgId) return null;
  const org = bootstrap.organizations.find((o) => o.id === orgId)?.name ?? 'your organization';
  const defaults = orgDefaults();
  const names = (ids: readonly string[] | null | undefined) =>
    (ids ?? [])
      .map((id) => all.find((a) => a.id === id))
      .filter((a): a is AppDefinition => !!a)
      .map(appLabel);
  const save = async (pinned: string[], order: string[], done: string) => {
    setBusy(true);
    try {
      await call('settings:launcherDefaults', { organizationId: orgId, pinned, order });
      toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const pinnedNow = names(defaults.pinned);
  return (
    <Card title="Organization default" aside="Admin">
      <p className="text-[13px] text-ink-3">
        The pinned apps and order everyone in {org} starts with until they choose their own. People only ever see the apps they have access to.
      </p>
      <div className="text-[13px] text-ink">
        <b className="font-semibold">Pinned now:</b> {pinnedNow.length ? pinnedNow.join(', ') : 'nothing'}
        {policy?.launcher_order?.length ? ` · a set order of ${policy.launcher_order.length} apps` : ''}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy} onClick={() => void save(prefs.pinned, sortApps(all, { ...prefs, sort: 'mine' }).map((a) => a.id), `My pinned apps and order are now ${org}'s default.`)}>
          Use my pinned apps and order
        </Button>
        <Button disabled={busy || (!pinnedNow.length && !policy?.launcher_order?.length)} onClick={() => void save([], [], `${org} has no launcher default now.`)}>
          Clear the default
        </Button>
      </div>
    </Card>
  );
}

