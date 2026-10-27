import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet, apiGetMeta, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, OfflineNote, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { initials, matches, pillOf, subLine, typeOf, type Contact, type ContactDetail, type Group, type Stats } from './api';
import { formatPhone, toE164 } from '../../core/phone';
import { useSyncAccounts } from './sync/AccountsSettings';
import { SourceIcons } from './sync/SourceIcon';
import { TidyUp } from './TidyUp';
import { Directory } from './Directory';
import { ContactDrawer } from './Drawer';
import { EditDrawer } from './EditDrawer';
import { ImportWizard } from './ImportWizard';
import { Rail, VIEWS, type Place, type View } from './Rail';
import { SidePanel } from '../../components/SidePanel';

type Layout = 'card' | 'list';
const LAYOUT_KEY = 'contacts.layout';

function placeFrom(q: URLSearchParams): Place {
  const g = q.get('group');
  if (g && /^\d+$/.test(g)) return { group: Number(g) };
  const a = q.get('account');
  if (a && /^\d+$/.test(a)) return { account: Number(a) };
  const v = q.get('view') as View | null;
  return { view: v && VIEWS.some((x) => x.id === v) ? v : 'all' };
}

function paramsOf(place: Place): Record<string, string | number> {
  if ('group' in place) return { group: place.group };
  if ('account' in place) return { account: place.account };
  switch (place.view) {
    case 'fav':
      return { favorites: 1 };
    case 'archived':
      return { archived: 1 };
    case 'employee':
    case 'customer':
    case 'vendor':
      return { type: place.view };
    default:
      return {};
  }
}

function storedLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'card';
  } catch {
    return 'card';
  }
}

const STATS: Array<{ key: keyof Stats; label: string; icon: string; color: string }> = [
  { key: 'total', label: 'Total', icon: 'users', color: '#23349E' },
  { key: 'employees', label: 'Employees', icon: 'id-card', color: '#1F7A4D' },
  { key: 'customers', label: 'Customers', icon: 'user', color: '#B45309' },
  { key: 'vendors', label: 'Vendors', icon: 'building', color: '#7C3AED' },
  { key: 'favorites', label: 'Favorites', icon: 'star', color: '#D97706' },
  { key: 'birthdays', label: 'Birthdays', icon: 'cake', color: '#DB2777' },
];

const headBtn = 'flex h-9 items-center gap-[7px] rounded-[10px] border border-line bg-surface px-3 font-semibold text-ink hover:bg-subtle';

/**
 * Contacts (ContactsMain): your views and groups, the people in the one
 * chosen as cards or a list, and a person opened beside them. The company
 * directory saves colleagues in one click; import and export are here too.
 */
