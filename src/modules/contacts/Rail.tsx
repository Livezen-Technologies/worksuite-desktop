import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Modal, cx } from '../../components/ui';
import { GROUP_COLORS, type Group, type Stats } from './api';
import type { SyncAccount } from './sync/api';
import { SourceIcon } from './sync/SourceIcon';

export type View = 'all' | 'fav' | 'employee' | 'customer' | 'vendor' | 'archived' | 'directory' | 'tidy';
/** A view, a group, or the contacts synced with one account (worksuite-desktop#175). */
export type Place = { view: View } | { group: number } | { account: number };

export const VIEWS: Array<{ id: View; label: string; icon: string; tint?: string; count?: keyof Stats }> = [
  { id: 'all', label: 'All contacts', icon: 'users', count: 'total' },
  { id: 'fav', label: 'Favorites', icon: 'star', tint: 'text-[#D97706]', count: 'favorites' },
  { id: 'employee', label: 'Employees', icon: 'id-card', tint: 'text-[#1F9D5C]', count: 'employees' },
  { id: 'customer', label: 'Customers', icon: 'user', tint: 'text-[#D97706]', count: 'customers' },
  { id: 'vendor', label: 'Vendors', icon: 'building', tint: 'text-[#7C3AED]', count: 'vendors' },
  { id: 'archived', label: 'Archived', icon: 'archive' },
  { id: 'directory', label: 'Company directory', icon: 'contact' },
  // Possible duplicates and sync conflicts.
  { id: 'tidy', label: 'Tidy up', icon: 'sparkles' },
];

const item = (on: boolean) => cx('group relative flex h-[30px] w-full shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left text-[13px]', on ? 'bg-selection font-bold text-primary' : 'font-medium text-ink hover:bg-subtle');
const bar = (on: boolean) => cx('absolute top-[7px] bottom-[7px] left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent');
const badge = (on: boolean) => cx('flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] px-1.5 text-[11px] font-semibold tabular-nums', on ? 'bg-surface text-primary' : 'text-ink-3');

