import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Organization } from '@shared/types';
import { apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { prettyAccelerator } from '../../core/commands';
import { orgShortcut, orgTone, roleLabel, switchOrganization } from '../../core/orgs';
import { useStore } from '../../core/store';
import { currentZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { closeOverlay } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { cx, initials } from '../../components/ui';

/**
 * The organisation switcher (sidebar designs 1–3): it opens under the
 * organisation card at the top of the sidebar, or beside it when the sidebar
 * is collapsed. Find an organisation, All organizations, each company with
 * your role in it and its shortcut, and — for whoever manages the directory
 * — Manage organizations and Create an organization.
 */
export function OrgTile({ id, name, size = 32, all }: { id: string; name: string; size?: number; all?: boolean }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[9px] font-bold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), background: all ? '#2F3E91' : orgTone(id) }}
      aria-hidden
    >
      {all ? 'AO' : initials(name)}
    </span>
  );
}

function Kbd({ acc }: { acc: string }) {
  return <span className="shrink-0 rounded-[5px] border border-line px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-ink-3">{prettyAccelerator(acc)}</span>;
}

type Row = { kind: 'all' } | { kind: 'org'; org: Organization; n: number };

export function OrgSwitcher() {
  const b = useStore(app, (s) => s.bootstrap);
  const current = useStore(app, (s) => s.organizationId);
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const ref = useRef<HTMLDivElement>(null);
  // Under the card, or beside it when the sidebar is collapsed to icons. Read once, as it opens.
  const [pos] = useState<{ top: number; left: number }>(() => {
    const card = typeof document === 'undefined' ? null : document.querySelector('[data-org-card]')?.getBoundingClientRect();
    if (!card) return { top: 124, left: 10 };
    return card.width < 100 ? { top: card.top, left: card.right + 8 } : { top: card.bottom + 6, left: card.left };
  });
  const [find, setFind] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const orgs = useMemo(() => b?.organizations ?? [], [b]);
  const canManage = !!perms && (perms.includes('*') || perms.includes('directory.manage'));

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element | null)?.closest?.('[data-org-card]')) closeOverlay();
    };
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
    };
  }, []);

  const needle = find.trim().toLowerCase();
  const rows: Row[] = useMemo(() => {
    const list: Row[] = [];
    if (orgs.length > 1 && (!needle || 'all organizations'.includes(needle))) list.push({ kind: 'all' });
    orgs.forEach((org, i) => {
      if (!needle || org.name.toLowerCase().includes(needle) || (roleLabel(org.role) ?? '').toLowerCase().includes(needle)) list.push({ kind: 'org', org, n: i + 1 });
    });
    return list;
  }, [orgs, needle]);

  if (!b) return null;
  const selected = (r: Row) => (r.kind === 'all' ? current === null : current === r.org.id || (orgs.length === 1 && current === null));
  const choose = async (r: Row) => {
    if (busy) return;
    const id = r.kind === 'all' ? null : r.org.id;
    if (selected(r)) return closeOverlay();
    setBusy(true);
    const ok = await switchOrganization(id);
    setBusy(false);
    if (ok) closeOverlay();
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      closeOverlay();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && rows[active]) {
      e.preventDefault();
      void choose(rows[active]);
    }
  };
  const shown = Math.min(active, Math.max(0, rows.length - 1));
  const firstOrg = rows.findIndex((r) => r.kind === 'org');

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Organizations"
      onKeyDown={onKey}
      className="no-drag animate-in fixed z-40 flex max-h-[calc(100vh-120px)] w-[330px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_24px_60px_rgb(var(--ws-shadow-rgb)/.28)]"
      style={{ top: pos.top, left: pos.left }}
    >
      {orgs.length > 1 ? (
        <div className="p-2.5 pb-1.5">
          <label className="flex h-9 items-center gap-2 rounded-[9px] border border-line bg-well px-2.5 focus-within:border-primary">
            <Icon name="search" size={15} className="text-ink-3" />
            <input
              autoFocus
              value={find}
              onChange={(e) => (setFind(e.target.value), setActive(0))}
              placeholder="Find an organization"
              aria-label="Find an organization"
              className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </label>
        </div>
      ) : null}
      <div role="listbox" aria-label="Organizations" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5 scroll-thin">
        {rows.map((r, i) => {
          const on = selected(r);
          return (
            <div key={r.kind === 'all' ? 'all' : r.org.id}>
              {i === firstOrg ? <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-bold tracking-[.5px] text-ink-3 uppercase">Organizations</div> : null}
              <button
                type="button"
                role="option"
                aria-selected={on}
                disabled={busy || (orgs.length === 1 && r.kind === 'org')}
                onMouseEnter={() => setActive(i)}
                onClick={() => void choose(r)}
                className={cx('flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left', i === shown ? 'bg-subtle' : '', on && 'bg-selection')}
              >
                {r.kind === 'all' ? <OrgTile id="all" name="All organizations" all /> : <OrgTile id={r.org.id} name={r.org.name} />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-[13px] text-ink">{r.kind === 'all' ? 'All organizations' : r.org.name}</b>
                  <span className="truncate text-[11.5px] text-ink-3">{r.kind === 'all' ? `Everything you can see, across ${orgs.length === 2 ? 'both' : `all ${orgs.length}`}` : (roleLabel(r.org.role) ?? 'Member')}</span>
                </span>
                {orgs.length > 1 && (r.kind === 'all' || r.n <= 9) ? <Kbd acc={orgShortcut(r.kind === 'all' ? 0 : r.n)} /> : null}
                <span className="flex w-4 shrink-0 justify-center">{on ? <Icon name="check" size={15} className="text-primary" /> : null}</span>
              </button>
            </div>
          );
        })}
        {rows.length === 0 ? <p className="m-0 px-3 py-4 text-center text-[12.5px] text-ink-3">{orgs.length ? `No organization matches “${find}”.` : 'No organizations are shared with you.'}</p> : null}
      </div>
      {canManage ? (
        <div className="flex flex-col border-t border-line p-1.5">
          <button type="button" onClick={() => (closeOverlay(), void call('app:openInBrowser', { path: '/directory' }))} className="flex h-9 items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] font-semibold text-ink hover:bg-subtle" title="Opens the Directory in your browser">
            <Icon name="building" size={16} className="text-ink-3" />
            <span className="flex-1 text-left">Manage organizations</span>
            <Icon name="external" size={13} className="text-ink-3" />
          </button>
          <button type="button" onClick={() => setCreating(true)} className="flex h-9 items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] font-semibold text-ink hover:bg-subtle">
            <Icon name="plus" size={16} className="text-ink-3" />
            <span className="flex-1 text-left">Create an organization</span>
          </button>
        </div>
      ) : null}
      {creating ? <CreateOrganization onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

/** A new company: a name, and optionally its legal name, country and time zone. The rest is set in the Directory. */
function CreateOrganization({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [legal, setLegal] = useState('');
  const [country, setCountry] = useState('');
  const [busy, setBusy] = useState(false);
  const zone = currentZone();
  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await apiPost('/api/directory/organizations', { name: name.trim(), legal_name: legal.trim() || null, country: country.trim() || null, timezone: zone });
      const fresh = await call('session:refresh').catch(() => null);
      void qc.invalidateQueries();
      const made = fresh?.organizations.find((o) => o.name === name.trim());
      toast('success', made ? `${made.name} created.` : `${name.trim()} created. It shows here once you are a member of it.`);
      if (made) await switchOrganization(made.id);
      closeOverlay();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const field = 'h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary';
  return (
    <form className="flex flex-col gap-2.5 border-t border-line bg-well p-3" onSubmit={(e) => (e.preventDefault(), void create())} aria-label="Create an organization">
      <b className="text-[13px] text-ink">Create an organization</b>
      <input autoFocus aria-label="Name" placeholder="Name, as people will see it" value={name} maxLength={150} onChange={(e) => setName(e.target.value)} className={field} />
      <input aria-label="Legal name" placeholder="Legal name (optional)" value={legal} maxLength={200} onChange={(e) => setLegal(e.target.value)} className={field} />
      <input aria-label="Country" placeholder="Country (optional)" value={country} maxLength={80} onChange={(e) => setCountry(e.target.value)} className={field} />
      <span className="text-[11.5px] text-ink-3">Its time zone starts as yours ({zone.replace(/_/g, ' ')}). Everything else is set in the Directory.</span>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-8 rounded-[8px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
          Cancel
        </button>
        <button type="submit" disabled={!name.trim() || busy} className="h-8 rounded-[8px] bg-primary px-3 text-[12.5px] font-bold text-white disabled:opacity-50">
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  );
}