export default function ContactsPage(_props: ModuleProps) {
  useTabTitle('Contacts');
  const qc = useQueryClient();
  const { query, go, active } = useTab();
  const place = placeFrom(query);
  const opened = Number(query.get('open') ?? 0) || null;
  const [q, setQ] = useState('');
  const [layout, setLayoutState] = useState<Layout>(storedLayout);
  const [editing, setEditing] = useState<{ contact: ContactDetail | null } | null>(query.get('new') === '1' ? { contact: null } : null);
  const [importing, setImporting] = useState(query.get('import') === '1');
  const [addingGroup, setAddingGroup] = useState(false);
  const directory = 'view' in place && place.view === 'directory';
  const tidy = 'view' in place && place.view === 'tidy';
  const accounts = useSyncAccounts();

  const list = useQuery({
    queryKey: ['contacts', 'list', place],
    queryFn: ({ signal }) => apiGetMeta<Contact[]>('/api/contacts', paramsOf(place), signal),
    enabled: !directory && !tidy,
    refetchInterval: 120_000,
  });
  const stats = useQuery({ queryKey: ['contacts', 'stats'], queryFn: ({ signal }) => apiGet<Stats>('/api/contacts/stats', undefined, signal) });
  const groupsQ = useQuery({ queryKey: ['contacts', 'groups'], queryFn: ({ signal }) => apiGet<Group[]>('/api/contact-groups', undefined, signal) });
  const groups = groupsQ.data ?? [];
  // Import is offered as the server allows it (contacts.manage), as the web does.
  const resources = useQuery({ queryKey: ['data', 'resources'], queryFn: ({ signal }) => apiGet<{ resources: Array<{ key: string; import?: boolean }> }>('/api/data/resources', undefined, signal), staleTime: 10 * 60_000 });
  const canImport = !!resources.data?.resources?.find((r) => r.key === 'contacts')?.import;
  const all = list.data?.data ?? [];
  const term = q.trim().toLowerCase();
  const rows = all.filter((c) => matches(c, term));
  const card = opened ? all.find((c) => c.id === opened) : undefined;

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(query);
    p.delete('new');
    p.delete('import');
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    go(`/contacts${p.toString() ? `?${p}` : ''}`);
  };
  const setPlace = (p: Place) => {
    setQ('');
    set({ view: 'view' in p && p.view !== 'all' ? p.view : null, group: 'group' in p ? String(p.group) : null, account: 'account' in p ? String(p.account) : null, tab: null, open: null });
  };
  const open = (id: number | null) => set({ open: id ? String(id) : null });
  const setLayout = (l: Layout) => {
    setLayoutState(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* a convenience only */
    }
  };

  const star = async (c: Contact) => {
    try {
      const r = await apiPost<{ is_favorite: boolean }>(`/api/contacts/${c.id}/favorite`);
      qc.setQueryData<{ data: Contact[] }>(['contacts', 'list', place], (old) => (old ? { ...old, data: old.data.map((x) => (x.id === c.id ? { ...x, is_favorite: r.is_favorite } : x)) } : old));
      qc.setQueryData<ContactDetail>(['contacts', 'detail', c.id], (old) => (old ? { ...old, is_favorite: r.is_favorite } : old));
      toast('success', r.is_favorite ? 'Added to favorites' : 'Removed from favorites');
      void qc.invalidateQueries({ queryKey: ['contacts', 'stats'] });
      if ('view' in place && place.view === 'fav') void qc.invalidateQueries({ queryKey: ['contacts', 'list', place] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const exportAs = async (kind: 'csv' | 'vcf') => {
    const name = `worksuite-contacts.${kind}`;
    try {
      await call('transfers:download', { export: kind === 'csv' ? 'contacts-csv' : 'contacts-vcf', name });
      toast('info', `Saving ${name} to your downloads…`);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  // N a new contact, / search, Esc closes what is open beside the list.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || editing || importing || document.querySelector('[aria-modal="true"]')) return;
      if (e.key === 'Escape' && opened) {
        open(null);
        return;
      }
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === 'n') setEditing({ contact: null });
      else if (e.key === '/') document.querySelector<HTMLInputElement>('input[aria-label="Search contacts"], input[aria-label="Search directory"]')?.focus();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const group = 'group' in place ? groups.find((g) => g.id === place.group) : undefined;
  const account = 'account' in place ? accounts.data?.find((a) => a.id === place.account) : undefined;
  const title = 'group' in place ? (group?.name ?? 'Group') : 'account' in place ? (account ? `${account.provider_label}${account.email ? ` · ${account.email}` : ''}` : 'Account') : VIEWS.find((v) => v.id === place.view)!.label;
  const newGroup = () => setAddingGroup(true);

  return (
    <div className="flex h-full bg-ground text-[13px]">
      <SidePanel id="contacts" label="the Contacts menu">
        <Rail
          place={place}
          stats={stats.data}
          groups={groups}
          accounts={accounts.data}
          onPlace={setPlace}
          onNew={() => setEditing({ contact: null })}
          onImport={canImport ? () => setImporting(true) : undefined}
          onExport={(k) => void exportAs(k)}
          adding={addingGroup}
          setAdding={setAddingGroup}
        />
      </SidePanel>
      <main aria-label={title} className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {directory ? (
          <Directory onNewGroup={newGroup} onNew={() => setEditing({ contact: null })} />
        ) : tidy ? (
          <TidyUp tab={query.get('tab') === 'conflicts' ? 'conflicts' : 'duplicates'} onTab={(t) => set({ tab: t === 'conflicts' ? t : null })} onOpen={(id) => open(id)} />
        ) : (
          <>
            <div className="flex items-center gap-2.5 px-6 pt-5">
              <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold tracking-[-0.3px] text-ink">{title}</h1>
              <button type="button" onClick={newGroup} className={headBtn}>
                <Icon name="users" size={15} /> New group
              </button>
            </div>
            <div className="flex gap-2.5 px-6 pt-4">
              {STATS.map((s) => (
                <div key={s.key} className="flex min-w-0 flex-1 items-center gap-3 rounded-[14px] border border-line bg-surface px-3.5 py-3">
                  <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border" style={{ background: `${s.color}14`, borderColor: `${s.color}26`, color: s.color }}>
                    <Icon name={s.icon} size={18} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <b className="text-[19px] tracking-[-0.3px] text-ink tabular-nums">{stats.data ? stats.data[s.key].toLocaleString() : '–'}</b>
                    <span className="truncate text-[11.5px] text-ink-3">{s.label}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2.5 px-6 pt-4 pb-3">
              <label className="flex h-[38px] max-w-[420px] flex-1 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-ink-3 focus-within:border-primary">
                <Icon name="search" size={15} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts…" aria-label="Search contacts" className="flex-1 bg-transparent text-[13px] text-ink outline-none bare-focus" />
              </label>
              {list.data?.offline ? <OfflineNote cachedAt={list.data.cachedAt} /> : null}
              <span className="ml-auto text-[12px] text-ink-3">{rows.length ? `${rows.length.toLocaleString()} of ${all.length.toLocaleString()} shown` : ''}</span>
              <div role="group" aria-label="Layout" className="flex rounded-[10px] bg-subtle p-[3px]">
                {(
                  [
                    ['card', 'Cards', 'grid'],
                    ['list', 'List', 'list'],
                  ] as const
                ).map(([k, l, icon]) => (
                  <button key={k} type="button" aria-label={l} title={l} aria-pressed={layout === k} onClick={() => setLayout(k)} className={cx('flex h-[30px] w-8 items-center justify-center rounded-[8px]', layout === k ? 'bg-surface text-primary shadow-[0_1px_3px_rgb(var(--ws-shadow-rgb)/.12)]' : 'text-ink-3')}>
                    <Icon name={icon} size={15} />
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 scroll-thin">
              {list.isLoading ? <Spinner /> : null}
              {list.error && !list.data ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
              {list.isSuccess && !rows.length ? (
                <div className="flex flex-col items-center gap-2.5 px-5 py-[90px] text-center">
                  <span className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-selection text-primary"><Icon name="users" size={28} /></span>
                  <b className="mt-1 text-[15px] text-ink">{term ? 'No contacts match' : 'archived' === ('view' in place ? place.view : '') ? 'Nothing archived' : 'No contacts here yet'}</b>
                  <span className="text-[12.5px] text-ink-3">{term ? `Nothing matches “${q.trim()}”.` : 'Add someone, or import a file.'}</span>
                  {!term ? (
                    <button type="button" onClick={() => setEditing({ contact: null })} className="mt-1.5 flex h-9 items-center gap-1.5 rounded-[9px] bg-primary px-3.5 text-[13px] font-bold text-white hover:bg-primary-hover">
                      <Icon name="plus" size={15} /> New contact
                    </button>
                  ) : null}
                </div>
              ) : null}
              {rows.length && layout === 'card' ? (
                <div role="list" aria-label="Contacts" className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                  {rows.map((c) => (
                    <Card key={c.id} c={c} selected={c.id === opened} onOpen={() => open(c.id)} onStar={() => void star(c)} />
                  ))}
                </div>
              ) : null}
              {rows.length && layout === 'list' ? (
                <div role="table" aria-label="Contacts" className="overflow-hidden rounded-[14px] border border-line bg-surface">
                  <div role="row" className="flex h-9 items-center gap-3 border-b border-line bg-ground px-4 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                    <span role="columnheader" className="flex-1 pl-12">Name</span>
                    {!opened ? (
                      <>
                        <span role="columnheader" className="w-[220px]">Email</span>
                        <span role="columnheader" className="w-[140px]">Phone</span>
                      </>
                    ) : null}
                    <span role="columnheader" className="w-[84px]">Type</span>
                    <span className="w-7" />
                  </div>
                  {rows.map((c) => (
                    <Row key={c.id} c={c} selected={c.id === opened} narrow={!!opened} onOpen={() => open(c.id)} onStar={() => void star(c)} />
                  ))}
                </div>
              ) : null}
            </div>
          </>
        )}
        {opened && !editing ? (
          <ContactDrawer
            key={opened}
            id={opened}
            card={card}
            onClose={() => open(null)}
            onEdit={(c) => setEditing({ contact: c })}
            onGone={() => {
              qc.setQueryData<{ data: Contact[] }>(['contacts', 'list', place], (old) => (old ? { ...old, data: old.data.filter((x) => x.id !== opened) } : old));
              open(null);
            }}
          />
        ) : null}
        {editing ? (
          <EditDrawer
            key={editing.contact?.id ?? 'new'}
            contact={editing.contact}
            groups={groups}
            defaults={
              editing.contact
                ? undefined
                : {
                    ...('group' in place ? { group_ids: [place.group] } : 'view' in place && ['employee', 'customer', 'vendor'].includes(place.view) ? { type: place.view as 'employee' } : {}),
                    // "Create contact" from the Phone (VOIP-POP-05): the caller's number comes with it.
                    ...(query.get('mobile') ? { mobile: query.get('mobile')!.replace(/[^0-9+]/g, '').slice(0, 32) } : {}),
                  }
            }
            onClose={() => (setEditing(null), query.get('new') ? set({}) : undefined)}
            onSaved={(id) => {
              setEditing(null);
              void qc.invalidateQueries({ queryKey: ['contacts', 'detail', id] });
              set({ view: directory ? null : query.get('view'), open: String(id) });
            }}
          />
        ) : null}
      </main>
      {importing && canImport ? <ImportWizard onClose={() => (setImporting(false), query.get('import') ? set({}) : undefined)} /> : null}
    </div>
  );
}

function Avatar({ c, size }: { c: Contact; size: 46 | 36 }) {
  return (
    <span className={cx('flex shrink-0 items-center justify-center rounded-full font-bold text-white', size === 46 ? 'h-[46px] w-[46px] text-[15px]' : 'h-9 w-9 text-[12.5px]', c.is_archived && 'opacity-55')} style={{ background: c.avatar_color ?? '#23349E' }}>
      {initials(c.display_name)}
    </span>
  );
}

function Star({ c, onStar }: { c: Contact; onStar: () => void }) {
  return (
    <button type="button" aria-label={c.is_favorite ? `Remove ${c.display_name} from favorites` : `Add ${c.display_name} to favorites`} aria-pressed={c.is_favorite} onClick={onStar} className={cx('relative z-[1] flex h-[30px] w-[30px] shrink-0 items-center justify-center self-start rounded-[8px] hover:bg-subtle', c.is_favorite ? 'text-badge' : 'text-stage-ink-2 dark:text-ink-3')}>
      <Icon name="star" size={16} className={c.is_favorite ? 'fill-current' : ''} />
    </button>
  );
}

function Pill({ type }: { type: string }) {
  return <span className={cx('inline-flex h-5 items-center rounded-[10px] px-2 text-[11px] font-bold whitespace-nowrap', typeOf(type).tone)}>{pillOf(type)}</span>;
}

function Card({ c, selected, onOpen, onStar }: { c: Contact; selected: boolean; onOpen: () => void; onStar: () => void }) {
  return (
    <div role="listitem" className={cx('relative flex h-[92px] items-center gap-3 rounded-[14px] border bg-surface py-3.5 pr-2.5 pl-3.5', selected ? 'border-primary shadow-[0_0_0_3px_rgba(35,52,158,.12)]' : 'border-line shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.04)] hover:border-info-line dark:hover:border-ink-3')}>
      <button type="button" aria-label={c.display_name} onClick={onOpen} className="absolute inset-0 rounded-[14px]" />
      <Avatar c={c} size={46} />
      <span className="pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="truncate text-[13.5px] text-ink">{c.display_name}</b>
        <span className="truncate text-[12px] text-ink-3">{subLine(c)}</span>
        <span className="mt-1 flex gap-1 overflow-hidden">
          <Pill type={c.type} />
          <SourceIcons sources={c.sources} />
          {c.labels.slice(0, 1).map((l) => (
            <span key={l} className="inline-flex h-5 items-center truncate rounded-[10px] bg-selection px-[7px] text-[11px] font-semibold text-primary">{l}</span>
          ))}
        </span>
      </span>
      <Star c={c} onStar={onStar} />
    </div>
  );
}

function Row({ c, selected, narrow, onOpen, onStar }: { c: Contact; selected: boolean; narrow: boolean; onOpen: () => void; onStar: () => void }) {
  return (
    <div role="row" className={cx('relative flex h-14 items-center gap-3 border-t border-line/60 pr-3 pl-4 first-of-type:border-t-0', selected ? 'bg-selection/60 shadow-[inset_3px_0_0_var(--color-primary)]' : 'hover:bg-ground')}>
      <button type="button" aria-label={c.display_name} onClick={onOpen} className="absolute inset-0" />
      <Avatar c={c} size={36} />
      <span role="cell" className="pointer-events-none flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <b className="truncate text-[13px] text-ink">{c.display_name}</b>
          <SourceIcons sources={c.sources} size={13} />
        </span>
        <span className="truncate text-[11.5px] text-ink-3">{subLine(c)}</span>
      </span>
      {!narrow ? (
        <>
          <span role="cell" className="pointer-events-none w-[220px] truncate text-[12.5px] text-ink-2">{c.email || '—'}</span>
          <span role="cell" className="pointer-events-none w-[140px] truncate text-[12.5px] text-ink-2 tabular-nums">{c.phone ? formatPhone(toE164(c.phone)) || c.phone : '—'}</span>
        </>
      ) : null}
      <span role="cell" className="pointer-events-none w-[84px]"><Pill type={c.type} /></span>
      <Star c={c} onStar={onStar} />
    </div>
  );
}