/** The views, your groups, your synced accounts, and import/export (ContactsRail). */
export function Rail({ place, stats, groups, accounts = [], onPlace, onNew, onImport, onExport, adding, setAdding }: { place: Place; stats: Stats | undefined; groups: Group[]; accounts?: SyncAccount[]; onPlace: (p: Place) => void; onNew: () => void; onImport?: () => void; onExport: (kind: 'csv' | 'vcf') => void; adding: boolean; setAdding: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [shut, setShut] = useState<{ v?: boolean; g?: boolean; a?: boolean }>({});
  const [exportOpen, setExportOpen] = useState(false);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<Group | null>(null);
  const on = (p: Place) => JSON.stringify(p) === JSON.stringify(place);

  const add = async () => {
    if (!name.trim()) return setAdding(false);
    try {
      const r = await apiPost<{ id: number }>('/api/contact-groups', { name: name.trim().slice(0, 100), color: GROUP_COLORS[groups.length % GROUP_COLORS.length] });
      setName('');
      setAdding(false);
      toast('success', 'Group created');
      void qc.invalidateQueries({ queryKey: ['contacts', 'groups'] });
      onPlace({ group: r.id });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const remove = async () => {
    const g = deleting;
    setDeleting(null);
    if (!g) return;
    try {
      await apiDelete(`/api/contact-groups/${g.id}`);
      toast('success', 'Group deleted');
      onPlace({ view: 'all' });
      void qc.invalidateQueries({ queryKey: ['contacts'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const head = (key: 'v' | 'g' | 'a', label: string, count: number, extra?: React.ReactNode) => (
    <div className="mt-2 flex h-[26px] shrink-0 items-center gap-1 pr-0.5 pl-2">
      <button type="button" aria-expanded={!shut[key]} onClick={() => setShut({ ...shut, [key]: !shut[key] })} className="flex h-6 flex-1 items-center gap-1.5 text-left text-[11px] font-bold tracking-[0.3px] text-ink-3">
        <span className="flex-1">{label}</span>
        {shut[key] ? <span className="flex h-4 min-w-[18px] items-center justify-center rounded-lg bg-subtle px-[5px] text-[10.5px]">{count}</span> : null}
        <Icon name="chevron-down" size={13} className={cx('shrink-0 transition-transform', shut[key] && '-rotate-90')} />
      </button>
      {extra}
    </div>
  );

  return (
    <nav aria-label="Contacts" className="flex w-[220px] shrink-0 flex-col border-r border-line bg-surface text-[13px]">
      <div className="px-2.5 pt-3 pb-2">
        <button type="button" onClick={onNew} title="New contact (N)" className="flex h-[38px] w-full items-center justify-center gap-2 rounded-[10px] bg-primary font-bold text-white shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.18),0_4px_12px_rgba(35,52,158,.22)] hover:bg-primary-hover">
          <Icon name="plus" size={16} /> New contact
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 scroll-thin">
        {head('v', 'Contacts', VIEWS.length)}
        {!shut.v
          ? VIEWS.map((v) => {
              const is = on({ view: v.id });
              const n = v.count ? stats?.[v.count] : undefined;
              return (
                <button key={v.id} type="button" aria-current={is ? 'page' : undefined} onClick={() => onPlace({ view: v.id })} className={item(is)}>
                  <span className={bar(is)} />
                  <Icon name={v.icon} size={16} className={cx('w-[18px] shrink-0', is ? 'text-primary' : (v.tint ?? 'text-ink-2'))} />
                  <span className="min-w-0 flex-1 truncate">{v.label}</span>
                  {n ? <span className={badge(is)}>{n.toLocaleString()}</span> : null}
                </button>
              );
            })
          : null}
        {head(
          'g',
          'Groups',
          groups.length,
          <button type="button" aria-label="New group" title="New group" onClick={() => (setShut({ ...shut, g: false }), setAdding(!adding))} className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] text-primary hover:bg-subtle">
            <Icon name="plus" size={14} />
          </button>,
        )}
        {!shut.g && adding ? (
          <div className="mt-0.5 mb-1 flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border-[1.5px] border-primary bg-surface pr-1.5 pl-2.5 shadow-[0_0_0_3px_rgba(59,91,219,.12)]">
            <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: GROUP_COLORS[groups.length % GROUP_COLORS.length] }} />
            <input
              autoFocus
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add();
                if (e.key === 'Escape') {
                  setName('');
                  setAdding(false);
                }
              }}
              aria-label="Group name"
              placeholder="Group name"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none bare-focus"
            />
            <button type="button" onClick={() => void add()} className="h-[22px] rounded-[6px] bg-primary px-2 text-[11px] font-bold text-white">Add</button>
          </div>
        ) : null}
        {!shut.g && !groups.length && !adding ? <div className="mx-1 my-0.5 rounded-[9px] border border-dashed border-line p-2.5 text-center text-[12px] text-ink-3">No groups yet</div> : null}
        {!shut.g
          ? groups.map((g) => {
              const is = on({ group: g.id });
              return (
                <div key={g.id} className="relative flex shrink-0">
                  <button type="button" aria-current={is ? 'page' : undefined} title={g.name} onClick={() => onPlace({ group: g.id })} className={item(is)}>
                    <span className={bar(is)} />
                    <span className="flex w-[18px] shrink-0 justify-center"><span className="h-[9px] w-[9px] rounded-full" style={{ background: g.color ?? '#94A3B8' }} /></span>
                    <span className="min-w-0 flex-1 truncate">{g.name}</span>
                    {is ? <span className="w-[22px]" /> : g.count ? <span className={badge(is)}>{g.count}</span> : null}
                  </button>
                  {is ? (
                    <button type="button" aria-label={`Delete group ${g.name}`} title="Delete group" onClick={() => setDeleting(g)} className="absolute top-[5px] right-1.5 flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:bg-surface hover:text-danger">
                      <Icon name="trash" size={13} />
                    </button>
                  ) : null}
                </div>
              );
            })
          : null}
        {accounts.length ? head('a', 'Accounts', accounts.length) : null}
        {accounts.length && !shut.a
          ? accounts.map((a) => {
              const is = on({ account: a.id });
              return (
                <button key={a.id} type="button" aria-current={is ? 'page' : undefined} title={`${a.provider_label}${a.email ? ` · ${a.email}` : ''}`} onClick={() => onPlace({ account: a.id })} className={item(is)}>
                  <span className={bar(is)} />
                  <span className="flex w-[18px] shrink-0 justify-center">
                    <SourceIcon provider={a.provider} size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{a.email ?? a.provider_label}</span>
                  {a.status === 'error' ? <Icon name="alert" size={13} className="shrink-0 text-danger" /> : null}
                  {a.contact_count ? <span className={badge(is)}>{a.contact_count.toLocaleString()}</span> : null}
                </button>
              );
            })
          : null}
      </div>
      <div className="relative mx-2.5 mt-1.5 mb-2.5 flex gap-1.5">
        {onImport ? (
          <button type="button" onClick={onImport} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-line bg-surface text-[12px] font-semibold text-ink hover:bg-subtle">
            <Icon name="upload" size={14} /> Import
          </button>
        ) : null}
        <button type="button" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen(!exportOpen)} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[9px] border border-line bg-surface text-[12px] font-semibold text-ink hover:bg-subtle">
          <Icon name="download" size={14} /> Export
        </button>
        {exportOpen ? (
          <>
            <div className="fixed inset-0 z-10" onMouseDown={() => setExportOpen(false)} />
            <div role="menu" aria-label="Export" className="absolute right-0 bottom-[38px] z-20 w-[190px] rounded-[12px] border border-line bg-surface p-1.5 shadow-[0_12px_32px_rgb(var(--ws-shadow-rgb)/.16)]">
              {(
                [
                  ['csv', 'CSV (.csv)'],
                  ['vcf', 'vCard (.vcf)'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} type="button" role="menuitem" onClick={() => (setExportOpen(false), onExport(k))} className="flex h-[34px] w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[12.5px] font-semibold text-ink hover:bg-ground">
                  <Icon name={k === 'csv' ? 'file-sheet' : 'contact'} size={15} className="text-ink-2" /> {l}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
      {deleting ? (
        <Modal
          title="Delete group"
          onClose={() => setDeleting(null)}
          width={380}
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => void remove()}>Delete</Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">Delete “{deleting.name}”? Contacts are kept.</p>
        </Modal>
      ) : null}
    </nav>
  );
}
